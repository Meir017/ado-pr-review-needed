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
import { runConcurrent, DEFAULT_CONCURRENCY } from "./concurrency.js";
import { detectLabels } from "./file-patterns.js";
import type { RepoPatternsConfig } from "./config.js";

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

async function fetchChangedFiles(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  pullRequestId: number,
): Promise<string[]> {
  const iterations = await withRetry(
    `Fetch iterations for PR #${pullRequestId} (file patterns)`,
    () => gitApi.getPullRequestIterations(repositoryId, pullRequestId, project),
  );

  if (!iterations || iterations.length === 0) return [];

  const lastIteration = iterations[iterations.length - 1];
  const iterationId = lastIteration.id!;

  const paths: string[] = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const iterChanges = await withRetry(
      `Fetch iteration changes for PR #${pullRequestId} iter ${iterationId} (file patterns)`,
      () => gitApi.getPullRequestIterationChanges(repositoryId, pullRequestId, iterationId, project, top, skip),
    );

    for (const entry of iterChanges.changeEntries ?? []) {
      const path = entry.item?.path ?? "";
      if (path) paths.push(path);
    }

    if ((iterChanges.nextSkip ?? 0) === 0 && (iterChanges.nextTop ?? 0) === 0) break;
    skip = iterChanges.nextSkip ?? skip + top;
    if ((iterChanges.changeEntries ?? []).length === 0) break;
  }

  return paths;
}

export async function fetchOpenPullRequests(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  orgUrl: string,
  quantifierConfig?: QuantifierConfig,
  patterns: RepoPatternsConfig = { ignore: [], labels: {} },
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
  log.info(`Fetching threads for ${candidates.length} PRs (concurrency: ${DEFAULT_CONCURRENCY})…`);

  const results = await runConcurrent(candidates, DEFAULT_CONCURRENCY, async (pr) => {
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

    // Detect labels from file patterns
    let detectedLabels: string[] = [];
    if (Object.keys(patterns.labels).length > 0) {
      const changedFiles = await fetchChangedFiles(gitApi, repositoryId, project, prId);
      detectedLabels = detectLabels(changedFiles, patterns.ignore, patterns.labels);
      if (detectedLabels.length > 0) {
        log.debug(`  #${prId} — detected labels: ${detectedLabels.join(", ")}`);
        // Add detected labels that aren't already on the PR
        for (const label of detectedLabels) {
          if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) {
            try {
              await withRetry(`Add label '${label}' to PR #${prId}`, () =>
                gitApi.createPullRequestLabel({ name: label }, repositoryId, prId, project),
              );
              labels.push(label);
              log.debug(`  #${prId} — added label '${label}'`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              log.debug(`  #${prId} — failed to add label '${label}': ${msg}`);
            }
          }
        }
      }
    }

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
      detectedLabels,
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
