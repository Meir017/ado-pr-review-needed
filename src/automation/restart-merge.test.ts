import { describe, it, expect, vi } from "vitest";
import { restartMergeForStalePrs } from "./restart-merge.js";
import { NonRetryableError } from "../retry.js";
import type { PullRequestInfo } from "../types.js";

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: "Test PR",
    author: "Alice",
    authorUniqueName: "alice@example.com",
    url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/1",
    createdDate: new Date("2025-01-01"),
    reviewers: [],
    threads: [],
    labels: [],
    mergeStatus: 0,
    lastSourcePushDate: undefined,
    ...overrides,
  };
}

describe("restartMergeForStalePrs", () => {
  const now = new Date("2025-03-01");

  it("restarts merge for PRs older than threshold", async () => {
    const updatePullRequest = vi.fn().mockResolvedValue({});
    const gitApi = { updatePullRequest } as never;

    const prs = [
      makePr({ id: 10, createdDate: new Date("2025-01-01") }), // 59 days old
      makePr({ id: 20, createdDate: new Date("2025-02-28") }), // 1 day old
    ];

    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(1);
    expect(count.failed).toBe(0);
    expect(count.restartedPrIds).toEqual([10]);
    expect(updatePullRequest).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled (restartMergeAfterDays < 0)", async () => {
    const updatePullRequest = vi.fn();
    const gitApi = { updatePullRequest } as never;

    const prs = [makePr({ id: 10, createdDate: new Date("2024-01-01") })];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, -1, now);

    expect(count.restarted).toBe(0);
    expect(count.failed).toBe(0);
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it("does nothing when no PRs exceed the threshold", async () => {
    const updatePullRequest = vi.fn();
    const gitApi = { updatePullRequest } as never;

    const prs = [makePr({ id: 10, createdDate: new Date("2025-02-28") })];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(0);
    expect(count.failed).toBe(0);
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it("continues on individual PR failures", async () => {
    const updatePullRequest = vi.fn().mockImplementation((_body: unknown, _repo: string, prId: number) => {
      if (prId === 10) return Promise.reject(new NonRetryableError("API error"));
      return Promise.resolve({});
    });
    const gitApi = { updatePullRequest } as never;

    const prs = [
      makePr({ id: 10, createdDate: new Date("2025-01-01") }),
      makePr({ id: 11, createdDate: new Date("2025-01-15") }),
    ];

    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(1);
    expect(count.failed).toBe(1);
    expect(updatePullRequest).toHaveBeenCalledTimes(2);
  });

  it("restarts merge for PRs exactly at the threshold boundary", async () => {
    const updatePullRequest = vi.fn().mockResolvedValue({});
    const gitApi = { updatePullRequest } as never;

    // 31 days old — strictly older than the 30-day cutoff
    const prs = [makePr({ id: 10, createdDate: new Date("2025-01-29") })];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(1);
    expect(count.failed).toBe(0);
  });

  it("does not retry TF401398 (branch deleted) errors", async () => {
    const updatePullRequest = vi.fn().mockRejectedValue(
      new Error("TF401398: The pull request cannot be activated because the source and/or the target branch no longer exists"),
    );
    const gitApi = { updatePullRequest } as never;

    const prs = [makePr({ id: 10, createdDate: new Date("2025-01-01") })];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(0);
    expect(count.failed).toBe(1);
    expect(updatePullRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry TF401027 (permission denied) errors", async () => {
    const updatePullRequest = vi.fn().mockRejectedValue(
      new Error("TF401027: You need the Git 'PullRequestContribute' permission to perform this action."),
    );
    const gitApi = { updatePullRequest } as never;

    const prs = [makePr({ id: 10, createdDate: new Date("2025-01-01") })];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(0);
    expect(count.failed).toBe(1);
    expect(updatePullRequest).toHaveBeenCalledTimes(1);
  });

  it("stops processing remaining PRs after TF401027 permission error", async () => {
    const updatePullRequest = vi.fn().mockRejectedValue(
      new Error("TF401027: You need the Git 'PullRequestContribute' permission to perform this action."),
    );
    const gitApi = { updatePullRequest } as never;

    const prs = [
      makePr({ id: 10, createdDate: new Date("2025-01-01") }),
      makePr({ id: 11, createdDate: new Date("2025-01-10") }),
      makePr({ id: 12, createdDate: new Date("2025-01-15") }),
    ];
    const count = await restartMergeForStalePrs(gitApi, "repo", "proj", prs, 30, now);

    expect(count.restarted).toBe(0);
    expect(count.failed).toBe(3);
    // Should only attempt the first PR, then bail out
    expect(updatePullRequest).toHaveBeenCalledTimes(1);
  });
});
