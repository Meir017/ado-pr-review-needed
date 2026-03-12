import { githubFetch, githubFetchAllPages } from "./github-client.js";
import { classifyPrSize } from "./analysis/pr-quantifier.js";
import { detectLabels, filterIgnoredFiles } from "./analysis/file-patterns.js";
import { runConcurrent, DEFAULT_CONCURRENCY } from "./concurrency.js";
import { withRetry } from "./retry.js";
import * as log from "./log.js";
import type {
  PullRequestInfo,
  ReviewerInfo,
  ThreadInfo,
  ThreadComment,
  PipelineStatus,
  PipelineRunInfo,
  PipelineOutcome,
  PolicyStatus,
  PolicyEvaluationInfo,
  PolicyEvaluationStatusType,
  PrSizeInfo,
  QuantifierConfig,
  GitHubRepoTarget,
} from "./types.js";
import type { RepoPatternsConfig } from "./config.js";

// GitHub API response types (subset of fields we use)

interface GitHubUser {
  login: string;
  type: string; // "User" | "Bot" | "Organization"
}

interface GitHubLabel {
  name: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  user: GitHubUser;
  html_url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  state: string;
  body: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  labels: GitHubLabel[];
  mergeable_state: string;
  mergeable: boolean | null;
  requested_reviewers: GitHubUser[];
}

interface GitHubReview {
  id: number;
  user: GitHubUser;
  state: string; // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
  submitted_at: string;
  body: string | null;
}

interface GitHubComment {
  id: number;
  user: GitHubUser;
  created_at: string;
  body: string;
}

interface GitHubPrFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
  status: string;
}

