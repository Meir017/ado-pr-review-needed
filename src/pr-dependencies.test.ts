import { describe, it, expect } from "vitest";
import {
  detectBranchDeps,
  detectMentionDeps,
  detectFileOverlap,
  detectDependencies,
  buildDependencyGraph,
  DEFAULT_DEPENDENCY_CONFIG,
} from "./pr-dependencies.js";
import type { PullRequestInfo, AnalysisResult, DependencyConfig } from "./types.js";

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: "Test PR",
    author: "Alice",
    authorUniqueName: "alice@example.com",
    url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/1",
    createdDate: new Date("2025-01-01"),
    reviewers: [],
    threads: [],
    labels: [],
    detectedLabels: [],
    mergeStatus: 0,
    lastSourcePushDate: undefined,
    ...overrides,
  };
}

describe("detectBranchDeps", () => {
  it("should detect when PR targets another PR's source branch", () => {
    const pr1 = makePr({ id: 101, sourceBranch: "refs/heads/feature/base" });
    const pr2 = makePr({ id: 102, targetBranch: "refs/heads/feature/base" });
    const deps = detectBranchDeps([pr1, pr2]);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ fromPrId: 102, toPrId: 101, reason: "branch" });
  });

  it("should not detect self-dependency", () => {
    const pr = makePr({ id: 101, sourceBranch: "refs/heads/feature/x", targetBranch: "refs/heads/feature/x" });
    const deps = detectBranchDeps([pr]);
    expect(deps).toHaveLength(0);
  });

  it("should return empty when no branch overlaps", () => {
    const pr1 = makePr({ id: 101, sourceBranch: "refs/heads/a", targetBranch: "refs/heads/main" });
    const pr2 = makePr({ id: 102, sourceBranch: "refs/heads/b", targetBranch: "refs/heads/main" });
    const deps = detectBranchDeps([pr1, pr2]);
    expect(deps).toHaveLength(0);
  });
});

describe("detectMentionDeps", () => {
  it("should detect 'depends on #123' in title", () => {
    const pr1 = makePr({ id: 200 });
    const pr2 = makePr({ id: 201, title: "Feature X - depends on #200" });
    const deps = detectMentionDeps([pr1, pr2], "depends on.*#(\\d+)");
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ fromPrId: 201, toPrId: 200, reason: "mention" });
  });

  it("should detect mentions in description", () => {
    const pr1 = makePr({ id: 300 });
    const pr2 = makePr({ id: 301, description: "This PR depends on #300 for the base types." });
    const deps = detectMentionDeps([pr1, pr2], "depends on.*#(\\d+)");
    expect(deps).toHaveLength(1);
  });

  it("should ignore mentions of non-existent PRs", () => {
    const pr1 = makePr({ id: 400, title: "depends on #999" });
    const deps = detectMentionDeps([pr1], "depends on.*#(\\d+)");
    expect(deps).toHaveLength(0);
  });

  it("should not create self-dependency", () => {
    const pr1 = makePr({ id: 500, title: "depends on #500" });
    const deps = detectMentionDeps([pr1], "depends on.*#(\\d+)");
    expect(deps).toHaveLength(0);
  });
});

describe("detectFileOverlap", () => {
  it("should detect file overlap above threshold", () => {
    const pr1 = { ...makePr({ id: 1 }), changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] } as PullRequestInfo & { changedFiles: string[] };
    const pr2 = { ...makePr({ id: 2 }), changedFiles: ["src/b.ts", "src/c.ts", "src/d.ts"] } as PullRequestInfo & { changedFiles: string[] };
    const deps = detectFileOverlap([pr1, pr2] as PullRequestInfo[], 2);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ fromPrId: 1, toPrId: 2, reason: "fileOverlap" });
  });

  it("should not detect file overlap below threshold", () => {
    const pr1 = { ...makePr({ id: 1 }), changedFiles: ["src/a.ts"] } as PullRequestInfo & { changedFiles: string[] };
    const pr2 = { ...makePr({ id: 2 }), changedFiles: ["src/a.ts"] } as PullRequestInfo & { changedFiles: string[] };
    const deps = detectFileOverlap([pr1, pr2] as PullRequestInfo[], 2);
    expect(deps).toHaveLength(0);
  });
});

