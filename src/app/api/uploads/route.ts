import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { loadConfig } from "@/server/config";
import { AppError, errorResponse } from "@/server/errors";
import {
  moveIntoAssetStorage,
  removeAssetFiles,
  storeVideoFrames,
  temporaryUploadPath,
} from "@/server/media/storage";
import { validateMediaFile } from "@/server/media/validate";
import { createAsset } from "@/server/repositories/assets";
import {
  MAX_VIDEO_FRAMES,
  videoFrameTimestamps,
  type VideoFrameUploadMetadata,
} from "@/shared/video-frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParsedUpload {
  temporaryPath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  directPublish: boolean;
  frames: Array<{
    temporaryPath: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  frameMetadata: string;
}

function parseMultipart(request: Request): Promise<ParsedUpload> {
  const config = loadConfig();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AppError("invalid_request", "请求必须使用 multipart/form-data。");
  }
  if (!request.body) throw new AppError("invalid_request");

  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      defParamCharset: "utf8",
      limits: { files: MAX_VIDEO_FRAMES + 1, fileSize: config.MAX_VIDEO_BYTES },
    });
    let temporaryPath = "";
    let filename = "";
    let mimeType = "";
    let sizeBytes = 0;
    let directPublish = false;
    let frameMetadata = "";
    const frames: ParsedUpload["frames"] = [];
    const temporaryPaths: string[] = [];
    const fileWrites: Promise<void>[] = [];
    let parseError: Error | null = null;

    const fail = (error: Error) => {
      parseError ??= error;
    };

    busboy.on("field", (name, value) => {
      if (name === "directPublish") directPublish = value === "true";
      if (name === "frameMetadata") frameMetadata = value;
    });

    busboy.on("file", (name, stream, info) => {
      if (name !== "file" && name !== "frame") {
        stream.resume();
        fail(new AppError("invalid_request"));
        return;
      }
      if (name === "file" && temporaryPath) {
        stream.resume();
        fail(new AppError("multiple_files"));
        return;
      }
      if (name === "frame" && frames.length >= MAX_VIDEO_FRAMES) {
        stream.resume();
        fail(new AppError("invalid_video_frames"));
        return;
      }

      const nextTemporaryPath = temporaryUploadPath(crypto.randomUUID());
      temporaryPaths.push(nextTemporaryPath);
      const output = fs.createWriteStream(nextTemporaryPath, { flags: "wx" });
      const write = new Promise<void>((resolveWrite, rejectWrite) => {
        output.on("finish", resolveWrite);
        output.on("error", rejectWrite);
        stream.on("error", rejectWrite);
      });
      fileWrites.push(write);

      if (name === "file") {
        temporaryPath = nextTemporaryPath;
        filename = path.basename(info.filename);
        mimeType = info.mimeType;
      } else {
        frames.push({
          temporaryPath: nextTemporaryPath,
          mimeType: info.mimeType,
          sizeBytes: 0,
        });
      }
      const frame = name === "frame" ? frames.at(-1) : null;
      stream.on("data", (chunk: Buffer) => {
        if (frame) frame.sizeBytes += chunk.length;
        else sizeBytes += chunk.length;
      });
      stream.on("limit", () => {
        fail(new AppError("file_too_large"));
      });
      stream.on("error", fail);
      output.on("error", fail);
      stream.pipe(output);
    });

    busboy.on("filesLimit", () => fail(new AppError("invalid_video_frames")));
    busboy.on("error", fail);
    busboy.on("finish", () => {
      const finish = () => {
        if (parseError || !temporaryPath || !filename || sizeBytes === 0) {
          for (const pathToRemove of temporaryPaths) {
            fs.rmSync(pathToRemove, { force: true });
          }
          reject(
            parseError ??
              new AppError("invalid_request", "请选择一个非空文件。"),
          );
          return;
        }
        resolve({
          temporaryPath,
          filename,
          mimeType,
          sizeBytes,
          directPublish,
          frames,
          frameMetadata,
        });
      };
      if (fileWrites.length === 0) {
        finish();
        return;
      }
      void Promise.allSettled(fileWrites).then((results) => {
        const rejected = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (rejected) {
          fail(
            rejected.reason instanceof Error
              ? rejected.reason
              : new Error("File write failed."),
          );
        }
        finish();
      });
    });

    Readable.fromWeb(request.body as never).pipe(busboy);
  });
}

function parseVideoFrameMetadata(
  value: string,
  frameCount: number,
): VideoFrameUploadMetadata {
  try {
    const parsed = JSON.parse(value) as VideoFrameUploadMetadata;
    const expected = videoFrameTimestamps(parsed.durationSeconds);
    if (
      !Array.isArray(parsed.timestamps) ||
      parsed.timestamps.length !== frameCount ||
      expected.length !== frameCount ||
      parsed.timestamps.some(
        (timestamp, index) =>
          !Number.isFinite(timestamp) ||
          Math.abs(timestamp - expected[index]!) > 0.01,
      )
    ) {
      throw new Error("Frame metadata does not match sampling policy.");
    }
    return parsed;
  } catch {
    throw new AppError("invalid_video_frames");
  }
}

export async function POST(request: Request) {
  let parsed: ParsedUpload | null = null;
  let storedPath: string | null = null;
  try {
    parsed = await parseMultipart(request);
    const validated = await validateMediaFile(
      parsed.temporaryPath,
      parsed.filename,
      parsed.mimeType,
      parsed.sizeBytes,
    );
    let videoFrameMetadata: VideoFrameUploadMetadata | null = null;
    if (validated.mediaType === "video") {
      videoFrameMetadata = parseVideoFrameMetadata(
        parsed.frameMetadata,
        parsed.frames.length,
      );
      for (const frame of parsed.frames) {
        const validatedFrame = await validateMediaFile(
          frame.temporaryPath,
          "frame.jpg",
          frame.mimeType,
          frame.sizeBytes,
        );
        if (validatedFrame.mimeType !== "image/jpeg") {
          throw new AppError("invalid_video_frames");
        }
      }
    } else if (parsed.frames.length > 0 || parsed.frameMetadata) {
      throw new AppError("invalid_video_frames");
    }

    const assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    storedPath = moveIntoAssetStorage(
      parsed.temporaryPath,
      assetId,
      validated.extension,
    );
    if (videoFrameMetadata) {
      storeVideoFrames(
        storedPath,
        parsed.frames.map((frame, index) => ({
          temporaryPath: frame.temporaryPath,
          timestampSeconds: videoFrameMetadata.timestamps[index]!,
        })),
        videoFrameMetadata,
      );
    }
    const name =
      path.basename(parsed.filename, path.extname(parsed.filename)).trim() ||
      "未命名素材";
    const status = createAsset({
      assetId,
      uploadId,
      name: name.slice(0, 255),
      originalFilename: parsed.filename,
      originalPath: storedPath,
      mimeType: validated.mimeType,
      declaredMime: parsed.mimeType,
      mediaType: validated.mediaType,
      sizeBytes: parsed.sizeBytes,
      directPublish: parsed.directPublish,
    });
    return Response.json(status, { status: 202 });
  } catch (error) {
    if (parsed?.temporaryPath) fs.rmSync(parsed.temporaryPath, { force: true });
    for (const frame of parsed?.frames ?? []) {
      fs.rmSync(frame.temporaryPath, { force: true });
    }
    if (storedPath) removeAssetFiles(storedPath);
    return errorResponse(error);
  }
}
