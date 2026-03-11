import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../github-client.js", () => ({
  githubFetch: vi.fn(),
  githubFetchAllPages: vi.fn(),
}));

vi.mock("../retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../retry.js")>();
  return {
    ...actual,
    withRetry: <T>(_label: string, fn: () => Promise<T>) => fn(),
  };
});

vi.mock("../log.js", () => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

import { githubFetch, githubFetchAllPages } from "../github-client.js";
import { computeGitHubDoraMetrics } from "./github-dora.js";

const mockGithubFetch = vi.mocked(githubFetch);
const mockGithubFetchAllPages = vi.mocked(githubFetchAllPages);

describe("computeGitHubDoraMetrics", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("computes metrics with merged PRs and workflow runs", async () => {
    // Mock search for merged PRs
    mockGithubFetch.mockResolvedValueOnce({
      items: [
        { number: 1, created_at: "2024-06-10T00:00:00Z", merged_at: "2024-06-12T00:00:00Z" },
        { number: 2, created_at: "2024-06-11T00:00:00Z", merged_at: "2024-06-13T00:00:00Z" },
      ],
    });

    // Mock workflow runs
    mockGithubFetchAllPages.mockResolvedValueOnce([
      { id: 100, name: "CI", conclusion: "success", created_at: "2024-06-12T00:00:00Z", updated_at: "2024-06-12T01:00:00Z", workflow_id: 1 },
      { id: 101, name: "CI", conclusion: "failure", created_at: "2024-06-13T00:00:00Z", updated_at: "2024-06-13T01:00:00Z", workflow_id: 1 },
      { id: 102, name: "CI", conclusion: "success", created_at: "2024-06-14T00:00:00Z", updated_at: "2024-06-14T01:00:00Z", workflow_id: 1 },
    ]);

    const metrics = await computeGitHubDoraMetrics("owner", "repo", 30, "token", undefined, now);

    expect(metrics.period.start).toBeInstanceOf(Date);
    expect(metrics.period.end).toEqual(now);
    expect(metrics.changeLeadTime.medianDays).toBeGreaterThan(0);
    expect(metrics.deploymentFrequency.perWeek).toBeGreaterThan(0);
    expect(metrics.changeFailureRate.percentage).toBeGreaterThan(0);
  });

  it("computes lead time for merged PRs", async () => {
    // 2-day lead time for both PRs
    mockGithubFetch.mockResolvedValueOnce({
      items: [
        { number: 1, created_at: "2024-06-10T00:00:00Z", merged_at: "2024-06-12T00:00:00Z" },
      ],
    });
    mockGithubFetchAllPages.mockResolvedValueOnce([]);

    const metrics = await computeGitHubDoraMetrics("owner", "repo", 30, "token", undefined, now);

    expect(metrics.changeLeadTime.medianDays).toBe(2);
  });

  it("computes workflow run frequency", async () => {
    mockGithubFetch.mockResolvedValueOnce({ items: [] }); // no merged PRs

    // 3 successful runs in 14 days = ~1.5/week
    const runs = [
      { id: 1, name: "CI", conclusion: "success", created_at: "2024-06-02T00:00:00Z", updated_at: "2024-06-02T01:00:00Z", workflow_id: 1 },
      { id: 2, name: "CI", conclusion: "success", created_at: "2024-06-08T00:00:00Z", updated_at: "2024-06-08T01:00:00Z", workflow_id: 1 },
      { id: 3, name: "CI", conclusion: "success", created_at: "2024-06-14T00:00:00Z", updated_at: "2024-06-14T01:00:00Z", workflow_id: 1 },
    ];
    mockGithubFetchAllPages.mockResolvedValueOnce(runs);

    const metrics = await computeGitHubDoraMetrics("owner", "repo", 14, "token", undefined, now);

    expect(metrics.deploymentFrequency.perWeek).toBe(1.5);
  });

  it("handles empty data gracefully", async () => {
    mockGithubFetch.mockResolvedValueOnce({ items: [] });
    mockGithubFetchAllPages.mockResolvedValueOnce([]);

    const metrics = await computeGitHubDoraMetrics("owner", "repo", 30, "token", undefined, now);

    expect(metrics.changeLeadTime.medianDays).toBe(0);
    expect(metrics.deploymentFrequency.perWeek).toBe(0);
    expect(metrics.changeFailureRate.percentage).toBe(0);
    expect(metrics.meanTimeToRestore.medianHours).toBe(0);
  });

  it("filters workflow runs by workflow IDs when specified", async () => {
    mockGithubFetch.mockResolvedValueOnce({ items: [] });

    const runs = [
      { id: 1, name: "CI", conclusion: "success", created_at: "2024-06-10T00:00:00Z", updated_at: "2024-06-10T01:00:00Z", workflow_id: 100 },
      { id: 2, name: "Deploy", conclusion: "success", created_at: "2024-06-11T00:00:00Z", updated_at: "2024-06-11T01:00:00Z", workflow_id: 200 },
      { id: 3, name: "Lint", conclusion: "success", created_at: "2024-06-12T00:00:00Z", updated_at: "2024-06-12T01:00:00Z", workflow_id: 300 },
    ];
    mockGithubFetchAllPages.mockResolvedValueOnce(runs);

    // Only include workflow 100 and 200
    const metrics = await computeGitHubDoraMetrics("owner", "repo", 30, "token", [100, 200], now);

    // 2 successful runs in ~4.3 weeks
    expect(metrics.deploymentFrequency.perWeek).toBeGreaterThan(0);
  });

  it("skips workflow runs without a conclusion", async () => {
    mockGithubFetch.mockResolvedValueOnce({ items: [] });

    const runs = [
      { id: 1, name: "CI", conclusion: null, created_at: "2024-06-10T00:00:00Z", updated_at: "2024-06-10T01:00:00Z", workflow_id: 1 },
      { id: 2, name: "CI", conclusion: "success", created_at: "2024-06-12T00:00:00Z", updated_at: "2024-06-12T01:00:00Z", workflow_id: 1 },
    ];
    mockGithubFetchAllPages.mockResolvedValueOnce(runs);

    const metrics = await computeGitHubDoraMetrics("owner", "repo", 30, "token", undefined, now);

    // Only 1 successful run (the other has conclusion: null)
    const weeks = 30 / 7;
    const expected = Math.round((1 / weeks) * 10) / 10;
    expect(metrics.deploymentFrequency.perWeek).toBe(expected);
  });
});
