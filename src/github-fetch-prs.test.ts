import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubRepoTarget, QuantifierConfig } from "./types.js";
import type { RepoPatternsConfig } from "./config.js";

vi.mock("./github-client.js", () => ({
  githubFetch: vi.fn(),
  githubFetchAllPages: vi.fn(),
}));

vi.mock("./retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retry.js")>();
  return {
    ...actual,
    withRetry: <T>(_label: string, fn: () => Promise<T>) => fn(),
  };
});

vi.mock("./log.js", () => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

import { githubFetch, githubFetchAllPages } from "./github-client.js";
import { fetchGitHubPullRequests } from "./github-fetch-prs.js";

const mockGithubFetch = vi.mocked(githubFetch);
const mockGithubFetchAllPages = vi.mocked(githubFetchAllPages);

const defaultTarget: GitHubRepoTarget = {
  provider: "github",
  owner: "testowner",
  repo: "testrepo",
  visibility: "public",
  skipRestartMerge: false,
  patterns: { ignore: [], labels: {} },
};

const defaultPatterns: RepoPatternsConfig = {
  ignore: [],
  labels: {},
};

function makeGhPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Test PR",
    user: { login: "author1", type: "User" },
    html_url: "https://github.com/testowner/testrepo/pull/1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    draft: false,
    state: "open",
    body: "PR description",
    head: { ref: "feature-branch", sha: "abc123" },
    base: { ref: "main" },
    labels: [],
    mergeable_state: "clean",
    mergeable: true,
    requested_reviewers: [],
    ...overrides,
  };
}

