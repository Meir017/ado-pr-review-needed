import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import {
  PullRequestStatus,
  type GitPullRequest,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { PullRequestInfo, ThreadInfo, ThreadComment, QuantifierConfig } from "./types.js";
import { identityUniqueName } from "./types.js";
import * as log from "./log.js";
import { withRetry } from "./retry.js";
import { computePrSize } from "./pr-quantifier.js";

const CONCURRENCY = 10;

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function filterCandidates(prs: GitPullRequest[]): GitPullRequest[] {
  const candidates: GitPullRequest[] = [];
  let skippedDraft = 0;
  let skippedNoMerge = 0;

  for (const pr of prs) {
    if (pr.isDraft) {
      skippedDraft++;
      log.debug(`  #${pr.pullRequestId} — draft, skipping`);
      continue;
    }
    const labels = (pr.labels ?? []).map((l) => l.name ?? "");
    if (labels.some((l) => l.toUpperCase() === "NO-MERGE")) {
      skippedNoMerge++;
      log.debug(`  #${pr.pullRequestId} — NO-MERGE label, skipping`);
      continue;
    }
    candidates.push(pr);
  }

  if (skippedDraft > 0) log.debug(`Skipped ${skippedDraft} draft PRs`);
  if (skippedNoMerge > 0) log.debug(`Skipped ${skippedNoMerge} NO-MERGE PRs`);
  return candidates;
}

export async function fetchOpenPullRequests(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  orgUrl: string,
  quantifierConfig?: QuantifierConfig,
): Promise<PullRequestInfo[]> {
  // Convert old visualstudio.com URLs to dev.azure.com
  // e.g. https://microsoft.visualstudio.com -> https://dev.azure.com/microsoft
  let baseUrl: string;
  try {
    const parsed = new URL(orgUrl);
    if (parsed.hostname.endsWith(".visualstudio.com")) {
      const org = parsed.hostname.replace(".visualstudio.com", "");
      baseUrl = `https://dev.azure.com/${org}`;
    } else {
      baseUrl = orgUrl.replace(/\/$/, "");
    }
  } catch {
    baseUrl = orgUrl.replace(/\/$/, "");
  }

  const prs = await withRetry("Fetch pull requests", () =>
    gitApi.getPullRequests(repositoryId, {
      status: PullRequestStatus.Active,
    }, project),
  );

  log.debug(`API returned ${prs.length} active pull requests`);

  const candidates = filterCandidates(prs);
  log.info(`Fetching threads for ${candidates.length} PRs (concurrency: ${CONCURRENCY})…`);

  const results = await runConcurrent(candidates, CONCURRENCY, async (pr) => {
    const prId = pr.pullRequestId!;
    log.debug(`  #${prId} — fetching threads…`);

    const rawThreads = await withRetry(`Fetch threads for PR #${prId}`, () =>
      gitApi.getThreads(repositoryId, prId, project),
    );
    const threads: ThreadInfo[] = rawThreads.map((t) => ({
      id: t.id ?? 0,
      publishedDate: new Date(t.publishedDate ?? 0),
      comments: (t.comments ?? [])
        .filter((c) => !c.isDeleted)
        .map(
          (c): ThreadComment => ({
            authorUniqueName: identityUniqueName(c.author),
            publishedDate: new Date(c.publishedDate ?? 0),
          }),
        ),
    }));

    const reviewers = (pr.reviewers ?? []).map((r) => ({
      displayName: r.displayName ?? "",
      uniqueName: identityUniqueName(r),
      vote: r.vote ?? 0,
    }));

    const url = `${baseUrl}/${project}/_git/${repositoryId}/pullrequest/${prId}`;
    const labels = (pr.labels ?? []).map((l) => l.name ?? "");

    return {
      id: prId,
      title: pr.title ?? "(no title)",
      author: pr.createdBy?.displayName ?? "Unknown",
      authorUniqueName: identityUniqueName(pr.createdBy),
      url,
      createdDate: new Date(pr.creationDate ?? 0),
      reviewers,
      threads,
      labels,
      mergeStatus: pr.mergeStatus ?? 0,
      lastSourcePushDate: pr.lastMergeSourceCommit?.committer?.date
        ? new Date(pr.lastMergeSourceCommit.committer.date)
        : undefined,
      size: quantifierConfig
        ? await computePrSize(gitApi, repositoryId, project, prId, quantifierConfig)
        : undefined,
    } satisfies PullRequestInfo;
  });

  log.debug(`${results.length} PRs remain after filtering`);
  return results;
}
