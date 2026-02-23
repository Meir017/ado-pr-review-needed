import type { BuildInfo, DoraMetrics, DoraMetricValue, DoraRating } from "../types.js";

// DORA benchmark thresholds (2024 State of DevOps Report)
const LEAD_TIME_THRESHOLDS = { elite: 1, high: 7, medium: 30 }; // days
const DEPLOY_FREQ_THRESHOLDS = { elite: 7, high: 1, medium: 1 / 4 }; // per week
const FAILURE_RATE_THRESHOLDS = { elite: 5, high: 10, medium: 15 }; // percent
const MTTR_THRESHOLDS = { elite: 1, high: 24, medium: 168 }; // hours

function rateChangeLeadTime(days: number): DoraRating {
  if (days <= LEAD_TIME_THRESHOLDS.elite) return "elite";
  if (days <= LEAD_TIME_THRESHOLDS.high) return "high";
  if (days <= LEAD_TIME_THRESHOLDS.medium) return "medium";
  return "low";
}

function rateDeployFrequency(perWeek: number): DoraRating {
  if (perWeek >= DEPLOY_FREQ_THRESHOLDS.elite) return "elite";
  if (perWeek >= DEPLOY_FREQ_THRESHOLDS.high) return "high";
  if (perWeek >= DEPLOY_FREQ_THRESHOLDS.medium) return "medium";
  return "low";
}

function rateFailureRate(percent: number): DoraRating {
  if (percent <= FAILURE_RATE_THRESHOLDS.elite) return "elite";
  if (percent <= FAILURE_RATE_THRESHOLDS.high) return "high";
  if (percent <= FAILURE_RATE_THRESHOLDS.medium) return "medium";
  return "low";
}

function rateMttr(hours: number): DoraRating {
  if (hours <= MTTR_THRESHOLDS.elite) return "elite";
  if (hours <= MTTR_THRESHOLDS.high) return "high";
  if (hours <= MTTR_THRESHOLDS.medium) return "medium";
  return "low";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface MergedPrInfo {
  createdDate: Date;
  mergedDate: Date;
}

/**
 * Compute Change Lead Time from merged PRs.
 * Lead time = time from PR creation to merge completion.
 */
export function computeChangeLeadTime(mergedPrs: MergedPrInfo[]): DoraMetricValue & { medianDays: number } {
  if (mergedPrs.length === 0) {
    return { value: 0, medianDays: 0, rating: "low" };
  }

  const leadTimes = mergedPrs.map((pr) => {
    const diffMs = pr.mergedDate.getTime() - pr.createdDate.getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  });

  const medianDays = Math.round(median(leadTimes) * 10) / 10;
  return { value: medianDays, medianDays, rating: rateChangeLeadTime(medianDays) };
}

/**
 * Compute Deployment Frequency from successful builds.
 */
export function computeDeploymentFrequency(
  builds: BuildInfo[],
  periodDays: number,
): DoraMetricValue & { perWeek: number } {
  const succeeded = builds.filter((b) => b.result === "succeeded");
  const weeks = periodDays / 7;
  const perWeek = weeks > 0 ? Math.round((succeeded.length / weeks) * 10) / 10 : 0;
  return { value: perWeek, perWeek, rating: rateDeployFrequency(perWeek) };
}

/**
 * Compute Change Failure Rate from builds.
 */
export function computeChangeFailureRate(
  builds: BuildInfo[],
): DoraMetricValue & { percentage: number } {
  if (builds.length === 0) {
    return { value: 0, percentage: 0, rating: "elite" };
  }
  const failed = builds.filter((b) => b.result === "failed").length;
  const percentage = Math.round((failed / builds.length) * 1000) / 10;
  return { value: percentage, percentage, rating: rateFailureRate(percentage) };
}

/**
 * Compute Mean Time to Restore from build failure/recovery pairs.
 */
export function computeMeanTimeToRestore(
  builds: BuildInfo[],
): DoraMetricValue & { medianHours: number } {
  if (builds.length === 0) {
    return { value: 0, medianHours: 0, rating: "elite" };
  }

  // Sort by finish time
  const sorted = [...builds].sort(
    (a, b) => a.finishTime.getTime() - b.finishTime.getTime(),
  );

  const restoreTimes: number[] = [];
  let lastFailure: BuildInfo | null = null;

  for (const build of sorted) {
    if (build.result === "failed") {
      if (!lastFailure) lastFailure = build;
    } else if (build.result === "succeeded" && lastFailure) {
      const restoreMs = build.finishTime.getTime() - lastFailure.finishTime.getTime();
      restoreTimes.push(restoreMs / (1000 * 60 * 60));
      lastFailure = null;
    }
  }

  if (restoreTimes.length === 0) {
    return { value: 0, medianHours: 0, rating: "elite" };
  }

  const medianHours = Math.round(median(restoreTimes) * 10) / 10;
  return { value: medianHours, medianHours, rating: rateMttr(medianHours) };
}

/**
 * Compute all 4 DORA metrics.
 */
export function computeDoraMetrics(
  mergedPrs: MergedPrInfo[],
  builds: BuildInfo[],
  periodDays: number,
  now: Date = new Date(),
): DoraMetrics {
  const start = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  return {
    period: { start, end: now },
    changeLeadTime: computeChangeLeadTime(mergedPrs),
    deploymentFrequency: computeDeploymentFrequency(builds, periodDays),
    changeFailureRate: computeChangeFailureRate(builds),
    meanTimeToRestore: computeMeanTimeToRestore(builds),
  };
}
