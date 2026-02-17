import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type {
  FileDiffsCriteria,
  FileDiff,
  LineDiffBlock,
  GitPullRequestIteration,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { LineDiffBlockChangeType } from "azure-devops-node-api/interfaces/GitInterfaces.js";
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
  let allChanges: { path: string; changeType: number }[] = [];
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
      if (path && !isExcluded(path, matchers)) {
        allChanges.push({ path, changeType: entry.changeType ?? 0 });
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
  const baseCommit = lastIteration.sourceRefCommit?.commitId;
  const targetCommit = lastIteration.targetRefCommit?.commitId;

  if (!baseCommit || !targetCommit) {
    // Fallback: use file count as a rough proxy
    log.debug(`  PR #${pullRequestId} — no commit refs, using file count as proxy`);
    const total = allChanges.length;
    return { linesAdded: total, linesDeleted: 0, totalChanges: total, label: classifyPrSize(total, config.thresholds) };
  }

  // Batch file diff requests (API handles multiple files at once)
  const fileDiffParams = allChanges.map((c) => ({
    originalPath: c.path,
    modifiedPath: c.path,
  }));

  const criteria: FileDiffsCriteria = {
    baseVersionCommit: targetCommit,
    targetVersionCommit: baseCommit,
    fileDiffParams,
  };

  let totalAdded = 0;
  let totalDeleted = 0;

  try {
    const fileDiffs = await withRetry(
      `Fetch file diffs for PR #${pullRequestId}`,
      () => gitApi.getFileDiffs(criteria, project, repositoryId),
    );

    for (const diff of fileDiffs) {
      const { added, deleted } = countLineDiffs(diff.lineDiffBlocks ?? []);
      totalAdded += added;
      totalDeleted += deleted;
    }
  } catch (err) {
    // Fallback: use file count if file diffs API fails
    log.debug(`  PR #${pullRequestId} — file diffs failed, using file count as proxy`);
    totalAdded = allChanges.length;
    totalDeleted = 0;
  }

  const totalChanges = totalAdded + totalDeleted;
  const label = classifyPrSize(totalChanges, config.thresholds);

  log.debug(`  PR #${pullRequestId} — +${totalAdded} -${totalDeleted} = ${totalChanges} (${label})`);

  return { linesAdded: totalAdded, linesDeleted: totalDeleted, totalChanges, label };
}
