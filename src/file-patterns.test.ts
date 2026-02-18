import { describe, it, expect } from "vitest";
import { detectLabels, filterIgnoredFiles } from "./file-patterns.js";

describe("detectLabels", () => {
  it("returns empty when no label patterns configured", () => {
    const result = detectLabels(["src/app.ts"], [], {});
    expect(result).toEqual([]);
  });

  it("detects a label when a file matches a pattern", () => {
    const result = detectLabels(
      ["/azure-pipelines.yml", "/src/app.ts"],
      [],
      { "azure-pipelines": ["**/azure-pipelines*.yml"] },
    );
    expect(result).toEqual(["azure-pipelines"]);
  });

  it("detects multiple labels from different rules", () => {
    const result = detectLabels(
      ["/azure-pipelines.yml", "/Dockerfile"],
      [],
      {
        "azure-pipelines": ["**/azure-pipelines*.yml"],
        "docker": ["**/Dockerfile", "**/docker-compose*.yml"],
      },
    );
    expect(result).toEqual(["azure-pipelines", "docker"]);
  });

  it("ignores files matching ignorePatterns before label matching", () => {
    const result = detectLabels(
      ["/src/Generated.designer.cs", "/src/appsettings.json"],
      ["**/*.designer.cs"],
      { "generated": ["**/*.designer.cs"] },
    );
    expect(result).toEqual([]);
  });

  it("matches appsettings files", () => {
    const result = detectLabels(
      ["/src/appsettings.json", "/src/appsettings.Production.json"],
      [],
      { "config-change": ["**/appsettings*.json"] },
    );
    expect(result).toEqual(["config-change"]);
  });

  it("skips labels when all changed files are ignored", () => {
    const result = detectLabels(
      ["/obj/Generated.cs"],
      ["**/obj/**"],
      { "csharp": ["**/*.cs"] },
    );
    expect(result).toEqual([]);
  });

  it("strips leading slashes for matching", () => {
    const result = detectLabels(
      ["/Dockerfile"],
      [],
      { "docker": ["Dockerfile"] },
    );
    expect(result).toEqual(["docker"]);
  });

  it("does not duplicate labels", () => {
    const result = detectLabels(
      ["/azure-pipelines.yml", "/azure-pipelines-ci.yml"],
      [],
      { "azure-pipelines": ["**/azure-pipelines*.yml"] },
    );
    expect(result).toEqual(["azure-pipelines"]);
  });
});

describe("filterIgnoredFiles", () => {
  it("returns all files when no ignore patterns", () => {
    const files = ["/src/app.ts", "/src/index.ts"];
    expect(filterIgnoredFiles(files, [])).toEqual(["src/app.ts", "src/index.ts"]);
  });

  it("filters out files matching ignore patterns", () => {
    const files = ["/src/app.ts", "/obj/Generated.cs", "/bin/output.dll"];
    const result = filterIgnoredFiles(files, ["**/obj/**", "**/bin/**"]);
    expect(result).toEqual(["src/app.ts"]);
  });

  it("filters generated designer files", () => {
    const files = ["/src/Form1.cs", "/src/Form1.designer.cs"];
    const result = filterIgnoredFiles(files, ["**/*.designer.cs"]);
    expect(result).toEqual(["src/Form1.cs"]);
  });
});
