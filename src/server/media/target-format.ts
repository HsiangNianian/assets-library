import path from "node:path";
import type { MediaType } from "@/shared/contracts";

export type StoredMediaExtension =
  | ".jpg"
  | ".jpeg"
  | ".png"
  | ".webp"
  | ".mp4";

export interface MediaTargetFormat {
  mediaType: MediaType;
  extension: StoredMediaExtension;
  mimeType: string;
}

const imageTargets = new Map<string, MediaTargetFormat>([
  [
    ".jpg",
    { mediaType: "image", extension: ".jpg", mimeType: "image/jpeg" },
  ],
  [
    ".jpeg",
    { mediaType: "image", extension: ".jpeg", mimeType: "image/jpeg" },
  ],
  [
    ".png",
    { mediaType: "image", extension: ".png", mimeType: "image/png" },
  ],
  [
    ".webp",
    { mediaType: "image", extension: ".webp", mimeType: "image/webp" },
  ],
]);

export function targetFormatFromFilename(
  filename: string,
): MediaTargetFormat | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".mp4") {
    return { mediaType: "video", extension: ".mp4", mimeType: "video/mp4" };
  }
  return imageTargets.get(extension) ?? null;
}
