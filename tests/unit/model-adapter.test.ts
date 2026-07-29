import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/server/config";
import { OpenAICompatibleAnalyzer } from "@/server/model/analyzer";

const videoAnalysis = {
  kind: "video",
  description: "测试视频",
  topics: ["演示"],
  tags: { scene: ["室内"], person: [], form: ["讲解"] },
  visualSegments: [{ startSeconds: 0, endSeconds: 3, summary: "展示产品" }],
  keyMoments: [{ seconds: 1, summary: "出现标题" }],
  timeline: [{ startSeconds: 0, endSeconds: 3, summary: "完整片段" }],
  transcript: "不应进入正式结果",
};
const modelBaseUrl = process.env.MODEL_BASE_URL ?? "https://proxy.example/v1";

describe("model adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes a Chat Completions image response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-model-"));
    process.env.MEDIA_ROOT = root;
    process.env.MODEL_PROTOCOL = "openai_chat_completions";
    process.env.MODEL_BASE_URL = modelBaseUrl;
    process.env.MODEL_API_KEY = "secret";
    process.env.MODEL_NAME = "qwen3.7-plus";
    await fs.mkdir(path.join(root, "a"));
    await fs.writeFile(path.join(root, "a", "original.png"), "image");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "image",
                  description: "测试图片",
                  tags: {
                    scene: [],
                    object: [],
                    person: [],
                    style: [],
                    color_composition: [],
                  },
                  ocr: { text: null, unavailableReason: "无文字" },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await new OpenAICompatibleAnalyzer(loadConfig()).analyze({
      assetId: "a",
      mediaType: "image",
      mimeType: "image/png",
      relativePath: "a/original.png",
    });
    expect(result.description).toBe("测试图片");
    expect(fetch).toHaveBeenCalledWith(
      `${modelBaseUrl}/chat/completions`,
      expect.objectContaining({ method: "POST" }),
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "qwen3.7-plus",
      enable_thinking: false,
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails video under the Responses protocol without fallback", async () => {
    const config = loadConfig({
      MODEL_PROTOCOL: "openai_responses",
      MODEL_BASE_URL: modelBaseUrl,
      MODEL_API_KEY: "secret",
      MODEL_NAME: "vision-model",
    });
    await expect(
      new OpenAICompatibleAnalyzer(config).analyze({
        assetId: "video",
        mediaType: "video",
        mimeType: "video/mp4",
        relativePath: "video/original.mp4",
      }),
    ).rejects.toMatchObject({ code: "model_video_unsupported" });
  });

  it("sends persisted video frames with their timestamps", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-frames-"));
    const assetDirectory = path.join(root, "video");
    const frameDirectory = path.join(assetDirectory, "frames");
    await fs.mkdir(frameDirectory, { recursive: true });
    await fs.writeFile(path.join(assetDirectory, "original.mp4"), "video");
    await fs.writeFile(path.join(frameDirectory, "frame-01.jpg"), "frame-one");
    await fs.writeFile(path.join(frameDirectory, "frame-02.jpg"), "frame-two");
    await fs.writeFile(
      path.join(frameDirectory, "manifest.json"),
      JSON.stringify({
        durationSeconds: 2,
        frames: [
          { filename: "frame-01.jpg", timestampSeconds: 0.5 },
          { filename: "frame-02.jpg", timestampSeconds: 1.5 },
        ],
      }),
    );
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: modelBaseUrl,
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "frames",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(videoAnalysis) } }],
        }),
        { status: 200 },
      ),
    );

    const result = await new OpenAICompatibleAnalyzer(config).analyze({
      assetId: "video",
      mediaType: "video",
      mimeType: "video/mp4",
      relativePath: "video/original.mp4",
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      enable_thinking?: boolean;
      messages: Array<{
        content: Array<{
          type: string;
          image_url?: { url: string };
          text?: string;
        }>;
      }>;
    };
    expect(body.enable_thinking).toBe(false);
    const content = body.messages[0]?.content ?? [];
    expect(content.filter((item) => item.type === "image_url")).toHaveLength(2);
    expect(content[1]?.text).toContain("0.5 秒");
    expect(content[2]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(content[3]?.text).toContain("1.5 秒");
    expect(content[4]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(content[0]?.text).toContain("不分析音轨");
    expect(result).not.toHaveProperty("transcript");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails clearly when persisted video frames are missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-missing-"));
    const assetDirectory = path.join(root, "video");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(path.join(assetDirectory, "original.mp4"), "video");
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "frames",
    });

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze({
        assetId: "video",
        mediaType: "video",
        mimeType: "video/mp4",
        relativePath: "video/original.mp4",
      }),
    ).rejects.toMatchObject({ code: "video_frames_missing" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails video when video analysis is disabled", async () => {
    const config = loadConfig({
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "disabled",
    });

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze({
        assetId: "video",
        mediaType: "video",
        mimeType: "video/mp4",
        relativePath: "video/original.mp4",
      }),
    ).rejects.toMatchObject({ code: "model_video_unsupported" });
  });

  it("normalizes a Responses API image response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-responses-"));
    const assetDirectory = path.join(root, "r");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(path.join(assetDirectory, "original.webp"), "image");
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_responses",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "vision-model",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            kind: "image",
            description: "Responses 图片",
            tags: {
              scene: [],
              object: [],
              person: [],
              style: [],
              color_composition: [],
            },
            ocr: { text: "ABC", unavailableReason: null },
          }),
        }),
        { status: 200 },
      ),
    );
    const result = await new OpenAICompatibleAnalyzer(config).analyze({
      assetId: "r",
      mediaType: "image",
      mimeType: "image/webp",
      relativePath: "r/original.webp",
    });
    expect(result.description).toBe("Responses 图片");
    expect(fetch).toHaveBeenCalledWith(
      "https://proxy.example/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
});
