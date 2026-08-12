import { describe, expect, it } from "vitest";
import {
  normalizeObjectKey,
  publicObjectUrl,
  writeAll,
} from "@/server/storage/object-storage";
import { parseMediaByteRange } from "@/server/media/response";

describe("object storage key", () => {
  it("keeps normalized nested keys and encodes public URLs", () => {
    const key = normalizeObjectKey("assets/videos/2026/08/中文.mp4");
    expect(key).toBe("assets/videos/2026/08/中文.mp4");
    expect(publicObjectUrl("https://example.test/", key)).toBe(
      "https://example.test/assets/videos/2026/08/%E4%B8%AD%E6%96%87.mp4",
    );
  });

  it.each(["", "/", "../video.mp4", "assets/../video.mp4", "assets//video.mp4"])(
    "rejects unsafe key %s",
    (key) => expect(() => normalizeObjectKey(key)).toThrow(),
  );
});

describe("media byte ranges", () => {
  it("parses closed, open and suffix ranges", () => {
    expect(parseMediaByteRange("bytes=10-19", 100)).toEqual({
      start: 10,
      end: 19,
    });
    expect(parseMediaByteRange("bytes=90-", 100)).toEqual({
      start: 90,
      end: 99,
    });
    expect(parseMediaByteRange("bytes=-10", 100)).toEqual({
      start: 90,
      end: 99,
    });
    expect(parseMediaByteRange("bytes=-200", 100)).toEqual({
      start: 0,
      end: 99,
    });
  });

  it("rejects unsupported or unsatisfiable ranges", () => {
    expect(parseMediaByteRange("bytes=100-", 100)).toBeUndefined();
    expect(parseMediaByteRange("bytes=20-10", 100)).toBeUndefined();
    expect(parseMediaByteRange("bytes=-0", 100)).toBeUndefined();
    expect(parseMediaByteRange("bytes=0-1,3-4", 100)).toBeUndefined();
    expect(parseMediaByteRange(null, 100)).toBeNull();
  });
});

describe("complete file writes", () => {
  it("retries a short FileHandle write until the whole chunk is persisted", async () => {
    const calls: Array<{ offset: number; length: number }> = [];
    const handle = {
      write: async (
        _chunk: Uint8Array,
        offset: number,
        length: number,
      ) => {
        calls.push({ offset, length });
        return { bytesWritten: Math.min(2, length), buffer: _chunk };
      },
    };

    await writeAll(
      handle as Parameters<typeof writeAll>[0],
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    expect(calls).toEqual([
      { offset: 0, length: 5 },
      { offset: 2, length: 3 },
      { offset: 4, length: 1 },
    ]);
  });
});
