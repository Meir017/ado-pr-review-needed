import type { AnalysisResult, PrSizeInfo, PrAction, SummaryStats, RepoSummaryStats, StalenessConfig, DependencyGraph, DoraTrend, DoraRating } from "../types.js";
import { computeStalenessBadge } from "../analysis/staleness.js";
import type { ReviewMetrics } from "../metrics.js";
import type { ReviewerWorkload } from "../reviewer-workload.js";
import { computeTimeAge, computeSizeUrgency, buildSummaryLine, formatPipelineBadge } from "./report-data.js";
import type { PrRowData } from "./report-data.js";

function formatTimeSince(date: Date, now: Date = new Date()): string {
  const age = computeTimeAge(date, now);

  const circle = age.urgency === "high" ? "🔴" : age.urgency === "medium" ? "🟡" : "🟢";

  let timeText: string;
  if (age.days > 0) {
    timeText = `${age.days} day${age.days === 1 ? "" : "s"} ago`;
  } else if (age.hours > 0) {
    timeText = `${age.hours} hour${age.hours === 1 ? "" : "s"} ago`;
  } else {
    timeText = `${age.minutes} minute${age.minutes === 1 ? "" : "s"} ago`;
  }

  return `${circle} ${timeText}`;
}

function formatSizeLabel(size: PrSizeInfo): string {
  const urgency = computeSizeUrgency(size.label);
  const emoji = urgency === "low" ? "🟢" : urgency === "medium" ? "🟡" : "🔴";
  return `${emoji} ${size.label}`;
}

function formatAction(action: PrAction): string {
  switch (action) {
    case "APPROVE": return "🟢 APPROVE";
    case "REVIEW": return "🔍 REVIEW";
    case "PENDING": return "⏳ PENDING";
  }
}

function formatLabels(labels?: string[]): string {
  if (!labels || labels.length === 0) return "";
  return " " + labels.map((l) => `\`${escapeMarkdown(l)}\``).join(" ");
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\|/g, "\\|");
}

function generateTable(prs: PrRowData[], dateHeader: string, emptyMsg: string, now: Date, multiRepo: boolean = false): string {
  if (prs.length === 0) {
    return `_${emptyMsg}_\n\n`;
  }

  const hasSize = prs.some((pr) => pr.size != null);
  const hasStaleness = prs.some((pr) => pr.stalenessBadge);
  const hasPipeline = prs.some((pr) => pr.pipelineStatus != null);

  if (multiRepo) {
    const headers = ["PR", "Repository", "Author", "Action"];
    if (hasSize) headers.push("Size");
    if (hasPipeline) headers.push("Pipelines");
    if (hasStaleness) headers.push("Staleness");
    headers.push(dateHeader);
    let table = `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n`;

    for (const pr of prs) {
      const conflictEmoji = pr.hasMergeConflict ? " ❌" : "";
      const title = escapeMarkdown(pr.title);
      const author = escapeMarkdown(pr.author);
      const repo = escapeMarkdown(pr.repository ?? "Unknown");
      const labelsBadge = formatLabels(pr.detectedLabels);
      const prLink = `[#${pr.id} - ${title}](${pr.url})${conflictEmoji}${labelsBadge}`;
      const timeSince = formatTimeSince(pr.dateColumn, now);
      const actionCol = formatAction(pr.action);
      const sizeCol = hasSize ? ` ${pr.size ? formatSizeLabel(pr.size) : ""} |` : "";
      const pipelineCol = hasPipeline ? ` ${formatPipelineBadge(pr.pipelineStatus)} |` : "";
      const stalenessCol = hasStaleness ? ` ${pr.stalenessBadge ?? ""} |` : "";
      table += `| ${prLink} | ${repo} | ${author} | ${actionCol} |${sizeCol}${pipelineCol}${stalenessCol} ${timeSince} |\n`;
    }

    return table + "\n";
  }

  const headers = ["PR", "Author", "Action"];
  if (hasSize) headers.push("Size");
  if (hasPipeline) headers.push("Pipelines");
  if (hasStaleness) headers.push("Staleness");
  headers.push(dateHeader);
  let table = `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n`;

  for (const pr of prs) {
    const conflictEmoji = pr.hasMergeConflict ? " ❌" : "";
    const title = escapeMarkdown(pr.title);
    const author = escapeMarkdown(pr.author);
    const labelsBadge = formatLabels(pr.detectedLabels);
    const prLink = `[#${pr.id} - ${title}](${pr.url})${conflictEmoji}${labelsBadge}`;
    const timeSince = formatTimeSince(pr.dateColumn, now);
    const actionCol = formatAction(pr.action);
    const sizeCol = hasSize ? ` ${pr.size ? formatSizeLabel(pr.size) : ""} |` : "";
    const pipelineCol = hasPipeline ? ` ${formatPipelineBadge(pr.pipelineStatus)} |` : "";
    const stalenessCol = hasStaleness ? ` ${pr.stalenessBadge ?? ""} |` : "";
    table += `| ${prLink} | ${author} | ${actionCol} |${sizeCol}${pipelineCol}${stalenessCol} ${timeSince} |\n`;
  }

  return table + "\n";
}

