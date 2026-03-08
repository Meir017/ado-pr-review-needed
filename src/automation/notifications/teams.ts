import type { AnalysisResult, SummaryStats, TeamsNotificationConfig, StalenessConfig } from "../../types.js";
import { computeStalenessBadge } from "../../analysis/staleness.js";
import * as log from "../../log.js";

interface AdaptiveCardAction {
  type: string;
  title: string;
  url: string;
}

interface AdaptiveCardFact {
  title: string;
  value: string;
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
  style?: string;
  facts?: AdaptiveCardFact[];
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

function textBlock(text: string, options?: Partial<AdaptiveCardElement>): AdaptiveCardElement {
  return { type: "TextBlock", text, ...options };
}


function buildPrFactSet(
  prs: Array<{ id: number; title: string; author: string; url: string; isStarred?: boolean; hasMergeConflict?: boolean; repository?: string }>,
  dateExtractor: (pr: Record<string, unknown>) => Date | undefined,
  thresholds: Array<{ label: string; minDays: number }>,
): AdaptiveCardElement {
  const facts: AdaptiveCardFact[] = prs.map((pr) => {
    const date = dateExtractor(pr as unknown as Record<string, unknown>);
    const badge = date ? computeStalenessBadge(date, thresholds) : null;
    const conflict = pr.hasMergeConflict ? " ❌" : "";
    const star = pr.isStarred ? "⭐ " : "";
    const stale = badge ? ` ${badge}` : "";
    const repo = pr.repository ? `${pr.repository} · ` : "";

    return {
      title: `${repo}#${pr.id}${conflict}`,
      value: `[${pr.title}](${pr.url}) — ${star}${pr.author}${stale}`,
    };
  });

  return { type: "FactSet", facts, spacing: "Small" };
}

export function buildTeamsPayload(
  analysis: AnalysisResult,
  stats: SummaryStats,
  staleness?: StalenessConfig,
  sections?: string[],
): TeamsPayload {
  const thresholds = staleness?.enabled !== false ? staleness?.thresholds ?? [] : [];
  const total = analysis.approved.length + analysis.needingReview.length + analysis.waitingOnAuthor.length;

  const allPrs = [...analysis.approved, ...analysis.needingReview, ...analysis.waitingOnAuthor];
  const repos = [...new Set(allPrs.map((pr) => pr.repository).filter(Boolean))];
  const repoLine = repos.length > 0 ? ` for ${repos.join(", ")}` : "";

  const body: AdaptiveCardElement[] = [
    textBlock(`📋 PR Review Summary — ${total} open PRs${repoLine}`, { size: "Large", weight: "Bolder", wrap: true }),
    textBlock(
      `✅ ${analysis.approved.length} approved | 👀 ${analysis.needingReview.length} needing review | ✍️ ${analysis.waitingOnAuthor.length} waiting on author | ❌ ${stats.totalConflicts} conflicts`,
      { wrap: true, spacing: "Small" },
    ),
  ];

  const showSection = (name: string) => !sections || sections.includes(name);

  if (showSection("needingReview") && analysis.needingReview.length > 0) {
    body.push(textBlock(`**👀 PRs Needing Review (${analysis.needingReview.length})**`, { separator: true, spacing: "Medium" }));
    body.push(buildPrFactSet(
      analysis.needingReview,
      (pr) => pr.waitingSince as Date | undefined,
      thresholds,
    ));
  }

  if (showSection("waitingOnAuthor") && analysis.waitingOnAuthor.length > 0) {
    body.push(textBlock(`**✍️ Waiting on Author (${analysis.waitingOnAuthor.length})**`, { separator: true, spacing: "Medium" }));
    body.push(buildPrFactSet(
      analysis.waitingOnAuthor,
      (pr) => pr.lastReviewerActivityDate as Date | undefined,
      thresholds,
    ));
  }

  if (showSection("approved") && analysis.approved.length > 0) {
    body.push(textBlock(`**✅ Approved (${analysis.approved.length})**`, { separator: true, spacing: "Medium" }));
    body.push(buildPrFactSet(
      analysis.approved,
      (pr) => pr.createdDate as Date | undefined,
      thresholds,
    ));
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

  log.debug(`Teams webhook URL: ${config.webhookUrl.replace(/[?&](?:sig|sp|sv|se)=[^&]+/g, "=***")}`);
  log.debug(`Teams payload: ${JSON.stringify(payload, null, 2)}`);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();
    if (!response.ok) {
      log.warn(`Teams notification failed: ${response.status} ${response.statusText}`);
      log.warn(`Response body: ${responseBody}`);
    } else {
      log.success("Teams notification sent successfully");
      log.debug(`Response: ${responseBody}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Teams notification failed: ${msg}`);
  }
}
