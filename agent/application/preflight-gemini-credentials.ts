import {
  classifyGeminiCredentialRejection,
  probeGeminiCredentials,
  type ProbeGeminiCredentialsInput
} from '../ai/preflight-gemini-credentials';
import {
  getGeminiStatusCode
} from '../ai/run-gemini-request';
import {
  requireGeminiApiKey
} from '../ai/resolve-gemini-api-key';
import {
  CheckQuestError
} from '../errors/checkquest-error';
import {
  normalizeRunCancellation,
  throwIfRunCancelled
} from '../errors/run-cancellation';

export type GeminiCredentialPreflightResult =
  | {
      accepted:
        true;
    }
  | {
      accepted:
        false;
      reason:
        | 'authentication'
        | 'authorization';
      message:
        string;
    };

export interface PreflightGeminiCredentialsInput {
  geminiApiKey:
    string;
  signal?:
    AbortSignal;
}

export interface PreflightGeminiCredentialsDependencies {
  probe?:
    (
      input:
        ProbeGeminiCredentialsInput
    ) => Promise<void>;
}

export async function preflightGeminiCredentials(
  input:
    PreflightGeminiCredentialsInput,
  dependencies:
    PreflightGeminiCredentialsDependencies = {}
): Promise<
  GeminiCredentialPreflightResult
> {
  const probe =
    dependencies.probe ??
    probeGeminiCredentials;
  const geminiApiKey =
    requireGeminiApiKey(
      input.geminiApiKey
    );

  throwIfRunCancelled(
    input.signal,
    undefined,
    'gemini-credential-preflight'
  );

  try {
    await probe({
      geminiApiKey:
        geminiApiKey,
      signal:
        input.signal
    });
  } catch (
    error:
      unknown
  ) {
    const cancellationError =
      normalizeRunCancellation(
        error,
        input.signal,
        undefined,
        'gemini-credential-preflight'
      );

    if (
      cancellationError instanceof
        CheckQuestError &&
      cancellationError.code ===
        'CANCELLED'
    ) {
      throw cancellationError;
    }

    const rejection =
      classifyGeminiCredentialRejection(
        error
      );

    if (
      rejection ===
        'authentication'
    ) {
      return {
        accepted:
          false,
        reason:
          rejection,
        message:
          'Gemini API key could not be authenticated.'
      };
    }

    if (
      rejection ===
        'authorization'
    ) {
      return {
        accepted:
          false,
        reason:
          rejection,
        message:
          'Gemini API key is not authorized for this request.'
      };
    }

    const statusCode =
      getGeminiStatusCode(
        error
      );

    throw new CheckQuestError(
      'MODEL',
      statusCode ===
        429
        ? 'Gemini could not check credentials because its rate limit or quota was reached.'
        : 'Gemini credentials could not be checked. Try again.',
      {
        phase:
          'gemini-credential-preflight',
        statusCode:
          statusCode ??
          undefined,
        retryable:
          statusCode ===
            429 ||
          (
            statusCode !==
              null &&
            statusCode >=
              500
          )
      }
    );
  }

  throwIfRunCancelled(
    input.signal,
    undefined,
    'gemini-credential-preflight'
  );

  return {
    accepted:
      true
  };
}
