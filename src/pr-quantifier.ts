import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type {
  FileDiffsCriteria,
  FileDiffParams,
  LineDiffBlock,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import {
  LineDiffBlockChangeType,
  VersionControlChangeType,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import picomatch from "picomatch";
import type { PrSizeInfo, PrSizeLabel, SizeThreshold, QuantifierConfig } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import { withRetry } from "./retry.js";
import * as log from "./log.js";

export function classifyPrSize(
  totalChanges: number,
  thresholds: SizeThreshold[] = DEFAULT_THRESHOLDS,
): PrSizeLabel {
  const sorted = [...thresholds].sort((a, b) => a.maxChanges - b.maxChanges);
  for (const t of sorted) {
    if (totalChanges <= t.maxChanges) return t.label;
  }
  return sorted[sorted.length - 1].label;
}

function isExcluded(filePath: string, matchers: picomatch.Matcher[]): boolean {
  if (matchers.length === 0) return false;
  // Strip leading slash for matching
  const normalized = filePath.replace(/^\//, "");
  return matchers.some((m) => m(normalized));
}

function countLineDiffs(blocks: LineDiffBlock[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const block of blocks) {
    const changeType = block.changeType ?? LineDiffBlockChangeType.None;
    if (changeType === LineDiffBlockChangeType.Add) {
      added += block.modifiedLinesCount ?? 0;
    } else if (changeType === LineDiffBlockChangeType.Delete) {
      deleted += block.originalLinesCount ?? 0;
    } else if (changeType === LineDiffBlockChangeType.Edit) {
      // Edit = modification: count original as deleted, modified as added
      added += block.modifiedLinesCount ?? 0;
      deleted += block.originalLinesCount ?? 0;
    }
  }
  return { added, deleted };
}

export async function computePrSize(
  gitApi: IGitApi,
  repositoryId: string,
  project: string,
  pullRequestId: number,
  config: QuantifierConfig,
): Promise<PrSizeInfo> {
  const matchers = config.excludedPatterns.map((p) => picomatch(p, { dot: true }));

  // Get iterations to find the latest one
  const iterations = await withRetry(
    `Fetch iterations for PR #${pullRequestId}`,
    () => gitApi.getPullRequestIterations(repositoryId, pullRequestId, project),
  );

  if (!iterations || iterations.length === 0) {
    return { linesAdded: 0, linesDeleted: 0, totalChanges: 0, label: classifyPrSize(0, config.thresholds) };
  }

  const lastIteration = iterations[iterations.length - 1];
  const iterationId = lastIteration.id!;

  // Get changed files for this iteration (comparing against base)
  interface ChangeEntry { path: string; originalPath?: string; changeType: number }
  const allChanges: ChangeEntry[] = [];
  let skip = 0;
  const top = 100;

  // Paginate through all changes
  while (true) {
    const iterChanges = await withRetry(
      `Fetch iteration changes for PR #${pullRequestId} iter ${iterationId}`,
      () => gitApi.getPullRequestIterationChanges(repositoryId, pullRequestId, iterationId, project, top, skip),
    );

    const entries = iterChanges.changeEntries ?? [];
    for (const entry of entries) {
      const path = entry.item?.path ?? "";
      const originalPath = entry.originalPath;
      if (path && !isExcluded(path, matchers)) {
        allChanges.push({ path, originalPath: originalPath ?? undefined, changeType: entry.changeType ?? 0 });
      }
    }

    // Check if more pages exist
    if ((iterChanges.nextSkip ?? 0) === 0 && (iterChanges.nextTop ?? 0) === 0) break;
    skip = iterChanges.nextSkip ?? skip + top;
    if (entries.length === 0) break;
  }

  if (allChanges.length === 0) {
    return { linesAdded: 0, linesDeleted: 0, totalChanges: 0, label: classifyPrSize(0, config.thresholds) };
  }

  // Use getFileDiffs to get line-level counts
  // baseVersionCommit = target branch (what we're merging into)
  // targetVersionCommit = source branch (the PR changes)
  const sourceCommit = lastIteration.sourceRefCommit?.commitId;
  const targetCommit = lastIteration.targetRefCommit?.commitId;

  if (!sourceCommit || !targetCommit) {
    log.debug(`  PR #${pullRequestId} — no commit refs, using file count as proxy`);
    const total = allChanges.length;
    return { linesAdded: total, linesDeleted: 0, totalChanges: total, label: classifyPrSize(total, config.thresholds) };
  }

  // Build FileDiffParams with correct paths based on change type.
  // For adds: file doesn't exist in base (target branch), so originalPath must be null.
  // For deletes: file doesn't exist in source branch, so path must be null.
  const fileDiffParams: FileDiffParams[] = allChanges.map((c) => {
    const isAdd = (c.changeType & VersionControlChangeType.Add) !== 0;
    const isDelete = (c.changeType & VersionControlChangeType.Delete) !== 0;
    return {
      originalPath: isAdd ? undefined : (c.originalPath ?? c.path),
      path: isDelete ? undefined : c.path,
    };
  });

  let totalAdded = 0;
  let totalDeleted = 0;

  // API limits to 10 files per request — batch accordingly
  const BATCH_SIZE = 10;
  let failedFiles = 0;
  for (let i = 0; i < fileDiffParams.length; i += BATCH_SIZE) {
    const batch = fileDiffParams.slice(i, i + BATCH_SIZE);
    const criteria: FileDiffsCriteria = {
      baseVersionCommit: targetCommit,
      targetVersionCommit: sourceCommit,
      fileDiffParams: batch,
    };

    try {
      const fileDiffs = await gitApi.getFileDiffs(criteria, project, repositoryId);

      for (const diff of fileDiffs) {
        const { added, deleted } = countLineDiffs(diff.lineDiffBlocks ?? []);
        totalAdded += added;
        totalDeleted += deleted;
      }
    } catch {
      // Batch failed — try each file individually to salvage what we can
      for (const param of batch) {
        try {
          const singleCriteria: FileDiffsCriteria = {
            baseVersionCommit: targetCommit,
            targetVersionCommit: sourceCommit,
            fileDiffParams: [param],
          };
          const diffs = await gitApi.getFileDiffs(singleCriteria, project, repositoryId);
          for (const diff of diffs) {
            const { added, deleted } = countLineDiffs(diff.lineDiffBlocks ?? []);
            totalAdded += added;
            totalDeleted += deleted;
          }
        } catch {
          // File doesn't exist at specified version (rename/rebase/force-push) — skip it
          failedFiles++;
        }
      }
    }
  }

  if (failedFiles > 0) {
    log.debug(`  PR #${pullRequestId} — skipped ${failedFiles} files (not found at specified version)`);
  }

  const totalChanges = totalAdded + totalDeleted;
  const label = classifyPrSize(totalChanges, config.thresholds);

  log.debug(`  PR #${pullRequestId} — +${totalAdded} -${totalDeleted} = ${totalChanges} (${label})`);

  return { linesAdded: totalAdded, linesDeleted: totalDeleted, totalChanges, label };
}
