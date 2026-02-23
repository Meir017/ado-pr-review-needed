import type { JsonReport } from "../../types.js";

// The template is embedded as a string so it works in the esbuild single-file bundle.
// Maintained in src/html-report/template.html — keep in sync.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTemplate(): string {
  // In development (tsx) the template is next to this file.
  // In the esbuild bundle, fallback to the src path relative to cwd.
  const candidates = [
    resolve(__dirname, "template.html"),
    resolve(process.cwd(), "src", "html-report", "template.html"),
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
