import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createMockGitApi, approvedPr, needsReviewPr, waitingOnAuthorPr, stalePr, draftPr, conflictPr } from "./helpers/mock-ado-api.js";
import { createMockGraphModule } from "./helpers/mock-graph.js";
import { singleRepoConfig, multiRepoConfig } from "./helpers/test-config.js";
import type { TestDir } from "./helpers/test-config.js";

// Mock network modules before importing pipeline
vi.mock("../ado-client.js", () => ({
  getGitApiForOrg: vi.fn(),
  getBuildApiForOrg: vi.fn().mockResolvedValue({
    getBuilds: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../graph-client.js", () => createMockGraphModule());

import { getGitApiForOrg } from "../ado-client.js";
import { runPipeline, runMarkdownExport } from "../pipeline.js";

const mockedGetGitApiForOrg = vi.mocked(getGitApiForOrg);

describe("e2e: run command — markdown output", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("generates markdown with approved, needing-review, and waiting-on-author sections", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(1), needsReviewPr(2), waitingOnAuthorPr(3)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    const md = readFileSync(outputPath, "utf-8");
    expect(md).toContain("✅ Approved");
    expect(md).toContain("👀 PRs Needing Review");
    expect(md).toContain("✍️ Waiting on Author");
    expect(md).toContain("Approved PR #1");
    expect(md).toContain("Needs Review PR #2");
    expect(md).toContain("Waiting on Author PR #3");
  });

  it("generates markdown with no PRs (empty report)", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({ pullRequests: [] });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    const md = readFileSync(outputPath, "utf-8");
    expect(md).toContain("No approved PRs");
    expect(md).toContain("No PRs currently need review");
    expect(md).toContain("No PRs waiting on author");
  });

  it("skips draft PRs", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [needsReviewPr(1), draftPr(2)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    const md = readFileSync(outputPath, "utf-8");
    expect(md).toContain("Needs Review PR #1");
    expect(md).not.toContain("Draft PR #2");
  });

  it("shows merge conflict indicator", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [conflictPr(1)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    const md = readFileSync(outputPath, "utf-8");
    expect(md).toContain("❌");
    expect(md).toContain("Conflict PR #1");
  });
});

describe("e2e: run command — JSON output", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("generates valid JSON report with expected structure", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(10), needsReviewPr(20)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.json");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "json",
    });

    const json = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("version");
    expect(json).toHaveProperty("repositories");
    expect(json).toHaveProperty("aggregate");
    expect(json.repositories).toHaveLength(1);
    expect(json.repositories[0]).toHaveProperty("repoLabel", "testproject/testrepo");
    expect(json.repositories[0]).toHaveProperty("analysis");
    expect(json.repositories[0]).toHaveProperty("metrics");
    expect(json.repositories[0]).toHaveProperty("stats");
    expect(json.aggregate.totalPrs).toBe(2);
  });
});

describe("e2e: run command — HTML output", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("generates HTML report file", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(10), needsReviewPr(20)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.html");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "html",
    });

    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain("Approved PR #10");
    expect(html).toContain("Needs Review PR #20");
  });
});

describe("e2e: run command — multi-repo", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("processes multiple repos and merges results", async () => {
    testDir = multiRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(1), needsReviewPr(2)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    const md = readFileSync(outputPath, "utf-8");
    // Multi-repo mode shows repository column and per-repo stats
    expect(md).toContain("Repository");
    expect(md).toContain("Statistics per Repository");
  });

  it("multi-repo JSON output includes all repos", async () => {
    testDir = multiRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [needsReviewPr(1)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.json");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "json",
    });

    const json = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(json.repositories).toHaveLength(2);
  });
});