describe("detectDependencies", () => {
  it("should run only enabled strategies", () => {
    const pr1 = makePr({ id: 101, sourceBranch: "refs/heads/feature/base" });
    const pr2 = makePr({ id: 102, targetBranch: "refs/heads/feature/base", title: "depends on #101" });
    const config: DependencyConfig = {
      ...DEFAULT_DEPENDENCY_CONFIG,
      enabled: true,
      strategies: ["branch"],
    };
    const deps = detectDependencies([pr1, pr2], config);
    // Should only have branch dep, not mention
    expect(deps).toHaveLength(1);
    expect(deps[0].reason).toBe("branch");
  });

  it("should deduplicate dependencies", () => {
    const pr1 = makePr({ id: 101, sourceBranch: "refs/heads/feature/base" });
    const pr2 = makePr({ id: 102, targetBranch: "refs/heads/feature/base" });
    // Run branch strategy twice by putting it in strategies array twice conceptually;
    // but detectDependencies deduplicates by key
    const config: DependencyConfig = {
      ...DEFAULT_DEPENDENCY_CONFIG,
      enabled: true,
      strategies: ["branch", "mention"],
    };
    const deps = detectDependencies([pr1, pr2], config);
    expect(deps).toHaveLength(1);
  });
});

describe("buildDependencyGraph", () => {
  const emptyAnalysis: AnalysisResult = { approved: [], needingReview: [], waitingOnAuthor: [] };

  it("should return empty graph when no dependencies", () => {
    const graph = buildDependencyGraph([], [], emptyAnalysis);
    expect(graph.dependencies).toHaveLength(0);
    expect(graph.chains).toHaveLength(0);
    expect(graph.blockedPrIds).toHaveLength(0);
  });

  it("should create a chain from dependencies", () => {
    const deps = [
      { fromPrId: 102, toPrId: 101, reason: "branch" as const, details: "test" },
    ];
    const prs = [makePr({ id: 101 }), makePr({ id: 102 })];
    const graph = buildDependencyGraph(deps, prs, emptyAnalysis);
    expect(graph.chains).toHaveLength(1);
    expect(graph.chains[0].prIds).toContain(101);
    expect(graph.chains[0].prIds).toContain(102);
  });

  it("should mark chain as blocked when upstream is not approved", () => {
    const deps = [
      { fromPrId: 102, toPrId: 101, reason: "branch" as const, details: "test" },
    ];
    const analysis: AnalysisResult = {
      approved: [],
      needingReview: [{ id: 101 } as never],
      waitingOnAuthor: [],
    };
    const graph = buildDependencyGraph(deps, [], analysis);
    expect(graph.chains[0].status).toBe("blocked");
    expect(graph.blockedPrIds).toContain(102);
  });

  it("should mark chain as ready when upstream is approved", () => {
    const deps = [
      { fromPrId: 102, toPrId: 101, reason: "branch" as const, details: "test" },
    ];
    const analysis: AnalysisResult = {
      approved: [{ id: 101 } as never],
      needingReview: [],
      waitingOnAuthor: [],
    };
    const graph = buildDependencyGraph(deps, [], analysis);
    expect(graph.chains[0].status).toBe("ready");
    expect(graph.blockedPrIds).toHaveLength(0);
  });

  it("should handle multiple independent chains", () => {
    const deps = [
      { fromPrId: 2, toPrId: 1, reason: "branch" as const, details: "test" },
      { fromPrId: 4, toPrId: 3, reason: "mention" as const, details: "test" },
    ];
    const graph = buildDependencyGraph(deps, [], emptyAnalysis);
    expect(graph.chains).toHaveLength(2);
  });
});
