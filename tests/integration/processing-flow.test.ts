import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { MultimodalAnalyzer } from "@/server/model/analyzer";

describe("complete asset processing flow", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "asset-flow-"));
    process.env.DATABASE_PATH = path.join(directory, "assets.db");
    process.env.MEDIA_ROOT = path.join(directory, "media");
    process.env.MODEL_PROTOCOL = "openai_chat_completions";
    process.env.MODEL_NAME = "test-model";
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("uploads, analyzes, edits, publishes, streams and deletes an image", async () => {
    const [
      storage,
      validation,
      repository,
      processing,
      media,
    ] = await Promise.all([
      import("@/server/media/storage"),
      import("@/server/media/validate"),
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
      import("@/server/media/response"),
    ]);

    const temporaryPath = storage.temporaryUploadPath("flow-upload");
    await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: "#00aacc",
      },
    })
      .png()
      .toFile(temporaryPath);
    const stat = await fs.stat(temporaryPath);
    const validated = await validation.validateMediaFile(
      temporaryPath,
      "campaign.png",
      "image/png",
      stat.size,
    );
    const assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    const originalPath = storage.moveIntoAssetStorage(
      temporaryPath,
      assetId,
      validated.extension,
    );
    repository.createAsset({
      assetId,
      uploadId,
      name: "campaign",
      originalFilename: "campaign.png",
      originalPath,
      mimeType: validated.mimeType,
      declaredMime: "image/png",
      mediaType: "image",
      sizeBytes: stat.size,
      directPublish: false,
    });
    expect(repository.listAssets({ view: "pending" }).items).toEqual([
      expect.objectContaining({
        id: assetId,
        processingStatus: "queued",
        reviewStatus: "pending_review",
      }),
    ]);

    const analyzer: MultimodalAnalyzer = {
      async analyze() {
        return {
          kind: "image",
          description: "一张青色的活动图片",
          tags: {
            scene: ["室内"],
            object: ["海报"],
            person: [],
            style: ["简洁"],
            color_composition: ["青色"],
          },
          ocr: { text: null, unavailableReason: "无文字" },
        };
      },
    };
    const job = repository.claimNextJob();
    expect(job?.type).toBe("analyze");
    await processing.processJob(job!, analyzer);

    let detail = repository.getAssetDetail(assetId);
    expect(detail.processingStatus).toBe("completed");
    expect(detail.reviewStatus).toBe("pending_review");
    expect(detail.tags.map((tag) => tag.value)).toContain("海报");

    detail = repository.updateAssetMetadata(assetId, {
      name: "活动主视觉",
      description: "人工确认后的描述",
      tags: [{ category: "scene", value: "展厅" }],
    });
    expect(detail.tags).toEqual([
      expect.objectContaining({ value: "展厅", source: "human" }),
    ]);
    detail = repository.publishAsset(assetId);
    expect(detail.reviewStatus).toBe("published");
    expect(repository.listAssets({ view: "pending" }).items).toHaveLength(0);
    expect(repository.listAssets({ view: "published" }).items).toHaveLength(1);
    expect(
      repository.listAssets({
        view: "published",
        tagQuery: "展",
      }).items,
    ).toHaveLength(1);
    expect(
      repository.listAssets({
        view: "published",
        tagQuery: "活动",
      }).items,
    ).toHaveLength(0);
    expect(
      repository.listAssets({
        view: "published",
        tagQuery: "人工",
      }).items,
    ).toHaveLength(0);

    const partial = media.mediaResponse(
      assetId,
      new Request("http://localhost/media", {
        headers: { range: "bytes=0-9" },
      }),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-9\//);

    const download = media.mediaResponse(
      assetId,
      new Request("http://localhost/media?download=1"),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''campaign.png",
    );
    await download.arrayBuffer();

    repository.softDeleteAsset(assetId);
    const cleanup = repository.claimNextJob();
    expect(cleanup?.type).toBe("cleanup");
    await processing.processJob(cleanup!, analyzer);
    await expect(fs.stat(storage.resolveMediaPath(originalPath))).rejects.toThrow();
    expect(() => repository.getAssetDetail(assetId)).toThrow();
  });

  it("persists every video timeline section", async () => {
    const [storage, repository, processing] = await Promise.all([
      import("@/server/media/storage"),
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
    ]);
    const assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    const temporaryPath = storage.temporaryUploadPath("video-flow-upload");
    await fs.writeFile(temporaryPath, "video");
    const originalPath = storage.moveIntoAssetStorage(
      temporaryPath,
      assetId,
      ".mp4",
    );
    repository.createAsset({
      assetId,
      uploadId,
      name: "video",
      originalFilename: "video.mp4",
      originalPath,
      mimeType: "video/mp4",
      declaredMime: "video/mp4",
      mediaType: "video",
      sizeBytes: 5,
      directPublish: false,
    });
    const analyzer: MultimodalAnalyzer = {
      async analyze() {
        return {
          kind: "video",
          description: "产品演示视频",
          topics: ["产品"],
          tags: { scene: ["室内"], person: [], form: ["演示"] },
          visualSegments: [
            { startSeconds: 0, endSeconds: 4, summary: "展示产品外观" },
          ],
          keyMoments: [{ seconds: 2, summary: "出现产品名称" }],
          timeline: [
            { startSeconds: 0, endSeconds: 4, summary: "完成一次演示" },
          ],
        };
      },
    };

    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(assetId);
    await processing.processJob(job!, analyzer);

    const detail = repository.getAssetDetail(assetId);
    expect(detail.analysis).toMatchObject({
      kind: "video",
      visualSegments: [{ summary: "展示产品外观" }],
      keyMoments: [{ summary: "出现产品名称" }],
      timeline: [{ summary: "完成一次演示" }],
    });
  });

  it("heartbeats active jobs and recovers jobs whose worker disappeared", async () => {
    const [storage, repository, database, schema] = await Promise.all([
      import("@/server/media/storage"),
      import("@/server/repositories/assets"),
      import("@/server/db"),
      import("@/server/db/schema"),
    ]);
    const { eq } = await import("drizzle-orm");
    const assetId = crypto.randomUUID();
    const temporaryPath = storage.temporaryUploadPath("recovery-upload");
    await fs.writeFile(temporaryPath, "image");
    const originalPath = storage.moveIntoAssetStorage(
      temporaryPath,
      assetId,
      ".jpg",
    );
    repository.createAsset({
      assetId,
      uploadId: crypto.randomUUID(),
      name: "recovery",
      originalFilename: "recovery.jpg",
      originalPath,
      mimeType: "image/jpeg",
      declaredMime: "image/jpeg",
      mediaType: "image",
      sizeBytes: 5,
      directPublish: false,
    });

    const claimed = repository.claimNextJob();
    expect(claimed?.assetId).toBe(assetId);
    expect(repository.heartbeatJob(claimed!.id)).toBe(1);
    expect(
      repository
        .listAssets({
        view: "pending",
        tagQuery: "不会过滤待入库素材",
        })
        .items.some((item) => item.id === assetId),
    ).toBe(true);
    database.db
      .update(schema.processingJobs)
      .set({ claimedAt: new Date(Date.now() - 180_000) })
      .where(eq(schema.processingJobs.id, claimed!.id))
      .run();
    expect(repository.recoverStaleJobs(120_000)).toBe(1);
    expect(repository.claimNextJob()).toMatchObject({
      id: claimed!.id,
      assetId,
      attempt: 2,
    });
  });

  it("paginates each overview view with eight assets per page", async () => {
    const [repository] = await Promise.all([
      import("@/server/repositories/assets"),
    ]);
    const before = repository.listAssets({ view: "pending" }).total;
    for (let index = 0; index < 9; index += 1) {
      repository.createAsset({
        assetId: crypto.randomUUID(),
        uploadId: crypto.randomUUID(),
        name: `pagination-${index}`,
        originalFilename: `pagination-${index}.jpg`,
        originalPath: `pagination-${index}/original.jpg`,
        mimeType: "image/jpeg",
        declaredMime: "image/jpeg",
        mediaType: "image",
        sizeBytes: 5,
        directPublish: false,
      });
    }

    const firstPage = repository.listAssets({
      view: "pending",
      page: 1,
      limit: 8,
    });
    const secondPage = repository.listAssets({
      view: "pending",
      page: 2,
      limit: 8,
    });
    expect(firstPage.items).toHaveLength(8);
    expect(firstPage.pageSize).toBe(8);
    expect(firstPage.total).toBe(before + 9);
    expect(secondPage.items.length).toBeGreaterThan(0);
    expect(
      firstPage.items.some((item) =>
        secondPage.items.some((next) => next.id === item.id),
      ),
    ).toBe(false);
  });
});
