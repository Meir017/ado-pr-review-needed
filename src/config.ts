import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDirectReports, fetchOrgMembers, type OrgMembersResult } from "./graph-client.js";
import { parseAdoRemote } from "./git-detect.js";
import type { QuantifierConfig, SizeThreshold, PrSizeLabel } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

export interface RepoTarget {
  orgUrl: string;
  project: string;
  repository: string;
}

export interface AdoConfig {
  orgUrl: string;
  project: string;
  repository: string;
  teamMembers: Set<string>;
}

export interface MultiRepoConfig {
  repos: RepoTarget[];
  teamMembers: Set<string>;
  ignoredUsers: Set<string>;
  quantifier?: QuantifierConfig;
}

interface ConfigFile {
  // New multi-repo format
  repositories?: string[];
  // Legacy single-repo format
  orgUrl?: string;
  project?: string;
  repository?: string;

  teamMembers?: string[];
  manager?: string;
  orgManager?: string;
  ignoreManagers?: boolean;

  quantifier?: {
    enabled?: boolean;
    excludedPatterns?: string[];
    thresholds?: { label: string; maxChanges: number }[];
  };
}

function loadConfigFile(configFilePath?: string): ConfigFile {
  const configPath = configFilePath
    ? resolve(configFilePath)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "pr-review-config.json");

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as ConfigFile;
}

function parseRepoTargets(cfg: ConfigFile): RepoTarget[] {
  if (cfg.repositories && cfg.repositories.length > 0) {
    return cfg.repositories.map((url) => {
      const parsed = parseAdoRemote(url);
      if (!parsed) {
        throw new Error(`Invalid ADO repository URL: ${url}`);
      }
      return parsed;
    });
  }

  // Legacy single-repo fallback
  if (cfg.orgUrl && cfg.project && cfg.repository) {
    return [{ orgUrl: cfg.orgUrl, project: cfg.project, repository: cfg.repository }];
  }

  throw new Error(
    "Config must specify either 'repositories' (array of ADO URLs) or 'orgUrl'/'project'/'repository'.",
  );
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
  const quantifier = resolveQuantifierConfig(cfg);
  return { repos, teamMembers, ignoredUsers, quantifier };
}

export async function getAdoConfig(configFilePath?: string): Promise<AdoConfig> {
  const cfg = loadConfigFile(configFilePath);

  const members = new Set<string>(
    (cfg.teamMembers ?? []).map((e) => e.toLowerCase()),
  );

  // If an orgManager is specified, recursively fetch all descendants
  if (cfg.orgManager) {
    const result = await fetchOrgMembers(cfg.orgManager);
    for (const email of result.members) {
      members.add(email);
    }
    members.add(cfg.orgManager.toLowerCase());
  }

  // If a manager is specified, fetch their direct reports from Graph
  if (cfg.manager) {
    const reports = await fetchDirectReports(cfg.manager);
    for (const email of reports) {
      members.add(email);
    }
    // Include the manager themselves
    members.add(cfg.manager.toLowerCase());
  }

  const repos = parseRepoTargets(cfg);
  const first = repos[0];

  return {
    orgUrl: first.orgUrl,
    project: first.project,
    repository: first.repository,
    teamMembers: members,
  };
}
