/** Combines a definition timeout with an optional caller cancellation signal. */
export function mergeSignals(timeoutMs?: number, externalSignal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [];

  if (timeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }

  if (externalSignal !== undefined) {
    signals.push(externalSignal);
  }

  if (signals.length === 0) {
    return new AbortController().signal;
  }

  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}