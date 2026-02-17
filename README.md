# PR Review Needed

A TypeScript CLI tool that queries Azure DevOps for open pull requests and generates a markdown summary of PRs needing reviewer feedback — inspired by [dotnet/aspire#13834](https://github.com/dotnet/aspire/issues/13834).

## How It Works

The tool:

1. Authenticates to Azure DevOps using `AzureCliCredential` (no PAT required)
2. Fetches all active, non-draft PRs (excluding those tagged `NO-MERGE`)
3. Analyzes comment threads, reviewer votes, and push activity to determine which PRs are waiting on reviewers
4. Generates a markdown file with a table of PRs sorted by wait time

A PR is considered **"needing review"** when:
- It has **no approving vote** (vote ≥ 5)
- The **last meaningful activity** is from the PR author (the ball is in reviewers' court)
- Bot/service-account activity is ignored

## Prerequisites

- **Node.js 18+**
- **Azure CLI** — logged in via `az login`
- Access to the target Azure DevOps organization

## Setup

```bash
cd Tools/PrReviewNeeded
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

# Enable verbose debug logging
npm start -- --verbose
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--output <path>` | Output file path (default: `pr-review-summary.md`) |
| `--config <path>` | Path to a custom config file (default: `pr-review-config.json` in project root) |
| `--dry-run` | Print markdown to stdout only |
| `--verbose` | Enable debug logging |

## Configuration

The tool reads repository targets from `pr-review-config.json`. You can specify one or more Azure DevOps repository URLs:

```json
{
  "repositories": [
    "https://dev.azure.com/microsoft/WDATP/_git/Wcd.Infra.ConfigurationGeneration",
    "https://dev.azure.com/microsoft/WDATP/_git/AnotherRepo"
  ],
  "orgManager": "manager@microsoft.com",
  "teamMembers": []
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
  "orgUrl": "https://dev.azure.com/microsoft",
  "project": "WDATP",
  "repository": "Wcd.Infra.ConfigurationGeneration"
}
```
</details>

| Config Field | Description |
|-------------|-------------|
| `repositories` | Array of full ADO repository URLs |
| `orgManager` | (Optional) Manager UPN — recursively fetches org tree from MS Graph |
| `manager` | (Optional) Manager UPN — fetches direct reports from MS Graph |
| `teamMembers` | (Optional) Explicit list of team member emails |
| `ignoreManagers` | (Optional) When `true`, hides PRs authored by managers (anyone with direct reports in the org tree) |

## Example Output

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

**Legend:**
- 🟢 Waiting ≤ 1 day
- 🟡 Waiting 2–3 days
- 🔴 Waiting > 3 days
- ❌ Has merge conflicts

## Running Tests

```bash
npm test

# With coverage
npx vitest run --coverage
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── ado-client.ts         # Azure DevOps authentication (supports multi-org)
├── config.ts             # Configuration (multi-repo support)
├── fetch-prs.ts          # Fetch & filter open PRs
├── review-logic.ts       # Determine which PRs need review
├── generate-markdown.ts  # Markdown table generation (grouped by repo)
├── dashboard.ts          # Terminal dashboard
├── git-detect.ts         # Auto-detect ADO repo from git remote
├── graph-client.ts       # Microsoft Graph API for team members
├── types.ts              # Shared type definitions
├── review-logic.test.ts  # Tests for review logic
├── generate-markdown.test.ts  # Tests for markdown generation
└── git-detect.test.ts    # Tests for ADO URL parsing
```
