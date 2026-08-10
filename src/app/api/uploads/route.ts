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
  temporaryUploadPath,
} from "@/server/media/storage";
import { createAsset } from "@/server/repositories/assets";
import type { MediaType } from "@/shared/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParsedUpload {
  temporaryPath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  directPublish: boolean;
}

function storageError() {
  return new AppError("storage_error", undefined, 500);
}

function removeTemporaryFile(pathToRemove: string) {
  try {
    fs.rmSync(pathToRemove, { force: true });
  } catch {
    // The original upload error is more actionable than cleanup failures.
  }
}

function parseMultipart(
  request: Request,
  maximumBytes: number,
): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AppError("invalid_request", "请求必须使用 multipart/form-data。");
  }
  if (!request.body) throw new AppError("invalid_request");

  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fileSize: maximumBytes,
      },
    });
    let temporaryPath = "";
    let filename = "";
    let mimeType = "";
    let sizeBytes = 0;
    let directPublish = false;
    const fileWrites: Promise<void>[] = [];
    const outputs: fs.WriteStream[] = [];
    let parseError: Error | null = null;
    let finalizing = false;
    const fail = (error: Error) => {
      parseError ??= error;
    };
    const finish = async () => {
      if (finalizing) return;
      finalizing = true;
      if ((await Promise.allSettled(fileWrites)).some((result) => result.status === "rejected")) {
        fail(storageError());
      }
      if (parseError || !temporaryPath || !filename || sizeBytes === 0) {
        removeTemporaryFile(temporaryPath);
        reject(parseError ?? new AppError("invalid_request", "请选择一个非空文件。"));
        return;
      }
      resolve({ temporaryPath, filename, mimeType, sizeBytes, directPublish });
    };

    busboy.on("field", (name, value) => {
      if (name === "directPublish") {
        directPublish = value === "true";
      } else {
        fail(new AppError("invalid_request", "不支持额外的表单字段。"));
      }
    });
    busboy.on("file", (name, stream, info) => {
      if (name !== "file" || temporaryPath) {
        stream.resume();
        fail(new AppError(name === "file" ? "multiple_files" : "invalid_request"));
        return;
      }
      try {
        temporaryPath = temporaryUploadPath(crypto.randomUUID());
        const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
        outputs.push(output);
        fileWrites.push(new Promise<void>((resolveWrite, rejectWrite) => {
          output.on("finish", resolveWrite);
          output.on("error", () => rejectWrite(storageError()));
          stream.on("error", () => rejectWrite(storageError()));
        }));
        filename = path.basename(info.filename);
        mimeType = info.mimeType;
        stream.on("data", (chunk: Buffer) => { sizeBytes += chunk.length; });
        stream.on("limit", () => fail(new AppError("file_too_large")));
        stream.pipe(output);
      } catch {
        stream.resume();
        fail(storageError());
      }
    });
    busboy.on("filesLimit", () => fail(new AppError("multiple_files")));
    busboy.on("error", () => {
      fail(new AppError("invalid_request"));
      for (const output of outputs) output.destroy();
      void finish();
    });
    busboy.on("finish", () => { void finish(); });
    const source = Readable.fromWeb(request.body as never);
    source.on("error", () => {
      fail(new AppError("invalid_request"));
      for (const output of outputs) output.destroy();
      void finish();
    });
    source.pipe(busboy);
  });
}

function uploadExtension(
  filename: string,
  declaredMime: string,
  expectedMediaType: MediaType,
) {
  const extension = path.extname(filename).toLowerCase();
  if (expectedMediaType === "video") {
    if (extension !== ".mp4" || declaredMime !== "video/mp4") {
      throw new AppError(
        "unsupported_media_type",
        "视频接口仅接受 H.264 MP4 视频。",
      );
    }
    return extension;
  }
  const imageTypes = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
  ]);
  if (imageTypes.get(extension) !== declaredMime) {
    throw new AppError("unsupported_media_type", "图片接口仅接受 JPEG、PNG 、jpg或 WebP 图片。");
  }
  return extension;
}

async function handleUpload(request: Request, expectedMediaType: MediaType) {
  let parsed: ParsedUpload | null = null;
  let storedPath: string | null = null;
  try {
    const config = loadConfig();
    parsed = await parseMultipart(
      request,
      expectedMediaType === "image"
        ? config.MAX_IMAGE_BYTES
        : config.MAX_VIDEO_BYTES,
    );
    const extension = uploadExtension(
      parsed.filename,
      parsed.mimeType,
      expectedMediaType,
    );
    const assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    storedPath = moveIntoAssetStorage(parsed.temporaryPath, assetId, extension);
    const name = path.basename(parsed.filename, path.extname(parsed.filename)).trim() || "未命名素材";
    const status = createAsset({
      assetId, uploadId, name: name.slice(0, 255), originalFilename: parsed.filename,
      originalPath: storedPath, mimeType: parsed.mimeType, declaredMime: parsed.mimeType,
      mediaType: expectedMediaType, sizeBytes: parsed.sizeBytes, directPublish: parsed.directPublish,
    });
    return Response.json(status, { status: 202 });
  } catch (error) {
    if (parsed?.temporaryPath) removeTemporaryFile(parsed.temporaryPath);
    if (storedPath) {
      try { removeAssetFiles(storedPath); } catch { /* preserve upload error */ }
    }
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/uploads/images") return handleUpload(request, "image");
  if (pathname === "/api/uploads/videos") return handleUpload(request, "video");
  return errorResponse(new AppError("invalid_request", "请使用 /api/uploads/images 或 /api/uploads/videos。"));
}
