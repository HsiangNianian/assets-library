import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/server/config";
import { OpenAICompatibleAnalyzer } from "@/server/model/analyzer";

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
