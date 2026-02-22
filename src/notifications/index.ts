import type { AnalysisResult, SummaryStats, NotificationsConfig, StalenessConfig } from "../types.js";
import { sendTeamsNotification } from "./teams.js";
import { sendSlackNotification } from "./slack.js";
import * as log from "../log.js";

export async function sendNotifications(
  analysis: AnalysisResult,
  stats: SummaryStats,
  config: NotificationsConfig,
  staleness?: StalenessConfig,
): Promise<void> {
  const promises: Promise<void>[] = [];

  if (config.teams?.webhookUrl) {
    log.info("Sending Teams notification…");
    promises.push(sendTeamsNotification(analysis, stats, config.teams, staleness));
  }

  if (config.slack?.webhookUrl) {
    log.info("Sending Slack notification…");
    promises.push(sendSlackNotification(analysis, stats, config.slack, staleness));
  }

  if (promises.length === 0) {
    log.debug("No notification webhooks configured, skipping");
    return;
  }

  await Promise.allSettled(promises);
}
