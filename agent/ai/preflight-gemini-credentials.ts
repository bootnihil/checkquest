import { GoogleGenAI } from '@google/genai';

import { requireGeminiApiKey } from './resolve-gemini-api-key';

const credentialPreflightTimeoutMs = 10_000;

const authenticationReasons = new Set(['API_KEY_EXPIRED', 'API_KEY_INVALID', 'API_KEY_NOT_FOUND']);

const authorizationReasons = new Set([
  'API_KEY_ANDROID_APP_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IOS_APP_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'API_KEY_SERVICE_BLOCKED'
]);

export type GeminiCredentialRejectionKind = 'authentication' | 'authorization';

export interface ProbeGeminiCredentialsInput {
  geminiApiKey: string;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseProviderErrorBody(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof Error) || error.message.length > 100_000) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(error.message);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectStructuredStrings(value: unknown, key: string, depth = 0): string[] {
  if (depth > 6 || !isRecord(value)) {
    return [];
  }

  const values: string[] = [];

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === 'string') {
      values.push(entryValue);
    }

    if (Array.isArray(entryValue)) {
      for (const item of entryValue) {
        values.push(...collectStructuredStrings(item, key, depth + 1));
      }
    } else {
      values.push(...collectStructuredStrings(entryValue, key, depth + 1));
    }
  }

  return values;
}

function getHttpStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  return typeof error.status === 'number' ? error.status : null;
}

export function classifyGeminiCredentialRejection(
  error: unknown
): GeminiCredentialRejectionKind | null {
  const body = parseProviderErrorBody(error);
  const reasons = body === null ? [] : collectStructuredStrings(body, 'reason');

  if (reasons.some(reason => authenticationReasons.has(reason))) {
    return 'authentication';
  }

  if (reasons.some(reason => authorizationReasons.has(reason))) {
    return 'authorization';
  }

  const providerStatuses = body === null ? [] : collectStructuredStrings(body, 'status');

  if (getHttpStatus(error) === 401 || providerStatuses.includes('UNAUTHENTICATED')) {
    return 'authentication';
  }

  return null;
}

export async function probeGeminiCredentials(input: ProbeGeminiCredentialsInput): Promise<void> {
  const ai = new GoogleGenAI({
    apiKey: requireGeminiApiKey(input.geminiApiKey)
  });

  /*
   * models.list is an authenticated, non-generative GET. Requesting one item
   * proves that the key is accepted by the Gemini Developer API without
   * spending tokens or coupling the check to a particular model name.
   */
  await ai.models.list({
    config: {
      pageSize: 1,
      abortSignal: input.signal,
      httpOptions: {
        timeout: credentialPreflightTimeoutMs,
        retryOptions: {
          attempts: 1
        }
      }
    }
  });
}
