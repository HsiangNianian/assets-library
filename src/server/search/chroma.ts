import { loadConfig } from "@/server/config";
import type { AnalysisResult } from "@/shared/contracts";

type ChromaCollection = { id: string; name: string };
const semanticSimilarityThreshold = 0.45;

function chromaBaseUrl() {
  return loadConfig().CHROMA_URL.replace(/\/$/, "");
}

function chromaDatabasePath() {
  const config = loadConfig();
  return `${chromaBaseUrl()}/api/v2/tenants/${encodeURIComponent(config.CHROMA_TENANT)}/databases/${encodeURIComponent(config.CHROMA_DATABASE)}`;
}

async function chromaRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${chromaDatabasePath()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`Chroma 请求失败：HTTP ${response.status}。`);
  }
  return (await response.json()) as T;
}

async function collection() {
  const config = loadConfig();
  const collections = await chromaRequest<ChromaCollection[]>("/collections?limit=100&offset=0");
  const existing = collections.find((item) => item.name === config.CHROMA_COLLECTION);
  if (existing) return existing;
  try {
    return await chromaRequest<ChromaCollection>("/collections", {
      method: "POST",
      body: JSON.stringify({ name: config.CHROMA_COLLECTION }),
    });
  } catch (error) {
    const refreshed = await chromaRequest<ChromaCollection[]>("/collections?limit=100&offset=0");
    const created = refreshed.find((item) => item.name === config.CHROMA_COLLECTION);
    if (created) return created;
    throw error;
  }
}

async function embed(texts: string[]) {
  const config = loadConfig();
  if (!config.embeddingConfigured || !config.embeddingBaseUrl || !config.EMBEDDING_MODEL) {
    return [];
  }
  const response = await fetch(`${config.embeddingBaseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.embeddingApiKey ? { authorization: `Bearer ${config.embeddingApiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: texts }),
  });
  if (!response.ok) throw new Error(`Embedding 服务返回 HTTP ${response.status}。`);
  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const vectors = payload.data?.map((item) => item.embedding);
  if (!vectors || vectors.length !== texts.length || vectors.some((item) => !item?.length)) {
    throw new Error("Embedding 服务返回无效向量。");
  }
  return vectors as number[][];
}

function tokenize(text: string) {
  const compact = text.trim().replace(/\s+/g, " ");
  const terms = compact.match(/[\p{Script=Han}]{2,}|[\p{L}\p{N}_-]+/gu) ?? [];
  return terms.flatMap((term) => {
    const characters = Array.from(term);
    if (!/^[\p{Script=Han}]+$/u.test(term) || characters.length < 3) return [term];
    return [term, ...characters.slice(0, -1).map((_, index) => characters.slice(index, index + 2).join(""))];
  }).join(" ");
}

function analysisPassages(result: AnalysisResult) {
  if (result.kind === "image") {
    return [
      result.description,
      ...Object.entries(result.tags).flatMap(([category, values]) => values.map((value) => `${category} ${value}`)),
      result.ocr.text ?? "",
    ].filter(Boolean);
  }
  return [
    result.description,
    ...result.topics,
    ...Object.entries(result.tags).flatMap(([category, values]) => values.map((value) => `${category} ${value}`)),
    ...result.visualSegments.map((item) => item.summary),
    ...result.keyMoments.map((item) => item.summary),
    ...result.timeline.map((item) => item.summary),
  ].filter(Boolean);
}

export function semanticSearchEnabled() {
  return loadConfig().embeddingConfigured;
}

export async function indexAnalysis(assetId: string, result: AnalysisResult) {
  const passages = analysisPassages(result).map(tokenize).filter(Boolean);
  if (!passages.length) return;
  const vectors = await embed(passages);
  if (!vectors.length) return;
  const target = await collection();
  await chromaRequest(`/collections/${encodeURIComponent(target.id)}/delete`, {
    method: "POST",
    body: JSON.stringify({ where: { assetId } }),
  });
  await chromaRequest(`/collections/${encodeURIComponent(target.id)}/upsert`, {
    method: "POST",
    body: JSON.stringify({
      ids: passages.map((_, index) => `${assetId}:${index}`),
      documents: passages,
      embeddings: vectors,
      metadatas: passages.map((_, index) => ({ assetId, chunk: index })),
    }),
  });
}

export async function searchAnalysis(query: string, limit: number) {
  if (!semanticSearchEnabled()) return new Map<string, number>();
  const vectors = await embed([tokenize(query)]);
  if (!vectors.length) return new Map<string, number>();
  const target = await collection();
  const result = await chromaRequest<{
    distances?: Array<Array<number | null>>;
    metadatas?: Array<Array<{ assetId?: string } | null>>;
  }>(`/collections/${encodeURIComponent(target.id)}/query`, {
    method: "POST",
    body: JSON.stringify({
      query_embeddings: vectors,
      n_results: limit,
      include: ["metadatas", "distances"],
    }),
  });
  const scores = new Map<string, number>();
  for (const [index, metadata] of (result.metadatas?.[0] ?? []).entries()) {
    const assetId = metadata?.assetId;
    const distance = result.distances?.[0]?.[index];
    if (!assetId || distance === null || distance === undefined) continue;
    const similarity = 1 / (1 + distance);
    if (similarity <= semanticSimilarityThreshold) continue;
    scores.set(
      assetId,
      Math.max(scores.get(assetId) ?? 0, similarity),
    );
  }
  return scores;
}
