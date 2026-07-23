import {
  claimNextJob,
  recoverStaleJobs,
} from "@/server/repositories/assets";
import { loadConfig } from "@/server/config";
import { processJob } from "@/server/services/processing";

const pollIntervalMs = 1_000;
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
  console.log("Asset processing worker stopped.");
}

void main();
