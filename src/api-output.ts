import { writeFileSync } from "node:fs";
import type { JsonReport, JsonRepoReport, JsonAggregateReport, WebhookConfig } from "./types.js";
import type { AggregateMetrics } from "./metrics.js";
import * as log from "./log.js";

export function buildJsonReport(
  repos: JsonRepoReport[],
  version: string,
  now?: Date,
): JsonReport {
  const totalPrs = repos.reduce(
    (sum, r) =>
      sum +
      r.analysis.approved.length +
      r.analysis.needingReview.length +
      r.analysis.waitingOnAuthor.length,
    0,
  );

  // Merge aggregate metrics across repos
  let aggregateMetrics: AggregateMetrics | undefined;
  const repoMetrics = repos.filter((r) => r.metrics).map((r) => r.metrics!);
  if (repoMetrics.length > 0) {
    const allAggregate = repoMetrics.map((m) => m.aggregate);
    aggregateMetrics = {
      medianAgeInDays:
        allAggregate.reduce((s, a) => s + a.medianAgeInDays, 0) / allAggregate.length,
      avgTimeToFirstReviewInDays: averageNullable(
        allAggregate.map((a) => a.avgTimeToFirstReviewInDays),
      ),
      avgReviewRounds:
        allAggregate.reduce((s, a) => s + a.avgReviewRounds, 0) / allAggregate.length,
      prsWithNoReviewActivity: allAggregate.reduce(
        (s, a) => s + a.prsWithNoReviewActivity,
        0,
      ),
      totalPrs: allAggregate.reduce((s, a) => s + a.totalPrs, 0),
    };
  }

  // Merge staleness counts across repos
  let aggregateStaleness: Record<string, number> | undefined;
  const repoStaleness = repos.filter((r) => r.staleness).map((r) => r.staleness!);
  if (repoStaleness.length > 0) {
    aggregateStaleness = {};
    for (const s of repoStaleness) {
      for (const [label, count] of Object.entries(s)) {
        aggregateStaleness[label] = (aggregateStaleness[label] ?? 0) + count;
      }
    }
  }

  const aggregate: JsonAggregateReport = {
    totalPrs,
    metrics: aggregateMetrics,
    staleness: aggregateStaleness,
  };

  return {
    generatedAt: (now ?? new Date()).toISOString(),
    version,
    repositories: repos,
    aggregate,
  };
}

export async function writeJsonOutput(
  report: JsonReport,
  destination: string,
): Promise<void> {
  const json = JSON.stringify(report, null, 2);
  if (destination === "-") {
    process.stdout.write(json + "\n");
  } else {
    writeFileSync(destination, json, "utf-8");
    log.success(`JSON report written to ${destination}`);
  }
}

export async function sendWebhookPayload(
  report: JsonReport,
  config: WebhookConfig,
): Promise<void> {
  const method = config.method ?? "POST";
  try {
    const response = await fetch(config.url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(report),
    });
    if (!response.ok) {
      log.warn(`Webhook ${method} to ${config.url} returned ${response.status}: ${response.statusText}`);
    } else {
      log.success(`Webhook ${method} to ${config.url} succeeded (${response.status})`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Webhook ${method} to ${config.url} failed: ${msg}`);
  }
}

function averageNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}
