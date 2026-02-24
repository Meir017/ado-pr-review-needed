import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// runSetup resolves config path relative to cwd, so we change cwd for tests
describe("e2e: setup command", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pr-review-setup-"));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a template config file", async () => {
    // Dynamically import to get fresh module in test context
    const { runSetup } = await import("../pipeline.js");

    runSetup();

    const configPath = join(testDir, "pr-review-config.json");
    expect(existsSync(configPath)).toBe(true);

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content).toHaveProperty("repositories");
    expect(content).toHaveProperty("teamMembers");
    expect(content.repositories).toHaveLength(1);
    expect(content.repositories[0].url).toContain("dev.azure.com");
  });

  it("exits with error if config already exists", async () => {
    const { runSetup } = await import("../pipeline.js");

    // Pre-create the config file
    writeFileSync(join(testDir, "pr-review-config.json"), "{}", "utf-8");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    expect(() => runSetup()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// Need vi import for spy
import { vi } from "vitest";
