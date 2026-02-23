import picomatch from "picomatch";

/**
 * Determines which labels should be applied to a PR based on its changed files.
 * Ignored files are excluded before label-pattern matching.
 */
export function detectLabels(
  changedFiles: string[],
  ignorePatterns: string[],
  labelMap: Record<string, string[]>,
): string[] {
  if (Object.keys(labelMap).length === 0) return [];

  const ignoreMatchers = ignorePatterns.map((p) => picomatch(p, { dot: true }));
  const nonIgnoredFiles = changedFiles
    .map((f) => f.replace(/^\//, ""))
    .filter((f) => !ignoreMatchers.some((m) => m(f)));

  if (nonIgnoredFiles.length === 0) return [];

  const labels: string[] = [];
  for (const [label, patterns] of Object.entries(labelMap)) {
    const matchers = patterns.map((p) => picomatch(p, { dot: true }));
    if (nonIgnoredFiles.some((f) => matchers.some((m) => m(f)))) {
      labels.push(label);
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
