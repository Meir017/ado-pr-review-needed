import { test, expect, type Page } from "@playwright/test";
import { createMockReport, createEmptyReport } from "./fixtures/mock-data.js";
import { generateHtmlReport } from "./generate-html.js";

// Pre-generate HTML once per worker to avoid repeated disk I/O and JSON.stringify
const mockHtml = generateHtmlReport(createMockReport());
const emptyHtml = generateHtmlReport(createEmptyReport());

async function renderMock(page: Page) {
  await page.setContent(mockHtml, { waitUntil: "domcontentloaded" });
}

async function renderEmpty(page: Page) {
  await page.setContent(emptyHtml, { waitUntil: "domcontentloaded" });
}

test.describe("HTML Dashboard — initial rendering", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("shows the dashboard title", async ({ page }) => {
    await expect(page.locator("header h1")).toContainText("PR Review Dashboard");
  });

  test("shows the repo count", async ({ page }) => {
    await expect(page.locator("#repo-count")).toHaveText("2");
  });

  test("renders the timestamp", async ({ page }) => {
    const text = await page.locator("#timestamp").textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("renders summary cards with correct totals", async ({ page }) => {
    await expect(page.locator('[data-card="total"]')).toHaveText("6");
    await expect(page.locator('[data-card="needing-review"]')).toHaveText("3");
    await expect(page.locator('[data-card="approved"]')).toHaveText("2");
    await expect(page.locator('[data-card="waiting"]')).toHaveText("1");
    await expect(page.locator('[data-card="conflicts"]')).toHaveText("2");
  });

  test("renders all PR rows in the table", async ({ page }) => {
    const rows = page.locator("#pr-table tr");
    await expect(rows).toHaveCount(6);
  });

  test("shows metrics section when metrics exist", async ({ page }) => {
    await expect(page.locator("#metrics-section")).toBeVisible();
    await expect(page.locator("#metrics-cards")).toContainText("Median PR Age");
    await expect(page.locator("#metrics-cards")).toContainText("5.2 days");
  });

  test("shows median age card in summary", async ({ page }) => {
    await expect(page.locator('[data-card="median-age"]')).toContainText("5.2d");
  });
});

test.describe("HTML Dashboard — search filter", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("filters by title", async ({ page }) => {
    await page.fill("#search", "login");
    const rows = page.locator("#pr-table tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Add login page");
  });

  test("filters by author", async ({ page }) => {
    await page.fill("#search", "grace");
    const rows = page.locator("#pr-table tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("grace");
  });

  test("filters by ID", async ({ page }) => {
    await page.fill("#search", "201");
    const rows = page.locator("#pr-table tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("#201");
  });

  test("clearing search restores all rows", async ({ page }) => {
    await page.fill("#search", "nonexistent");
    await expect(page.locator("#pr-table tr")).toHaveCount(0);
    await page.fill("#search", "");
    await expect(page.locator("#pr-table tr")).toHaveCount(6);
  });

  test("updates summary cards when filtered", async ({ page }) => {
    await page.fill("#search", "login");
    // Filtered: 1 / 6 total
    await expect(page.locator('[data-card="total"]')).toContainText("1");
    await expect(page.locator('[data-card="total"]')).toContainText("6");
  });
});

test.describe("HTML Dashboard — status filter", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("filters to needing review", async ({ page }) => {
    await page.selectOption("#status-filter", "needingReview");
    await expect(page.locator("#pr-table tr")).toHaveCount(3);
  });

  test("filters to approved", async ({ page }) => {
    await page.selectOption("#status-filter", "approved");
    await expect(page.locator("#pr-table tr")).toHaveCount(2);
  });

  test("filters to waiting on author", async ({ page }) => {
    await page.selectOption("#status-filter", "waitingOnAuthor");
    await expect(page.locator("#pr-table tr")).toHaveCount(1);
    await expect(page.locator("#pr-table tr").first()).toContainText("Refactor auth module");
  });

  test("resets when selecting all", async ({ page }) => {
    await page.selectOption("#status-filter", "needingReview");
    await expect(page.locator("#pr-table tr")).toHaveCount(3);
    await page.selectOption("#status-filter", "all");
    await expect(page.locator("#pr-table tr")).toHaveCount(6);
  });
});

test.describe("HTML Dashboard — repo multi-select filter", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("shows all repos as checkbox options", async ({ page }) => {
    // Open the multi-select dropdown
    await page.click("#repo-filter .multi-select-btn");
    const options = page.locator("#repo-filter .multi-select-option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText("org/frontend");
    await expect(options.nth(1)).toContainText("org/backend");
  });

  test("filters by single repo", async ({ page }) => {
    await page.click("#repo-filter .multi-select-btn");
    await page.click("#repo-filter .multi-select-option:has-text('org/backend') input");
    await expect(page.locator("#pr-table tr")).toHaveCount(2);
  });

  test("updates button label when repo selected", async ({ page }) => {
    await page.click("#repo-filter .multi-select-btn");
    await page.click("#repo-filter .multi-select-option:has-text('org/frontend') input");
    await expect(page.locator("#repo-filter .multi-select-text")).toHaveText("org/frontend");
  });

  test("shows count when multiple repos selected", async ({ page }) => {
    await page.click("#repo-filter .multi-select-btn");
    await page.click("#repo-filter .multi-select-option:has-text('org/frontend') input");
    await page.click("#repo-filter .multi-select-option:has-text('org/backend') input");
    await expect(page.locator("#repo-filter .multi-select-text")).toHaveText("2 selected");
  });

  test("reverts to All Repos when unchecked", async ({ page }) => {
    await page.click("#repo-filter .multi-select-btn");
    await page.click("#repo-filter .multi-select-option:has-text('org/frontend') input");
    await expect(page.locator("#repo-filter .multi-select-text")).toHaveText("org/frontend");
    await page.click("#repo-filter .multi-select-option:has-text('org/frontend') input");
    await expect(page.locator("#repo-filter .multi-select-text")).toHaveText("All Repos");
  });
});

test.describe("HTML Dashboard — reviewer multi-select filter", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("shows only required reviewers", async ({ page }) => {
    await page.click("#reviewer-filter .multi-select-btn");
    const options = page.locator("#reviewer-filter .multi-select-option");
    // Required reviewers: Alice, Bob (from our mock data)
    await expect(options).toHaveCount(2);
    const texts = await options.allTextContents();
    expect(texts.sort()).toEqual(["Alice", "Bob"]);
  });

  test("filters PRs by required reviewer", async ({ page }) => {
    await page.click("#reviewer-filter .multi-select-btn");
    await page.click("#reviewer-filter .multi-select-option:has-text('Alice') input");
    // Alice is required reviewer on PR 201 (backend) and PR 104 (frontend/waitingOnAuthor)
    await expect(page.locator("#pr-table tr")).toHaveCount(2);
  });
});

