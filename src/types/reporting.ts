import type { AnalysisResult, RepoSummaryStats } from "./analysis.js";

export type OutputFormat = "markdown" | "dashboard" | "json" | "html";

export interface JsonRepoReport {
  repoLabel: string;
  analysis: AnalysisResult;
  metrics?: import("../metrics.js").ReviewMetrics;
  workload?: import("../reviewer-workload.js").ReviewerWorkload[];
  staleness?: Record<string, number>;
  stats: RepoSummaryStats;
}

export interface JsonAggregateReport {
  totalPrs: number;
  metrics?: import("../metrics.js").AggregateMetrics;
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
