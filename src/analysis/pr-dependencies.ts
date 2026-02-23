import type {
  PullRequestInfo,
  AnalysisResult,
  PrDependency,
  DependencyChain,
  DependencyGraph,
  DependencyConfig,
} from "../types.js";

const DEFAULT_MENTION_PATTERN = "depends on.*#(\\d+)";

export const DEFAULT_DEPENDENCY_CONFIG: DependencyConfig = {
  enabled: false,
  strategies: ["branch", "mention"],
  fileOverlapThreshold: 2,
  mentionPattern: DEFAULT_MENTION_PATTERN,
};

/**
 * Detect branch-based dependencies: PR A's source branch == PR B's target branch.
 */
export function detectBranchDeps(prs: PullRequestInfo[]): PrDependency[] {
  const deps: PrDependency[] = [];
  const sourceByBranch = new Map<string, PullRequestInfo>();

  for (const pr of prs) {
    if (pr.sourceBranch) {
      sourceByBranch.set(pr.sourceBranch, pr);
    }
  }

  for (const pr of prs) {
    if (pr.targetBranch) {
      const upstream = sourceByBranch.get(pr.targetBranch);
      if (upstream && upstream.id !== pr.id) {
        deps.push({
          fromPrId: pr.id,
          toPrId: upstream.id,
          reason: "branch",
          details: `targets branch ${pr.targetBranch}`,
        });
      }
    }
  }

  return deps;
}

/**
 * Detect mention-based dependencies by scanning title and description for patterns like "depends on #123".
 */
export function detectMentionDeps(
  prs: PullRequestInfo[],
  pattern: string,
): PrDependency[] {
  const deps: PrDependency[] = [];
  const prIdSet = new Set(prs.map((pr) => pr.id));
  const regex = new RegExp(pattern, "gi");

  for (const pr of prs) {
    const textToSearch = `${pr.title} ${pr.description ?? ""}`;
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;

    while ((match = regex.exec(textToSearch)) !== null) {
      const referencedId = parseInt(match[1], 10);
      if (!isNaN(referencedId) && referencedId !== pr.id && prIdSet.has(referencedId)) {
        deps.push({
          fromPrId: pr.id,
          toPrId: referencedId,
          reason: "mention",
          details: `mentions PR #${referencedId}`,
        });
      }
    }
  }

  return deps;
}

/**
 * Detect file-overlap dependencies: two PRs modifying enough of the same files.
 * Requires changedFiles to be populated on PullRequestInfo (future extension).
 * For now, this is a placeholder that uses empty arrays when changedFiles not available.
 */
export function detectFileOverlap(
  prs: PullRequestInfo[],
  threshold: number,
): PrDependency[] {
  const deps: PrDependency[] = [];

  const prsWithFiles = prs.filter(
    (pr) => pr.changedFiles && pr.changedFiles.length > 0,
  );

  for (let i = 0; i < prsWithFiles.length; i++) {
    const filesA = new Set(prsWithFiles[i].changedFiles ?? []);
    for (let j = i + 1; j < prsWithFiles.length; j++) {
      const filesB = prsWithFiles[j].changedFiles ?? [];
      const overlap = filesB.filter((f) => filesA.has(f));
      if (overlap.length >= threshold) {
        deps.push({
          fromPrId: prsWithFiles[i].id,
          toPrId: prsWithFiles[j].id,
          reason: "fileOverlap",
          details: `${overlap.length} shared files: ${overlap.slice(0, 3).join(", ")}${overlap.length > 3 ? "…" : ""}`,
        });
      }
    }
  }

  return deps;
}

/**
 * Run all enabled dependency detection strategies.
 */
export function detectDependencies(
  prs: PullRequestInfo[],
  config: DependencyConfig,
): PrDependency[] {
  const deps: PrDependency[] = [];

  for (const strategy of config.strategies) {
    switch (strategy) {
      case "branch":
        deps.push(...detectBranchDeps(prs));
        break;
      case "mention":
        deps.push(...detectMentionDeps(prs, config.mentionPattern));
        break;
      case "fileOverlap":
        deps.push(...detectFileOverlap(prs, config.fileOverlapThreshold));
        break;
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return deps.filter((d) => {
    const key = `${d.fromPrId}:${d.toPrId}:${d.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build a dependency graph with chains and blocker detection.
 */
export function buildDependencyGraph(
  deps: PrDependency[],
  prs: PullRequestInfo[],
  analysis: AnalysisResult,
): DependencyGraph {
  if (deps.length === 0) {
    return { dependencies: [], chains: [], blockedPrIds: [] };
  }

  // Build adjacency list
  const adj = new Map<number, number[]>();
  const allIds = new Set<number>();
  for (const dep of deps) {
    allIds.add(dep.fromPrId);
    allIds.add(dep.toPrId);
    if (!adj.has(dep.fromPrId)) adj.set(dep.fromPrId, []);
    adj.get(dep.fromPrId)!.push(dep.toPrId);
  }

  // Find connected components (chains)
  const visited = new Set<number>();
  const chains: DependencyChain[] = [];
  let chainId = 1;

  const approvedIds = new Set(analysis.approved.map((pr) => pr.id));

  for (const id of allIds) {
    if (visited.has(id)) continue;

    // BFS to find connected component
    const component: number[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);

      // Follow edges in both directions
      for (const dep of deps) {
        if (dep.fromPrId === current && !visited.has(dep.toPrId)) {
          queue.push(dep.toPrId);
        }
        if (dep.toPrId === current && !visited.has(dep.fromPrId)) {
          queue.push(dep.fromPrId);
        }
      }
    }

    // Determine chain status
    const blockers = deps.filter(
      (d) =>
        component.includes(d.fromPrId) &&
        component.includes(d.toPrId) &&
        !approvedIds.has(d.toPrId),
    );

    const status = blockers.length > 0 ? "blocked" as const : "ready" as const;
    const blockerDesc = blockers.length > 0
      ? blockers.map((b) => `#${b.toPrId} blocks #${b.fromPrId} (${b.reason})`).join("; ")
      : undefined;

    chains.push({
      chainId: chainId++,
      prIds: component.sort((a, b) => a - b),
      status,
      blockerDescription: blockerDesc,
    });
  }

  // Find all blocked PR IDs
  const blockedPrIds = [...new Set(
    deps
      .filter((d) => !approvedIds.has(d.toPrId))
      .map((d) => d.fromPrId),
  )];

  return { dependencies: deps, chains, blockedPrIds };
}