function splitTeamCommunity<T extends { isTeamMember: boolean }>(
  items: T[],
): { team: T[]; community: T[] } {
  const allTeam = items.every((i) => i.isTeamMember);

  // If no team config (all treated as team), don't split
  if (allTeam) {
    return { team: items, community: [] };
  }

  return {
    team: items.filter((i) => i.isTeamMember),
    community: items.filter((i) => !i.isTeamMember),
  };
}

function renderSection<T extends { isTeamMember: boolean }>(
  heading: string,
  items: T[],
  toRow: (item: T) => PrRowData,
  dateHeader: string,
  emptyMsg: string,
  now: Date,
  multiRepo: boolean = false,
): string {
  let md = `## ${heading}\n\n`;

  const { team, community } = splitTeamCommunity(items);

  if (community.length > 0) {
    md += `### Team PRs\n\n`;
    md += generateTable(team.map(toRow), dateHeader, `No team PRs.`, now, multiRepo);
    md += `### Community Contributions\n\n`;
    md += generateTable(community.map(toRow), dateHeader, `No community PRs.`, now, multiRepo);
  } else {
    md += generateTable(items.map(toRow), dateHeader, emptyMsg, now, multiRepo);
  }

  return md;
}

function generateRepoStatsTable(repoStats: RepoSummaryStats[]): string {
  let table = `## 📊 Statistics per Repository\n\n`;
  table += `| Repository | Open PRs | ✅ Approved | 👀 Needs Review | ✍️ Waiting on Author | ❌ Conflicts | 🔄 Merge Restarted |\n`;
  table += `|---|---|---|---|---|---|---|\n`;

  for (const repo of repoStats) {
    const total = repo.approved + repo.needingReview + repo.waitingOnAuthor;
    const restartCol = repo.mergeRestarted > 0
      ? repo.mergeRestartFailed > 0
        ? `${repo.mergeRestarted} (${repo.mergeRestartFailed} failed)`
        : `${repo.mergeRestarted}`
      : "0";
    table += `| ${escapeMarkdown(repo.repoLabel)} | ${total} | ${repo.approved} | ${repo.needingReview} | ${repo.waitingOnAuthor} | ${repo.conflicts} | ${restartCol} |\n`;
  }

  return table + "\n";
}

function formatDays(days: number): string {
  if (days < 1) return "< 1 day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function generateMetricsSection(metrics: ReviewMetrics): string {
  let md = `## 📈 Review Metrics\n\n`;

  // Aggregate table
  md += `### Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total open PRs | ${metrics.aggregate.totalPrs} |\n`;
  md += `| Median PR age | ${formatDays(metrics.aggregate.medianAgeInDays)} |\n`;
  md += `| Avg time to first review | ${metrics.aggregate.avgTimeToFirstReviewInDays !== null ? formatDays(metrics.aggregate.avgTimeToFirstReviewInDays) : "N/A"} |\n`;
  md += `| Avg review rounds | ${metrics.aggregate.avgReviewRounds} |\n`;
  md += `| PRs with no review activity | ${metrics.aggregate.prsWithNoReviewActivity} |\n\n`;

  // Per-author table
  if (metrics.perAuthor.length > 0) {
    md += `### Per-Author Summary\n\n`;
    md += `| Author | Open PRs | Avg Age | Avg Rounds | Fastest Review |\n|---|---|---|---|---|\n`;
    for (const author of metrics.perAuthor) {
      const fastest = author.fastestReviewInDays !== null ? formatDays(author.fastestReviewInDays) : "N/A";
      md += `| ${escapeMarkdown(author.author)} | ${author.openPrCount} | ${formatDays(author.avgAgeInDays)} | ${author.avgReviewRounds} | ${fastest} |\n`;
    }
    md += "\n";
  }

  return md;
}

function generateWorkloadSection(workload: ReviewerWorkload[]): string {
  if (workload.length === 0) return "";

  let md = `## 👥 Reviewer Workload\n\n`;
  md += `| Reviewer | Assigned | Pending | Completed | Avg Response | Load |\n|---|---|---|---|---|---|\n`;

  for (const r of workload) {
    const responseTime = r.avgResponseTimeInDays !== null ? formatDays(r.avgResponseTimeInDays) : "N/A";
    md += `| ${escapeMarkdown(r.displayName)} | ${r.assignedPrCount} | ${r.pendingReviewCount} | ${r.completedReviewCount} | ${responseTime} | ${r.loadIndicator} |\n`;
  }

  return md + "\n";
}

