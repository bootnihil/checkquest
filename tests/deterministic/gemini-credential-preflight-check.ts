import assert from 'node:assert/strict';

import { classifyGeminiCredentialRejection } from '../../agent/ai/probe-gemini-credentials';
import { preflightDesktopGeminiCredentials } from '../../desktop/preflight-gemini-credentials';
import { CheckQuestError } from '../../agent/errors/checkquest-error';

function providerError(status: number, body: Record<string, unknown>): Error {
  return Object.assign(new Error(JSON.stringify(body)), {
    status
  });
}

async function main(): Promise<void> {
  await assert.rejects(
    preflightDesktopGeminiCredentials(
      {
        geminiApiKey: '   '
      },
      {
        probe: async () => undefined
      }
    ),
    error =>
      error instanceof CheckQuestError &&
      error.code === 'MODEL' &&
      error.phase === 'gemini-credential-resolution'
  );

  const invalidKeyError = providerError(400, {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      details: [
        {
          reason: 'API_KEY_INVALID',
          domain: 'googleapis.com'
        }
      ]
    }
  });
  const restrictedKeyError = providerError(403, {
    error: {
      code: 403,
      status: 'PERMISSION_DENIED',
      details: [
        {
          reason: 'API_KEY_SERVICE_BLOCKED',
          domain: 'googleapis.com'
        }
      ]
    }
  });
  const unrelatedBadRequest = providerError(400, {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      details: [
        {
          reason: 'REQUEST_INVALID'
        }
      ]
    }
  });
  const unrelatedPermissionError = providerError(403, {
    error: {
      code: 403,
      status: 'PERMISSION_DENIED',
      details: [
        {
          reason: 'QUOTA_PROJECT_MISSING'
        }
      ]
    }
  });

  assert.equal(classifyGeminiCredentialRejection(invalidKeyError), 'authentication');
  assert.equal(classifyGeminiCredentialRejection(restrictedKeyError), 'authorization');
  assert.equal(classifyGeminiCredentialRejection(unrelatedBadRequest), null);
  assert.equal(classifyGeminiCredentialRejection(unrelatedPermissionError), null);
  assert.equal(
    classifyGeminiCredentialRejection(
      Object.assign(new Error('Non-JSON authentication failure.'), {
        status: 401
      })
    ),
    'authentication'
  );

  const credential = 'preflight-test-secret';
  let observedCredential: string | undefined;
  const accepted = await preflightDesktopGeminiCredentials(
    {
      geminiApiKey: credential
    },
    {
      probe: async input => {
        observedCredential = input.geminiApiKey;
      }
    }
  );

  assert.deepEqual(accepted, {
    accepted: true
  });
  assert.equal(observedCredential, credential);

  const authenticationRejected = await preflightDesktopGeminiCredentials(
    {
      geminiApiKey: credential
    },
    {
      probe: async () => {
        throw invalidKeyError;
      }
    }
  );

  assert.deepEqual(authenticationRejected, {
    accepted: false,
    reason: 'authentication',
    message: 'Gemini API key could not be authenticated.'
  });
  assert.equal(JSON.stringify(authenticationRejected).includes(credential), false);

  const authorizationRejected = await preflightDesktopGeminiCredentials(
    {
      geminiApiKey: credential
    },
    {
      probe: async () => {
        throw restrictedKeyError;
      }
    }
  );

  assert.deepEqual(authorizationRejected, {
    accepted: false,
    reason: 'authorization',
    message: 'Gemini API key is not authorized for this request.'
  });

  await assert.rejects(
    preflightDesktopGeminiCredentials(
      {
        geminiApiKey: credential
      },
      {
        probe: async () => {
          throw providerError(400, {
            error: {
              message: `Unrelated request failure ${credential}.`,
              reason: 'REQUEST_INVALID'
            }
          });
        }
      }
    ),
    error =>
      error instanceof CheckQuestError &&
      error.code === 'MODEL' &&
      error.message === 'Gemini credentials could not be checked. Try again.' &&
      error.cause === undefined &&
      !JSON.stringify(error).includes(credential)
  );

  const abortController = new AbortController();
  const cancelledPreflight = preflightDesktopGeminiCredentials(
    {
      geminiApiKey: credential,
      signal: abortController.signal
    },
    {
      probe: input =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Provider request aborted.'));
            },
            {
              once: true
            }
          );
        })
    }
  );

  abortController.abort();

  await assert.rejects(
    cancelledPreflight,
    error =>
      error instanceof CheckQuestError &&
      error.code === 'CANCELLED' &&
      error.phase === 'gemini-credential-preflight'
  );

  console.log('Gemini credential preflight checks passed.');
}

void main();
