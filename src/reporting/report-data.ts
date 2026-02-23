import type { PrSizeInfo, PrSizeLabel, PrAction, SummaryStats } from "../types.js";
import type { AnalysisResult } from "../types.js";

export type Urgency = "low" | "medium" | "high";

export interface TimeAge {
  days: number;
  hours: number;
  minutes: number;
  urgency: Urgency;
}

export function computeTimeAge(date: Date, now: Date = new Date()): TimeAge {
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor(diffMs / (1000 * 60));

  let urgency: Urgency;
  if (days > 3) urgency = "high";
  else if (days > 1) urgency = "medium";
  else urgency = "low";

  return { days, hours, minutes, urgency };
}

export function computeSizeUrgency(label: PrSizeLabel): Urgency {
  if (label === "XS" || label === "S") return "low";
  if (label === "M") return "medium";
  return "high";
}

export function buildSummaryLine(analysis: AnalysisResult, stats?: SummaryStats): string {
  const { approved, needingReview, waitingOnAuthor } = analysis;
  const total = approved.length + needingReview.length + waitingOnAuthor.length;
  let line = `Total: ${total} open PR${total === 1 ? "" : "s"} — ${approved.length} approved, ${needingReview.length} needing review, ${waitingOnAuthor.length} waiting on author`;
  if (stats) {
    line += `, ${stats.totalConflicts} with conflicts`;
    if (stats.mergeRestarted > 0 || stats.mergeRestartFailed > 0) {
      line += `, ${stats.mergeRestarted} merge restarted`;
      if (stats.mergeRestartFailed > 0) {
        line += ` (${stats.mergeRestartFailed} failed)`;
      }
    }
  }
  return line;
}

export interface PrRowData {
  id: number;
  title: string;
  author: string;
  url: string;
  hasMergeConflict: boolean;
  dateColumn: Date;
  action: PrAction;
  repository?: string;
  size?: PrSizeInfo;
  detectedLabels?: string[];
  stalenessBadge?: string | null;
}