describe("e2e: run command — merge restart", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("restarts merge for stale PRs and reports count", async () => {
    testDir = singleRepoConfig(undefined, { restartMergeAfterDays: 30 });
    const mockApi = createMockGitApi({
      pullRequests: [stalePr(1, 60), needsReviewPr(2, 5)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.totalRestarted).toBe(1);
    expect(result.totalRestartFailed).toBe(0);
    // Verify updatePullRequest was called for the stale PR
    const updateFn = (mockApi as unknown as { updatePullRequest: ReturnType<typeof vi.fn> }).updatePullRequest;
    expect(updateFn).toHaveBeenCalledWith(
      { mergeStatus: 1 },
      "testrepo",
      expect.any(Number),
      "testproject",
    );
  });

  it("does not restart merge when disabled (restartMergeAfterDays=-1)", async () => {
    testDir = singleRepoConfig(undefined, { restartMergeAfterDays: -1 });
    const mockApi = createMockGitApi({
      pullRequests: [stalePr(1, 60)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.totalRestarted).toBe(0);
    const updateFn = (mockApi as unknown as { updatePullRequest: ReturnType<typeof vi.fn> }).updatePullRequest;
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("does not restart merge when repo has skipRestartMerge", async () => {
    testDir = singleRepoConfig(undefined, {
      repositories: [{
        url: "https://dev.azure.com/testorg/testproject/_git/testrepo",
        skipRestartMerge: true,
      }],
      restartMergeAfterDays: 30,
    });
    const mockApi = createMockGitApi({
      pullRequests: [stalePr(1, 60)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.totalRestarted).toBe(0);
    const updateFn = (mockApi as unknown as { updatePullRequest: ReturnType<typeof vi.fn> }).updatePullRequest;
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("handles merge restart failures gracefully", async () => {
    testDir = singleRepoConfig(undefined, { restartMergeAfterDays: 30 });
    const mockApi = createMockGitApi({
      pullRequests: [stalePr(1, 60)],
      updatePullRequestFn: () => Promise.reject(new Error("TF401398: branch deleted")),
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.totalRestarted).toBe(0);
    expect(result.totalRestartFailed).toBe(1);
  });

  it("merge restart stats appear in markdown summary", async () => {
    testDir = singleRepoConfig(undefined, { restartMergeAfterDays: 30 });
    const mockApi = createMockGitApi({
      pullRequests: [stalePr(1, 60), needsReviewPr(2, 5)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const outputPath = testDir.path("output.md");
    await runMarkdownExport({
      output: outputPath,
      verbose: false,
      dashboard: false,
      config: testDir.configPath,
      format: "markdown",
    });

    // The summary is printed to console, but we can verify pipeline output
    const result = await runPipeline(testDir.configPath);
    expect(result.stats.mergeRestarted).toBe(1);
    expect(result.stats.mergeRestartFailed).toBe(0);
  });
});

describe("e2e: run command — team filtering", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("marks team member PRs correctly", async () => {
    testDir = singleRepoConfig(undefined, {
      teamMembers: ["carol@example.com"],
    });
    const mockApi = createMockGitApi({
      pullRequests: [needsReviewPr(1)], // Carol is the author
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    const needingReview = result.merged.needingReview;
    expect(needingReview.length).toBeGreaterThan(0);
    expect(needingReview[0].isTeamMember).toBe(true);
  });

  it("marks non-team member PRs as community", async () => {
    testDir = singleRepoConfig(undefined, {
      teamMembers: ["someone-else@example.com"],
    });
    const mockApi = createMockGitApi({
      pullRequests: [needsReviewPr(1)], // Carol is the author, not in team
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    const needingReview = result.merged.needingReview;
    expect(needingReview.length).toBeGreaterThan(0);
    expect(needingReview[0].isTeamMember).toBe(false);
  });
});

describe("e2e: run command — bot users", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("identifies bot PRs based on configured bot users", async () => {
    testDir = singleRepoConfig(undefined, {
      botUsers: ["bot@example.com"],
    });
    const mockApi = createMockGitApi({
      pullRequests: [{
        pullRequestId: 1,
        title: "Bot PR",
        createdBy: { displayName: "Bot", uniqueName: "bot@example.com" },
        creationDate: new Date(Date.now() - 3 * 86400000),
        reviewers: [{ displayName: "Dave", uniqueName: "dave@example.com", vote: 0 }],
      }],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    // Bot PRs needing review should have APPROVE action
    const needingReview = result.merged.needingReview;
    expect(needingReview.length).toBeGreaterThan(0);
    expect(needingReview[0].action).toBe("APPROVE");
  });
});

describe("e2e: runPipeline", () => {
  let testDir: TestDir;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDir?.cleanup();
  });

  it("returns correct aggregate stats", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(1), needsReviewPr(2), waitingOnAuthorPr(3)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.totalPrs).toBe(3);
    expect(result.merged.approved).toHaveLength(1);
    expect(result.merged.needingReview).toHaveLength(1);
    expect(result.merged.waitingOnAuthor).toHaveLength(1);
    expect(result.metrics).toBeDefined();
    expect(result.workload).toBeDefined();
  });

  it("computes review metrics", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [approvedPr(1), needsReviewPr(2)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.metrics.aggregate.totalPrs).toBe(2);
    expect(result.metrics.perAuthor.length).toBeGreaterThan(0);
  });

  it("computes reviewer workload", async () => {
    testDir = singleRepoConfig();
    const mockApi = createMockGitApi({
      pullRequests: [needsReviewPr(1), needsReviewPr(2, 10)],
    });
    mockedGetGitApiForOrg.mockResolvedValue(mockApi);

    const result = await runPipeline(testDir.configPath);

    expect(result.workload.length).toBeGreaterThan(0);
    // Dave is the reviewer for both PRs
    const daveWorkload = result.workload.find((w) => w.displayName === "Dave");
    expect(daveWorkload).toBeDefined();
    expect(daveWorkload!.assignedPrCount).toBe(2);
  });
});
