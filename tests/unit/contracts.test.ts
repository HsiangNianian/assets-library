import { describe, expect, it } from "vitest";
import {
  assetEditSchema,
  imageAnalysisSchema,
  uploadStatusSchema,
  videoAnalysisSchema,
} from "@/shared/contracts";

describe("shared contracts", () => {
  it("accepts a complete image analysis", () => {
    expect(
      imageAnalysisSchema.parse({
        kind: "image",
        description: "城市夜景",
        tags: {
          scene: ["城市"],
          object: ["建筑"],
          person: [],
          style: ["纪实"],
          color_composition: ["冷色调"],
        },
        ocr: { text: null, unavailableReason: "没有文字" },
      }),
    ).toBeTruthy();
  });

  it("rejects audio and malformed video timestamps", () => {
    expect(() =>
      uploadStatusSchema.parse({
        uploadId: crypto.randomUUID(),
        assetId: crypto.randomUUID(),
        mediaType: "audio",
        processingStatus: "queued",
        reviewStatus: "pending_review",
        progressPercent: 10,
        failureCode: null,
        failureMessage: null,
      }),
    ).toThrow();
    expect(() =>
      videoAnalysisSchema.parse({
        kind: "video",
        description: "测试",
        topics: [],
        tags: { scene: [], person: [], form: [] },
        visualSegments: [{ startSeconds: -1, endSeconds: 2, summary: "错误" }],
        keyMoments: [],
        timeline: [],
      }),
    ).toThrow();
  });

  it("trims and validates editable metadata", () => {
    const edit = assetEditSchema.parse({
      name: "  海报  ",
      description: "描述",
      tags: [{ category: "scene", value: " 室内 " }],
    });
    expect(edit.name).toBe("海报");
    expect(edit.tags[0]?.value).toBe("室内");
  });
});
