import crypto from "node:crypto";
import fs from "node:fs";
import { AppError } from "@/server/errors";
import { runMediaCommand } from "./ffmpeg";
import { temporaryUploadPath } from "./storage";
import { MAX_VIDEO_FRAMES, videoFrameTimestamps, type VideoFrameUploadMetadata } from "@/shared/video-frames";

async function run(command: "ffmpeg" | "ffprobe", args: string[]) {
  return runMediaCommand(
    command,
    args,
    new AppError(
      "invalid_video_frames",
      "服务端无法提取视频关键帧，请确认视频可正常播放。",
    ),
  );
}

export async function extractVideoFrames(inputPath: string): Promise<{
  uploads: Array<{ temporaryPath: string; timestampSeconds: number }>;
  metadata: VideoFrameUploadMetadata;
}> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath]);
  const durationSeconds = Number.parseFloat(stdout.trim());
  let timestamps: number[];
  try {
    timestamps = videoFrameTimestamps(durationSeconds);
  } catch {
    throw new AppError("invalid_video_frames", "无法读取视频时长，请确认视频可正常播放。");
  }
  if (timestamps.length > MAX_VIDEO_FRAMES) throw new AppError("invalid_video_frames");
  const uploads: Array<{ temporaryPath: string; timestampSeconds: number }> = [];
  try {
    for (const timestampSeconds of timestamps) {
      const temporaryPath = temporaryUploadPath(crypto.randomUUID());
      uploads.push({ temporaryPath, timestampSeconds });
      await run("ffmpeg", ["-v", "error", "-ss", String(timestampSeconds), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-f", "image2", "-y", temporaryPath]);
      if (!fs.existsSync(temporaryPath) || fs.statSync(temporaryPath).size === 0) throw new AppError("invalid_video_frames");
    }
    return { uploads, metadata: { durationSeconds, timestamps } };
  } catch (error) {
    for (const frame of uploads) {
      try { fs.rmSync(frame.temporaryPath, { force: true }); } catch { /* best effort */ }
    }
    throw error;
  }
}
