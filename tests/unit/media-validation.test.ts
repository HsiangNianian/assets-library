import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { validateMediaFile } from "@/server/media/validate";

describe("media validation", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "asset-media-"));
    process.env.MAX_IMAGE_BYTES = String(20 * 1024 * 1024);
    process.env.MAX_VIDEO_BYTES = String(200 * 1024 * 1024);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("accepts a valid PNG image", async () => {
    const filePath = path.join(directory, "image.png");
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#00aacc",
      },
    })
      .png()
      .toFile(filePath);
    const stat = await fs.stat(filePath);
    await expect(
      validateMediaFile(filePath, "image.png", "image/png", stat.size),
    ).resolves.toMatchObject({ mediaType: "image", mimeType: "image/png" });
  });

  it("accepts a progressive JPEG with metadata", async () => {
    const filePath = path.join(directory, "downloaded.jpeg");
    await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: "#d9a066",
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ progressive: true })
      .toFile(filePath);
    const stat = await fs.stat(filePath);

    await expect(
      validateMediaFile(filePath, "downloaded.jpeg", "image/jpeg", stat.size),
    ).resolves.toMatchObject({
      mediaType: "image",
      mimeType: "image/jpeg",
      extension: ".jpeg",
    });
  });

  it("reports a renamed image as a format mismatch instead of corruption", async () => {
    const filePath = path.join(directory, "renamed.jpeg");
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#00aacc",
      },
    })
      .png()
      .toFile(filePath);
    const stat = await fs.stat(filePath);

    await expect(
      validateMediaFile(filePath, "renamed.jpeg", "image/jpeg", stat.size),
    ).rejects.toMatchObject({
      code: "unsupported_media_type",
      message:
        "文件扩展名为 .jpeg，但实际检测为PNG。请使用图片的真实扩展名后重试。",
    });
  });

  it("accepts H.264 markers and rejects HEVC markers", async () => {
    const h264Path = path.join(directory, "h264.mp4");
    const hevcPath = path.join(directory, "hevc.mp4");
    await fs.writeFile(h264Path, Buffer.from("\0\0\0\u0018ftypisom____avc1", "latin1"));
    await fs.writeFile(hevcPath, Buffer.from("\0\0\0\u0018ftypisom____hvc1", "latin1"));
    await expect(
      validateMediaFile(h264Path, "clip.mp4", "video/mp4", 20),
    ).resolves.toMatchObject({ mediaType: "video" });
    await expect(
      validateMediaFile(hevcPath, "clip.mp4", "video/mp4", 20),
    ).rejects.toMatchObject({ code: "unsupported_video_codec" });
  });

  it("rejects extension and MIME disagreement", async () => {
    const filePath = path.join(directory, "fake.png");
    await fs.writeFile(filePath, "not an image");
    await expect(
      validateMediaFile(filePath, "fake.png", "audio/mpeg", 12),
    ).rejects.toMatchObject({ code: "unsupported_media_type" });
  });
});
