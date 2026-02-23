import { describe, it, expect, vi } from "vitest";
import { buildJsonReport, writeJsonOutput, sendWebhookPayload } from "./api-output.js";
import type { JsonRepoReport, WebhookConfig } from "../types.js";

function makeRepoReport(overrides: Partial<JsonRepoReport> = {}): JsonRepoReport {
  return {
    repoLabel: "org/repo",
    analysis: {
      approved: [],
      needingReview: [],
      waitingOnAuthor: [],
    },
    stats: {
      repoLabel: "org/repo",
      approved: 0,
      needingReview: 0,
      waitingOnAuthor: 0,
      conflicts: 0,
      mergeRestarted: 0,
      mergeRestartFailed: 0,
    },
    ...overrides,
  };
}

describe("buildJsonReport", () => {
  it("should produce a valid report with version and timestamp", () => {
    const now = new Date("2025-06-15T12:00:00Z");
    const report = buildJsonReport([makeRepoReport()], "1.2.3", now);

    expect(report.version).toBe("1.2.3");
    expect(report.generatedAt).toBe("2025-06-15T12:00:00.000Z");
    expect(report.repositories).toHaveLength(1);
    expect(report.aggregate.totalPrs).toBe(0);
  });

  it("should aggregate total PR count across repos", () => {
    const repo1 = makeRepoReport({
      analysis: {
        approved: [{ id: 1 } as never],
        needingReview: [{ id: 2 } as never, { id: 3 } as never],
        waitingOnAuthor: [],
      },
    });
    const repo2 = makeRepoReport({
      repoLabel: "org/repo2",
      analysis: {
        approved: [],
        needingReview: [{ id: 4 } as never],
        waitingOnAuthor: [{ id: 5 } as never],
      },
    });
    const report = buildJsonReport([repo1, repo2], "1.0.0");
    expect(report.aggregate.totalPrs).toBe(5);
    expect(report.repositories).toHaveLength(2);
  });

  it("should merge staleness counts across repos", () => {
    const repo1 = makeRepoReport({ staleness: { "🔴 Stale": 3, "⚠️ Aging": 5 } });
    const repo2 = makeRepoReport({ staleness: { "🔴 Stale": 2, "💀 Abandoned": 1 } });
    const report = buildJsonReport([repo1, repo2], "1.0.0");
    expect(report.aggregate.staleness).toEqual({
      "🔴 Stale": 5,
      "⚠️ Aging": 5,
      "💀 Abandoned": 1,
    });
  });

  it("should handle repos with no metrics", () => {
    const report = buildJsonReport([makeRepoReport()], "1.0.0");
    expect(report.aggregate.metrics).toBeUndefined();
    expect(report.aggregate.staleness).toBeUndefined();
  });

  it("should aggregate metrics across repos", () => {
    const repo1 = makeRepoReport({
      metrics: {
        perPr: [],
        aggregate: {
          medianAgeInDays: 4,
          avgTimeToFirstReviewInDays: 2,
          avgReviewRounds: 1.5,
          prsWithNoReviewActivity: 3,
          totalPrs: 10,
        },
        perAuthor: [],
      },
    });
    const repo2 = makeRepoReport({
      metrics: {
        perPr: [],
        aggregate: {
          medianAgeInDays: 6,
          avgTimeToFirstReviewInDays: null,
          avgReviewRounds: 2.5,
          prsWithNoReviewActivity: 1,
          totalPrs: 5,
        },
        perAuthor: [],
      },
    });
    const report = buildJsonReport([repo1, repo2], "1.0.0");
    expect(report.aggregate.metrics).toBeDefined();
    expect(report.aggregate.metrics!.medianAgeInDays).toBe(5); // avg of 4 and 6
    expect(report.aggregate.metrics!.avgTimeToFirstReviewInDays).toBe(2); // only repo1 has value
    expect(report.aggregate.metrics!.prsWithNoReviewActivity).toBe(4);
    expect(report.aggregate.metrics!.totalPrs).toBe(15);
  });
});

describe("writeJsonOutput", () => {
  it("should write to stdout when destination is '-'", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const report = buildJsonReport([], "1.0.0", new Date("2025-01-01T00:00:00Z"));
    await writeJsonOutput(report, "-");
    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual(report);
    writeSpy.mockRestore();
  });
});

describe("sendWebhookPayload", () => {
  it("should POST to webhook URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const report = buildJsonReport([], "1.0.0");
    const config: WebhookConfig = { url: "https://example.com/webhook" };
    await sendWebhookPayload(report, config);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/webhook");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    vi.unstubAllGlobals();
  });

  it("should use PUT method when configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const report = buildJsonReport([], "1.0.0");
    const config: WebhookConfig = { url: "https://example.com/webhook", method: "PUT" };
    await sendWebhookPayload(report, config);

    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
    vi.unstubAllGlobals();
  });

  it("should include custom headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const report = buildJsonReport([], "1.0.0");
    const config: WebhookConfig = {
      url: "https://example.com/webhook",
      headers: { Authorization: "Bearer token123" },
    };
    await sendWebhookPayload(report, config);

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer token123");
    vi.unstubAllGlobals();
  });

  it("should handle non-2xx responses gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    vi.stubGlobal("fetch", mockFetch);

    const report = buildJsonReport([], "1.0.0");
    const config: WebhookConfig = { url: "https://example.com/webhook" };
    // Should not throw
    await expect(sendWebhookPayload(report, config)).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("should handle network errors gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const report = buildJsonReport([], "1.0.0");
    const config: WebhookConfig = { url: "https://example.com/webhook" };
    // Should not throw
    await expect(sendWebhookPayload(report, config)).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
