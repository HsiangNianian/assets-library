import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import type {
  VideoFrameManifest,
  VideoFrameUploadMetadata,
} from "@/shared/video-frames";

export function ensureStorage() {
  const { mediaRoot } = loadConfig();
  fs.mkdirSync(path.join(mediaRoot, ".tmp"), { recursive: true });
  return mediaRoot;
}

export function temporaryUploadPath(id: string) {
  return path.join(ensureStorage(), ".tmp", `${id}.upload`);
}

export function assetRelativePath(assetId: string, extension: string) {
  return path.join(assetId, `original${extension.toLowerCase()}`);
}

export function resolveMediaPath(
  relativePath: string,
  configuredRoot = loadConfig().mediaRoot,
) {
  const root = path.resolve(configuredRoot);
  fs.mkdirSync(root, { recursive: true });
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AppError("storage_error", "检测到不安全的媒体路径。", 500);
  }
  return resolved;
}

export function moveIntoAssetStorage(
  temporaryPath: string,
  assetId: string,
  extension: string,
) {
  const relativePath = assetRelativePath(assetId, extension);
  const target = resolveMediaPath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(temporaryPath, target);
  return relativePath;
}

export function storeVideoFrames(
  originalRelativePath: string,
  uploads: Array<{ temporaryPath: string; timestampSeconds: number }>,
  metadata: VideoFrameUploadMetadata,
) {
  const originalPath = resolveMediaPath(originalRelativePath);
  const frameDirectory = path.join(path.dirname(originalPath), "frames");
  fs.mkdirSync(frameDirectory, { recursive: true });
  const frames = uploads.map((upload, index) => {
    const filename = `frame-${String(index + 1).padStart(2, "0")}.jpg`;
    fs.renameSync(upload.temporaryPath, path.join(frameDirectory, filename));
    return { filename, timestampSeconds: upload.timestampSeconds };
  });
  const manifest = {
    durationSeconds: metadata.durationSeconds,
    frames,
  } satisfies VideoFrameManifest;
  const temporaryManifest = path.join(frameDirectory, "manifest.json.tmp");
  fs.writeFileSync(temporaryManifest, JSON.stringify(manifest));
  fs.renameSync(temporaryManifest, path.join(frameDirectory, "manifest.json"));
}

export function readVideoFrames(
  originalRelativePath: string,
  configuredRoot = loadConfig().mediaRoot,
) {
  const originalPath = resolveMediaPath(originalRelativePath, configuredRoot);
  const frameDirectory = path.join(path.dirname(originalPath), "frames");
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(frameDirectory, "manifest.json"), "utf8"),
    ) as VideoFrameManifest;
    if (
      !Number.isFinite(manifest.durationSeconds) ||
      manifest.durationSeconds <= 0 ||
      !Array.isArray(manifest.frames) ||
      manifest.frames.length < 1 ||
      manifest.frames.length > 5
    ) {
      throw new Error("Invalid frame manifest.");
    }
    return manifest.frames.map((frame) => {
      if (
        !/^frame-\d{2}\.jpg$/.test(frame.filename) ||
        !Number.isFinite(frame.timestampSeconds) ||
        frame.timestampSeconds < 0
      ) {
        throw new Error("Invalid frame entry.");
      }
      const absolutePath = path.resolve(frameDirectory, frame.filename);
      if (
        !absolutePath.startsWith(`${frameDirectory}${path.sep}`) ||
        !fs.existsSync(absolutePath)
      ) {
        throw new Error("Unsafe frame path.");
      }
      return { ...frame, absolutePath };
    });
  } catch {
    throw new AppError("video_frames_missing");
  }
}

export function removeAssetFiles(relativePath: string) {
  const absolutePath = resolveMediaPath(relativePath);
  const assetDirectory = path.dirname(absolutePath);
  if (fs.existsSync(assetDirectory)) {
    fs.rmSync(assetDirectory, { recursive: true, force: true });
  }
}
