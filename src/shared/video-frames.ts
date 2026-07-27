export const MAX_VIDEO_FRAMES = 5;

export interface VideoFrameUploadMetadata {
  durationSeconds: number;
  timestamps: number[];
}

export interface StoredVideoFrame {
  filename: string;
  timestampSeconds: number;
}

export interface VideoFrameManifest {
  durationSeconds: number;
  frames: StoredVideoFrame[];
}

export function videoFrameTimestamps(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Video duration must be a positive finite number.");
  }
  const count = Math.min(
    MAX_VIDEO_FRAMES,
    Math.max(1, Math.ceil(durationSeconds)),
  );
  return Array.from({ length: count }, (_, index) =>
    Number(
      (((index + 0.5) / count) * durationSeconds).toFixed(3),
    ),
  );
}
