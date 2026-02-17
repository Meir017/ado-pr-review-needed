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

## Example Output

### Markdown

```markdown
## PRs Needing Review

_Last updated: 2025-02-09T10:00:00.000Z_

| PR | Author | Waiting for feedback |
|---|---|---|
| [#1234 - Fix config parsing](https://dev.azure.com/...) ❌ | Alice | 🔴 5 days ago |
| [#1250 - Add new template](https://dev.azure.com/...) | Bob | 🟡 2 days ago |
| [#1260 - Update docs](https://dev.azure.com/...) | Carol | 🟢 3 hours ago |

_Total: 3 PRs needing review._
```

### Legend

| Icon | Meaning |
|------|---------|
| 🟢 | Waiting ≤ 1 day |
| 🟡 | Waiting 2–3 days |
| 🔴 | Waiting > 3 days |
| ❌ | Has merge conflicts |

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
├── generate-markdown.ts        # Markdown table generation (grouped by repo)
├── dashboard.ts                # Interactive terminal dashboard
├── git-detect.ts               # Auto-detect ADO repo from git remote
├── graph-client.ts             # Microsoft Graph API for org/team resolution
├── retry.ts                    # Retry with exponential backoff
├── log.ts                      # Structured colored logging
├── types.ts                    # Shared type definitions
└── __tests__/
    ├── review-logic.test.ts    # Tests for review logic
    ├── generate-markdown.test.ts # Tests for markdown generation
    └── git-detect.test.ts      # Tests for ADO URL parsing
```
