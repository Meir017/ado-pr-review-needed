import type { JsonReport, JsonRepoReport } from "../../../types/reporting.js";
import type { PrNeedingReview, PrApproved, PrWaitingOnAuthor } from "../../../types/analysis.js";

// Dates fixed relative to a known point so staleness tests are deterministic
const NOW = "2025-06-15T12:00:00Z";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function prNeedingReview(overrides: Partial<PrNeedingReview> & { id: number; title: string; author: string }): PrNeedingReview {
  return {
    url: `https://dev.azure.com/org/project/_git/repo/pullrequest/${overrides.id}`,
    waitingSince: daysAgo(3),
    hasMergeConflict: false,
    isTeamMember: true,
    isStarred: false,
    action: "REVIEW",
    ...overrides,
  } as PrNeedingReview;
}

function prApproved(overrides: Partial<PrApproved> & { id: number; title: string; author: string }): PrApproved {
  return {
    url: `https://dev.azure.com/org/project/_git/repo/pullrequest/${overrides.id}`,
    createdDate: daysAgo(5),
    hasMergeConflict: false,
    isTeamMember: true,
    isStarred: false,
    action: "APPROVE",
    ...overrides,
  } as PrApproved;
}

function prWaitingOnAuthor(overrides: Partial<PrWaitingOnAuthor> & { id: number; title: string; author: string }): PrWaitingOnAuthor {
  return {
    url: `https://dev.azure.com/org/project/_git/repo/pullrequest/${overrides.id}`,
    lastReviewerActivityDate: daysAgo(2),
    hasMergeConflict: false,
    isTeamMember: true,
    isStarred: false,
    action: "PENDING",
    ...overrides,
  } as PrWaitingOnAuthor;
}

export function createMockReport(): JsonReport {
  const repoA: JsonRepoReport = {
    repoLabel: "org/frontend",
    analysis: {
      needingReview: [
        prNeedingReview({
          id: 101,
          title: "Add login page",
          author: "alice",
          isStarred: true,
          size: { linesAdded: 120, linesDeleted: 10, filesChanged: 5, totalChanges: 130, label: "M" },
          reviewers: [
            { displayName: "Bob", uniqueName: "bob@org.com", vote: 0, isRequired: true },
            { displayName: "Charlie", uniqueName: "charlie@org.com", vote: 5, isRequired: false },
          ],
          policyStatus: {
            total: 2,
            approved: 1,
            rejected: 1,
            running: 0,
            other: 0,
            evaluations: [
              { evaluationId: "e1", displayName: "Build validation", status: "approved", isBlocking: true },
              { evaluationId: "e2", displayName: "Minimum reviewers", status: "rejected", isBlocking: true },
            ],
          },
        }),
        prNeedingReview({
          id: 102,
          title: "Fix navbar styling",
          author: "dave",
          hasMergeConflict: true,
          size: { linesAdded: 5, linesDeleted: 3, filesChanged: 1, totalChanges: 8, label: "XS" },
          waitingSince: daysAgo(15),
        }),
      ],
      approved: [
        prApproved({
          id: 103,
          title: "Update dependencies",
          author: "eve",
          size: { linesAdded: 200, linesDeleted: 180, filesChanged: 12, totalChanges: 380, label: "L" },
          reviewers: [
            { displayName: "Bob", uniqueName: "bob@org.com", vote: 10, isRequired: true },
          ],
        }),
      ],
      waitingOnAuthor: [
        prWaitingOnAuthor({
          id: 104,
          title: "Refactor auth module",
          author: "frank",
          hasMergeConflict: true,
          reviewers: [
            { displayName: "Alice", uniqueName: "alice@org.com", vote: -5, isRequired: true },
          ],
          pipelineStatus: { total: 3, succeeded: 2, failed: 1, inProgress: 0, other: 0, runs: [] },
          lastReviewerActivityDate: daysAgo(35),
        }),
      ],
    },
    stats: {
      repoLabel: "org/frontend",
      approved: 1,
      needingReview: 2,
      waitingOnAuthor: 1,
      conflicts: 2,
      mergeRestarted: 0,
      mergeRestartFailed: 0,
    },
  };

  const repoB: JsonRepoReport = {
    repoLabel: "org/backend",
    analysis: {
      needingReview: [
        prNeedingReview({
          id: 201,
          title: "Add REST API endpoint",
          author: "grace",
          size: { linesAdded: 500, linesDeleted: 50, filesChanged: 20, totalChanges: 550, label: "XL" },
          reviewers: [
            { displayName: "Alice", uniqueName: "alice@org.com", vote: -10, isRequired: true },
            { displayName: "Bob", uniqueName: "bob@org.com", vote: 0, isRequired: true },
          ],
          policyStatus: {
            total: 3,
            approved: 2,
            rejected: 0,
            running: 1,
            other: 0,
            evaluations: [
              { evaluationId: "e3", displayName: "Build", status: "approved", isBlocking: true },
              { evaluationId: "e4", displayName: "Code coverage", status: "approved", isBlocking: false },
              { evaluationId: "e5", displayName: "Reviewers", status: "running", isBlocking: true },
            ],
          },
        }),
      ],
      approved: [
        prApproved({
          id: 202,
          title: "Fix database migration",
          author: "henry",
          size: { linesAdded: 30, linesDeleted: 5, filesChanged: 2, totalChanges: 35, label: "S" },
        }),
      ],
      waitingOnAuthor: [],
    },
    stats: {
      repoLabel: "org/backend",
      approved: 1,
      needingReview: 1,
      waitingOnAuthor: 0,
      conflicts: 0,
      mergeRestarted: 0,
      mergeRestartFailed: 0,
    },
  };

  return {
    generatedAt: NOW,
    version: "0.1.0",
    repositories: [repoA, repoB],
    aggregate: {
      totalPrs: 6,
      metrics: {
        medianAgeInDays: 5.2,
        avgTimeToFirstReviewInDays: 1.3,
        avgReviewRounds: 2.1,
        prsWithNoReviewActivity: 1,
      },
    },
  };
}

/** A minimal report with no PRs for empty-state testing */
export function createEmptyReport(): JsonReport {
  return {
    generatedAt: NOW,
    version: "0.1.0",
    repositories: [],
    aggregate: { totalPrs: 0 },
  };
}

/** A report with a single repo and single PR, useful for focused tests */
export function createSinglePrReport(): JsonReport {
  return {
    generatedAt: NOW,
    version: "0.1.0",
    repositories: [
      {
        repoLabel: "org/solo",
        analysis: {
          needingReview: [
            prNeedingReview({ id: 999, title: "Solo PR", author: "zara" }),
          ],
          approved: [],
          waitingOnAuthor: [],
        },
        stats: {
          repoLabel: "org/solo",
          approved: 0,
          needingReview: 1,
          waitingOnAuthor: 0,
          conflicts: 0,
          mergeRestarted: 0,
          mergeRestartFailed: 0,
        },
      },
    ],
    aggregate: { totalPrs: 1 },
  };
}
