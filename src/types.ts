import type { IdentityRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";

export type PrAction = "APPROVE" | "REVIEW" | "PENDING";

export type PrSizeLabel = "XS" | "S" | "M" | "L" | "XL";

export interface PrSizeInfo {
  linesAdded: number;
  linesDeleted: number;
  totalChanges: number;
  label: PrSizeLabel;
}

export interface SizeThreshold {
  label: PrSizeLabel;
  maxChanges: number;
}

export interface QuantifierConfig {
  enabled: boolean;
  excludedPatterns: string[];
  thresholds: SizeThreshold[];
}

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

export const DEFAULT_THRESHOLDS: SizeThreshold[] = [
  { label: "XS", maxChanges: 10 },
  { label: "S", maxChanges: 40 },
  { label: "M", maxChanges: 100 },
  { label: "L", maxChanges: 400 },
  { label: "XL", maxChanges: 1000 },
];

export interface ReviewerInfo {
  displayName: string;
  uniqueName: string;
  vote: number;
}

export interface ThreadComment {
  authorUniqueName: string;
  publishedDate: Date;
}

export interface ThreadInfo {
  id: number;
  comments: ThreadComment[];
  publishedDate: Date;
}

export interface PullRequestInfo {
  id: number;
  title: string;
  author: string;
  authorUniqueName: string;
  url: string;
  createdDate: Date;
  reviewers: ReviewerInfo[];
  threads: ThreadInfo[];
  labels: string[];
  detectedLabels: string[];
  mergeStatus: number;
  lastSourcePushDate: Date | undefined;
  size?: PrSizeInfo;
  description?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface PrNeedingReview {
  id: number;
  title: string;
  author: string;
  url: string;
  waitingSince: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  reviewerNames?: string[];
}

export interface PrWaitingOnAuthor {
  id: number;
  title: string;
  author: string;
  url: string;
  lastReviewerActivityDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
}

export interface AnalysisResult {
  approved: PrApproved[];
  needingReview: PrNeedingReview[];
  waitingOnAuthor: PrWaitingOnAuthor[];
}

export interface PrApproved {
  id: number;
  title: string;
  author: string;
  url: string;
  createdDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
}

export interface RepoSummaryStats {
  repoLabel: string;
  approved: number;
  needingReview: number;
  waitingOnAuthor: number;
  conflicts: number;
  mergeRestarted: number;
  mergeRestartFailed: number;
}

export interface SummaryStats {
  totalConflicts: number;
  mergeRestarted: number;
  mergeRestartFailed: number;
  repoStats?: RepoSummaryStats[];
}

export function computeSummaryStats(analysis: AnalysisResult, mergeRestarted: number, mergeRestartFailed: number, repoStats?: RepoSummaryStats[]): SummaryStats {
  const allPrs = [
    ...analysis.approved,
    ...analysis.needingReview,
    ...analysis.waitingOnAuthor,
  ];
  const totalConflicts = allPrs.filter((pr) => pr.hasMergeConflict).length;
  return { totalConflicts, mergeRestarted, mergeRestartFailed, repoStats };
}

export function computeRepoSummaryStats(repoLabel: string, analysis: AnalysisResult, mergeRestarted: number, mergeRestartFailed: number): RepoSummaryStats {
  const allPrs = [
    ...analysis.approved,
    ...analysis.needingReview,
    ...analysis.waitingOnAuthor,
  ];
  return {
    repoLabel,
    approved: analysis.approved.length,
    needingReview: analysis.needingReview.length,
    waitingOnAuthor: analysis.waitingOnAuthor.length,
    conflicts: allPrs.filter((pr) => pr.hasMergeConflict).length,
    mergeRestarted,
    mergeRestartFailed,
  };
}

export function identityUniqueName(identity: IdentityRef | undefined): string {
  return identity?.uniqueName?.toLowerCase() ?? "";
}

export interface NotificationFilter {
  sections?: ("approved" | "needingReview" | "waitingOnAuthor")[];
  minStalenessLevel?: string;
}

export interface TeamsNotificationConfig {
  webhookUrl: string;
  filters?: NotificationFilter;
}

export interface NotificationsConfig {
  teams?: TeamsNotificationConfig;
}

// --- Feature 12: JSON/Webhook API Output ---

export type OutputFormat = "markdown" | "dashboard" | "json" | "html";

export interface JsonRepoReport {
  repoLabel: string;
  analysis: AnalysisResult;
  metrics?: import("./metrics.js").ReviewMetrics;
  workload?: import("./reviewer-workload.js").ReviewerWorkload[];
  staleness?: Record<string, number>;
  stats: RepoSummaryStats;
}

export interface JsonAggregateReport {
  totalPrs: number;
  metrics?: import("./metrics.js").AggregateMetrics;
  staleness?: Record<string, number>;
}

export interface JsonReport {
  generatedAt: string;
  version: string;
  repositories: JsonRepoReport[];
  aggregate: JsonAggregateReport;
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  method?: "POST" | "PUT";
}

// --- Feature 10: Auto-Comment / Nudge on Stale PRs ---

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

// --- Feature 13: PR Dependency Tracking ---

export type DependencyReason = "branch" | "fileOverlap" | "mention";

export interface PrDependency {
  fromPrId: number;
  toPrId: number;
  reason: DependencyReason;
  details: string;
}

export interface DependencyChain {
  chainId: number;
  prIds: number[];
  status: "ready" | "blocked";
  blockerDescription?: string;
}

export interface DependencyGraph {
  dependencies: PrDependency[];
  chains: DependencyChain[];
  blockedPrIds: number[];
}

export interface DependencyConfig {
  enabled: boolean;
  strategies: DependencyReason[];
  fileOverlapThreshold: number;
  mentionPattern: string;
}

// --- Feature 11: DORA Metrics ---

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
