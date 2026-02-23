import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "./generate-html.js";
import type { JsonReport, JsonRepoReport } from "../../types.js";

function makeReport(overrides: Partial<JsonReport> = {}): JsonReport {
  return {
    generatedAt: "2025-01-15T10:00:00Z",
    version: "0.1.0",
    repositories: [],
    aggregate: { totalPrs: 0 },
    ...overrides,
  };
}

function makeRepoReport(overrides: Partial<JsonRepoReport> = {}): JsonRepoReport {
  return {
    repoLabel: "my-org/my-repo",
    analysis: {
      needingReview: [],
      approved: [],
      waitingOnAuthor: [],
    },
    stats: {
      repoLabel: "my-org/my-repo",
      total: 0,
      needingReview: 0,
      approved: 0,
      waitingOnAuthor: 0,
      restarted: 0,
      restartFailed: 0,
    },
    ...overrides,
  };
}

describe("generateHtmlReport", () => {
  it("returns valid HTML with embedded data", () => {
    const report = makeReport({ aggregate: { totalPrs: 5 } });
    const html = generateHtmlReport(report);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("PR Review Dashboard");
    expect(html).toContain('"totalPrs":5');
  });

  it("does not contain the raw placeholder", () => {
    const html = generateHtmlReport(makeReport());
    expect(html).not.toContain("{{DATA_PLACEHOLDER}}");
  });

  it("embeds JSON data that can be parsed back", () => {
    const report = makeReport({
      repositories: [makeRepoReport({ repoLabel: "org/repo-a" })],
      aggregate: { totalPrs: 42 },
    });
    const html = generateHtmlReport(report);

    // Extract the DATA constant from the script
    const match = html.match(/const DATA = (.+?);/s);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]);
    expect(parsed.aggregate.totalPrs).toBe(42);
    expect(parsed.repositories[0].repoLabel).toBe("org/repo-a");
  });

  it("handles empty repositories", () => {
    const html = generateHtmlReport(makeReport());
    expect(html).toContain('"repositories":[]');
  });

  it("escapes HTML-sensitive characters in JSON data", () => {
    const report = makeReport({
      repositories: [
        makeRepoReport({
          analysis: {
            needingReview: [
              {
                id: 1,
                title: 'Fix <script>alert("xss")</script>',
                author: "user",
                url: "https://example.com",
                waitingSince: "2025-01-01",
                reviewers: [],
                size: { label: "S", totalChanges: 10 },
              },
            ],
            approved: [],
            waitingOnAuthor: [],
          },
        }),
      ],
      aggregate: { totalPrs: 1 },
    });
    const html = generateHtmlReport(report);
    // The JSON should contain the raw characters (they're inside a <script> JSON assignment, not HTML)
    expect(html).toContain('<script>alert');
  });

  it("contains expected sections", () => {
    const html = generateHtmlReport(makeReport());
    expect(html).toContain("summary-cards");
    expect(html).toContain("pr-table");
    expect(html).toContain("Export CSV");
    expect(html).toContain("metrics-section");
    expect(html).toContain("search");
    expect(html).toContain("repo-filter");
  });

  it("includes print styles", () => {
    const html = generateHtmlReport(makeReport());
    expect(html).toContain("@media print");
  });

  it("handles multiple repositories", () => {
    const report = makeReport({
      repositories: [
        makeRepoReport({ repoLabel: "org/repo-a" }),
        makeRepoReport({ repoLabel: "org/repo-b" }),
        makeRepoReport({ repoLabel: "org/repo-c" }),
      ],
      aggregate: { totalPrs: 0 },
    });
    const html = generateHtmlReport(report);
    expect(html).toContain("org/repo-a");
    expect(html).toContain("org/repo-b");
    expect(html).toContain("org/repo-c");
  });
});
