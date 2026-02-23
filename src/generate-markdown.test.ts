import { describe, it, expect } from "vitest";
import { generateMarkdown } from "./generate-markdown.js";
import type { PrNeedingReview, PrWaitingOnAuthor, PrApproved, AnalysisResult } from "./types.js";

function makePrNeeding(
  overrides: Partial<PrNeedingReview> = {},
): PrNeedingReview {
  return {
    id: 1,
    title: "Test PR",
    author: "Alice",
    url: "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
    waitingSince: new Date(),
    hasMergeConflict: false,
    isTeamMember: true,
    action: "REVIEW",
    ...overrides,
  };
}

function makePrWaiting(
  overrides: Partial<PrWaitingOnAuthor> = {},
): PrWaitingOnAuthor {
  return {
    id: 2,
    title: "Author PR",
    author: "Carol",
    url: "https://dev.azure.com/org/project/_git/repo/pullrequest/2",
    lastReviewerActivityDate: new Date(),
    hasMergeConflict: false,
    isTeamMember: true,
    action: "PENDING",
    ...overrides,
  };
}

function makePrApproved(
  overrides: Partial<PrApproved> = {},
): PrApproved {
  return {
    id: 3,
    title: "Approved PR",
    author: "Eve",
    url: "https://dev.azure.com/org/project/_git/repo/pullrequest/3",
    createdDate: new Date(),
    hasMergeConflict: false,
    isTeamMember: true,
    action: "APPROVE",
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    approved: [],
    needingReview: [],
    waitingOnAuthor: [],
    ...overrides,
  };
}

