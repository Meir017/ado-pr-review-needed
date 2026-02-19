import {
  PullRequestAsyncStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { PullRequestInfo, PrNeedingReview, PrWaitingOnAuthor, PrApproved, PrAction, AnalysisResult } from "./types.js";
import * as log from "./log.js";

const BOT_PATTERNS = ["build", "[bot]", "team foundation", "microsoft.visualstudio.com"];

const KNOWN_BOT_AUTHORS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]", "snyk-bot", "greenkeeper[bot]", "depfu[bot]", "imgbot[bot]", "allcontributors[bot]"];

function isBotAccount(uniqueName: string, botUsers: Set<string> = new Set()): boolean {
  const lower = uniqueName.toLowerCase();
  return botUsers.has(lower) || BOT_PATTERNS.some((p) => lower.includes(p));
}

export function isBotAuthor(authorUniqueName: string, botUsers: Set<string> = new Set()): boolean {
  const lower = authorUniqueName.toLowerCase();
  return KNOWN_BOT_AUTHORS.some((b) => lower.includes(b)) || isBotAccount(lower, botUsers);
}

function determineAction(category: "approved" | "needingReview" | "waitingOnAuthor", authorUniqueName: string, botUsers: Set<string> = new Set()): PrAction {
  if (isBotAuthor(authorUniqueName, botUsers)) return "APPROVE";
  switch (category) {
    case "approved": return "APPROVE";
    case "needingReview": return "REVIEW";
    case "waitingOnAuthor": return "PENDING";
  }
}

interface Activity {
  date: Date;
  isAuthor: boolean;
}

function collectActivities(pr: PullRequestInfo, botUsers: Set<string> = new Set()): Activity[] {
  const authorId = pr.authorUniqueName;
  const activities: Activity[] = [];

  // Thread comments
  for (const thread of pr.threads) {
    for (const comment of thread.comments) {
      if (isBotAccount(comment.authorUniqueName, botUsers)) continue;
      activities.push({
        date: comment.publishedDate,
        isAuthor: comment.authorUniqueName === authorId,
      });
    }
  }

  // Source pushes count as author activity
  if (pr.lastSourcePushDate) {
    activities.push({ date: pr.lastSourcePushDate, isAuthor: true });
  }

  return activities;
}

