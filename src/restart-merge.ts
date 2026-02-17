import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type { PullRequestInfo } from "./types.js";
import { withRetry } from "./retry.js";
import * as log from "./log.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
): Promise<number> {
  if (restartMergeAfterDays < 0) {
    log.debug("Restart merge is disabled (restartMergeAfterDays < 0)");
    return 0;
  }

  const cutoff = new Date(now.getTime() - restartMergeAfterDays * MS_PER_DAY);
  const stalePrs = prs.filter((pr) => pr.createdDate < cutoff);

  if (stalePrs.length === 0) {
    log.debug("No PRs older than the restart-merge threshold");
    return 0;
  }

  log.info(`Restarting merge for ${stalePrs.length} PR(s) older than ${restartMergeAfterDays} days…`);

  let restarted = 0;
  for (const pr of stalePrs) {
    try {
      await withRetry(`Restart merge for PR #${pr.id}`, () =>
        gitApi.updatePullRequest({ mergeStatus: 1 }, repositoryId, pr.id, project),
      );
      log.debug(`  #${pr.id} "${pr.title}" — merge restarted`);
      restarted++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`  #${pr.id} "${pr.title}" — failed to restart merge: ${msg}`);
    }
  }

  log.success(`Restarted merge for ${restarted}/${stalePrs.length} PR(s)`);
  return restarted;
}
