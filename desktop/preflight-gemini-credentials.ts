import {
  classifyGeminiCredentialRejection,
  probeGeminiCredentials,
  type ProbeGeminiCredentialsInput
} from '../agent/ai/probe-gemini-credentials';
import { getGeminiStatusCode } from '../agent/ai/run-gemini-request';
import { requireGeminiApiKey } from '../agent/ai/resolve-gemini-api-key';
import { CheckQuestError } from '../agent/errors/checkquest-error';
import { normalizeRunCancellation, throwIfRunCancelled } from '../agent/errors/run-cancellation';

export type DesktopGeminiCredentialPreflightResult =
  | {
      accepted: true;
    }
  | {
      accepted: false;
      reason: 'authentication' | 'authorization';
      message: string;
    };

export interface PreflightDesktopGeminiCredentialsInput {
  geminiApiKey: string;
  signal?: AbortSignal;
}

export interface PreflightDesktopGeminiCredentialsDependencies {
  probe?: (input: ProbeGeminiCredentialsInput) => Promise<void>;
}

export async function preflightDesktopGeminiCredentials(
  input: PreflightDesktopGeminiCredentialsInput,
  dependencies: PreflightDesktopGeminiCredentialsDependencies = {}
): Promise<DesktopGeminiCredentialPreflightResult> {
  const probe = dependencies.probe ?? probeGeminiCredentials;
  const geminiApiKey = requireGeminiApiKey(input.geminiApiKey);

  throwIfRunCancelled(input.signal, undefined, 'gemini-credential-preflight');

  try {
    await probe({
      geminiApiKey: geminiApiKey,
      signal: input.signal
    });
  } catch (error: unknown) {
    const cancellationError = normalizeRunCancellation(
      error,
      input.signal,
      undefined,
      'gemini-credential-preflight'
    );

    if (cancellationError instanceof CheckQuestError && cancellationError.code === 'CANCELLED') {
      throw cancellationError;
    }

    const rejection = classifyGeminiCredentialRejection(error);

    if (rejection === 'authentication') {
      return {
        accepted: false,
        reason: rejection,
        message: 'Gemini API key could not be authenticated.'
      };
    }

    if (rejection === 'authorization') {
      return {
        accepted: false,
        reason: rejection,
        message: 'Gemini API key is not authorized for this request.'
      };
    }

    const statusCode = getGeminiStatusCode(error);

    throw new CheckQuestError(
      'MODEL',
      statusCode === 429
        ? 'Gemini could not check credentials because its rate limit or quota was reached.'
        : 'Gemini credentials could not be checked. Try again.',
      {
        phase: 'gemini-credential-preflight',
        statusCode: statusCode ?? undefined,
        retryable: statusCode === 429 || (statusCode !== null && statusCode >= 500)
      }
    );
  }

  throwIfRunCancelled(input.signal, undefined, 'gemini-credential-preflight');

  return {
    accepted: true
  };
}
