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
    expect(repository.listPublishedAssets().items).toHaveLength(1);

    const partial = media.mediaResponse(
      assetId,
      new Request("http://localhost/media", {
        headers: { range: "bytes=0-9" },
      }),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-9\//);

    repository.softDeleteAsset(assetId);
    const cleanup = repository.claimNextJob();
    expect(cleanup?.type).toBe("cleanup");
    await processing.processJob(cleanup!, analyzer);
    await expect(fs.stat(storage.resolveMediaPath(originalPath))).rejects.toThrow();
    expect(() => repository.getAssetDetail(assetId)).toThrow();
  });
});
