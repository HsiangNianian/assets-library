import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSourceMediaSize,
  replaceWithNormalizedMedia,
  throwIfNormalizedOutputLikelyReachedLimit,
} from "@/server/media/validation-size";

describe("media size limits", () => {
  const maximumBytes = 20 * 1024 * 1024;
  const imageLimit = { mediaLabel: "图片", maximumBytes } as const;
  const videoLimit = { mediaLabel: "视频", maximumBytes } as const;

  it("uses one source-size error policy", () => {
    expect(() => assertSourceMediaSize(maximumBytes, imageLimit)).not.toThrow();
    expect(() =>
      assertSourceMediaSize(maximumBytes + 1, imageLimit),
    ).toThrow("图片不得超过 20 MB。");
  });

  it("keeps empty media classified as corrupt", () => {
    expect(() => assertSourceMediaSize(0, imageLimit)).toThrow();
    try {
      assertSourceMediaSize(0, imageLimit);
    } catch (error) {
      expect(error).toMatchObject({ code: "corrupt_file" });
    }
  });

  it("uses one normalized-output threshold and error policy", () => {
    expect(() =>
      throwIfNormalizedOutputLikelyReachedLimit(
        maximumBytes * 0.9 - 1,
        videoLimit,
      ),
    ).not.toThrow();
    expect(() =>
      throwIfNormalizedOutputLikelyReachedLimit(
        maximumBytes * 0.9,
        videoLimit,
      ),
    ).toThrow("转换后的视频不得超过 20 MB。");
  });

  it("keeps the source when normalized output exceeds the limit", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "asset-size-limit-"),
    );
    const filePath = path.join(directory, "original.png");
    await fs.writeFile(filePath, "source");
    try {
      await expect(
        replaceWithNormalizedMedia(
          filePath,
          { mediaLabel: "图片", maximumBytes: 4 },
          async (temporaryPath) => fs.writeFile(temporaryPath, "oversized"),
        ),
      ).rejects.toMatchObject({ code: "file_too_large" });
      await expect(fs.readFile(filePath, "utf8")).resolves.toBe("source");
      await expect(fs.readdir(directory)).resolves.toEqual(["original.png"]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
