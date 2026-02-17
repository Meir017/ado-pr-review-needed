import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type { PullRequestInfo } from "./types.js";
import { withRetry, NonRetryableError } from "./retry.js";
import * as log from "./log.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ADO error codes that should not be retried
const NON_RETRYABLE_PREFIXES = [
  "TF401398", // source/target branch no longer exists
  "TF401027", // missing PullRequestContribute permission
];

export interface RestartMergeResult {
  restarted: number;
  failed: number;
  restartedPrIds: number[];
}

/**
 * Triggers "restart merge" on PRs older than the configured threshold.
 * Sends PATCH with { mergeStatus: 1 } (Queued) to re-evaluate merge status.
 */
export async function restartMergeForStalePrs(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  prs: PullRequestInfo[],
  restartMergeAfterDays: number,
  now: Date = new Date(),
): Promise<RestartMergeResult> {
  if (restartMergeAfterDays < 0) {
    log.debug("Restart merge is disabled (restartMergeAfterDays < 0)");
    return { restarted: 0, failed: 0, restartedPrIds: [] };
  }

  const cutoff = new Date(now.getTime() - restartMergeAfterDays * MS_PER_DAY);
  const stalePrs = prs.filter((pr) => pr.createdDate < cutoff);

  if (stalePrs.length === 0) {
    log.debug("No PRs older than the restart-merge threshold");
    return { restarted: 0, failed: 0, restartedPrIds: [] };
  }

  log.info(`Restarting merge for ${stalePrs.length} PR(s) older than ${restartMergeAfterDays} days…`);

  let restarted = 0;
  let failed = 0;
  const restartedPrIds: number[] = [];
  for (const pr of stalePrs) {
    try {
      await withRetry(`Restart merge for PR #${pr.id}`, async () => {
        try {
          return await gitApi.updatePullRequest({ mergeStatus: 1 }, repositoryId, pr.id, project);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (NON_RETRYABLE_PREFIXES.some((p) => msg.includes(p))) {
            throw new NonRetryableError(msg);
          }
          throw err;
        }
      });
      log.debug(`  #${pr.id} "${pr.title}" — merge restarted`);
      restarted++;
      restartedPrIds.push(pr.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`  #${pr.id} "${pr.title}" — failed to restart merge: ${msg}`);
      failed++;
    }
  }

  log.success(`Restarted merge for ${restarted}/${stalePrs.length} PR(s)`);
  return { restarted, failed, restartedPrIds };
}
