import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DoraMetrics, DoraTrend, DoraHistoryEntry } from "../types.js";
import * as log from "../log.js";

const MAX_HISTORY_ENTRIES = 52; // ~1 year of weekly runs

export function loadDoraHistory(filePath: string): DoraHistoryEntry[] {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) return [];

  try {
    const raw = readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
    return [];
  } catch {
    log.warn(`Failed to parse DORA history at ${fullPath}, starting fresh`);
    return [];
  }
}

export function saveDoraSnapshot(
  filePath: string,
  metrics: DoraMetrics,
  existing?: DoraHistoryEntry[],
): void {
  const history = existing ?? loadDoraHistory(filePath);
  const entry: DoraHistoryEntry = {
    period: {
      start: metrics.period.start.toISOString(),
      end: metrics.period.end.toISOString(),
    },
    changeLeadTimeDays: metrics.changeLeadTime.medianDays,
    deploymentFrequencyPerWeek: metrics.deploymentFrequency.perWeek,
    changeFailureRatePercent: metrics.changeFailureRate.percentage,
    meanTimeToRestoreHours: metrics.meanTimeToRestore.medianHours,
  };

  history.push(entry);

  // Cap history size
  const trimmed = history.length > MAX_HISTORY_ENTRIES
    ? history.slice(history.length - MAX_HISTORY_ENTRIES)
    : history;

  const fullPath = resolve(filePath);
  writeFileSync(fullPath, JSON.stringify(trimmed, null, 2), "utf-8");
}

export function computeDoraTrend(
  current: DoraMetrics,
  history: DoraHistoryEntry[],
): DoraTrend {
  const previous = history.length > 0 ? history[history.length - 1] : undefined;

  if (!previous) {
    return {
      current,
      deltas: {
        changeLeadTime: null,
        deploymentFrequency: null,
        changeFailureRate: null,
        meanTimeToRestore: null,
      },
    };
  }

  return {
    current,
    previous: undefined, // Don't include full previous metrics in trend
    deltas: {
      changeLeadTime: round(current.changeLeadTime.medianDays - previous.changeLeadTimeDays),
      deploymentFrequency: round(current.deploymentFrequency.perWeek - previous.deploymentFrequencyPerWeek),
      changeFailureRate: round(current.changeFailureRate.percentage - previous.changeFailureRatePercent),
      meanTimeToRestore: round(current.meanTimeToRestore.medianHours - previous.meanTimeToRestoreHours),
    },
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