function generateDependencySection(graph: DependencyGraph): string {
  let md = "## 🔗 PR Dependencies\n\n";

  if (graph.chains.length > 0) {
    md += "### Dependency Chains\n\n";
    md += "| Chain | PRs | Status |\n";
    md += "|-------|-----|--------|\n";
    for (const chain of graph.chains) {
      const prList = chain.prIds.map((id) => `#${id}`).join(" → ");
      const status = chain.status === "blocked"
        ? `⚠️ ${chain.blockerDescription ?? "Blocked"}`
        : "✅ Ready to merge in order";
      md += `| ${chain.chainId} | ${prList} | ${status} |\n`;
    }
    md += "\n";
  }

  if (graph.blockedPrIds.length > 0) {
    md += "### Blocked PRs\n\n";
    md += "| PR | Blocked By | Reason |\n";
    md += "|----|-----------|--------|\n";
    for (const dep of graph.dependencies) {
      if (graph.blockedPrIds.includes(dep.fromPrId)) {
        md += `| #${dep.fromPrId} | #${dep.toPrId} | ${dep.details} |\n`;
      }
    }
    md += "\n";
  }

  return md;
}

function formatDoraRating(rating: DoraRating): string {
  switch (rating) {
    case "elite": return "🟢 Elite";
    case "high": return "🟢 High";
    case "medium": return "🟡 Medium";
    case "low": return "🔴 Low";
  }
}

function formatDoraTrendArrow(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "→ stable";
  return delta > 0 ? `↗️ +${delta}` : `↘️ ${delta}`;
}

function generateDoraSection(trend: DoraTrend): string {
  const m = trend.current;
  let md = "## 📈 DORA Metrics\n\n";
  md += "| Metric | Value | Rating | Trend |\n";
  md += "|--------|-------|--------|-------|\n";
  md += `| Change Lead Time | ${m.changeLeadTime.medianDays} days | ${formatDoraRating(m.changeLeadTime.rating)} | ${formatDoraTrendArrow(trend.deltas.changeLeadTime)} |\n`;
  md += `| Deployment Frequency | ${m.deploymentFrequency.perWeek}/week | ${formatDoraRating(m.deploymentFrequency.rating)} | ${formatDoraTrendArrow(trend.deltas.deploymentFrequency)} |\n`;
  md += `| Change Failure Rate | ${m.changeFailureRate.percentage}% | ${formatDoraRating(m.changeFailureRate.rating)} | ${formatDoraTrendArrow(trend.deltas.changeFailureRate)} |\n`;
  md += `| Mean Time to Restore | ${m.meanTimeToRestore.medianHours}h | ${formatDoraRating(m.meanTimeToRestore.rating)} | ${formatDoraTrendArrow(trend.deltas.meanTimeToRestore)} |\n`;
  md += "\n";
  return md;
}

export interface GenerateMarkdownOptions {
  analysis: AnalysisResult;
  multiRepo?: boolean;
  stats?: SummaryStats;
  staleness?: StalenessConfig;
  metrics?: ReviewMetrics;
  workload?: ReviewerWorkload[];
  dependencyGraph?: DependencyGraph;
  doraTrend?: DoraTrend;
}

export function generateMarkdown(options: GenerateMarkdownOptions): string {
  const { analysis, multiRepo, stats, staleness, metrics, workload, dependencyGraph, doraTrend } = options;
  const now = new Date();
  const { approved, needingReview, waitingOnAuthor } = analysis;
  const stalenessThresholds = staleness?.enabled !== false ? staleness?.thresholds ?? [] : [];

  let md = `_Last updated: ${now.toISOString()}_\n\n`;

  md += renderSection("✅ Approved", approved,
    (pr) => ({ ...pr, dateColumn: pr.createdDate, stalenessBadge: computeStalenessBadge(pr.createdDate, stalenessThresholds, now) }),
    "Created", "No approved PRs.", now, multiRepo);

  md += renderSection("👀 PRs Needing Review", needingReview,
    (pr) => ({ ...pr, dateColumn: pr.waitingSince, stalenessBadge: computeStalenessBadge(pr.waitingSince, stalenessThresholds, now) }),
    "Waiting for feedback", "No PRs currently need review.", now, multiRepo);

  md += renderSection("✍️ Waiting on Author", waitingOnAuthor,
    (pr) => ({ ...pr, dateColumn: pr.lastReviewerActivityDate, stalenessBadge: computeStalenessBadge(pr.lastReviewerActivityDate, stalenessThresholds, now) }),
    "Last reviewer activity", "No PRs waiting on author.", now, multiRepo);

  if (stats?.repoStats && stats.repoStats.length > 1) {
    md += generateRepoStatsTable(stats.repoStats);
  }

  if (metrics) {
    md += generateMetricsSection(metrics);
  }

  if (workload && workload.length > 0) {
    md += generateWorkloadSection(workload);
  }

  if (dependencyGraph && dependencyGraph.dependencies.length > 0) {
    md += generateDependencySection(dependencyGraph);
  }

  if (doraTrend) {
    md += generateDoraSection(doraTrend);
  }

  md += `_${buildSummaryLine(analysis, stats)}._\n`;

  return md;
}
