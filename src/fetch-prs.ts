import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type { IBuildApi } from "azure-devops-node-api/BuildApi.js";
import {
  PullRequestStatus,
  type GitPullRequest,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import {
  BuildResult,
  BuildStatus,
} from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import type { PullRequestInfo, ThreadInfo, ThreadComment, QuantifierConfig, PipelineStatus, PipelineRunInfo, PipelineOutcome } from "./types.js";
import { identityUniqueName } from "./types.js";
import * as log from "./log.js";
import { withRetry } from "./retry.js";
import { computePrSize } from "./analysis/pr-quantifier.js";
import { runConcurrent, DEFAULT_CONCURRENCY } from "./concurrency.js";
import { detectLabels } from "./analysis/file-patterns.js";
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
  const iterationId = lastIteration.id;
  if (iterationId == null) return [];

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

export function mapBuildResult(status: BuildStatus | undefined, result: BuildResult | undefined): PipelineOutcome {
  if (status === BuildStatus.InProgress) return "inProgress";
  if (status === BuildStatus.NotStarted) return "notStarted";
  switch (result) {
    case BuildResult.Succeeded: return "succeeded";
    case BuildResult.Failed: return "failed";
    case BuildResult.PartiallySucceeded: return "partiallySucceeded";
    case BuildResult.Canceled: return "canceled";
    default: return "none";
  }
}

export async function fetchPipelineStatus(
  buildApi: IBuildApi,
  repositoryId: string,
  project: string,
  pullRequestId: number,
): Promise<PipelineStatus | undefined> {
  try {
    const branchName = `refs/pull/${pullRequestId}/merge`;
    const builds = await withRetry(
      `Fetch builds for PR #${pullRequestId}`,
      () => buildApi.getBuilds(
        project,
        undefined, // definitions
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter
        undefined, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        10,        // top - latest 10 builds
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        undefined, // queryOrder
        branchName,
        undefined, // buildIds
        repositoryId,
        "TfsGit",
      ),
    );

    if (!builds || builds.length === 0) return undefined;

    // De-duplicate: keep only the latest build per pipeline definition
    const latestByDef = new Map<number, typeof builds[0]>();
    for (const b of builds) {
      const defId = b.definition?.id ?? 0;
      if (!latestByDef.has(defId)) {
        latestByDef.set(defId, b);
      }
    }

    const runs: PipelineRunInfo[] = [];
    let succeeded = 0;
    let failed = 0;
    let inProgress = 0;
    let other = 0;

    for (const b of latestByDef.values()) {
      const outcome = mapBuildResult(b.status, b.result);
      runs.push({
        id: b.id ?? 0,
        name: b.definition?.name ?? "Unknown",
        status: BuildStatus[b.status ?? BuildStatus.None] ?? "None",
        result: outcome,
      });
      switch (outcome) {
        case "succeeded": succeeded++; break;
        case "failed": failed++; break;
        case "inProgress": case "notStarted": inProgress++; break;
        default: other++; break;
      }
    }

    return { total: runs.length, succeeded, failed, inProgress, other, runs };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug(`  #${pullRequestId} — failed to fetch pipeline status: ${msg}`);
    return undefined;
  }
}

export async function fetchOpenPullRequests(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  orgUrl: string,
  quantifierConfig?: QuantifierConfig,
  patterns: RepoPatternsConfig = { ignore: [], labels: {} },
  buildApi?: IBuildApi,
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

  // Resolve repo name → GUID for the Build API (requires a GUID, not a name)
  let repoGuid: string | undefined;
  if (buildApi) {
    try {
      const repo = await withRetry("Resolve repository GUID", () =>
        gitApi.getRepository(repositoryId, project),
      );
      repoGuid = repo.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug(`Failed to resolve repository GUID for ${repositoryId}: ${msg}`);
    }
  }

  const candidates = filterCandidates(prs);
  log.info(`Fetching threads for ${candidates.length} PRs in ${project}/${repositoryId} (concurrency: ${DEFAULT_CONCURRENCY})…`);

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
      }
    }

    // Fetch pipeline status
    const pipelineStatus = buildApi && repoGuid
      ? await fetchPipelineStatus(buildApi, repoGuid, project, prId)
      : undefined;

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
      description: pr.description ?? undefined,
      sourceBranch: pr.sourceRefName ?? undefined,
      targetBranch: pr.targetRefName ?? undefined,
      pipelineStatus,
    } satisfies PullRequestInfo;
  });

  log.debug(`${results.length} PRs remain after filtering`);
  return results;
}

/**
 * Apply detected labels to PRs in Azure DevOps.
 * Separated from fetchOpenPullRequests to keep data fetching pure.
 */
export async function applyDetectedLabels(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  prs: PullRequestInfo[],
): Promise<void> {
  for (const pr of prs) {
    if (pr.detectedLabels.length === 0) continue;
    for (const label of pr.detectedLabels) {
      if (!pr.labels.some((l) => l.toLowerCase() === label.toLowerCase())) {
        try {
          await withRetry(`Add label '${label}' to PR #${pr.id}`, () =>
            gitApi.createPullRequestLabel({ name: label }, repositoryId, pr.id, project),
          );
          pr.labels.push(label);
          log.debug(`  #${pr.id} — added label '${label}'`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.debug(`  #${pr.id} — failed to add label '${label}': ${msg}`);
        }
      }
    }
  }
}
