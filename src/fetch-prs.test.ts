import { describe, it, expect, vi } from "vitest";
import { mapBuildResult, fetchPipelineStatus } from "./fetch-prs.js";
import { BuildResult, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import type { IBuildApi } from "azure-devops-node-api/BuildApi.js";

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
