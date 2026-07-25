import {
  resolveGeminiApiKey,
  type GeminiCredentialEnvironment
} from '../ai/resolve-gemini-api-key';
import type {
  RunSiteCredentials
} from '../run/run-site';

export function resolveRunSiteCredentials(
  environment:
    GeminiCredentialEnvironment =
      process.env
): RunSiteCredentials {
  return {
    geminiApiKey:
      resolveGeminiApiKey(
        environment
      )
  };
}
