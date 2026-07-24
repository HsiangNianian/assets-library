import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_PATH: z.string().default("./data/assets.db"),
  MEDIA_ROOT: z.string().default("./media"),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  MODEL_PROTOCOL: z
    .enum(["openai_chat_completions", "openai_responses"])
    .default("openai_chat_completions"),
  MODEL_BASE_URL: z.string().url().optional().or(z.literal("")),
  MODEL_API_KEY: z.string().optional(),
  MODEL_NAME: z.string().optional(),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MODEL_VIDEO_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  MODEL_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
  MODEL_VIDEO_MODE: z.enum(["disabled", "frames"]).default("frames"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    databasePath: path.resolve(parsed.DATABASE_PATH),
    mediaRoot: path.resolve(parsed.MEDIA_ROOT),
    modelConfigured: Boolean(
      parsed.MODEL_BASE_URL && parsed.MODEL_API_KEY && parsed.MODEL_NAME,
    ),
  };
}
