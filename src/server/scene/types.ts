/** 分镜服务返回的单个视频切片。 */
export interface SceneSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  startFrame: number;
  endFrame: number;
  sizeBytes: number;
  filename: string;
  downloadUrl: string;
}

/** 分镜服务同步完成检测和切割后返回的清单。 */
export interface SceneSplitManifest {
  taskId: string;
  originalFilename: string;
  durationSeconds: number;
  sceneCount: number;
  segments: SceneSegment[];
}

export type ScenePipelineFailureCode =
  | "scene_service_unavailable"
  | "scene_detection_failed"
  | "scene_manifest_invalid"
  | "scene_segment_download_failed"
  | "scene_segment_invalid"
  | "scene_segment_too_large"
  | "scene_persistence_failed";

/**
 * 分镜链路的结构化错误。
 *
 * `details` 会保留失败切片的序号、实际大小和限制等信息，API 层可以直接
 * 将其写入任务详情，不需要解析中文错误文案。
 */
export class ScenePipelineError extends Error {
  constructor(
    public readonly code: ScenePipelineFailureCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScenePipelineError";
  }
}
