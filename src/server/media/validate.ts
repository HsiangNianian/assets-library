import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import type { MediaType } from "@/shared/contracts";
import { runMediaCommand } from "./ffmpeg";
import {
  targetFormatFromFilename,
  type StoredMediaExtension,
} from "./target-format";

export interface ValidatedMedia {
  mediaType: MediaType;
  mimeType: string;
  extension: StoredMediaExtension;
  sizeBytes: number;
}

interface ProbedVideo {
  audioCodecName: string | null;
  codecName: string;
  durationSeconds: number;
  formatNames: Set<string>;
  majorBrand: string;
  pixelFormat: string;
}

interface ProbePayload {
  format?: {
    duration?: string;
    format_name?: string;
    tags?: { major_brand?: string };
  };
  streams?: Array<{
    codec_name?: string;
    codec_type?: string;
    disposition?: { attached_pic?: number };
    duration?: string;
    height?: number;
    pix_fmt?: string;
    width?: number;
  }>;
}

const sharpFormatMime = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

// Only self-contained media containers are accepted. In particular, playlist
// and image demuxers are excluded so an uploaded file cannot make FFmpeg fetch
// remote resources or turn a renamed still image into a one-frame video.
const videoInputFormats = [
  "asf",
  "avi",
  "flv",
  "matroska",
  "webm",
  "mov",
  "mpeg",
  "mpegts",
  "mxf",
  "nut",
  "ogg",
  "rm",
].join(",");
const localMediaProtocols = "file,pipe";
const mp4MajorBrands = new Set([
  "avc1",
  "dash",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "isom",
  "m4v",
  "mp41",
  "mp42",
  "msnv",
]);

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

async function mediaSize(filePath: string) {
  try {
    return (await fs.promises.stat(filePath)).size;
  } catch {
    throw new AppError("storage_error");
  }
}

function tooLargeError(mediaLabel: "图片" | "视频", maximumBytes: number) {
  return new AppError(
    "file_too_large",
    `${mediaLabel}不得超过 ${Math.round(maximumBytes / 1024 / 1024)} MB。`,
  );
}

