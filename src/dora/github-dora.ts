import { githubFetchAllPages, githubFetch } from "../github-client.js";
import { computeDoraMetrics } from "./compute-dora.js";
import type { MergedPrInfo } from "./compute-dora.js";
import type { DoraMetrics, BuildInfo } from "../types.js";
import { withRetry } from "../retry.js";
import * as log from "../log.js";

interface GitHubMergedPr {
  number: number;
  created_at: string;
  merged_at: string | null;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  conclusion: string | null; // success, failure, cancelled, etc.
  created_at: string;
  updated_at: string;
  workflow_id: number;
}

interface GitHubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

/**
 * Fetch merged PRs from GitHub within the given period.
 */
async function fetchMergedPrs(
  owner: string,
  repo: string,
  since: Date,
  token?: string,
): Promise<MergedPrInfo[]> {
  // Use search API for merged PRs in the period
  const sinceStr = since.toISOString().split("T")[0];
  const searchUrl = `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:pr+is:merged+merged:>=${sinceStr}&per_page=100&sort=updated&order=desc`;

  const response = await withRetry(
    `Search merged PRs for ${owner}/${repo}`,
    () => githubFetch<{ items: GitHubMergedPr[] }>(searchUrl, { token }),
  );

  return response.items
    .filter((pr) => pr.merged_at !== null)
    .map((pr) => ({
      createdDate: new Date(pr.created_at),
      mergedDate: new Date(pr.merged_at!),
    }));
}

/**
 * Fetch workflow runs from GitHub within the given period.
 */
async function fetchWorkflowRuns(
  owner: string,
  repo: string,
  since: Date,
  token?: string,
  workflowIds?: number[],
): Promise<BuildInfo[]> {
  const sinceStr = since.toISOString();
  let url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?created=>${sinceStr}&per_page=100`;

  const response = await withRetry(
    `Fetch workflow runs for ${owner}/${repo}`,
    () => githubFetchAllPages<GitHubWorkflowRun>(url, token),
  );

  let runs = response;

  // Filter by workflow IDs if configured
  if (workflowIds && workflowIds.length > 0) {
    const idSet = new Set(workflowIds);
    runs = runs.filter((r) => idSet.has(r.workflow_id));
  }

  return runs
    .filter((r) => r.conclusion !== null) // only completed runs
    .map((r) => ({
      id: r.id,
      definitionName: r.name,
      startTime: new Date(r.created_at),
      finishTime: new Date(r.updated_at),
      result: r.conclusion === "success" ? "succeeded" as const
        : r.conclusion === "failure" ? "failed" as const
        : r.conclusion === "cancelled" ? "canceled" as const
        : "partiallySucceeded" as const,
      sourceBranch: "",
      sourceVersion: "",
    }));
}

/**
 * Compute DORA metrics for a GitHub repository.
 */
export async function computeGitHubDoraMetrics(
  owner: string,
  repo: string,
  periodDays: number,
  token?: string,
  workflowIds?: number[],
  now: Date = new Date(),
): Promise<DoraMetrics> {
  const since = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  log.info(`Computing DORA metrics for ${owner}/${repo} (${periodDays} day period)…`);

  const [mergedPrs, builds] = await Promise.all([
    fetchMergedPrs(owner, repo, since, token),
    fetchWorkflowRuns(owner, repo, since, token, workflowIds),
  ]);

  log.debug(`  ${mergedPrs.length} merged PRs, ${builds.length} workflow runs`);

  return computeDoraMetrics(mergedPrs, builds, periodDays, now);
}
