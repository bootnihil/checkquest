import { aiConfig } from '../config/ai-config';

export interface GeminiRequestOptions {
  timeout_ms: number;
  retries: {
    strategy: 'none';
  };
}

export class GeminiRequestError extends Error {
  readonly statusCode: number | null;

  constructor(
    message: string,
    statusCode: number | null,
    cause: unknown
  ) {
    super(message, { cause });

    this.name = 'GeminiRequestError';
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown Gemini API error.';
}

function getStatusCode(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  if (typeof error.status === 'number') {
    return error.status;
  }

  if (typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  return null;
}

function getRetryAfterMs(error: unknown): number | null {
  const message = getErrorMessage(error);
  const retryMatch = message.match(/retry in\s+([\d.]+)\s*s/i);

  if (!retryMatch) {
    return null;
  }

  const retrySeconds = Number.parseFloat(retryMatch[1]);

  if (!Number.isFinite(retrySeconds) || retrySeconds < 0) {
    return null;
  }

  return Math.ceil(retrySeconds * 1_000);
}

function isTimeoutError(error: unknown): boolean {
  return /timeout|timed out|request timed out|aborted/i.test(
    getErrorMessage(error)
  );
}

function isRetryableError(error: unknown): boolean {
  const statusCode = getStatusCode(error);

  return (
    statusCode === 408 ||
    statusCode === 429 ||
    (statusCode !== null &&
      statusCode >= 500 &&
      statusCode <= 599) ||
    isTimeoutError(error)
  );
}

function calculateRetryDelayMs(
  error: unknown,
  retryNumber: number
): number {
  const serverDelay = getRetryAfterMs(error);

  if (serverDelay !== null) {
    return Math.min(
      serverDelay,
      aiConfig.maxRetryDelayMs
    );
  }

  const exponentialDelay =
    aiConfig.baseRetryDelayMs *
    2 ** retryNumber;

  const jitterMs = Math.floor(Math.random() * 500);

  return Math.min(
    exponentialDelay + jitterMs,
    aiConfig.maxRetryDelayMs
  );
}

function createFinalError(error: unknown): GeminiRequestError {
  const statusCode = getStatusCode(error);
  const originalMessage = getErrorMessage(error);
  const retryAfterMs = getRetryAfterMs(error);

  if (statusCode === 429) {
    const retryText =
      retryAfterMs === null
        ? ''
        : ` Suggested wait: approximately ${Math.ceil(
            retryAfterMs / 1_000
          )} seconds.`;

    return new GeminiRequestError(
      `Gemini rate limit or quota reached (429).${retryText}`,
      statusCode,
      error
    );
  }

  if (statusCode === 408 || isTimeoutError(error)) {
    return new GeminiRequestError(
      `Gemini did not respond within ${Math.ceil(
        aiConfig.requestTimeoutMs / 1_000
      )} seconds.`,
      statusCode,
      error
    );
  }

  if (
    statusCode !== null &&
    statusCode >= 500 &&
    statusCode <= 599
  ) {
    return new GeminiRequestError(
      `Gemini returned a temporary server error (${statusCode}).`,
      statusCode,
      error
    );
  }

  return new GeminiRequestError(
    `Gemini request failed${
      statusCode === null ? '' : ` (${statusCode})`
    }: ${originalMessage}`,
    statusCode,
    error
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function runGeminiRequest<T>(
  description: string,
  operation: (
    options: GeminiRequestOptions
  ) => Promise<T>
): Promise<T> {
  const totalAttempts = aiConfig.maxRetries + 1;

  for (
    let attemptIndex = 0;
    attemptIndex < totalAttempts;
    attemptIndex += 1
  ) {
    const attemptNumber = attemptIndex + 1;

    console.log(
      `\nGemini: ${description} ` +
        `(attempt ${attemptNumber}/${totalAttempts})...`
    );

    try {
      const result = await operation({
        timeout_ms: aiConfig.requestTimeoutMs,

        // Disable hidden SDK retries. This wrapper controls them.
        retries: {
          strategy: 'none'
        }
      });

      console.log('Gemini: response received.');

      return result;
    } catch (error: unknown) {
      const retriesRemaining =
        attemptIndex < aiConfig.maxRetries;

      if (
        !retriesRemaining ||
        !isRetryableError(error)
      ) {
        throw createFinalError(error);
      }

      const statusCode = getStatusCode(error);
      const delayMs = calculateRetryDelayMs(
        error,
        attemptIndex
      );

      console.warn(
        `Gemini: temporary error${
          statusCode === null
            ? ''
            : ` ${statusCode}`
        }. Retrying in approximately ${Math.ceil(
          delayMs / 1_000
        )} seconds...`
      );

      await wait(delayMs);
    }
  }

  throw new GeminiRequestError(
    'Gemini request ended unexpectedly.',
    null,
    undefined
  );
}
