import crypto from "node:crypto";
import fs from "node:fs";
import { AppError } from "@/server/errors";
import type { MediaType } from "@/shared/contracts";
import type { StoredMediaExtension } from "./target-format";

export interface ValidatedMedia {
  mediaType: MediaType;
  mimeType: string;
  extension: StoredMediaExtension;
  sizeBytes: number;
}

export interface MediaSizeLimit {
  mediaLabel: "图片" | "视频";
  maximumBytes: number;
}

const normalizedOutputLimitDetectionRatio = 0.9;

function fileTooLargeError(
  limit: MediaSizeLimit,
  phase: "source" | "normalized",
) {
  const subject =
    phase === "normalized" ? `转换后的${limit.mediaLabel}` : limit.mediaLabel;
  return new AppError(
    "file_too_large",
    `${subject}不得超过 ${Math.round(limit.maximumBytes / 1024 / 1024)} MB。`,
  );
}

export async function mediaSize(filePath: string) {
  try {
    return (await fs.promises.stat(filePath)).size;
  } catch {
    throw new AppError("storage_error");
  }
}

export async function mediaSizeOrZero(filePath: string) {
  return fs.promises
    .stat(filePath)
    .then((stat) => stat.size)
    .catch(() => 0);
}

export function assertSourceMediaSize(
  sizeBytes: number,
  limit: MediaSizeLimit,
) {
  if (sizeBytes === 0) throw new AppError("corrupt_file");
  if (sizeBytes > limit.maximumBytes) {
    throw fileTooLargeError(limit, "source");
  }
}

function assertNormalizedMediaSize(
  sizeBytes: number,
  limit: MediaSizeLimit,
) {
  if (sizeBytes === 0) throw new AppError("corrupt_file");
  if (sizeBytes > limit.maximumBytes) {
    throw fileTooLargeError(limit, "normalized");
  }
}

export function throwIfNormalizedOutputLikelyReachedLimit(
  sizeBytes: number,
  limit: MediaSizeLimit,
) {
  if (sizeBytes >= limit.maximumBytes * normalizedOutputLimitDetectionRatio) {
    throw fileTooLargeError(limit, "normalized");
  }
}

export async function replaceWithNormalizedMedia(
  filePath: string,
  limit: MediaSizeLimit,
  writeNormalized: (temporaryPath: string) => Promise<void>,
  validateNormalized?: (
    temporaryPath: string,
    normalizedSize: number,
  ) => Promise<void>,
) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.normalized`;
  try {
    await writeNormalized(temporaryPath);
    const normalizedSize = await mediaSize(temporaryPath);
    assertNormalizedMediaSize(normalizedSize, limit);
    await validateNormalized?.(temporaryPath, normalizedSize);
    try {
      await fs.promises.rename(temporaryPath, filePath);
    } catch {
      throw new AppError("storage_error");
    }
    return normalizedSize;
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
