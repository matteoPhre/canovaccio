import { mergeSignals } from '../shared/signal.js';
import type { SagaRetryPolicy } from './types.js';

/** Runs an abortable operation with an optional, caller-defined retry policy. */
export async function executeWithRetry(
  execute: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number | undefined,
  externalSignal: AbortSignal | undefined,
  retry: SagaRetryPolicy | undefined,
): Promise<void> {
  const maxAttempts = retry?.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('retry.maxAttempts must be a positive integer');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await execute(mergeSignals(timeoutMs, externalSignal));
      return;
    } catch (error: unknown) {
      if (attempt === maxAttempts || retry === undefined) {
        throw error;
      }

      const backoffDelayMs = retry.backoffMs(attempt, error);
      const delayMs = retry.jitterMs?.(backoffDelayMs, attempt, error) ?? backoffDelayMs;
      await waitForRetry(delayMs, externalSignal);
    }
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('retry backoff must return a non-negative finite number');
  }
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(cleanupAndResolve, delayMs);
    function cleanupAndResolve(): void {
      signal?.removeEventListener('abort', cleanupAndReject);
      resolve();
    }
    function cleanupAndReject(): void {
      clearTimeout(timeout);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', cleanupAndReject, { once: true });
  });
}