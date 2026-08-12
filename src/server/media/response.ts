import fs from "node:fs";
import { Readable } from "node:stream";
import { AppError } from "@/server/errors";
import { resolveMediaPath } from "@/server/media/storage";
import { getAssetRecord } from "@/server/repositories/assets";

const mediaReadyFailureCodes = new Set([
  "invalid_video_frames",
  "model_not_configured",
  "model_video_unsupported",
  "video_frames_missing",
  "model_request_failed",
  "model_response_invalid",
]);

function mediaIsReady(asset: NonNullable<ReturnType<typeof getAssetRecord>>) {
  if (
    asset.processingStatus === "analyzing" ||
    asset.processingStatus === "completed"
  ) {
    return true;
  }
  return (
    asset.processingStatus === "failed" &&
    Boolean(asset.failureCode && mediaReadyFailureCodes.has(asset.failureCode))
  );
}

export function mediaResponse(assetId: string, request: Request) {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.reviewStatus === "deleted") {
    throw new AppError("invalid_request", "素材不存在。", 404);
  }
  if (!mediaIsReady(asset)) {
    throw new AppError(
      "invalid_request",
      "素材完成校验和分析后才可预览或下载。",
      409,
    );
  }
  const filePath = resolveMediaPath(asset.originalPath);
  if (!fs.existsSync(filePath)) {
    throw new AppError("storage_error", "媒体文件不存在。", 404);
  }
  const size = fs.statSync(filePath).size;
  const range = request.headers.get("range");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.originalFilename)}`,
  };
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const end = match[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(
    Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream,
    {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    },
  );
}
