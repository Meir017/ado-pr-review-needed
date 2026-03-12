import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGitHubToken, clearTokenCache, githubFetch, githubFetchAllPages } from "./github-client.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./log.js", () => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

import { execSync } from "node:child_process";

const mockExecSync = vi.mocked(execSync);

describe("getGitHubToken", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.resetAllMocks();
  });

  it("returns token from gh CLI", async () => {
    mockExecSync.mockReturnValue("ghp_test123\n");
    const token = await getGitHubToken();
    expect(token).toBe("ghp_test123");
  });

  it("caches the token on subsequent calls", async () => {
    mockExecSync.mockReturnValue("ghp_cached\n");
    await getGitHubToken();
    await getGitHubToken();
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("throws when gh CLI returns empty", async () => {
    mockExecSync.mockReturnValue("");
    await expect(getGitHubToken()).rejects.toThrow("empty");
  });

  it("throws when gh CLI is not installed", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    await expect(getGitHubToken()).rejects.toThrow("not installed");
  });

  it("throws generic error for other failures", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("some other error");
    });
    await expect(getGitHubToken()).rejects.toThrow("Failed to get GitHub token");
  });
});

describe("clearTokenCache", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.resetAllMocks();
  });

  it("clears cached token so next call fetches again", async () => {
    mockExecSync.mockReturnValue("ghp_first\n");
    await getGitHubToken();

    clearTokenCache();

    mockExecSync.mockReturnValue("ghp_second\n");
    const token = await getGitHubToken();
    expect(token).toBe("ghp_second");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });
});

describe("githubFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a GET request with correct headers", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ id: 1 }),
      text: vi.fn(),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const result = await githubFetch<{ id: number }>("https://api.github.com/repos/o/r");
    expect(result).toEqual({ id: 1 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
      }),
    );
  });

  it("includes Authorization header when token is provided", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn(),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await githubFetch("https://api.github.com/repos/o/r", { token: "ghp_abc" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_abc",
        }),
      }),
    );
  });

  it("returns undefined for 204 No Content", async () => {
    const mockResponse = {
      ok: true,
      status: 204,
      headers: new Headers(),
      json: vi.fn(),
      text: vi.fn(),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const result = await githubFetch("https://api.github.com/some-endpoint");
    expect(result).toBeUndefined();
  });

  it("throws on error response (404)", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      json: vi.fn(),
      text: vi.fn().mockResolvedValue("Not Found"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await expect(githubFetch("https://api.github.com/repos/o/r")).rejects.toThrow("GitHub API error 404");
  });

  it("throws on error response (500)", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: vi.fn(),
      text: vi.fn().mockResolvedValue("Server Error"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await expect(githubFetch("https://api.github.com/repos/o/r")).rejects.toThrow("GitHub API error 500");
  });

  it("retries on 429 rate limit", async () => {
    const rateLimitResponse = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "retry-after": "0" }),
      json: vi.fn(),
      text: vi.fn(),
    };
    const okResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ retried: true }),
      text: vi.fn(),
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimitResponse as unknown as Response)
      .mockResolvedValueOnce(okResponse as unknown as Response);

    const result = await githubFetch<{ retried: boolean }>("https://api.github.com/repos/o/r");
    expect(result).toEqual({ retried: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("githubFetchAllPages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches single page of results", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const result = await githubFetchAllPages<{ id: number }>("https://api.github.com/repos/o/r/pulls?state=open");
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("follows Link header for pagination", async () => {
    const page1Response = {
      ok: true,
      status: 200,
      headers: new Headers({
        link: '<https://api.github.com/repos/o/r/pulls?page=2&per_page=100>; rel="next"',
      }),
      json: vi.fn().mockResolvedValue([{ id: 1 }]),
    };
    const page2Response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue([{ id: 2 }]),
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page1Response as unknown as Response)
      .mockResolvedValueOnce(page2Response as unknown as Response);

    const result = await githubFetchAllPages<{ id: number }>("https://api.github.com/repos/o/r/pulls?state=open");
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit during pagination", async () => {
    const page1Response = {
      ok: true,
      status: 200,
      headers: new Headers({
        link: '<https://api.github.com/repos/o/r/pulls?page=2&per_page=100>; rel="next"',
      }),
      json: vi.fn().mockResolvedValue([{ id: 1 }]),
    };
    const rateLimitResponse = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "retry-after": "0" }),
      json: vi.fn(),
      text: vi.fn(),
    };
    const page2Response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue([{ id: 2 }]),
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page1Response as unknown as Response)
      .mockResolvedValueOnce(rateLimitResponse as unknown as Response)
      .mockResolvedValueOnce(page2Response as unknown as Response);

    const result = await githubFetchAllPages<{ id: number }>("https://api.github.com/repos/o/r/pulls?state=open");
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("throws on non-retryable error", async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: vi.fn(),
      text: vi.fn().mockResolvedValue("Server Error"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse as unknown as Response);

    await expect(
      githubFetchAllPages("https://api.github.com/repos/o/r/pulls?state=open"),
    ).rejects.toThrow("GitHub API error 500");
  });

  it("adds per_page=100 when not present", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await githubFetchAllPages("https://api.github.com/repos/o/r/pulls");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("per_page=100"),
      expect.any(Object),
    );
  });
});