test.describe("HTML Dashboard — hide conflicts toggle", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("hides PRs with merge conflicts when toggled", async ({ page }) => {
    // 6 total, 2 have conflicts (PR 102, PR 104)
    await expect(page.locator("#pr-table tr")).toHaveCount(6);
    await page.locator(".toggle-label").click();
    await expect(page.locator("#pr-table tr")).toHaveCount(4);
  });

  test("updates summary cards when conflicts hidden", async ({ page }) => {
    await page.locator(".toggle-label").click();
    await expect(page.locator('[data-card="total"]')).toContainText("4");
    await expect(page.locator('[data-card="conflicts"]')).toContainText("0");
  });

  test("restores PRs when untoggled", async ({ page }) => {
    await page.locator(".toggle-label").click();
    await expect(page.locator("#pr-table tr")).toHaveCount(4);
    await page.locator(".toggle-label").click();
    await expect(page.locator("#pr-table tr")).toHaveCount(6);
  });
});

test.describe("HTML Dashboard — table sorting", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("sorts by ID ascending then descending", async ({ page }) => {
    // Default sort is already ID ascending (sortCol=0, sortDir=1).
    // First click on ID toggles to descending.
    await page.click("th:has-text('ID')");
    const firstRowDesc = page.locator("#pr-table tr").first();
    await expect(firstRowDesc).toContainText("#202");

    // Click again to go back to ascending
    await page.click("th:has-text('ID')");
    const firstRowAsc = page.locator("#pr-table tr").first();
    await expect(firstRowAsc).toContainText("#101");
  });

  test("sorts by title", async ({ page }) => {
    await page.click("th:has-text('Title')");
    const firstTitle = await page.locator("#pr-table tr").first().locator("td").nth(1).textContent();
    expect(firstTitle).toBeTruthy();
  });

  test("sorts by author", async ({ page }) => {
    await page.click("th:has-text('Author')");
    const firstAuthor = await page.locator("#pr-table tr").first().locator("td").nth(2).textContent();
    // "alice" should be first alphabetically (starred, so has ⭐ prefix)
    expect(firstAuthor).toContain("alice");
  });
});

