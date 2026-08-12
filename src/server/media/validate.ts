import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { validateImageFile } from "./image-validation";
import { targetFormatFromFilename } from "./target-format";
import { mediaSize } from "./validation-size";
import { validateVideoFile } from "./video-validation";

export type { ValidatedMedia } from "./validation-size";

export async function validateMediaFile(filePath: string, filename: string) {
  const config = loadConfig();
  const target = targetFormatFromFilename(filename);
  const sizeBytes = await mediaSize(filePath);

  if (target?.mediaType === "image") {
    return validateImageFile(
      filePath,
      target,
      sizeBytes,
      config.MAX_IMAGE_BYTES,
    );
  }
  if (target?.mediaType === "video") {
    return validateVideoFile(
      filePath,
      target,
      sizeBytes,
      config.MAX_VIDEO_BYTES,
    );
  }
  throw new AppError("unsupported_media_type");
}
