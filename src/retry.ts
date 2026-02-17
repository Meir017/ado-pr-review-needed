import * as log from "./log.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      // Don't retry errors that are known to be permanent
      if (err instanceof NonRetryableError) {
        throw err;
      }

      const msg = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === maxAttempts;

      if (isLastAttempt) {
        log.error(`${label} failed after ${maxAttempts} attempts: ${msg}`);
        throw err;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log.warn(
        `${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${(delayMs / 1000).toFixed(1)}s… — ${msg}`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error("unreachable");
}
