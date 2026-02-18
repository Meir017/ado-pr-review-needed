import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDirectReports, fetchOrgMembers } from "./graph-client.js";
import { parseAdoRemote } from "./git-detect.js";
import type { QuantifierConfig, SizeThreshold, PrSizeLabel } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

export interface RepoTarget {
  orgUrl: string;
  project: string;
  repository: string;
}

export interface MultiRepoConfig {
  repos: RepoTarget[];
  teamMembers: Set<string>;
  ignoredUsers: Set<string>;
  botUsers: Set<string>;
  quantifier?: QuantifierConfig;
  restartMergeAfterDays: number;
}

interface ConfigFile {
  repositories?: string[];

  teamMembers?: string[];
  manager?: string;
  orgManager?: string;
  ignoreManagers?: boolean;

  botUsers?: string[];

  quantifier?: {
    enabled?: boolean;
    excludedPatterns?: string[];
    thresholds?: { label: string; maxChanges: number }[];
  };

  restartMergeAfterDays?: number;
}

function loadConfigFile(configFilePath?: string): ConfigFile {
  const configPath = configFilePath
    ? resolve(configFilePath)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "pr-review-config.json");

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as ConfigFile;
}

function parseRepoTargets(cfg: ConfigFile): RepoTarget[] {
  if (!cfg.repositories || cfg.repositories.length === 0) {
    throw new Error(
      "Config must specify 'repositories' (array of ADO URLs).",
    );
  }

  return cfg.repositories.map((url) => {
    const parsed = parseAdoRemote(url);
    if (!parsed) {
      throw new Error(`Invalid ADO repository URL: ${url}`);
    }
    return parsed;
  });
}

interface ResolvedMembers {
  teamMembers: Set<string>;
  ignoredUsers: Set<string>;
}

async function resolveTeamMembers(cfg: ConfigFile): Promise<ResolvedMembers> {
  const members = new Set<string>(
    (cfg.teamMembers ?? []).map((e) => e.toLowerCase()),
  );
  const ignoredUsers = new Set<string>();

  if (cfg.orgManager) {
    const result = await fetchOrgMembers(cfg.orgManager);
    for (const email of result.members) {
      members.add(email);
    }
    members.add(cfg.orgManager.toLowerCase());

    if (cfg.ignoreManagers) {
      for (const mgr of result.managers) {
        ignoredUsers.add(mgr.toLowerCase());
      }
    }
  }

  if (cfg.manager) {
    const reports = await fetchDirectReports(cfg.manager);
    for (const email of reports) {
      members.add(email);
    }
    members.add(cfg.manager.toLowerCase());

    if (cfg.ignoreManagers) {
      ignoredUsers.add(cfg.manager.toLowerCase());
    }
  }

  return { teamMembers: members, ignoredUsers };
}

function resolveQuantifierConfig(cfg: ConfigFile): QuantifierConfig | undefined {
  // Enabled by default; only disabled when explicitly set to false
  if (cfg.quantifier?.enabled === false) return undefined;

  const excludedPatterns = cfg.quantifier?.excludedPatterns ?? [];
  const thresholds: SizeThreshold[] = cfg.quantifier?.thresholds
    ? cfg.quantifier.thresholds.map((t) => ({
        label: t.label as PrSizeLabel,
        maxChanges: t.maxChanges,
      }))
    : DEFAULT_THRESHOLDS;

  return { enabled: true, excludedPatterns, thresholds };
}

export async function getMultiRepoConfig(configFilePath?: string): Promise<MultiRepoConfig> {
  const cfg = loadConfigFile(configFilePath);
  const repos = parseRepoTargets(cfg);
  const { teamMembers, ignoredUsers } = await resolveTeamMembers(cfg);
  const botUsers = new Set<string>(
    (cfg.botUsers ?? []).map((e) => e.toLowerCase()),
  );
  const quantifier = resolveQuantifierConfig(cfg);
  const restartMergeAfterDays = cfg.restartMergeAfterDays ?? 30;
  return { repos, teamMembers, ignoredUsers, botUsers, quantifier, restartMergeAfterDays };
}


