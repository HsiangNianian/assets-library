import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

/** 使用同一套 FFmpeg 参数抽取单帧，并确保失败时不留下半张图片。 */
async function extractFrame(
  inputPath: string,
  outputPath: string,
  timestampSeconds?: number,
) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await run("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      ...(timestampSeconds === undefined
        ? []
        : ["-ss", String(timestampSeconds)]),
      "-i",
      inputPath,
      "-map",
      "0:V:0",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-f",
      "image2",
      "-y",
      outputPath,
    ]);
    if (!fs.existsSync(outputPath)) {
      throw new AppError("invalid_video_frames");
    }
    const sizeBytes = fs.statSync(outputPath).size;
    if (sizeBytes <= 0) throw new AppError("invalid_video_frames");
    return sizeBytes;
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw error;
  }
}

/**
 * 抽取视频的第一张可解码画面，供素材列表缩略图长期持久化。
 *
 * outputPath 由调用方放入当前分镜工作区，整批失败时可与切片一起原子清理。
 */
export async function extractVideoFirstFrame(
  inputPath: string,
  outputPath: string,
) {
  const sizeBytes = await extractFrame(inputPath, outputPath);
  return { absolutePath: outputPath, sizeBytes };
}

export async function extractVideoFrames(inputPath: string): Promise<{
  uploads: Array<{ temporaryPath: string; timestampSeconds: number }>;
  metadata: VideoFrameUploadMetadata;
}> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "V:0", "-show_entries", "stream=duration:format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath]);
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
      await extractFrame(inputPath, temporaryPath, timestampSeconds);
    }
    return { uploads, metadata: { durationSeconds, timestamps } };
  } catch (error) {
    for (const frame of uploads) {
      try { fs.rmSync(frame.temporaryPath, { force: true }); } catch { /* best effort */ }
    }
    throw error;
  }
}
