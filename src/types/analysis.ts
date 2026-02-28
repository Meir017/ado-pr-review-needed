import type { PrAction, PrSizeInfo, PipelineStatus } from "./pr.js";

export interface PrNeedingReview {
  id: number;
  title: string;
  author: string;
  url: string;
  waitingSince: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  reviewerNames?: string[];
  pipelineStatus?: PipelineStatus;
}

export interface PrWaitingOnAuthor {
  id: number;
  title: string;
  author: string;
  url: string;
  lastReviewerActivityDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  pipelineStatus?: PipelineStatus;
}

export interface PrApproved {
  id: number;
  title: string;
  author: string;
  url: string;
  createdDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  pipelineStatus?: PipelineStatus;
}

export interface AnalysisResult {
  approved: PrApproved[];
  needingReview: PrNeedingReview[];
  waitingOnAuthor: PrWaitingOnAuthor[];
}

export interface RepoSummaryStats {
  repoLabel: string;
  approved: number;
  needingReview: number;
  waitingOnAuthor: number;
  conflicts: number;
  mergeRestarted: number;
  mergeRestartFailed: number;
}

export interface SummaryStats {
  totalConflicts: number;
  mergeRestarted: number;
  mergeRestartFailed: number;
  repoStats?: RepoSummaryStats[];
}

export function computeSummaryStats(analysis: AnalysisResult, mergeRestarted: number, mergeRestartFailed: number, repoStats?: RepoSummaryStats[]): SummaryStats {
  const allPrs = [
    ...analysis.approved,
    ...analysis.needingReview,
    ...analysis.waitingOnAuthor,
  ];
  const totalConflicts = allPrs.filter((pr) => pr.hasMergeConflict).length;
  return { totalConflicts, mergeRestarted, mergeRestartFailed, repoStats };
}

export function computeRepoSummaryStats(repoLabel: string, analysis: AnalysisResult, mergeRestarted: number, mergeRestartFailed: number): RepoSummaryStats {
  const allPrs = [
    ...analysis.approved,
    ...analysis.needingReview,
    ...analysis.waitingOnAuthor,
  ];
  return {
    repoLabel,
    approved: analysis.approved.length,
    needingReview: analysis.needingReview.length,
    waitingOnAuthor: analysis.waitingOnAuthor.length,
    conflicts: allPrs.filter((pr) => pr.hasMergeConflict).length,
    mergeRestarted,
    mergeRestartFailed,
  };
}
