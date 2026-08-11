import {
  claimNextJob,
  recoverStaleJobs,
  requeueFailedEmbeddingJobs,
} from "@/server/repositories/assets";
import { loadConfig } from "@/server/config";
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
  console.log(
    `Asset processing worker started (model: ${config.modelConfigured ? "configured" : "not configured"}, protocol: ${config.MODEL_PROTOCOL}).`,
  );
  while (!stopping) {
    const job = claimNextJob();
    if (job) {
      await processJob(job);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  clearInterval(recoveryTimer);
  console.log("Asset processing worker stopped.");
}

void main();
