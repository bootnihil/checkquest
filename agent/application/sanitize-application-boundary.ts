import { CheckQuestError } from '../errors/checkquest-error';
import { getSecondaryCleanupError } from '../errors/required-cleanup';

function redactCredential(value: string, geminiApiKey: string | undefined): string {
  if (geminiApiKey === undefined || geminiApiKey.length === 0) {
    return value;
  }

  return value.replaceAll(geminiApiKey, '[REDACTED]');
}

export function sanitizeApplicationValue<T>(value: T, geminiApiKey: string | undefined): T {
  if (typeof value === 'string') {
    return redactCredential(value, geminiApiKey) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeApplicationValue(item, geminiApiKey)) as T;
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeApplicationValue(item, geminiApiKey)])
  ) as T;
}

function copyCheckQuestError(
  error: CheckQuestError,
  geminiApiKey: string | undefined
): CheckQuestError {
  const sanitizedError = new CheckQuestError(
    error.code,
    redactCredential(error.message, geminiApiKey),
    {
      phase: error.phase === undefined ? undefined : redactCredential(error.phase, geminiApiKey),
      runId: error.runId === undefined ? undefined : redactCredential(error.runId, geminiApiKey),
      pageNumber: error.pageNumber,
      navigationStep: error.navigationStep,
      candidateReference:
        error.candidateReference === undefined
          ? undefined
          : redactCredential(error.candidateReference, geminiApiKey),
      requestedUrl:
        error.requestedUrl === undefined
          ? undefined
          : redactCredential(error.requestedUrl, geminiApiKey),
      finalUrl:
        error.finalUrl === undefined ? undefined : redactCredential(error.finalUrl, geminiApiKey),
      statusCode: error.statusCode,
      retryable: error.retryable
    }
  );

  const cleanupError = getSecondaryCleanupError(error);

  if (cleanupError !== undefined) {
    sanitizedError.secondaryCleanupError = copyCheckQuestError(cleanupError, geminiApiKey);
  }

  return sanitizedError;
}

export function sanitizeApplicationError(
  error: unknown,
  runId: string,
  geminiApiKey: string | undefined
): CheckQuestError {
  if (error instanceof CheckQuestError) {
    return copyCheckQuestError(error, geminiApiKey);
  }

  const sanitizedError = new CheckQuestError(
    'INTERNAL',
    'An unexpected CheckQuest failure occurred.',
    {
      phase: 'application-run',
      runId,
      cause: error
    }
  );
  const cleanupError = getSecondaryCleanupError(error);

  if (cleanupError !== undefined) {
    sanitizedError.secondaryCleanupError = copyCheckQuestError(cleanupError, geminiApiKey);
  }

  return sanitizedError;
}
