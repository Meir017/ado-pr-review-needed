import type { IdentityRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";

export type PrSizeLabel = "XS" | "S" | "M" | "L" | "XL";

export interface PrSizeInfo {
  linesAdded: number;
  linesDeleted: number;
  totalChanges: number;
  label: PrSizeLabel;
}

export interface SizeThreshold {
  label: PrSizeLabel;
  maxChanges: number;
}

export interface QuantifierConfig {
  enabled: boolean;
  excludedPatterns: string[];
  thresholds: SizeThreshold[];
}

export const DEFAULT_THRESHOLDS: SizeThreshold[] = [
  { label: "XS", maxChanges: 10 },
  { label: "S", maxChanges: 40 },
  { label: "M", maxChanges: 100 },
  { label: "L", maxChanges: 400 },
  { label: "XL", maxChanges: 1000 },
];

export interface ReviewerInfo {
  displayName: string;
  uniqueName: string;
  vote: number;
}

export interface ThreadComment {
  authorUniqueName: string;
  publishedDate: Date;
}

export interface ThreadInfo {
  id: number;
  comments: ThreadComment[];
  publishedDate: Date;
}

export interface PullRequestInfo {
  id: number;
  title: string;
  author: string;
  authorUniqueName: string;
  url: string;
  createdDate: Date;
  reviewers: ReviewerInfo[];
  threads: ThreadInfo[];
  labels: string[];
  mergeStatus: number;
  lastSourcePushDate: Date | undefined;
  size?: PrSizeInfo;
}

export interface PrNeedingReview {
  id: number;
  title: string;
  author: string;
  url: string;
  waitingSince: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  repository?: string;
  size?: PrSizeInfo;
}

export interface PrWaitingOnAuthor {
  id: number;
  title: string;
  author: string;
  url: string;
  lastReviewerActivityDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  repository?: string;
  size?: PrSizeInfo;
}

export interface AnalysisResult {
  approved: PrApproved[];
  needingReview: PrNeedingReview[];
  waitingOnAuthor: PrWaitingOnAuthor[];
}

export interface PrApproved {
  id: number;
  title: string;
  author: string;
  url: string;
  createdDate: Date;
  hasMergeConflict: boolean;
  isTeamMember: boolean;
  repository?: string;
  size?: PrSizeInfo;
}

export function identityUniqueName(identity: IdentityRef | undefined): string {
  return identity?.uniqueName?.toLowerCase() ?? "";
}
