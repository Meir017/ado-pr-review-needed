import type { AnalysisResult, SummaryStats, TeamsNotificationConfig, StalenessConfig } from "../../types.js";
import { computeStalenessBadge } from "../../analysis/staleness.js";
import * as log from "../../log.js";

interface AdaptiveCardAction {
  type: string;
  title: string;
  url: string;
}

interface AdaptiveCardElement {
  type: string;
  text?: string;
  wrap?: boolean;
  size?: string;
  weight?: string;
  color?: string;
  spacing?: string;
  separator?: boolean;
  columns?: AdaptiveCardElement[];
  width?: string;
  items?: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

interface AdaptiveCard {
  type: string;
  $schema: string;
  version: string;
  body: AdaptiveCardElement[];
}

interface TeamsPayload {
  type: string;
  attachments: Array<{
    contentType: string;
    content: AdaptiveCard;
  }>;
}

function formatPrLine(pr: { id: number; title: string; author: string; url: string }, badge?: string | null): string {
  const stale = badge ? ` ${badge}` : "";
  return `[#${pr.id} - ${pr.title}](${pr.url}) — ${pr.author}${stale}`;
}

export function buildTeamsPayload(
  analysis: AnalysisResult,
  stats: SummaryStats,
  staleness?: StalenessConfig,
  sections?: string[],
): TeamsPayload {
  const thresholds = staleness?.enabled !== false ? staleness?.thresholds ?? [] : [];
  const total = analysis.approved.length + analysis.needingReview.length + analysis.waitingOnAuthor.length;

  const body: AdaptiveCardElement[] = [
    {
      type: "TextBlock",
      text: `📋 PR Review Summary — ${total} open PRs`,
      size: "Large",
      weight: "Bolder",
    },
    {
      type: "TextBlock",
      text: `✅ ${analysis.approved.length} approved | 👀 ${analysis.needingReview.length} needing review | ✍️ ${analysis.waitingOnAuthor.length} waiting on author | ❌ ${stats.totalConflicts} conflicts`,
      wrap: true,
      spacing: "Small",
    },
  ];

  const showSection = (name: string) => !sections || sections.includes(name);

  if (showSection("needingReview") && analysis.needingReview.length > 0) {
    body.push({
      type: "TextBlock",
      text: `**👀 PRs Needing Review (${analysis.needingReview.length})**`,
      separator: true,
      spacing: "Medium",
    });
    const items = analysis.needingReview.slice(0, 15);
    for (const pr of items) {
      const badge = computeStalenessBadge(pr.waitingSince, thresholds);
      body.push({ type: "TextBlock", text: formatPrLine(pr, badge), wrap: true, spacing: "Small" });
    }
    if (analysis.needingReview.length > 15) {
      body.push({ type: "TextBlock", text: `_…and ${analysis.needingReview.length - 15} more_`, spacing: "Small" });
    }
  }

  if (showSection("waitingOnAuthor") && analysis.waitingOnAuthor.length > 0) {
    body.push({
      type: "TextBlock",
      text: `**✍️ Waiting on Author (${analysis.waitingOnAuthor.length})**`,
      separator: true,
      spacing: "Medium",
    });
    const items = analysis.waitingOnAuthor.slice(0, 10);
    for (const pr of items) {
      const badge = computeStalenessBadge(pr.lastReviewerActivityDate, thresholds);
      body.push({ type: "TextBlock", text: formatPrLine(pr, badge), wrap: true, spacing: "Small" });
    }
    if (analysis.waitingOnAuthor.length > 10) {
      body.push({ type: "TextBlock", text: `_…and ${analysis.waitingOnAuthor.length - 10} more_`, spacing: "Small" });
    }
  }

  if (showSection("approved") && analysis.approved.length > 0) {
    body.push({
      type: "TextBlock",
      text: `**✅ Approved (${analysis.approved.length})**`,
      separator: true,
      spacing: "Medium",
    });
    body.push({ type: "TextBlock", text: `${analysis.approved.length} PRs approved and ready to merge.`, spacing: "Small" });
  }

  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.4",
        body,
      },
    }],
  };
}

export async function sendTeamsNotification(
  analysis: AnalysisResult,
  stats: SummaryStats,
  config: TeamsNotificationConfig,
  staleness?: StalenessConfig,
): Promise<void> {
  const payload = buildTeamsPayload(analysis, stats, staleness, config.filters?.sections);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      log.warn(`Teams notification failed: ${response.status} ${response.statusText}`);
    } else {
      log.success("Teams notification sent successfully");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Teams notification failed: ${msg}`);
  }
}
