import { execSync } from "node:child_process";
import type { Provider } from "./types/provider.js";

interface GitRemoteInfo {
  orgUrl: string;
  project: string;
  repository: string;
}

export interface GitHubRemoteInfo {
  owner: string;
  repo: string;
}

export type ParsedGitRemote =
  | { provider: "ado"; info: GitRemoteInfo }
  | { provider: "github"; info: GitHubRemoteInfo };

/**
 * Parse an Azure DevOps git remote URL into org/project/repo.
 * Supports:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *   {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
 */
export function parseAdoRemote(remoteUrl: string): GitRemoteInfo | null {
  // HTTPS: dev.azure.com
  const devMatch = remoteUrl.match(
    /https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/,
  );
  if (devMatch) {
    return {
      orgUrl: `https://dev.azure.com/${devMatch[1]}`,
      project: devMatch[2],
      repository: devMatch[3],
    };
  }

  // HTTPS: visualstudio.com
  const vsMatch = remoteUrl.match(
    /https?:\/\/(?:[^@]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+)/,
  );
  if (vsMatch) {
    return {
      orgUrl: `https://dev.azure.com/${vsMatch[1]}`,
      project: vsMatch[2],
      repository: vsMatch[3],
    };
  }

  // SSH: ssh.dev.azure.com
  const sshMatch = remoteUrl.match(
    /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/,
  );
  if (sshMatch) {
    return {
      orgUrl: `https://dev.azure.com/${sshMatch[1]}`,
      project: sshMatch[2],
      repository: sshMatch[3],
    };
  }

  // SSH: vs-ssh.visualstudio.com
  const vsSshMatch = remoteUrl.match(
    /vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/,
  );
  if (vsSshMatch) {
    return {
      orgUrl: `https://dev.azure.com/${vsSshMatch[1]}`,
      project: vsSshMatch[2],
      repository: vsSshMatch[3],
    };
  }

  return null;
}

/**
 * Parse a GitHub git remote URL into owner/repo.
 * Supports:
 *   https://github.com/{owner}/{repo}
 *   https://github.com/{owner}/{repo}.git
 *   git@github.com:{owner}/{repo}.git
 *   git@github.com:{owner}/{repo}
 */
export function parseGitHubRemote(remoteUrl: string): GitHubRemoteInfo | null {
  // HTTPS: github.com
  const httpsMatch = remoteUrl.match(
    /https?:\/\/github\.com\/([^/]+)\/([^/\s.]+?)(?:\.git)?(?:\s|$)/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com
  const sshMatch = remoteUrl.match(
    /git@github\.com:([^/]+)\/([^/\s.]+?)(?:\.git)?(?:\s|$)/,
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/** Parse any supported git remote URL (ADO or GitHub). */
export function parseGitRemote(remoteUrl: string): ParsedGitRemote | null {
  const ado = parseAdoRemote(remoteUrl);
  if (ado) return { provider: "ado", info: ado };

  const github = parseGitHubRemote(remoteUrl);
  if (github) return { provider: "github", info: github };

  return null;
}

/** Detect the ADO repo from git remotes in the cwd. Returns null if not a git repo or not ADO. */
export function detectAdoRepo(): GitRemoteInfo | null {
  let remoteOutput: string;
  try {
    remoteOutput = execSync("git remote -v", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return null;
  }

  for (const line of remoteOutput.split("\n")) {
    if (!line.includes("(fetch)")) continue;
    const info = parseAdoRemote(line);
    if (info) {
      return info;
    }
  }

  return null;
}