interface GitHubCheckRun {
  id: number;
  name: string;
  status: string; // queued, in_progress, completed
  conclusion: string | null; // success, failure, neutral, cancelled, skipped, timed_out, action_required
  html_url: string;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

// Merge status constants matching PullRequestAsyncStatus values
const MERGE_STATUS_OK = 3;
const MERGE_STATUS_CONFLICTS = 2;
const MERGE_STATUS_QUEUED = 1;

function mapMergeStatus(pr: GitHubPullRequest): number {
  if (pr.mergeable === false || pr.mergeable_state === "dirty") return MERGE_STATUS_CONFLICTS;
  if (pr.mergeable_state === "clean" || pr.mergeable_state === "has_hooks") return MERGE_STATUS_OK;
  if (pr.mergeable_state === "behind") return MERGE_STATUS_OK;
  // "unknown" or "unstable" — treat as queued (GitHub is still computing)
  return MERGE_STATUS_QUEUED;
}

function mapReviewVote(state: string): number {
  switch (state) {
    case "APPROVED": return 10;
    case "CHANGES_REQUESTED": return -5;
    case "COMMENTED": return 0;
    case "DISMISSED": return 0;
    case "PENDING": return 0;
    default: return 0;
  }
}

function mapCheckConclusion(conclusion: string | null, status: string): PipelineOutcome {
  if (status !== "completed") return "inProgress";
  switch (conclusion) {
    case "success": return "succeeded";
    case "failure":
    case "timed_out":
    case "action_required": return "failed";
    case "cancelled": return "canceled";
    case "neutral":
    case "skipped": return "none";
    default: return "none";
  }
}

function mapCheckToPolicyStatus(conclusion: string | null, status: string): PolicyEvaluationStatusType {
  if (status !== "completed") return "running";
  switch (conclusion) {
    case "success": return "approved";
    case "failure":
    case "timed_out":
    case "action_required": return "rejected";
    default: return "notApplicable";
  }
}

interface FetchPlan {
  reviews: boolean;
  comments: boolean;
  checks: boolean;
  size: boolean;
}

function determineFetchPlan(pr: GitHubPullRequest): FetchPlan {
  const hasConflict = pr.mergeable === false || pr.mergeable_state === "dirty";
  if (hasConflict) {
    return { reviews: false, comments: false, checks: false, size: true };
  }
  return { reviews: true, comments: true, checks: true, size: true };
}

const API_BASE = "https://api.github.com";

export async function fetchGitHubPullRequests(
  target: GitHubRepoTarget,
  token: string | undefined,
  quantifierConfig: QuantifierConfig | undefined,
  patterns: RepoPatternsConfig,
): Promise<PullRequestInfo[]> {
  const { owner, repo } = target;
  const base = `${API_BASE}/repos/${owner}/${repo}`;

  log.debug(`Fetching open PRs from GitHub: ${owner}/${repo}`);

  // Fetch all open PRs (paginated)
  const ghPrs = await withRetry(
    `Fetch GitHub PRs ${owner}/${repo}`,
    () => githubFetchAllPages<GitHubPullRequest>(`${base}/pulls?state=open`, token),
  );

  // Filter out drafts
  const candidates = ghPrs.filter((pr) => !pr.draft);
  log.debug(`${candidates.length} non-draft open PRs (of ${ghPrs.length} total)`);

  if (candidates.length === 0) return [];

  // Fetch details concurrently (need individual PR data for mergeable_state)
  const enriched = await runConcurrent(candidates, DEFAULT_CONCURRENCY, async (ghPr) => {
    // Fetch individual PR for accurate mergeable_state
    const detailed = await withRetry(
      `Fetch PR #${ghPr.number} details`,
      () => githubFetch<GitHubPullRequest>(`${base}/pulls/${ghPr.number}`, { token }),
    );

    const plan = determineFetchPlan(detailed);

    // Parallel enrichment
    const [reviews, issueComments, reviewComments, checksResponse, files] = await Promise.all([
      plan.reviews
        ? withRetry(`Fetch reviews for #${ghPr.number}`, () =>
            githubFetchAllPages<GitHubReview>(`${base}/pulls/${ghPr.number}/reviews`, token))
        : Promise.resolve([] as GitHubReview[]),
      plan.comments
        ? withRetry(`Fetch comments for #${ghPr.number}`, () =>
            githubFetchAllPages<GitHubComment>(`${base}/issues/${ghPr.number}/comments`, token))
        : Promise.resolve([] as GitHubComment[]),
      plan.comments
        ? withRetry(`Fetch review comments for #${ghPr.number}`, () =>
            githubFetchAllPages<GitHubComment>(`${base}/pulls/${ghPr.number}/comments`, token))
        : Promise.resolve([] as GitHubComment[]),
      plan.checks
        ? withRetry(`Fetch checks for #${ghPr.number}`, () =>
            githubFetch<GitHubCheckRunsResponse>(`${base}/commits/${detailed.head.sha}/check-runs`, { token }))
        : Promise.resolve({ total_count: 0, check_runs: [] } as GitHubCheckRunsResponse),
      plan.size
        ? withRetry(`Fetch files for #${ghPr.number}`, () =>
            githubFetchAllPages<GitHubPrFile>(`${base}/pulls/${ghPr.number}/files`, token))
        : Promise.resolve([] as GitHubPrFile[]),
    ]);

    return buildPullRequestInfo(detailed, reviews, issueComments, reviewComments, checksResponse, files, quantifierConfig, patterns);
  });

  return enriched;
}

function buildPullRequestInfo(
  pr: GitHubPullRequest,
  reviews: GitHubReview[],
  issueComments: GitHubComment[],
  reviewComments: GitHubComment[],
  checksResponse: GitHubCheckRunsResponse,
  files: GitHubPrFile[],
  quantifierConfig: QuantifierConfig | undefined,
  patterns: RepoPatternsConfig,
): PullRequestInfo {
  // Map reviewers — deduplicate, keeping the latest review per user
  const reviewerMap = new Map<string, GitHubReview>();
  for (const review of reviews) {
    const existing = reviewerMap.get(review.user.login);
    if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
      reviewerMap.set(review.user.login, review);
    }
  }

  const reviewers: ReviewerInfo[] = [];

  // Add actual reviewers
  for (const [login, review] of reviewerMap) {
    reviewers.push({
      displayName: login,
      uniqueName: login.toLowerCase(),
      vote: mapReviewVote(review.state),
      isRequired: false,
      isBot: review.user.type === "Bot",
    });
  }

  // Add requested reviewers who haven't reviewed yet
  for (const requested of pr.requested_reviewers) {
    if (!reviewerMap.has(requested.login)) {
      reviewers.push({
        displayName: requested.login,
        uniqueName: requested.login.toLowerCase(),
        vote: 0,
        isRequired: true,
        isBot: requested.type === "Bot",
      });
    }
  }

  // Map threads from issue comments + review comments
  const threads: ThreadInfo[] = [];
  let threadId = 1;

  for (const comment of [...issueComments, ...reviewComments]) {
    const tc: ThreadComment = {
      authorUniqueName: comment.user.login.toLowerCase(),
      publishedDate: new Date(comment.created_at),
    };
    threads.push({
      id: threadId++,
      comments: [tc],
      publishedDate: new Date(comment.created_at),
    });
  }

