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
const modelBaseUrl = process.env.VLM_BASE_URL ?? "https://proxy.example/v1";

function chatResponse(description: string) {
  return chatContentResponse(
    JSON.stringify({
      kind: "image",
      description,
      tags: {
        scene: [],
        object: [],
        person: [],
        style: [],
        color_composition: [],
      },
      ocr: { text: null, unavailableReason: "无文字" },
    }),
  );
}

function chatContentResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  );
}

function gatewayError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers,
  });
}

async function createImageFixture(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const assetDirectory = path.join(root, "asset");
  await fs.mkdir(assetDirectory);
  await fs.writeFile(path.join(assetDirectory, "original.png"), "image");
  return {
    root,
    input: {
      assetId: "asset",
      mediaType: "image" as const,
      mimeType: "image/png",
      relativePath: "asset/original.png",
    },
  };
}

describe("model adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes a Chat Completions image response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-model-"));
    process.env.MEDIA_ROOT = root;
    process.env.VLM_PROTOCOL = "openai_chat_completions";
    process.env.VLM_BASE_URL = modelBaseUrl;
    process.env.VLM_API_KEY = "secret";
    process.env.VLM_NAME = "qwen3.7-plus";
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
    expect(result.result.description).toBe("测试图片");
    expect(result.model).toEqual({
      protocol: "openai_chat_completions",
      name: "qwen3.7-plus",
    });
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

  it("uses the VLM target without leaking LLM request options", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-vlm-target-"));
    const assetDirectory = path.join(root, "vlm");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(path.join(assetDirectory, "original.png"), "image");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_ENABLE_THINKING: "false",
      LLM_PROTOCOL: "openai_responses",
      LLM_BASE_URL: "https://text.example/v1",
      LLM_API_KEY: "text-only-key",
      LLM_NAME: "Qwythos",
      LLM_ENABLE_THINKING: "true",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "image",
                  description: "分组配置测试",
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

    await new OpenAICompatibleAnalyzer(config).analyze({
      assetId: "vlm",
      mediaType: "image",
      mimeType: "image/png",
      relativePath: "vlm/original.png",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://vision.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "qwen3.7-plus",
      enable_thinking: false,
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retries when model returns English tag values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-model-language-"));
    process.env.MEDIA_ROOT = root;
    process.env.VLM_PROTOCOL = "openai_chat_completions";
    process.env.VLM_BASE_URL = modelBaseUrl;
    process.env.VLM_API_KEY = "secret";
    process.env.VLM_NAME = "qwen3.7-plus";
    await fs.mkdir(path.join(root, "language"));
    await fs.writeFile(path.join(root, "language", "original.png"), "image");

    const response = (tag: string) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "image",
                  description: "终端截图",
                  tags: {
                    scene: [],
                    object: [],
                    person: [],
                    style: [],
                    color_composition: [tag],
                  },
                  ocr: { text: null, unavailableReason: "无文字" },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response("dark_gray_background"))
      .mockResolvedValueOnce(response("深灰色背景"));

    const result = await new OpenAICompatibleAnalyzer(loadConfig()).analyze({
      assetId: "language",
      mediaType: "image",
      mimeType: "image/png",
      relativePath: "language/original.png",
    });

    expect(result.result.kind).toBe("image");
    if (result.result.kind === "image") {
      expect(result.result.tags.color_composition).toEqual(["深灰色背景"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ content: Array<{ text?: string }> }> };
    expect(retryBody.messages[0]?.content[0]?.text).toContain(
      "dark_gray_background",
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails video under the Responses protocol without fallback", async () => {
    const config = loadConfig({
      VLM_PROTOCOL: "openai_responses",
      VLM_BASE_URL: modelBaseUrl,
      VLM_API_KEY: "secret",
      VLM_NAME: "vision-model",
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
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: modelBaseUrl,
      VLM_API_KEY: "secret",
      VLM_NAME: "qwen3.7-plus",
      VLM_VIDEO_MODE: "frames",
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
    expect(result.result).not.toHaveProperty("transcript");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails clearly when persisted video frames are missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-video-missing-"));
    const assetDirectory = path.join(root, "video");
    await fs.mkdir(assetDirectory);
    await fs.writeFile(path.join(assetDirectory, "original.mp4"), "video");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: "https://proxy.example/v1",
      VLM_API_KEY: "secret",
      VLM_NAME: "qwen3.7-plus",
      VLM_VIDEO_MODE: "frames",
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
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: "https://proxy.example/v1",
      VLM_API_KEY: "secret",
      VLM_NAME: "qwen3.7-plus",
      VLM_VIDEO_MODE: "disabled",
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
      VLM_PROTOCOL: "openai_responses",
      VLM_BASE_URL: "https://proxy.example/v1",
      VLM_API_KEY: "secret",
      VLM_NAME: "vision-model",
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
    expect(result.result.description).toBe("Responses 图片");
    expect(fetch).toHaveBeenCalledWith(
      "https://proxy.example/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("falls back on exhausted quota and skips the primary during cooldown", async () => {
    const { root, input } = await createImageFixture("asset-failover-quota-");
    let now = 0;
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5,Qwythos",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "3",
      VLM_FAILOVER_COOLDOWN_MS: "1000",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(402, "insufficient_quota", "额度已经用完"),
      )
      .mockResolvedValueOnce(chatResponse("首次备用模型结果"))
      .mockResolvedValueOnce(chatResponse("冷却期间备用模型结果"))
      .mockResolvedValueOnce(chatResponse("主模型恢复结果"));
    const analyzer = new OpenAICompatibleAnalyzer(config, { now: () => now });

    const first = await analyzer.analyze(input);
    const second = await analyzer.analyze(input);
    now = 1_001;
    const third = await analyzer.analyze(input);

    expect(first.model.name).toBe("kimi-k2.5");
    expect(second.model.name).toBe("kimi-k2.5");
    expect(third.model.name).toBe("qwen3.7-plus");
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    ) as Array<{ model: string; enable_thinking?: boolean }>;
    expect(bodies.map((body) => body.model)).toEqual([
      "qwen3.7-plus",
      "kimi-k2.5",
      "kimi-k2.5",
      "qwen3.7-plus",
    ]);
    expect(bodies.every((body) => body.enable_thinking === false)).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retries transient failures before moving to the next candidate", async () => {
    const { root, input } = await createImageFixture("asset-failover-retry-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "1",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(503, "service_unavailable", "temporary outage"),
      )
      .mockResolvedValueOnce(
        gatewayError(503, "service_unavailable", "temporary outage"),
      )
      .mockResolvedValueOnce(chatResponse("备用模型处理成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("kimi-k2.5");
    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model,
      ),
    ).toEqual(["qwen3.7-plus", "qwen3.7-plus", "kimi-k2.5"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retries when a successful response body is interrupted", async () => {
    const { root, input } = await createImageFixture("asset-response-stream-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "1",
    });
    const interruptedResponse = {
      ok: true,
      json: vi.fn().mockRejectedValue(new TypeError("terminated")),
    } as unknown as Response;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(interruptedResponse)
      .mockResolvedValueOnce(chatResponse("读取重试成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("qwen3.7-plus");
    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model,
      ),
    ).toEqual(["qwen3.7-plus", "qwen3.7-plus"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("walks the full candidate chain in configured order", async () => {
    const { root, input } = await createImageFixture("asset-failover-chain-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5,Qwythos",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "0",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(402, "insufficient_quota", "额度已经用完"),
      )
      .mockResolvedValueOnce(
        gatewayError(404, "model_not_found", "model unavailable"),
      )
      .mockResolvedValueOnce(chatResponse("第三候选处理成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("Qwythos");
    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model,
      ),
    ).toEqual(["qwen3.7-plus", "kimi-k2.5", "Qwythos"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("falls back when a candidate explicitly rejects image input", async () => {
    const { root, input } = await createImageFixture("asset-vision-support-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "0",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(
          400,
          "unsupported_content_type",
          "image_url is not supported by this model",
        ),
      )
      .mockResolvedValueOnce(chatResponse("视觉候选处理成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("kimi-k2.5");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retries when an error response body is interrupted", async () => {
    const { root, input } = await createImageFixture("asset-error-stream-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "1",
    });
    const interruptedResponse = {
      ok: false,
      status: 503,
      headers: new Headers(),
      text: vi.fn().mockRejectedValue(new TypeError("terminated")),
    } as unknown as Response;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(interruptedResponse)
      .mockResolvedValueOnce(chatResponse("错误响应读取重试成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("qwen3.7-plus");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps an interrupted authentication response fatal", async () => {
    const { root, input } = await createImageFixture("asset-auth-stream-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "1",
    });
    const interruptedResponse = {
      ok: false,
      status: 401,
      headers: new Headers(),
      text: vi.fn().mockRejectedValue(new TypeError("terminated")),
    } as unknown as Response;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(interruptedResponse)
      .mockResolvedValue(chatResponse("不应调用"));

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze(input),
    ).rejects.toMatchObject({ code: "model_request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("honors Retry-After while retrying a rate-limited candidate", async () => {
    const { root, input } = await createImageFixture("asset-failover-rate-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "1",
    });
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(429, "rate_limit", "too many requests", {
          "retry-after": "2",
        }),
      )
      .mockResolvedValueOnce(chatResponse("限流重试成功"));

    const outcome = await new OpenAICompatibleAnalyzer(config, {
      sleep,
    }).analyze(input);

    expect(outcome.model.name).toBe("qwen3.7-plus");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("does not try fallback candidates after an authentication failure", async () => {
    const { root, input } = await createImageFixture("asset-failover-auth-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(gatewayError(401, "unauthorized", "bad key"))
      .mockResolvedValue(chatResponse("不应调用"));

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze(input),
    ).rejects.toMatchObject({ code: "model_request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("does not try fallback candidates after a request validation failure", async () => {
    const { root, input } = await createImageFixture("asset-failover-request-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gatewayError(400, "invalid_request", "invalid message payload"),
      )
      .mockResolvedValue(chatResponse("不应调用"));

    await expect(
      new OpenAICompatibleAnalyzer(config).analyze(input),
    ).rejects.toMatchObject({ code: "model_request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("corrects one invalid response before falling back", async () => {
    const { root, input } = await createImageFixture("asset-failover-format-");
    const config = loadConfig({
      MEDIA_ROOT: root,
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      VLM_FALLBACK_NAMES: "kimi-k2.5",
      VLM_ENABLE_THINKING: "false",
      VLM_RETRY_COUNT: "0",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatContentResponse("not-json"))
      .mockResolvedValueOnce(chatContentResponse("still-not-json"))
      .mockResolvedValueOnce(chatResponse("备用模型修复结果"));

    const outcome = await new OpenAICompatibleAnalyzer(config).analyze(input);

    expect(outcome.model.name).toBe("kimi-k2.5");
    const bodies = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]?.body)) as {
          model: string;
          messages: Array<{ content: Array<{ text?: string }> }>;
        },
    );
    expect(bodies.map((body) => body.model)).toEqual([
      "qwen3.7-plus",
      "qwen3.7-plus",
      "kimi-k2.5",
    ]);
    expect(bodies[1]?.messages[0]?.content[0]?.text).toContain("上一次输出无效");
    await fs.rm(root, { recursive: true, force: true });
  });
});
