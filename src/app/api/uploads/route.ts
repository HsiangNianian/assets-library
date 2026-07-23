import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { loadConfig } from "@/server/config";
import { AppError, errorResponse } from "@/server/errors";
import {
  moveIntoAssetStorage,
  resolveMediaPath,
  temporaryUploadPath,
} from "@/server/media/storage";
import { validateMediaFile } from "@/server/media/validate";
import { createAsset } from "@/server/repositories/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParsedUpload {
  temporaryPath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  directPublish: boolean;
}

function parseMultipart(request: Request): Promise<ParsedUpload> {
  const config = loadConfig();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AppError("invalid_request", "请求必须使用 multipart/form-data。");
  }
  if (!request.body) throw new AppError("invalid_request");

  return new Promise((resolve, reject) => {
    const temporaryId = crypto.randomUUID();
    const temporaryPath = temporaryUploadPath(temporaryId);
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      defParamCharset: "utf8",
      limits: { files: 2, fileSize: config.MAX_VIDEO_BYTES },
    });
    let filename = "";
    let mimeType = "";
    let sizeBytes = 0;
    let directPublish = false;
    let fileCount = 0;
    let fileWrite: Promise<void> | null = null;
    let parseError: Error | null = null;

    const fail = (error: Error) => {
      parseError ??= error;
    };

    busboy.on("field", (name, value) => {
      if (name === "directPublish") directPublish = value === "true";
    });

    busboy.on("file", (name, stream, info) => {
      fileCount += 1;
      if (name !== "file" || fileCount > 1) {
        stream.resume();
        fail(new AppError("multiple_files"));
        return;
      }
      filename = path.basename(info.filename);
      mimeType = info.mimeType;
      const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
      fileWrite = new Promise<void>((resolveWrite, rejectWrite) => {
        output.on("finish", resolveWrite);
        output.on("error", rejectWrite);
        stream.on("error", rejectWrite);
      });
      stream.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });
      stream.on("limit", () => {
        fail(
          new AppError(
            "file_too_large",
            `视频不得超过 ${Math.round(config.MAX_VIDEO_BYTES / 1024 / 1024)} MB。`,
          ),
        );
      });
      stream.on("error", fail);
      output.on("error", fail);
      stream.pipe(output);
    });

    busboy.on("filesLimit", () => fail(new AppError("multiple_files")));
    busboy.on("error", fail);
    busboy.on("finish", () => {
      const finish = () => {
        if (parseError || fileCount !== 1 || !filename || sizeBytes === 0) {
          fs.rmSync(temporaryPath, { force: true });
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
        });
      };
      if (parseError || !fileWrite) {
        finish();
        return;
      }
      void fileWrite.then(finish).catch((error: Error) => {
        fail(error);
        finish();
      });
    });

    Readable.fromWeb(request.body as never).pipe(busboy);
  });
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
    const assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    storedPath = moveIntoAssetStorage(
      parsed.temporaryPath,
      assetId,
      validated.extension,
    );
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
    if (storedPath) fs.rmSync(resolveMediaPath(storedPath), { force: true });
    return errorResponse(error);
  }
}
