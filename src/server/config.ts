import path from "node:path";
import { z } from "zod";

const modelProtocolSchema = z.enum([
  "openai_chat_completions",
  "openai_responses",
]);
const optionalBooleanSchema = z
  .union([z.enum(["true", "false"]), z.literal("")])
  .optional();
const MODEL_FAMILY_THINKING_DEFAULTS = [
  { namePattern: /^qwen3\.[5-9]/i, enableThinking: false },
] as const;

export type ModelProtocol = z.infer<typeof modelProtocolSchema>;
export type ModelRole = "vlm" | "llm";

interface ModelTargetBase {
  role: ModelRole;
  protocol: ModelProtocol;
  apiKey?: string;
  requestOptions: {
    enableThinking: boolean | null;
  };
}

export type ModelTarget = ModelTargetBase &
  (
    | { configured: true; baseUrl: string; name: string }
    | { configured: false; baseUrl?: string; name?: string }
  );
type ConfiguredModelTarget = Extract<ModelTarget, { configured: true }>;

const envSchema = z.object({
  DATABASE_PATH: z.string().default("./data/assets.db"),
  MEDIA_ROOT: z.string().default("./media"),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  VLM_PROTOCOL: modelProtocolSchema.default("openai_chat_completions"),
  VLM_BASE_URL: z.string().url().optional().or(z.literal("")),
  VLM_API_KEY: z.string().optional(),
  VLM_NAME: z.string().optional(),
  VLM_ENABLE_THINKING: optionalBooleanSchema,
  VLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  VLM_VIDEO_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  VLM_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
  VLM_VIDEO_MODE: z.enum(["disabled", "frames"]).default("frames"),
  LLM_PROTOCOL: modelProtocolSchema.default("openai_chat_completions"),
  LLM_BASE_URL: z.string().url().optional().or(z.literal("")),
  LLM_API_KEY: z.string().optional(),
  LLM_NAME: z.string().optional(),
  LLM_ENABLE_THINKING: optionalBooleanSchema,
  CHROMA_URL: z.string().url().default("http://127.0.0.1:8000"),
  CHROMA_COLLECTION: z.string().min(3).default("asset_analysis"),
  CHROMA_TENANT: z.string().default("default_tenant"),
  CHROMA_DATABASE: z.string().default("default_database"),
  EMBEDDING_BASE_URL: z.string().url().optional().or(z.literal("")),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

function optionalValue(value: string | undefined) {
  return value?.trim() || undefined;
}

function defaultThinkingOption(modelName: string | undefined) {
  return (
    MODEL_FAMILY_THINKING_DEFAULTS.find(({ namePattern }) =>
      namePattern.test(modelName ?? ""),
    )?.enableThinking ?? null
  );
}

function thinkingOption(
  value: string | undefined,
  modelName: string | undefined,
) {
  const normalizedValue = optionalValue(value);
  if (normalizedValue !== undefined) return normalizedValue === "true";
  return defaultThinkingOption(modelName);
}

function firstConfiguredModelTarget(
  targets: readonly ModelTarget[],
): ConfiguredModelTarget | undefined {
  return targets.find(
    (target): target is ConfiguredModelTarget => target.configured,
  );
}

function modelTarget(
  role: ModelRole,
  protocol: ModelProtocol,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  name: string | undefined,
  enableThinking: string | undefined,
): ModelTarget {
  const normalizedBaseUrl = optionalValue(baseUrl)?.replace(/\/$/, "");
  const normalizedApiKey = optionalValue(apiKey);
  const normalizedName = optionalValue(name);
  const target = {
    role,
    protocol,
    apiKey: normalizedApiKey,
    requestOptions: {
      enableThinking: thinkingOption(enableThinking, normalizedName),
    },
  };
  if (normalizedBaseUrl && normalizedName) {
    return {
      ...target,
      configured: true,
      baseUrl: normalizedBaseUrl,
      name: normalizedName,
    };
  }
  return {
    ...target,
    configured: false,
    baseUrl: normalizedBaseUrl,
    name: normalizedName,
  };
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = envSchema.parse(env);
  const vlm = modelTarget(
    "vlm",
    parsed.VLM_PROTOCOL,
    parsed.VLM_BASE_URL,
    parsed.VLM_API_KEY,
    parsed.VLM_NAME,
    parsed.VLM_ENABLE_THINKING,
  );
  const llm = modelTarget(
    "llm",
    parsed.LLM_PROTOCOL,
    parsed.LLM_BASE_URL || vlm.baseUrl,
    optionalValue(parsed.LLM_API_KEY) ?? vlm.apiKey,
    parsed.LLM_NAME,
    parsed.LLM_ENABLE_THINKING,
  );
  const embeddingFallbackTarget = firstConfiguredModelTarget([vlm, llm]);
  const embeddingBaseUrl =
    optionalValue(parsed.EMBEDDING_BASE_URL)?.replace(/\/$/, "") ??
    embeddingFallbackTarget?.baseUrl;
  const embeddingApiKey =
    optionalValue(parsed.EMBEDDING_API_KEY) ?? embeddingFallbackTarget?.apiKey;
  return {
    ...parsed,
    databasePath: path.resolve(parsed.DATABASE_PATH),
    mediaRoot: path.resolve(parsed.MEDIA_ROOT),
    models: { vlm, llm },
    embeddingBaseUrl,
    embeddingApiKey,
    embeddingConfigured: Boolean(embeddingBaseUrl && parsed.EMBEDDING_MODEL),
  };
}
