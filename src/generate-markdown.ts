import type { AnalysisResult, PrSizeInfo, PrAction, SummaryStats, RepoSummaryStats, StalenessConfig } from "./types.js";
import { computeStalenessBadge } from "./staleness.js";
import type { ReviewMetrics } from "./metrics.js";
import type { ReviewerWorkload } from "./reviewer-workload.js";

function formatTimeSince(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor(diffMs / (1000 * 60));

  let circle: string;
  if (diffDays > 3) {
    circle = "🔴";
  } else if (diffDays > 1) {
    circle = "🟡";
  } else {
    circle = "🟢";
  }

  let timeText: string;
  if (diffDays > 0) {
    timeText = `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else if (diffHours > 0) {
    timeText = `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else {
    timeText = `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  }

  return `${circle} ${timeText}`;
}

interface PrRow {
  id: number;
  title: string;
  author: string;
  url: string;
  hasMergeConflict: boolean;
  dateColumn: Date;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  stalenessBadge?: string | null;
}

function formatSizeLabel(size: PrSizeInfo): string {
  const emoji = size.label === "XS" || size.label === "S"
    ? "🟢"
    : size.label === "M"
      ? "🟡"
      : "🔴";
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

function generateTable(prs: PrRow[], dateHeader: string, emptyMsg: string, now: Date, multiRepo: boolean = false): string {
  if (prs.length === 0) {
    return `_${emptyMsg}_\n\n`;
  }

  const hasSize = prs.some((pr) => pr.size != null);
  const hasStaleness = prs.some((pr) => pr.stalenessBadge);

  if (multiRepo) {
    const headers = ["PR", "Repository", "Author", "Action"];
    if (hasSize) headers.push("Size");
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
      const stalenessCol = hasStaleness ? ` ${pr.stalenessBadge ?? ""} |` : "";
      table += `| ${prLink} | ${repo} | ${author} | ${actionCol} |${sizeCol}${stalenessCol} ${timeSince} |\n`;
    }

    return table + "\n";
  }

  const headers = ["PR", "Author", "Action"];
  if (hasSize) headers.push("Size");
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
    const stalenessCol = hasStaleness ? ` ${pr.stalenessBadge ?? ""} |` : "";
    table += `| ${prLink} | ${author} | ${actionCol} |${sizeCol}${stalenessCol} ${timeSince} |\n`;
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
  toRow: (item: T) => PrRow,
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

export interface GenerateMarkdownOptions {
  analysis: AnalysisResult;
  multiRepo?: boolean;
  stats?: SummaryStats;
  staleness?: StalenessConfig;
  metrics?: ReviewMetrics;
  workload?: ReviewerWorkload[];
}

export function generateMarkdown(analysis: AnalysisResult, multiRepo?: boolean, stats?: SummaryStats, staleness?: StalenessConfig, metrics?: ReviewMetrics, workload?: ReviewerWorkload[]): string {
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

  const total = approved.length + needingReview.length + waitingOnAuthor.length;
  let summaryLine = `Total: ${total} open PR${total === 1 ? "" : "s"} — ${approved.length} approved, ${needingReview.length} needing review, ${waitingOnAuthor.length} waiting on author`;
  if (stats) {
    summaryLine += `, ${stats.totalConflicts} with conflicts`;
    if (stats.mergeRestarted > 0 || stats.mergeRestartFailed > 0) {
      summaryLine += `, ${stats.mergeRestarted} merge restarted`;
      if (stats.mergeRestartFailed > 0) {
        summaryLine += ` (${stats.mergeRestartFailed} failed)`;
      }
    }
  }
  md += `_${summaryLine}._\n`;

  return md;
}
