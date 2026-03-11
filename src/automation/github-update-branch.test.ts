import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PullRequestInfo } from "../types.js";

vi.mock("../github-client.js", () => ({
  githubFetch: vi.fn(),
}));

vi.mock("../log.js", () => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

import { githubFetch } from "../github-client.js";
import { updateBranchForStalePrs } from "./github-update-branch.js";

const mockGithubFetch = vi.mocked(githubFetch);

function makePr(id: number, createdDate: Date): PullRequestInfo {
  return {
    id,
    title: `PR #${id}`,
    author: "testuser",
    authorUniqueName: "testuser",
    url: `https://github.com/owner/repo/pull/${id}`,
    createdDate,
    reviewers: [],
    threads: [],
    labels: [],
    detectedLabels: [],
    mergeStatus: 3,
    lastSourcePushDate: new Date(),
    provider: "github",
  };
}

describe("updateBranchForStalePrs", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("updates branches for PRs older than threshold", async () => {
    mockGithubFetch.mockResolvedValue(undefined);

    const oldPr = makePr(1, new Date("2024-06-01T00:00:00Z")); // 14 days old
    const result = await updateBranchForStalePrs("token", "owner", "repo", [oldPr], 7, now);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.updatedPrIds).toEqual([1]);
    expect(mockGithubFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/1/update-branch",
      { token: "token", method: "PUT", body: {} },
    );
  });

  it("is disabled when updateAfterDays < 0", async () => {
    const pr = makePr(1, new Date("2024-01-01T00:00:00Z"));
    const result = await updateBranchForStalePrs("token", "owner", "repo", [pr], -1, now);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.updatedPrIds).toEqual([]);
    expect(mockGithubFetch).not.toHaveBeenCalled();
  });

  it("does nothing when no PRs are older than threshold", async () => {
    const recentPr = makePr(1, new Date("2024-06-14T00:00:00Z")); // 1 day old
    const result = await updateBranchForStalePrs("token", "owner", "repo", [recentPr], 7, now);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.updatedPrIds).toEqual([]);
    expect(mockGithubFetch).not.toHaveBeenCalled();
  });

  it("handles 422 merge conflict gracefully", async () => {
    mockGithubFetch.mockRejectedValue(new Error("GitHub API error 422: Unprocessable Entity"));

    const oldPr = makePr(1, new Date("2024-06-01T00:00:00Z"));
    const result = await updateBranchForStalePrs("token", "owner", "repo", [oldPr], 7, now);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.updatedPrIds).toEqual([]);
  });

  it("handles 403 insufficient permissions gracefully", async () => {
    mockGithubFetch.mockRejectedValue(new Error("GitHub API error 403: Forbidden"));

    const oldPr = makePr(1, new Date("2024-06-01T00:00:00Z"));
    const result = await updateBranchForStalePrs("token", "owner", "repo", [oldPr], 7, now);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.updatedPrIds).toEqual([]);
  });

  it("updates only stale PRs when mixed ages exist", async () => {
    mockGithubFetch.mockResolvedValue(undefined);

    const oldPr = makePr(1, new Date("2024-06-01T00:00:00Z")); // 14 days old
    const recentPr = makePr(2, new Date("2024-06-14T00:00:00Z")); // 1 day old

    const result = await updateBranchForStalePrs("token", "owner", "repo", [oldPr, recentPr], 7, now);

    expect(result.updated).toBe(1);
    expect(result.updatedPrIds).toEqual([1]);
    expect(mockGithubFetch).toHaveBeenCalledTimes(1);
  });
});
