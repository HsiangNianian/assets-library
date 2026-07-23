import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db, sqlite } from "@/server/db";
import {
  analysisResults,
  assets,
  assetTagRejections,
  assetTags,
  processingJobs,
  tags,
  uploadRequests,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import {
  analysisResultSchema,
  type AssetDetail,
  type AssetEdit,
  type AssetPage,
  type AssetSummary,
  type AssetTag,
  type FailureCode,
  type UploadStatus,
} from "@/shared/contracts";

const progress = {
  queued: 10,
  validating: 25,
  analyzing: 60,
  completed: 100,
  failed: 100,
} as const;

export interface CreateAssetInput {
  assetId: string;
  uploadId: string;
  name: string;
  originalFilename: string;
  originalPath: string;
  mimeType: string;
  declaredMime: string;
  mediaType: "image" | "video";
  sizeBytes: number;
  directPublish: boolean;
}

export function createAsset(input: CreateAssetInput) {
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(assets)
      .values({
        id: input.assetId,
        name: input.name,
        description: "",
        mediaType: input.mediaType,
        originalFilename: input.originalFilename,
        originalPath: input.originalPath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        directPublish: input.directPublish,
        processingStatus: "queued",
        reviewStatus: "pending_review",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(uploadRequests)
      .values({
        id: input.uploadId,
        assetId: input.assetId,
        clientFilename: input.originalFilename,
        declaredMime: input.declaredMime,
        sizeBytes: input.sizeBytes,
        createdAt: now,
      })
      .run();
    tx.insert(processingJobs)
      .values({
        id: crypto.randomUUID(),
        assetId: input.assetId,
        type: "analyze",
        status: "queued",
        attempt: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  return getUploadStatus(input.uploadId);
}

export function getUploadStatus(uploadId: string): UploadStatus {
  const row = db
    .select({ upload: uploadRequests, asset: assets })
    .from(uploadRequests)
    .innerJoin(assets, eq(uploadRequests.assetId, assets.id))
    .where(eq(uploadRequests.id, uploadId))
    .get();
  if (!row) throw new AppError("invalid_request", "上传记录不存在。", 404);
  return {
    uploadId: row.upload.id,
    assetId: row.asset.id,
    mediaType: row.asset.mediaType,
    processingStatus: row.asset.processingStatus,
    reviewStatus: row.asset.reviewStatus,
    progressPercent: progress[row.asset.processingStatus],
    failureCode: row.asset.failureCode as FailureCode | null,
    failureMessage: row.asset.failureMessage,
  };
}

function getTagsForAssets(assetIds: string[]) {
  if (!assetIds.length) return new Map<string, AssetTag[]>();
  const rows = db
    .select({
      assetId: assetTags.assetId,
      category: tags.category,
      value: tags.value,
      source: assetTags.source,
      confidence: assetTags.confidence,
    })
    .from(assetTags)
    .innerJoin(tags, eq(assetTags.tagId, tags.id))
    .where(inArray(assetTags.assetId, assetIds))
    .orderBy(asc(tags.category), asc(tags.value))
    .all();
  const result = new Map<string, AssetTag[]>();
  for (const row of rows) {
    const current = result.get(row.assetId) ?? [];
    current.push({
      category: row.category,
      value: row.value,
      source: row.source,
      confidence: row.confidence,
    });
    result.set(row.assetId, current);
  }
  return result;
}

function summaryFromRow(
  row: typeof assets.$inferSelect,
  tagList: AssetTag[],
): AssetSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    mediaType: row.mediaType,
    processingStatus: row.processingStatus,
    reviewStatus: row.reviewStatus,
    tags: tagList,
    mediaUrl: `/api/media/${row.id}`,
    createdAt: row.createdAt.toISOString(),
  };
}

export function listPublishedAssets(cursor?: string, limit = 24): AssetPage {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const cursorDate = cursor ? new Date(Buffer.from(cursor, "base64url").toString()) : null;
  if (cursorDate && Number.isNaN(cursorDate.getTime())) {
    throw new AppError("invalid_request", "分页游标无效。");
  }
  const rows = db
    .select()
    .from(assets)
    .where(
      cursorDate
        ? and(eq(assets.reviewStatus, "published"), lt(assets.createdAt, cursorDate))
        : eq(assets.reviewStatus, "published"),
    )
    .orderBy(desc(assets.createdAt))
    .limit(safeLimit + 1)
    .all();
  const pageRows = rows.slice(0, safeLimit);
  const tagMap = getTagsForAssets(pageRows.map((row) => row.id));
  return {
    items: pageRows.map((row) => summaryFromRow(row, tagMap.get(row.id) ?? [])),
    nextCursor:
      rows.length > safeLimit && pageRows.length
        ? Buffer.from(pageRows.at(-1)!.createdAt.toISOString()).toString("base64url")
        : null,
  };
}

export function getAssetDetail(assetId: string): AssetDetail {
  const row = db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), ne(assets.reviewStatus, "deleted")))
    .get();
  if (!row) throw new AppError("invalid_request", "素材不存在。", 404);
  const analysis = db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.assetId, assetId))
    .get();
  return {
    ...summaryFromRow(row, getTagsForAssets([assetId]).get(assetId) ?? []),
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    directPublish: row.directPublish,
    failureCode: row.failureCode as FailureCode | null,
    failureMessage: row.failureMessage,
    analysis: analysis
      ? analysisResultSchema.parse(JSON.parse(analysis.resultJson))
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function getAssetRecord(assetId: string) {
  return db.select().from(assets).where(eq(assets.id, assetId)).get();
}

function normalizeTag(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function updateAssetMetadata(assetId: string, edit: AssetEdit) {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.reviewStatus === "deleted") {
    throw new AppError("invalid_request", "素材不存在。", 404);
  }
  const existing = getTagsForAssets([assetId]).get(assetId) ?? [];
  const requested = new Set(
    edit.tags.map((tag) => `${tag.category}:${normalizeTag(tag.value)}`),
  );
  const removedModelTags = existing.filter(
    (tag) =>
      tag.source === "model" &&
      !requested.has(`${tag.category}:${normalizeTag(tag.value)}`),
  );
  const now = new Date();
  db.transaction((tx) => {
    tx.update(assets)
      .set({ name: edit.name, description: edit.description, updatedAt: now })
      .where(eq(assets.id, assetId))
      .run();
    for (const tag of removedModelTags) {
      tx.insert(assetTagRejections)
        .values({
          assetId,
          category: tag.category,
          normalizedValue: normalizeTag(tag.value),
        })
        .onConflictDoNothing()
        .run();
    }
    tx.delete(assetTags).where(eq(assetTags.assetId, assetId)).run();
    for (const tag of edit.tags) {
      const normalizedValue = normalizeTag(tag.value);
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
        .values({ assetId, tagId, source: "human", confidence: null })
        .run();
    }
  });
  return getAssetDetail(assetId);
}

export function publishAsset(assetId: string) {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.reviewStatus === "deleted") {
    throw new AppError("invalid_request", "素材不存在。", 404);
  }
  if (asset.processingStatus !== "completed") {
    throw new AppError("invalid_request", "素材分析完成后才能入库。", 409);
  }
  db.update(assets)
    .set({ reviewStatus: "published", updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .run();
  return getAssetDetail(assetId);
}

export function retryAsset(assetId: string) {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.reviewStatus === "deleted") {
    throw new AppError("invalid_request", "素材不存在。", 404);
  }
  if (asset.processingStatus !== "failed") {
    throw new AppError("invalid_request", "只有失败的素材可以重试。", 409);
  }
  const now = new Date();
  db.transaction((tx) => {
    tx.update(assets)
      .set({
        processingStatus: "queued",
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(assets.id, assetId))
      .run();
    tx.insert(processingJobs)
      .values({
        id: crypto.randomUUID(),
        assetId,
        type: "analyze",
        status: "queued",
        attempt: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  const upload = db
    .select()
    .from(uploadRequests)
    .where(eq(uploadRequests.assetId, assetId))
    .get();
  return getUploadStatus(upload!.id);
}

export function softDeleteAsset(assetId: string) {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.reviewStatus === "deleted") {
    throw new AppError("invalid_request", "素材不存在。", 404);
  }
  const now = new Date();
  db.transaction((tx) => {
    tx.update(assets)
      .set({ reviewStatus: "deleted", deletedAt: now, updatedAt: now })
      .where(eq(assets.id, assetId))
      .run();
    tx.insert(processingJobs)
      .values({
        id: crypto.randomUUID(),
        assetId,
        type: "cleanup",
        status: "queued",
        attempt: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

export interface ClaimedJob {
  id: string;
  assetId: string;
  type: "analyze" | "cleanup";
  attempt: number;
}

export function claimNextJob(): ClaimedJob | null {
  const now = Date.now();
  const transaction = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT id, asset_id AS assetId, type, attempt
         FROM processing_jobs
         WHERE status = 'queued' AND available_at <= ?
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(now) as ClaimedJob | undefined;
    if (!row) return null;
    const result = sqlite
      .prepare(
        `UPDATE processing_jobs SET status = 'running', claimed_at = ?,
         attempt = attempt + 1, updated_at = ? WHERE id = ? AND status = 'queued'`,
      )
      .run(now, now, row.id);
    return result.changes === 1 ? { ...row, attempt: row.attempt + 1 } : null;
  });
  return transaction.immediate();
}

export function completeJob(jobId: string) {
  db.update(processingJobs)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(processingJobs.id, jobId))
    .run();
}

export function failJob(jobId: string) {
  db.update(processingJobs)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(processingJobs.id, jobId))
    .run();
}

export function recoverStaleJobs() {
  const stale = new Date(Date.now() - 10 * 60_000);
  db.update(processingJobs)
    .set({ status: "queued", claimedAt: null, availableAt: new Date(), updatedAt: new Date() })
    .where(and(eq(processingJobs.status, "running"), lt(processingJobs.claimedAt, stale)))
    .run();
}
