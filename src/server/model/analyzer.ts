import fs from "node:fs/promises";
import {
  loadConfig,
  type AppConfig,
  type ConfiguredModelTarget,
  type ModelProtocol,
  type ModelTarget,
} from "@/server/config";
import { AppError } from "@/server/errors";
import {
  readVideoFrames,
  resolveMediaPath,
} from "@/server/media/storage";
import {
  analysisResultSchema,
  type AnalysisResult,
  type MediaType,
} from "@/shared/contracts";
import {
  ModelCandidateCooldowns,
  ModelRequestError,
  modelRequestErrorFromResponse,
} from "./failover";

export interface AnalyzeInput {
  assetId: string;
  mediaType: MediaType;
  mimeType: string;
  relativePath: string;
}

export interface MultimodalAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalysisOutcome>;
}

export interface AnalysisOutcome {
  result: AnalysisResult;
  model: {
    protocol: ModelProtocol;
    name: string;
  };
}

interface AnalyzerRuntime {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

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
      ? "输入是按时间分位采样的关键帧。只分析画面，不分析音轨，不输出 ASR 或语言。根据每帧标注时间生成时间轴，时间必须使用秒。"
      : "识别画面与可见文字；无法识别 OCR 时提供 unavailableReason。";
  return [
    "你是素材库分析器。描述、topics 和所有标签值必须使用简体中文。",
    "每个标签值必须至少包含一个中文汉字；禁止英文标签、拼音和 snake_case。JSON 字段名与标签分类键保持结构中规定的英文。",
    scope,
    "只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。",
    `必须严格符合此结构：${mediaType === "image" ? imageShape : videoShape}`,
    correction ? `上一次输出无效：${correction}。请修正。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const chineseCharacterPattern = /\p{Script=Han}/u;

function requireChineseLabels(result: AnalysisResult) {
  const labels =
    result.kind === "image"
      ? Object.values(result.tags).flat()
      : [...result.topics, ...Object.values(result.tags).flat()];
  const invalidLabels = labels.filter(
    (label) => !chineseCharacterPattern.test(label),
  );
  if (invalidLabels.length > 0) {
    throw new Error(
      `标签值必须使用简体中文，以下值不合格：${invalidLabels.slice(0, 8).join("、")}`,
    );
  }
  return result;
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

async function mediaContent(
  input: AnalyzeInput,
  config: AppConfig,
  model: ModelTarget,
) {
  if (input.mediaType === "image") {
    const bytes = await fs.readFile(
      resolveMediaPath(input.relativePath, config.mediaRoot),
    );
    return {
      chat: [
        {
          type: "image_url",
          image_url: {
            url: `data:${input.mimeType};base64,${bytes.toString("base64")}`,
          },
        },
      ],
      responses: [
        {
          type: "input_image",
          image_url: `data:${input.mimeType};base64,${bytes.toString("base64")}`,
        },
      ],
    };
  }
  if (
    model.protocol !== "openai_chat_completions" ||
    config.VLM_VIDEO_MODE !== "frames"
  ) {
    throw new AppError("model_video_unsupported");
  }
  const frames = readVideoFrames(input.relativePath, config.mediaRoot);
  const chat: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  for (const [index, frame] of frames.entries()) {
    const bytes = await fs.readFile(frame.absolutePath);
    chat.push(
      {
        type: "text",
        text: `关键帧 ${index + 1}，时间点 ${frame.timestampSeconds} 秒：`,
      },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        },
      },
    );
  }
  return { chat, responses: null };
}

export class OpenAICompatibleAnalyzer implements MultimodalAnalyzer {
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cooldowns: ModelCandidateCooldowns;

  constructor(
    private readonly config = loadConfig(),
    runtime: AnalyzerRuntime = {},
  ) {
    this.now = runtime.now ?? Date.now;
    this.sleep =
      runtime.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.cooldowns = new ModelCandidateCooldowns(this.now);
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisOutcome> {
    const configuredCandidates = this.config.models.vlmCandidates;
    if (configuredCandidates.length === 0) {
      throw new AppError("model_not_configured");
    }
    const media = await mediaContent(
      input,
      this.config,
      configuredCandidates[0],
    );
    const candidates = this.cooldowns.candidatesForAttempt(configuredCandidates);
    let lastFailure: "request" | "response" = "request";

    for (const candidate of candidates) {
      try {
        const result = await this.analyzeWithModel(candidate, input, media);
        this.cooldowns.clear(candidate);
        return {
          result,
          model: { protocol: candidate.protocol, name: candidate.name },
        };
      } catch (error) {
        if (error instanceof ModelRequestError) {
          if (error.kind === "fatal") {
            throw new AppError("model_request_failed");
          }
          lastFailure = "request";
          this.cooldowns.mark(
            candidate,
            this.cooldownDuration(error.kind),
            error.kind,
          );
          continue;
        }
        if (error instanceof AppError && error.code === "model_response_invalid") {
          lastFailure = "response";
          this.cooldowns.mark(
            candidate,
            this.transientCooldownDuration(),
            "response_invalid",
          );
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      lastFailure === "response"
        ? "model_response_invalid"
        : "model_request_failed",
    );
  }

  private async analyzeWithModel(
    model: ConfiguredModelTarget,
    input: AnalyzeInput,
    media: Awaited<ReturnType<typeof mediaContent>>,
  ) {
    let correction: string | undefined;
    let correctionUsed = false;
    let retriesRemaining = this.config.VLM_RETRY_COUNT;

    while (true) {
      try {
        const text = await this.requestModel(model, input, media, correction);
        try {
          return requireChineseLabels(
            analysisResultSchema.parse(JSON.parse(stripCodeFence(text))),
          );
        } catch (error) {
          if (correctionUsed) throw new AppError("model_response_invalid");
          correctionUsed = true;
          correction =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "JSON 格式错误";
        }
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "model_response_invalid"
        ) {
          if (correctionUsed) throw error;
          correctionUsed = true;
          correction = error.message.slice(0, 500);
          continue;
        }
        const requestError = this.normalizeRequestError(error);
        if (!requestError) throw error;
        if (requestError.kind !== "transient" || retriesRemaining === 0) {
          throw requestError;
        }
        retriesRemaining -= 1;
        const retryDelay = Math.min(requestError.retryAfterMs ?? 0, 5_000);
        if (retryDelay > 0) await this.sleep(retryDelay);
      }
    }
  }

  private async requestModel(
    model: ConfiguredModelTarget,
    input: AnalyzeInput,
    media: Awaited<ReturnType<typeof mediaContent>>,
    correction: string | undefined,
  ) {
    const prompt = promptFor(input.mediaType, correction);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      input.mediaType === "video"
        ? this.config.VLM_VIDEO_TIMEOUT_MS
        : this.config.VLM_TIMEOUT_MS,
    );
    const isChat = model.protocol === "openai_chat_completions";
    const endpoint = isChat ? "chat/completions" : "responses";
    const thinking =
      model.requestOptions.enableThinking === null
        ? {}
        : { enable_thinking: model.requestOptions.enableThinking };
    const body = isChat
      ? {
          model: model.name,
          temperature: 0,
          ...thinking,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }, ...media.chat],
            },
          ],
        }
      : {
          model: model.name,
          ...thinking,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...(media.responses ?? []),
              ],
            },
          ],
        };

    try {
      const response = await fetch(`${model.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          ...(model.apiKey
            ? { authorization: `Bearer ${model.apiKey}` }
            : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await modelRequestErrorFromResponse(response, this.now());
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (
          error instanceof TypeError ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        throw new AppError("model_response_invalid");
      }
      return isChat ? extractChatText(payload) : extractResponsesText(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeRequestError(error: unknown) {
    if (error instanceof ModelRequestError) return error;
    if (error instanceof Error && error.name === "AbortError") {
      return new ModelRequestError({
        kind: "transient",
        message: "Model request timed out.",
      });
    }
    if (error instanceof TypeError) {
      return new ModelRequestError({
        kind: "transient",
        message: "Model network request failed.",
      });
    }
    return undefined;
  }

  private cooldownDuration(kind: ModelRequestError["kind"]) {
    return kind === "quota" || kind === "candidate"
      ? this.config.VLM_FAILOVER_COOLDOWN_MS
      : this.transientCooldownDuration();
  }

  private transientCooldownDuration() {
    return Math.min(this.config.VLM_FAILOVER_COOLDOWN_MS, 60_000);
  }
}
