import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface TestConfigOptions {
  repositories?: Array<{
    url: string;
    skipRestartMerge?: boolean;
    patterns?: { ignore?: string[]; labels?: Record<string, string[]> };
  }>;
  teamMembers?: string[];
  orgManager?: string | null;
  manager?: string | null;
  ignoreManagers?: boolean;
  botUsers?: string[];
  aiBotUsers?: string[];
  quantifier?: { enabled?: boolean; excludedPatterns?: string[]; thresholds?: Array<{ label: string; maxChanges: number }> };
  restartMergeAfterDays?: number;
  staleness?: { enabled?: boolean; thresholds?: Array<{ label: string; minDays: number }> };
  notifications?: unknown;
  webhook?: unknown;
  autoNudge?: unknown;
}

const DEFAULT_REPO_URL = "https://dev.azure.com/testorg/testproject/_git/testrepo";

function defaultConfig(): TestConfigOptions {
  return {
    repositories: [{ url: DEFAULT_REPO_URL }],
    teamMembers: [],
    orgManager: null,
    ignoreManagers: false,
  };
}

export interface TestDir {
  /** Absolute path to the temp directory */
  dir: string;
  /** Absolute path to the config file */
  configPath: string;
  /** Build an absolute path inside the temp dir */
  path: (relative: string) => string;
  /** Cleanup the temp directory */
  cleanup: () => void;
}

/**
 * Creates a temp directory with a config file and returns helpers.
 */
export function createTestDir(configOverrides: Partial<TestConfigOptions> = {}): TestDir {
  const dir = mkdtempSync(join(tmpdir(), "pr-review-e2e-"));
  const config = { ...defaultConfig(), ...configOverrides };
  const configPath = join(dir, "pr-review-config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  return {
    dir,
    configPath,
    path: (relative: string) => join(dir, relative),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Creates a minimal config for a single repo.
 */
export function singleRepoConfig(repoUrl = DEFAULT_REPO_URL, overrides: Partial<TestConfigOptions> = {}): TestDir {
  return createTestDir({ repositories: [{ url: repoUrl }], ...overrides });
}

/**
 * Creates a config with multiple repos.
 */
export function multiRepoConfig(
  repoUrls: string[] = [
    "https://dev.azure.com/testorg/project1/_git/repo1",
    "https://dev.azure.com/testorg/project2/_git/repo2",
  ],
  overrides: Partial<TestConfigOptions> = {},
): TestDir {
  return createTestDir({
    repositories: repoUrls.map((url) => ({ url })),
    ...overrides,
  });
}
