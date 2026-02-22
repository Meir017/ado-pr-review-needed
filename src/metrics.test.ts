import { describe, it, expect } from "vitest";
import { computeReviewMetrics } from "./metrics.js";
import type { PullRequestInfo } from "./types.js";
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

const NOW = new Date("2026-02-22T12:00:00Z");

describe("computeReviewMetrics", () => {
  it("handles empty PR list", () => {
    const result = computeReviewMetrics([], new Set(), NOW);
    expect(result.perPr).toHaveLength(0);
    expect(result.aggregate.totalPrs).toBe(0);
    expect(result.aggregate.medianAgeInDays).toBe(0);
    expect(result.perAuthor).toHaveLength(0);
  });

  it("computes age for a single PR with no activity", () => {
    const pr = makePr({ createdDate: new Date("2026-02-15T12:00:00Z") });
    const result = computeReviewMetrics([pr], new Set(), NOW);

    expect(result.perPr).toHaveLength(1);
    expect(result.perPr[0].ageInDays).toBe(7);
    expect(result.perPr[0].timeToFirstReviewInDays).toBeNull();
    expect(result.perPr[0].reviewRounds).toBe(0);
    expect(result.aggregate.prsWithNoReviewActivity).toBe(1);
  });

  it("computes time to first review", () => {
    const pr = makePr({
      createdDate: new Date("2026-02-10T00:00:00Z"),
      threads: [{
        id: 1,
        publishedDate: new Date("2026-02-12T00:00:00Z"),
        comments: [{
          authorUniqueName: "bob@example.com",
          publishedDate: new Date("2026-02-12T00:00:00Z"),
        }],
      }],
    });
    const result = computeReviewMetrics([pr], new Set(), NOW);

    expect(result.perPr[0].timeToFirstReviewInDays).toBe(2);
    expect(result.aggregate.prsWithNoReviewActivity).toBe(0);
  });

  it("counts review rounds correctly", () => {
    const pr = makePr({
      createdDate: new Date("2026-02-01T00:00:00Z"),
      lastSourcePushDate: new Date("2026-02-01T12:00:00Z"),
      threads: [
        {
          id: 1,
          publishedDate: new Date("2026-02-02T00:00:00Z"),
          comments: [{
            authorUniqueName: "bob@example.com",
            publishedDate: new Date("2026-02-02T00:00:00Z"),
          }],
        },
        {
          id: 2,
          publishedDate: new Date("2026-02-03T00:00:00Z"),
          comments: [{
            authorUniqueName: "alice@example.com",
            publishedDate: new Date("2026-02-03T00:00:00Z"),
          }],
        },
        {
          id: 3,
          publishedDate: new Date("2026-02-04T00:00:00Z"),
          comments: [{
            authorUniqueName: "bob@example.com",
            publishedDate: new Date("2026-02-04T00:00:00Z"),
          }],
        },
      ],
    });
    // Activities timeline: push(author), bob(reviewer), alice(author), bob(reviewer)
    // Rounds: author->reviewer = 1, then author->reviewer = 2
    const result = computeReviewMetrics([pr], new Set(), NOW);
    expect(result.perPr[0].reviewRounds).toBe(2);
  });

  it("excludes bot activity from metrics", () => {
    const bots = new Set(["ci-bot@example.com"]);
    const pr = makePr({
      createdDate: new Date("2026-02-10T00:00:00Z"),
      threads: [
        {
          id: 1,
          publishedDate: new Date("2026-02-11T00:00:00Z"),
          comments: [{
            authorUniqueName: "ci-bot@example.com",
            publishedDate: new Date("2026-02-11T00:00:00Z"),
          }],
        },
        {
          id: 2,
          publishedDate: new Date("2026-02-13T00:00:00Z"),
          comments: [{
            authorUniqueName: "bob@example.com",
            publishedDate: new Date("2026-02-13T00:00:00Z"),
          }],
        },
      ],
    });

    const result = computeReviewMetrics([pr], bots, NOW);
    // Bot comment ignored; first real review is from bob at 3 days
    expect(result.perPr[0].timeToFirstReviewInDays).toBe(3);
  });

  it("aggregates per-author metrics", () => {
    const prs = [
      makePr({ id: 1, author: "Alice", authorUniqueName: "alice@example.com", createdDate: new Date("2026-02-10T00:00:00Z") }),
      makePr({ id: 2, author: "Alice", authorUniqueName: "alice@example.com", createdDate: new Date("2026-02-20T00:00:00Z") }),
      makePr({ id: 3, author: "Bob", authorUniqueName: "bob@example.com", createdDate: new Date("2026-02-15T00:00:00Z") }),
    ];

    const result = computeReviewMetrics(prs, new Set(), NOW);
    expect(result.perAuthor).toHaveLength(2);

    const alice = result.perAuthor.find((a) => a.author === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.openPrCount).toBe(2);

    const bob = result.perAuthor.find((a) => a.author === "Bob");
    expect(bob).toBeDefined();
    expect(bob!.openPrCount).toBe(1);
  });

  it("computes median correctly for odd count", () => {
    const prs = [
      makePr({ id: 1, createdDate: new Date("2026-02-20T12:00:00Z") }), // 2 days
      makePr({ id: 2, createdDate: new Date("2026-02-12T12:00:00Z") }), // 10 days
      makePr({ id: 3, createdDate: new Date("2026-02-01T12:00:00Z") }), // 21 days
    ];
    const result = computeReviewMetrics(prs, new Set(), NOW);
    expect(result.aggregate.medianAgeInDays).toBe(10);
  });

  it("computes median correctly for even count", () => {
    const prs = [
      makePr({ id: 1, createdDate: new Date("2026-02-20T12:00:00Z") }), // 2 days
      makePr({ id: 2, createdDate: new Date("2026-02-18T12:00:00Z") }), // 4 days
      makePr({ id: 3, createdDate: new Date("2026-02-12T12:00:00Z") }), // 10 days
      makePr({ id: 4, createdDate: new Date("2026-02-02T12:00:00Z") }), // 20 days
    ];
    const result = computeReviewMetrics(prs, new Set(), NOW);
    // Median of [2, 4, 10, 20] = (4 + 10) / 2 = 7
    expect(result.aggregate.medianAgeInDays).toBe(7);
  });
});
