import { describe, it, expect } from "vitest";
import { buildTeamsPayload } from "./teams.js";
import type { AnalysisResult, SummaryStats, StalenessConfig } from "../../types.js";

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
      { id: 1, title: "Approved PR", author: "Alice", url: "https://example.com/pr/1", createdDate: new Date("2026-01-01"), hasMergeConflict: false, isTeamMember: true, isStarred: false, action: "APPROVE" },
    ],
    needingReview: [
      { id: 2, title: "Review PR", author: "Bob", url: "https://example.com/pr/2", waitingSince: new Date("2026-01-01"), hasMergeConflict: false, isTeamMember: true, isStarred: false, action: "REVIEW" },
      { id: 3, title: "Another Review PR", author: "Charlie", url: "https://example.com/pr/3", waitingSince: new Date("2026-02-10"), hasMergeConflict: true, isTeamMember: true, isStarred: false, action: "REVIEW" },
    ],
    waitingOnAuthor: [
      { id: 4, title: "Author PR", author: "Dave", url: "https://example.com/pr/4", lastReviewerActivityDate: new Date("2026-02-15"), hasMergeConflict: false, isTeamMember: true, isStarred: false, action: "PENDING" },
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAllTexts(elements: any[]): string[] {
  const texts: string[] = [];
  for (const el of elements) {
    if (el.text) texts.push(el.text);
    if (el.facts) {
      for (const fact of el.facts) {
        if (fact.title) texts.push(fact.title);
        if (fact.value) texts.push(fact.value);
      }
    }
    if (el.columns) {
      for (const col of el.columns) {
        if (col.items) texts.push(...extractAllTexts(col.items));
      }
    }
    if (el.items) texts.push(...extractAllTexts(el.items));
  }
  return texts;
}

describe("Teams notification", () => {
  it("builds an Adaptive Card with all sections", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS);

    expect(payload.type).toBe("message");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].content.type).toBe("AdaptiveCard");
    expect(payload.attachments[0].content.version).toBe("1.4");

    const body = payload.attachments[0].content.body;
    expect(body.length).toBeGreaterThan(2);

    const texts = body.map((b) => b.text).filter(Boolean);
    expect(texts.some((t) => t!.includes("4 open PRs"))).toBe(true);
    expect(texts.some((t) => t!.includes("Needing Review"))).toBe(true);
    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(true);
    expect(texts.some((t) => t!.includes("Approved"))).toBe(true);

    // Verify FactSet elements exist for each section
    const factSets = body.filter((b) => b.type === "FactSet");
    expect(factSets.length).toBe(3);
  });

  it("filters to only requested sections", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS, ["needingReview"]);
    const texts = payload.attachments[0].content.body.map((b) => b.text).filter(Boolean);

    expect(texts.some((t) => t!.includes("Needing Review"))).toBe(true);
    expect(texts.some((t) => t!.includes("Waiting on Author"))).toBe(false);
    expect(texts.some((t) => t!.includes("Approved (1)"))).toBe(false);

    const factSets = payload.attachments[0].content.body.filter((b) => b.type === "FactSet");
    expect(factSets.length).toBe(1);
  });

  it("includes staleness badges in facts", () => {
    const payload = buildTeamsPayload(makeAnalysis(), STATS, STALENESS);
    const allTexts = extractAllTexts(payload.attachments[0].content.body);

    // PR #2 is from 2026-01-01, should be "💀 Abandoned"
    expect(allTexts.some((t) => t.includes("💀 Abandoned"))).toBe(true);
  });

  it("shows all PRs without trimming", () => {
    const analysis = makeAnalysis();
    // Add many PRs to needing review
    for (let i = 10; i <= 30; i++) {
      analysis.needingReview.push({
        id: i, title: `PR ${i}`, author: "User", url: `https://example.com/pr/${i}`,
        waitingSince: new Date("2026-02-20"), hasMergeConflict: false, isTeamMember: true, isStarred: false, action: "REVIEW",
      });
    }
    const payload = buildTeamsPayload(analysis, STATS, STALENESS);
    const allTexts = extractAllTexts(payload.attachments[0].content.body);

    // All 23 PRs should appear (2 original + 21 added), no "…and X more" text
    expect(allTexts.some((t) => t.includes("#30"))).toBe(true);
    expect(allTexts.some((t) => t.includes("more"))).toBe(false);
  });

  it("includes repository in fact titles when set", () => {
    const analysis = makeAnalysis();
    analysis.needingReview[0].repository = "myProject/myRepo";
    const payload = buildTeamsPayload(analysis, STATS, STALENESS);
    const allTexts = extractAllTexts(payload.attachments[0].content.body);

    expect(allTexts.some((t) => t.includes("myProject/myRepo · #2"))).toBe(true);
  });

  it("includes repository names in summary heading", () => {
    const analysis = makeAnalysis();
    analysis.needingReview[0].repository = "proj/repoA";
    analysis.needingReview[1].repository = "proj/repoB";
    analysis.approved[0].repository = "proj/repoA";
    const payload = buildTeamsPayload(analysis, STATS, STALENESS);
    const heading = payload.attachments[0].content.body[0].text!;

    expect(heading).toContain("for proj/repoA, proj/repoB");
  });
});