  // Also add review submissions as activity (reviews with body text)
  for (const review of reviews) {
    if (review.body) {
      const tc: ThreadComment = {
        authorUniqueName: review.user.login.toLowerCase(),
        publishedDate: new Date(review.submitted_at),
      };
      threads.push({
        id: threadId++,
        comments: [tc],
        publishedDate: new Date(review.submitted_at),
      });
    }
  }

  // Map pipeline status from check runs
  const pipelineStatus = buildPipelineStatus(checksResponse.check_runs);
  const policyStatus = buildPolicyStatus(checksResponse.check_runs);

  // Compute PR size
  const changedFiles = files.map((f) => f.filename);
  const size = computeGitHubPrSize(files, quantifierConfig, patterns.ignore);

  // Detect labels
  const detectedLabels = detectLabels(changedFiles, patterns.ignore, patterns.labels);

  // Find latest push date approximation — use updated_at of the PR
  // GitHub doesn't expose "last push date" directly on the PR; the head sha's commit date is closest
  const lastSourcePushDate = new Date(pr.updated_at);

  return {
    id: pr.number,
    title: pr.title,
    author: pr.user.login,
    authorUniqueName: pr.user.login.toLowerCase(),
    url: pr.html_url,
    createdDate: new Date(pr.created_at),
    reviewers,
    threads,
    labels: pr.labels.map((l) => l.name),
    detectedLabels,
    mergeStatus: mapMergeStatus(pr),
    lastSourcePushDate,
    provider: "github",
    size,
    description: pr.body ?? undefined,
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    changedFiles,
    pipelineStatus,
    policyStatus,
  };
}

function buildPipelineStatus(checkRuns: GitHubCheckRun[]): PipelineStatus | undefined {
  if (checkRuns.length === 0) return undefined;

  const runs: PipelineRunInfo[] = checkRuns.map((cr) => ({
    id: cr.id,
    name: cr.name,
    status: cr.status,
    result: mapCheckConclusion(cr.conclusion, cr.status),
  }));

  const succeeded = runs.filter((r) => r.result === "succeeded").length;
  const failed = runs.filter((r) => r.result === "failed").length;
  const inProgress = runs.filter((r) => r.result === "inProgress").length;
  const other = runs.length - succeeded - failed - inProgress;

  return { total: runs.length, succeeded, failed, inProgress, other, runs };
}

function buildPolicyStatus(checkRuns: GitHubCheckRun[]): PolicyStatus | undefined {
  if (checkRuns.length === 0) return undefined;

  const evaluations: PolicyEvaluationInfo[] = checkRuns.map((cr) => ({
    evaluationId: String(cr.id),
    displayName: cr.name,
    status: mapCheckToPolicyStatus(cr.conclusion, cr.status),
    isBlocking: true,
    buildUrl: cr.html_url,
  }));

  const approved = evaluations.filter((e) => e.status === "approved").length;
  const rejected = evaluations.filter((e) => e.status === "rejected").length;
  const running = evaluations.filter((e) => e.status === "running").length;
  const other = evaluations.length - approved - rejected - running;

  return { total: evaluations.length, approved, rejected, running, other, evaluations };
}

function computeGitHubPrSize(
  files: GitHubPrFile[],
  quantifierConfig: QuantifierConfig | undefined,
  ignorePatterns: string[],
): PrSizeInfo | undefined {
  if (!quantifierConfig) return undefined;

  // Combine quantifier and repo-level ignore patterns
  const allIgnore = [...quantifierConfig.excludedPatterns, ...ignorePatterns];
  const filteredFiles = filterIgnoredFiles(files.map((f) => f.filename), allIgnore);
  const filteredSet = new Set(filteredFiles.map((f) => f.replace(/^\//, "")));

  let linesAdded = 0;
  let linesDeleted = 0;

  for (const file of files) {
    if (!filteredSet.has(file.filename.replace(/^\//, ""))) continue;
    linesAdded += file.additions;
    linesDeleted += file.deletions;
  }

  const totalChanges = linesAdded + linesDeleted;
  const label = classifyPrSize(totalChanges, quantifierConfig.thresholds);

  return {
    linesAdded,
    linesDeleted,
    filesChanged: filteredFiles.length,
    totalChanges,
    label,
  };
}
