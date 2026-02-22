import type { StalenessThreshold } from "./types.js";

/**
 * Compute the staleness badge for a PR based on its date and configured thresholds.
 * Thresholds must be sorted descending by minDays.
 * Returns the label of the highest matching threshold, or null if the PR is fresh.
 */
export function computeStalenessBadge(
  date: Date,
  thresholds: StalenessThreshold[],
  now: Date = new Date(),
): string | null {
  if (thresholds.length === 0) return null;

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  for (const threshold of thresholds) {
    if (diffDays >= threshold.minDays) {
      return threshold.label;
    }
  }

  return null;
}
