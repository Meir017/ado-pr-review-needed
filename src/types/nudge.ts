export interface NudgeConfig {
  enabled: boolean;
  minStalenessLevel?: string;
  cooldownDays: number;
  commentTemplate: string;
  dryRun: boolean;
  historyFile: string;
}

export interface NudgeHistoryEntry {
  prId: number;
  repoUrl: string;
  lastNudgedAt: string;
  nudgeCount: number;
}

export interface NudgeHistory {
  entries: NudgeHistoryEntry[];
}

export interface NudgeResult {
  nudged: number;
  skipped: number;
  errors: number;
}
