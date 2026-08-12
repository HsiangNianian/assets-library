import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { AppError } from "@/server/errors";
import type { MultimodalAnalyzer } from "@/server/model/analyzer";

const execFileAsync = promisify(execFile);
const unexpectedAnalyzer: MultimodalAnalyzer = {
  async analyze() {
    throw new Error("Analyzer must not run for invalid media.");
  },
};

function fileBytes(buffer: Buffer) {
  const bytes = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(bytes).set(buffer);
  return bytes;
}

async function probeVideo(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=format_name:stream=codec_name,pix_fmt",
    "-of",
    "json",
    filePath,
  ]);
  return JSON.parse(stdout) as {
    format: { format_name: string };
    streams: Array<{ codec_name: string; pix_fmt: string }>;
  };
}

describe("renamed media upload", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "renamed-media-"));
    process.env.DATABASE_PATH = path.join(directory, "assets.db");
    process.env.MEDIA_ROOT = path.join(directory, "media");
    process.env.EMBEDDING_MODEL = "";
    const { initializeDatabase } = await import("@/server/db/migrations");
    initializeDatabase(process.env.DATABASE_PATH).sqlite.close();
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("stores JPEG content renamed as PNG as a real PNG asset", async () => {
    const jpeg = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: "#16a34a",
      },
    })
      .jpeg()
      .toBuffer();
    const body = new FormData();
    body.append(
      "file",
      new File([fileBytes(jpeg)], "renamed.png", { type: "image/jpeg" }),
    );
    body.append("directPublish", "false");
    const { POST } = await import("@/app/api/uploads/images/route");

    const response = await POST(
      new Request("http://localhost/api/uploads/images", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(202);
    const accepted = (await response.json()) as {
      assetId: string;
      uploadId: string;
    };
    const [repository, processing, storage, media, database, schema] =
      await Promise.all([
        import("@/server/repositories/assets"),
        import("@/server/services/processing"),
        import("@/server/media/storage"),
        import("@/server/media/response"),
        import("@/server/db"),
        import("@/server/db/schema"),
      ]);
    const queuedAsset = repository.getAssetRecord(accepted.assetId)!;
    expect(queuedAsset).toMatchObject({
      originalFilename: "renamed.png",
      mimeType: "image/png",
    });
    expect(queuedAsset.originalPath).toMatch(/\/original\.png$/);
    expect(
      database.db
        .select({ declaredMime: schema.uploadRequests.declaredMime })
        .from(schema.uploadRequests)
        .where(eq(schema.uploadRequests.id, accepted.uploadId))
        .get(),
    ).toEqual({ declaredMime: "image/jpeg" });
    expect(() =>
      media.mediaResponse(
        accepted.assetId,
        new Request("http://localhost/api/media/download"),
      ),
    ).toThrowError("素材完成校验和分析后才可预览或下载。");

    let analyzedMime = "";
    const analyzer: MultimodalAnalyzer = {
      async analyze(input) {
        analyzedMime = input.mimeType;
        return {
          result: {
            kind: "image",
            description: "绿色测试图片",
            tags: {
              scene: [],
              object: ["图片"],
              person: [],
              style: [],
              color_composition: ["绿色"],
            },
            ocr: { text: null, unavailableReason: "无文字" },
          },
          model: {
            protocol: "openai_chat_completions",
            name: "test-vlm",
          },
        };
      },
    };
    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(accepted.assetId);
    await processing.processJob(job!, analyzer);

    const detail = repository.getAssetDetail(accepted.assetId);
    const storedPath = storage.resolveMediaPath(queuedAsset.originalPath);
    expect(detail).toMatchObject({
      originalFilename: "renamed.png",
      mimeType: "image/png",
      processingStatus: "completed",
    });
    expect(analyzedMime).toBe("image/png");
    expect((await sharp(storedPath).metadata()).format).toBe("png");
    expect((await fs.stat(storedPath)).size).toBe(detail.sizeBytes);

    const downloaded = media.mediaResponse(
      accepted.assetId,
      new Request("http://localhost/api/media/download?download=1"),
    );
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("content-disposition")).toContain(
      "renamed.png",
    );
    const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
    expect(Number(downloaded.headers.get("content-length"))).toBe(
      downloadedBytes.byteLength,
    );
    expect((await sharp(downloadedBytes).metadata()).format).toBe("png");
  });

  it("stores a non-H.264 video renamed as MP4 as a real H.264 MP4 asset", async () => {
    const sourcePath = path.join(directory, "source.avi");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=purple:s=16x16:d=0.5",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      "-f",
      "avi",
      "-y",
      sourcePath,
    ]);
    const body = new FormData();
    body.append(
      "file",
      new File([fileBytes(await fs.readFile(sourcePath))], "renamed.mp4", {
        type: "video/x-msvideo",
      }),
    );
    body.append("directPublish", "false");
    const { POST } = await import("@/app/api/uploads/videos/route");

    const response = await POST(
      new Request("http://localhost/api/uploads/videos", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(202);
    const accepted = (await response.json()) as {
      assetId: string;
      uploadId: string;
    };
    const [repository, processing, storage, media, database, schema] =
      await Promise.all([
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
      import("@/server/media/storage"),
      import("@/server/media/response"),
      import("@/server/db"),
      import("@/server/db/schema"),
    ]);
    const queuedAsset = repository.getAssetRecord(accepted.assetId)!;
    expect(queuedAsset).toMatchObject({
      originalFilename: "renamed.mp4",
      mimeType: "video/mp4",
    });
    expect(queuedAsset.originalPath).toMatch(/\/original\.mp4$/);
    expect(
      database.db
        .select({ declaredMime: schema.uploadRequests.declaredMime })
        .from(schema.uploadRequests)
        .where(eq(schema.uploadRequests.id, accepted.uploadId))
        .get(),
    ).toEqual({ declaredMime: "video/x-msvideo" });

    let analyzedMime = "";
    const analyzer: MultimodalAnalyzer = {
      async analyze(input) {
        analyzedMime = input.mimeType;
        return {
          result: {
            kind: "video",
            description: "紫色视频",
            topics: ["测试"],
            tags: { scene: [], person: [], form: ["视频"] },
            visualSegments: [
              { startSeconds: 0, endSeconds: 0.5, summary: "紫色画面" },
            ],
            keyMoments: [{ seconds: 0.25, summary: "紫色画面" }],
            timeline: [
              { startSeconds: 0, endSeconds: 0.5, summary: "完整视频" },
            ],
          },
          model: {
            protocol: "openai_chat_completions",
            name: "test-vlm",
          },
        };
      },
    };
    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(accepted.assetId);
    await processing.processJob(job!, analyzer);

    const detail = repository.getAssetDetail(accepted.assetId);
    const storedPath = storage.resolveMediaPath(queuedAsset.originalPath);
    const storedBytes = await fs.readFile(storedPath);
    const probe = await probeVideo(storedPath);
    expect(detail).toMatchObject({
      originalFilename: "renamed.mp4",
      mimeType: "video/mp4",
      processingStatus: "completed",
    });
    expect(analyzedMime).toBe("video/mp4");
    expect(probe.format.format_name.split(",")).toContain("mp4");
    expect(probe.streams[0]).toMatchObject({
      codec_name: "h264",
      pix_fmt: "yuv420p",
    });
    expect(storedBytes.byteLength).toBe(detail.sizeBytes);

    const downloaded = media.mediaResponse(
      accepted.assetId,
      new Request("http://localhost/api/media/download?download=1"),
    );
    expect(downloaded.headers.get("content-type")).toBe("video/mp4");
    expect(downloaded.headers.get("content-disposition")).toContain(
      "renamed.mp4",
    );
    const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
    expect(Number(downloaded.headers.get("content-length"))).toBe(
      downloadedBytes.byteLength,
    );
    expect(downloadedBytes.byteLength).toBe(detail.sizeBytes);
  });

  it("persists an actionable failure for an unreadable renamed image", async () => {
    const body = new FormData();
    body.append(
      "file",
      new File([new TextEncoder().encode("not an image")], "broken.png", {
        type: "image/png",
      }),
    );
    const { POST } = await import("@/app/api/uploads/images/route");
    const response = await POST(
      new Request("http://localhost/api/uploads/images", {
        method: "POST",
        body,
      }),
    );
    const accepted = (await response.json()) as { assetId: string };
    const [repository, processing] = await Promise.all([
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
    ]);

    expect(response.status).toBe(202);
    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(accepted.assetId);
    await processing.processJob(job!, unexpectedAnalyzer);

    expect(repository.getAssetDetail(accepted.assetId)).toMatchObject({
      processingStatus: "failed",
      failureCode: "corrupt_file",
      failureMessage:
        "图片已损坏、无法读取，或不是可转换的 JPEG、PNG、WebP 图片。",
    });
  });

  it("persists normalized video metadata before downstream frame failure", async () => {
    const sourcePath = path.join(directory, "frame-failure-source.avi");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=orange:s=16x16:d=0.5",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      "-f",
      "avi",
      "-y",
      sourcePath,
    ]);
    const body = new FormData();
    body.append(
      "file",
      new File(
        [fileBytes(await fs.readFile(sourcePath))],
        "frame-failure.mp4",
        { type: "video/x-msvideo" },
      ),
    );
    const { POST } = await import("@/app/api/uploads/videos/route");
    const response = await POST(
      new Request("http://localhost/api/uploads/videos", {
        method: "POST",
        body,
      }),
    );
    const accepted = (await response.json()) as { assetId: string };
    const [repository, processing, storage] = await Promise.all([
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
      import("@/server/media/storage"),
    ]);
    const queuedAsset = repository.getAssetRecord(accepted.assetId)!;
    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(accepted.assetId);

    await processing.processJob(
      job!,
      unexpectedAnalyzer,
      undefined,
      async () => {
        throw new AppError(
          "invalid_video_frames",
          "转换成功，但测试关键帧提取失败。",
        );
      },
    );

    const storedPath = storage.resolveMediaPath(queuedAsset.originalPath);
    const detail = repository.getAssetDetail(accepted.assetId);
    expect(detail).toMatchObject({
      processingStatus: "failed",
      failureCode: "invalid_video_frames",
      failureMessage: "转换成功，但测试关键帧提取失败。",
    });
    expect(detail.sizeBytes).toBe((await fs.stat(storedPath)).size);
    expect((await probeVideo(storedPath)).streams[0]).toMatchObject({
      codec_name: "h264",
      pix_fmt: "yuv420p",
    });
  });

  it("persists an actionable failure for an unreadable renamed video", async () => {
    const body = new FormData();
    body.append(
      "file",
      new File([new TextEncoder().encode("not a video")], "broken.mp4", {
        type: "video/mp4",
      }),
    );
    const { POST } = await import("@/app/api/uploads/videos/route");
    const response = await POST(
      new Request("http://localhost/api/uploads/videos", {
        method: "POST",
        body,
      }),
    );
    const accepted = (await response.json()) as { assetId: string };
    const [repository, processing] = await Promise.all([
      import("@/server/repositories/assets"),
      import("@/server/services/processing"),
    ]);

    expect(response.status).toBe(202);
    const job = repository.claimNextJob();
    expect(job?.assetId).toBe(accepted.assetId);
    await processing.processJob(job!, unexpectedAnalyzer);

    expect(repository.getAssetDetail(accepted.assetId)).toMatchObject({
      processingStatus: "failed",
      failureCode: "corrupt_file",
      failureMessage:
        "视频已损坏、没有可解码画面，或不是受支持的本地视频文件。",
    });
  });
});
