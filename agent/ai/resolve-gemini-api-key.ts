import { CheckQuestError } from '../errors/checkquest-error';

export interface GeminiCredentialEnvironment {
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

export function resolveGeminiApiKey(
  environment: GeminiCredentialEnvironment = process.env
): string {
  return requireGeminiApiKey(environment.GEMINI_API_KEY);
}

export function requireGeminiApiKey(apiKey?: string): string {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new CheckQuestError(
      'MODEL',
      'GEMINI_API_KEY is required for Gemini-backed CheckQuest operations.',
      {
        phase: 'gemini-credential-resolution',
        retryable: false
      }
    );
  }

  return apiKey;
}
