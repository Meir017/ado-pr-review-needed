import type { AnalysisResult, PrNeedingReview, PrWaitingOnAuthor, PrApproved, PrSizeInfo, PrAction } from "./types.js";

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
const BG_CYAN = "\x1b[46m";

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

  return `  ${ageText}  ${pad(prLink, 80)} ${authorText}${sizeText} ${actionText}${conflict}`;
}

function renderSection<T>(
  title: string,
  bg: string,
  items: T[],
  getRow: (item: T) => { id: number; title: string; author: string; url: string; date: Date; hasMergeConflict: boolean; action: PrAction; size?: PrSizeInfo },
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
        const { id, title, author, url, date, hasMergeConflict, action, size } = getRow(item);
        lines.push(renderPrRow(id, title, author, url, date, hasMergeConflict, now, action, size));
      }
      lines.push("");
    }
  } else {
    for (const item of items) {
      const { id, title, author, url, date, hasMergeConflict, action, size } = getRow(item);
      lines.push(renderPrRow(id, title, author, url, date, hasMergeConflict, now, action, size));
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderDashboard(analysis: AnalysisResult, repoLabel: string, multiRepo: boolean = false): string {
  const now = new Date();
  const { approved, needingReview, waitingOnAuthor } = analysis;
  const total = approved.length + needingReview.length + waitingOnAuthor.length;

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
    (pr: PrApproved) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.createdDate, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size }),
    now, repoGetter));

  lines.push(renderSection("👀 Needing Review", BG_YELLOW, needingReview,
    (pr: PrNeedingReview) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.waitingSince, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size }),
    now, repoGetter));

  lines.push(renderSection("✍️  Waiting on Author", BG_RED, waitingOnAuthor,
    (pr: PrWaitingOnAuthor) => ({ id: pr.id, title: pr.title, author: pr.author, url: pr.url, date: pr.lastReviewerActivityDate, hasMergeConflict: pr.hasMergeConflict, action: pr.action, size: pr.size }),
    now, repoGetter));

  lines.push(`  ${DIM}Total: ${total} open PRs — ${approved.length} approved, ${needingReview.length} needing review, ${waitingOnAuthor.length} waiting on author${RESET}`);
  lines.push(`  ${DIM}Updated: ${now.toLocaleString()}${RESET}`);
  lines.push("");

  return lines.join("\n");
}
