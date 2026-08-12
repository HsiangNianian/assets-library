import {
  claimNextJob,
  recoverStaleJobs,
  requeueFailedEmbeddingJobs,
} from "@/server/repositories/assets";
import { loadConfig } from "@/server/config";
import { OpenAICompatibleAnalyzer } from "@/server/model/analyzer";
import { processJob } from "@/server/services/processing";

const pollIntervalMs = 1_000;
const recoveryIntervalMs = 30_000;
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function main() {
  const config = loadConfig();
  const analyzer = new OpenAICompatibleAnalyzer(config);
  recoverStaleJobs();
  const requeuedEmbeddings = requeueFailedEmbeddingJobs();
  if (requeuedEmbeddings > 0) {
    console.log(`Requeued ${requeuedEmbeddings} failed embedding job(s).`);
  }
  const recoveryTimer = setInterval(() => {
    const recovered = recoverStaleJobs();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} stale processing job(s).`);
    }
  }, recoveryIntervalMs);
  const vlmChain =
    config.models.vlmCandidates.map((model) => model.name).join(" -> ") ||
    "not configured";
  const llmChain =
    config.models.llmCandidates.map((model) => model.name).join(" -> ") ||
    "not configured";
  console.log(
    `Asset processing worker started (VLM chain: ${vlmChain}, LLM chain: ${llmChain}, VLM protocol: ${config.models.vlm.protocol}).`,
  );
  while (!stopping) {
    const job = claimNextJob();
    if (job) {
      await processJob(job, analyzer);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  clearInterval(recoveryTimer);
  console.log("Asset processing worker stopped.");
}

void main();
