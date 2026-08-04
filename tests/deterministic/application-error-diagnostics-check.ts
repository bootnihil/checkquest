import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { sanitizeApplicationError } from '../../agent/application/sanitize-application-boundary';
import { parseModelJsonResponse } from '../../agent/ai/parse-model-json-response';
import { CheckQuestError, formatPublicError } from '../../agent/errors/checkquest-error';
import {
  formatDeveloperErrorDiagnostic,
  isDeveloperDiagnosticsEnabled,
  maximumDeveloperDiagnosticLength,
  persistDeveloperErrorDiagnostic
} from '../../agent/errors/format-developer-diagnostic';
import {
  completeRequiredCleanup,
  getSecondaryCleanupError
} from '../../agent/errors/required-cleanup';

async function main(): Promise<void> {
  const geminiApiKey = 'GEMINI_SECRET_DIAGNOSTIC_SENTINEL';
  const bearerToken = 'BEARER_SECRET_SENTINEL';
  const cookieValue = 'COOKIE_SECRET_SENTINEL';
  const underlying = new TypeError(
    `Monday normalization failed for ${geminiApiKey}; Authorization: Bearer ${bearerToken}; Cookie: ${cookieValue}`
  );
  const sanitized = sanitizeApplicationError(underlying, 'diagnostic-run', geminiApiKey);

  assert.equal(sanitized.code, 'INTERNAL');
  assert.equal(sanitized.message, 'An unexpected CheckQuest failure occurred.');
  assert.equal(sanitized.phase, 'application-run');
  assert.equal(sanitized.runId, 'diagnostic-run');
  assert.equal(
    sanitized.cause,
    underlying,
    'The internal exception must remain available after public error normalization.'
  );

  const publicOutput = formatPublicError(sanitized);

  assert.equal(publicOutput.includes('Monday normalization failed'), false);
  assert.equal(publicOutput.includes(geminiApiKey), false);
  assert.equal(publicOutput.includes(bearerToken), false);
  assert.equal(publicOutput.includes(cookieValue), false);

  const developerOutput = formatDeveloperErrorDiagnostic(sanitized, {
    secrets: [geminiApiKey]
  });

  assert.match(developerOutput, /TypeError: Monday normalization failed/);

  for (const secret of [geminiApiKey, bearerToken, cookieValue]) {
    assert.equal(developerOutput.includes(secret), false);
  }

  assert.match(developerOutput, /Authorization=\[REDACTED\]/);
  assert.match(developerOutput, /Cookie=\[REDACTED\]/);
  assert.equal(
    isDeveloperDiagnosticsEnabled({
      CHECKQUEST_DEBUG: '1'
    }),
    true
  );
  assert.equal(isDeveloperDiagnosticsEnabled({}), false);
  assert.equal(
    isDeveloperDiagnosticsEnabled({
      CHECKQUEST_DEBUG: 'true'
    }),
    false
  );

  const embeddedApiKey = 'EMBEDDED_API_KEY_SENTINEL';
  const embeddedBearerToken = 'EMBEDDED_BEARER_SENTINEL';
  const invalidModelResponse = JSON.stringify({
    findings: [
      {
        severity: 'critical',
        title: 42,
        apiKey: embeddedApiKey,
        authorization: `Bearer ${embeddedBearerToken}`
      }
    ],
    summary: `Summary ${geminiApiKey}`,
    padding: 'x'.repeat(10_000)
  });
  const modelResponseSchema = z.object({
    findings: z.array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string()
      })
    ),
    summary: z.string()
  });
  let schemaError: unknown;

  try {
    parseModelJsonResponse(
      invalidModelResponse,
      'exploratory-qa-analysis-response',
      modelResponseSchema
    );
  } catch (error: unknown) {
    schemaError = error;
  }

  assert.ok(schemaError instanceof CheckQuestError);
  assert.equal(schemaError.code, 'MODEL_RESPONSE');
  assert.equal(
    formatPublicError(schemaError),
    '[MODEL_RESPONSE] Gemini returned JSON that did not match the required response schema. Operation: exploratory-qa-analysis-response. (phase=exploratory-qa-analysis-response)'
  );

  const publicSchemaError = formatPublicError(schemaError);

  for (const privateValue of [
    'findings[0].severity',
    'invalid_value',
    'critical',
    geminiApiKey,
    embeddedApiKey,
    embeddedBearerToken
  ]) {
    assert.equal(publicSchemaError.includes(privateValue), false);
  }

  const schemaDiagnostic = formatDeveloperErrorDiagnostic(schemaError, {
    secrets: [geminiApiKey]
  });

  assert.match(schemaDiagnostic, /ModelResponseSchemaDiagnosticError/);
  assert.match(schemaDiagnostic, /findings\[0\]\.severity/);
  assert.match(schemaDiagnostic, /"code":"invalid_value"/);
  assert.match(schemaDiagnostic, /findings\[0\]\.title/);
  assert.match(schemaDiagnostic, /"code":"invalid_type"/);
  assert.match(schemaDiagnostic, /"expected":"string"/);
  assert.match(schemaDiagnostic, /"responseLength":\d+/);
  assert.match(schemaDiagnostic, /critical/);
  assert.match(schemaDiagnostic, /characters omitted/);
  assert.ok(schemaDiagnostic.length <= maximumDeveloperDiagnosticLength);

  for (const secret of [geminiApiKey, embeddedApiKey, embeddedBearerToken]) {
    assert.equal(schemaDiagnostic.includes(secret), false);
  }

  assert.deepEqual(
    parseModelJsonResponse(
      JSON.stringify({
        findings: [
          {
            severity: 'low',
            title: 'Valid finding'
          }
        ],
        summary: 'Valid response'
      }),
      'exploratory-qa-analysis-response',
      modelResponseSchema
    ),
    {
      findings: [
        {
          severity: 'low',
          title: 'Valid finding'
        }
      ],
      summary: 'Valid response'
    }
  );

  const diagnosticRoot = await mkdtemp(join(tmpdir(), 'checkquest-developer-diagnostic-'));

  try {
    const debugOffPath = await persistDeveloperErrorDiagnostic(schemaError, {
      enabled: false,
      runId: 'debug-off-run',
      outputRootDirectoryPath: diagnosticRoot,
      secrets: [geminiApiKey]
    });

    assert.equal(debugOffPath, null);
    await assert.rejects(access(join(diagnosticRoot, 'debug-off-run', 'developer-diagnostic.txt')));

    const debugPath = await persistDeveloperErrorDiagnostic(schemaError, {
      enabled: true,
      runId: 'debug-on-run',
      outputRootDirectoryPath: diagnosticRoot,
      secrets: [geminiApiKey]
    });

    assert.equal(debugPath, join(diagnosticRoot, 'debug-on-run', 'developer-diagnostic.txt'));

    const persistedDiagnostic = await readFile(debugPath, 'utf8');

    assert.match(persistedDiagnostic, /findings\[0\]\.severity/);
    assert.match(persistedDiagnostic, /"code":"invalid_value"/);
    assert.ok(persistedDiagnostic.length <= maximumDeveloperDiagnosticLength + 1);

    for (const secret of [geminiApiKey, embeddedApiKey, embeddedBearerToken]) {
      assert.equal(persistedDiagnostic.includes(secret), false);
    }
  } finally {
    await rm(diagnosticRoot, {
      recursive: true,
      force: true
    });
  }

  const arbitraryCause = {
    apiKey: geminiApiKey,
    requestBody: {
      private: true
    }
  };
  const arbitraryError = sanitizeApplicationError(arbitraryCause, 'non-error-run', geminiApiKey);
  const arbitraryDiagnostic = formatDeveloperErrorDiagnostic(arbitraryError, {
    secrets: [geminiApiKey]
  });

  assert.match(arbitraryDiagnostic, /<non-Error object cause omitted>/);
  assert.equal(arbitraryDiagnostic.includes('requestBody'), false);

  const contextualError = new CheckQuestError('INTERNAL', 'Context redaction check.', {
    phase: `phase-${geminiApiKey}`,
    runId: `run-${geminiApiKey}`,
    candidateReference: `candidate-${geminiApiKey}`
  });
  contextualError.name = `Error-${geminiApiKey}`;
  const contextualDiagnostic = formatDeveloperErrorDiagnostic(contextualError, {
    secrets: [geminiApiKey]
  });

  assert.equal(contextualDiagnostic.includes(geminiApiKey), false);
  assert.match(contextualDiagnostic, /phase-\[REDACTED\]/);

  const existingCause = new Error('Existing private cause.');
  const existing = new CheckQuestError('MODEL', `Safe model failure ${geminiApiKey}`, {
    phase: 'model-call',
    runId: 'existing-error',
    cause: existingCause
  });
  const copiedExisting = sanitizeApplicationError(existing, 'unused-run', geminiApiKey);

  assert.equal(copiedExisting.code, 'MODEL');
  assert.equal(copiedExisting.message, 'Safe model failure [REDACTED]');
  assert.equal(
    copiedExisting.cause,
    undefined,
    'Existing CheckQuestError boundary-copy behavior remains unchanged.'
  );

  const cleanupFailure = new Error('Cleanup detail.');

  await completeRequiredCleanup(
    underlying,
    [
      () => {
        throw cleanupFailure;
      }
    ],
    {
      phase: 'diagnostic-cleanup',
      runId: 'diagnostic-run'
    }
  );

  const withCleanup = sanitizeApplicationError(underlying, 'diagnostic-run', geminiApiKey);

  assert.equal(withCleanup.cause, underlying);
  assert.equal(getSecondaryCleanupError(withCleanup)?.code, 'CLEANUP');

  console.log('Application INTERNAL error observability and developer-diagnostic checks passed.');
}

void main().catch((error: unknown) => {
  console.error('Application error diagnostic check failed.', error);
  process.exitCode = 1;
});
