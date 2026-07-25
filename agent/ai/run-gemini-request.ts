import {
  aiConfig
} from '../config/ai-config';
import {
  CheckQuestError
} from '../errors/checkquest-error';

export interface GeminiRequestOptions {
  timeout_ms: number;
  retries: {
    strategy: 'none';
  };
}

export interface GeminiRequestDependencies {
  wait?:
    (
      delayMs:
        number
    ) => Promise<void>;
  random?:
    () => number;
  onEvent?:
    (
      event:
        GeminiRequestEvent
    ) => void;
}

export type GeminiRequestEvent =
  | {
      type: 'started';
      operation: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: 'retrying';
      operation: string;
      attempt: number;
      maxAttempts: number;
      retryDelayMs: number;
      statusCode: number | null;
    }
  | {
      type: 'completed';
      operation: string;
      attempt: number;
      maxAttempts: number;
    };

function notifyRequestObserver(
  observer:
    GeminiRequestDependencies[
      'onEvent'
    ],
  event:
    GeminiRequestEvent
): void {
  if (
    observer ===
    undefined
  ) {
    return;
  }

  try {
    observer(
      event
    );
  } catch {
    // Model progress observers cannot affect request execution.
  }
}

const retryableStatuses =
  new Set([
    408,
    429,
    500,
    502,
    503,
    504
  ]);

const retryableTransportCodes =
  new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNRESET',
    'ESOCKETTIMEDOUT',
    'ETIMEDOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET'
  ]);

function isRecord(
  value:
    unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      'object' &&
    value !==
      null
  );
}

function visitErrorChain(
  error:
    unknown,
  read:
    (
      value:
        Record<
          string,
          unknown
        >
    ) =>
      string |
      number |
      null
): string | number | null {
  let current =
    error;

  for (
    let depth = 0;
    depth < 5;
    depth += 1
  ) {
    if (
      !isRecord(
        current
      )
    ) {
      return null;
    }

    const value =
      read(
        current
      );

    if (
      value !==
      null
    ) {
      return value;
    }

    current =
      current.cause;
  }

  return null;
}

function getErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof
    Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
    'string'
  ) {
    return error;
  }

  return '';
}

export function getGeminiStatusCode(
  error:
    unknown
): number | null {
  const statusCode =
    visitErrorChain(
      error,
      value => {
        if (
          typeof value.status ===
          'number'
        ) {
          return value.status;
        }

        if (
          typeof value.statusCode ===
          'number'
        ) {
          return value.statusCode;
        }

        return null;
      }
    );

  return (
    typeof statusCode ===
      'number'
      ? statusCode
      : null
  );
}

function getTransportCode(
  error:
    unknown
): string | null {
  const code =
    visitErrorChain(
      error,
      value =>
        typeof value.code ===
          'string'
          ? value.code
              .toUpperCase()
          : null
    );

  return (
    typeof code ===
      'string'
      ? code
      : null
  );
}

function getErrorName(
  error:
    unknown
): string | null {
  const name =
    visitErrorChain(
      error,
      value =>
        typeof value.name ===
          'string'
          ? value.name
          : null
    );

  return (
    typeof name ===
      'string'
      ? name
      : null
  );
}

function getRetryAfterMs(
  error:
    unknown
): number | null {
  const message =
    getErrorMessage(
      error
    );
  const retryMatch =
    message.match(
      /retry in\s+([\d.]+)\s*s/i
    );

  if (
    retryMatch ===
    null
  ) {
    return null;
  }

  const retrySeconds =
    Number.parseFloat(
      retryMatch[1]
    );

  if (
    !Number.isFinite(
      retrySeconds
    ) ||
    retrySeconds <
      0
  ) {
    return null;
  }

  return Math.ceil(
    retrySeconds *
      1_000
  );
}

function isStructuredTimeout(
  error:
    unknown
): boolean {
  const code =
    getTransportCode(
      error
    );

  if (
    code !==
      null &&
    (
      code.includes(
        'TIMEOUT'
      ) ||
      code ===
        'ETIMEDOUT' ||
      code ===
        'ECONNABORTED'
    )
  ) {
    return true;
  }

  return getErrorName(
    error
  ) ===
    'TimeoutError';
}

export function isRetryableGeminiError(
  error:
    unknown
): boolean {
  const statusCode =
    getGeminiStatusCode(
      error
    );

  if (
    statusCode !==
      null
  ) {
    return retryableStatuses.has(
      statusCode
    );
  }

  const transportCode =
    getTransportCode(
      error
    );

  return (
    (
      transportCode !==
        null &&
      retryableTransportCodes.has(
        transportCode
      )
    ) ||
    isStructuredTimeout(
      error
    )
  );
}

