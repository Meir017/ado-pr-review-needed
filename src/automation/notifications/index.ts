import type { AnalysisResult, SummaryStats, NotificationsConfig, StalenessConfig } from "../../types.js";
import { sendTeamsNotification } from "./teams.js";
import * as log from "../../log.js";

export async function sendNotifications(
  analysis: AnalysisResult,
  stats: SummaryStats,
  config: NotificationsConfig,
  staleness?: StalenessConfig,
): Promise<void> {
  if (!config.teams?.webhookUrl) {
    log.debug("No notification webhooks configured, skipping");
    return;
  }

  log.info("Sending Teams notification…");
  await sendTeamsNotification(analysis, stats, config.teams, staleness);
}
