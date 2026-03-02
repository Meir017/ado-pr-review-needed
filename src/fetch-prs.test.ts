import { describe, it, expect, vi } from "vitest";
import { mapBuildResult, fetchPipelineStatus, fetchPolicyEvaluations, enhancePolicyDisplayName } from "./fetch-prs.js";
import { BuildResult, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { PolicyEvaluationStatus } from "azure-devops-node-api/interfaces/PolicyInterfaces.js";
import type { IBuildApi } from "azure-devops-node-api/BuildApi.js";
import type { IPolicyApi } from "azure-devops-node-api/PolicyApi.js";

// Speed up retry delays for tests
vi.mock("./retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retry.js")>();
  return {
    ...actual,
    withRetry: <T>(label: string, fn: () => Promise<T>) =>
      actual.withRetry(label, fn, { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

describe("mapBuildResult", () => {
  it("maps InProgress status regardless of result", () => {
    expect(mapBuildResult(BuildStatus.InProgress, BuildResult.None)).toBe("inProgress");
    expect(mapBuildResult(BuildStatus.InProgress, BuildResult.Failed)).toBe("inProgress");
  });

  it("maps NotStarted status", () => {
    expect(mapBuildResult(BuildStatus.NotStarted, BuildResult.None)).toBe("notStarted");
  });

  it("maps Succeeded result when completed", () => {
    expect(mapBuildResult(BuildStatus.Completed, BuildResult.Succeeded)).toBe("succeeded");
  });

  it("maps Failed result when completed", () => {
    expect(mapBuildResult(BuildStatus.Completed, BuildResult.Failed)).toBe("failed");
  });

  it("maps PartiallySucceeded result", () => {
    expect(mapBuildResult(BuildStatus.Completed, BuildResult.PartiallySucceeded)).toBe("partiallySucceeded");
  });

  it("maps Canceled result", () => {
    expect(mapBuildResult(BuildStatus.Completed, BuildResult.Canceled)).toBe("canceled");
  });

  it("maps None/undefined to none", () => {
    expect(mapBuildResult(BuildStatus.Completed, BuildResult.None)).toBe("none");
    expect(mapBuildResult(undefined, undefined)).toBe("none");
  });
});

describe("fetchPipelineStatus", () => {
  function mockBuildApi(builds: unknown[]): IBuildApi {
    return {
      getBuilds: vi.fn().mockResolvedValue(builds),
    } as unknown as IBuildApi;
  }

  it("returns undefined when no builds exist", async () => {
    const api = mockBuildApi([]);
    const result = await fetchPipelineStatus(api, "guid-123", "project", 100);
    expect(result).toBeUndefined();
  });

  it("aggregates build results correctly", async () => {
    const api = mockBuildApi([
      { id: 1, definition: { id: 10, name: "CI" }, status: BuildStatus.Completed, result: BuildResult.Succeeded },
      { id: 2, definition: { id: 20, name: "Deploy" }, status: BuildStatus.Completed, result: BuildResult.Failed },
    ]);
    const result = await fetchPipelineStatus(api, "guid-123", "project", 100);
    expect(result).toBeDefined();
    expect(result!.total).toBe(2);
    expect(result!.succeeded).toBe(1);
    expect(result!.failed).toBe(1);
    expect(result!.inProgress).toBe(0);
    expect(result!.runs).toHaveLength(2);
  });

  it("de-duplicates to latest build per definition", async () => {
    const api = mockBuildApi([
      // Newer build (listed first) — should be kept
      { id: 3, definition: { id: 10, name: "CI" }, status: BuildStatus.Completed, result: BuildResult.Succeeded },
      // Older build (listed second) — should be skipped
      { id: 1, definition: { id: 10, name: "CI" }, status: BuildStatus.Completed, result: BuildResult.Failed },
    ]);
    const result = await fetchPipelineStatus(api, "guid-123", "project", 100);
    expect(result!.total).toBe(1);
    expect(result!.succeeded).toBe(1);
    expect(result!.failed).toBe(0);
    expect(result!.runs[0].id).toBe(3);
  });

  it("counts inProgress builds", async () => {
    const api = mockBuildApi([
      { id: 1, definition: { id: 10, name: "CI" }, status: BuildStatus.InProgress, result: BuildResult.None },
      { id: 2, definition: { id: 20, name: "Deploy" }, status: BuildStatus.Completed, result: BuildResult.Succeeded },
    ]);
    const result = await fetchPipelineStatus(api, "guid-123", "project", 100);
    expect(result!.inProgress).toBe(1);
    expect(result!.succeeded).toBe(1);
  });

  it("returns undefined on API error", async () => {
    const api = {
      getBuilds: vi.fn().mockRejectedValue(new Error("API error")),
    } as unknown as IBuildApi;
    const result = await fetchPipelineStatus(api, "guid-123", "project", 100);
    expect(result).toBeUndefined();
  });

  it("passes correct branch name to Build API", async () => {
    const getBuilds = vi.fn().mockResolvedValue([]);
    const api = { getBuilds } as unknown as IBuildApi;
    await fetchPipelineStatus(api, "repo-guid", "myproject", 42);
    // Verify the key positional args: project, top, branchName, repositoryId, repositoryType
    expect(getBuilds).toHaveBeenCalledOnce();
    const args = getBuilds.mock.calls[0];
    expect(args[0]).toBe("myproject");     // project
    expect(args[12]).toBe(10);             // top
    expect(args[17]).toBe("refs/pull/42/merge"); // branchName
    expect(args[19]).toBe("repo-guid");    // repositoryId
    expect(args[20]).toBe("TfsGit");       // repositoryType
  });

  it("populates run info with definition name and status", async () => {
    const api = mockBuildApi([
      { id: 5, definition: { id: 10, name: "Build & Test" }, status: BuildStatus.Completed, result: BuildResult.Failed },
    ]);
    const result = await fetchPipelineStatus(api, "guid", "proj", 1);
    expect(result!.runs[0]).toEqual({
      id: 5,
      name: "Build & Test",
      status: "Completed",
      result: "failed",
    });
  });
});

describe("enhancePolicyDisplayName", () => {
  const BUILD_TYPE = "0609b952-1397-4640-95ec-e00a01b2c241";
  const STATUS_TYPE = "cbdc66da-9728-4af8-aada-9a5a32e4a226";
  const MIN_REVIEWERS_TYPE = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd";

  it("returns base name when no typeId", () => {
    expect(enhancePolicyDisplayName(undefined, "Build", {})).toBe("Build");
  });

  it("returns base name when no settings", () => {
    expect(enhancePolicyDisplayName(BUILD_TYPE, "Build", undefined)).toBe("Build");
  });

  it("returns base name for unknown policy type", () => {
    expect(enhancePolicyDisplayName("unknown-guid", "Custom", { foo: "bar" })).toBe("Custom");
  });

  describe("Build policy", () => {
    it("uses settings.displayName when available", () => {
      expect(enhancePolicyDisplayName(BUILD_TYPE, "Build", { displayName: "My CI Pipeline" })).toBe("Build: My CI Pipeline");
    });

    it("falls back to buildDefinitionId", () => {
      expect(enhancePolicyDisplayName(BUILD_TYPE, "Build", { buildDefinitionId: 411250, displayName: null })).toBe("Build #411250");
    });

    it("returns base name when no displayName or buildDefinitionId", () => {
      expect(enhancePolicyDisplayName(BUILD_TYPE, "Build", { displayName: null })).toBe("Build");
    });
  });

  describe("Status policy", () => {
    it("uses defaultDisplayName when available", () => {
      expect(enhancePolicyDisplayName(STATUS_TYPE, "Status", { statusName: "review-checker", defaultDisplayName: "Copilot PR Review Check Policy" })).toBe("Copilot PR Review Check Policy");
    });

    it("uses statusName with genre", () => {
      expect(enhancePolicyDisplayName(STATUS_TYPE, "Status", { statusName: "ComponentGovernance", statusGenre: "cg" })).toBe("ComponentGovernance (cg)");
    });

    it("uses statusName without genre", () => {
      expect(enhancePolicyDisplayName(STATUS_TYPE, "Status", { statusName: "Ownership Enforcer" })).toBe("Ownership Enforcer");
    });

    it("returns base name when no statusName or defaultDisplayName", () => {
      expect(enhancePolicyDisplayName(STATUS_TYPE, "Status", {})).toBe("Status");
    });
  });

  describe("Minimum number of reviewers policy", () => {
    it("appends reviewer count", () => {
      expect(enhancePolicyDisplayName(MIN_REVIEWERS_TYPE, "Minimum number of reviewers", { minimumApproverCount: 2 })).toBe("Minimum number of reviewers (2)");
    });

    it("returns base name when no count", () => {
      expect(enhancePolicyDisplayName(MIN_REVIEWERS_TYPE, "Minimum number of reviewers", {})).toBe("Minimum number of reviewers");
    });
  });
});

describe("fetchPolicyEvaluations", () => {
  function mockPolicyApi(records: unknown[]): IPolicyApi {
    return {
      getPolicyEvaluations: vi.fn().mockResolvedValue(records),
    } as unknown as IPolicyApi;
  }

  it("returns undefined when no records exist", async () => {
    const api = mockPolicyApi([]);
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result).toBeUndefined();
  });

  it("aggregates policy evaluation results correctly", async () => {
    const api = mockPolicyApi([
      {
        evaluationId: "eval-1",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { displayName: "Build" }, isBlocking: true },
        completedDate: new Date("2025-01-15"),
      },
      {
        evaluationId: "eval-2",
        status: PolicyEvaluationStatus.Rejected,
        configuration: { type: { displayName: "Required reviewers" }, isBlocking: true },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result).toBeDefined();
    expect(result!.total).toBe(2);
    expect(result!.approved).toBe(1);
    expect(result!.rejected).toBe(1);
    expect(result!.running).toBe(0);
    expect(result!.evaluations).toHaveLength(2);
  });

  it("filters out notApplicable policies", async () => {
    const api = mockPolicyApi([
      {
        evaluationId: "eval-1",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { displayName: "Build" }, isBlocking: true },
      },
      {
        evaluationId: "eval-2",
        status: PolicyEvaluationStatus.NotApplicable,
        configuration: { type: { displayName: "Work items" }, isBlocking: false },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result!.total).toBe(1);
    expect(result!.evaluations).toHaveLength(1);
    expect(result!.evaluations[0].displayName).toBe("Build");
  });

  it("counts running and queued as running", async () => {
    const api = mockPolicyApi([
      {
        evaluationId: "eval-1",
        status: PolicyEvaluationStatus.Running,
        configuration: { type: { displayName: "Build" }, isBlocking: true },
      },
      {
        evaluationId: "eval-2",
        status: PolicyEvaluationStatus.Queued,
        configuration: { type: { displayName: "Check" }, isBlocking: false },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result!.running).toBe(2);
  });

  it("deduplicates Minimum number of reviewers, keeping only the first", async () => {
    const MIN_REVIEWERS_TYPE = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd";
    const api = mockPolicyApi([
      {
        evaluationId: "eval-min-1",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { id: MIN_REVIEWERS_TYPE, displayName: "Minimum number of reviewers" }, isBlocking: true, settings: { minimumApproverCount: 2 } },
      },
      {
        evaluationId: "eval-min-2",
        status: PolicyEvaluationStatus.Rejected,
        configuration: { type: { id: MIN_REVIEWERS_TYPE, displayName: "Minimum number of reviewers" }, isBlocking: true, settings: { minimumApproverCount: 4 } },
      },
      {
        evaluationId: "eval-build",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { displayName: "Build" }, isBlocking: true },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result!.total).toBe(2);
    expect(result!.evaluations).toHaveLength(2);
    expect(result!.evaluations[0].displayName).toBe("Minimum number of reviewers (2)");
    expect(result!.evaluations[1].displayName).toBe("Build");
  });

  it("returns undefined on API error", async () => {
    const api = {
      getPolicyEvaluations: vi.fn().mockRejectedValue(new Error("API error")),
    } as unknown as IPolicyApi;
    const result = await fetchPolicyEvaluations(api, "project", "project-guid", 100);
    expect(result).toBeUndefined();
  });

  it("populates evaluation info with displayName and isBlocking", async () => {
    const api = mockPolicyApi([
      {
        evaluationId: "eval-5",
        status: PolicyEvaluationStatus.Rejected,
        configuration: { type: { displayName: "Minimum reviewers" }, isBlocking: true },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "project", "proj-guid", 1);
    expect(result!.evaluations[0]).toEqual({
      evaluationId: "eval-5",
      displayName: "Minimum reviewers",
      status: "rejected",
      isBlocking: true,
      completedDate: undefined,
      buildUrl: undefined,
    });
  });

  it("builds correct artifact ID", async () => {
    const getPolicyEvaluations = vi.fn().mockResolvedValue([]);
    const api = { getPolicyEvaluations } as unknown as IPolicyApi;
    await fetchPolicyEvaluations(api, "myproject", "project-guid-123", 42);
    expect(getPolicyEvaluations).toHaveBeenCalledWith(
      "myproject",
      "vstfs:///CodeReview/CodeReviewId/project-guid-123/42",
    );
  });

  it("populates buildUrl for build policies when baseUrl and context.buildId are provided", async () => {
    const BUILD_TYPE = "0609b952-1397-4640-95ec-e00a01b2c241";
    const api = mockPolicyApi([
      {
        evaluationId: "eval-build",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { id: BUILD_TYPE, displayName: "Build" }, isBlocking: true, settings: { displayName: "My Pipeline" } },
        context: { buildId: 12345 },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "myproject", "proj-guid", 1, "https://dev.azure.com/myorg");
    expect(result!.evaluations[0].displayName).toBe("Build: My Pipeline");
    expect(result!.evaluations[0].buildUrl).toBe("https://dev.azure.com/myorg/myproject/_build/results?buildId=12345");
  });

  it("does not set buildUrl when baseUrl is not provided", async () => {
    const BUILD_TYPE = "0609b952-1397-4640-95ec-e00a01b2c241";
    const api = mockPolicyApi([
      {
        evaluationId: "eval-build",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { id: BUILD_TYPE, displayName: "Build" }, isBlocking: true, settings: { displayName: "My Pipeline" } },
        context: { buildId: 12345 },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "myproject", "proj-guid", 1);
    expect(result!.evaluations[0].buildUrl).toBeUndefined();
  });

  it("does not set buildUrl for non-build policies", async () => {
    const STATUS_TYPE = "cbdc66da-9728-4af8-aada-9a5a32e4a226";
    const api = mockPolicyApi([
      {
        evaluationId: "eval-status",
        status: PolicyEvaluationStatus.Approved,
        configuration: { type: { id: STATUS_TYPE, displayName: "Status" }, isBlocking: false, settings: { statusName: "MyCheck" } },
      },
    ]);
    const result = await fetchPolicyEvaluations(api, "myproject", "proj-guid", 1, "https://dev.azure.com/myorg");
    expect(result!.evaluations[0].buildUrl).toBeUndefined();
  });
});
