# PR Review Needed

[![CI](https://github.com/meir017/ado-pr-review-needed/actions/workflows/ci.yml/badge.svg)](https://github.com/meir017/ado-pr-review-needed/actions/workflows/ci.yml)
[![GitHub npm package](https://img.shields.io/github/package-json/v/meir017/ado-pr-review-needed)](https://github.com/meir017/ado-pr-review-needed/pkgs/npm/pr-review-needed)

A TypeScript CLI tool that queries Azure DevOps for open pull requests and generates a markdown summary of PRs needing reviewer feedback — inspired by [dotnet/aspire#13834](https://github.com/dotnet/aspire/issues/13834).

## How It Works

1. Authenticates to Azure DevOps using `AzureCliCredential` (no PAT required)
2. Fetches all active, non-draft PRs (excluding those tagged `NO-MERGE`)
3. Analyzes comment threads, reviewer votes, and push activity to determine which PRs are waiting on reviewers
4. Generates a markdown file (or terminal dashboard) with PRs sorted by wait time

A PR is considered **"needing review"** when:
- It has **no approving vote** (vote ≥ 5)
- The **last meaningful activity** is from the PR author (the ball is in reviewers' court)
- Bot/service-account activity is ignored

## Prerequisites

- **Node.js 18+**
- **Azure CLI** — logged in via `az login`
- Access to the target Azure DevOps organization
- (Optional) **Microsoft Graph** access — for resolving team members from org hierarchy

## Installation

### Quick One-Liner

```bash
npm install -g @meir017/pr-review-needed --registry=https://npm.pkg.github.com
```

### From GitHub Packages

1. Create or edit an `.npmrc` file in your project (or home directory) to point the `@meir017` scope at the GitHub registry:

   ```
   @meir017:registry=https://npm.pkg.github.com
   ```

2. Authenticate with the GitHub npm registry (you need a [personal access token](https://github.com/settings/tokens) with `read:packages` scope):

   ```bash
   npm login --registry=https://npm.pkg.github.com
   ```

3. Install the package:

   ```bash
   npm install -g @meir017/pr-review-needed
   ```

4. Run the CLI:

   ```bash
   pr-review-needed setup
   pr-review-needed run
   ```

### From Source

```bash
git clone https://github.com/meir017/ado-pr-review-needed.git
cd ado-pr-review-needed
npm install
npm run build && npm run bundle
```

## Usage

### Setup

Generate a template configuration file in the current directory:

```bash
pr-review-needed setup
```

This creates a `pr-review-config.json` with placeholder values. Edit it to add your Azure DevOps repository URLs and team members.

### Run

```bash
# Generate pr-review-summary.md (default output)
pr-review-needed run

# Custom output path
pr-review-needed run --output docs/review-status.md

# Use a custom config file
pr-review-needed run --config path/to/my-config.json

# Interactive terminal dashboard
pr-review-needed run --dashboard

# Enable verbose debug logging
pr-review-needed run --verbose
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--output <path>` | Output file path (default: `pr-review-summary.md`) |
| `--config <path>` | Path to a custom config file (default: `pr-review-config.json` in project root) |
| `--dashboard` | Interactive terminal dashboard view |
| `--verbose` | Enable debug logging |
| `--notify` | Send notifications (default: true if webhooks configured) |
| `--no-notify` | Disable notifications |

## Configuration

The tool reads repository targets from `pr-review-config.json`. You can specify one or more Azure DevOps repository URLs:

```json
{
  "repositories": [
    { "url": "https://dev.azure.com/{org}/{project}/_git/{repo}" },
    { "url": "https://dev.azure.com/{org}/{project}/_git/{another-repo}", "skipRestartMerge": true }
  ],
  "orgManager": "manager@example.com",
  "teamMembers": ["alice@example.com", "bob@example.com"]
}
```

All supported ADO URL formats work:
- `https://dev.azure.com/{org}/{project}/_git/{repo}`
- `https://{org}.visualstudio.com/{project}/_git/{repo}`
- `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`

When multiple repositories are configured, the markdown output groups PRs by repository.

### Config Fields

| Field | Description |
|-------------|-------------|
| `repositories` | Array of repository objects (see below) |
| `orgManager` | (Optional) Manager UPN — recursively fetches the full org tree via MS Graph |
| `manager` | (Optional) Manager UPN — fetches only direct reports via MS Graph |
| `teamMembers` | (Optional) Explicit list of team member emails to scope PR results |
| `ignoreManagers` | (Optional) When `true`, hides PRs authored by managers (anyone with direct reports in the org tree) |
| `botUsers` | (Optional) Array of user emails, unique names, or display names to treat as bots. Their activity is ignored and their PRs get the APPROVE action. |
| `quantifier` | (Optional) PR size quantifier config — see [PR Quantifier](#pr-quantifier) below |
| `restartMergeAfterDays` | (Optional) Trigger "restart merge" on PRs older than this many days. Default: `30`. Set to `-1` to disable. |
| `staleness` | (Optional) Staleness alert configuration — see [Staleness Alerts](#staleness-alerts) below |
| `notifications` | (Optional) Teams notification configuration — see [Teams Notifications](#teams-notifications) below |

### Repository Object Fields

Each entry in the `repositories` array is an object with the following fields:

| Field | Description |
|-------|-------------|
| `url` | (Required) Full ADO repository URL |
| `skipRestartMerge` | (Optional) When `true`, skip restart-merge for this repository. Default: `false`. |

## Example Output

### Markdown

```markdown
## PRs Needing Review

_Last updated: 2025-02-09T10:00:00.000Z_

| PR | Author | Size | Waiting for feedback |
|---|---|---|---|
| [#1234 - Fix config parsing](https://dev.azure.com/...) ❌ | Alice | 🔴 XL | 🔴 5 days ago |
| [#1250 - Add new template](https://dev.azure.com/...) | Bob | 🟡 M | 🟡 2 days ago |
| [#1260 - Update docs](https://dev.azure.com/...) | Carol | 🟢 S | 🟢 3 hours ago |

_Total: 3 PRs needing review._
```

### Legend

| Icon | Meaning |
|------|---------|
| 🟢 | Waiting ≤ 1 day / Size XS or S |
| 🟡 | Waiting 2–3 days / Size M |
| 🔴 | Waiting > 3 days / Size L or XL |
| ❌ | Has merge conflicts |

## PR Quantifier

Inspired by [microsoft/PullRequestQuantifier](https://github.com/microsoft/PullRequestQuantifier), the tool can classify each PR by change size (XS, S, M, L, XL) based on total lines added + deleted. This helps encourage smaller, more reviewable PRs.

### Enabling the Quantifier

The quantifier is **enabled by default**. To disable it, add to your `pr-review-config.json`:

```json
{
  "quantifier": {
    "enabled": false
  }
}
```

To customize thresholds or file exclusions:

```json
{
  "repositories": ["..."],
  "quantifier": {
    "enabled": true,
    "excludedPatterns": ["package-lock.json", "*.generated.cs", "*.Designer.cs"],
    "thresholds": [
      { "label": "XS", "maxChanges": 10 },
      { "label": "S",  "maxChanges": 40 },
      { "label": "M",  "maxChanges": 100 },
      { "label": "L",  "maxChanges": 400 },
      { "label": "XL", "maxChanges": 1000 }
    ]
  }
}
```

### Quantifier Config Fields

| Field | Description |
|-------|-------------|
| `enabled` | (Optional) Set to `false` to disable. Defaults to `true`. |
| `excludedPatterns` | (Optional) Glob patterns for files to exclude from the change count (e.g., lockfiles, auto-generated code). |
| `thresholds` | (Optional) Custom size thresholds. Each entry has a `label` and `maxChanges`. Defaults to the PullRequestQuantifier standard (XS≤10, S≤40, M≤100, L≤400, XL≤1000). |

### How It Works

1. Fetches PR iteration changes from Azure DevOps to get the list of changed files
2. Filters out files matching `excludedPatterns`
3. Uses the ADO file diffs API to count lines added and deleted
4. Sums additions + deletions and maps to a size label using the configured thresholds
5. Displays the size label as a column in the markdown table and terminal dashboard

## Staleness Alerts

PRs are automatically tagged with staleness badges based on how long they have been waiting. This helps surface ancient PRs that need attention.

### Default Thresholds

| Badge | Min Days |
|-------|----------|
| ⚠️ Aging | 7 days |
| 🔴 Stale | 14 days |
| 💀 Abandoned | 30 days |

Staleness badges appear as a column in the markdown tables and inline in the terminal dashboard.

### Customizing Thresholds

```json
{
  "staleness": {
    "enabled": true,
    "thresholds": [
      { "label": "⏰ Overdue", "minDays": 3 },
      { "label": "🔥 Critical", "minDays": 14 }
    ]
  }
}
```

Set `"enabled": false` to disable staleness badges entirely. Defaults are applied when the `staleness` section is omitted.

## Review Metrics

The tool computes review cycle time metrics from existing PR thread and push data and adds a **📈 Review Metrics** section to the output:

- **Per-PR**: time to first review, number of review rounds, age
- **Aggregate**: median PR age, average time to first review, average review rounds, count of PRs with no review activity
- **Per-Author**: open PR count, average age, average rounds, fastest review time

The dashboard shows a compact aggregate summary.

## Reviewer Workload

A **👥 Reviewer Workload** section shows per-reviewer statistics to help identify bottlenecks:

| Column | Description |
|--------|-------------|
| Assigned | Total PRs where the reviewer is assigned |
| Pending | PRs in "needing review" where the reviewer hasn't approved |
| Completed | PRs where the reviewer voted to approve |
| Avg Response | Average time from PR creation to the reviewer's first comment |
| Load | 🟢 Light / 🟡 Medium / 🔴 Heavy indicator |

Default load thresholds: 🟢 ≤10 pending & ≤2d response, 🟡 ≤20 pending & ≤4d response, 🔴 above. The dashboard shows the top 5 bottleneck reviewers.

## Teams Notifications

Send PR review summaries to a Microsoft Teams channel via incoming webhook. Notifications are sent as Adaptive Cards with collapsible sections.

### Configuration

```json
{
  "notifications": {
    "teams": {
      "webhookUrl": "https://outlook.office.com/webhook/...",
      "filters": {
        "sections": ["needingReview", "waitingOnAuthor"]
      }
    }
  }
}
```

### Config Fields

| Field | Description |
|-------|-------------|
| `webhookUrl` | (Required) Teams incoming webhook URL |
| `filters.sections` | (Optional) Array of sections to include: `"approved"`, `"needingReview"`, `"waitingOnAuthor"`. Defaults to all. |
| `filters.minStalenessLevel` | (Optional) Only include PRs at or above this staleness level |

Notifications are sent automatically after generating the report. Use `--no-notify` to suppress, or `--notify` to explicitly enable.

## Running Tests

```bash
npm test

# With coverage
npx vitest run --coverage
```

## Project Structure

```
src/
├── index.ts                    # CLI entry point & argument parsing
├── ado-client.ts               # Azure DevOps authentication (multi-org)
├── config.ts                   # Configuration loading (multi-repo support)
├── fetch-prs.ts                # Fetch & filter open PRs
├── review-logic.ts             # Determine which PRs need review
├── pr-quantifier.ts            # PR size classification (XS/S/M/L/XL)
├── staleness.ts                # PR staleness badge computation
├── metrics.ts                  # Review cycle time metrics
├── reviewer-workload.ts        # Reviewer workload analysis
├── generate-markdown.ts        # Markdown table generation (grouped by repo)
├── dashboard.ts                # Interactive terminal dashboard
├── git-detect.ts               # Auto-detect ADO repo from git remote
├── graph-client.ts             # Microsoft Graph API for org/team resolution
├── restart-merge.ts            # Restart merge for stale PRs
├── file-patterns.ts            # Glob pattern matching for file labels
├── concurrency.ts              # Batched concurrent operations
├── retry.ts                    # Retry with exponential backoff
├── log.ts                      # Structured colored logging
├── types.ts                    # Shared type definitions
├── notifications/
│   ├── index.ts                # Notification orchestrator
│   └── teams.ts                # Teams Adaptive Card formatter
└── *.test.ts                   # Test files (vitest)
```
