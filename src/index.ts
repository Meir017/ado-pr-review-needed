// Suppress url.parse() deprecation from azure-devops-node-api (DEP0169)
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "DeprecationWarning" || (w as NodeJS.ErrnoException).code !== "DEP0169") console.warn(w); });

import { Command } from "commander";
import { getVersion, runSetup, runMarkdownExport } from "./pipeline.js";
import type { CliArgs } from "./pipeline.js";
import * as log from "./log.js";

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
  .option("--format <type>", "Output format: markdown, json, html, terminal", "markdown")
  .option("--webhook-url <url>", "Send JSON report to webhook URL")
  .option("--verbose", "Enable debug logging", false)
  .option("--notify", "Send notifications (default: true if webhooks configured)")
  .option("--no-notify", "Disable notifications")
  .option("--nudge", "Send nudge comments on stale PRs (default: true if configured)")
  .option("--no-nudge", "Disable auto-nudge comments")
  .option("--dry-run", "Log actions without making changes", false)
  .action(async (opts: CliArgs) => {
    await runMarkdownExport(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
