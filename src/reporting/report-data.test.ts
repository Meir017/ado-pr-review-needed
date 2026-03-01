import { describe, it, expect } from "vitest";
import { formatPipelineBadge } from "./report-data.js";
import type { PipelineStatus } from "../types.js";

function makeStatus(overrides: Partial<PipelineStatus> = {}): PipelineStatus {
  return {
    total: 0,
    succeeded: 0,
    failed: 0,
    inProgress: 0,
    other: 0,
    runs: [],
    ...overrides,
  };
}

describe("formatPipelineBadge", () => {
  it("returns empty string for undefined", () => {
    expect(formatPipelineBadge(undefined)).toBe("");
  });

  it("shows green passed when all succeeded", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 3, succeeded: 3 }));
    expect(badge).toContain("🟢");
    expect(badge).toContain("3/3 passed");
  });

  it("shows red failed when any failed", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 3, succeeded: 1, failed: 2 }));
    expect(badge).toContain("🔴");
    expect(badge).toContain("2/3 failed");
  });

  it("prioritizes failed over inProgress", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 3, succeeded: 0, failed: 1, inProgress: 2 }));
    expect(badge).toContain("🔴");
    expect(badge).toContain("1/3 failed");
  });

  it("shows yellow running when in progress and no failures", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 2, succeeded: 1, inProgress: 1 }));
    expect(badge).toContain("🟡");
    expect(badge).toContain("1/2 running");
  });

  it("shows fallback for other/unknown states", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 2, other: 2 }));
    expect(badge).toContain("2 pipeline(s)");
  });

  it("shows green for single passing pipeline", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 1, succeeded: 1 }));
    expect(badge).toContain("🟢");
    expect(badge).toContain("1/1 passed");
  });

  it("shows red for single failing pipeline", () => {
    const badge = formatPipelineBadge(makeStatus({ total: 1, failed: 1 }));
    expect(badge).toContain("🔴");
    expect(badge).toContain("1/1 failed");
  });
});
