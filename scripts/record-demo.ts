/**
 * Records a demo video of the PR Review Dashboard HTML report and
 * converts it to an optimised GIF (4× speed, 800px wide).
 *
 * Usage:  npx tsx scripts/record-demo.ts
 * Output: demo/pr-dashboard-demo.gif
 */

import { chromium } from "@playwright/test";
import { createMockReport } from "../src/reporting/html-report/fixtures/mock-data.js";
import { generateHtmlReport } from "../src/reporting/html-report/generate-html.js";
import { mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const OUTPUT_DIR = resolve(import.meta.dirname, "..", "demo");

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeSlowly(page: import("@playwright/test").Page, selector: string, text: string, delayMs = 80) {
  await page.click(selector);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(delayMs);
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const html = generateHtmlReport(createMockReport());

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUTPUT_DIR, size: { width: 1440, height: 900 } },
  });

  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  // ── 1. Overview – let viewer see the full dashboard ──
  await sleep(2000);

  // ── 2. Search filter ──
  await typeSlowly(page, "#search", "login");
  await sleep(1500);
  // Clear search
  await page.fill("#search", "");
  await sleep(1000);

  // Search by author
  await typeSlowly(page, "#search", "grace");
  await sleep(1500);
  await page.fill("#search", "");
  await sleep(1000);

  // ── 3. Status filter ──
  await page.selectOption("#status-filter", "needingReview");
  await sleep(1500);
  await page.selectOption("#status-filter", "approved");
  await sleep(1500);
  await page.selectOption("#status-filter", "waitingOnAuthor");
  await sleep(1500);
  await page.selectOption("#status-filter", "all");
  await sleep(1000);

  // ── 4. Repo multi-select filter ──
  await page.click("#repo-filter .multi-select-btn");
  await sleep(800);
  await page.click("#repo-filter .multi-select-option:has-text('org/backend') input");
  await sleep(1500);
  // Reset: uncheck
  await page.click("#repo-filter .multi-select-option:has-text('org/backend') input");
  await sleep(500);
  // Close dropdown by clicking outside
  await page.click("header h1");
  await sleep(1000);

  // ── 5. Reviewer filter ──
  await page.click("#reviewer-filter .multi-select-btn");
  await sleep(800);
  await page.click("#reviewer-filter .multi-select-option:has-text('Alice') input");
  await sleep(1500);
  await page.click("#reviewer-filter .multi-select-option:has-text('Alice') input");
  await sleep(500);
  await page.click("header h1");
  await sleep(1000);

  // ── 6. Hide conflicts toggle ──
  await page.locator(".toggle-label").click();
  await sleep(1500);
  await page.locator(".toggle-label").click();
  await sleep(1000);

  // ── 7. Table sorting ──
  await page.click("th:has-text('Title')");
  await sleep(1200);
  await page.click("th:has-text('Author')");
  await sleep(1200);
  await page.click("th:has-text('ID')");
  await sleep(1000);

  // ── 8. Hover popups ──
  // Reviewer popup
  const reviewerWrap = page.locator(".reviewer-popup-wrap").first();
  await reviewerWrap.hover();
  await sleep(2000);

  // Policy popup
  const policyWrap = page.locator(".policy-popup-wrap").first();
  await policyWrap.hover();
  await sleep(2000);

  // Size tooltip
  const sizeBadge = page.locator(".size-badge-wrap").first();
  await sizeBadge.hover();
  await sleep(2000);

  // Move mouse away
  await page.mouse.move(0, 0);
  await sleep(1000);

  // ── 9. CSV export ──
  const downloadPromise = page.waitForEvent("download");
  await page.click("button:has-text('Export CSV')");
  await downloadPromise;
  await sleep(1500);

  // ── 10. Final overview ──
  await sleep(2000);

  // Close context to finalize the video file
  const videoPath = await page.video()!.path();
  await context.close();
  await browser.close();

  // Convert to optimised GIF at 4× speed
  const gifPath = resolve(OUTPUT_DIR, "pr-dashboard-demo.gif");
  console.log("⏳ Converting to GIF…");
  execFileSync("ffmpeg", [
    "-y", "-i", videoPath,
    "-filter_complex",
    "[0:v]setpts=0.25*PTS,fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
    gifPath,
  ], { stdio: "inherit" });

  // Clean up intermediate webm
  try { unlinkSync(videoPath); } catch { /* ignore */ }

  console.log(`✅ Demo GIF saved to: ${gifPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
