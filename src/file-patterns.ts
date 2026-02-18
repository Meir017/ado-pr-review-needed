import picomatch from "picomatch";
import type { LabelPatternConfig } from "./config.js";

/**
 * Determines which labels should be applied to a PR based on its changed files.
 * Ignored files are excluded before label-pattern matching.
 */
export function detectLabels(
  changedFiles: string[],
  ignorePatterns: string[],
  labelPatterns: LabelPatternConfig[],
): string[] {
  if (labelPatterns.length === 0) return [];

  const ignoreMatchers = ignorePatterns.map((p) => picomatch(p, { dot: true }));
  const nonIgnoredFiles = changedFiles
    .map((f) => f.replace(/^\//, ""))
    .filter((f) => !ignoreMatchers.some((m) => m(f)));

  if (nonIgnoredFiles.length === 0) return [];

  const labels: string[] = [];
  for (const rule of labelPatterns) {
    const matchers = rule.patterns.map((p) => picomatch(p, { dot: true }));
    if (nonIgnoredFiles.some((f) => matchers.some((m) => m(f)))) {
      labels.push(rule.label);
    }
  }

  return labels;
}

/**
 * Filters out ignored files from a list of changed file paths.
 */
export function filterIgnoredFiles(
  changedFiles: string[],
  ignorePatterns: string[],
): string[] {
  const normalized = changedFiles.map((f) => f.replace(/^\//, ""));
  if (ignorePatterns.length === 0) return normalized;

  const matchers = ignorePatterns.map((p) => picomatch(p, { dot: true }));
  return normalized.filter((f) => !matchers.some((m) => m(f)));
}
