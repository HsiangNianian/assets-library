import fs from "node:fs/promises";
import { loadConfig, type AppConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { createModelMediaToken } from "@/server/media/signing";
import { resolveMediaPath } from "@/server/media/storage";
import {
  analysisResultSchema,
  type AnalysisResult,
  type MediaType,
} from "@/shared/contracts";

export interface AnalyzeInput {
  assetId: string;
  mediaType: MediaType;
  mimeType: string;
  relativePath: string;
}

export interface MultimodalAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;
}

const MAX_BASE64_VIDEO_BYTES = 7 * 1024 * 1024;
const DEVELOPMENT_SIGNING_SECRET = "development-only-signing-secret";

const imageShape = `{
  "kind":"image",
  "description":"string",
  "tags":{"scene":["string"],"object":["string"],"person":["string"],"style":["string"],"color_composition":["string"]},
  "ocr":{"text":"string or null","unavailableReason":"string or null"}
}`;

const videoShape = `{
  "kind":"video",
  "description":"string",
  "topics":["string"],
  "tags":{"scene":["string"],"person":["string"],"form":["string"]},
  "visualSegments":[{"startSeconds":0,"endSeconds":1,"summary":"string"}],
  "keyMoments":[{"seconds":0,"summary":"string"}],
  "timeline":[{"startSeconds":0,"endSeconds":1,"summary":"string"}]
}`;

function promptFor(mediaType: MediaType, correction?: string) {
  const scope =
    mediaType === "video"
      ? "只分析画面，不分析音轨，不输出 ASR 或语言。时间必须使用秒。"
      : "识别画面与可见文字；无法识别 OCR 时提供 unavailableReason。";
  return [
    "你是素材库分析器。请使用简体中文描述和标签。",
    scope,
    "只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。",
    `必须严格符合此结构：${mediaType === "image" ? imageShape : videoShape}`,
    correction ? `上一次输出无效：${correction}。请修正。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function extractChatText(payload: unknown) {
  const candidate = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = candidate.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item.text ?? "").join("");
  throw new AppError("model_response_invalid");
}

function extractResponsesText(payload: unknown) {
  const candidate = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (typeof candidate.output_text === "string") return candidate.output_text;
  const text = candidate.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("");
  if (text) return text;
  throw new AppError("model_response_invalid");
}

async function mediaContent(input: AnalyzeInput, config: AppConfig) {
  if (input.mediaType === "image") {
    const bytes = await fs.readFile(
      resolveMediaPath(input.relativePath, config.mediaRoot),
    );
    return {
      chat: {
        type: "image_url",
        image_url: { url: `data:${input.mimeType};base64,${bytes.toString("base64")}` },
      },
      responses: {
        type: "input_image",
        image_url: `data:${input.mimeType};base64,${bytes.toString("base64")}`,
      },
    };
  }
  if (
    config.MODEL_PROTOCOL !== "openai_chat_completions" ||
    config.MODEL_VIDEO_MODE === "disabled"
  ) {
    throw new AppError("model_video_unsupported");
  }
  const filePath = resolveMediaPath(input.relativePath, config.mediaRoot);
  const stat = await fs.stat(filePath);
  let url: string;
  if (
    config.MODEL_VIDEO_MODE === "auto" &&
    stat.size < MAX_BASE64_VIDEO_BYTES
  ) {
    const bytes = await fs.readFile(filePath);
    url = `data:${input.mimeType};base64,${bytes.toString("base64")}`;
  } else {
    const publicUrl = config.APP_PUBLIC_URL
      ? new URL(config.APP_PUBLIC_URL)
      : null;
    if (
      !publicUrl ||
      publicUrl.protocol !== "https:" ||
      config.MEDIA_SIGNING_SECRET === DEVELOPMENT_SIGNING_SECRET
    ) {
      throw new AppError("model_video_public_url_required");
    }
    const token = createModelMediaToken(
      input.assetId,
      Date.now() + 10 * 60_000,
      config.MEDIA_SIGNING_SECRET,
    );
    url = `${publicUrl.toString().replace(/\/$/, "")}/api/model-media/${token}`;
  }
  return {
    chat: {
      type: "video_url",
      video_url: { url, fps: config.MODEL_VIDEO_FPS },
    },
    responses: null,
  };
}

export class OpenAICompatibleAnalyzer implements MultimodalAnalyzer {
  constructor(private readonly config = loadConfig()) {}

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    if (!this.config.modelConfigured) throw new AppError("model_not_configured");
    const media = await mediaContent(input, this.config);
    let correction: string | undefined;
    const attempts = Math.max(2, this.config.MODEL_RETRY_COUNT + 1);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const prompt = promptFor(input.mediaType, correction);
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        input.mediaType === "video"
          ? this.config.MODEL_VIDEO_TIMEOUT_MS
          : this.config.MODEL_TIMEOUT_MS,
      );
      try {
        const isChat = this.config.MODEL_PROTOCOL === "openai_chat_completions";
        const endpoint = isChat ? "chat/completions" : "responses";
        const body = isChat
          ? {
              model: this.config.MODEL_NAME,
              temperature: 0,
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: prompt }, media.chat],
                },
              ],
            }
          : {
              model: this.config.MODEL_NAME,
              input: [
                {
                  role: "user",
                  content: [{ type: "input_text", text: prompt }, media.responses],
                },
              ],
            };
        const response = await fetch(
          `${this.config.MODEL_BASE_URL!.replace(/\/$/, "")}/${endpoint}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.MODEL_API_KEY}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new AppError(
            "model_request_failed",
            `模型服务返回 HTTP ${response.status}。`,
          );
        }
        const payload: unknown = await response.json();
        const text = isChat ? extractChatText(payload) : extractResponsesText(payload);
        try {
          return analysisResultSchema.parse(JSON.parse(stripCodeFence(text)));
        } catch (error) {
          correction =
            error instanceof Error ? error.message.slice(0, 500) : "JSON 格式错误";
        }
      } catch (error) {
        if (error instanceof AppError && error.code === "model_response_invalid") {
          correction = error.message;
        } else if (
          error instanceof AppError &&
          error.code === "model_request_failed"
        ) {
          if (attempt === attempts - 1) throw error;
        } else if (error instanceof Error && error.name === "AbortError") {
          if (attempt === attempts - 1) {
            throw new AppError("model_request_failed", "模型请求超时。");
          }
        } else {
          if (attempt === attempts - 1) {
            throw error instanceof AppError
              ? error
              : new AppError("model_request_failed");
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AppError("model_response_invalid");
  }
}
