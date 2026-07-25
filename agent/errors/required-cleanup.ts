import {
  CheckQuestError
} from './checkquest-error';

export interface RequiredCleanupContext {
  phase: string;
  runId?: string;
}

type CleanupOperation =
  () =>
    Promise<void> |
    void;

const secondaryCleanupErrors =
  new WeakMap<
    object,
    CheckQuestError
  >();

export function getSecondaryCleanupError(
  error:
    unknown
): CheckQuestError | undefined {
  if (
    error instanceof
    CheckQuestError
  ) {
    return (
      error
        .secondaryCleanupError ??
      secondaryCleanupErrors
        .get(
          error
        )
    );
  }

  if (
    (
      typeof error ===
        'object' &&
      error !==
        null
    ) ||
    typeof error ===
      'function'
  ) {
    return secondaryCleanupErrors
      .get(
        error
      );
  }

  return undefined;
}

function attachCleanupError(
  primaryError:
    object,
  cleanupError:
    CheckQuestError
): void {
  const existingError =
    getSecondaryCleanupError(
      primaryError
    );

  if (
    existingError !==
    undefined
  ) {
    existingError
      .secondaryCleanupError =
        cleanupError;
    return;
  }

  secondaryCleanupErrors.set(
    primaryError,
    cleanupError
  );

  if (
    primaryError instanceof
    CheckQuestError
  ) {
    primaryError
      .secondaryCleanupError =
        cleanupError;
  }
}

function createCleanupError(
  cause:
    unknown,
  context:
    RequiredCleanupContext
): CheckQuestError {
  return new CheckQuestError(
    'CLEANUP',
    'Required run cleanup failed.',
    {
      phase:
        context.phase,
      runId:
        context.runId,
      cause
    }
  );
}

export async function completeRequiredCleanup(
  primaryError:
    Error | undefined,
  cleanupOperations:
    readonly CleanupOperation[],
  context:
    RequiredCleanupContext
): Promise<void> {
  let firstCleanupError:
    CheckQuestError | undefined;

  for (
    const cleanupOperation of
    cleanupOperations
  ) {
    try {
      await cleanupOperation();
    } catch (
      error:
        unknown
    ) {
      const cleanupError =
        createCleanupError(
          error,
          context
        );

      if (
        firstCleanupError ===
        undefined
      ) {
        firstCleanupError =
          cleanupError;
      } else {
        firstCleanupError
          .secondaryCleanupError =
            cleanupError;
      }
    }
  }

  if (
    firstCleanupError ===
    undefined
  ) {
    return;
  }

  if (
    primaryError !==
    undefined
  ) {
    attachCleanupError(
      primaryError,
      firstCleanupError
    );
    return;
  }

  throw firstCleanupError;
}

export async function runWithRequiredCleanup<T>(
  operation:
    () => Promise<T>,
  cleanupOperations:
    readonly CleanupOperation[],
  context:
    RequiredCleanupContext
): Promise<T> {
  let result:
    T | undefined;
  let operationError:
    unknown;
  let operationSucceeded =
    false;

  try {
    result =
      await operation();
    operationSucceeded =
      true;
  } catch (
    error:
      unknown
  ) {
    operationError =
      error;
  }

  if (
    operationSucceeded
  ) {
    await completeRequiredCleanup(
      undefined,
      cleanupOperations,
      context
    );

    return result as T;
  }

  const normalizedError =
    operationError instanceof
      Error
      ? operationError
      : new CheckQuestError(
          'INTERNAL',
          'A run operation failed with an invalid error value.',
          {
            phase:
              context.phase,
            runId:
              context.runId,
            cause:
              operationError
          }
        );

  await completeRequiredCleanup(
    normalizedError,
    cleanupOperations,
    context
  );

  throw normalizedError;
}
