import { describe, it, expect } from "vitest";
import { computeStalenessBadge } from "./staleness.js";
import type { StalenessThreshold } from "../types.js";

const DEFAULT_THRESHOLDS: StalenessThreshold[] = [
  { label: "💀 Abandoned", minDays: 30 },
  { label: "🔴 Stale", minDays: 14 },
  { label: "⚠️ Aging", minDays: 7 },
];

function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("computeStalenessBadge", () => {
  const now = new Date("2026-02-22T12:00:00Z");

  it("returns null for fresh PRs (< 7 days)", () => {
    expect(computeStalenessBadge(daysAgo(0, now), DEFAULT_THRESHOLDS, now)).toBeNull();
    expect(computeStalenessBadge(daysAgo(3, now), DEFAULT_THRESHOLDS, now)).toBeNull();
    expect(computeStalenessBadge(daysAgo(6, now), DEFAULT_THRESHOLDS, now)).toBeNull();
  });

  it("returns '⚠️ Aging' at exactly 7 days", () => {
    expect(computeStalenessBadge(daysAgo(7, now), DEFAULT_THRESHOLDS, now)).toBe("⚠️ Aging");
  });

  it("returns '⚠️ Aging' between 7 and 13 days", () => {
    expect(computeStalenessBadge(daysAgo(10, now), DEFAULT_THRESHOLDS, now)).toBe("⚠️ Aging");
    expect(computeStalenessBadge(daysAgo(13, now), DEFAULT_THRESHOLDS, now)).toBe("⚠️ Aging");
  });

  it("returns '🔴 Stale' at exactly 14 days", () => {
    expect(computeStalenessBadge(daysAgo(14, now), DEFAULT_THRESHOLDS, now)).toBe("🔴 Stale");
  });

  it("returns '🔴 Stale' between 14 and 29 days", () => {
    expect(computeStalenessBadge(daysAgo(20, now), DEFAULT_THRESHOLDS, now)).toBe("🔴 Stale");
    expect(computeStalenessBadge(daysAgo(29, now), DEFAULT_THRESHOLDS, now)).toBe("🔴 Stale");
  });

  it("returns '💀 Abandoned' at exactly 30 days", () => {
    expect(computeStalenessBadge(daysAgo(30, now), DEFAULT_THRESHOLDS, now)).toBe("💀 Abandoned");
  });

  it("returns '💀 Abandoned' for very old PRs", () => {
    expect(computeStalenessBadge(daysAgo(1984, now), DEFAULT_THRESHOLDS, now)).toBe("💀 Abandoned");
  });

  it("returns null when thresholds array is empty", () => {
    expect(computeStalenessBadge(daysAgo(100, now), [], now)).toBeNull();
  });

  it("works with a single threshold", () => {
    const single: StalenessThreshold[] = [{ label: "Old", minDays: 5 }];
    expect(computeStalenessBadge(daysAgo(4, now), single, now)).toBeNull();
    expect(computeStalenessBadge(daysAgo(5, now), single, now)).toBe("Old");
    expect(computeStalenessBadge(daysAgo(100, now), single, now)).toBe("Old");
  });

  it("works with custom thresholds", () => {
    const custom: StalenessThreshold[] = [
      { label: "🔥 Critical", minDays: 60 },
      { label: "⏰ Overdue", minDays: 3 },
    ];
    expect(computeStalenessBadge(daysAgo(2, now), custom, now)).toBeNull();
    expect(computeStalenessBadge(daysAgo(3, now), custom, now)).toBe("⏰ Overdue");
    expect(computeStalenessBadge(daysAgo(59, now), custom, now)).toBe("⏰ Overdue");
    expect(computeStalenessBadge(daysAgo(60, now), custom, now)).toBe("🔥 Critical");
  });
});
