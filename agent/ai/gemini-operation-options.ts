import type { GeminiRequestDependencies } from './run-gemini-request';

export interface GeminiOperationOptions extends Pick<GeminiRequestDependencies, 'onEvent'> {
  geminiApiKey?: string;
  model?: string;
  signal?: AbortSignal;
}
