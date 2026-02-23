import type { PullRequestInfo, AnalysisResult } from "./types.js";
import { isBotAuthor } from "./analysis/review-logic.js";

export interface ReviewerWorkload {
  reviewer: string;
  displayName: string;
  assignedPrCount: number;
  pendingReviewCount: number;
  completedReviewCount: number;
  avgResponseTimeInDays: number | null;
  loadIndicator: "🟢" | "🟡" | "🔴";
}

export interface WorkloadThresholds {
  light: { maxPending: number; maxAvgResponseDays: number };
  medium: { maxPending: number; maxAvgResponseDays: number };
}

export const DEFAULT_WORKLOAD_THRESHOLDS: WorkloadThresholds = {
  light: { maxPending: 10, maxAvgResponseDays: 2 },
  medium: { maxPending: 20, maxAvgResponseDays: 4 },
};

function computeLoadIndicator(
  pendingCount: number,
  avgResponseDays: number | null,
  thresholds: WorkloadThresholds,
): "🟢" | "🟡" | "🔴" {
  const responseExceeds = (limit: number) =>
    avgResponseDays !== null && avgResponseDays > limit;

  if (pendingCount > thresholds.medium.maxPending || responseExceeds(thresholds.medium.maxAvgResponseDays)) {
    return "🔴";
  }
  if (pendingCount > thresholds.light.maxPending || responseExceeds(thresholds.light.maxAvgResponseDays)) {
    return "🟡";
  }
  return "🟢";
}

export function computeReviewerWorkload(
  prs: PullRequestInfo[],
  analysis: AnalysisResult,
  botUsers: Set<string> = new Set(),
  thresholds: WorkloadThresholds = DEFAULT_WORKLOAD_THRESHOLDS,
): ReviewerWorkload[] {
  const needingReviewIds = new Set(analysis.needingReview.map((pr) => pr.id));

  // Build per-reviewer data
  const reviewerMap = new Map<string, {
    displayName: string;
    assignedPrCount: number;
    pendingReviewCount: number;
    completedReviewCount: number;
    responseTimes: number[];
  }>();

  for (const pr of prs) {
    if (isBotAuthor(pr.authorUniqueName, botUsers)) continue;

    for (const reviewer of pr.reviewers) {
      if (isBotAuthor(reviewer.uniqueName, botUsers)) continue;

      const key = reviewer.uniqueName.toLowerCase();
      if (!reviewerMap.has(key)) {
        reviewerMap.set(key, {
          displayName: reviewer.displayName,
          assignedPrCount: 0,
          pendingReviewCount: 0,
          completedReviewCount: 0,
          responseTimes: [],
        });
      }

      const data = reviewerMap.get(key)!;
      data.assignedPrCount++;

      if (reviewer.vote >= 5) {
        data.completedReviewCount++;
      } else if (needingReviewIds.has(pr.id)) {
        data.pendingReviewCount++;
      }

      // Track response time for this reviewer specifically
      const reviewerComments = pr.threads
        .flatMap((t) => t.comments)
        .filter((c) => c.authorUniqueName.toLowerCase() === key)
        .sort((a, b) => a.publishedDate.getTime() - b.publishedDate.getTime());

      if (reviewerComments.length > 0) {
        const responseTime = (reviewerComments[0].publishedDate.getTime() - pr.createdDate.getTime()) / (1000 * 60 * 60 * 24);
        if (responseTime >= 0) {
          data.responseTimes.push(responseTime);
        }
      }
    }
  }

  const results: ReviewerWorkload[] = [];
  for (const [_key, data] of reviewerMap) {
    const avgResponseTimeInDays = data.responseTimes.length > 0
      ? Math.round((data.responseTimes.reduce((s, v) => s + v, 0) / data.responseTimes.length) * 10) / 10
      : null;

    results.push({
      reviewer: _key,
      displayName: data.displayName,
      assignedPrCount: data.assignedPrCount,
      pendingReviewCount: data.pendingReviewCount,
      completedReviewCount: data.completedReviewCount,
      avgResponseTimeInDays,
      loadIndicator: computeLoadIndicator(data.pendingReviewCount, avgResponseTimeInDays, thresholds),
    });
  }

  // Sort by pending review count descending (worst bottlenecks first)
  results.sort((a, b) => b.pendingReviewCount - a.pendingReviewCount);

  return results;
}
