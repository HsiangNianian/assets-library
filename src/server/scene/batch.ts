import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateVideoFile } from "@/server/media/video-validation";
import { extractVideoFirstFrame } from "@/server/media/video-frames";
import type { MediaTargetFormat } from "@/server/media/target-format";
import { SceneDetectClient } from "./client";
import {
  ScenePipelineError,
  type SceneSegment,
  type SceneSplitManifest,
} from "./types";

const mp4Target: MediaTargetFormat = {
  mediaType: "video",
  extension: ".mp4",
  mimeType: "video/mp4",
};

export interface PreparedSceneSegment extends SceneSegment {
  absolutePath: string;
  sizeBytes: number;
  thumbnailAbsolutePath: string;
  thumbnailSizeBytes: number;
}

export interface PreparedSceneBatch {
  batchId: string;
  serviceTaskId: string;
  parentPath: string;
  durationSeconds: number;
  workspacePath: string;
  segments: PreparedSceneSegment[];
}

export interface PrepareSceneBatchInput {
  client: SceneDetectClient;
  normalizedParentPath: string;
  originalFilename: string;
  workspaceRoot: string;
  maximumSegmentBytes: number;
  signal?: AbortSignal;
}

function oversizeSegments(
  manifest: SceneSplitManifest,
  maximumSegmentBytes: number,
) {
  return manifest.segments
    .filter((segment) => segment.sizeBytes > maximumSegmentBytes)
    .map((segment) => ({
      segmentIndex: segment.index,
      actualBytes: segment.sizeBytes,
      maximumBytes: maximumSegmentBytes,
    }));
}

/**
 * 完整准备一批视频切片。
 *
 * 原子边界截止到“所有切片均已下载、完整解码、标准化且不超过上限”。任一
 * 切片失败时会清除整批本地切片并通知分镜服务删除任务，不会把半批结果交给
 * 后续分析或持久化阶段。
 */
export async function prepareSceneBatch(
  input: PrepareSceneBatchInput,
): Promise<PreparedSceneBatch> {
  const batchId = crypto.randomUUID();
  const workspacePath = path.join(input.workspaceRoot, batchId);
  const segmentsPath = path.join(workspacePath, "segments");
  let manifest: SceneSplitManifest | undefined;

  try {
    await fs.mkdir(segmentsPath, { recursive: true });
    manifest = await input.client.splitVideo(
      input.normalizedParentPath,
      input.originalFilename,
      input.signal,
    );

    const tooLarge = oversizeSegments(manifest, input.maximumSegmentBytes);
    if (tooLarge.length > 0) {
      throw new ScenePipelineError(
        "scene_segment_too_large",
        `${tooLarge.length} 个视频切片超过 10 MiB 限制，父视频整批不入库。`,
        { segments: tooLarge },
      );
    }

    const downloaded: PreparedSceneSegment[] = [];
    const invalid: Array<Record<string, unknown>> = [];
    for (const segment of manifest.segments) {
      const absolutePath = path.join(
        segmentsPath,
        `segment-${String(segment.index).padStart(3, "0")}.mp4`,
      );
      try {
        const download = await input.client.downloadSegment(
          manifest,
          segment,
          absolutePath,
          input.maximumSegmentBytes,
          input.signal,
        );
        const validated = await validateVideoFile(
          absolutePath,
          mp4Target,
          download.sizeBytes,
          input.maximumSegmentBytes,
        );
        const thumbnailAbsolutePath = path.join(
          segmentsPath,
          `thumbnail-${String(segment.index).padStart(3, "0")}.jpg`,
        );
        const thumbnail = await extractVideoFirstFrame(
          absolutePath,
          thumbnailAbsolutePath,
        );
        downloaded.push({
          ...segment,
          absolutePath,
          sizeBytes: validated.sizeBytes,
          thumbnailAbsolutePath,
          thumbnailSizeBytes: thumbnail.sizeBytes,
        });
      } catch (error) {
        invalid.push({
          segmentIndex: segment.index,
          code:
            error instanceof ScenePipelineError
              ? error.code
              : "scene_segment_invalid",
          message: error instanceof Error ? error.message : "未知切片错误",
          details:
            error instanceof ScenePipelineError ? error.details : undefined,
        });
      }
    }
    if (invalid.length > 0) {
      throw new ScenePipelineError(
        "scene_segment_invalid",
        `${invalid.length} 个视频切片损坏、下载不完整或不符合媒体要求，父视频整批不入库。`,
        { segments: invalid },
      );
    }

    return {
      batchId,
      serviceTaskId: manifest.taskId,
      parentPath: input.normalizedParentPath,
      durationSeconds: manifest.durationSeconds,
      workspacePath,
      segments: downloaded,
    };
  } catch (error) {
    await fs.rm(workspacePath, { recursive: true, force: true });
    if (manifest) await input.client.deleteTask(manifest.taskId, input.signal);
    throw error;
  }
}

/** 成功持久化或主动放弃批次后，立即删除本地切片和分镜服务副本。 */
export async function cleanupPreparedSceneBatch(
  batch: Pick<PreparedSceneBatch, "serviceTaskId" | "workspacePath">,
  client: SceneDetectClient,
  signal?: AbortSignal,
) {
  const [remoteDeleted] = await Promise.all([
    client.deleteTask(batch.serviceTaskId, signal),
    fs.rm(batch.workspacePath, { recursive: true, force: true }),
  ]);
  return { remoteDeleted };
}
