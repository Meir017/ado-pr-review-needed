// Suppress url.parse() deprecation from azure-devops-node-api (DEP0169)
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "DeprecationWarning" || (w as any).code !== "DEP0169") console.warn(w); });

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAdoClient, getGitApiForOrg } from "./ado-client.js";
import { getMultiRepoConfig } from "./config.js";
import { fetchOpenPullRequests } from "./fetch-prs.js";
import { analyzePrs, mergeAnalysisResults } from "./review-logic.js";
import { generateMarkdown } from "./generate-markdown.js";
import { renderDashboard } from "./dashboard.js";
import type { AnalysisResult } from "./types.js";
import * as log from "./log.js";

interface CliArgs {
  output: string;
  dryRun: boolean;
  verbose: boolean;
  dashboard: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: "pr-review-summary.md",
    dryRun: false,
    verbose: false,
    dashboard: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--output":
        args.output = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--dashboard":
        args.dashboard = true;
        break;
    }
  }

  return args;
}

async function runDashboard(verbose: boolean): Promise<void> {
  log.setVerbose(verbose);

  log.info("Loading configuration…");
  const multiConfig = await getMultiRepoConfig();
  const repos = multiConfig.repos;
  const isMultiRepo = repos.length > 1;

  log.info("Authenticating to Azure DevOps…");
  const uniqueOrgs = [...new Set(repos.map((r) => r.orgUrl))];
  for (const orgUrl of uniqueOrgs) {
    await getGitApiForOrg(orgUrl);
  }

  const allAnalyses: AnalysisResult[] = [];

  for (const repo of repos) {
    const repoLabel = `${repo.project}/${repo.repository}`;
    log.info(`Fetching open PRs from ${repoLabel}…`);
    const gitApi = await getGitApiForOrg(repo.orgUrl);
    const prs = await fetchOpenPullRequests(gitApi, repo.repository, repo.project, repo.orgUrl);
    const analysis = analyzePrs(prs, multiConfig.teamMembers, isMultiRepo ? repoLabel : undefined, multiConfig.ignoredUsers);
    allAnalyses.push(analysis);
  }

  const merged = mergeAnalysisResults(allAnalyses);
  const repoLabel = isMultiRepo
    ? `${repos.length} repositories`
    : `${repos[0].project}/${repos[0].repository}`;
  const output = renderDashboard(merged, repoLabel, isMultiRepo);
  console.log(output);
}

async function runMarkdownExport(args: CliArgs): Promise<void> {
  log.setVerbose(args.verbose);
  log.heading("PR Review Needed");

  log.info("Loading configuration…");
  const multiConfig = await getMultiRepoConfig();
  const repos = multiConfig.repos;
  const isMultiRepo = repos.length > 1;

  log.info("Authenticating to Azure DevOps via AzureCliCredential…");
  const startAuth = Date.now();
  // Pre-warm connections for all unique orgs
  const uniqueOrgs = [...new Set(repos.map((r) => r.orgUrl))];
  for (const orgUrl of uniqueOrgs) {
    await getGitApiForOrg(orgUrl);
  }
  log.success(`Authenticated to ${uniqueOrgs.join(", ")} (${Date.now() - startAuth}ms)`);

  const allAnalyses: AnalysisResult[] = [];
  let totalPrs = 0;

  for (const repo of repos) {
    const repoLabel = `${repo.project}/${repo.repository}`;
    log.info(`Fetching PRs from ${repoLabel}…`);
    const startFetch = Date.now();
    const gitApi = await getGitApiForOrg(repo.orgUrl);
    const prs = await fetchOpenPullRequests(gitApi, repo.repository, repo.project, repo.orgUrl);
    log.success(`Fetched ${prs.length} candidate PRs from ${repoLabel} (${Date.now() - startFetch}ms)`);
    totalPrs += prs.length;

    log.info(`Analyzing review status for ${repoLabel}…`);
    const analysis = analyzePrs(prs, multiConfig.teamMembers, isMultiRepo ? repoLabel : undefined, multiConfig.ignoredUsers);
    allAnalyses.push(analysis);
    log.success(`${repoLabel}: ${analysis.approved.length} approved, ${analysis.needingReview.length} needing review, ${analysis.waitingOnAuthor.length} waiting on author`);
  }

  const merged = mergeAnalysisResults(allAnalyses);

  log.info("Generating markdown…");
  const markdown = generateMarkdown(merged, isMultiRepo);

  if (args.dryRun) {
    log.info("Dry-run mode — printing to stdout:\n");
    console.log(markdown);
  } else {
    const outputPath = resolve(args.output);
    writeFileSync(outputPath, markdown, "utf-8");
    log.success(`Output written to ${outputPath}`);
  }

  log.heading("Summary");
  log.summary("Repositories", repos.length);
  log.summary("PRs analyzed", totalPrs);
  log.summary("Approved", merged.approved.length);
  log.summary("Needing review", merged.needingReview.length);
  log.summary("Waiting on author", merged.waitingOnAuthor.length);
  if (!args.dryRun) log.summary("Output file", resolve(args.output));
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.dashboard) {
    await runDashboard(args.verbose);
  } else {
    await runMarkdownExport(args);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
