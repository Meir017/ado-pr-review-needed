export type DoraRating = "elite" | "high" | "medium" | "low";

export interface DoraMetricValue {
  value: number;
  rating: DoraRating;
}

export interface DoraMetrics {
  period: { start: Date; end: Date };
  changeLeadTime: DoraMetricValue & { medianDays: number };
  deploymentFrequency: DoraMetricValue & { perWeek: number };
  changeFailureRate: DoraMetricValue & { percentage: number };
  meanTimeToRestore: DoraMetricValue & { medianHours: number };
}

export interface DoraTrend {
  current: DoraMetrics;
  previous?: DoraMetrics;
  deltas: {
    changeLeadTime: number | null;
    deploymentFrequency: number | null;
    changeFailureRate: number | null;
    meanTimeToRestore: number | null;
  };
}

export interface DoraConfig {
  enabled: boolean;
  periodDays: number;
  buildDefinitionIds?: number[];
  historyFile: string;
}

export interface BuildInfo {
  id: number;
  definitionName: string;
  startTime: Date;
  finishTime: Date;
  result: "succeeded" | "failed" | "canceled" | "partiallySucceeded";
  sourceBranch: string;
  sourceVersion: string;
}

export interface DoraHistoryEntry {
  period: { start: string; end: string };
  changeLeadTimeDays: number;
  deploymentFrequencyPerWeek: number;
  changeFailureRatePercent: number;
  meanTimeToRestoreHours: number;
}
