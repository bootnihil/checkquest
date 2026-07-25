import assert from 'node:assert/strict';

import {
  CheckQuestError,
  formatPublicError
} from './errors/checkquest-error';
import {
  getSecondaryCleanupError,
  runWithRequiredCleanup
} from './errors/required-cleanup';
import {
  createSafeDisplayUrl
} from './errors/safe-display-url';
import {
  validateRunSiteInput
} from './run/validate-run-site-input';
import {
  runSite
} from './run/run-site';

const validSite = {
  id:
    'synthetic',
  name:
    'Synthetic site',
  startUrl:
    'https://example.com/start?token=private#section',
  allowedHosts: [
    'example.com'
  ],
  maxPages:
    2,
  maxAgentSteps:
    1,
  maxExploratoryStepsPerPage:
    0,
  allowFormSubmission:
    false
};

function assertConfigurationError(
  operation:
    () => unknown
): void {
  assert.throws(
    operation,
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CONFIGURATION' &&
      error.phase ===
        'run-input-validation'
  );
}

async function main():
  Promise<void> {
  const privateCause =
    new Error(
      'PRIVATE_CAUSE_SENTINEL'
    );
  const structuredError =
    new CheckQuestError(
      'NAVIGATION',
      'Unable to open the selected navigation target.',
      {
        phase:
          'agent-navigation',
        runId:
          'safe-run',
        requestedUrl:
          'https://example.com/path',
        cause:
          privateCause
      }
    );

  assert.equal(
    structuredError.cause,
    privateCause
  );
  assert.equal(
    structuredError.message.includes(
      'PRIVATE_CAUSE_SENTINEL'
    ),
    false
  );
  assert.equal(
    formatPublicError(
      structuredError
    ).includes(
      'PRIVATE_CAUSE_SENTINEL'
    ),
    false
  );
  assert.equal(
    formatPublicError(
      privateCause
    ),
    'An unexpected CheckQuest failure occurred.'
  );

  assert.equal(
    createSafeDisplayUrl(
      'https://user:password@example.com/path/to/page?token=PRIVATE#fragment'
    ),
    'https://example.com/path/to/page'
  );

  const validated =
    validateRunSiteInput({
      site:
        validSite,
      startedAt:
        new Date(
          '2026-07-25T12:00:00.000Z'
        ),
      runId:
        'stage8d1-valid_run'
    });

  assert.equal(
    validated.runId,
    'stage8d1-valid_run'
  );
  assert.equal(
    validated.configuredStartUrl
      .hostname,
    'example.com'
  );

  const generated =
    validateRunSiteInput({
      site:
        validSite,
      startedAt:
        new Date(
          '2026-07-25T12:00:00.000Z'
        )
    });

  assert.equal(
    generated.runId,
    '2026-07-25T12-00-00-000Z'
  );

  assertConfigurationError(
    () =>
      validateRunSiteInput({
        site: {
          ...validSite,
          startUrl:
            'ftp://example.com/file'
        }
      })
  );
  assertConfigurationError(
    () =>
      validateRunSiteInput({
        site: {
          ...validSite,
          allowedHosts: [
            'different.example'
          ]
        }
      })
  );

  for (
    const [
      budgetName,
      invalidValue
    ] of [
      [
        'maxPages',
        0
      ],
      [
        'maxPages',
        1.5
      ],
      [
        'maxAgentSteps',
        -1
      ],
      [
        'maxAgentSteps',
        Number.NaN
      ],
      [
        'maxExploratoryStepsPerPage',
        -1
      ],
      [
        'maxExploratoryStepsPerPage',
        2.5
      ]
    ] as const
  ) {
    assertConfigurationError(
      () =>
        validateRunSiteInput({
          site: {
            ...validSite,
            [budgetName]:
              invalidValue
          }
        })
    );
  }

  assertConfigurationError(
    () =>
      validateRunSiteInput({
        site: {
          ...validSite,
          allowFormSubmission:
            'yes'
        } as unknown as
          typeof validSite
      })
  );
  assertConfigurationError(
    () =>
      validateRunSiteInput({
        site:
          validSite,
        startedAt:
          new Date(
            Number.NaN
          )
      })
  );

  for (
    const unsafeRunId of
      [
        '',
        '..',
        '../escape',
        String.raw`..\escape`,
        'C:\\absolute',
        '/absolute',
        'contains:colon',
        'contains.dot',
        'CON',
        'lpt1'
      ]
  ) {
    assertConfigurationError(
      () =>
        validateRunSiteInput({
          site:
            validSite,
          runId:
            unsafeRunId
        })
    );
  }

  const operationalFailure =
    new Error(
      'PRIMARY_OPERATION_FAILURE'
    );
  const cleanupFailure =
    new Error(
      'SECONDARY_CLEANUP_FAILURE'
    );

  await assert.rejects(
    runWithRequiredCleanup(
      async () => {
        throw operationalFailure;
      },
      [
        () => {
          throw cleanupFailure;
        }
      ],
      {
        phase:
          'deterministic-cleanup',
        runId:
          'cleanup-primary'
      }
    ),
    error =>
      error ===
        operationalFailure
  );

  const secondaryCleanupError =
    getSecondaryCleanupError(
      operationalFailure
    );

  assert.equal(
    secondaryCleanupError
      ?.code,
    'CLEANUP'
  );
  assert.equal(
    secondaryCleanupError
      ?.cause,
    cleanupFailure
  );

  await assert.rejects(
    runWithRequiredCleanup(
      async () =>
        'successful operation',
      [
        () => {
          throw cleanupFailure;
        }
      ],
      {
        phase:
          'deterministic-cleanup',
        runId:
          'cleanup-only'
      }
    ),
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CLEANUP' &&
      error.cause ===
        cleanupFailure
  );

  const originalGeminiApiKey =
    process.env
      .GEMINI_API_KEY;

  delete process.env
    .GEMINI_API_KEY;

  try {
    await assert.rejects(
      runSite({
        site: {
          ...validSite,
          startUrl:
            'http://127.0.0.1:1/',
          allowedHosts: [
            '127.0.0.1'
          ],
          maxPages:
            1,
          maxAgentSteps:
            0
        },
        runId:
          'missing-key-preflight',
        startedAt:
          new Date(
            '2026-07-25T12:00:00.000Z'
          )
      }),
      error =>
        error instanceof
          CheckQuestError &&
        error.code ===
          'MODEL' &&
        error.phase ===
          'gemini-credential-resolution'
    );
  } finally {
    if (
      originalGeminiApiKey ===
      undefined
    ) {
      delete process.env
        .GEMINI_API_KEY;
    } else {
      process.env
        .GEMINI_API_KEY =
          originalGeminiApiKey;
    }
  }

  console.log(
    'Stage 8D.1 structured error, input validation, URL privacy, and cleanup precedence checks passed.'
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Stage 8D.1 error handling check failed.',
      error
    );
    process.exitCode =
      1;
  }
);
