import { describe, expect, it } from "vitest";
import { videoFrameTimestamps } from "@/shared/video-frames";

describe("video frame sampling", () => {
  it.each([
    [0.8, [0.4]],
    [2, [0.5, 1.5]],
    [2.4, [0.4, 1.2, 2]],
    [4, [0.5, 1.5, 2.5, 3.5]],
    [5, [0.5, 1.5, 2.5, 3.5, 4.5]],
    [20, [2, 6, 10, 14, 18]],
  ])("samples %s seconds at quantile midpoints", (duration, expected) => {
    expect(videoFrameTimestamps(duration)).toEqual(expected);
  });

  it("rejects invalid durations", () => {
    expect(() => videoFrameTimestamps(0)).toThrow();
    expect(() => videoFrameTimestamps(Number.POSITIVE_INFINITY)).toThrow();
  });
});
