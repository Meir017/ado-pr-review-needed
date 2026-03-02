import type { JsonReport } from "../../types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Inlined by esbuild at bundle time via --define (see scripts/bundle.mjs).
// In development this global is not defined and the filesystem fallback is used.
declare const __HTML_TEMPLATE__: string | undefined;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTemplate(): string {
  // In the esbuild bundle, the template is inlined at build time.
  if (typeof __HTML_TEMPLATE__ !== "undefined") {
    return __HTML_TEMPLATE__;
  }

  // Development fallback: read from the filesystem.
  const candidates = [
    resolve(__dirname, "template.html"),
    resolve(process.cwd(), "src", "reporting", "html-report", "template.html"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `HTML template not found. Searched: ${candidates.join(", ")}`,
  );
}

const DATA_PLACEHOLDER = "{{DATA_PLACEHOLDER}}";

/**
 * Generate a self-contained HTML report from a JsonReport.
 * The report is a single HTML file with embedded CSS, JS, and data.
 */
export function generateHtmlReport(report: JsonReport): string {
  const template = loadTemplate();
  const jsonData = JSON.stringify(report);
  return template.replace(DATA_PLACEHOLDER, jsonData);
}
