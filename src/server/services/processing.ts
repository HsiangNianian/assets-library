import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "@/server/config";
import { db } from "@/server/db";
import {
  analysisResults,
  assets,
  assetTagRejections,
  assetTags,
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

function persistAnalysis(
  assetId: string,
  result: AnalysisResult,
  protocol: string,
  modelName: string,
) {
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(analysisResults)
      .values({
        assetId,
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
      .where(eq(assetTagRejections.assetId, assetId))
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
        .values({ assetId, tagId, source: "model", confidence: null })
        .onConflictDoNothing()
        .run();
    }
    const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
    tx.update(assets)
      .set({
        description: asset?.description || result.description,
        processingStatus: "completed",
        reviewStatus: asset?.directPublish ? "published" : "pending_review",
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(assets.id, assetId))
      .run();
  });
}

function markAssetFailed(assetId: string, error: unknown) {
  const appError =
    error instanceof AppError ? error : new AppError("internal_error");
  db.update(assets)
    .set({
      processingStatus: "failed",
      failureCode: appError.code satisfies FailureCode,
      failureMessage: appError.message,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .run();
}

export async function processJob(
  job: ClaimedJob,
  analyzer: MultimodalAnalyzer = new OpenAICompatibleAnalyzer(),
) {
  const asset = getAssetRecord(job.assetId);
  if (!asset) {
    failJob(job.id);
    return;
  }
  const heartbeat = setInterval(() => heartbeatJob(job.id), 30_000);
  heartbeat.unref();
  try {
    if (job.type === "cleanup") {
      removeAssetFiles(asset.originalPath);
      completeJob(job.id);
      return;
    }
    if (asset.reviewStatus === "deleted") {
      completeJob(job.id);
      return;
    }
    db.update(assets)
      .set({ processingStatus: "validating", updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    db.update(assets)
      .set({ processingStatus: "analyzing", updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    const result = await analyzer.analyze({
      assetId: asset.id,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      relativePath: asset.originalPath,
    });
    const config = loadConfig();
    persistAnalysis(
      asset.id,
      result,
      config.MODEL_PROTOCOL,
      config.MODEL_NAME ?? "unknown",
    );
    completeJob(job.id);
  } catch (error) {
    markAssetFailed(asset.id, error);
    failJob(job.id);
  } finally {
    clearInterval(heartbeat);
  }
}
