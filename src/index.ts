// Suppress url.parse() deprecation from azure-devops-node-api (DEP0169)
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "DeprecationWarning" || (w as NodeJS.ErrnoException).code !== "DEP0169") console.warn(w); });

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getGitApiForOrg } from "./ado-client.js";
import { getMultiRepoConfig } from "./config.js";
import { fetchOpenPullRequests } from "./fetch-prs.js";
import { restartMergeForStalePrs } from "./restart-merge.js";
import { analyzePrs, mergeAnalysisResults } from "./review-logic.js";
import { generateMarkdown } from "./generate-markdown.js";
import { renderDashboard } from "./dashboard.js";
import type { AnalysisResult, PullRequestInfo } from "./types.js";
import { computeSummaryStats } from "./types.js";
import { runConcurrent, DEFAULT_CONCURRENCY } from "./concurrency.js";
import { withRetry } from "./retry.js";
import * as log from "./log.js";
import type { RepoTarget } from "./config.js";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";

interface CliArgs {
  output: string;
  dryRun: boolean;
  verbose: boolean;
  dashboard: boolean;
  config?: string;
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
      case "--config":
        args.config = argv[++i];
        break;
    }
  }

  return args;
}

interface RepoResult {
  repoLabel: string;
  prs: PullRequestInfo[];
  analysis: AnalysisResult;
  restarted: number;
  restartFailed: number;
}

/**
 * Re-fetch mergeStatus for PRs that had their merge restarted.
 * Updates the prs array in-place.
 */
async function refreshMergeStatus(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  prs: PullRequestInfo[],
  restartedPrIds: number[],
): Promise<void> {
  if (restartedPrIds.length === 0) return;

  const idSet = new Set(restartedPrIds);
  const toRefresh = prs.filter((pr) => idSet.has(pr.id));

  log.info(`Refreshing merge status for ${toRefresh.length} restarted PR(s)…`);
  for (const pr of toRefresh) {
    try {
      const updated = await withRetry(`Refresh merge status for PR #${pr.id}`, () =>
        gitApi.getPullRequestById(pr.id, project),
      );
      if (updated.mergeStatus !== undefined) {
        pr.mergeStatus = updated.mergeStatus;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`  #${pr.id} — failed to refresh merge status: ${msg}`);
    }
  }
}

async function processRepo(
  repo: RepoTarget,
  isMultiRepo: boolean,
  restartMergeAfterDays: number,
  skipRestartMergeRepositories: Set<string>,
  quantifierConfig: import("./types.js").QuantifierConfig | undefined,
  teamMembers: Set<string>,
  ignoredUsers: Set<string>,
  botUsers: Set<string>,
): Promise<RepoResult> {
  const repoLabel = `${repo.project}/${repo.repository}`;
  log.info(`Fetching open PRs from ${repoLabel}…`);
  const startFetch = Date.now();
  const gitApi = await getGitApiForOrg(repo.orgUrl);
  const prs = await fetchOpenPullRequests(gitApi, repo.repository, repo.project, repo.orgUrl, quantifierConfig);
  log.success(`Fetched ${prs.length} candidate PRs from ${repoLabel} (${Date.now() - startFetch}ms)`);

  const shouldSkipRestart = skipRestartMergeRepositories.has(repo.repository.toLowerCase());
  const effectiveDays = shouldSkipRestart ? -1 : restartMergeAfterDays;
  if (shouldSkipRestart) {
    log.debug(`Skipping restart-merge for ${repoLabel} (configured in skipRestartMergeRepositories)`);
  }
  const restartResult = await restartMergeForStalePrs(gitApi, repo.repository, repo.project, prs, effectiveDays);
  await refreshMergeStatus(gitApi, repo.repository, repo.project, prs, restartResult.restartedPrIds);

  const analysis = analyzePrs(prs, teamMembers, isMultiRepo ? repoLabel : undefined, ignoredUsers, botUsers);
  return {
    repoLabel,
    prs,
    analysis,
    restarted: restartResult.restarted,
    restartFailed: restartResult.failed,
  };
}

async function runDashboard(verbose: boolean, configPath?: string): Promise<void> {
  log.setVerbose(verbose);

  log.info("Loading configuration…");
  const multiConfig = await getMultiRepoConfig(configPath);
  const repos = multiConfig.repos;
  const isMultiRepo = repos.length > 1;

  log.info("Authenticating to Azure DevOps…");
  const uniqueOrgs = [...new Set(repos.map((r) => r.orgUrl))];
  for (const orgUrl of uniqueOrgs) {
    await getGitApiForOrg(orgUrl);
  }

  const allAnalyses: AnalysisResult[] = [];
  let totalRestarted = 0;
  let totalRestartFailed = 0;

  log.info(`Processing ${repos.length} repo(s) (concurrency: ${DEFAULT_CONCURRENCY})…`);
  const results = await runConcurrent(repos, DEFAULT_CONCURRENCY, (repo) =>
    processRepo(repo, isMultiRepo, multiConfig.restartMergeAfterDays, multiConfig.skipRestartMergeRepositories, multiConfig.quantifier, multiConfig.teamMembers, multiConfig.ignoredUsers, multiConfig.botUsers),
  );

  for (const r of results) {
    allAnalyses.push(r.analysis);
    totalRestarted += r.restarted;
    totalRestartFailed += r.restartFailed;
  }

  const merged = mergeAnalysisResults(allAnalyses);
  const stats = computeSummaryStats(merged, totalRestarted, totalRestartFailed);
  const repoLabel = isMultiRepo
    ? `${repos.length} repositories`
    : `${repos[0].project}/${repos[0].repository}`;
  const output = renderDashboard(merged, repoLabel, isMultiRepo, stats);
  console.log(output);
}

async function runMarkdownExport(args: CliArgs): Promise<void> {
  log.setVerbose(args.verbose);
  log.heading("PR Review Needed");

  log.info("Loading configuration…");
  const multiConfig = await getMultiRepoConfig(args.config);
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
  let totalRestarted = 0;
  let totalRestartFailed = 0;

  log.info(`Processing ${repos.length} repo(s) (concurrency: ${DEFAULT_CONCURRENCY})…`);
  const results = await runConcurrent(repos, DEFAULT_CONCURRENCY, (repo) =>
    processRepo(repo, isMultiRepo, multiConfig.restartMergeAfterDays, multiConfig.skipRestartMergeRepositories, multiConfig.quantifier, multiConfig.teamMembers, multiConfig.ignoredUsers, multiConfig.botUsers),
  );

  for (const r of results) {
    allAnalyses.push(r.analysis);
    totalPrs += r.prs.length;
    totalRestarted += r.restarted;
    totalRestartFailed += r.restartFailed;
    log.success(`${r.repoLabel}: ${r.analysis.approved.length} approved, ${r.analysis.needingReview.length} needing review, ${r.analysis.waitingOnAuthor.length} waiting on author`);
  }

  const merged = mergeAnalysisResults(allAnalyses);
  const stats = computeSummaryStats(merged, totalRestarted, totalRestartFailed);

  log.info("Generating markdown…");
  const markdown = generateMarkdown(merged, isMultiRepo, stats);

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
    await runDashboard(args.verbose, args.config);
  } else {
    await runMarkdownExport(args);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
