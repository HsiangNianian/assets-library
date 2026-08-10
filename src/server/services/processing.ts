import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "@/server/config";
import { db } from "@/server/db";
import {
  analysisResults,
  assets,
  assetTagRejections,
  assetTags,
  processingJobs,
  tags,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import {
  readVideoFrames,
  removeAssetFiles,
  resolveMediaPath,
  storeVideoFrames,
} from "@/server/media/storage";
import { validateMediaFile } from "@/server/media/validate";
import { extractVideoFrames } from "@/server/media/video-frames";
import {
  OpenAICompatibleAnalyzer,
  type MultimodalAnalyzer,
} from "@/server/model/analyzer";
import { indexAnalysis, semanticSearchEnabled } from "@/server/search/chroma";
import {
  completeJob,
  failJob,
  getAssetRecord,
  heartbeatJob,
  requeueJob,
  type ClaimedJob,
} from "@/server/repositories/assets";
import {
  analysisResultSchema,
  type AnalysisResult,
  type FailureCode,
} from "@/shared/contracts";

type AssetRecord = NonNullable<ReturnType<typeof getAssetRecord>>;
type MediaPreparer = (asset: AssetRecord) => Promise<{ mimeType: string }>;

async function prepareMedia(asset: AssetRecord) {
  const validated = await validateMediaFile(
    resolveMediaPath(asset.originalPath),
    asset.originalFilename,
    asset.mimeType,
    asset.sizeBytes,
  );
  if (validated.mediaType !== asset.mediaType) {
    throw new AppError("unsupported_media_type");
  }
  if (validated.mediaType === "video") {
    try {
      readVideoFrames(asset.originalPath);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "video_frames_missing") {
        throw error;
      }
      const extracted = await extractVideoFrames(resolveMediaPath(asset.originalPath));
      storeVideoFrames(asset.originalPath, extracted.uploads, extracted.metadata);
    }
  }
  return { mimeType: validated.mimeType };
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function tagsFromAnalysis(result: AnalysisResult) {
  if (result.kind === "image") {
    return Object.entries(result.tags).flatMap(([category, values]) =>
      values.map((value) => ({ category, value })),
    );
  }
  return [
    ...result.topics.map((value) => ({ category: "topic", value })),
    ...Object.entries(result.tags).flatMap(([category, values]) =>
      values.map((value) => ({ category, value })),
    ),
  ];
}

function advanceJobAssetStatus(
  job: ClaimedJob,
  processingStatus: "validating" | "analyzing",
) {
  const now = new Date();
  return db.transaction((tx) => {
    const renewed = tx
      .update(processingJobs)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.status, "running"),
          eq(processingJobs.attempt, job.attempt),
        ),
      )
      .run();
    if (renewed.changes !== 1) return false;
    const updated = tx
      .update(assets)
      .set({ processingStatus, updatedAt: now })
      .where(
        and(
          eq(assets.id, job.assetId),
          eq(assets.reviewStatus, "pending_review"),
        ),
      )
      .run();
    return updated.changes === 1;
  });
}

