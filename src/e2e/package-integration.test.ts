import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const BUNDLE_PATH = resolve("dist/index.min.js");
const PKG = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

function runCli(args: string[], options: { cwd?: string } = {}): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [BUNDLE_PATH, ...args], {
      cwd: options.cwd,
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

// ---------- Bundle integrity ----------

describe("package integration: bundle integrity", () => {
  it("bundle file exists", () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true);
  });

  it("starts with a shebang", () => {
    const head = readFileSync(BUNDLE_PATH, "utf-8").slice(0, 50);
    expect(head).toMatch(/^#!\/usr\/bin\/env node/);
  });

  it("has the HTML template inlined", () => {
    const bundle = readFileSync(BUNDLE_PATH, "utf-8");
    expect(bundle).toContain("PR Review Dashboard");
    expect(bundle).toContain("DATA_PLACEHOLDER");
  });

  it("does not contain the raw __HTML_TEMPLATE__ identifier", () => {
    const bundle = readFileSync(BUNDLE_PATH, "utf-8");
    expect(bundle).not.toContain("__HTML_TEMPLATE__");
  });
});

// ---------- CLI subprocess tests ----------

describe("package integration: CLI commands", () => {
  it("--help prints usage and exits 0", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pr-review-needed");
    expect(stdout).toContain("setup");
    expect(stdout).toContain("run");
  });

  it("--version prints the package version", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(PKG.version);
  });

  describe("setup command", () => {
    let testDir: string;

    afterEach(() => {
      if (testDir) rmSync(testDir, { recursive: true, force: true });
    });

    it("generates a config file", () => {
      testDir = mkdtempSync(join(tmpdir(), "pkg-int-setup-"));
      const { exitCode } = runCli(["setup"], { cwd: testDir });
      expect(exitCode).toBe(0);

      const configPath = join(testDir, "pr-review-config.json");
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config).toHaveProperty("repositories");
    });
  });

  describe("run command without config", () => {
    let testDir: string;

    afterEach(() => {
      if (testDir) rmSync(testDir, { recursive: true, force: true });
    });

    it("fails with a config-related error, not a template error", { timeout: 20_000 }, () => {
      testDir = mkdtempSync(join(tmpdir(), "pkg-int-run-"));
      const { stderr, exitCode } = runCli(["run"], { cwd: testDir });
      expect(exitCode).not.toBe(0);
      // Must NOT fail because the HTML template is missing
      expect(stderr).not.toContain("HTML template not found");
    });

    it("--format html fails with config error, not template error", { timeout: 20_000 }, () => {
      testDir = mkdtempSync(join(tmpdir(), "pkg-int-html-"));
      const { stderr, exitCode } = runCli(["run", "--format", "html"], { cwd: testDir });
      expect(exitCode).not.toBe(0);
      expect(stderr).not.toContain("HTML template not found");
    });
  });
});

// ---------- npm pack verification ----------

describe("package integration: npm pack", () => {
  it("includes dist/index.min.js in the package", () => {
    const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: resolve("."),
      encoding: "utf-8",
      timeout: 30_000,
      shell: true,
    });
    const packInfo = JSON.parse(stdout);
    const files: string[] = packInfo[0].files.map((f: { path: string }) => f.path);
    expect(files).toContain("dist/index.min.js");
  });

  it("does not ship source files or node_modules", () => {
    const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: resolve("."),
      encoding: "utf-8",
      timeout: 30_000,
      shell: true,
    });
    const packInfo = JSON.parse(stdout);
    const files: string[] = packInfo[0].files.map((f: { path: string }) => f.path);
    const hasSrc = files.some((f) => f.startsWith("src/"));
    const hasNodeModules = files.some((f) => f.startsWith("node_modules/"));
    expect(hasSrc).toBe(false);
    expect(hasNodeModules).toBe(false);
  });
});
