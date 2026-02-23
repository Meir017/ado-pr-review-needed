export interface StalenessThreshold {
  label: string;
  minDays: number;
}

export interface StalenessConfig {
  enabled: boolean;
  thresholds: StalenessThreshold[];
}

export const DEFAULT_STALENESS_THRESHOLDS: StalenessThreshold[] = [
  { label: "⚠️ Aging", minDays: 7 },
  { label: "🔴 Stale", minDays: 14 },
  { label: "💀 Abandoned", minDays: 30 },
];