describe("fetchGitHubPullRequests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns mapped PR with correct fields", async () => {
    const ghPr = makeGhPr();

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]); // list open PRs
    mockGithubFetch.mockResolvedValueOnce(ghPr); // detailed PR fetch
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] }); // checks

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].title).toBe("Test PR");
    expect(result[0].author).toBe("author1");
    expect(result[0].provider).toBe("github");
    expect(result[0].sourceBranch).toBe("feature-branch");
    expect(result[0].targetBranch).toBe("main");
    expect(result[0].url).toBe("https://github.com/testowner/testrepo/pull/1");
  });

  it("filters out draft PRs", async () => {
    const draftPr = makeGhPr({ draft: true, number: 2, title: "Draft PR" });
    const openPr = makeGhPr({ number: 3, title: "Open PR" });

    mockGithubFetchAllPages.mockResolvedValueOnce([draftPr, openPr]); // list open PRs
    mockGithubFetch.mockResolvedValueOnce(openPr); // detailed PR fetch for non-draft
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] }); // checks

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("maps review states to correct votes", async () => {
    const ghPr = makeGhPr();
    const reviews = [
      { id: 1, user: { login: "approver", type: "User" }, state: "APPROVED", submitted_at: "2024-01-02T00:00:00Z", body: null },
      { id: 2, user: { login: "requester", type: "User" }, state: "CHANGES_REQUESTED", submitted_at: "2024-01-02T00:00:00Z", body: null },
      { id: 3, user: { login: "commenter", type: "User" }, state: "COMMENTED", submitted_at: "2024-01-02T00:00:00Z", body: null },
    ];

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]); // list open PRs
    mockGithubFetch.mockResolvedValueOnce(ghPr); // detailed PR
    mockGithubFetchAllPages
      .mockResolvedValueOnce(reviews) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] }); // checks

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result[0].reviewers).toHaveLength(3);
    const approver = result[0].reviewers.find((r) => r.displayName === "approver");
    const requester = result[0].reviewers.find((r) => r.displayName === "requester");
    const commenter = result[0].reviewers.find((r) => r.displayName === "commenter");
    expect(approver?.vote).toBe(10);
    expect(requester?.vote).toBe(-5);
    expect(commenter?.vote).toBe(0);
  });

  it("maps merge status correctly", async () => {
    // dirty = conflicts
    const conflictPr = makeGhPr({ mergeable: false, mergeable_state: "dirty" });

    mockGithubFetchAllPages.mockResolvedValueOnce([conflictPr]);
    mockGithubFetch.mockResolvedValueOnce(conflictPr);
    // For conflict PRs, plan.reviews/comments/checks are false
    mockGithubFetchAllPages.mockResolvedValueOnce([]); // files only
    // No reviews, comments, or checks fetched for conflict PRs

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result[0].mergeStatus).toBe(2); // MERGE_STATUS_CONFLICTS
  });

  it("maps clean merge status to ok", async () => {
    const cleanPr = makeGhPr({ mergeable: true, mergeable_state: "clean" });

    mockGithubFetchAllPages.mockResolvedValueOnce([cleanPr]);
    mockGithubFetch.mockResolvedValueOnce(cleanPr);
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] });

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result[0].mergeStatus).toBe(3); // MERGE_STATUS_OK
  });

  it("maps check runs to pipeline status", async () => {
    const ghPr = makeGhPr();
    const checkRuns = {
      total_count: 2,
      check_runs: [
        { id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://github.com/runs/1" },
        { id: 2, name: "Deploy", status: "completed", conclusion: "failure", html_url: "https://github.com/runs/2" },
      ],
    };

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]);
    mockGithubFetch.mockResolvedValueOnce(ghPr);
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce(checkRuns);

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result[0].pipelineStatus).toBeDefined();
    expect(result[0].pipelineStatus!.total).toBe(2);
    expect(result[0].pipelineStatus!.succeeded).toBe(1);
    expect(result[0].pipelineStatus!.failed).toBe(1);
  });

  it("computes PR size with quantifier config", async () => {
    const ghPr = makeGhPr();
    const files = [
      { filename: "src/index.ts", additions: 10, deletions: 5, changes: 15, status: "modified" },
      { filename: "src/utils.ts", additions: 20, deletions: 3, changes: 23, status: "modified" },
    ];

    const quantifier: QuantifierConfig = {
      enabled: true,
      excludedPatterns: [],
      thresholds: [
        { label: "XS", maxChanges: 10 },
        { label: "S", maxChanges: 40 },
        { label: "M", maxChanges: 100 },
        { label: "L", maxChanges: 400 },
        { label: "XL", maxChanges: 1000 },
      ],
    };

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]);
    mockGithubFetch.mockResolvedValueOnce(ghPr);
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce(files); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] });

    const result = await fetchGitHubPullRequests(defaultTarget, "token", quantifier, defaultPatterns);

    expect(result[0].size).toBeDefined();
    expect(result[0].size!.linesAdded).toBe(30);
    expect(result[0].size!.linesDeleted).toBe(8);
    expect(result[0].size!.totalChanges).toBe(38);
    expect(result[0].size!.label).toBe("S");
  });

  it("computes PR size excluding ignored patterns", async () => {
    const ghPr = makeGhPr();
    const files = [
      { filename: "src/index.ts", additions: 10, deletions: 5, changes: 15, status: "modified" },
      { filename: "package-lock.json", additions: 500, deletions: 200, changes: 700, status: "modified" },
    ];

    const quantifier: QuantifierConfig = {
      enabled: true,
      excludedPatterns: ["package-lock.json"],
      thresholds: [
        { label: "XS", maxChanges: 10 },
        { label: "S", maxChanges: 40 },
        { label: "M", maxChanges: 100 },
        { label: "L", maxChanges: 400 },
        { label: "XL", maxChanges: 1000 },
      ],
    };

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]);
    mockGithubFetch.mockResolvedValueOnce(ghPr);
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce(files); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] });

    const result = await fetchGitHubPullRequests(defaultTarget, "token", quantifier, defaultPatterns);

    expect(result[0].size).toBeDefined();
    expect(result[0].size!.linesAdded).toBe(10);
    expect(result[0].size!.linesDeleted).toBe(5);
    expect(result[0].size!.totalChanges).toBe(15);
  });

  it("maps requested reviewers who have not reviewed yet", async () => {
    const ghPr = makeGhPr({
      requested_reviewers: [
        { login: "pending-reviewer", type: "User" },
      ],
    });

    mockGithubFetchAllPages.mockResolvedValueOnce([ghPr]);
    mockGithubFetch.mockResolvedValueOnce(ghPr);
    mockGithubFetchAllPages
      .mockResolvedValueOnce([]) // reviews (none yet)
      .mockResolvedValueOnce([]) // issue comments
      .mockResolvedValueOnce([]) // review comments
      .mockResolvedValueOnce([]); // files
    mockGithubFetch.mockResolvedValueOnce({ total_count: 0, check_runs: [] });

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);

    expect(result[0].reviewers).toHaveLength(1);
    expect(result[0].reviewers[0].displayName).toBe("pending-reviewer");
    expect(result[0].reviewers[0].vote).toBe(0);
    expect(result[0].reviewers[0].isRequired).toBe(true);
  });

  it("returns empty array when no open PRs", async () => {
    mockGithubFetchAllPages.mockResolvedValueOnce([]); // no open PRs

    const result = await fetchGitHubPullRequests(defaultTarget, "token", undefined, defaultPatterns);
    expect(result).toEqual([]);
  });
});
