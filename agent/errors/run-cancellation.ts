import { CheckQuestError } from './checkquest-error';

export function createRunCancelledError(
  runId: string | undefined,
  phase: string,
  cause?: unknown
): CheckQuestError {
  return new CheckQuestError('CANCELLED', 'The CheckQuest run was cancelled.', {
    phase,
    runId,
    retryable: false,
    cause
  });
}

export function throwIfRunCancelled(
  signal: AbortSignal | undefined,
  runId: string | undefined,
  phase: string
): void {
  if (signal?.aborted) {
    throw createRunCancelledError(runId, phase);
  }
}

export function normalizeRunCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
  runId: string | undefined,
  phase: string
): unknown {
  if (error instanceof CheckQuestError && error.code === 'CANCELLED') {
    if (error.runId === undefined && runId !== undefined) {
      return createRunCancelledError(runId, error.phase ?? phase, error);
    }

    return error;
  }

  if (signal?.aborted) {
    return createRunCancelledError(runId, phase, error);
  }

  return error;
}

export async function waitForRunDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
  runId: string | undefined,
  phase: string
): Promise<void> {
  throwIfRunCancelled(signal, runId, phase);

  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', rejectCancellation);
    };
    const resolveDelay = (): void => {
      cleanup();
      resolve();
    };
    const rejectCancellation = (): void => {
      cleanup();
      reject(createRunCancelledError(runId, phase));
    };

    const timeout = setTimeout(resolveDelay, delayMs);
    signal?.addEventListener('abort', rejectCancellation, {
      once: true
    });
  });
}
