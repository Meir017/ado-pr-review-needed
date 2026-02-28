import { vi } from "vitest";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import {
  PullRequestStatus,
  PullRequestAsyncStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type {
  GitPullRequest,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
  GitPullRequestIterationChanges,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";

export interface MockPrData {
  pullRequestId: number;
  title: string;
  createdBy: { displayName: string; uniqueName: string };
  creationDate: Date;
  isDraft?: boolean;
  labels?: Array<{ name: string }>;
  reviewers?: Array<{ displayName: string; uniqueName: string; vote: number }>;
  threads?: GitPullRequestCommentThread[];
  mergeStatus?: PullRequestAsyncStatus;
  lastMergeSourceCommit?: { committer?: { date?: Date } };
  sourceRefName?: string;
  targetRefName?: string;
  description?: string;
}

const defaultThreads: GitPullRequestCommentThread[] = [];

export function buildGitPullRequest(data: MockPrData): GitPullRequest {
  return {
    pullRequestId: data.pullRequestId,
    title: data.title,
    createdBy: data.createdBy,
    creationDate: data.creationDate,
    isDraft: data.isDraft ?? false,
    labels: data.labels ?? [],
    reviewers: data.reviewers ?? [],
    mergeStatus: data.mergeStatus ?? PullRequestAsyncStatus.Succeeded,
    lastMergeSourceCommit: data.lastMergeSourceCommit ?? undefined,
    status: PullRequestStatus.Active,
    sourceRefName: data.sourceRefName ?? "refs/heads/feature",
    targetRefName: data.targetRefName ?? "refs/heads/main",
    description: data.description ?? "",
  };
}

export interface MockGitApiOptions {
  pullRequests?: MockPrData[];
  threads?: Map<number, GitPullRequestCommentThread[]>;
  iterations?: GitPullRequestIteration[];
  iterationChanges?: GitPullRequestIterationChanges;
  updatePullRequestFn?: (...args: unknown[]) => Promise<unknown>;
  createPullRequestLabelFn?: (...args: unknown[]) => Promise<unknown>;
  getPullRequestByIdFn?: (...args: unknown[]) => Promise<GitPullRequest>;
}

/**
 * Creates a mock IGitApi that returns canned data.
 * Only stubs the methods used by the production code.
 */
export function createMockGitApi(options: MockGitApiOptions = {}): IGitApi {
  const prs = (options.pullRequests ?? []).map(buildGitPullRequest);
  // Build threads map from per-PR thread data in MockPrData
  const threadsMap = options.threads ?? new Map<number, GitPullRequestCommentThread[]>();
  if (!options.threads && options.pullRequests) {
    for (const prData of options.pullRequests) {
      if (prData.threads && prData.threads.length > 0) {
        threadsMap.set(prData.pullRequestId, prData.threads);
      }
    }
  }

  const getPullRequests = vi.fn().mockResolvedValue(prs);

  const getThreads = vi.fn().mockImplementation(
    (_repo: string, prId: number) =>
      Promise.resolve(threadsMap.get(prId) ?? defaultThreads),
  );

  const getPullRequestIterations = vi.fn().mockResolvedValue(
    options.iterations ?? [{ id: 1 }],
  );

  const getPullRequestIterationChanges = vi.fn().mockResolvedValue(
    options.iterationChanges ?? { changeEntries: [], nextSkip: 0, nextTop: 0 },
  );

  const updatePullRequest =
    options.updatePullRequestFn
      ? vi.fn().mockImplementation(options.updatePullRequestFn)
      : vi.fn().mockResolvedValue({});

  const createPullRequestLabel =
    options.createPullRequestLabelFn
      ? vi.fn().mockImplementation(options.createPullRequestLabelFn)
      : vi.fn().mockResolvedValue({});

  const getPullRequestById =
    options.getPullRequestByIdFn
      ? vi.fn().mockImplementation(options.getPullRequestByIdFn)
      : vi.fn().mockResolvedValue(prs[0] ?? {});

  const getRepository = vi.fn().mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000001",
    name: "mock-repo",
  });

  return {
    getPullRequests,
    getThreads,
    getPullRequestIterations,
    getPullRequestIterationChanges,
    updatePullRequest,
    createPullRequestLabel,
    getPullRequestById,
    getRepository,
  } as unknown as IGitApi;
}

/** Standard PR data for an approved PR */
export function approvedPr(id = 100, daysOld = 5): MockPrData {
  return {
    pullRequestId: id,
    title: `Approved PR #${id}`,
    createdBy: { displayName: "Alice", uniqueName: "alice@example.com" },
    creationDate: new Date(Date.now() - daysOld * 86400000),
    reviewers: [{ displayName: "Bob", uniqueName: "bob@example.com", vote: 10 }],
  };
}

/** Standard PR data for a PR needing review (no votes) */
export function needsReviewPr(id = 200, daysOld = 3): MockPrData {
  return {
    pullRequestId: id,
    title: `Needs Review PR #${id}`,
    createdBy: { displayName: "Carol", uniqueName: "carol@example.com" },
    creationDate: new Date(Date.now() - daysOld * 86400000),
    reviewers: [{ displayName: "Dave", uniqueName: "dave@example.com", vote: 0 }],
  };
}

/** Standard PR data for a PR waiting on author (reviewer commented last) */
export function waitingOnAuthorPr(id = 300, daysOld = 7): MockPrData {
  const createdDate = new Date(Date.now() - daysOld * 86400000);
  // Reviewer commented after creation → "waiting on author"
  const reviewerCommentDate = new Date(createdDate.getTime() + 86400000);
  return {
    pullRequestId: id,
    title: `Waiting on Author PR #${id}`,
    createdBy: { displayName: "Eve", uniqueName: "eve@example.com" },
    creationDate: createdDate,
    reviewers: [{ displayName: "Frank", uniqueName: "frank@example.com", vote: -5 }],
    threads: [{
      id: 1,
      publishedDate: reviewerCommentDate,
      comments: [{
        author: { displayName: "Frank", uniqueName: "frank@example.com" },
        publishedDate: reviewerCommentDate,
        commentType: 1,
        isDeleted: false,
      }],
    }],
  };
}

/** A stale PR old enough to trigger merge restart (default 60 days) */
export function stalePr(id = 400, daysOld = 60): MockPrData {
  return {
    pullRequestId: id,
    title: `Stale PR #${id}`,
    createdBy: { displayName: "Grace", uniqueName: "grace@example.com" },
    creationDate: new Date(Date.now() - daysOld * 86400000),
    reviewers: [{ displayName: "Hank", uniqueName: "hank@example.com", vote: 0 }],
  };
}

/** A draft PR that should be skipped */
export function draftPr(id = 500, daysOld = 2): MockPrData {
  return {
    pullRequestId: id,
    title: `Draft PR #${id}`,
    createdBy: { displayName: "Ivy", uniqueName: "ivy@example.com" },
    creationDate: new Date(Date.now() - daysOld * 86400000),
    isDraft: true,
    reviewers: [],
  };
}

/** A PR with a merge conflict */
export function conflictPr(id = 600, daysOld = 4): MockPrData {
  return {
    pullRequestId: id,
    title: `Conflict PR #${id}`,
    createdBy: { displayName: "Jack", uniqueName: "jack@example.com" },
    creationDate: new Date(Date.now() - daysOld * 86400000),
    reviewers: [{ displayName: "Kim", uniqueName: "kim@example.com", vote: 0 }],
    mergeStatus: PullRequestAsyncStatus.Conflicts,
  };
}
