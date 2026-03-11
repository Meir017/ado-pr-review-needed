export type Provider = "ado" | "github";

export interface GitHubRepoTarget {
  provider: "github";
  owner: string;
  repo: string;
  visibility: "public" | "private";
  skipRestartMerge: boolean;
  patterns: {
    ignore: string[];
    labels: Record<string, string[]>;
  };
}

export interface AdoRepoTarget {
  provider: "ado";
  orgUrl: string;
  project: string;
  repository: string;
  skipRestartMerge: boolean;
  patterns: {
    ignore: string[];
    labels: Record<string, string[]>;
  };
}

export type ProviderRepoTarget = AdoRepoTarget | GitHubRepoTarget;