describe("generateMarkdown", () => {
  it("returns valid markdown with header when there are no PRs", () => {
    const md = generateMarkdown({ analysis: makeAnalysis() });
    expect(md).toContain("_Last updated:");
    expect(md).toContain("_No approved PRs._");
    expect(md).toContain("_No PRs currently need review._");
    expect(md).toContain("_No PRs waiting on author._");
    expect(md).toContain("0 approved, 0 needing review, 0 waiting on author");
  });

  it("shows approved section first", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      approved: [makePrApproved({ id: 10, title: "Ready to merge" })],
      needingReview: [makePrNeeding({ id: 20 })],
    }) });
    const approvedIdx = md.indexOf("## ✅ Approved");
    const needingIdx = md.indexOf("## 👀 PRs Needing Review");
    expect(approvedIdx).toBeLessThan(needingIdx);
  });

  it("generates an approved table", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      approved: [makePrApproved({ id: 77, title: "Ship it", author: "Eve" })],
    }) });
    expect(md).toContain("## ✅ Approved");
    expect(md).toContain("| PR | Author | Action | Created |");
    expect(md).toContain("#77 - Ship it");
    expect(md).toContain("Eve");
    expect(md).toContain("1 approved");
  });

  it("generates a needing-review table for a single PR", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ id: 42, title: "Fix the thing", author: "Bob" })],
    }) });
    expect(md).toContain("| PR | Author | Action | Waiting for feedback |");
    expect(md).toContain("#42 - Fix the thing");
    expect(md).toContain("Bob");
    expect(md).toContain("1 needing review");
  });

  it("generates a waiting-on-author table", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      waitingOnAuthor: [makePrWaiting({ id: 99, title: "WIP stuff", author: "Dan" })],
    }) });
    expect(md).toContain("## ✍️ Waiting on Author");
    expect(md).toContain("| PR | Author | Action | Last reviewer activity |");
    expect(md).toContain("#99 - WIP stuff");
    expect(md).toContain("Dan");
    expect(md).toContain("1 waiting on author");
  });

  it("shows ❌ emoji for merge conflicts in any section", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      approved: [makePrApproved({ hasMergeConflict: true })],
    }) });
    expect(md).toContain("❌");
  });

  it("does not show ❌ when no merge conflicts", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      approved: [makePrApproved({ hasMergeConflict: false })],
      needingReview: [makePrNeeding({ hasMergeConflict: false })],
      waitingOnAuthor: [makePrWaiting({ hasMergeConflict: false })],
    }) });
    expect(md).not.toContain("❌");
  });

  it("shows 🟢 for PRs waiting less than 1 day", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 30) })],
    }) });
    expect(md).toContain("🟢");
  });

  it("shows 🟡 for PRs waiting 2-3 days", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 60 * 48) })],
    }) });
    expect(md).toContain("🟡");
  });

  it("shows 🔴 for PRs waiting more than 3 days", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5) })],
    }) });
    expect(md).toContain("🔴");
  });

  it("shows correct totals for all three sections", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      approved: [makePrApproved({ id: 1 })],
      needingReview: [makePrNeeding({ id: 2 }), makePrNeeding({ id: 3 })],
      waitingOnAuthor: [makePrWaiting({ id: 4 })],
    }) });
    expect(md).toContain("4 open PRs — 1 approved, 2 needing review, 1 waiting on author");
  });

  it("splits into Team PRs and Community Contributions when mixed", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [
        makePrNeeding({ id: 1, author: "TeamAlice", isTeamMember: true }),
        makePrNeeding({ id: 2, author: "ExtBob", isTeamMember: false }),
      ],
    }) });
    expect(md).toContain("### Team PRs");
    expect(md).toContain("### Community Contributions");
    expect(md).toContain("TeamAlice");
    expect(md).toContain("ExtBob");
  });

  it("does not show Team/Community subsections when all are team members", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [
        makePrNeeding({ id: 1, isTeamMember: true }),
        makePrNeeding({ id: 2, isTeamMember: true }),
      ],
    }) });
    expect(md).not.toContain("### Team PRs");
    expect(md).not.toContain("### Community Contributions");
  });

  it("escapes square brackets and pipes in PR titles", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ title: "[Draft] Fix | something" })],
    }) });
    expect(md).toContain("\\[Draft\\] Fix \\| something");
    expect(md).not.toMatch(/\[#\d+ - \[Draft\]/);
  });

  it("strips carriage returns and newlines from PR titles", () => {
    const md = generateMarkdown({ analysis: makeAnalysis({
      needingReview: [makePrNeeding({ title: "Add Data Centers\r" })],
    }) });
    expect(md).toContain("Add Data Centers](");
    expect(md).not.toContain("\r");
  });

  describe("multi-repo mode", () => {
    it("adds Repository column when multiRepo is true", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, title: "PR in Repo A", repository: "Project/RepoA" }),
          makePrNeeding({ id: 2, title: "PR in Repo B", repository: "Project/RepoB" }),
        ],
      }), multiRepo: true });
      expect(md).toContain("| PR | Repository | Author | Action | Waiting for feedback |");
      expect(md).toContain("| Project/RepoA |");
      expect(md).toContain("| Project/RepoB |");
      expect(md).toContain("PR in Repo A");
      expect(md).toContain("PR in Repo B");
    });

    it("shows empty message when no PRs in multi-repo mode", () => {
      const md = generateMarkdown({ analysis: makeAnalysis(), multiRepo: true });
      expect(md).toContain("_No approved PRs._");
      expect(md).toContain("_No PRs currently need review._");
      expect(md).toContain("_No PRs waiting on author._");
    });

    it("does not add Repository column when multiRepo is false", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, repository: "Project/RepoA" }),
        ],
      }), multiRepo: false });
      expect(md).not.toContain("| Repository |");
    });

    it("splits team/community with Repository column in multi-repo mode", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, repository: "Project/Repo", isTeamMember: true }),
          makePrNeeding({ id: 2, repository: "Project/Repo", isTeamMember: false }),
        ],
      }), multiRepo: true });
      expect(md).toContain("### Team PRs");
      expect(md).toContain("### Community Contributions");
      expect(md).toContain("| PR | Repository | Author | Action | Waiting for feedback |");
    });
  });

  describe("size column", () => {
    it("shows Size column when PRs have size info", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          id: 1,
          size: { linesAdded: 5, linesDeleted: 3, totalChanges: 8, label: "XS" },
        })],
      }) });
      expect(md).toContain("| Size |");
      expect(md).toContain("🟢 XS");
    });

    it("shows 🟡 for medium PRs", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          size: { linesAdded: 50, linesDeleted: 20, totalChanges: 70, label: "M" },
        })],
      }) });
      expect(md).toContain("🟡 M");
    });

    it("shows 🔴 for large PRs", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          size: { linesAdded: 300, linesDeleted: 200, totalChanges: 500, label: "XL" },
        })],
      }) });
      expect(md).toContain("🔴 XL");
    });

    it("shows 🔴 for L PRs", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          size: { linesAdded: 150, linesDeleted: 100, totalChanges: 250, label: "L" },
        })],
      }) });
      expect(md).toContain("🔴 L");
    });

    it("shows 🟢 for S PRs", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          size: { linesAdded: 20, linesDeleted: 10, totalChanges: 30, label: "S" },
        })],
      }) });
      expect(md).toContain("🟢 S");
    });

    it("does not show Size column when no PRs have size info", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({ id: 1 })],
      }) });
      expect(md).not.toContain("| Size |");
    });

    it("shows Size column in multi-repo mode", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          id: 1,
          repository: "Project/Repo",
          size: { linesAdded: 5, linesDeleted: 3, totalChanges: 8, label: "XS" },
        })],
      }), multiRepo: true });
      expect(md).toContain("| PR | Repository | Author | Action | Size | Waiting for feedback |");
      expect(md).toContain("🟢 XS");
    });
  });

  describe("detected labels", () => {
    it("renders detected labels as badges after PR title", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({
          id: 1,
          title: "Update pipelines",
          detectedLabels: ["azure-pipelines", "docker"],
        })],
      }) });
      expect(md).toContain("`azure-pipelines`");
      expect(md).toContain("`docker`");
    });

    it("does not render label badges when no detected labels", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({ id: 1, title: "Simple fix" })],
      }) });
      // No backtick-wrapped labels should appear in the PR row
      const prRow = md.split("\n").find((l) => l.includes("Simple fix"))!;
      expect(prRow).not.toMatch(/`[^`]+`/);
    });

    it("renders labels in approved section", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        approved: [makePrApproved({ detectedLabels: ["config-change"] })],
      }) });
      expect(md).toContain("`config-change`");
    });

    it("renders labels in waiting on author section", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        waitingOnAuthor: [makePrWaiting({ detectedLabels: ["docker"] })],
      }) });
      expect(md).toContain("`docker`");
    });
  });

  describe("per-repo statistics", () => {
    it("renders repo stats table when multiple repos in stats", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({ id: 1, repository: "Proj/RepoA" })],
        approved: [makePrApproved({ id: 2, repository: "Proj/RepoB" })],
      }), multiRepo: true, stats: {
        totalConflicts: 1,
        mergeRestarted: 0,
        mergeRestartFailed: 0,
        repoStats: [
          { repoLabel: "Proj/RepoA", approved: 0, needingReview: 1, waitingOnAuthor: 0, conflicts: 0, mergeRestarted: 0, mergeRestartFailed: 0 },
          { repoLabel: "Proj/RepoB", approved: 1, needingReview: 0, waitingOnAuthor: 0, conflicts: 1, mergeRestarted: 0, mergeRestartFailed: 0 },
        ],
      } });
      expect(md).toContain("## 📊 Statistics per Repository");
      expect(md).toContain("| Proj/RepoA | 1 | 0 | 1 | 0 | 0 | 0 |");
      expect(md).toContain("| Proj/RepoB | 1 | 1 | 0 | 0 | 1 | 0 |");
    });

    it("does not render repo stats table for a single repo", () => {
      const md = generateMarkdown({ analysis: makeAnalysis({
        needingReview: [makePrNeeding({ id: 1 })],
      }), multiRepo: false, stats: {
        totalConflicts: 0,
        mergeRestarted: 0,
        mergeRestartFailed: 0,
        repoStats: [
          { repoLabel: "Proj/Repo", approved: 0, needingReview: 1, waitingOnAuthor: 0, conflicts: 0, mergeRestarted: 0, mergeRestartFailed: 0 },
        ],
      } });
      expect(md).not.toContain("## 📊 Statistics per Repository");
    });

    it("shows merge restarted with failures in repo stats", () => {
      const md = generateMarkdown({ analysis: makeAnalysis(), multiRepo: true, stats: {
        totalConflicts: 0,
        mergeRestarted: 5,
        mergeRestartFailed: 2,
        repoStats: [
          { repoLabel: "Proj/A", approved: 0, needingReview: 0, waitingOnAuthor: 0, conflicts: 0, mergeRestarted: 3, mergeRestartFailed: 1 },
          { repoLabel: "Proj/B", approved: 0, needingReview: 0, waitingOnAuthor: 0, conflicts: 0, mergeRestarted: 2, mergeRestartFailed: 1 },
        ],
      } });
      expect(md).toContain("| Proj/A | 0 | 0 | 0 | 0 | 0 | 3 (1 failed) |");
      expect(md).toContain("| Proj/B | 0 | 0 | 0 | 0 | 0 | 2 (1 failed) |");
    });

    it("does not render repo stats table when repoStats is undefined", () => {
      const md = generateMarkdown({ analysis: makeAnalysis(), multiRepo: true, stats: {
        totalConflicts: 0,
        mergeRestarted: 0,
        mergeRestartFailed: 0,
      } });
      expect(md).not.toContain("## 📊 Statistics per Repository");
    });
  });
});