export function analyzePrs(
  prs: PullRequestInfo[],
  teamMembers: Set<string> = new Set(),
  repoLabel?: string,
  ignoredUsers: Set<string> = new Set(),
  botUsers: Set<string> = new Set(),
): AnalysisResult {
  const approved: PrApproved[] = [];
  const needingReview: PrNeedingReview[] = [];
  const waitingOnAuthor: PrWaitingOnAuthor[] = [];

  for (const pr of prs) {
    // Skip PRs from ignored users (e.g. managers when ignoreManagers is enabled)
    if (ignoredUsers.has(pr.authorUniqueName)) {
      log.debug(`  #${pr.id} "${pr.title}" — author ${pr.authorUniqueName} is ignored, skipping`);
      continue;
    }

    const isTeamMember = teamMembers.size === 0 || teamMembers.has(pr.authorUniqueName);

    // Skip if any reviewer approved (vote >= 5)
    const isApproved = pr.reviewers.some(
      (r) => r.vote >= 5 && !isBotAccount(r.uniqueName, botUsers),
    );
    if (isApproved) {
      const hasMergeConflict =
        pr.mergeStatus === PullRequestAsyncStatus.Conflicts;
      log.debug(`  #${pr.id} "${pr.title}" — approved`);
      approved.push({
        id: pr.id,
        title: pr.title,
        author: pr.author,
        url: pr.url,
        createdDate: pr.createdDate,
        hasMergeConflict,
        isTeamMember,
        action: determineAction("approved", pr.authorUniqueName, botUsers),
        repository: repoLabel,
        size: pr.size,
        detectedLabels: pr.detectedLabels.length > 0 ? pr.detectedLabels : undefined,
      });
      continue;
    }

    const activities = collectActivities(pr, botUsers);
    const authorActivities = activities
      .filter((a) => a.isAuthor)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const reviewerActivities = activities
      .filter((a) => !a.isAuthor)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const lastAuthorActivity =
      authorActivities.length > 0
        ? authorActivities[authorActivities.length - 1]
        : null;
    const lastReviewerActivity =
      reviewerActivities.length > 0
        ? reviewerActivities[reviewerActivities.length - 1]
        : null;

    // PR needs review when the last activity is from the author
    let needsReview = false;
    if (lastAuthorActivity && lastReviewerActivity) {
      needsReview =
        lastAuthorActivity.date.getTime() >
        lastReviewerActivity.date.getTime();
    } else if (lastAuthorActivity && !lastReviewerActivity) {
      needsReview = true;
    } else if (!lastAuthorActivity && !lastReviewerActivity) {
      // No activity at all — needs initial review
      needsReview = true;
    }

    if (!needsReview) {
      const hasMergeConflict =
        pr.mergeStatus === PullRequestAsyncStatus.Conflicts;
      log.debug(`  #${pr.id} "${pr.title}" — reviewer acted last`);
      waitingOnAuthor.push({
        id: pr.id,
        title: pr.title,
        author: pr.author,
        url: pr.url,
        lastReviewerActivityDate: lastReviewerActivity!.date,
        hasMergeConflict,
        isTeamMember,
        action: determineAction("waitingOnAuthor", pr.authorUniqueName, botUsers),
        repository: repoLabel,
        size: pr.size,
        detectedLabels: pr.detectedLabels.length > 0 ? pr.detectedLabels : undefined,
      });
      continue;
    }

    // Compute waitingSince: first author activity after last reviewer activity,
    // or PR creation date if no reviewer activity
    let waitingSince: Date;
    if (lastReviewerActivity) {
      const firstAuthorAfter = authorActivities.find(
        (a) => a.date.getTime() > lastReviewerActivity.date.getTime(),
      );
      waitingSince = firstAuthorAfter?.date ?? pr.createdDate;
    } else {
      waitingSince = pr.createdDate;
    }

    const hasMergeConflict =
      pr.mergeStatus === PullRequestAsyncStatus.Conflicts;

    log.debug(
      `  #${pr.id} "${pr.title}" — needs review` +
        ` (waiting since ${waitingSince.toISOString()}${hasMergeConflict ? ", has conflicts" : ""})`,
    );

    needingReview.push({
      id: pr.id,
      title: pr.title,
      author: pr.author,
      url: pr.url,
      waitingSince,
      hasMergeConflict,
      isTeamMember,
      action: determineAction("needingReview", pr.authorUniqueName, botUsers),
      repository: repoLabel,
      size: pr.size,
      detectedLabels: pr.detectedLabels.length > 0 ? pr.detectedLabels : undefined,
    });
  }

  log.debug(`${approved.length} approved PRs`);
  log.debug(`${waitingOnAuthor.length} PRs waiting on author`);

  // Sort oldest first
  approved.sort(
    (a, b) => a.createdDate.getTime() - b.createdDate.getTime(),
  );
  needingReview.sort(
    (a, b) => a.waitingSince.getTime() - b.waitingSince.getTime(),
  );
  waitingOnAuthor.sort(
    (a, b) => a.lastReviewerActivityDate.getTime() - b.lastReviewerActivityDate.getTime(),
  );

  return { approved, needingReview, waitingOnAuthor };
}

export function mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
  const approved = results.flatMap((r) => r.approved);
  const needingReview = results.flatMap((r) => r.needingReview);
  const waitingOnAuthor = results.flatMap((r) => r.waitingOnAuthor);

  approved.sort((a, b) => a.createdDate.getTime() - b.createdDate.getTime());
  needingReview.sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
  waitingOnAuthor.sort((a, b) => a.lastReviewerActivityDate.getTime() - b.lastReviewerActivityDate.getTime());

  return { approved, needingReview, waitingOnAuthor };
}