function calculateRetryDelayMs(
  error:
    unknown,
  retryNumber:
    number,
  random:
    () => number
): number {
  const serverDelay =
    getRetryAfterMs(
      error
    );

  if (
    serverDelay !==
    null
  ) {
    return Math.min(
      serverDelay,
      aiConfig
        .maxRetryDelayMs
    );
  }

  const exponentialDelay =
    aiConfig
      .baseRetryDelayMs *
    2 **
      retryNumber;

  const randomValue =
    Math.max(
      0,
      Math.min(
        random(),
        0.999_999
      )
    );

  const jitterMs =
    Math.floor(
      randomValue *
      500
    );

  return Math.min(
    exponentialDelay +
      jitterMs,
    aiConfig
      .maxRetryDelayMs
  );
}

function createFinalError(
  error:
    unknown
): CheckQuestError {
  const statusCode =
    getGeminiStatusCode(
      error
    );
  const retryable =
    isRetryableGeminiError(
      error
    );

  let message:
    string;

  if (
    statusCode ===
    429
  ) {
    message =
      'Gemini rate limit or quota was reached.';
  } else if (
    statusCode ===
      408 ||
    isStructuredTimeout(
      error
    )
  ) {
    message =
      `Gemini did not respond within ${Math.ceil(
        aiConfig
          .requestTimeoutMs /
        1_000
      )} seconds.`;
  } else if (
    statusCode !==
      null
  ) {
    message =
      retryable
        ? `Gemini returned a transient server error (${statusCode}).`
        : `Gemini request failed (${statusCode}).`;
  } else {
    message =
      'Gemini request failed.';
  }

  return new CheckQuestError(
    'MODEL',
    message,
    {
      phase:
        'gemini-request',
      statusCode:
        statusCode ??
        undefined,
      retryable,
      cause:
        error
    }
  );
}

function wait(
  delayMs:
    number
): Promise<void> {
  return new Promise(
    resolve => {
      setTimeout(
        resolve,
        delayMs
      );
    }
  );
}

export async function runGeminiRequest<T>(
  description:
    string,
  operation:
    (
      options:
        GeminiRequestOptions
    ) => Promise<T>,
  dependencies:
    GeminiRequestDependencies = {}
): Promise<T> {
  const totalAttempts =
    aiConfig.maxRetries +
    1;
  const waitForDelay =
    dependencies.wait ??
    wait;
  const random =
    dependencies.random ??
    Math.random;

  for (
    let attemptIndex = 0;
    attemptIndex <
      totalAttempts;
    attemptIndex += 1
  ) {
    const attemptNumber =
      attemptIndex +
      1;

    notifyRequestObserver(
      dependencies.onEvent,
      {
        type:
          'started',
        operation:
          description,
        attempt:
          attemptNumber,
        maxAttempts:
          totalAttempts
      }
    );

    try {
      const result =
        await operation({
          timeout_ms:
            aiConfig
              .requestTimeoutMs,

          retries: {
            strategy:
              'none'
          }
        });

      notifyRequestObserver(
        dependencies.onEvent,
        {
          type:
            'completed',
          operation:
            description,
          attempt:
            attemptNumber,
          maxAttempts:
            totalAttempts
        }
      );

      return result;
    } catch (
      error:
        unknown
    ) {
      const retriesRemaining =
        attemptIndex <
        aiConfig.maxRetries;

      if (
        !retriesRemaining ||
        !isRetryableGeminiError(
          error
        )
      ) {
        if (
          error instanceof
          CheckQuestError
        ) {
          throw error;
        }

        throw createFinalError(
          error
        );
      }

      const statusCode =
        getGeminiStatusCode(
          error
        );
      const delayMs =
        calculateRetryDelayMs(
          error,
          attemptIndex,
          random
        );

      notifyRequestObserver(
        dependencies.onEvent,
        {
          type:
            'retrying',
          operation:
            description,
          attempt:
            attemptNumber,
          maxAttempts:
            totalAttempts,
          retryDelayMs:
            delayMs,
          statusCode
        }
      );

      await waitForDelay(
        delayMs
      );
    }
  }

  throw new CheckQuestError(
    'INTERNAL',
    'Gemini request ended unexpectedly.',
    {
      phase:
        'gemini-request'
    }
  );
}
