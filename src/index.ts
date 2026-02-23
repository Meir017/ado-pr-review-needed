// Suppress url.parse() deprecation from azure-devops-node-api (DEP0169)
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "DeprecationWarning" || (w as NodeJS.ErrnoException).code !== "DEP0169") console.warn(w); });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { getGitApiForOrg } from "./ado-client.js";
import { getMultiRepoConfig } from "./config.js";
import { fetchOpenPullRequests, applyDetectedLabels } from "./fetch-prs.js";
import { restartMergeForStalePrs } from "./automation/restart-merge.js";
import { analyzePrs, mergeAnalysisResults } from "./analysis/review-logic.js";
import { generateMarkdown } from "./reporting/generate-markdown.js";
import { renderDashboard } from "./reporting/dashboard.js";
import { computeReviewMetrics } from "./metrics.js";
import { computeReviewerWorkload } from "./reviewer-workload.js";
import { sendNotifications } from "./automation/notifications/index.js";
import { buildJsonReport, writeJsonOutput, sendWebhookPayload } from "./reporting/api-output.js";
import { runAutoNudge } from "./automation/auto-nudge.js";
import { generateHtmlReport } from "./reporting/html-report/generate-html.js";
import type { AnalysisResult, PullRequestInfo, JsonRepoReport } from "./types.js";
import { computeSummaryStats, computeRepoSummaryStats } from "./types.js";
import { runConcurrent, DEFAULT_CONCURRENCY } from "./concurrency.js";
import { withRetry } from "./retry.js";
import * as log from "./log.js";
import type { RepoTarget } from "./config.js";
import { computeStalenessBadge } from "./analysis/staleness.js";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";