test.describe("HTML Dashboard — popups", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("reviewer popup appears on hover", async ({ page }) => {
    // Find a reviewer badge and hover
    const reviewerWrap = page.locator(".reviewer-popup-wrap").first();
    await reviewerWrap.hover();
    await expect(page.locator(".reviewer-popup.visible").first()).toBeVisible();
    await expect(page.locator(".reviewer-popup.visible").first()).toContainText("Reviewers");
  });

  test("reviewer popup shows vote icons and required labels", async ({ page }) => {
    // PR 101 has Bob (required, vote 0 = 👀) and Charlie (optional, vote 5 = 👍)
    const firstReviewerWrap = page.locator(".reviewer-popup-wrap").first();
    await firstReviewerWrap.hover();
    const popup = page.locator(".reviewer-popup.visible").first();
    await expect(popup).toContainText("Bob");
    await expect(popup).toContainText("required");
  });

  test("policy popup appears on hover", async ({ page }) => {
    const policyWrap = page.locator(".policy-popup-wrap").first();
    await policyWrap.hover();
    await expect(page.locator(".policy-popup.visible").first()).toBeVisible();
    await expect(page.locator(".policy-popup.visible").first()).toContainText("Policy Evaluations");
  });

  test("policy popup shows evaluation details", async ({ page }) => {
    const policyWrap = page.locator(".policy-popup-wrap").first();
    await policyWrap.hover();
    const popup = page.locator(".policy-popup.visible").first();
    await expect(popup).toContainText("Build validation");
    await expect(popup).toContainText("Minimum reviewers");
  });

  test("size tooltip shows on hover", async ({ page }) => {
    // Hover over a size badge
    const sizeBadge = page.locator(".size-badge-wrap").first();
    await sizeBadge.hover();
    const tooltip = page.locator(".size-tooltip").first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Additions");
    await expect(tooltip).toContainText("Deletions");
    await expect(tooltip).toContainText("Files changed");
  });
});

test.describe("HTML Dashboard — empty state", () => {
  test("shows empty message when no PRs match filters", async ({ page }) => {
    await renderMock(page);
    await page.fill("#search", "zzz-nonexistent-zzz");
    await expect(page.locator("#empty-message")).toBeVisible();
    await expect(page.locator("#empty-message")).toContainText("No PRs match your filters");
  });

  test("shows empty table for empty report", async ({ page }) => {
    await renderEmpty(page);
    await expect(page.locator("#pr-table tr")).toHaveCount(0);
  });

  test("hides metrics section when no metrics", async ({ page }) => {
    await renderEmpty(page);
    await expect(page.locator("#metrics-section")).toBeHidden();
  });
});

test.describe("HTML Dashboard — PR row content", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("shows conflict badge on conflicted PRs", async ({ page }) => {
    // PR 102 has a merge conflict
    const row102 = page.locator("#pr-table tr:has-text('#102')");
    await expect(row102).toContainText("❌ conflict");
  });

  test("shows star icon for starred PRs", async ({ page }) => {
    // PR 101 is starred
    const row101 = page.locator("#pr-table tr:has-text('#101')");
    await expect(row101).toContainText("⭐");
  });

  test("shows correct status badges", async ({ page }) => {
    const row101 = page.locator("#pr-table tr:has-text('#101')");
    await expect(row101).toContainText("Needs Review");

    const row103 = page.locator("#pr-table tr:has-text('#103')");
    await expect(row103).toContainText("Approved");

    const row104 = page.locator("#pr-table tr:has-text('#104')");
    await expect(row104).toContainText("Waiting");
  });

  test("shows size badges with correct labels", async ({ page }) => {
    // PR 101: M size
    const row101 = page.locator("#pr-table tr:has-text('#101')");
    await expect(row101.locator(".badge")).toContainText(["M"]);

    // PR 102: XS
    const row102 = page.locator("#pr-table tr:has-text('#102')");
    await expect(row102.locator(".size-badge-wrap .badge")).toHaveText("XS");
  });

  test("PR links have correct href", async ({ page }) => {
    const link = page.locator("#pr-table tr:has-text('#101') a").first();
    await expect(link).toHaveAttribute("href", /pullrequest\/101/);
    await expect(link).toHaveAttribute("target", "_blank");
  });
});

test.describe("HTML Dashboard — CSV export", () => {
  test("export button exists", async ({ page }) => {
    await renderMock(page);
    await expect(page.locator("button:has-text('Export CSV')")).toBeVisible();
  });

  test("clicking export triggers download", async ({ page }) => {
    await renderMock(page);
    const downloadPromise = page.waitForEvent("download");
    await page.click("button:has-text('Export CSV')");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("pr-review-report.csv");
  });
});

test.describe("HTML Dashboard — combined filters", () => {
  test.beforeEach(async ({ page }) => {
    await renderMock(page);
  });

  test("search + status filter combine correctly", async ({ page }) => {
    await page.selectOption("#status-filter", "needingReview");
    await page.fill("#search", "navbar");
    const rows = page.locator("#pr-table tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Fix navbar styling");
  });

  test("repo filter + hide conflicts combine correctly", async ({ page }) => {
    await page.click("#repo-filter .multi-select-btn");
    await page.click("#repo-filter .multi-select-option:has-text('org/frontend') input");
    // org/frontend has 4 PRs, 2 with conflicts
    await expect(page.locator("#pr-table tr")).toHaveCount(4);
    await page.locator(".toggle-label").click();
    await expect(page.locator("#pr-table tr")).toHaveCount(2);
  });
});

