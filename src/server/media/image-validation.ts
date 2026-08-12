import fs from "node:fs";
import sharp from "sharp";
import { AppError } from "@/server/errors";
import type { MediaTargetFormat } from "./target-format";
import {
  assertSourceMediaSize,
  replaceWithNormalizedMedia,
  type MediaSizeLimit,
  type ValidatedMedia,
} from "./validation-size";

const sharpFormatMime = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const corruptImageMessage =
  "图片已损坏、无法读取，或不是可转换的 JPEG、PNG、WebP 图片。";

function detectImageSignature(bytes: Buffer) {
  // JPEG is identified by its two-byte SOI marker. Sharp verifies the rest of
  // the structure before the file is accepted or converted.
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
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

async function detectedImageMime(filePath: string) {
  const descriptor = await fs.promises.open(filePath, "r");
  const signature = Buffer.alloc(16);
  try {
    await descriptor.read(signature, 0, signature.length, 0);
  } finally {
    await descriptor.close();
  }
  const detectedMime = detectImageSignature(signature);
  if (!detectedMime) {
    throw new AppError("corrupt_file", corruptImageMessage);
  }
  return detectedMime;
}

async function validateDecodedImage(filePath: string, detectedMime: string) {
  try {
    const image = sharp(filePath, { failOn: "truncated" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("missing dimensions");
    }
    if (sharpFormatMime.get(metadata.format ?? "") !== detectedMime) {
      throw new AppError("corrupt_file");
    }
    // metadata() only parses the header and can accept a file whose pixel
    // payload was truncated. stats() forces a complete decode without
    // materializing the whole raw image in the Node.js heap.
    await image.stats();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("corrupt_file");
  }
}

async function normalizeImageFormat(
  filePath: string,
  targetMime: string,
  sizeLimit: MediaSizeLimit,
) {
  return replaceWithNormalizedMedia(
    filePath,
    sizeLimit,
    async (temporaryPath) => {
      try {
        let pipeline = sharp(filePath, { failOn: "truncated" }).autoOrient();
        if (targetMime === "image/jpeg") {
          pipeline = pipeline
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 95 });
        } else if (targetMime === "image/png") {
          pipeline = pipeline.png();
        } else {
          pipeline = pipeline.webp({ quality: 95 });
        }
        await pipeline.toFile(temporaryPath);
      } catch {
        throw new AppError("corrupt_file");
      }
    },
  );
}

export async function validateImageFile(
  filePath: string,
  target: MediaTargetFormat,
  sizeBytes: number,
  maximumBytes: number,
): Promise<ValidatedMedia> {
  const sizeLimit = { mediaLabel: "图片", maximumBytes } as const;
  assertSourceMediaSize(sizeBytes, sizeLimit);
  const detectedMime = await detectedImageMime(filePath);
  await validateDecodedImage(filePath, detectedMime);
  const normalizedSize =
    detectedMime === target.mimeType
      ? sizeBytes
      : await normalizeImageFormat(filePath, target.mimeType, sizeLimit);
  return {
    mediaType: "image",
    mimeType: target.mimeType,
    extension: target.extension,
    sizeBytes: normalizedSize,
  };
}
