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
import { removeAssetFiles } from "@/server/media/storage";
import {
  OpenAICompatibleAnalyzer,
  type MultimodalAnalyzer,
} from "@/server/model/analyzer";
import {
  completeJob,
  failJob,
  getAssetRecord,
  heartbeatJob,
  type ClaimedJob,
} from "@/server/repositories/assets";
import type { AnalysisResult, FailureCode } from "@/shared/contracts";

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
    if (asset.reviewStatus === "deleted") {
      completeJob(job);
      return;
    }
    if (!advanceJobAssetStatus(job, "validating")) {
      completeJob(job);
      return;
    }
    if (!advanceJobAssetStatus(job, "analyzing")) {
      completeJob(job);
      return;
    }
    const result = await analyzer.analyze({
      assetId: asset.id,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
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
    failJobAndMarkAsset(job, error);
  } finally {
    clearInterval(heartbeat);
  }
}
