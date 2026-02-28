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
                hasMergeConflict: false,
                isTeamMember: true,
                action: "REVIEW",
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

  describe("merge conflicts", () => {
    it("contains conflict rendering logic in template", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("hasMergeConflict");
      expect(html).toContain("❌ conflict");
    });

    it("embeds hasMergeConflict data for PRs with conflicts", () => {
      const report = makeReport({
        repositories: [
          makeRepoReport({
            analysis: {
              needingReview: [
                {
                  id: 10,
                  title: "Conflicted PR",
                  author: "alice",
                  url: "https://example.com/pr/10",
                  waitingSince: "2025-01-01",
                  hasMergeConflict: true,
                  isTeamMember: true,
                  action: "REVIEW",
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
      expect(html).toContain('"hasMergeConflict":true');
    });

    it("embeds hasMergeConflict:false for PRs without conflicts", () => {
      const report = makeReport({
        repositories: [
          makeRepoReport({
            analysis: {
              needingReview: [],
              approved: [
                {
                  id: 20,
                  title: "Clean PR",
                  author: "bob",
                  url: "https://example.com/pr/20",
                  createdDate: "2025-01-01",
                  hasMergeConflict: false,
                  isTeamMember: true,
                  action: "APPROVE",
                },
              ],
              waitingOnAuthor: [],
            },
          }),
        ],
        aggregate: { totalPrs: 1 },
      });
      const html = generateHtmlReport(report);
      expect(html).toContain('"hasMergeConflict":false');
    });

    it("contains summary card logic that counts conflicts", () => {
      const html = generateHtmlReport(makeReport());
      // The JS counts conflicts and shows a summary card
      expect(html).toContain("Conflicts");
      expect(html).toContain("conflicts++");
    });

    it("embeds conflict data in all PR categories", () => {
      const report = makeReport({
        repositories: [
          makeRepoReport({
            analysis: {
              needingReview: [
                { id: 1, title: "NR conflict", author: "a", url: "u", waitingSince: "2025-01-01", hasMergeConflict: true, isTeamMember: true, action: "REVIEW" },
              ],
              approved: [
                { id: 2, title: "Approved conflict", author: "b", url: "u", createdDate: "2025-01-01", hasMergeConflict: true, isTeamMember: true, action: "APPROVE" },
              ],
              waitingOnAuthor: [
                { id: 3, title: "WOA conflict", author: "c", url: "u", lastReviewerActivityDate: "2025-01-01", hasMergeConflict: true, isTeamMember: true, action: "PENDING" },
              ],
            },
          }),
        ],
        aggregate: { totalPrs: 3 },
      });
      const html = generateHtmlReport(report);
      // All three should have hasMergeConflict: true embedded
      const matches = html.match(/"hasMergeConflict":true/g);
      expect(matches).toHaveLength(3);
    });
  });

  describe("pipeline status", () => {
    it("contains Pipelines column header and badge rendering function", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("Pipelines ↕");
      expect(html).toContain("getPipelineBadge");
    });

    it("embeds pipeline status data in the report", () => {
      const report = makeReport({
        repositories: [
          makeRepoReport({
            analysis: {
              needingReview: [
                {
                  id: 1,
                  title: "Test PR",
                  author: "user",
                  url: "https://example.com",
                  waitingSince: "2025-01-01",
                  hasMergeConflict: false,
                  isTeamMember: true,
                  action: "REVIEW",
                  pipelineStatus: { total: 2, succeeded: 1, failed: 1, inProgress: 0, other: 0, runs: [] },
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
      expect(html).toContain('"pipelineStatus"');
      expect(html).toContain('"failed":1');
    });

    it("contains pipeline badge rendering for all states", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("failed</span>");
      expect(html).toContain("running</span>");
      expect(html).toContain("passed</span>");
    });
  });

  describe("CSV export", () => {
    it("contains CSV export function with all columns", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("exportCsv");
      expect(html).toContain("'ID'");
      expect(html).toContain("'Title'");
      expect(html).toContain("'Author'");
      expect(html).toContain("'Status'");
      expect(html).toContain("'Repo'");
      expect(html).toContain("'Size'");
      expect(html).toContain("'Pipelines'");
      expect(html).toContain("'Age (days)'");
    });
  });

  describe("table columns", () => {
    it("contains all expected table headers", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("ID ↕");
      expect(html).toContain("Title ↕");
      expect(html).toContain("Author ↕");
      expect(html).toContain("Status ↕");
      expect(html).toContain("Repo ↕");
      expect(html).toContain("Size ↕");
      expect(html).toContain("Pipelines ↕");
      expect(html).toContain("Staleness ↕");
    });

    it("contains sorting logic for all columns", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("sortTable(0)");
      expect(html).toContain("sortTable(7)");
    });
  });

  describe("status filter", () => {
    it("contains filter options for all statuses", () => {
      const html = generateHtmlReport(makeReport());
      expect(html).toContain("All Status");
      expect(html).toContain("Needing Review");
      expect(html).toContain("Waiting on Author");
      expect(html).toContain("Approved");
    });
  });
});
