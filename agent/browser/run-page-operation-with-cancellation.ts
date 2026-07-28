import type {
  Page
} from '@playwright/test';

import {
  createRunCancelledError,
  normalizeRunCancellation,
  throwIfRunCancelled
} from '../errors/run-cancellation';

export interface PageOperationCancellation {
  signal?:
    AbortSignal;
  runId?:
    string;
  phase:
    string;
}

export async function runPageOperationWithCancellation<
  Result
>(
  page:
    Pick<
      Page,
      'close'
    >,
  operation:
    () => Promise<
      Result
    >,
  cancellation:
    PageOperationCancellation
): Promise<
  Result
> {
  const signal =
    cancellation.signal;

  throwIfRunCancelled(
    signal,
    cancellation.runId,
    cancellation.phase
  );

  if (
    signal ===
      undefined
  ) {
    return operation();
  }

  let rejectCancellation:
    (
      reason:
        unknown
    ) => void =
      () => undefined;
  const cancellationPromise =
    new Promise<
      never
    >(
      (
        _resolve,
        reject
      ) => {
        rejectCancellation =
          reject;
      }
    );
  const interruptOperation =
    (): void => {
      void page
        .close({
          runBeforeUnload:
            false,
          reason:
            'CheckQuest run cancelled.'
        })
        .catch(
          () => undefined
        )
        .finally(
          () => {
            rejectCancellation(
              createRunCancelledError(
                cancellation.runId,
                cancellation.phase
              )
            );
          }
        );
    };

  signal.addEventListener(
    'abort',
    interruptOperation,
    {
      once:
        true
    }
  );

  try {
    try {
      return await Promise.race([
        operation(),
        cancellationPromise
      ]);
    } catch (
      error:
        unknown
    ) {
      throw normalizeRunCancellation(
        error,
        signal,
        cancellation.runId,
        cancellation.phase
      );
    }
  } finally {
    signal.removeEventListener(
      'abort',
      interruptOperation
    );
  }
}
