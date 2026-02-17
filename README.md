# PR Review Needed

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

## Setup

```bash
npm install
```

## Usage

```bash
# Generate pr-review-summary.md (default output)
npm start

# Custom output path
npm start -- --output docs/review-status.md

# Use a custom config file
npm start -- --config path/to/my-config.json

# Print to stdout without writing a file
npm start -- --dry-run

# Interactive terminal dashboard
npm start -- --dashboard

# Enable verbose debug logging
npm start -- --verbose
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--output <path>` | Output file path (default: `pr-review-summary.md`) |
| `--config <path>` | Path to a custom config file (default: `pr-review-config.json` in project root) |
| `--dry-run` | Print markdown to stdout only |
| `--dashboard` | Interactive terminal dashboard view |
| `--verbose` | Enable debug logging |

## Configuration

The tool reads repository targets from `pr-review-config.json`. You can specify one or more Azure DevOps repository URLs:

```json
{
  "repositories": [
    "https://dev.azure.com/{org}/{project}/_git/{repo}",
    "https://dev.azure.com/{org}/{project}/_git/{another-repo}"
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

<details>
<summary>Legacy single-repo format (still supported)</summary>

```json
{
  "orgUrl": "https://dev.azure.com/{org}",
  "project": "{project}",
  "repository": "{repo}"
}
```
</details>

### Config Fields

| Field | Description |
|-------------|-------------|
| `repositories` | Array of full ADO repository URLs |
| `orgManager` | (Optional) Manager UPN — recursively fetches the full org tree via MS Graph |
| `manager` | (Optional) Manager UPN — fetches only direct reports via MS Graph |
| `teamMembers` | (Optional) Explicit list of team member emails to scope PR results |
| `ignoreManagers` | (Optional) When `true`, hides PRs authored by managers (anyone with direct reports in the org tree) |
| `quantifier` | (Optional) PR size quantifier config — see [PR Quantifier](#pr-quantifier) below |

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
├── generate-markdown.ts        # Markdown table generation (grouped by repo)
├── dashboard.ts                # Interactive terminal dashboard
├── git-detect.ts               # Auto-detect ADO repo from git remote
├── graph-client.ts             # Microsoft Graph API for org/team resolution
├── retry.ts                    # Retry with exponential backoff
├── log.ts                      # Structured colored logging
├── types.ts                    # Shared type definitions
├── review-logic.test.ts        # Tests for review logic
├── generate-markdown.test.ts   # Tests for markdown generation
├── git-detect.test.ts          # Tests for ADO URL parsing
└── pr-quantifier.test.ts       # Tests for PR size classification
```
