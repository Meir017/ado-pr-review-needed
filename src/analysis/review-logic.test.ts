import { describe, it, expect } from "vitest";
import { analyzePrs, mergeAnalysisResults, isBotAuthor } from "./review-logic.js";
import type { PullRequestInfo } from "../types.js";
import { PullRequestAsyncStatus } from "azure-devops-node-api/interfaces/GitInterfaces.js";

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: "Test PR",
    author: "Alice",
    authorUniqueName: "alice@example.com",
    url: "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
    createdDate: new Date("2025-01-01T00:00:00Z"),
    reviewers: [],
    threads: [],
    labels: [],
    detectedLabels: [],
    mergeStatus: PullRequestAsyncStatus.NotSet,
    lastSourcePushDate: undefined,
    ...overrides,
  };
}

describe("analyzePrs", () => {
  it("puts approved PRs (vote >= 10) in the approved list", () => {
    const pr = makePr({
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 10 },
      ],
    });
    const { approved, needingReview, waitingOnAuthor } = analyzePrs([pr]);
    expect(approved).toHaveLength(1);
    expect(approved[0].id).toBe(1);
    expect(needingReview).toHaveLength(0);
    expect(waitingOnAuthor).toHaveLength(0);
  });

  it("puts approved-with-suggestions (vote = 5) in the approved list", () => {
    const pr = makePr({
      reviewers: [
        { displayName: "Bob", uniqueName: "bob@example.com", vote: 5 },
      ],
    });
    const { approved, needingReview, waitingOnAuthor } = analyzePrs([pr]);
    expect(approved).toHaveLength(1);
    expect(needingReview).toHaveLength(0);
    expect(waitingOnAuthor).toHaveLength(0);
  });

  it("puts PRs with only author activity in needingReview", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-02"),
          comments: [
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-02"),
            },
          ],
        },
      ],
    });
    const { needingReview, waitingOnAuthor } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].id).toBe(1);
    expect(waitingOnAuthor).toHaveLength(0);
  });

  it("puts PRs with no activity in needingReview (needs initial review)", () => {
    const pr = makePr();
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].waitingSince).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("puts PRs where reviewer commented last in waitingOnAuthor", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-02"),
          comments: [
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-02"),
            },
            {
              authorUniqueName: "bob@example.com",
              publishedDate: new Date("2025-01-03"),
            },
          ],
        },
      ],
    });
    const { needingReview, waitingOnAuthor } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(0);
    expect(waitingOnAuthor).toHaveLength(1);
    expect(waitingOnAuthor[0].id).toBe(1);
    expect(waitingOnAuthor[0].lastReviewerActivityDate).toEqual(new Date("2025-01-03"));
  });

  it("ignores bot/service account activity", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-05"),
          comments: [
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-02"),
            },
            {
              authorUniqueName: "build-service@microsoft.visualstudio.com",
              publishedDate: new Date("2025-01-05"),
            },
          ],
        },
      ],
    });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
  });

  it("detects merge conflicts in needingReview", () => {
    const pr = makePr({
      mergeStatus: PullRequestAsyncStatus.Conflicts,
    });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].hasMergeConflict).toBe(true);
  });

  it("detects merge conflicts in waitingOnAuthor", () => {
    const pr = makePr({
      mergeStatus: PullRequestAsyncStatus.Conflicts,
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-02"),
          comments: [
            { authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-03") },
          ],
        },
      ],
    });
    const { waitingOnAuthor } = analyzePrs([pr]);
    expect(waitingOnAuthor).toHaveLength(1);
    expect(waitingOnAuthor[0].hasMergeConflict).toBe(true);
  });

  it("sets hasMergeConflict to false when no conflicts", () => {
    const pr = makePr({
      mergeStatus: PullRequestAsyncStatus.Succeeded,
    });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].hasMergeConflict).toBe(false);
  });

  it("computes waitingSince as first author activity after last reviewer activity", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-02"),
          comments: [
            {
              authorUniqueName: "bob@example.com",
              publishedDate: new Date("2025-01-02"),
            },
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-03"),
            },
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-04"),
            },
          ],
        },
      ],
    });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].waitingSince).toEqual(new Date("2025-01-03"));
  });

  it("sorts needingReview by waitingSince ascending (oldest first)", () => {
    const pr1 = makePr({ id: 1, createdDate: new Date("2025-01-05") });
    const pr2 = makePr({ id: 2, createdDate: new Date("2025-01-01") });
    const { needingReview } = analyzePrs([pr1, pr2]);
    expect(needingReview).toHaveLength(2);
    expect(needingReview[0].id).toBe(2);
    expect(needingReview[1].id).toBe(1);
  });

  it("sorts waitingOnAuthor by lastReviewerActivityDate ascending", () => {
    const pr1 = makePr({
      id: 1,
      threads: [{
        id: 1, publishedDate: new Date("2025-01-05"),
        comments: [{ authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-05") }],
      }],
    });
    const pr2 = makePr({
      id: 2,
      threads: [{
        id: 1, publishedDate: new Date("2025-01-02"),
        comments: [{ authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-02") }],
      }],
    });
    const { waitingOnAuthor } = analyzePrs([pr1, pr2]);
    expect(waitingOnAuthor).toHaveLength(2);
    expect(waitingOnAuthor[0].id).toBe(2);
    expect(waitingOnAuthor[1].id).toBe(1);
  });

  it("treats lastSourcePushDate as author activity", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-02"),
          comments: [
            { authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-02") },
          ],
        },
      ],
      lastSourcePushDate: new Date("2025-01-03"),
    });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].waitingSince).toEqual(new Date("2025-01-03"));
  });

  it("marks PR author as team member when in teamMembers set", () => {
    const pr = makePr({ authorUniqueName: "alice@example.com" });
    const teamMembers = new Set(["alice@example.com"]);
    const { needingReview } = analyzePrs([pr], teamMembers);
    expect(needingReview[0].isTeamMember).toBe(true);
  });

  it("marks PR author as non-team when not in teamMembers set", () => {
    const pr = makePr({ authorUniqueName: "alice@example.com" });
    const teamMembers = new Set(["bob@example.com"]);
    const { needingReview } = analyzePrs([pr], teamMembers);
    expect(needingReview[0].isTeamMember).toBe(false);
  });

  it("treats all authors as team when teamMembers is empty", () => {
    const pr = makePr({ authorUniqueName: "anyone@example.com" });
    const { needingReview } = analyzePrs([pr], new Set());
    expect(needingReview[0].isTeamMember).toBe(true);
  });

  it("tags PRs with repository label when provided", () => {
    const pr = makePr();
    const { needingReview } = analyzePrs([pr], new Set(), "Project/MyRepo");
    expect(needingReview[0].repository).toBe("Project/MyRepo");
  });

  it("leaves repository undefined when no label provided", () => {
    const pr = makePr();
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].repository).toBeUndefined();
  });

  it("propagates detectedLabels to analysis results", () => {
    const pr = makePr({ detectedLabels: ["docker", "azure-pipelines"] });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].detectedLabels).toEqual(["docker", "azure-pipelines"]);
  });

  it("omits detectedLabels when empty", () => {
    const pr = makePr({ detectedLabels: [] });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].detectedLabels).toBeUndefined();
  });

  it("excludes PRs from ignored users entirely", () => {
    const pr1 = makePr({ id: 1, authorUniqueName: "manager@example.com" });
    const pr2 = makePr({ id: 2, authorUniqueName: "alice@example.com" });
    const ignored = new Set(["manager@example.com"]);
    const { approved, needingReview, waitingOnAuthor } = analyzePrs([pr1, pr2], new Set(), undefined, ignored);
    expect(approved).toHaveLength(0);
    expect(needingReview).toHaveLength(1);
    expect(needingReview[0].id).toBe(2);
    expect(waitingOnAuthor).toHaveLength(0);
  });

  it("excludes ignored users from all categories including approved", () => {
    const pr = makePr({
      id: 1,
      authorUniqueName: "manager@example.com",
      reviewers: [{ displayName: "Bob", uniqueName: "bob@example.com", vote: 10 }],
    });
    const ignored = new Set(["manager@example.com"]);
    const { approved, needingReview, waitingOnAuthor } = analyzePrs([pr], new Set(), undefined, ignored);
    expect(approved).toHaveLength(0);
    expect(needingReview).toHaveLength(0);
    expect(waitingOnAuthor).toHaveLength(0);
  });
});

