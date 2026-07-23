import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import type { MediaType } from "@/shared/contracts";

export interface ValidatedMedia {
  mediaType: MediaType;
  mimeType: string;
  extension: ".jpg" | ".jpeg" | ".png" | ".webp" | ".mp4";
}

const acceptedImages = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function detectImageSignature(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function validateH264Mp4(filePath: string) {
  const descriptor = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await descriptor.read(header, 0, header.length, 0);
    if (
      bytesRead < 12 ||
      header.subarray(4, 8).toString("ascii") !== "ftyp"
    ) {
      throw new AppError("corrupt_file");
    }
  } finally {
    await descriptor.close();
  }

  let carry = Buffer.alloc(0);
  let h264 = false;
  let unsupported = false;
  for await (const chunk of fs.createReadStream(filePath)) {
    const bytes = Buffer.concat([carry, chunk as Buffer]);
    const text = bytes.toString("latin1");
    h264 ||= text.includes("avc1") || text.includes("avc3");
    unsupported ||=
      text.includes("hvc1") ||
      text.includes("hev1") ||
      text.includes("vp09") ||
      text.includes("av01");
    carry = bytes.subarray(Math.max(0, bytes.length - 8));
  }
  if (!h264 || unsupported) {
    throw new AppError("unsupported_video_codec");
  }
}

export async function validateMediaFile(
  filePath: string,
  filename: string,
  declaredMime: string,
  sizeBytes: number,
): Promise<ValidatedMedia> {
  const config = loadConfig();
  const extension = path.extname(filename).toLowerCase();
  const imageMime = acceptedImages.get(extension);

  if (imageMime) {
    if (sizeBytes > config.MAX_IMAGE_BYTES) {
      throw new AppError(
        "file_too_large",
        `图片不得超过 ${Math.round(config.MAX_IMAGE_BYTES / 1024 / 1024)} MB。`,
      );
    }
    if (declaredMime !== imageMime) throw new AppError("unsupported_media_type");
    const descriptor = await fs.promises.open(filePath, "r");
    const signature = Buffer.alloc(16);
    await descriptor.read(signature, 0, signature.length, 0);
    await descriptor.close();
    if (detectImageSignature(signature) !== imageMime) {
      throw new AppError("corrupt_file");
    }
    try {
      const metadata = await sharp(filePath, { failOn: "error" }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    } catch {
      throw new AppError("corrupt_file");
    }
    return {
      mediaType: "image",
      mimeType: imageMime,
      extension: extension as ValidatedMedia["extension"],
    };
  }

  if (extension === ".mp4" && declaredMime === "video/mp4") {
    if (sizeBytes > config.MAX_VIDEO_BYTES) {
      throw new AppError(
        "file_too_large",
        `视频不得超过 ${Math.round(config.MAX_VIDEO_BYTES / 1024 / 1024)} MB。`,
      );
    }
    await validateH264Mp4(filePath);
    return { mediaType: "video", mimeType: "video/mp4", extension: ".mp4" };
  }

  throw new AppError("unsupported_media_type");
}