function persistAnalysis(
  job: ClaimedJob,
  result: AnalysisResult,
  protocol: string,
  modelName: string,
) {
  const now = new Date();
  return db.transaction((tx) => {
    const completed = tx
      .update(processingJobs)
      .set({ status: "completed", updatedAt: now })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.status, "running"),
          eq(processingJobs.attempt, job.attempt),
        ),
      )
      .run();
    if (completed.changes !== 1) return false;

    const asset = tx
      .select()
      .from(assets)
      .where(eq(assets.id, job.assetId))
      .get();
    if (!asset || asset.reviewStatus === "deleted") return true;

    tx.insert(analysisResults)
      .values({
        assetId: job.assetId,
        schemaVersion: 1,
        resultJson: JSON.stringify(result),
        modelProtocol: protocol,
        modelName,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: analysisResults.assetId,
        set: {
          resultJson: JSON.stringify(result),
          modelProtocol: protocol,
          modelName,
          completedAt: now,
        },
      })
      .run();

    const rejected = tx
      .select()
      .from(assetTagRejections)
      .where(eq(assetTagRejections.assetId, job.assetId))
      .all();
    const rejectedKeys = new Set(
      rejected.map((item) => `${item.category}:${item.normalizedValue}`),
    );
    for (const tag of tagsFromAnalysis(result)) {
      const normalizedValue = normalize(tag.value);
      if (rejectedKeys.has(`${tag.category}:${normalizedValue}`)) continue;
      const existingTag = tx
        .select()
        .from(tags)
        .where(
          and(
            eq(tags.category, tag.category),
            eq(tags.normalizedValue, normalizedValue),
          ),
        )
        .get();
      const tagId = existingTag?.id ?? crypto.randomUUID();
      if (!existingTag) {
        tx.insert(tags)
          .values({
            id: tagId,
            category: tag.category,
            value: tag.value.trim(),
            normalizedValue,
            createdAt: now,
          })
          .run();
      }
      tx.insert(assetTags)
        .values({
          assetId: job.assetId,
          tagId,
          source: "model",
          confidence: null,
        })
        .onConflictDoNothing()
        .run();
    }
    tx.update(assets)
      .set({
        description: asset.description || result.description,
        processingStatus: "completed",
        reviewStatus: asset.directPublish ? "published" : "pending_review",
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(assets.id, job.assetId))
      .run();
    if (semanticSearchEnabled()) {
      tx.insert(processingJobs)
        .values({
          id: crypto.randomUUID(),
          assetId: job.assetId,
          type: "embed",
          status: "queued",
          attempt: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    return true;
  });
}

function failJobAndMarkAsset(job: ClaimedJob, error: unknown) {
  const appError =
    error instanceof AppError ? error : new AppError("internal_error");
  const now = new Date();
  return db.transaction((tx) => {
    const failed = tx
      .update(processingJobs)
      .set({ status: "failed", updatedAt: now })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.status, "running"),
          eq(processingJobs.attempt, job.attempt),
        ),
      )
      .run();
    if (failed.changes !== 1) return false;
    tx.update(assets)
      .set({
        processingStatus: "failed",
        failureCode: appError.code satisfies FailureCode,
        failureMessage: appError.message,
        updatedAt: now,
      })
      .where(
        and(
          eq(assets.id, job.assetId),
          eq(assets.reviewStatus, "pending_review"),
        ),
      )
      .run();
    return true;
  });
}

export async function processJob(
  job: ClaimedJob,
  analyzer: MultimodalAnalyzer = new OpenAICompatibleAnalyzer(),
  mediaPreparer: MediaPreparer = prepareMedia,
) {
  const asset = getAssetRecord(job.assetId);
  if (!asset) {
    failJob(job);
    return;
  }
  const heartbeat = setInterval(() => {
    try {
      heartbeatJob(job);
    } catch (error) {
      console.error("Processing job heartbeat failed.", error);
    }
  }, 30_000);
  heartbeat.unref();
  try {
    if (job.type === "cleanup") {
      if (heartbeatJob(job) !== 1) return;
      removeAssetFiles(asset.originalPath);
      completeJob(job);
      return;
    }
    if (job.type === "embed") {
      const analysis = db
        .select()
        .from(analysisResults)
        .where(eq(analysisResults.assetId, job.assetId))
        .get();
      if (!analysis || asset.reviewStatus === "deleted") {
        completeJob(job);
        return;
      }
      await indexAnalysis(job.assetId, analysisResultSchema.parse(JSON.parse(analysis.resultJson)));
      completeJob(job);
      return;
    }
    if (asset.reviewStatus === "deleted") {
      completeJob(job);
      return;
    }
    if (!advanceJobAssetStatus(job, "validating")) {
      completeJob(job);
      return;
    }
    const prepared = await mediaPreparer(asset);
    db.update(assets)
      .set({ mimeType: prepared.mimeType, updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    if (!advanceJobAssetStatus(job, "analyzing")) {
      completeJob(job);
      return;
    }
    const result = await analyzer.analyze({
      assetId: asset.id,
      mediaType: asset.mediaType,
      mimeType: prepared.mimeType,
      relativePath: asset.originalPath,
    });
    const config = loadConfig();
    persistAnalysis(
      job,
      result,
      config.MODEL_PROTOCOL,
      config.MODEL_NAME ?? "unknown",
    );
  } catch (error) {
    if (job.type === "embed") {
      console.error("Embedding analysis failed.", error);
      if (job.attempt < 3) {
        requeueJob(job, job.attempt * 30_000);
      } else {
        failJob(job);
      }
    } else {
      failJobAndMarkAsset(job, error);
    }
  } finally {
    clearInterval(heartbeat);
  }
}