describe("mergeAnalysisResults", () => {
  it("merges results from multiple analyses", () => {
    const a1 = analyzePrs([makePr({ id: 1, createdDate: new Date("2025-01-05") })], new Set(), "RepoA");
    const a2 = analyzePrs([makePr({ id: 2, createdDate: new Date("2025-01-01") })], new Set(), "RepoB");
    const merged = mergeAnalysisResults([a1, a2]);
    expect(merged.needingReview).toHaveLength(2);
    // Sorted oldest first
    expect(merged.needingReview[0].id).toBe(2);
    expect(merged.needingReview[1].id).toBe(1);
  });

  it("preserves repository labels after merge", () => {
    const a1 = analyzePrs([makePr({ id: 1 })], new Set(), "RepoA");
    const a2 = analyzePrs([makePr({ id: 2 })], new Set(), "RepoB");
    const merged = mergeAnalysisResults([a1, a2]);
    expect(merged.needingReview.map((p) => p.repository)).toContain("RepoA");
    expect(merged.needingReview.map((p) => p.repository)).toContain("RepoB");
  });

  it("returns empty arrays when merging empty results", () => {
    const merged = mergeAnalysisResults([]);
    expect(merged.approved).toHaveLength(0);
    expect(merged.needingReview).toHaveLength(0);
    expect(merged.waitingOnAuthor).toHaveLength(0);
  });

  it("propagates size info to needingReview", () => {
    const size = { linesAdded: 20, linesDeleted: 10, totalChanges: 30, label: "S" as const };
    const pr = makePr({ size });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].size).toEqual(size);
  });

  it("propagates size info to approved", () => {
    const size = { linesAdded: 50, linesDeleted: 50, totalChanges: 100, label: "M" as const };
    const pr = makePr({
      size,
      reviewers: [{ displayName: "Bob", uniqueName: "bob@example.com", vote: 10 }],
    });
    const { approved } = analyzePrs([pr]);
    expect(approved[0].size).toEqual(size);
  });

  it("propagates size info to waitingOnAuthor", () => {
    const size = { linesAdded: 300, linesDeleted: 200, totalChanges: 500, label: "XL" as const };
    const pr = makePr({
      size,
      threads: [{
        id: 1, publishedDate: new Date("2025-01-02"),
        comments: [{ authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-03") }],
      }],
    });
    const { waitingOnAuthor } = analyzePrs([pr]);
    expect(waitingOnAuthor[0].size).toEqual(size);
  });

  it("leaves size undefined when not provided", () => {
    const pr = makePr();
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].size).toBeUndefined();
  });
});

