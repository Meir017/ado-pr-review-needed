import { describe, it, expect, vi } from "vitest";
import { loadDoraHistory, saveDoraSnapshot, computeDoraTrend } from "./history-store.js";
import type { DoraMetrics, DoraHistoryEntry } from "../types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

function makeMetrics(): DoraMetrics {
  return {
    period: { start: new Date("2025-01-01"), end: new Date("2025-01-31") },
    changeLeadTime: { value: 2.5, medianDays: 2.5, rating: "high" },
    deploymentFrequency: { value: 5, perWeek: 5, rating: "elite" },
    changeFailureRate: { value: 8, percentage: 8, rating: "high" },
    meanTimeToRestore: { value: 3, medianHours: 3, rating: "high" },
  };
}

describe("loadDoraHistory", () => {
  it("should return empty array when file doesn't exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadDoraHistory("dora.json")).toEqual([]);
  });

  it("should parse valid history file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const entries: DoraHistoryEntry[] = [{
      period: { start: "2025-01-01", end: "2025-01-31" },
      changeLeadTimeDays: 2.5,
      deploymentFrequencyPerWeek: 5,
      changeFailureRatePercent: 8,
      meanTimeToRestoreHours: 3,
    }];
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(entries));
    expect(loadDoraHistory("dora.json")).toHaveLength(1);
  });

  it("should handle corrupt file gracefully", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not json");
    expect(loadDoraHistory("dora.json")).toEqual([]);
  });
});

describe("saveDoraSnapshot", () => {
  it("should write snapshot to file", () => {
    saveDoraSnapshot("dora.json", makeMetrics(), []);
    expect(writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].changeLeadTimeDays).toBe(2.5);
  });

  it("should cap history at 52 entries", () => {
    vi.mocked(writeFileSync).mockClear();
    const existing = Array.from({ length: 52 }, (): DoraHistoryEntry => ({
      period: { start: "2025-01-01", end: "2025-01-31" },
      changeLeadTimeDays: 1,
      deploymentFrequencyPerWeek: 1,
      changeFailureRatePercent: 1,
      meanTimeToRestoreHours: 1,
    }));
    saveDoraSnapshot("dora.json", makeMetrics(), existing);
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(52);
  });
});

describe("computeDoraTrend", () => {
  it("should return null deltas when no history", () => {
    const trend = computeDoraTrend(makeMetrics(), []);
    expect(trend.deltas.changeLeadTime).toBeNull();
    expect(trend.deltas.deploymentFrequency).toBeNull();
  });

  it("should compute deltas from previous entry", () => {
    const previous: DoraHistoryEntry = {
      period: { start: "2024-12-01", end: "2024-12-31" },
      changeLeadTimeDays: 3,
      deploymentFrequencyPerWeek: 4,
      changeFailureRatePercent: 10,
      meanTimeToRestoreHours: 5,
    };
    const trend = computeDoraTrend(makeMetrics(), [previous]);
    expect(trend.deltas.changeLeadTime).toBe(-0.5); // 2.5 - 3
    expect(trend.deltas.deploymentFrequency).toBe(1); // 5 - 4
    expect(trend.deltas.changeFailureRate).toBe(-2); // 8 - 10
    expect(trend.deltas.meanTimeToRestore).toBe(-2); // 3 - 5
  });
});
