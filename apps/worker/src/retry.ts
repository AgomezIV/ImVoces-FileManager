import { ProviderError } from '@imvoces/providers';

export const MAX_ATTEMPTS = 5;

/**
 * Backoff exponencial con jitter. Si el proveedor mandó `Retry-After`
 * (Drive lo hace con los 429), se respeta ese valor en su lugar.
 */
export function backoffMs(attempt: number, err?: unknown): number {
  if (err instanceof ProviderError && err.retryAfterMs != null) {
    return Math.min(err.retryAfterMs, 60_000);
  }
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
  return base + Math.random() * base * 0.3;
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
