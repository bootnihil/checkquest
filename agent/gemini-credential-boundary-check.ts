import assert from 'node:assert/strict';

import {
  requireGeminiApiKey
} from './ai/resolve-gemini-api-key';
import {
  analyzePageForQa
} from './analysis/analyze-page-for-qa';
import {
  resolveRunSiteCredentials
} from './cli/resolve-run-site-credentials';
import {
  chooseNavigationLink
} from './decisions/choose-navigation-link';
import {
  CheckQuestError,
  formatPublicError
} from './errors/checkquest-error';
import {
  createPageNoveltyState
} from './exploration/page-novelty';
import {
  buildNavigationPolicyWindow,
  createNavigationBudgetContext,
  createNavigationFrontier,
  registerDiscoveredNavigationLinks
} from './exploration/navigation-policy';
import {
  createNavigationUrlState
} from './exploration/visited-links';
import {
  planNextAction
} from './planning/plan-next-action';
import {
  runSite
} from './run/run-site';
import type {
  RunEvent
} from './run/run-event';

function isCredentialError(
  error:
    unknown
): boolean {
  return (
    error instanceof
      CheckQuestError &&
    error.code ===
      'MODEL' &&
    error.phase ===
      'gemini-credential-resolution'
  );
}

async function main():
  Promise<void> {
  const cliKey =
    'CLI_GEMINI_KEY_SENTINEL';
  const environmentKey =
    'PROCESS_ENV_KEY_MUST_NOT_BE_USED';
  const runAKey =
    'PER_RUN_KEY_A';
  const runBKey =
    'PER_RUN_KEY_B';

  assert.deepEqual(
    resolveRunSiteCredentials({
      GEMINI_API_KEY:
        cliKey,
      GOOGLE_API_KEY:
        'UNRELATED_GOOGLE_KEY'
    }),
    {
      geminiApiKey:
        cliKey
    }
  );

  assert.throws(
    () =>
      resolveRunSiteCredentials({
        GOOGLE_API_KEY:
          'UNRELATED_GOOGLE_KEY'
      }),
    isCredentialError
  );

  assert.equal(
    requireGeminiApiKey(
      runAKey
    ),
    runAKey
  );
  assert.equal(
    requireGeminiApiKey(
      runBKey
    ),
    runBKey
  );

  for (
    const invalidCredential of
      [
        undefined,
        '',
        '   '
      ]
  ) {
    assert.throws(
      () =>
        requireGeminiApiKey(
          invalidCredential
        ),
      isCredentialError
    );
  }

  const originalGeminiApiKey =
    process.env
      .GEMINI_API_KEY;

  process.env
    .GEMINI_API_KEY =
      environmentKey;

  try {
    await assert.rejects(
      analyzePageForQa({
        observation: {
          requestedUrl:
            'https://example.test/',
          finalUrl:
            'https://example.test/',
          title:
            'Credential boundary',
          httpStatus:
            200,
          headings:
            []
        },
        content: {
          title:
            'Credential boundary',
          headings:
            [],
          bodyText:
            '',
          links:
            [],
          buttons:
            [],
          textFields:
            [],
          selects:
            [],
          disclosures:
            [],
          tabs:
            []
        },
        classifiedDiagnostics: {
          consoleErrors:
            [],
          failedRequests:
            []
        },
        ruleBasedFindings:
          []
      }),
      isCredentialError
    );

    await assert.rejects(
      planNextAction({
        pageUrl:
          'https://example.test/',
        pageContent: {
          title:
            'Credential boundary',
          headings:
            [],
          bodyText:
            '',
          links:
            [],
          buttons:
            [],
          textFields:
            [],
          selects:
            [],
          disclosures:
            [],
          tabs:
            []
        },
        history:
          [],
        currentStep:
          1,
        maxSteps:
          1,
        investigableCandidates:
          []
      }),
      isCredentialError
    );

    const frontier =
      createNavigationFrontier();
    registerDiscoveredNavigationLinks(
      frontier,
      [
        {
          text:
            'Next',
          url:
            'https://example.test/next'
        }
      ],
      'https://example.test/',
      0
    );
    const budget =
      createNavigationBudgetContext(
        2,
        1,
        1,
        0
      );
    const policyWindow =
      buildNavigationPolicyWindow({
        frontier,
        urlState:
          createNavigationUrlState(),
        pageNoveltyState:
          createPageNoveltyState(),
        budget
      });

    await assert.rejects(
      chooseNavigationLink(
        {
          id:
            'credential-boundary',
          name:
            'Credential boundary',
          startUrl:
            'https://example.test/',
          allowedHosts: [
            'example.test'
          ],
          maxPages:
            2,
          maxAgentSteps:
            1,
          maxExploratoryStepsPerPage:
            0,
          allowFormSubmission:
            false
        },
        policyWindow.candidates,
        budget
      ),
      isCredentialError
    );

    const events:
      RunEvent[] =
        [];
    let missingCredentialError:
      unknown;

    try {
      await runSite({
        site: {
          id:
            'credential-preflight',
          name:
            'Credential preflight',
          startUrl:
            'http://127.0.0.1:1/',
          allowedHosts: [
            '127.0.0.1'
          ],
          maxPages:
            1,
          maxAgentSteps:
            0,
          maxExploratoryStepsPerPage:
            0,
          allowFormSubmission:
            false
        },
        runId:
          'credential-preflight',
        onEvent:
          event => {
            events.push(
              event
            );
          }
      });
    } catch (
      error:
        unknown
    ) {
      missingCredentialError =
        error;
    }

    assert.ok(
      isCredentialError(
        missingCredentialError
      )
    );

    await assert.rejects(
      runSite({
        site: {
          id:
            'blank-credential-preflight',
          name:
            'Blank credential preflight',
          startUrl:
            'http://127.0.0.1:1/',
          allowedHosts: [
            '127.0.0.1'
          ],
          maxPages:
            1,
          maxAgentSteps:
            0,
          maxExploratoryStepsPerPage:
            0,
          allowFormSubmission:
            false
        },
        credentials: {
          geminiApiKey:
            '   '
        },
        runId:
          'blank-credential-preflight'
      }),
      isCredentialError
    );

    const serializedPublicOutput =
      JSON.stringify({
        events,
        publicError:
          formatPublicError(
            missingCredentialError
          )
      });

    for (
      const credentialSentinel of
        [
          cliKey,
          environmentKey,
          runAKey,
          runBKey
        ]
    ) {
      assert.equal(
        serializedPublicOutput
          .includes(
            credentialSentinel
          ),
        false
      );
    }

    assert.equal(
      process.env
        .GEMINI_API_KEY,
      environmentKey
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
    'Stage 9B per-run Gemini credential boundary checks passed.'
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Stage 9B Gemini credential boundary check failed.',
      error
    );
    process.exitCode =
      1;
  }
);
