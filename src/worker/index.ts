import {
  claimNextJob,
  recoverStaleJobs,
} from "@/server/repositories/assets";
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
  recoverStaleJobs();
  console.log("Asset processing worker started.");
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
