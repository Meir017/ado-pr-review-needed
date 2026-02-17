import type { PrNeedingReview, PrWaitingOnAuthor, PrApproved, AnalysisResult } from "./types.js";

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
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\|/g, "\\|");
}

function generateTable(prs: PrRow[], dateHeader: string, emptyMsg: string, now: Date): string {
  if (prs.length === 0) {
    return `_${emptyMsg}_\n\n`;
  }

  let table = `| PR | Author | ${dateHeader} |\n`;
  table += "|---|---|---|\n";

  for (const pr of prs) {
    const conflictEmoji = pr.hasMergeConflict ? " ❌" : "";
    const title = escapeMarkdown(pr.title);
    const author = escapeMarkdown(pr.author);
    const prLink = `[#${pr.id} - ${title}](${pr.url})${conflictEmoji}`;
    const timeSince = formatTimeSince(pr.dateColumn, now);
    table += `| ${prLink} | ${author} | ${timeSince} |\n`;
  }

  return table + "\n";
}

function splitTeamCommunity<T extends { isTeamMember: boolean }>(
  items: T[],
): { team: T[]; community: T[] } {
  const hasTeamConfig = items.some((i) => i.isTeamMember) || items.some((i) => !i.isTeamMember);
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
): string {
  let md = `## ${heading}\n\n`;

  const { team, community } = splitTeamCommunity(items);

  if (community.length > 0) {
    md += `### Team PRs\n\n`;
    md += generateTable(team.map(toRow), dateHeader, `No team PRs.`, now);
    md += `### Community Contributions\n\n`;
    md += generateTable(community.map(toRow), dateHeader, `No community PRs.`, now);
  } else {
    md += generateTable(items.map(toRow), dateHeader, emptyMsg, now);
  }

  return md;
}

function groupByRepo<T extends { repository?: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.repository ?? "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return groups;
}

function generateMultiRepoSection<T extends { isTeamMember: boolean; repository?: string }>(
  heading: string,
  items: T[],
  toRow: (item: T) => PrRow,
  dateHeader: string,
  emptyMsg: string,
  now: Date,
): string {
  let md = `## ${heading}\n\n`;

  if (items.length === 0) {
    md += `_${emptyMsg}_\n\n`;
    return md;
  }

  const grouped = groupByRepo(items);
  for (const [repo, repoItems] of grouped) {
    md += `### 📂 ${repo}\n\n`;

    const { team, community } = splitTeamCommunity(repoItems);
    if (community.length > 0) {
      md += `#### Team PRs\n\n`;
      md += generateTable(team.map(toRow), dateHeader, `No team PRs.`, now);
      md += `#### Community Contributions\n\n`;
      md += generateTable(community.map(toRow), dateHeader, `No community PRs.`, now);
    } else {
      md += generateTable(repoItems.map(toRow), dateHeader, emptyMsg, now);
    }
  }

  return md;
}

export function generateMarkdown(analysis: AnalysisResult, multiRepo: boolean = false): string {
  const now = new Date();
  const { approved, needingReview, waitingOnAuthor } = analysis;

  let md = `_Last updated: ${now.toISOString()}_\n\n`;

  if (multiRepo) {
    md += generateMultiRepoSection("✅ Approved", approved,
      (pr) => ({ ...pr, dateColumn: pr.createdDate }),
      "Created", "No approved PRs.", now);

    md += generateMultiRepoSection("👀 PRs Needing Review", needingReview,
      (pr) => ({ ...pr, dateColumn: pr.waitingSince }),
      "Waiting for feedback", "No PRs currently need review.", now);

    md += generateMultiRepoSection("✍️ Waiting on Author", waitingOnAuthor,
      (pr) => ({ ...pr, dateColumn: pr.lastReviewerActivityDate }),
      "Last reviewer activity", "No PRs waiting on author.", now);
  } else {
    md += renderSection("✅ Approved", approved,
      (pr) => ({ ...pr, dateColumn: pr.createdDate }),
      "Created", "No approved PRs.", now);

    md += renderSection("👀 PRs Needing Review", needingReview,
      (pr) => ({ ...pr, dateColumn: pr.waitingSince }),
      "Waiting for feedback", "No PRs currently need review.", now);

    md += renderSection("✍️ Waiting on Author", waitingOnAuthor,
      (pr) => ({ ...pr, dateColumn: pr.lastReviewerActivityDate }),
      "Last reviewer activity", "No PRs waiting on author.", now);
  }

  const total = approved.length + needingReview.length + waitingOnAuthor.length;
  md += `_Total: ${total} open PR${total === 1 ? "" : "s"} — ${approved.length} approved, ${needingReview.length} needing review, ${waitingOnAuthor.length} waiting on author._\n`;

  return md;
}