const TEMPLATE_CONFIG = {
  $schema: "https://raw.githubusercontent.com/Meir017/ado-pr-review-needed/main/pr-review-config.schema.json",
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
  notify?: boolean;
  format?: string;
  webhookUrl?: string;
  nudge?: boolean;
  dryRun?: boolean;
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

function buildRepoReport(
  r: RepoResult,
  multiConfig: import("./config.js").MultiRepoConfig,
): JsonRepoReport {
  const metrics = computeReviewMetrics(r.prs, multiConfig.botUsers);
  const workload = computeReviewerWorkload(r.prs, r.analysis, multiConfig.botUsers);

  let staleness: Record<string, number> | undefined;
  if (multiConfig.staleness.enabled) {
    staleness = {};
    const allCategorized = [
      ...r.analysis.approved.map((pr) => pr.createdDate),
      ...r.analysis.needingReview.map((pr) => pr.waitingSince),
      ...r.analysis.waitingOnAuthor.map((pr) => pr.lastReviewerActivityDate),
    ];
    for (const date of allCategorized) {
      const badge = computeStalenessBadge(date, multiConfig.staleness.thresholds);
      if (badge) {
        staleness[badge] = (staleness[badge] ?? 0) + 1;
      }
    }
  }

  return {
    repoLabel: r.repoLabel,
    analysis: r.analysis,
    metrics,
    workload,
    staleness,
    stats: computeRepoSummaryStats(r.repoLabel, r.analysis, r.restarted, r.restartFailed),
  };
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

interface ProcessRepoOptions {
  repo: RepoTarget;
  isMultiRepo: boolean;
  restartMergeAfterDays: number;
  quantifierConfig: import("./types.js").QuantifierConfig | undefined;
  teamMembers: Set<string>;
  ignoredUsers: Set<string>;
  botUsers: Set<string>;
}

async function processRepo(options: ProcessRepoOptions): Promise<RepoResult> {
  const { repo, isMultiRepo, restartMergeAfterDays, quantifierConfig, teamMembers, ignoredUsers, botUsers } = options;
  const repoLabel = `${repo.project}/${repo.repository}`;
  log.info(`Fetching open PRs from ${repoLabel}…`);
  const startFetch = Date.now();
  // Merge repo-level ignore patterns with quantifier excludedPatterns
  let effectiveQuantifier = quantifierConfig;
  if (quantifierConfig && repo.patterns.ignore.length > 0) {
    effectiveQuantifier = {
      ...quantifierConfig,
      excludedPatterns: [...quantifierConfig.excludedPatterns, ...repo.patterns.ignore],
    };
  }

  const gitApi = await getGitApiForOrg(repo.orgUrl);
  const prs = await fetchOpenPullRequests(
    gitApi, repo.repository, repo.project, repo.orgUrl,
    effectiveQuantifier, repo.patterns,
  );
  log.success(`Fetched ${prs.length} candidate PRs from ${repoLabel} (${Date.now() - startFetch}ms)`);

  await applyDetectedLabels(gitApi, repo.repository, repo.project, prs);

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

interface PipelineResult {
  multiConfig: import("./config.js").MultiRepoConfig;
  repos: RepoTarget[];
  isMultiRepo: boolean;
  results: RepoResult[];
  merged: AnalysisResult;
  stats: import("./types.js").SummaryStats;
  allPrs: PullRequestInfo[];
  metrics: import("./metrics.js").ReviewMetrics;
  workload: import("./reviewer-workload.js").ReviewerWorkload[];
  totalPrs: number;
  totalRestarted: number;
  totalRestartFailed: number;
}

async function runPipeline(configPath?: string): Promise<PipelineResult> {
  log.info("Loading configuration…");
  const multiConfig = await getMultiRepoConfig(configPath);
  const repos = multiConfig.repos;
  const isMultiRepo = repos.length > 1;

  log.info("Authenticating to Azure DevOps…");
  const startAuth = Date.now();
  const uniqueOrgs = [...new Set(repos.map((r) => r.orgUrl))];
  for (const orgUrl of uniqueOrgs) {
    await getGitApiForOrg(orgUrl);
  }
  log.success(`Authenticated to ${uniqueOrgs.join(", ")} (${Date.now() - startAuth}ms)`);

  let totalPrs = 0;
  let totalRestarted = 0;
  let totalRestartFailed = 0;

  log.info(`Processing ${repos.length} repo(s) (concurrency: ${DEFAULT_CONCURRENCY})…`);
  const results = await runConcurrent(repos, DEFAULT_CONCURRENCY, (repo) =>
    processRepo({ repo, isMultiRepo, restartMergeAfterDays: multiConfig.restartMergeAfterDays, quantifierConfig: multiConfig.quantifier, teamMembers: multiConfig.teamMembers, ignoredUsers: multiConfig.ignoredUsers, botUsers: multiConfig.botUsers }),
  );

  for (const r of results) {
    totalPrs += r.prs.length;
    totalRestarted += r.restarted;
    totalRestartFailed += r.restartFailed;
  }

  const merged = mergeAnalysisResults(results.map((r) => r.analysis));
  const repoStats = results.map((r) => computeRepoSummaryStats(r.repoLabel, r.analysis, r.restarted, r.restartFailed));
  const stats = computeSummaryStats(merged, totalRestarted, totalRestartFailed, repoStats);
  const allPrs = results.flatMap((r) => r.prs);
  const metrics = computeReviewMetrics(allPrs, multiConfig.botUsers);
  const workload = computeReviewerWorkload(allPrs, merged, multiConfig.botUsers);

  return { multiConfig, repos, isMultiRepo, results, merged, stats, allPrs, metrics, workload, totalPrs, totalRestarted, totalRestartFailed };
}

async function runDashboard(verbose: boolean, configPath?: string): Promise<void> {
  log.setVerbose(verbose);

  const { multiConfig, repos, isMultiRepo, merged, stats, metrics, workload } = await runPipeline(configPath);

  const repoLabel = isMultiRepo
    ? `${repos.length} repositories`
    : `${repos[0].project}/${repos[0].repository}`;
  const output = renderDashboard({ analysis: merged, repoLabel, multiRepo: isMultiRepo, stats, staleness: multiConfig.staleness, metrics, workload });
  console.log(output);

  if (multiConfig.notifications) {
    await sendNotifications(merged, stats, multiConfig.notifications, multiConfig.staleness);
  }
}

async function runMarkdownExport(args: CliArgs): Promise<void> {
  log.setVerbose(args.verbose);
  log.heading("PR Review Needed");

  const { multiConfig, repos, isMultiRepo, results, merged, stats, metrics, workload, totalPrs } = await runPipeline(args.config);

  for (const r of results) {
    log.success(`${r.repoLabel}: ${r.analysis.approved.length} approved, ${r.analysis.needingReview.length} needing review, ${r.analysis.waitingOnAuthor.length} waiting on author`);
  }

  const format = args.format ?? "markdown";

  if (format === "json" || format === "html") {
    const repoReports = results.map((r) => buildRepoReport(r, multiConfig));
    const jsonReport = buildJsonReport(repoReports, getVersion());

    if (format === "html") {
      log.info("Generating HTML report…");
      const html = generateHtmlReport(jsonReport);
      const outputPath = args.output === "pr-review-summary.md" ? "pr-review-summary.html" : args.output;
      writeFileSync(resolve(outputPath), html, "utf-8");
      log.success(`HTML report written to ${resolve(outputPath)}`);
    } else {
      log.info("Generating JSON report…");
      const outputPath = args.output === "pr-review-summary.md" ? "pr-review-summary.json" : args.output;
      await writeJsonOutput(jsonReport, resolve(outputPath));
    }

    const webhookConfig = args.webhookUrl
      ? { url: args.webhookUrl }
      : multiConfig.webhook;
    if (webhookConfig) {
      await sendWebhookPayload(jsonReport, webhookConfig);
    }
  } else {
    log.info("Generating markdown…");
    const markdown = generateMarkdown({ analysis: merged, multiRepo: isMultiRepo, stats, staleness: multiConfig.staleness, metrics, workload });

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
  log.summary("Output file", resolve(args.output));
  console.log();

  if (args.notify !== false && multiConfig.notifications) {
    await sendNotifications(merged, stats, multiConfig.notifications, multiConfig.staleness);
  }

  // Auto-nudge stale PRs
  const nudgeConfig = multiConfig.autoNudge;
  if (nudgeConfig && args.nudge !== false) {
    if (args.dryRun) nudgeConfig.dryRun = true;
    await runAutoNudge(merged, multiConfig.staleness, nudgeConfig);
  }
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
  .option("--format <type>", "Output format: markdown, json, html", "markdown")
  .option("--webhook-url <url>", "Send JSON report to webhook URL")
  .option("--dashboard", "Interactive terminal dashboard view", false)
  .option("--verbose", "Enable debug logging", false)
  .option("--notify", "Send notifications (default: true if webhooks configured)")
  .option("--no-notify", "Disable notifications")
  .option("--nudge", "Send nudge comments on stale PRs (default: true if configured)")
  .option("--no-nudge", "Disable auto-nudge comments")
  .option("--dry-run", "Log actions without making changes", false)
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
