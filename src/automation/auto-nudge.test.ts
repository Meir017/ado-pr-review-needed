import { describe, it, expect, vi } from "vitest";
import {
  filterNudgeCandidates,
  buildNudgeComment,
  parseAdoPrUrl,
  loadNudgeHistory,
  saveNudgeHistory,
} from "./auto-nudge.js";
import type {
  PrNeedingReview,
  StalenessConfig,
  NudgeConfig,
  NudgeHistory,
} from "../types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

const DEFAULT_STALENESS: StalenessConfig = {
  enabled: true,
  thresholds: [
    { label: "💀 Abandoned", minDays: 30 },
    { label: "🔴 Stale", minDays: 14 },
    { label: "⚠️ Aging", minDays: 7 },
  ],
};

const DEFAULT_NUDGE_CONFIG: NudgeConfig = {
  enabled: true,
  cooldownDays: 7,
  commentTemplate: "⏰ PR waiting {{days}} days. Reviewers: {{reviewers}}. Title: {{title}}. Author: {{author}}.",
  dryRun: false,
  historyFile: ".pr-nudge-history.json",
};

function makePr(overrides: Partial<PrNeedingReview> = {}): PrNeedingReview {
  return {
    id: 100,
    title: "Test PR",
    author: "Alice",
    url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/100",
    waitingSince: new Date("2025-01-01"),
    hasMergeConflict: false,
    isTeamMember: true,
    action: "REVIEW",
    reviewerNames: ["Bob", "Charlie"],
    ...overrides,
  };
}

const NOW = new Date("2025-02-01");

describe("filterNudgeCandidates", () => {
  it("should return PRs that meet staleness and cooldown", () => {
    const prs = [makePr()]; // 31 days old
    const result = filterNudgeCandidates(prs, DEFAULT_STALENESS, DEFAULT_NUDGE_CONFIG, { entries: [] }, NOW);
    expect(result).toHaveLength(1);
  });

  it("should exclude fresh PRs below staleness threshold", () => {
    const freshPr = makePr({ waitingSince: new Date("2025-01-30") }); // 2 days old
    const result = filterNudgeCandidates([freshPr], DEFAULT_STALENESS, DEFAULT_NUDGE_CONFIG, { entries: [] }, NOW);
    expect(result).toHaveLength(0);
  });

  it("should respect minStalenessLevel filter", () => {
    // PR is 10 days old -> ⚠️ Aging, but config requires 🔴 Stale
    const agingPr = makePr({ waitingSince: new Date("2025-01-22") });
    const config = { ...DEFAULT_NUDGE_CONFIG, minStalenessLevel: "🔴 Stale" };
    const result = filterNudgeCandidates([agingPr], DEFAULT_STALENESS, config, { entries: [] }, NOW);
    expect(result).toHaveLength(0);
  });

  it("should include PRs at or above minStalenessLevel", () => {
    // PR is 31 days old -> 💀 Abandoned, config requires 🔴 Stale
    const config = { ...DEFAULT_NUDGE_CONFIG, minStalenessLevel: "🔴 Stale" };
    const result = filterNudgeCandidates([makePr()], DEFAULT_STALENESS, config, { entries: [] }, NOW);
    expect(result).toHaveLength(1);
  });

  it("should respect cooldown period", () => {
    const history: NudgeHistory = {
      entries: [{
        prId: 100,
        repoUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/100",
        lastNudgedAt: "2025-01-28T00:00:00Z", // 4 days ago, cooldown is 7
        nudgeCount: 1,
      }],
    };
    const result = filterNudgeCandidates([makePr()], DEFAULT_STALENESS, DEFAULT_NUDGE_CONFIG, history, NOW);
    expect(result).toHaveLength(0);
  });

  it("should allow nudge after cooldown expires", () => {
    const history: NudgeHistory = {
      entries: [{
        prId: 100,
        repoUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/100",
        lastNudgedAt: "2025-01-20T00:00:00Z", // 12 days ago
        nudgeCount: 1,
      }],
    };
    const result = filterNudgeCandidates([makePr()], DEFAULT_STALENESS, DEFAULT_NUDGE_CONFIG, history, NOW);
    expect(result).toHaveLength(1);
  });
});

describe("buildNudgeComment", () => {
  it("should interpolate all template variables", () => {
    const pr = makePr();
    const comment = buildNudgeComment(pr, DEFAULT_NUDGE_CONFIG, 31);
    expect(comment).toBe("⏰ PR waiting 31 days. Reviewers: Bob, Charlie. Title: Test PR. Author: Alice.");
  });

  it("should handle missing reviewer names", () => {
    const pr = makePr({ reviewerNames: undefined });
    const comment = buildNudgeComment(pr, DEFAULT_NUDGE_CONFIG, 14);
    expect(comment).toContain("Reviewers");
  });
});

describe("parseAdoPrUrl", () => {
  it("should parse a valid ADO PR URL", () => {
    const result = parseAdoPrUrl("https://dev.azure.com/myorg/myproj/_git/myrepo/pullrequest/42");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproj",
      repoName: "myrepo",
    });
  });

  it("should return null for invalid URLs", () => {
    expect(parseAdoPrUrl("https://github.com/owner/repo/pull/1")).toBeNull();
    expect(parseAdoPrUrl("not a url")).toBeNull();
  });
});

describe("loadNudgeHistory", () => {
  it("should return empty history when file doesn't exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const history = loadNudgeHistory("nonexistent.json");
    expect(history.entries).toEqual([]);
  });

  it("should parse valid history file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      entries: [{ prId: 1, repoUrl: "url", lastNudgedAt: "2025-01-01", nudgeCount: 1 }],
    }));
    const history = loadNudgeHistory("history.json");
    expect(history.entries).toHaveLength(1);
  });

  it("should handle corrupt file gracefully", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not json{{{");
    const history = loadNudgeHistory("corrupt.json");
    expect(history.entries).toEqual([]);
  });
});

describe("saveNudgeHistory", () => {
  it("should write history to file", () => {
    const history: NudgeHistory = {
      entries: [{ prId: 1, repoUrl: "url", lastNudgedAt: "2025-01-01", nudgeCount: 1 }],
    };
    saveNudgeHistory("history.json", history);
    expect(writeFileSync).toHaveBeenCalledOnce();
  });
});
