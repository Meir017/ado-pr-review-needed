import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { computeStalenessBadge } from "./analysis/staleness.js";
import type {
  AnalysisResult,
  PrNeedingReview,
  StalenessConfig,
  NudgeConfig,
  NudgeHistory,
  NudgeHistoryEntry,
  NudgeResult,
} from "./types.js";
import * as log from "./log.js";

export function loadNudgeHistory(filePath: string): NudgeHistory {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    return { entries: [] };
  }
  try {
    const raw = readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed as NudgeHistory;
    }
    return { entries: [] };
  } catch {
    log.warn(`Failed to parse nudge history at ${fullPath}, starting fresh`);
    return { entries: [] };
  }
}

export function saveNudgeHistory(filePath: string, history: NudgeHistory): void {
  const fullPath = resolve(filePath);
  writeFileSync(fullPath, JSON.stringify(history, null, 2), "utf-8");
}

export function filterNudgeCandidates(
  prs: PrNeedingReview[],
  staleness: StalenessConfig,
  config: NudgeConfig,
  history: NudgeHistory,
  now: Date = new Date(),
): PrNeedingReview[] {
  const historyMap = new Map<string, NudgeHistoryEntry>();
  for (const entry of history.entries) {
    historyMap.set(`${entry.repoUrl}:${entry.prId}`, entry);
  }

  // Determine the minimum staleness index (if configured)
  const sortedThresholds = staleness.thresholds;
  let minStalenessIndex = -1;
  if (config.minStalenessLevel) {
    minStalenessIndex = sortedThresholds.findIndex(
      (t) => t.label === config.minStalenessLevel,
    );
  }

  return prs.filter((pr) => {
    // Check staleness level
    const badge = computeStalenessBadge(pr.waitingSince, sortedThresholds, now);
    if (!badge) return false;

    if (minStalenessIndex >= 0) {
      const badgeIndex = sortedThresholds.findIndex((t) => t.label === badge);
      // Thresholds are sorted descending, so lower index = more stale
      if (badgeIndex < 0 || badgeIndex > minStalenessIndex) return false;
    }

    // Check cooldown
    const key = `${pr.url}:${pr.id}`;
    const histEntry = historyMap.get(key);
    if (histEntry) {
      const lastNudged = new Date(histEntry.lastNudgedAt);
      const daysSince = (now.getTime() - lastNudged.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < config.cooldownDays) return false;
    }

    return true;
  });
}

export function buildNudgeComment(
  pr: PrNeedingReview,
  config: NudgeConfig,
  ageInDays: number,
): string {
  return config.commentTemplate
    .replace(/\{\{days\}\}/g, String(ageInDays))
    .replace(/\{\{reviewers\}\}/g, pr.reviewerNames?.join(", ") ?? "Reviewers")
    .replace(/\{\{title\}\}/g, pr.title)
    .replace(/\{\{author\}\}/g, pr.author);
}

/**
 * Parse ADO PR URL to extract org, project, repo, and PR ID.
 * Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
 */
export function parseAdoPrUrl(url: string): { orgUrl: string; project: string; repoName: string } | null {
  const match = url.match(
    /^(https:\/\/dev\.azure\.com\/[^/]+)\/([^/]+)\/_git\/([^/]+)/,
  );
  if (!match) return null;
  return { orgUrl: match[1], project: match[2], repoName: match[3] };
}

export async function postPrComment(
  orgUrl: string,
  project: string,
  repoName: string,
  prId: number,
  comment: string,
): Promise<void> {
  const url = `${orgUrl}/${project}/_apis/git/repositories/${repoName}/pullRequests/${prId}/threads?api-version=7.1`;
  const body = {
    comments: [{ content: comment, commentType: 1 }],
    status: "active",
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ADO API returned ${response.status}: ${response.statusText}`);
  }
}

export async function runAutoNudge(
  analysis: AnalysisResult,
  staleness: StalenessConfig,
  config: NudgeConfig,
  now: Date = new Date(),
): Promise<NudgeResult> {
  const history = loadNudgeHistory(config.historyFile);
  const candidates = filterNudgeCandidates(
    analysis.needingReview,
    staleness,
    config,
    history,
    now,
  );

  const result: NudgeResult = { nudged: 0, skipped: 0, errors: 0 };

  if (candidates.length === 0) {
    log.info("Auto-nudge: no PRs eligible for nudging");
    return result;
  }

  log.info(`Auto-nudge: ${candidates.length} PR(s) eligible for nudging`);

  for (const pr of candidates) {
    const ageMs = now.getTime() - pr.waitingSince.getTime();
    const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const comment = buildNudgeComment(pr, config, ageInDays);

    if (config.dryRun) {
      log.info(`  [DRY RUN] Would nudge #${pr.id} "${pr.title}" (${ageInDays} days)`);
      result.nudged++;
      continue;
    }

    const parsed = parseAdoPrUrl(pr.url);
    if (!parsed) {
      log.warn(`  #${pr.id} — could not parse ADO URL: ${pr.url}`);
      result.errors++;
      continue;
    }

    try {
      await postPrComment(parsed.orgUrl, parsed.project, parsed.repoName, pr.id, comment);
      log.success(`  #${pr.id} "${pr.title}" — nudged (${ageInDays} days)`);
      result.nudged++;

      // Update history
      const key = history.entries.findIndex(
        (e) => e.repoUrl === pr.url && e.prId === pr.id,
      );
      const entry: NudgeHistoryEntry = {
        prId: pr.id,
        repoUrl: pr.url,
        lastNudgedAt: now.toISOString(),
        nudgeCount: key >= 0 ? history.entries[key].nudgeCount + 1 : 1,
      };
      if (key >= 0) {
        history.entries[key] = entry;
      } else {
        history.entries.push(entry);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`  #${pr.id} "${pr.title}" — nudge failed: ${msg}`);
      result.errors++;
    }
  }

  if (!config.dryRun) {
    saveNudgeHistory(config.historyFile, history);
  }

  log.info(`Auto-nudge: ${result.nudged} nudged, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
