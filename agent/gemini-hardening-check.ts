import assert from 'node:assert/strict';

import { z } from 'zod';

import { parseModelJsonResponse } from './ai/parse-model-json-response';
import { resolveGeminiApiKey } from './ai/resolve-gemini-api-key';
import { runGeminiRequest } from './ai/run-gemini-request';
import { CheckQuestError, formatPublicError } from './errors/checkquest-error';

interface RetryScenario {
  name: string;
  failure: unknown;
  expectedAttempts: 1 | 2;
}

function statusError(status: number): Error & {
  status: number;
} {
  return Object.assign(new Error('PRIVATE_TRANSPORT_BODY_SENTINEL'), {
    status
  });
}

function codeError(code: string): Error & {
  code: string;
} {
  return Object.assign(new Error('PRIVATE_TRANSPORT_BODY_SENTINEL'), {
    code
  });
}

async function assertRetryScenario(scenario: RetryScenario): Promise<void> {
  let attempts = 0;
  const delays: number[] = [];

  const result = await runGeminiRequest(
    scenario.name,
    async () => {
      attempts += 1;

      if (attempts === 1) {
        throw scenario.failure;
      }

      return 'success';
    },
    {
      wait: async delayMs => {
        delays.push(delayMs);
      },
      random: () => 0
    }
  ).then(
    value => ({
      value,
      error: null
    }),
    (error: unknown) => ({
      value: null,
      error
    })
  );

  assert.equal(attempts, scenario.expectedAttempts, scenario.name);

  assert.equal(delays.length, scenario.expectedAttempts - 1, scenario.name);

  if (scenario.expectedAttempts === 2) {
    assert.equal(result.value, 'success', scenario.name);
  } else {
    assert.ok(result.error instanceof CheckQuestError, scenario.name);
    assert.equal(
      result.error.message.includes('PRIVATE_TRANSPORT_BODY_SENTINEL'),
      false,
      scenario.name
    );
  }
}

async function main(): Promise<void> {
  const keySentinel = 'GEMINI_KEY_SENTINEL';

  assert.equal(
    resolveGeminiApiKey({
      GEMINI_API_KEY: keySentinel,
      GOOGLE_API_KEY: 'UNRELATED_GOOGLE_KEY'
    }),
    keySentinel
  );

  for (const environment of [
    {},
    {
      GEMINI_API_KEY: '   '
    },
    {
      GOOGLE_API_KEY: 'UNRELATED_GOOGLE_KEY'
    }
  ]) {
    assert.throws(
      () => resolveGeminiApiKey(environment),
      error =>
        error instanceof CheckQuestError &&
        error.code === 'MODEL' &&
        !error.message.includes(keySentinel) &&
        !formatPublicError(error).includes(keySentinel)
    );
  }

  const responseSchema = z.object({
    result: z.literal('accepted')
  });
  const responseSentinel = 'MODEL_RESPONSE_SECRET_SENTINEL';

  for (const rawResponse of [
    `${responseSentinel} is not JSON`,
    JSON.stringify({
      result: responseSentinel
    })
  ]) {
    assert.throws(
      () => parseModelJsonResponse(rawResponse, 'synthetic-model-response', responseSchema),
      error =>
        error instanceof CheckQuestError &&
        error.code === 'MODEL_RESPONSE' &&
        error.retryable === false &&
        !error.message.includes(responseSentinel) &&
        !formatPublicError(error).includes(responseSentinel)
    );
  }

  assert.deepEqual(
    parseModelJsonResponse(
      '```json\n{"result":"accepted"}\n```',
      'synthetic-model-response',
      responseSchema
    ),
    {
      result: 'accepted'
    }
  );

  let immediateAttempts = 0;
  await runGeminiRequest(
    'immediate success',
    async () => {
      immediateAttempts += 1;
      return 'success';
    },
    {
      wait: async () => {
        assert.fail('Immediate success must not wait.');
      }
    }
  );
  assert.equal(immediateAttempts, 1);

  const scenarios: RetryScenario[] = [
    {
      name: '401 is not retried',
      failure: statusError(401),
      expectedAttempts: 1
    },
    {
      name: '403 is not retried',
      failure: statusError(403),
      expectedAttempts: 1
    },
    {
      name: '408 is retried',
      failure: statusError(408),
      expectedAttempts: 2
    },
    {
      name: '429 is retried',
      failure: statusError(429),
      expectedAttempts: 2
    },
    ...([500, 502, 503, 504] as const).map(status => ({
      name: `${status} is retried`,
      failure: statusError(status),
      expectedAttempts: 2 as const
    })),
    {
      name: '501 is not retried',
      failure: statusError(501),
      expectedAttempts: 1
    },
    {
      name: '505 is not retried',
      failure: statusError(505),
      expectedAttempts: 1
    },
    {
      name: 'structured timeout is retried',
      failure: codeError('ETIMEDOUT'),
      expectedAttempts: 2
    },
    {
      name: 'connection reset is retried',
      failure: codeError('ECONNRESET'),
      expectedAttempts: 2
    },
    {
      name: 'temporary DNS failure is retried',
      failure: codeError('EAI_AGAIN'),
      expectedAttempts: 2
    },
    {
      name: 'generic aborted message is not retried',
      failure: new Error('Request aborted for an unrelated reason.'),
      expectedAttempts: 1
    },
    {
      name: 'generic error is not retried',
      failure: new Error('Unrelated failure.'),
      expectedAttempts: 1
    },
    {
      name: 'model response failure is not retried',
      failure: new CheckQuestError('MODEL_RESPONSE', 'Synthetic safe model response failure.', {
        retryable: false
      }),
      expectedAttempts: 1
    }
  ];

  for (const scenario of scenarios) {
    await assertRetryScenario(scenario);
  }

  let failedAttempts = 0;
  const secondFailure = statusError(503);

  await assert.rejects(
    runGeminiRequest(
      'two failures',
      async () => {
        failedAttempts += 1;
        throw secondFailure;
      },
      {
        wait: async () => {
          return;
        },
        random: () => 0
      }
    ),
    error =>
      error instanceof CheckQuestError && error.code === 'MODEL' && error.cause === secondFailure
  );
  assert.equal(failedAttempts, 2);

  const boundedDelays: number[] = [];
  let boundedAttempts = 0;

  await runGeminiRequest(
    'bounded retry delay',
    async () => {
      boundedAttempts += 1;

      if (boundedAttempts === 1) {
        throw Object.assign(new Error('Retry in 600 seconds.'), {
          status: 429
        });
      }

      return 'success';
    },
    {
      wait: async delayMs => {
        boundedDelays.push(delayMs);
      },
      random: () => 0.5
    }
  );

  assert.deepEqual(boundedDelays, [60_000]);

  console.log('Stage 8D.1 Gemini BYOK, response privacy, and bounded retry checks passed.');
}

main().catch((error: unknown) => {
  console.error('Stage 8D.1 Gemini hardening check failed.', error);
  process.exitCode = 1;
});
