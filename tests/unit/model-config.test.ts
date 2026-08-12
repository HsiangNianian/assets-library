import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/config";

describe("model configuration", () => {
  it("builds the VLM target from the current settings", () => {
    const config = loadConfig({
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: "https://models.example/v1/",
      VLM_API_KEY: "vision-key",
      VLM_NAME: "qwen3.7-plus",
      VLM_ENABLE_THINKING: "false",
    });

    expect(config.models.vlm).toEqual({
      role: "vlm",
      protocol: "openai_chat_completions",
      baseUrl: "https://models.example/v1",
      apiKey: "vision-key",
      name: "qwen3.7-plus",
      configured: true,
      requestOptions: { enableThinking: false },
    });
    expect(config.models.llm).toMatchObject({
      role: "llm",
      configured: false,
      name: undefined,
      requestOptions: { enableThinking: null },
    });
  });

  it("keeps VLM and LLM targets independent", () => {
    const config = loadConfig({
      VLM_PROTOCOL: "openai_chat_completions",
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_API_KEY: "vision-key",
      VLM_NAME: "qwen3.7-plus",
      VLM_ENABLE_THINKING: "false",
      LLM_PROTOCOL: "openai_responses",
      LLM_BASE_URL: "https://text.example/v1/",
      LLM_API_KEY: "text-key",
      LLM_NAME: "Qwythos",
      LLM_ENABLE_THINKING: "true",
    });

    expect(config.models.vlm).toMatchObject({
      role: "vlm",
      protocol: "openai_chat_completions",
      baseUrl: "https://vision.example/v1",
      apiKey: "vision-key",
      name: "qwen3.7-plus",
      configured: true,
      requestOptions: { enableThinking: false },
    });
    expect(config.models.llm).toMatchObject({
      role: "llm",
      protocol: "openai_responses",
      baseUrl: "https://text.example/v1",
      apiKey: "text-key",
      name: "Qwythos",
      configured: true,
      requestOptions: { enableThinking: true },
    });
  });

  it("allows an authentication-free OpenAI-compatible VLM endpoint", () => {
    const config = loadConfig({
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "vision-model",
    });

    expect(config.models.vlm.configured).toBe(true);
    expect(config.models.vlm.apiKey).toBeUndefined();
  });

  it("treats an empty thinking option as unsupported instead of false", () => {
    const config = loadConfig({
      VLM_BASE_URL: "https://models.example/v1",
      VLM_API_KEY: "shared-key",
      VLM_NAME: "vision-model",
      LLM_BASE_URL: "https://text.example/v1",
      LLM_API_KEY: "",
      LLM_NAME: "Qwythos",
      LLM_ENABLE_THINKING: "",
    });

    expect(config.models.llm.requestOptions.enableThinking).toBeNull();
    expect(config.models.llm.apiKey).toBe("shared-key");
  });

  it("applies model-family thinking defaults unless explicitly overridden", () => {
    const config = loadConfig({
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_NAME: "qwen3.7-plus",
      LLM_BASE_URL: "https://text.example/v1",
      LLM_NAME: "qwen3.7-plus",
      LLM_ENABLE_THINKING: "true",
    });

    expect(config.models.vlm.requestOptions.enableThinking).toBe(false);
    expect(config.models.llm.requestOptions.enableThinking).toBe(true);
  });

  it("uses the first configured model target as the embedding fallback", () => {
    const llmOnly = loadConfig({
      LLM_BASE_URL: "https://text.example/v1",
      LLM_API_KEY: "text-key",
      LLM_NAME: "text-model",
      EMBEDDING_MODEL: "embedding-model",
    });
    const bothTargets = loadConfig({
      VLM_BASE_URL: "https://vision.example/v1",
      VLM_API_KEY: "vision-key",
      VLM_NAME: "vision-model",
      LLM_BASE_URL: "https://text.example/v1",
      LLM_API_KEY: "text-key",
      LLM_NAME: "text-model",
      EMBEDDING_MODEL: "embedding-model",
    });

    expect(llmOnly.embeddingBaseUrl).toBe("https://text.example/v1");
    expect(llmOnly.embeddingApiKey).toBe("text-key");
    expect(llmOnly.embeddingConfigured).toBe(true);
    expect(bothTargets.embeddingBaseUrl).toBe("https://vision.example/v1");
    expect(bothTargets.embeddingApiKey).toBe("vision-key");
  });
});
