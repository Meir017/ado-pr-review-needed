import { execSync } from "node:child_process";
import * as log from "./log.js";

let cachedToken: string | undefined;

/** Get a GitHub token via the `gh` CLI. Caches the result for the process lifetime. */
export async function getGitHubToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!token) {
      throw new Error("gh auth token returned empty — run `gh auth login` first.");
    }

    cachedToken = token;
    return token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not recognized") || msg.includes("not found")) {
      throw new Error(
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.",
      );
    }
    throw new Error(`Failed to get GitHub token: ${msg}. Ensure you are logged in with \`gh auth login\`.`);
  }
}

/** Clear cached token (useful for testing). */
export function clearTokenCache(): void {
  cachedToken = undefined;
}

interface GitHubFetchOptions {
  token?: string;
  method?: string;
  body?: unknown;
}

/**
 * Wrapper around fetch() for GitHub REST API calls.
 * Handles auth headers, API versioning, rate limiting, and error responses.
 */
export async function githubFetch<T = unknown>(url: string, options?: GitHubFetchOptions): Promise<T> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const fetchOptions: RequestInit = {
    method: options?.method ?? "GET",
    headers,
  };

  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  // Rate limit warning
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining !== null && parseInt(remaining, 10) < 100) {
    const resetAt = response.headers.get("x-ratelimit-reset");
    const resetDate = resetAt ? new Date(parseInt(resetAt, 10) * 1000).toLocaleTimeString() : "unknown";
    log.warn(`GitHub API rate limit low: ${remaining} requests remaining (resets at ${resetDate})`);
  }

  // Rate limited
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60;
    log.warn(`GitHub API rate limited — waiting ${waitSec}s before retry`);
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
    return githubFetch<T>(url, options);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`GitHub API error ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ""} (${url})`);
  }

  return response.json() as Promise<T>;
}

/** Parse the Link header for pagination. Returns the URL for the given rel. */
function parseLinkHeader(header: string | null, rel: string): string | null {
  if (!header) return null;
  const regex = new RegExp(`<([^>]+)>;\\s*rel="${rel}"`);
  const match = header.match(regex);
  return match?.[1] ?? null;
}

/**
 * Auto-paginate a GitHub API endpoint.
 * Returns all items from all pages as a single array.
 */
export async function githubFetchAllPages<T>(url: string, token?: string): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | null = url.includes("per_page=") ? url : `${url}${url.includes("?") ? "&" : "?"}per_page=100`;

  while (nextUrl) {
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(nextUrl, { headers });

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60;
      log.warn(`GitHub API rate limited — waiting ${waitSec}s before retry`);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`GitHub API error ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ""} (${nextUrl})`);
    }

    // Rate limit warning
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining !== null && parseInt(remaining, 10) < 100) {
      log.warn(`GitHub API rate limit low: ${remaining} requests remaining`);
    }

    const items = await response.json() as T[];
    all.push(...items);

    nextUrl = parseLinkHeader(response.headers.get("link"), "next");
  }

  return all;
}