async function replaceWithNormalizedMedia(
  filePath: string,
  maximumBytes: number,
  mediaLabel: "图片" | "视频",
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
    if (normalizedSize === 0) throw new AppError("corrupt_file");
    if (normalizedSize > maximumBytes) {
      throw new AppError(
        "file_too_large",
        `转换后的${mediaLabel}不得超过 ${Math.round(maximumBytes / 1024 / 1024)} MB。`,
      );
    }
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

async function normalizeImageFormat(
  filePath: string,
  targetMime: string,
  maximumBytes: number,
) {
  return replaceWithNormalizedMedia(
    filePath,
    maximumBytes,
    "图片",
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

function positiveNumber(...values: Array<string | undefined>) {
  for (const value of values) {
    const number = Number.parseFloat(value ?? "");
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

async function probeVideo(filePath: string): Promise<ProbedVideo> {
  const corruptVideo = new AppError(
    "corrupt_file",
    "视频已损坏、没有可解码画面，或不是受支持的本地视频文件。",
  );
  const { stdout } = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      localMediaProtocols,
      "-format_whitelist",
      videoInputFormats,
      "-show_entries",
      "format=format_name,duration:format_tags=major_brand:stream=codec_type,codec_name,pix_fmt,width,height,duration:stream_disposition=attached_pic",
      "-of",
      "json",
      filePath,
    ],
    corruptVideo,
  );
  let payload: ProbePayload;
  try {
    payload = JSON.parse(stdout) as ProbePayload;
  } catch {
    throw corruptVideo;
  }
  const stream = payload.streams?.find(
    (candidate) =>
      candidate.codec_type === "video" &&
      candidate.disposition?.attached_pic !== 1,
  );
  const durationSeconds = positiveNumber(
    stream?.duration,
    payload.format?.duration,
  );
  if (
    !stream?.codec_name ||
    !stream.width ||
    !stream.height ||
    !durationSeconds
  ) {
    throw corruptVideo;
  }
  return {
    audioCodecName:
      payload.streams?.find((candidate) => candidate.codec_type === "audio")
        ?.codec_name ?? null,
    codecName: stream.codec_name,
    durationSeconds,
    formatNames: new Set(
      (payload.format?.format_name ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
    majorBrand: payload.format?.tags?.major_brand?.trim() ?? "",
    pixelFormat: stream.pix_fmt ?? "",
  };
}

function isBrowserCompatibleMp4(probe: ProbedVideo) {
  return (
    probe.formatNames.has("mov") &&
    mp4MajorBrands.has(probe.majorBrand.toLowerCase()) &&
    probe.codecName === "h264" &&
    probe.pixelFormat === "yuv420p" &&
    (!probe.audioCodecName || probe.audioCodecName === "aac")
  );
}

async function validateDecodedVideo(filePath: string) {
  await runMediaCommand(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-protocol_whitelist",
      localMediaProtocols,
      "-format_whitelist",
      videoInputFormats,
      "-err_detect",
      "explode",
      "-i",
      filePath,
      "-map",
      "0:V:0",
      "-an",
      "-sn",
      "-dn",
      "-f",
      "null",
      "-",
    ],
    new AppError(
      "corrupt_file",
      "视频已损坏或存在无法解码的画面，请更换文件。",
    ),
    300_000,
  );
}

function durationMatches(sourceSeconds: number, outputSeconds: number) {
  const tolerance = 0.1;
  return Math.abs(sourceSeconds - outputSeconds) <= tolerance;
}

async function normalizeVideoFormat(
  filePath: string,
  sourceProbe: ProbedVideo,
  maximumBytes: number,
) {
  const canCopyVideo =
    sourceProbe.codecName === "h264" &&
    sourceProbe.pixelFormat === "yuv420p";
  const videoCodecArgs = canCopyVideo
    ? ["-c:v", "copy"]
    : [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
      ];
  return replaceWithNormalizedMedia(
    filePath,
    maximumBytes,
    "视频",
    async (temporaryPath) => {
      try {
        await runMediaCommand(
          "ffmpeg",
          [
            "-nostdin",
            "-v",
            "error",
            "-xerror",
            "-protocol_whitelist",
            localMediaProtocols,
            "-format_whitelist",
            videoInputFormats,
            "-err_detect",
            "explode",
            "-i",
            filePath,
            "-map",
            "0:V:0",
            "-map",
            "0:a:0?",
            "-sn",
            "-dn",
            ...videoCodecArgs,
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-fs",
            String(maximumBytes),
            "-f",
            "mp4",
            "-y",
            temporaryPath,
          ],
          new AppError(
            "corrupt_file",
            "视频已损坏、没有可解码画面，或无法转换为 H.264 MP4。",
          ),
          300_000,
        );
      } catch (error) {
        const partialSize = await fs.promises
          .stat(temporaryPath)
          .then((stat) => stat.size)
          .catch(() => 0);
        if (partialSize >= maximumBytes * 0.9) {
          throw new AppError(
            "file_too_large",
            `转换后的视频不得超过 ${Math.round(maximumBytes / 1024 / 1024)} MB。`,
          );
        }
        throw error;
      }
    },
    async (temporaryPath, normalizedSize) => {
      const outputProbe = await probeVideo(temporaryPath);
      if (!isBrowserCompatibleMp4(outputProbe)) {
        throw new AppError(
          "corrupt_file",
          "视频无法转换为兼容的 H.264 MP4。",
        );
      }
      await validateDecodedVideo(temporaryPath);
      if (
        !durationMatches(
          sourceProbe.durationSeconds,
          outputProbe.durationSeconds,
        )
      ) {
        if (normalizedSize >= maximumBytes * 0.9) {
          throw new AppError(
            "file_too_large",
            `转换后的视频不得超过 ${Math.round(maximumBytes / 1024 / 1024)} MB。`,
          );
        }
        throw new AppError(
          "corrupt_file",
          "视频转换后时长不完整，请更换文件。",
        );
      }
    },
  );
}

export async function validateMediaFile(
  filePath: string,
  filename: string,
): Promise<ValidatedMedia> {
  const config = loadConfig();
  const target = targetFormatFromFilename(filename);
  const sizeBytes = await mediaSize(filePath);

  if (target?.mediaType === "image") {
    const imageMime = target.mimeType;
    if (sizeBytes === 0) throw new AppError("corrupt_file");
    if (sizeBytes > config.MAX_IMAGE_BYTES) {
      throw tooLargeError("图片", config.MAX_IMAGE_BYTES);
    }
    const descriptor = await fs.promises.open(filePath, "r");
    const signature = Buffer.alloc(16);
    try {
      await descriptor.read(signature, 0, signature.length, 0);
    } finally {
      await descriptor.close();
    }
    const detectedMime = detectImageSignature(signature);
    if (!detectedMime) {
      throw new AppError(
        "corrupt_file",
        "图片已损坏、无法读取，或不是可转换的 JPEG、PNG、WebP 图片。",
      );
    }
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
    const normalizedSize =
      detectedMime === imageMime
        ? sizeBytes
        : await normalizeImageFormat(
            filePath,
            imageMime,
            config.MAX_IMAGE_BYTES,
          );
    return {
      mediaType: "image",
      mimeType: imageMime,
      extension: target.extension,
      sizeBytes: normalizedSize,
    };
  }

  if (target?.mediaType === "video") {
    if (sizeBytes === 0) throw new AppError("corrupt_file");
    if (sizeBytes > config.MAX_VIDEO_BYTES) {
      throw tooLargeError("视频", config.MAX_VIDEO_BYTES);
    }
    const sourceProbe = await probeVideo(filePath);
    await validateDecodedVideo(filePath);
    const normalizedSize = isBrowserCompatibleMp4(sourceProbe)
      ? sizeBytes
      : await normalizeVideoFormat(
          filePath,
          sourceProbe,
          config.MAX_VIDEO_BYTES,
        );
    return {
      mediaType: "video",
      mimeType: target.mimeType,
      extension: target.extension,
      sizeBytes: normalizedSize,
    };
  }

  throw new AppError("unsupported_media_type");
}
