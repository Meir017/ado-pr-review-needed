import type { PullRequestInfo } from "./types.js";
import { collectActivities } from "./analysis/review-logic.js";

export interface PrCycleMetrics {
  prId: number;
  title: string;
  author: string;
  url: string;
  ageInDays: number;
  timeToFirstReviewInDays: number | null;
  reviewRounds: number;
  lastActivityDate: Date;
}

export interface AggregateMetrics {
  medianAgeInDays: number;
  avgTimeToFirstReviewInDays: number | null;
  avgReviewRounds: number;
  prsWithNoReviewActivity: number;
  totalPrs: number;
}

export interface AuthorMetrics {
  author: string;
  openPrCount: number;
  avgAgeInDays: number;
  avgReviewRounds: number;
  fastestReviewInDays: number | null;
}

export interface ReviewMetrics {
  perPr: PrCycleMetrics[];
  aggregate: AggregateMetrics;
  perAuthor: AuthorMetrics[];
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computePrCycleMetrics(pr: PullRequestInfo, botUsers: Set<string>, now: Date): PrCycleMetrics {
  const activities = collectActivities(pr, botUsers);
  const reviewerActivities = activities.filter((a) => !a.isAuthor).sort((a, b) => a.date.getTime() - b.date.getTime());

  const ageInDays = daysBetween(pr.createdDate, now);

  // Time to first review: earliest reviewer activity after PR creation
  const timeToFirstReviewInDays = reviewerActivities.length > 0
    ? daysBetween(pr.createdDate, reviewerActivities[0].date)
    : null;

  // Review rounds: count transitions from author activity to reviewer activity
  const allSorted = activities.sort((a, b) => a.date.getTime() - b.date.getTime());
  let reviewRounds = 0;
  let lastWasAuthor = false;
  for (const activity of allSorted) {
    if (activity.isAuthor) {
      lastWasAuthor = true;
    } else if (lastWasAuthor) {
      reviewRounds++;
      lastWasAuthor = false;
    }
  }

  const lastActivityDate = allSorted.length > 0
    ? allSorted[allSorted.length - 1].date
    : pr.createdDate;

  return {
    prId: pr.id,
    title: pr.title,
    author: pr.author,
    url: pr.url,
    ageInDays: Math.round(ageInDays * 10) / 10,
    timeToFirstReviewInDays: timeToFirstReviewInDays !== null
      ? Math.round(timeToFirstReviewInDays * 10) / 10
      : null,
    reviewRounds,
    lastActivityDate,
  };
}

export function computeReviewMetrics(
  prs: PullRequestInfo[],
  botUsers: Set<string> = new Set(),
  now: Date = new Date(),
): ReviewMetrics {
  const perPr = prs.map((pr) => computePrCycleMetrics(pr, botUsers, now));

  // Aggregate metrics
  const ages = perPr.map((m) => m.ageInDays);
  const firstReviewTimes = perPr
    .map((m) => m.timeToFirstReviewInDays)
    .filter((t): t is number => t !== null);
  const rounds = perPr.map((m) => m.reviewRounds);
  const prsWithNoReviewActivity = perPr.filter((m) => m.timeToFirstReviewInDays === null).length;

  const aggregate: AggregateMetrics = {
    medianAgeInDays: Math.round(median(ages) * 10) / 10,
    avgTimeToFirstReviewInDays: firstReviewTimes.length > 0
      ? Math.round((firstReviewTimes.reduce((s, v) => s + v, 0) / firstReviewTimes.length) * 10) / 10
      : null,
    avgReviewRounds: rounds.length > 0
      ? Math.round((rounds.reduce((s, v) => s + v, 0) / rounds.length) * 10) / 10
      : 0,
    prsWithNoReviewActivity,
    totalPrs: prs.length,
  };

  // Per-author aggregation
  const authorMap = new Map<string, PrCycleMetrics[]>();
  for (const m of perPr) {
    if (!authorMap.has(m.author)) authorMap.set(m.author, []);
    authorMap.get(m.author)!.push(m);
  }

  const perAuthor: AuthorMetrics[] = [];
  for (const [author, metrics] of authorMap) {
    const authorAges = metrics.map((m) => m.ageInDays);
    const authorRounds = metrics.map((m) => m.reviewRounds);
    const authorFirstReviews = metrics
      .map((m) => m.timeToFirstReviewInDays)
      .filter((t): t is number => t !== null);

    perAuthor.push({
      author,
      openPrCount: metrics.length,
      avgAgeInDays: Math.round((authorAges.reduce((s, v) => s + v, 0) / authorAges.length) * 10) / 10,
      avgReviewRounds: Math.round((authorRounds.reduce((s, v) => s + v, 0) / authorRounds.length) * 10) / 10,
      fastestReviewInDays: authorFirstReviews.length > 0
        ? Math.round(Math.min(...authorFirstReviews) * 10) / 10
        : null,
    });
  }

  perAuthor.sort((a, b) => b.openPrCount - a.openPrCount);

  return { perPr, aggregate, perAuthor };
}
