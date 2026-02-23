import { describe, it, expect } from "vitest";
import {
  computeChangeLeadTime,
  computeDeploymentFrequency,
  computeChangeFailureRate,
  computeMeanTimeToRestore,
  computeDoraMetrics,
} from "./compute-dora.js";
import type { BuildInfo } from "../types.js";
import type { MergedPrInfo } from "./compute-dora.js";

function makeBuild(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    id: 1,
    definitionName: "CI",
    startTime: new Date("2025-01-01T10:00:00Z"),
    finishTime: new Date("2025-01-01T10:30:00Z"),
    result: "succeeded",
    sourceBranch: "refs/heads/main",
    sourceVersion: "abc123",
    ...overrides,
  };
}

describe("computeChangeLeadTime", () => {
  it("should return 0 for empty PRs", () => {
    const result = computeChangeLeadTime([]);
    expect(result.medianDays).toBe(0);
    expect(result.rating).toBe("low");
  });

  it("should compute median lead time", () => {
    const prs: MergedPrInfo[] = [
      { createdDate: new Date("2025-01-01"), mergedDate: new Date("2025-01-02") }, // 1 day
      { createdDate: new Date("2025-01-01"), mergedDate: new Date("2025-01-04") }, // 3 days
      { createdDate: new Date("2025-01-01"), mergedDate: new Date("2025-01-08") }, // 7 days
    ];
    const result = computeChangeLeadTime(prs);
    expect(result.medianDays).toBe(3);
    expect(result.rating).toBe("high");
  });

  it("should rate elite for sub-day lead time", () => {
    const prs: MergedPrInfo[] = [
      { createdDate: new Date("2025-01-01T00:00:00Z"), mergedDate: new Date("2025-01-01T12:00:00Z") }, // 0.5 days
    ];
    const result = computeChangeLeadTime(prs);
    expect(result.rating).toBe("elite");
  });
});

describe("computeDeploymentFrequency", () => {
  it("should compute deploys per week", () => {
    const builds = Array.from({ length: 21 }, (_, i) =>
      makeBuild({ id: i, result: "succeeded" }),
    );
    const result = computeDeploymentFrequency(builds, 21); // 3 weeks
    expect(result.perWeek).toBe(7);
    expect(result.rating).toBe("elite");
  });

  it("should only count successful builds", () => {
    const builds = [
      makeBuild({ result: "succeeded" }),
      makeBuild({ result: "failed" }),
      makeBuild({ result: "succeeded" }),
    ];
    const result = computeDeploymentFrequency(builds, 7);
    expect(result.perWeek).toBe(2);
  });

  it("should handle zero period", () => {
    const result = computeDeploymentFrequency([], 0);
    expect(result.perWeek).toBe(0);
    expect(result.rating).toBe("low");
  });
});

describe("computeChangeFailureRate", () => {
  it("should return 0 for empty builds", () => {
    const result = computeChangeFailureRate([]);
    expect(result.percentage).toBe(0);
    expect(result.rating).toBe("elite");
  });

  it("should compute failure percentage", () => {
    const builds = [
      makeBuild({ result: "succeeded" }),
      makeBuild({ result: "failed" }),
      makeBuild({ result: "succeeded" }),
      makeBuild({ result: "succeeded" }),
    ];
    const result = computeChangeFailureRate(builds);
    expect(result.percentage).toBe(25);
    expect(result.rating).toBe("low");
  });

  it("should rate elite for low failure rate", () => {
    const builds = Array.from({ length: 20 }, () => makeBuild({ result: "succeeded" }));
    builds.push(makeBuild({ result: "failed" }));
    const result = computeChangeFailureRate(builds);
    expect(result.percentage).toBeCloseTo(4.8, 0);
    expect(result.rating).toBe("elite");
  });
});

describe("computeMeanTimeToRestore", () => {
  it("should return 0 for empty builds", () => {
    const result = computeMeanTimeToRestore([]);
    expect(result.medianHours).toBe(0);
  });

  it("should compute MTTR from failure-recovery pairs", () => {
    const builds = [
      makeBuild({ id: 1, finishTime: new Date("2025-01-01T10:00:00Z"), result: "failed" }),
      makeBuild({ id: 2, finishTime: new Date("2025-01-01T14:00:00Z"), result: "succeeded" }), // 4h restore
    ];
    const result = computeMeanTimeToRestore(builds);
    expect(result.medianHours).toBe(4);
    expect(result.rating).toBe("high");
  });

  it("should handle no recovery after failure", () => {
    const builds = [
      makeBuild({ result: "failed" }),
    ];
    const result = computeMeanTimeToRestore(builds);
    expect(result.medianHours).toBe(0);
    expect(result.rating).toBe("elite");
  });
});

describe("computeDoraMetrics", () => {
  it("should compute all 4 metrics", () => {
    const prs: MergedPrInfo[] = [
      { createdDate: new Date("2025-01-01"), mergedDate: new Date("2025-01-03") },
    ];
    const builds = [
      makeBuild({ result: "succeeded" }),
    ];
    const result = computeDoraMetrics(prs, builds, 30, new Date("2025-02-01"));
    expect(result.period.start).toBeInstanceOf(Date);
    expect(result.period.end).toBeInstanceOf(Date);
    expect(result.changeLeadTime.medianDays).toBeGreaterThanOrEqual(0);
    expect(result.deploymentFrequency.perWeek).toBeGreaterThanOrEqual(0);
    expect(result.changeFailureRate.percentage).toBeGreaterThanOrEqual(0);
    expect(result.meanTimeToRestore.medianHours).toBeGreaterThanOrEqual(0);
  });
});
