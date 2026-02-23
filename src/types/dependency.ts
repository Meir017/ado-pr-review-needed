export type DependencyReason = "branch" | "fileOverlap" | "mention";

export interface PrDependency {
  fromPrId: number;
  toPrId: number;
  reason: DependencyReason;
  details: string;
}

export interface DependencyChain {
  chainId: number;
  prIds: number[];
  status: "ready" | "blocked";
  blockerDescription?: string;
}

export interface DependencyGraph {
  dependencies: PrDependency[];
  chains: DependencyChain[];
  blockedPrIds: number[];
}

export interface DependencyConfig {
  enabled: boolean;
  strategies: DependencyReason[];
  fileOverlapThreshold: number;
  mentionPattern: string;
}
