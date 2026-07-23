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

describe("model adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes a Chat Completions image response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-model-"));
    process.env.MEDIA_ROOT = root;
    process.env.MODEL_PROTOCOL = "openai_chat_completions";
    process.env.MODEL_BASE_URL = "https://proxy.example/v1";
    process.env.MODEL_API_KEY = "secret";
    process.env.MODEL_NAME = "vision-model";
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
      "https://proxy.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails video under the Responses protocol without fallback", async () => {
    const config = loadConfig({
      MODEL_PROTOCOL: "openai_responses",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "vision-model",
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
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

  it("sends a small video as Base64 with one frame per second", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-base64-"));
    const assetDirectory = path.join(root, "video");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(path.join(assetDirectory, "original.mp4"), "small-video");
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "auto",
      MODEL_VIDEO_FPS: "1",
      APP_PUBLIC_URL: "https://assets.example",
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
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
      messages: Array<{
        content: Array<{
          type: string;
          video_url?: { url: string; fps: number };
          text?: string;
        }>;
      }>;
    };
    const media = body.messages[0]?.content[1];
    expect(media?.video_url?.url).toMatch(/^data:video\/mp4;base64,/);
    expect(media?.video_url?.fps).toBe(1);
    expect(body.messages[0]?.content[0]?.text).toContain("不分析音轨");
    expect(result).not.toHaveProperty("transcript");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("uses a signed public URL at the 7 MiB boundary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-url-"));
    const assetDirectory = path.join(root, "video");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(
      path.join(assetDirectory, "original.mp4"),
      Buffer.alloc(7 * 1024 * 1024),
    );
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "auto",
      APP_PUBLIC_URL: "https://assets.example",
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(videoAnalysis) } }],
        }),
        { status: 200 },
      ),
    );

    await new OpenAICompatibleAnalyzer(config).analyze({
      assetId: "video",
      mediaType: "video",
      mimeType: "video/mp4",
      relativePath: "video/original.mp4",
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(String(request?.body)).toContain(
      "https://assets.example/api/model-media/",
    );
    expect(String(request?.body)).not.toContain("data:video/mp4;base64,");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("requires a public URL for videos at least 7 MiB", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-large-"));
    const assetDirectory = path.join(root, "video");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(
      path.join(assetDirectory, "original.mp4"),
      Buffer.alloc(7 * 1024 * 1024),
    );
    const config = loadConfig({
      MEDIA_ROOT: root,
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "auto",
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
    });

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze({
        assetId: "video",
        mediaType: "video",
        mimeType: "video/mp4",
        relativePath: "video/original.mp4",
      }),
    ).rejects.toMatchObject({ code: "model_video_public_url_required" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails video when video analysis is disabled", async () => {
    const config = loadConfig({
      MODEL_PROTOCOL: "openai_chat_completions",
      MODEL_BASE_URL: "https://proxy.example/v1",
      MODEL_API_KEY: "secret",
      MODEL_NAME: "qwen3.7-plus",
      MODEL_VIDEO_MODE: "disabled",
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
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
      MEDIA_SIGNING_SECRET: "test-secret-at-least-16-characters",
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