describe("isBotAuthor", () => {
  it("detects dependabot as a bot author", () => {
    expect(isBotAuthor("dependabot[bot]")).toBe(true);
  });

  it("detects renovate as a bot author", () => {
    expect(isBotAuthor("renovate[bot]")).toBe(true);
  });

  it("detects github-actions as a bot author", () => {
    expect(isBotAuthor("github-actions[bot]")).toBe(true);
  });

  it("detects snyk-bot as a bot author", () => {
    expect(isBotAuthor("snyk-bot")).toBe(true);
  });

  it("detects build service accounts as bot authors", () => {
    expect(isBotAuthor("build-service@microsoft.visualstudio.com")).toBe(true);
  });

  it("does not flag regular users as bot authors", () => {
    expect(isBotAuthor("alice@example.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBotAuthor("Dependabot[bot]")).toBe(true);
  });

  it("detects custom bot users from botUsers set", () => {
    const botUsers = new Set(["custom-bot@example.com"]);
    expect(isBotAuthor("custom-bot@example.com", botUsers)).toBe(true);
  });

  it("does not flag regular users when botUsers is provided", () => {
    const botUsers = new Set(["custom-bot@example.com"]);
    expect(isBotAuthor("alice@example.com", botUsers)).toBe(false);
  });

  it("is case-insensitive for custom bot users", () => {
    const botUsers = new Set(["custom-bot@example.com"]);
    expect(isBotAuthor("Custom-Bot@Example.com", botUsers)).toBe(true);
  });

  it("detects bot by display name", () => {
    const botUsers = new Set(["my ci bot"]);
    expect(isBotAuthor("service@example.com", botUsers, "My CI Bot")).toBe(true);
  });

  it("does not flag user when display name does not match", () => {
    const botUsers = new Set(["my ci bot"]);
    expect(isBotAuthor("alice@example.com", botUsers, "Alice Smith")).toBe(false);
  });
});

describe("action field", () => {
  it("sets action to REVIEW for human-authored PRs needing review", () => {
    const pr = makePr();
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].action).toBe("REVIEW");
  });

  it("sets action to PENDING for human-authored PRs waiting on author", () => {
    const pr = makePr({
      threads: [{
        id: 1, publishedDate: new Date("2025-01-02"),
        comments: [{ authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-03") }],
      }],
    });
    const { waitingOnAuthor } = analyzePrs([pr]);
    expect(waitingOnAuthor[0].action).toBe("PENDING");
  });

  it("sets action to APPROVE for human-authored approved PRs", () => {
    const pr = makePr({
      reviewers: [{ displayName: "Bob", uniqueName: "bob@example.com", vote: 10 }],
    });
    const { approved } = analyzePrs([pr]);
    expect(approved[0].action).toBe("APPROVE");
  });

  it("sets action to APPROVE for bot-authored PRs needing review", () => {
    const pr = makePr({ authorUniqueName: "dependabot[bot]" });
    const { needingReview } = analyzePrs([pr]);
    expect(needingReview[0].action).toBe("APPROVE");
  });

  it("sets action to APPROVE for bot-authored PRs waiting on author", () => {
    const pr = makePr({
      authorUniqueName: "renovate[bot]",
      threads: [{
        id: 1, publishedDate: new Date("2025-01-02"),
        comments: [{ authorUniqueName: "bob@example.com", publishedDate: new Date("2025-01-03") }],
      }],
    });
    const { waitingOnAuthor } = analyzePrs([pr]);
    expect(waitingOnAuthor[0].action).toBe("APPROVE");
  });

  it("sets action to APPROVE for custom bot user PRs needing review", () => {
    const pr = makePr({ authorUniqueName: "custom-bot@example.com" });
    const botUsers = new Set(["custom-bot@example.com"]);
    const { needingReview } = analyzePrs([pr], new Set(), undefined, new Set(), botUsers);
    expect(needingReview[0].action).toBe("APPROVE");
  });

  it("ignores custom bot user activity in thread comments", () => {
    const pr = makePr({
      threads: [
        {
          id: 1,
          publishedDate: new Date("2025-01-05"),
          comments: [
            {
              authorUniqueName: "alice@example.com",
              publishedDate: new Date("2025-01-02"),
            },
            {
              authorUniqueName: "custom-bot@example.com",
              publishedDate: new Date("2025-01-05"),
            },
          ],
        },
      ],
    });
    const botUsers = new Set(["custom-bot@example.com"]);
    const { needingReview } = analyzePrs([pr], new Set(), undefined, new Set(), botUsers);
    expect(needingReview).toHaveLength(1);
  });
});
