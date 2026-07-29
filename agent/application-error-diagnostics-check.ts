import assert from 'node:assert/strict';

import {
  sanitizeApplicationError
} from './application/sanitize-application-boundary';
import {
  CheckQuestError,
  formatPublicError
} from './errors/checkquest-error';
import {
  formatDeveloperErrorDiagnostic,
  isDeveloperDiagnosticsEnabled
} from './errors/format-developer-diagnostic';
import {
  completeRequiredCleanup,
  getSecondaryCleanupError
} from './errors/required-cleanup';

async function main():
  Promise<void> {
  const geminiApiKey =
    'GEMINI_SECRET_DIAGNOSTIC_SENTINEL';
  const bearerToken =
    'BEARER_SECRET_SENTINEL';
  const cookieValue =
    'COOKIE_SECRET_SENTINEL';
  const underlying =
    new TypeError(
      `Monday normalization failed for ${geminiApiKey}; Authorization: Bearer ${bearerToken}; Cookie: ${cookieValue}`
    );
  const sanitized =
    sanitizeApplicationError(
      underlying,
      'diagnostic-run',
      geminiApiKey
    );

  assert.equal(
    sanitized.code,
    'INTERNAL'
  );
  assert.equal(
    sanitized.message,
    'An unexpected CheckQuest failure occurred.'
  );
  assert.equal(
    sanitized.phase,
    'application-run'
  );
  assert.equal(
    sanitized.runId,
    'diagnostic-run'
  );
  assert.equal(
    sanitized.cause,
    underlying,
    'The internal exception must remain available after public error normalization.'
  );

  const publicOutput =
    formatPublicError(
      sanitized
    );

  assert.equal(
    publicOutput.includes(
      'Monday normalization failed'
    ),
    false
  );
  assert.equal(
    publicOutput.includes(
      geminiApiKey
    ),
    false
  );
  assert.equal(
    publicOutput.includes(
      bearerToken
    ),
    false
  );
  assert.equal(
    publicOutput.includes(
      cookieValue
    ),
    false
  );

  const developerOutput =
    formatDeveloperErrorDiagnostic(
      sanitized,
      {
        secrets: [
          geminiApiKey
        ]
      }
    );

  assert.match(
    developerOutput,
    /TypeError: Monday normalization failed/
  );

  for (
    const secret of
      [
        geminiApiKey,
        bearerToken,
        cookieValue
      ]
  ) {
    assert.equal(
      developerOutput.includes(
        secret
      ),
      false
    );
  }

  assert.match(
    developerOutput,
    /Authorization=\[REDACTED\]/
  );
  assert.match(
    developerOutput,
    /Cookie=\[REDACTED\]/
  );
  assert.equal(
    isDeveloperDiagnosticsEnabled({
      CHECKQUEST_DEBUG:
        '1'
    }),
    true
  );
  assert.equal(
    isDeveloperDiagnosticsEnabled({}),
    false
  );
  assert.equal(
    isDeveloperDiagnosticsEnabled({
      CHECKQUEST_DEBUG:
        'true'
    }),
    false
  );

  const arbitraryCause = {
    apiKey:
      geminiApiKey,
    requestBody: {
      private:
        true
    }
  };
  const arbitraryError =
    sanitizeApplicationError(
      arbitraryCause,
      'non-error-run',
      geminiApiKey
    );
  const arbitraryDiagnostic =
    formatDeveloperErrorDiagnostic(
      arbitraryError,
      {
        secrets: [
          geminiApiKey
        ]
      }
    );

  assert.match(
    arbitraryDiagnostic,
    /<non-Error object cause omitted>/
  );
  assert.equal(
    arbitraryDiagnostic.includes(
      'requestBody'
    ),
    false
  );

  const contextualError =
    new CheckQuestError(
      'INTERNAL',
      'Context redaction check.',
      {
        phase:
          `phase-${geminiApiKey}`,
        runId:
          `run-${geminiApiKey}`,
        candidateReference:
          `candidate-${geminiApiKey}`
      }
    );
  contextualError.name =
    `Error-${geminiApiKey}`;
  const contextualDiagnostic =
    formatDeveloperErrorDiagnostic(
      contextualError,
      {
        secrets: [
          geminiApiKey
        ]
      }
    );

  assert.equal(
    contextualDiagnostic.includes(
      geminiApiKey
    ),
    false
  );
  assert.match(
    contextualDiagnostic,
    /phase-\[REDACTED\]/
  );

  const existingCause =
    new Error(
      'Existing private cause.'
    );
  const existing =
    new CheckQuestError(
      'MODEL',
      `Safe model failure ${geminiApiKey}`,
      {
        phase:
          'model-call',
        runId:
          'existing-error',
        cause:
          existingCause
      }
    );
  const copiedExisting =
    sanitizeApplicationError(
      existing,
      'unused-run',
      geminiApiKey
    );

  assert.equal(
    copiedExisting.code,
    'MODEL'
  );
  assert.equal(
    copiedExisting.message,
    'Safe model failure [REDACTED]'
  );
  assert.equal(
    copiedExisting.cause,
    undefined,
    'Existing CheckQuestError boundary-copy behavior remains unchanged.'
  );

  const cleanupFailure =
    new Error(
      'Cleanup detail.'
    );

  await completeRequiredCleanup(
    underlying,
    [
      () => {
        throw cleanupFailure;
      }
    ],
    {
      phase:
        'diagnostic-cleanup',
      runId:
        'diagnostic-run'
    }
  );

  const withCleanup =
    sanitizeApplicationError(
      underlying,
      'diagnostic-run',
      geminiApiKey
    );

  assert.equal(
    withCleanup.cause,
    underlying
  );
  assert.equal(
    getSecondaryCleanupError(
      withCleanup
    )?.code,
    'CLEANUP'
  );

  console.log(
    'Application INTERNAL error observability and developer-diagnostic checks passed.'
  );
}

void main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Application error diagnostic check failed.',
      error
    );
    process.exitCode =
      1;
  }
);
