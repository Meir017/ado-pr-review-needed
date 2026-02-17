import type { AnalysisResult, PrSizeInfo, PrAction, SummaryStats } from "./types.js";

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

  if (multiRepo) {
    let table = hasSize
      ? `| PR | Repository | Author | Action | Size | ${dateHeader} |\n|---|---|---|---|---|---|\n`
      : `| PR | Repository | Author | Action | ${dateHeader} |\n|---|---|---|---|---|\n`;

    for (const pr of prs) {
      const conflictEmoji = pr.hasMergeConflict ? " ❌" : "";
      const title = escapeMarkdown(pr.title);
      const author = escapeMarkdown(pr.author);
      const repo = escapeMarkdown(pr.repository ?? "Unknown");
      const prLink = `[#${pr.id} - ${title}](${pr.url})${conflictEmoji}`;
      const timeSince = formatTimeSince(pr.dateColumn, now);
      const actionCol = formatAction(pr.action);
      const sizeCol = hasSize ? ` ${pr.size ? formatSizeLabel(pr.size) : ""} |` : "";
      table += `| ${prLink} | ${repo} | ${author} | ${actionCol} |${sizeCol} ${timeSince} |\n`;
    }

    return table + "\n";
  }

  let table = hasSize
    ? `| PR | Author | Action | Size | ${dateHeader} |\n|---|---|---|---|---|\n`
    : `| PR | Author | Action | ${dateHeader} |\n|---|---|---|---|\n`;

  for (const pr of prs) {
    const conflictEmoji = pr.hasMergeConflict ? " ❌" : "";
    const title = escapeMarkdown(pr.title);
    const author = escapeMarkdown(pr.author);
    const prLink = `[#${pr.id} - ${title}](${pr.url})${conflictEmoji}`;
    const timeSince = formatTimeSince(pr.dateColumn, now);
    const actionCol = formatAction(pr.action);
    const sizeCol = hasSize ? ` ${pr.size ? formatSizeLabel(pr.size) : ""} |` : "";
    table += `| ${prLink} | ${author} | ${actionCol} |${sizeCol} ${timeSince} |\n`;
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

export function generateMarkdown(analysis: AnalysisResult, multiRepo: boolean = false, stats?: SummaryStats): string {
  const now = new Date();
  const { approved, needingReview, waitingOnAuthor } = analysis;

  let md = `_Last updated: ${now.toISOString()}_\n\n`;

  md += renderSection("✅ Approved", approved,
    (pr) => ({ ...pr, dateColumn: pr.createdDate }),
    "Created", "No approved PRs.", now, multiRepo);

  md += renderSection("👀 PRs Needing Review", needingReview,
    (pr) => ({ ...pr, dateColumn: pr.waitingSince }),
    "Waiting for feedback", "No PRs currently need review.", now, multiRepo);

  md += renderSection("✍️ Waiting on Author", waitingOnAuthor,
    (pr) => ({ ...pr, dateColumn: pr.lastReviewerActivityDate }),
    "Last reviewer activity", "No PRs waiting on author.", now, multiRepo);

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
