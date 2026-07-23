import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";

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

export function removeAssetFiles(relativePath: string) {
  const absolutePath = resolveMediaPath(relativePath);
  const assetDirectory = path.dirname(absolutePath);
  if (fs.existsSync(assetDirectory)) {
    fs.rmSync(assetDirectory, { recursive: true, force: true });
  }
}
