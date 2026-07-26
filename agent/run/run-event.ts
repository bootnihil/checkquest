import type {
  GeminiRequestEvent
} from '../ai/run-gemini-request';
import {
  CheckQuestError,
  type CheckQuestErrorCode
} from '../errors/checkquest-error';
import {
  createSafeDisplayUrl
} from '../errors/safe-display-url';

interface RunEventCommon {
  timestamp: string;
  runId: string;
  message: string;
}

export type RunEvent =
  | (
      RunEventCommon & {
        type: 'run-started';
        startUrl: string;
        pageBudget: number;
        navigationBudget: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'inspection-started';
        pageNumber: number;
        url: string;
      }
    )
  | (
      RunEventCommon & {
        type: 'inspection-completed';
        pageNumber: number;
        url: string;
        findingCount: number;
        diagnosticCount: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'navigation-started';
        navigationStep: number;
        navigationBudget: number;
        pageNumber: number;
        requestedUrl: string;
      }
    )
  | (
      RunEventCommon & {
        type: 'navigation-completed';
        navigationStep: number;
        navigationBudget: number;
        pageNumber: number;
        requestedUrl: string;
        finalUrl: string;
        outcome:
          | 'ready-for-inspection'
          | 'duplicate-final-url';
      }
    )
  | (
      RunEventCommon & {
        type: 'model-request-started';
        operation: string;
        attempt: number;
        maxAttempts: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'model-request-retrying';
        operation: string;
        attempt: number;
        maxAttempts: number;
        retryDelayMs: number;
        statusCode: number | null;
      }
    )
  | (
      RunEventCommon & {
        type: 'model-request-completed';
        operation: string;
        attempt: number;
        maxAttempts: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'investigation-completed';
        pageNumber: number;
        candidateReference: string;
        status:
          | 'verified'
          | 'not-verified'
          | 'inconclusive';
        stepsUsed: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'run-completed';
        outcome:
          | 'completed'
          | 'finished';
        inspectedPageCount: number;
        findingCount: number;
        occurrenceCount: number;
      }
    )
  | (
      RunEventCommon & {
        type: 'run-failed';
        code: CheckQuestErrorCode;
        phase?: string;
        pageNumber?: number;
        navigationStep?: number;
        requestedUrl?: string;
        finalUrl?: string;
      }
    );

export type RunEventInput =
  RunEvent extends infer Event
    ? Event extends RunEvent
      ? Omit<
          Event,
          | 'timestamp'
          | 'runId'
        >
      : never
    : never;

export type RunEventObserver =
  (
    event:
      RunEvent
  ) => void;

export type RunEventEmitter =
  (
    event:
      RunEventInput
  ) => void;

export type RunFailedEventInput =
  Extract<
    RunEventInput,
    {
      type:
        'run-failed';
    }
  >;

function ignoreObserverRejection(
  result:
    unknown
): void {
  if (
    (
      typeof result ===
        'object' ||
      typeof result ===
        'function'
    ) &&
    result !==
      null &&
    'then' in
      result &&
    typeof result.then ===
      'function'
  ) {
    void Promise
      .resolve(
        result
      )
      .catch(
        () => undefined
      );
  }
}

export function deliverRunEvent(
  observer:
    RunEventObserver | undefined,
  event:
    RunEvent
): void {
  if (
    observer ===
      undefined
  ) {
    return;
  }

  try {
    const result =
      observer(
        event
      ) as unknown;

    ignoreObserverRejection(
      result
    );
  } catch {
    // Observer failures are deliberately isolated from reusable execution.
  }
}

/**
 * Delivers events synchronously in execution order. Observer exceptions and
 * unexpected promise rejections are isolated so presentation code cannot
 * alter run behavior.
 */
export function createRunEventEmitter(
  runId:
    string,
  observer?:
    RunEventObserver,
  now:
    () => Date =
      () => new Date()
): RunEventEmitter {
  if (
    observer ===
    undefined
  ) {
    return () => undefined;
  }

  return event => {
    deliverRunEvent(
      observer,
      {
        ...event,
        timestamp:
          now()
            .toISOString(),
        runId
      }
    );
  };
}

export function createModelRequestRunEventObserver(
  emit:
    RunEventEmitter
): (
  event:
    GeminiRequestEvent
) => void {
  return event => {
    switch (
      event.type
    ) {
      case 'started':
        emit({
          type:
            'model-request-started',
          message:
            `Model request started: ${event.operation}.`,
          operation:
            event.operation,
          attempt:
            event.attempt,
          maxAttempts:
            event.maxAttempts
        });
        return;

      case 'retrying':
        emit({
          type:
            'model-request-retrying',
          message:
            `Model request will retry: ${event.operation}.`,
          operation:
            event.operation,
          attempt:
            event.attempt,
          maxAttempts:
            event.maxAttempts,
          retryDelayMs:
            event.retryDelayMs,
          statusCode:
            event.statusCode
        });
        return;

      case 'completed':
        emit({
          type:
            'model-request-completed',
          message:
            `Model request completed: ${event.operation}.`,
          operation:
            event.operation,
          attempt:
            event.attempt,
          maxAttempts:
            event.maxAttempts
        });
    }
  };
}

export function createRunFailureEvent(
  error:
    unknown
): RunFailedEventInput {
  if (
    !(
      error instanceof
      CheckQuestError
    )
  ) {
    return {
      type:
        'run-failed',
      message:
        'An unexpected CheckQuest failure occurred.',
      code:
        'INTERNAL'
    };
  }

  return {
    type:
      'run-failed',
    message:
      error.message,
    code:
      error.code,
    ...(error.phase ===
    undefined
      ? {}
      : {
          phase:
            error.phase
        }),
    ...(error.pageNumber ===
    undefined
      ? {}
      : {
          pageNumber:
            error.pageNumber
        }),
    ...(error.navigationStep ===
    undefined
      ? {}
      : {
          navigationStep:
            error.navigationStep
        }),
    ...(error.requestedUrl ===
    undefined
      ? {}
      : {
          requestedUrl:
            createSafeDisplayUrl(
              error.requestedUrl
            )
        }),
    ...(error.finalUrl ===
    undefined
      ? {}
      : {
          finalUrl:
            createSafeDisplayUrl(
              error.finalUrl
            )
        })
  };
}
