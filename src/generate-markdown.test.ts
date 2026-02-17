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
    const md = generateMarkdown(makeAnalysis());
    expect(md).toContain("_Last updated:");
    expect(md).toContain("_No approved PRs._");
    expect(md).toContain("_No PRs currently need review._");
    expect(md).toContain("_No PRs waiting on author._");
    expect(md).toContain("0 approved, 0 needing review, 0 waiting on author");
  });

  it("shows approved section first", () => {
    const md = generateMarkdown(makeAnalysis({
      approved: [makePrApproved({ id: 10, title: "Ready to merge" })],
      needingReview: [makePrNeeding({ id: 20 })],
    }));
    const approvedIdx = md.indexOf("## ✅ Approved");
    const needingIdx = md.indexOf("## 👀 PRs Needing Review");
    expect(approvedIdx).toBeLessThan(needingIdx);
  });

  it("generates an approved table", () => {
    const md = generateMarkdown(makeAnalysis({
      approved: [makePrApproved({ id: 77, title: "Ship it", author: "Eve" })],
    }));
    expect(md).toContain("## ✅ Approved");
    expect(md).toContain("| PR | Author | Created |");
    expect(md).toContain("#77 - Ship it");
    expect(md).toContain("Eve");
    expect(md).toContain("1 approved");
  });

  it("generates a needing-review table for a single PR", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ id: 42, title: "Fix the thing", author: "Bob" })],
    }));
    expect(md).toContain("| PR | Author | Waiting for feedback |");
    expect(md).toContain("#42 - Fix the thing");
    expect(md).toContain("Bob");
    expect(md).toContain("1 needing review");
  });

  it("generates a waiting-on-author table", () => {
    const md = generateMarkdown(makeAnalysis({
      waitingOnAuthor: [makePrWaiting({ id: 99, title: "WIP stuff", author: "Dan" })],
    }));
    expect(md).toContain("## ✍️ Waiting on Author");
    expect(md).toContain("| PR | Author | Last reviewer activity |");
    expect(md).toContain("#99 - WIP stuff");
    expect(md).toContain("Dan");
    expect(md).toContain("1 waiting on author");
  });

  it("shows ❌ emoji for merge conflicts in any section", () => {
    const md = generateMarkdown(makeAnalysis({
      approved: [makePrApproved({ hasMergeConflict: true })],
    }));
    expect(md).toContain("❌");
  });

  it("does not show ❌ when no merge conflicts", () => {
    const md = generateMarkdown(makeAnalysis({
      approved: [makePrApproved({ hasMergeConflict: false })],
      needingReview: [makePrNeeding({ hasMergeConflict: false })],
      waitingOnAuthor: [makePrWaiting({ hasMergeConflict: false })],
    }));
    expect(md).not.toContain("❌");
  });

  it("shows 🟢 for PRs waiting less than 1 day", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 30) })],
    }));
    expect(md).toContain("🟢");
  });

  it("shows 🟡 for PRs waiting 2-3 days", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 60 * 48) })],
    }));
    expect(md).toContain("🟡");
  });

  it("shows 🔴 for PRs waiting more than 3 days", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ waitingSince: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5) })],
    }));
    expect(md).toContain("🔴");
  });

  it("shows correct totals for all three sections", () => {
    const md = generateMarkdown(makeAnalysis({
      approved: [makePrApproved({ id: 1 })],
      needingReview: [makePrNeeding({ id: 2 }), makePrNeeding({ id: 3 })],
      waitingOnAuthor: [makePrWaiting({ id: 4 })],
    }));
    expect(md).toContain("4 open PRs — 1 approved, 2 needing review, 1 waiting on author");
  });

  it("splits into Team PRs and Community Contributions when mixed", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [
        makePrNeeding({ id: 1, author: "TeamAlice", isTeamMember: true }),
        makePrNeeding({ id: 2, author: "ExtBob", isTeamMember: false }),
      ],
    }));
    expect(md).toContain("### Team PRs");
    expect(md).toContain("### Community Contributions");
    expect(md).toContain("TeamAlice");
    expect(md).toContain("ExtBob");
  });

  it("does not show Team/Community subsections when all are team members", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [
        makePrNeeding({ id: 1, isTeamMember: true }),
        makePrNeeding({ id: 2, isTeamMember: true }),
      ],
    }));
    expect(md).not.toContain("### Team PRs");
    expect(md).not.toContain("### Community Contributions");
  });

  it("escapes square brackets and pipes in PR titles", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ title: "[Draft] Fix | something" })],
    }));
    expect(md).toContain("\\[Draft\\] Fix \\| something");
    expect(md).not.toMatch(/\[#\d+ - \[Draft\]/);
  });

  it("strips carriage returns and newlines from PR titles", () => {
    const md = generateMarkdown(makeAnalysis({
      needingReview: [makePrNeeding({ title: "Add Data Centers\r" })],
    }));
    expect(md).toContain("Add Data Centers](");
    expect(md).not.toContain("\r");
  });

  describe("multi-repo mode", () => {
    it("adds Repository column when multiRepo is true", () => {
      const md = generateMarkdown(makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, title: "PR in Repo A", repository: "Project/RepoA" }),
          makePrNeeding({ id: 2, title: "PR in Repo B", repository: "Project/RepoB" }),
        ],
      }), true);
      expect(md).toContain("| PR | Repository | Author | Waiting for feedback |");
      expect(md).toContain("| Project/RepoA |");
      expect(md).toContain("| Project/RepoB |");
      expect(md).toContain("PR in Repo A");
      expect(md).toContain("PR in Repo B");
    });

    it("shows empty message when no PRs in multi-repo mode", () => {
      const md = generateMarkdown(makeAnalysis(), true);
      expect(md).toContain("_No approved PRs._");
      expect(md).toContain("_No PRs currently need review._");
      expect(md).toContain("_No PRs waiting on author._");
    });

    it("does not add Repository column when multiRepo is false", () => {
      const md = generateMarkdown(makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, repository: "Project/RepoA" }),
        ],
      }), false);
      expect(md).not.toContain("| Repository |");
    });

    it("splits team/community with Repository column in multi-repo mode", () => {
      const md = generateMarkdown(makeAnalysis({
        needingReview: [
          makePrNeeding({ id: 1, repository: "Project/Repo", isTeamMember: true }),
          makePrNeeding({ id: 2, repository: "Project/Repo", isTeamMember: false }),
        ],
      }), true);
      expect(md).toContain("### Team PRs");
      expect(md).toContain("### Community Contributions");
      expect(md).toContain("| PR | Repository | Author | Waiting for feedback |");
    });
  });
});
