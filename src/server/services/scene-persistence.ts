import crypto from "node:crypto";
import type { ObjectStorage, StoredObject } from "@/server/storage/object-storage";
import type { PreparedSceneBatch } from "@/server/scene/batch";
import { ScenePipelineError } from "@/server/scene/types";

export interface PersistedSceneSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  sizeBytes: number;
  object: StoredObject;
  thumbnailObject: StoredObject;
}

export interface PersistedSceneBatch {
  parentObject: StoredObject;
  segments: PersistedSceneSegment[];
}

export interface PersistSceneBatchInput {
  batch: PreparedSceneBatch;
  storage: ObjectStorage;
  /**
   * 必须在一个 MySQL 事务内建立父视频与全部子素材，并只在事务提交后返回。
   * 回调抛错时，本函数会补偿删除本批已经上传的所有 ZOS 对象。
   */
  commitDatabase: (batch: PersistedSceneBatch) => Promise<void>;
  now?: Date;
}

function objectPrefix(now: Date, batchId: string) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `assets/videos/${year}/${month}/${day}/${batchId}`;
}

/**
 * 将父视频和全部切片作为一个可见性原子批次持久化。
 *
 * ZOS 不支持与 MySQL 共用事务，因此这里采用“先上传不可见对象，再提交单个
 * MySQL 事务；数据库失败则反向补偿删除对象”的 Saga。数据库不会出现半批
 * 素材；极端崩溃留下的孤儿对象应由离线清理任务按 key 前缀回收。
 */
export async function persistSceneBatch(
  input: PersistSceneBatchInput,
): Promise<PersistedSceneBatch> {
  const prefix = objectPrefix(input.now ?? new Date(), input.batch.batchId);
  const uploaded: StoredObject[] = [];
  try {
    const parentObject = await input.storage.storeFile({
      key: `${prefix}/parent.mp4`,
      filePath: input.batch.parentPath,
      contentType: "video/mp4",
    });
    uploaded.push(parentObject);

    const segments: PersistedSceneSegment[] = [];
    for (const segment of input.batch.segments) {
      const object = await input.storage.storeFile({
        key: `${prefix}/segments/${String(segment.index).padStart(3, "0")}-${crypto.randomUUID()}.mp4`,
        filePath: segment.absolutePath,
        contentType: "video/mp4",
      });
      uploaded.push(object);
      const thumbnailObject = await input.storage.storeFile({
        key: `${prefix}/thumbnails/${String(segment.index).padStart(3, "0")}-${crypto.randomUUID()}.jpg`,
        filePath: segment.thumbnailAbsolutePath,
        contentType: "image/jpeg",
      });
      uploaded.push(thumbnailObject);
      segments.push({
        index: segment.index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        durationSeconds: segment.durationSeconds,
        sizeBytes: object.sizeBytes,
        object,
        thumbnailObject,
      });
    }

    const persisted = { parentObject, segments };
    await input.commitDatabase(persisted);
    return persisted;
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      uploaded.reverse().map((object) => input.storage.deleteObject(object.key)),
    );
    const cleanupFailures = cleanupResults.filter(
      (result) => result.status === "rejected",
    ).length;
    throw new ScenePipelineError(
      "scene_persistence_failed",
      "视频批次未能完整写入 ZOS 和 MySQL，整批已取消。",
      {
        uploadedObjectCount: uploaded.length,
        cleanupFailures,
      },
      { cause: error },
    );
  }
}
