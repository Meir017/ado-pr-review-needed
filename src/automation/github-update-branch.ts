import { githubFetch } from "../github-client.js";
import type { PullRequestInfo } from "../types.js";
import * as log from "../log.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UpdateBranchResult {
  updated: number;
  failed: number;
  updatedPrIds: number[];
}

/**
 * Update PR branch (merge base into head) for stale PRs on GitHub.
 * Equivalent to ADO's "restart merge" — ensures the PR is up-to-date.
 */
export async function updateBranchForStalePrs(
  token: string,
  owner: string,
  repo: string,
  prs: PullRequestInfo[],
  updateAfterDays: number,
  now: Date = new Date(),
): Promise<UpdateBranchResult> {
  if (updateAfterDays < 0) {
    log.debug("Update branch is disabled (restartMergeAfterDays < 0)");
    return { updated: 0, failed: 0, updatedPrIds: [] };
  }

  const cutoff = new Date(now.getTime() - updateAfterDays * MS_PER_DAY);
  const stalePrs = prs.filter((pr) => pr.createdDate < cutoff);

  if (stalePrs.length === 0) {
    log.debug("No GitHub PRs older than the update-branch threshold");
    return { updated: 0, failed: 0, updatedPrIds: [] };
  }

  log.info(`Updating branch for ${stalePrs.length} GitHub PR(s) older than ${updateAfterDays} days…`);

  let updated = 0;
  let failed = 0;
  const updatedPrIds: number[] = [];

  for (const pr of stalePrs) {
    try {
      await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.id}/update-branch`,
        { token, method: "PUT", body: {} },
      );
      log.debug(`  #${pr.id} "${pr.title}" — branch updated`);
      updated++;
      updatedPrIds.push(pr.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 422 = merge conflict or branch can't be updated
      // 403 = insufficient permissions
      if (msg.includes("422") || msg.includes("409")) {
        log.debug(`  #${pr.id} "${pr.title}" — cannot update branch (conflict or already up-to-date)`);
      } else if (msg.includes("403")) {
        log.warn(`  #${pr.id} "${pr.title}" — insufficient permissions to update branch`);
      } else {
        log.warn(`  #${pr.id} "${pr.title}" — failed to update branch: ${msg}`);
      }
      failed++;
    }
  }

  log.success(`Updated branch for ${updated}/${stalePrs.length} GitHub PR(s)`);
  return { updated, failed, updatedPrIds };
}
