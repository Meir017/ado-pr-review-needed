import type { AnalysisResult, PrNeedingReview, PrWaitingOnAuthor, PrApproved, PrSizeInfo, PrAction, SummaryStats, StalenessConfig, DependencyGraph } from "./types.js";
import { computeStalenessBadge } from "./staleness.js";
import type { ReviewMetrics } from "./metrics.js";
import type { ReviewerWorkload } from "./reviewer-workload.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";
const BG_GREEN = "\x1b[42m";
const BG_YELLOW = "\x1b[43m";

function link(text: string, url: string): string {
  // OSC 8 hyperlink: \x1b]8;;URL\x1b\\text\x1b]8;;\x1b\\
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function ageColor(date: Date, now: Date): { color: string; label: string } {
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor(diffMs / (1000 * 60));

  let label: string;
  if (days > 0) label = `${days}d`;
  else if (hours > 0) label = `${hours}h`;
  else label = `${mins}m`;

  if (days > 3) return { color: RED, label };
  if (days > 1) return { color: YELLOW, label };
  return { color: GREEN, label };
}

function badge(bg: string, text: string): string {
  return `${bg}${BOLD} ${text} ${RESET}`;
}

function conflictIndicator(has: boolean): string {
  return has ? ` ${RED}⚠ conflict${RESET}` : "";
}

function formatSize(size?: PrSizeInfo): string {
  if (!size) return "";
  const color = size.label === "XS" || size.label === "S"
    ? GREEN
    : size.label === "M"
      ? YELLOW
      : RED;
  return ` ${color}${BOLD}${size.label}${RESET}`;
}

function pad(str: string, width: number): string {
  // Strip ANSI for length calculation
  // eslint-disable-next-line no-control-regex
  const visible = str.replace(/\x1b\][^\x1b]*\x1b\\|\x1b\[[0-9;]*m/g, "");
  const diff = width - visible.length;
  return diff > 0 ? str + " ".repeat(diff) : str;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

function formatAction(action: PrAction): string {
  switch (action) {
    case "APPROVE": return `${GREEN}${BOLD}APPROVE${RESET}`;
    case "REVIEW": return `${YELLOW}${BOLD}REVIEW${RESET}`;
    case "PENDING": return `${DIM}PENDING${RESET}`;
  }
}

function renderPrRow(
  id: number,
  title: string,
  author: string,
  url: string,
  date: Date,
  hasMergeConflict: boolean,
  now: Date,
  action: PrAction,
  size?: PrSizeInfo,
  detectedLabels?: string[],
  stalenessBadge?: string | null,
): string {
  const { color, label } = ageColor(date, now);
  const ageText = `${color}${BOLD}${label}${RESET}`;
  const prId = `${DIM}#${id}${RESET}`;
  const prTitle = truncate(title.replace(/[\r\n]+/g, " ").trim(), 60);
  const prLink = link(`${prId} ${WHITE}${prTitle}${RESET}`, url);
  const authorText = `${DIM}${truncate(author, 20)}${RESET}`;
  const conflict = conflictIndicator(hasMergeConflict);
  const sizeText = formatSize(size);
  const actionText = formatAction(action);
  const labelsText = detectedLabels && detectedLabels.length > 0
    ? " " + detectedLabels.map((l) => `${DIM}[${l}]${RESET}`).join(" ")
    : "";
  const stalenessText = stalenessBadge ? ` ${YELLOW}${stalenessBadge}${RESET}` : "";

  return `  ${ageText}  ${pad(prLink, 80)} ${authorText}${sizeText} ${actionText}${conflict}${stalenessText}${labelsText}`;
}

function renderSection<T>(
  title: string,
  bg: string,
  items: T[],
  getRow: (item: T) => { id: number; title: string; author: string; url: string; date: Date; hasMergeConflict: boolean; action: PrAction; size?: PrSizeInfo; detectedLabels?: string[]; stalenessBadge?: string | null },
  now: Date,
  getRepo?: (item: T) => string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`\n ${badge(bg, `${title} (${items.length})`)}\n`);

  if (items.length === 0) {
    lines.push(`  ${DIM}No PRs${RESET}\n`);
    return lines.join("\n");
  }

  if (getRepo) {
    // Group by repository
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key = getRepo(item) ?? "Unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    for (const [repo, repoItems] of groups) {
      lines.push(`  ${BOLD}${CYAN}📂 ${repo}${RESET}`);
      for (const item of repoItems) {
        const { id, title, author, url, date, hasMergeConflict, action, size, detectedLabels, stalenessBadge } = getRow(item);
        lines.push(renderPrRow(id, title, author, url, date, hasMergeConflict, now, action, size, detectedLabels, stalenessBadge));
      }
      lines.push("");
    }
  } else {
    for (const item of items) {
      const { id, title, author, url, date, hasMergeConflict, action, size, detectedLabels, stalenessBadge } = getRow(item);
      lines.push(renderPrRow(id, title, author, url, date, hasMergeConflict, now, action, size, detectedLabels, stalenessBadge));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderMetricsSummary(metrics: ReviewMetrics): string {
  const lines: string[] = [];
  lines.push(`\n ${badge(BG_YELLOW, `📈 Review Metrics`)}\n`);
  lines.push(`  ${DIM}Median PR age:${RESET} ${BOLD}${metrics.aggregate.medianAgeInDays}d${RESET}` +
    `  ${DIM}Avg first review:${RESET} ${BOLD}${metrics.aggregate.avgTimeToFirstReviewInDays ?? "N/A"}d${RESET}` +
    `  ${DIM}Avg rounds:${RESET} ${BOLD}${metrics.aggregate.avgReviewRounds}${RESET}` +
    `  ${DIM}No review:${RESET} ${BOLD}${metrics.aggregate.prsWithNoReviewActivity}${RESET}`);
  lines.push("");
  return lines.join("\n");
}

function renderWorkloadSummary(workload: ReviewerWorkload[]): string {
  if (workload.length === 0) return "";
  const lines: string[] = [];
  lines.push(`\n ${badge(BG_RED, `👥 Top Reviewer Bottlenecks`)}\n`);
  const top5 = workload.slice(0, 5);
  for (const r of top5) {
    const responseText = r.avgResponseTimeInDays !== null ? `${r.avgResponseTimeInDays}d avg` : "no response";
    lines.push(`  ${r.loadIndicator} ${BOLD}${r.displayName}${RESET} — ${r.pendingReviewCount} pending / ${r.assignedPrCount} assigned (${responseText})`);
  }
  lines.push("");
  return lines.join("\n");
}

export interface RenderDashboardOptions {
  analysis: AnalysisResult;
  repoLabel: string;
  multiRepo?: boolean;
  stats?: SummaryStats;
  staleness?: StalenessConfig;
  metrics?: ReviewMetrics;
  workload?: ReviewerWorkload[];
  dependencyGraph?: DependencyGraph;
}

export function renderDashboard(options: RenderDashboardOptions): string {
  const { analysis, repoLabel, multiRepo = false, stats, staleness, metrics, workload, dependencyGraph } = options;
  const now = new Date();
  const { approved, needingReview, waitingOnAuthor } = analysis;
  const total = approved.length + needingReview.length + waitingOnAuthor.length;
  const stalenessThresholds = staleness?.enabled !== false ? staleness?.thresholds ?? [] : [];

  const lines: string[] = [];

  lines.push("");
  lines.push(`${BOLD}${CYAN}  ┌─────────────────────────────────────────────┐${RESET}`);
  lines.push(`${BOLD}${CYAN}  │  📋 PR Review Dashboard                     │${RESET}`);
  lines.push(`${BOLD}${CYAN}  │  ${RESET}${DIM}${truncate(repoLabel, 42)}${RESET}${BOLD}${CYAN}${" ".repeat(Math.max(0, 42 - repoLabel.length))}│${RESET}`);
  lines.push(`${BOLD}${CYAN}  └─────────────────────────────────────────────┘${RESET}`);
  lines.push("");

  const repoGetter = multiRepo
    ? <T extends { repository?: string }>(item: T) => item.repository
    : undefined;

  lines.push(renderSection("✅ Approved", BG_GREEN, approved,
    (pr: PrApproved) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.createdDate, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size, detectedLabels: pr.detectedLabels, stalenessBadge: computeStalenessBadge(pr.createdDate, stalenessThresholds, now) }),
    now, repoGetter));

  lines.push(renderSection("👀 Needing Review", BG_YELLOW, needingReview,
    (pr: PrNeedingReview) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.waitingSince, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size, detectedLabels: pr.detectedLabels, stalenessBadge: computeStalenessBadge(pr.waitingSince, stalenessThresholds, now) }),
    now, repoGetter));

  lines.push(renderSection("✍️  Waiting on Author", BG_RED, waitingOnAuthor,
    (pr: PrWaitingOnAuthor) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.lastReviewerActivityDate, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size, detectedLabels: pr.detectedLabels, stalenessBadge: computeStalenessBadge(pr.lastReviewerActivityDate, stalenessThresholds, now) }),
    now, repoGetter));

  if (metrics) {
    lines.push(renderMetricsSummary(metrics));
  }

  if (workload && workload.length > 0) {
    lines.push(renderWorkloadSummary(workload));
  }

  if (dependencyGraph && dependencyGraph.dependencies.length > 0) {
    lines.push(renderDependencySummary(dependencyGraph));
  }

  let summaryLine = `Total: ${total} open PRs — ${approved.length} approved, ${needingReview.length} needing review, ${waitingOnAuthor.length} waiting on author`;
  if (stats) {
    summaryLine += `, ${stats.totalConflicts} with conflicts`;
    if (stats.mergeRestarted > 0 || stats.mergeRestartFailed > 0) {
      summaryLine += `, ${stats.mergeRestarted} merge restarted`;
      if (stats.mergeRestartFailed > 0) {
        summaryLine += ` (${stats.mergeRestartFailed} failed)`;
      }
    }
  }
  lines.push(`  ${DIM}${summaryLine}${RESET}`);
  lines.push(`  ${DIM}Updated: ${now.toLocaleString()}${RESET}`);
  lines.push("");

  return lines.join("\n");
}

function renderDependencySummary(graph: DependencyGraph): string {
  const lines: string[] = [];
  lines.push(`  ${BOLD}🔗 PR Dependencies${RESET}`);
  lines.push(`  ${DIM}${graph.chains.length} chain(s), ${graph.blockedPrIds.length} blocked PR(s), ${graph.dependencies.length} dependency link(s)${RESET}`);

  for (const chain of graph.chains.slice(0, 5)) {
    const prList = chain.prIds.map((id) => `#${id}`).join(" → ");
    const status = chain.status === "blocked" ? `${RED}⚠️ blocked${RESET}` : `${GREEN}✅ ready${RESET}`;
    lines.push(`    Chain ${chain.chainId}: ${prList} ${status}`);
  }

  if (graph.chains.length > 5) {
    lines.push(`    ${DIM}... and ${graph.chains.length - 5} more chain(s)${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}
