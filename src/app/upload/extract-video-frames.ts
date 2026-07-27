import {
  videoFrameTimestamps,
  type VideoFrameUploadMetadata,
} from "@/shared/video-frames";

const MAX_FRAME_EDGE = 1280;
const JPEG_QUALITY = 0.85;
const MEDIA_EVENT_TIMEOUT_MS = 15_000;

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取视频超时，请确认浏览器可以播放该 MP4。"));
    }, MEDIA_EVENT_TIMEOUT_MS);
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("浏览器无法读取该视频，请确认它是 H.264 MP4。"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("关键帧编码失败，请重新选择视频。")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

export async function extractVideoFrames(file: File): Promise<{
  frames: File[];
  metadata: VideoFrameUploadMetadata;
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForMediaEvent(video, "loadedmetadata");
    }
    const durationSeconds = video.duration;
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      throw new Error("无法读取视频时长或画面尺寸。");
    }

    const timestamps = videoFrameTimestamps(durationSeconds);
    const scale = Math.min(
      1,
      MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建视频画布。");

    const frames: File[] = [];
    for (const [index, timestamp] of timestamps.entries()) {
      const seeked = waitForMediaEvent(video, "seeked");
      video.currentTime = Math.min(timestamp, Math.max(0, durationSeconds - 0.001));
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas);
      frames.push(
        new File([blob], `frame-${String(index + 1).padStart(2, "0")}.jpg`, {
          type: "image/jpeg",
        }),
      );
    }
    return { frames, metadata: { durationSeconds, timestamps } };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
