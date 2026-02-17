import { describe, it, expect } from "vitest";
import { parseAdoRemote } from "./git-detect.js";

describe("parseAdoRemote", () => {
  it("parses https dev.azure.com remote", () => {
    const result = parseAdoRemote("https://dev.azure.com/microsoft/WDATP/_git/MyRepo");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/microsoft",
      project: "WDATP",
      repository: "MyRepo",
    });
  });

  it("parses https dev.azure.com remote with credentials", () => {
    const result = parseAdoRemote("https://user@dev.azure.com/microsoft/WDATP/_git/MyRepo");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/microsoft",
      project: "WDATP",
      repository: "MyRepo",
    });
  });

  it("parses https visualstudio.com remote", () => {
    const result = parseAdoRemote("https://microsoft.visualstudio.com/WDATP/_git/MyRepo");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/microsoft",
      project: "WDATP",
      repository: "MyRepo",
    });
  });

  it("parses SSH dev.azure.com remote", () => {
    const result = parseAdoRemote("git@ssh.dev.azure.com:v3/microsoft/WDATP/MyRepo");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/microsoft",
      project: "WDATP",
      repository: "MyRepo",
    });
  });

  it("parses SSH vs-ssh.visualstudio.com remote", () => {
    const result = parseAdoRemote("microsoft@vs-ssh.visualstudio.com:v3/microsoft/WDATP/MyRepo");
    expect(result).toEqual({
      orgUrl: "https://dev.azure.com/microsoft",
      project: "WDATP",
      repository: "MyRepo",
    });
  });

  it("returns null for GitHub remote", () => {
    expect(parseAdoRemote("https://github.com/dotnet/aspire.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAdoRemote("")).toBeNull();
  });
});
