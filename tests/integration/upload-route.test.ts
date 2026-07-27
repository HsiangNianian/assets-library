import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

describe("streaming upload route", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "asset-upload-route-"));
    process.env.DATABASE_PATH = path.join(directory, "assets.db");
    process.env.MEDIA_ROOT = path.join(directory, "media");
    const { initializeDatabase } = await import("@/server/db/migrations");
    initializeDatabase(process.env.DATABASE_PATH).sqlite.close();
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("accepts one PNG and rejects multiple files", async () => {
    const png = await sharp({
      create: {
        width: 3,
        height: 3,
        channels: 3,
        background: "#0ea5e9",
      },
    })
      .png()
      .toBuffer();
    const imageBytes = new ArrayBuffer(png.byteLength);
    new Uint8Array(imageBytes).set(png);
    const { POST } = await import("@/app/api/uploads/route");

    const validBody = new FormData();
    validBody.append(
      "file",
      new File([imageBytes], "现代AI智能体工作台背景插画.png", {
        type: "image/png",
      }),
    );
    validBody.append("directPublish", "false");
    const accepted = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: validBody,
      }),
    );
    expect(accepted.status).toBe(202);
    const upload = (await accepted.json()) as {
      assetId: string;
      mediaType: string;
      processingStatus: string;
      reviewStatus: string;
    };
    expect(upload).toMatchObject({
      mediaType: "image",
      processingStatus: "queued",
      reviewStatus: "pending_review",
    });
    const { getAssetDetail } = await import("@/server/repositories/assets");
    expect(getAssetDetail(upload.assetId)).toMatchObject({
      name: "现代AI智能体工作台背景插画",
      originalFilename: "现代AI智能体工作台背景插画.png",
    });

    const invalidBody = new FormData();
    invalidBody.append(
      "file",
      new File([imageBytes], "one.png", { type: "image/png" }),
    );
    invalidBody.append(
      "file",
      new File([imageBytes], "two.png", { type: "image/png" }),
    );
    const rejected = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: invalidBody,
      }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "multiple_files" },
    });
  });

  it("accepts one MP4 with sampled JPEG frames and rejects missing frames", async () => {
    const { POST } = await import("@/app/api/uploads/route");
    const mp4 = Buffer.from("\0\0\0\u0018ftypisom____avc1", "latin1");
    const jpeg = await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: "#f59e0b",
      },
    })
      .jpeg()
      .toBuffer();
    const mp4Bytes = new ArrayBuffer(mp4.byteLength);
    new Uint8Array(mp4Bytes).set(mp4);
    const jpegBytes = new ArrayBuffer(jpeg.byteLength);
    new Uint8Array(jpegBytes).set(jpeg);

    const validBody = new FormData();
    validBody.append(
      "file",
      new File([mp4Bytes], "clip.mp4", { type: "video/mp4" }),
    );
    validBody.append(
      "frame",
      new File([jpegBytes], "frame-01.jpg", { type: "image/jpeg" }),
    );
    validBody.append(
      "frame",
      new File([jpegBytes], "frame-02.jpg", { type: "image/jpeg" }),
    );
    validBody.append(
      "frameMetadata",
      JSON.stringify({ durationSeconds: 2, timestamps: [0.5, 1.5] }),
    );
    validBody.append("directPublish", "false");
    const accepted = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: validBody,
      }),
    );
    expect(accepted.status).toBe(202);
    const upload = (await accepted.json()) as { assetId: string };
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(
          process.env.MEDIA_ROOT!,
          upload.assetId,
          "frames",
          "manifest.json",
        ),
        "utf8",
      ),
    ) as { durationSeconds: number; frames: unknown[] };
    expect(manifest).toMatchObject({ durationSeconds: 2 });
    expect(manifest.frames).toHaveLength(2);

    const missingFramesBody = new FormData();
    missingFramesBody.append(
      "file",
      new File([mp4Bytes], "missing.mp4", { type: "video/mp4" }),
    );
    missingFramesBody.append("directPublish", "false");
    const rejected = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: missingFramesBody,
      }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "invalid_video_frames" },
    });
  });
});
