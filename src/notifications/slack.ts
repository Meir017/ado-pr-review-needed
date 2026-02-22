import type { AnalysisResult, SummaryStats, SlackNotificationConfig, StalenessConfig } from "../types.js";
import { computeStalenessBadge } from "../staleness.js";
import * as log from "../log.js";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
}

interface SlackPayload {
  blocks: SlackBlock[];
}

function formatPrLine(pr: { id: number; title: string; author: string; url: string }, badge?: string | null): string {
  const stale = badge ? ` ${badge}` : "";
  return `<${pr.url}|#${pr.id} - ${pr.title}> — ${pr.author}${stale}`;
}

export function buildSlackPayload(
  analysis: AnalysisResult,
  stats: SummaryStats,
  staleness?: StalenessConfig,
  sections?: string[],
): SlackPayload {
  const thresholds = staleness?.enabled !== false ? staleness?.thresholds ?? [] : [];
  const total = analysis.approved.length + analysis.needingReview.length + analysis.waitingOnAuthor.length;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 PR Review Summary — ${total} open PRs` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ ${analysis.approved.length} approved | 👀 ${analysis.needingReview.length} needing review | ✍️ ${analysis.waitingOnAuthor.length} waiting on author | ❌ ${stats.totalConflicts} conflicts`,
      },
    },
  ];

  const showSection = (name: string) => !sections || sections.includes(name);

  if (showSection("needingReview") && analysis.needingReview.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*👀 PRs Needing Review (${analysis.needingReview.length})*` },
    });
    const items = analysis.needingReview.slice(0, 15);
    const lines = items.map((pr) => {
      const badge = computeStalenessBadge(pr.waitingSince, thresholds);
      return formatPrLine(pr, badge);
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
    if (analysis.needingReview.length > 15) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_…and ${analysis.needingReview.length - 15} more_` }],
      });
    }
  }

  if (showSection("waitingOnAuthor") && analysis.waitingOnAuthor.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*✍️ Waiting on Author (${analysis.waitingOnAuthor.length})*` },
    });
    const items = analysis.waitingOnAuthor.slice(0, 10);
    const lines = items.map((pr) => {
      const badge = computeStalenessBadge(pr.lastReviewerActivityDate, thresholds);
      return formatPrLine(pr, badge);
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
    if (analysis.waitingOnAuthor.length > 10) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_…and ${analysis.waitingOnAuthor.length - 10} more_` }],
      });
    }
  }

  if (showSection("approved") && analysis.approved.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*✅ Approved (${analysis.approved.length})*\n${analysis.approved.length} PRs approved and ready to merge.` },
    });
  }

  return { blocks };
}

export async function sendSlackNotification(
  analysis: AnalysisResult,
  stats: SummaryStats,
  config: SlackNotificationConfig,
  staleness?: StalenessConfig,
): Promise<void> {
  const payload = buildSlackPayload(analysis, stats, staleness, config.filters?.sections);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      log.warn(`Slack notification failed: ${response.status} ${response.statusText}`);
    } else {
      log.success("Slack notification sent successfully");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Slack notification failed: ${msg}`);
  }
}
