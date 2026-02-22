import { describe, it, expect } from "vitest";
import { computeReviewerWorkload, DEFAULT_WORKLOAD_THRESHOLDS } from "./reviewer-workload.js";
import type { PullRequestInfo, AnalysisResult } from "./types.js";
import { PullRequestAsyncStatus } from "azure-devops-node-api/interfaces/GitInterfaces.js";

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: "Test PR",
    author: "Alice",
    authorUniqueName: "alice@example.com",
    url: "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
    createdDate: new Date("2026-02-01T00:00:00Z"),
    reviewers: [],
    threads: [],
    labels: [],
    detectedLabels: [],
    mergeStatus: PullRequestAsyncStatus.Succeeded,
    lastSourcePushDate: undefined,
    ...overrides,
  };
}

const EMPTY_ANALYSIS: AnalysisResult = {
  approved: [],
  needingReview: [],
  waitingOnAuthor: [],
};

const NOW = new Date("2026-02-22T12:00:00Z");

describe("computeReviewerWorkload", () => {
  it("handles empty PR list", () => {
    const result = computeReviewerWorkload([], EMPTY_ANALYSIS, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result).toHaveLength(0);
  });

  it("counts assigned and pending reviews", () => {
    const pr = makePr({
      id: 1,
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
      ],
    });
    const analysis: AnalysisResult = {
      ...EMPTY_ANALYSIS,
      needingReview: [{ id: 1, title: "Test PR", author: "Alice", url: "", waitingSince: new Date(), hasMergeConflict: false, isTeamMember: true, action: "REVIEW" }],
    };

    const result = computeReviewerWorkload([pr], analysis, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Bob");
    expect(result[0].assignedPrCount).toBe(1);
    expect(result[0].pendingReviewCount).toBe(1);
    expect(result[0].completedReviewCount).toBe(0);
  });

  it("counts completed reviews", () => {
    const pr = makePr({
      id: 1,
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 10 },
      ],
    });

    const result = computeReviewerWorkload([pr], EMPTY_ANALYSIS, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result[0].completedReviewCount).toBe(1);
    expect(result[0].pendingReviewCount).toBe(0);
  });

  it("excludes bot reviewers", () => {
    const bots = new Set(["ci-bot@example.com"]);
    const pr = makePr({
      reviewers: [
        { displayName: "CI Bot", uniqueName: "ci-bot@example.com", vote: 0 },
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
      ],
    });

    const result = computeReviewerWorkload([pr], EMPTY_ANALYSIS, bots, DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Bob");
  });

  it("computes avg response time from reviewer comments", () => {
    const pr = makePr({
      createdDate: new Date("2026-02-10T00:00:00Z"),
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
      ],
      threads: [{
        id: 1,
        publishedDate: new Date("2026-02-12T00:00:00Z"),
        comments: [{
          authorUniqueName: "bob@example.com",
          publishedDate: new Date("2026-02-12T00:00:00Z"),
        }],
      }],
    });

    const result = computeReviewerWorkload([pr], EMPTY_ANALYSIS, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result[0].avgResponseTimeInDays).toBe(2);
  });

  it("returns null avg response time when no comments", () => {
    const pr = makePr({
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
      ],
    });

    const result = computeReviewerWorkload([pr], EMPTY_ANALYSIS, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result[0].avgResponseTimeInDays).toBeNull();
  });

  it("assigns correct load indicators", () => {
    const prs: PullRequestInfo[] = [];
    const needingReview: AnalysisResult["needingReview"] = [];

    // Create 25 PRs assigned to "overloaded" reviewer
    for (let i = 0; i < 25; i++) {
      prs.push(makePr({
        id: i,
        author: `author${i}`,
        authorUniqueName: `author${i}@example.com`,
        reviewers: [{ displayName: "Overloaded", uniqueName: "overloaded@example.com", vote: 0 }],
      }));
      needingReview.push({ id: i, title: `PR ${i}`, author: `author${i}`, url: "", waitingSince: new Date(), hasMergeConflict: false, isTeamMember: true, action: "REVIEW" });
    }

    const analysis: AnalysisResult = { ...EMPTY_ANALYSIS, needingReview };
    const result = computeReviewerWorkload(prs, analysis, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);

    expect(result[0].pendingReviewCount).toBe(25);
    expect(result[0].loadIndicator).toBe("🔴");
  });

  it("sorts by pending review count descending", () => {
    const prs = [
      makePr({
        id: 1,
        reviewers: [
          { displayName: "Alice", uniqueName: "alice-r@example.com", vote: 0 },
          { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
        ],
      }),
      makePr({
        id: 2,
        author: "Charlie",
        authorUniqueName: "charlie@example.com",
        reviewers: [
          { displayName: "Bob", uniqueName: "bob@example.com", vote: 0 },
        ],
      }),
    ];
    const analysis: AnalysisResult = {
      ...EMPTY_ANALYSIS,
      needingReview: [
        { id: 1, title: "PR 1", author: "Alice", url: "", waitingSince: new Date(), hasMergeConflict: false, isTeamMember: true, action: "REVIEW" },
        { id: 2, title: "PR 2", author: "Charlie", url: "", waitingSince: new Date(), hasMergeConflict: false, isTeamMember: true, action: "REVIEW" },
      ],
    };

    const result = computeReviewerWorkload(prs, analysis, new Set(), DEFAULT_WORKLOAD_THRESHOLDS, NOW);
    expect(result[0].displayName).toBe("Bob");
    expect(result[0].pendingReviewCount).toBe(2);
    expect(result[1].displayName).toBe("Alice");
    expect(result[1].pendingReviewCount).toBe(1);
  });
});
