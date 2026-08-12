import {
  claimNextJob,
  deleteExpiredTasks,
  recoverStaleJobs,
  requeueFailedEmbeddingJobs,
} from "@/server/repositories/assets";
import { loadConfig } from "@/server/config";
import { OpenAICompatibleAnalyzer } from "@/server/model/analyzer";
import { processJob } from "@/server/services/processing";
import {
  cleanupExpiredStaging,
  expireAbandonedUploadTasks,
} from "@/server/services/staging-cleanup";
import { reconcileActiveTaskLifecycles } from "@/server/services/task-lifecycle";

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
  const cleanupIntervalMs = config.CLEANUP_INTERVAL_SECONDS * 1_000;
  const analyzer = new OpenAICompatibleAnalyzer(config);
  await recoverStaleJobs();
  await reconcileActiveTaskLifecycles();
  const requeuedEmbeddings = await requeueFailedEmbeddingJobs();
  if (requeuedEmbeddings > 0) {
    console.log(`Requeued ${requeuedEmbeddings} failed embedding job(s).`);
  }
  const recoveryTimer = setInterval(() => {
    void recoverStaleJobs()
      .then((recovered) => {
        if (recovered > 0) {
          console.log(`Recovered ${recovered} stale processing job(s).`);
        }
      })
      .catch((error) => {
        console.error("Failed to recover stale jobs.", error);
      });
  }, recoveryIntervalMs);
  await Promise.all([
    cleanupExpiredStaging(),
    expireAbandonedUploadTasks(),
    deleteExpiredTasks(),
    reconcileActiveTaskLifecycles(),
  ]);
  const cleanupTimer = setInterval(() => {
    void Promise.all([
      cleanupExpiredStaging(),
      expireAbandonedUploadTasks(),
      deleteExpiredTasks(),
      reconcileActiveTaskLifecycles(),
    ])
      .then(([removedFiles, expiredUploads, removedTasks, reconciledTasks]) => {
        if (removedFiles > 0) {
          console.log(`Removed ${removedFiles} expired staging task(s).`);
        }
        if (expiredUploads > 0) {
          console.log(`Marked ${expiredUploads} abandoned upload task(s) as failed.`);
        }
        if (removedTasks > 0) {
          console.log(`Removed ${removedTasks} expired task record(s).`);
        }
        if (reconciledTasks > 0) {
          console.log(`Reconciled ${reconciledTasks} active task lifecycle(s).`);
        }
      })
      .catch((error) => {
        console.error("Failed to clean expired staging files.", error);
      });
  }, cleanupIntervalMs);
  cleanupTimer.unref();
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
    const job = await claimNextJob();
    if (job) {
      await processJob(job, analyzer);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  clearInterval(recoveryTimer);
  clearInterval(cleanupTimer);
  console.log("Asset processing worker stopped.");
}

void main();
