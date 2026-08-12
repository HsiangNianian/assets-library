import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPreparedSceneBatch,
  prepareSceneBatch,
} from "@/server/scene/batch";
import { SceneDetectClient } from "@/server/scene/client";
import { ScenePipelineError } from "@/server/scene/types";

const execFileAsync = promisify(execFile);

async function createVideo(filePath: string, color = "blue", duration = 0.3) {
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=32x32:d=${duration}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    filePath,
  ]);
}

function manifest(
  taskId: string,
  sizes: number[],
  durationSeconds = sizes.length * 0.3,
) {
  return {
    taskId,
    originalFilename: "parent.mp4",
    durationSeconds,
    sceneCount: sizes.length,
    segments: sizes.map((sizeBytes, offset) => ({
      index: offset + 1,
      startSeconds: offset * 0.3,
      endSeconds: (offset + 1) * 0.3,
      durationSeconds: 0.3,
      startFrame: offset * 9,
      endFrame: (offset + 1) * 9,
      sizeBytes,
      filename: `segment-${String(offset + 1).padStart(3, "0")}.mp4`,
      downloadUrl: `/api/v1/videos/split/${taskId}/segments/${offset + 1}`,
    })),
  };
}

async function captureSceneError(
  operation: Promise<unknown>,
): Promise<ScenePipelineError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ScenePipelineError);
    return error as ScenePipelineError;
  }
  throw new Error("预期分镜操作失败，但操作成功完成。");
}

describe("scene video pipeline", () => {
  let directory: string;
  let parentPath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "asset-scenes-"));
    parentPath = path.join(directory, "parent.mp4");
    await createVideo(parentPath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("downloads and fully validates every segment before exposing the batch", async () => {
    const first = path.join(directory, "first.mp4");
    const second = path.join(directory, "second.mp4");
    await Promise.all([
      createVideo(first, "red"),
      createVideo(second, "green"),
    ]);
    const bytes = [await fs.readFile(first), await fs.readFile(second)];
    const taskId = "a".repeat(32);
    const splitManifest = manifest(
      taskId,
      bytes.map((item) => item.byteLength),
    );
    const requested: string[] = [];
    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      requested.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/v1/videos/split" && init?.method === "POST") {
        return Response.json(splitManifest);
      }
      const match = url.pathname.match(/\/segments\/(\d+)$/);
      if (match) {
        return new Response(bytes[Number(match[1]) - 1], {
          headers: { "content-type": "video/mp4" },
        });
      }
      if (url.pathname.endsWith(taskId) && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
    const client = new SceneDetectClient({
      baseUrl: "http://127.0.0.1:28200",
      timeoutMs: 10_000,
      fetchImplementation: fakeFetch,
    });

    const batch = await prepareSceneBatch({
      client,
      normalizedParentPath: parentPath,
      originalFilename: "parent.mp4",
      workspaceRoot: path.join(directory, "workspace"),
      maximumSegmentBytes: 10 * 1024 * 1024,
    });

    expect(batch.segments).toHaveLength(2);
    expect(batch.segments.map((segment) => segment.sizeBytes)).toEqual(
      bytes.map((item) => item.byteLength),
    );
    await Promise.all(
      batch.segments.map((segment) => expect(fs.stat(segment.absolutePath)).resolves.toBeTruthy()),
    );
    await Promise.all(
      batch.segments.map(async (segment) => {
        const thumbnail = await fs.readFile(segment.thumbnailAbsolutePath);
        expect(segment.thumbnailSizeBytes).toBe(thumbnail.byteLength);
        expect([...thumbnail.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      }),
    );
    expect(requested).not.toContain(`DELETE /api/v1/videos/split/${taskId}`);

    await cleanupPreparedSceneBatch(batch, client);
    await expect(fs.stat(batch.workspacePath)).rejects.toThrow();
    expect(requested).toContain(`DELETE /api/v1/videos/split/${taskId}`);
  }, 20_000);

  it("rejects an oversized manifest before downloading any segment", async () => {
    const taskId = "b".repeat(32);
    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/videos/split") {
        return Response.json(manifest(taskId, [10 * 1024 * 1024 + 1]));
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error("切片不应被下载");
    });
    const client = new SceneDetectClient({
      baseUrl: "http://127.0.0.1:28200",
      timeoutMs: 10_000,
      fetchImplementation: fakeFetch,
    });

    const error = await captureSceneError(
      prepareSceneBatch({
        client,
        normalizedParentPath: parentPath,
        originalFilename: "parent.mp4",
        workspaceRoot: path.join(directory, "workspace"),
        maximumSegmentBytes: 10 * 1024 * 1024,
      }),
    );

    expect(error.code).toBe("scene_segment_too_large");
    expect(error.details.segments).toEqual([
      expect.objectContaining({ segmentIndex: 1, maximumBytes: 10 * 1024 * 1024 }),
    ]);
    expect(fakeFetch).toHaveBeenCalledTimes(2); // POST + compensating DELETE
    await expect(fs.stat(path.join(directory, "workspace"))).resolves.toBeTruthy();
    expect(await fs.readdir(path.join(directory, "workspace"))).toEqual([]);
  });

  it("removes the complete local batch when any downloaded segment is corrupt", async () => {
    const validPath = path.join(directory, "valid.mp4");
    await createVideo(validPath, "yellow");
    const valid = await fs.readFile(validPath);
    const corrupt = Buffer.from("not a video");
    const taskId = "c".repeat(32);
    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/videos/split") {
        return Response.json(manifest(taskId, [valid.length, corrupt.length]));
      }
      if (url.pathname.endsWith("/segments/1")) return new Response(valid);
      if (url.pathname.endsWith("/segments/2")) return new Response(corrupt);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    const client = new SceneDetectClient({
      baseUrl: "http://127.0.0.1:28200",
      timeoutMs: 10_000,
      fetchImplementation: fakeFetch,
    });

    const error = await captureSceneError(
      prepareSceneBatch({
        client,
        normalizedParentPath: parentPath,
        originalFilename: "parent.mp4",
        workspaceRoot: path.join(directory, "workspace"),
        maximumSegmentBytes: 10 * 1024 * 1024,
      }),
    );

    expect(error.code).toBe("scene_segment_invalid");
    expect(error.details.segments).toEqual([
      expect.objectContaining({ segmentIndex: 2 }),
    ]);
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: `/api/v1/videos/split/${taskId}` }),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(await fs.readdir(path.join(directory, "workspace"))).toEqual([]);
  }, 20_000);
});
