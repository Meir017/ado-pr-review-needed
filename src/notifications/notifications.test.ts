import { describe, it, expect } from "vitest";
import { buildTeamsPayload } from "./teams.js";
import { buildSlackPayload } from "./slack.js";
import type { AnalysisResult, SummaryStats, StalenessConfig } from "../types.js";

const STALENESS: StalenessConfig = {
  enabled: true,
  thresholds: [
    { label: "💀 Abandoned", minDays: 30 },
    { label: "🔴 Stale", minDays: 14 },
    { label: "⚠️ Aging", minDays: 7 },
  ],
};

const STATS: SummaryStats = {
  totalConflicts: 2,
  mergeRestarted: 1,
  mergeRestartFailed: 0,
};

function makeAnalysis(): AnalysisResult {
  return {
    approved: [
      { id: 1, title: "Approved PR", author: "Alice", url: "https://example.com/pr/1", createdDate: new Date("2026-01-01"), hasMergeConflict: false, isTeamMember: true, action: "APPROVE" },
    ],
    needingReview: [
      { id: 2, title: "Review PR", author: "Bob", url: "https://example.com/pr/2", waitingSince: new Date("2026-01-01"), hasMergeConflict: false, isTeamMember: true, action: "REVIEW" },
      { id: 3, title: "Another Review PR", author: "Charlie", url: "https://example.com/pr/3", waitingSince: new Date("2026-02-10"), hasMergeConflict: true, isTeamMember: true, action: "REVIEW" },
    ],
    waitingOnAuthor: [
      { id: 4, title: "Author PR", author: "Dave", url: "https://example.com/pr/4", lastReviewerActivityDate: new Date("2026-02-15"), hasMergeConflict: false, isTeamMember: true, action: "PENDING" },
    ],
  };
}

describe("Teams notification", () => {
  it("builds an Adaptive Card with all sections", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS);

    expect(payload.type).toBe("message");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].content.type).toBe("AdaptiveCard");

    const body = payload.attachments[0].content.body;
    expect(body.length).toBeGreaterThan(2);

    const texts = body.map((b) => b.text).filter(Boolean);
    expect(texts.some((t) => t!.includes("4 open PRs"))).toBe(true);
    expect(texts.some((t) => t!.includes("Needing Review"))).toBe(true);
    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(true);
    expect(texts.some((t) => t!.includes("Approved"))).toBe(true);
  });

  it("filters to only requested sections", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS, ["needingReview"]);
    const texts = payload.attachments[0].content.body.map((b) => b.text).filter(Boolean);

    expect(texts.some((t) => t!.includes("Needing Review"))).toBe(true);
    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(false);
    expect(texts.some((t) => t!.includes("Approved (1)"))).toBe(false);
  });

  it("includes staleness badges in PR lines", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS);
    const texts = payload.attachments[0].content.body.map((b) => b.text).filter(Boolean);

    // PR #2 is from 2026-01-01, should be "💀 Abandoned"
    expect(texts.some((t) => t!.includes("💀 Abandoned"))).toBe(true);
  });
});

describe("Slack notification", () => {
  it("builds Block Kit payload with all sections", () => {
    const payload = buildSlackPayload(makeAnalysis(), STATS, STALENESS);

    expect(payload.blocks.length).toBeGreaterThan(2);

    const header = payload.blocks[0];
    expect(header.type).toBe("header");
    expect(header.text?.text).toContain("4 open PRs");

    const texts = payload.blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text?.text)
      .filter(Boolean);

    expect(texts.some((t) => t!.includes("Needing Review"))).toBe(true);
    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(true);
    expect(texts.some((t) => t!.includes("Approved"))).toBe(true);
  });

  it("filters to only requested sections", () => {
    const payload = buildSlackPayload(makeAnalysis(), STATS, STALENESS, ["waitingOnAuthor"]);
    const texts = payload.blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text?.text)
      .filter(Boolean);

    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(true);
    expect(texts.some((t) => t!.includes("Needing Review (2)"))).toBe(false);
  });

  it("uses Slack mrkdwn link format", () => {
    const payload = buildSlackPayload(makeAnalysis(), STATS, STALENESS);
    const texts = payload.blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text?.text)
      .filter(Boolean);

    // Should contain Slack-style links
    expect(texts.some((t) => t!.includes("<https://example.com/pr/2|#2"))).toBe(true);
  });

  it("includes staleness badges", () => {
    const payload = buildSlackPayload(makeAnalysis(), STATS, STALENESS);
    const allText = payload.blocks.map((b) => b.text?.text ?? "").join(" ");
    expect(allText).toContain("💀 Abandoned");
  });
});
