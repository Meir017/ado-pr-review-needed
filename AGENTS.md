# AGENTS.md

## Project Overview

A TypeScript CLI tool that queries Azure DevOps for open pull requests and generates a markdown summary of PRs needing reviewer feedback. Published as `@meirblachman/pr-review-needed` on npm.

## Setup

- **Node.js 24+** required
- Install dependencies: `npm install`
- Build: `npm run build`
- Bundle: `npm run bundle`

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run bundle` | Bundle with esbuild (`node scripts/bundle.mjs`) |
| `npm run start` | Run CLI from source via `tsx` |
| `npm run lint` | Lint with ESLint (`eslint src/`) |
| `npm test` | Run unit tests (`vitest run`) |
| `npm run test:html` | Run Playwright e2e tests for the HTML report |
| `npx vitest run --coverage` | Run tests with coverage |

## Code Style

- TypeScript strict mode (`strict: true` in tsconfig)
- ES2024 target, Node16 module resolution
- ESLint with `@eslint/js` recommended + `typescript-eslint` recommended
- ESM only (`"type": "module"` in package.json)

## Testing

- **Unit tests**: Vitest — run with `npm test`
- **E2E tests**: Playwright — run with `npm run test:html`
- Test files use the `.test.ts` extension and are co-located with source files
- E2E tests live in `src/e2e/`

## Project Structure

```
src/
├── index.ts                        # CLI entry point & argument parsing
├── pipeline.ts                     # Main orchestrator (fetch → analyze → report)
├── ado-client.ts                   # Azure DevOps authentication (Git + Build API, multi-org)
├── config.ts                       # Configuration loading (multi-repo support)
├── fetch-prs.ts                    # Fetch & filter open PRs + pipeline status
├── graph-client.ts                 # Microsoft Graph API for org/team resolution
├── git-detect.ts                   # Auto-detect ADO repo from git remote
├── metrics.ts                      # Review cycle time metrics
├── reviewer-workload.ts            # Reviewer workload analysis
├── concurrency.ts                  # Batched concurrent operations
├── retry.ts                        # Retry with exponential backoff
├── log.ts                          # Structured colored logging
├── types.ts                        # Barrel re-export of all types
├── types/
│   ├── pr.ts                       # PR, pipeline status, reviewer, quantifier types
│   ├── analysis.ts                 # Analysis result types + summary stats
│   ├── staleness.ts                # Staleness config & threshold types
│   ├── reporting.ts                # JSON report, webhook config types
│   ├── notifications.ts            # Notification config types
│   ├── nudge.ts                    # Auto-nudge config types
│   ├── dependency.ts               # PR dependency graph types
│   └── dora.ts                     # DORA metrics types
├── analysis/
│   ├── review-logic.ts             # Determine which PRs need review
│   ├── pr-quantifier.ts            # PR size classification (XS/S/M/L/XL)
│   ├── staleness.ts                # PR staleness badge computation
│   ├── file-patterns.ts            # Glob pattern matching for file labels
│   └── pr-dependencies.ts          # PR dependency chain detection
├── reporting/
│   ├── generate-markdown.ts        # Markdown table generation
│   ├── dashboard.ts                # Interactive terminal dashboard
│   ├── report-data.ts              # Shared report data helpers
│   ├── api-output.ts               # JSON report builder + webhook sender
│   └── html-report/
│       ├── generate-html.ts        # HTML report generator
│       └── template.html           # Self-contained HTML dashboard template
├── automation/
│   ├── restart-merge.ts            # Restart merge for stale PRs
│   ├── auto-nudge.ts               # Auto-nudge stale PRs with comments
│   └── notifications/
│       ├── index.ts                # Notification orchestrator
│       └── teams.ts                # Teams Adaptive Card formatter
├── dora/
│   ├── compute-dora.ts             # DORA metrics computation
│   └── history-store.ts            # DORA history persistence
└── e2e/                            # End-to-end tests with mock ADO API
```

## Key Architecture Notes

- The CLI uses `commander` for argument parsing
- Azure DevOps auth uses `@azure/identity` (`AzureCliCredential`) — no PAT required
- File pattern matching uses `picomatch`
- The `pipeline.ts` orchestrator ties together fetching, analysis, and reporting
- Configuration is loaded from `pr-review-config.json` (schema in `pr-review-config.schema.json`)
