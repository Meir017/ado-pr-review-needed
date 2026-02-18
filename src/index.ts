// Suppress url.parse() deprecation from azure-devops-node-api (DEP0169)
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "DeprecationWarning" || (w as NodeJS.ErrnoException).code !== "DEP0169") console.warn(w); });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
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

const TEMPLATE_CONFIG = {
  repositories: [
    { url: "https://dev.azure.com/{org}/{project}/_git/{repo}" },
  ],
  orgManager: null,
  teamMembers: [],
  ignoreManagers: false,
};

function getVersion(): string {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface CliArgs {
  output: string;
  verbose: boolean;
  dashboard: boolean;
  config?: string;
}

function runSetup(): void {
  const configPath = resolve("pr-review-config.json");
  if (existsSync(configPath)) {
    log.warn(`Config file already exists: ${configPath}`);
    log.info("Remove or rename the existing file and try again.");
    process.exit(1);
  }
  writeFileSync(configPath, JSON.stringify(TEMPLATE_CONFIG, null, 2) + "\n", "utf-8");
  log.success(`Created template config: ${configPath}`);
  log.info("Edit the file to add your Azure DevOps repository URLs and team members.");
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

  const effectiveDays = repo.skipRestartMerge ? -1 : restartMergeAfterDays;
  if (repo.skipRestartMerge) {
    log.debug(`Skipping restart-merge for ${repoLabel} (configured per repository)`);
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
    processRepo(repo, isMultiRepo, multiConfig.restartMergeAfterDays, multiConfig.quantifier, multiConfig.teamMembers, multiConfig.ignoredUsers, multiConfig.botUsers),
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
    processRepo(repo, isMultiRepo, multiConfig.restartMergeAfterDays, multiConfig.quantifier, multiConfig.teamMembers, multiConfig.ignoredUsers, multiConfig.botUsers),
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

  const outputPath = resolve(args.output);
  writeFileSync(outputPath, markdown, "utf-8");
  log.success(`Output written to ${outputPath}`);

  log.heading("Summary");
  log.summary("Repositories", repos.length);
  log.summary("PRs analyzed", totalPrs);
  log.summary("Approved", merged.approved.length);
  log.summary("Needing review", merged.needingReview.length);
  log.summary("Waiting on author", merged.waitingOnAuthor.length);
  log.summary("Output file", resolve(args.output));
  console.log();
}

const program = new Command()
  .name("pr-review-needed")
  .description("Generates a markdown summary of Azure DevOps PRs needing review")
  .version(getVersion());

program
  .command("setup")
  .description("Generate a template pr-review-config.json in the current directory")
  .action(() => {
    runSetup();
  });

program
  .command("run")
  .description("Analyze PRs and generate a markdown summary or dashboard")
  .option("--output <path>", "Output file path", "pr-review-summary.md")
  .option("--config <path>", "Path to a custom config file")
  .option("--dashboard", "Interactive terminal dashboard view", false)
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts: CliArgs) => {
    if (opts.dashboard) {
      await runDashboard(opts.verbose, opts.config);
    } else {
      await runMarkdownExport(opts);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
