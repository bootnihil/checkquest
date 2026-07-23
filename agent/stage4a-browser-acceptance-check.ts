import assert from 'node:assert/strict';
import {
  createServer,
  type Server
} from 'node:http';

import {
  chromium
} from '@playwright/test';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import {
  preparePageForGuardedInteractions
} from './browser/execute-guarded-disclosure-action';
import {
  extractPageContent,
  type PageDisclosureControl
} from './browser/extract-page-content';
import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences,
  type PageCandidate
} from './investigation/page-candidates';
import {
  runExploratoryLoop,
  type ExploratoryLoopResult
} from './planning/run-exploratory-loop';
import type {
  PlannerDecision
} from './planning/planner-decision-schema';

const fixtureHtml = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Stage 4A Browser Acceptance Fixture</title>
      <link rel="icon" href="data:,">
    </head>
    <body>
      <h1>Stage 4A Browser Acceptance Fixture</h1>

      <button
        id="acceptance-disclosure"
        type="button"
        aria-expanded="false"
        aria-controls="acceptance-content"
      >
        What does this acceptance check prove?
      </button>

      <div
        id="acceptance-content"
        hidden
      >
        It proves that a guarded informational disclosure can transition
        safely and return to its original state.
      </div>

      <script>
        const control =
          document.getElementById(
            'acceptance-disclosure'
          );
        const region =
          document.getElementById(
            'acceptance-content'
          );

        control.addEventListener(
          'click',
          () => {
            const willExpand =
              control.getAttribute(
                'aria-expanded'
              ) !== 'true';

            control.setAttribute(
              'aria-expanded',
              String(willExpand)
            );
            region.hidden =
              !willExpand;
          }
        );
      </script>
    </body>
  </html>
`;

interface FixtureServer {
  server: Server;
  url: string;
  getRequestCount: () => number;
}

interface SelectedDisclosure {
  control:
    PageDisclosureControl & {
      controlId: string;
      accessibleName: string;
      ariaExpanded:
        'true' | 'false';
      ariaControls: string;
      controlledRegionVisible:
        boolean;
    };

  desiredState:
    'expanded' | 'collapsed';
}

async function startFixtureServer():
  Promise<FixtureServer> {
  let requestCount =
    0;

  const server =
    createServer(
      (
        request,
        response
      ) => {
        requestCount +=
          1;

        if (
          request.method !==
            'GET' ||
          request.url !==
            '/'
        ) {
          response.writeHead(
            404,
            {
              'content-type':
                'text/plain; charset=utf-8'
            }
          );
          response.end(
            'Not found'
          );
          return;
        }

        response.writeHead(
          200,
          {
            'cache-control':
              'no-store',
            'content-type':
              'text/html; charset=utf-8'
          }
        );
        response.end(
          fixtureHtml
        );
      }
    );

  await new Promise<void>(
    (
      resolve,
      reject
    ) => {
      const handleError =
        (
          error: Error
        ): void => {
          server.off(
            'listening',
            handleListening
          );
          reject(error);
        };

      const handleListening =
        (): void => {
          server.off(
            'error',
            handleError
          );
          resolve();
        };

      server.once(
        'error',
        handleError
      );
      server.once(
        'listening',
        handleListening
      );
      server.listen(
        0,
        '127.0.0.1'
      );
    }
  );

  const address =
    server.address();

  if (
    address === null ||
    typeof address ===
      'string'
  ) {
    await closeFixtureServer(
      server
    );

    throw new Error(
      'The local acceptance fixture did not receive an ephemeral TCP port.'
    );
  }

  return {
    server,
    url:
      `http://127.0.0.1:${address.port}/`,
    getRequestCount:
      () =>
        requestCount
  };
}

async function closeFixtureServer(
  server: Server
): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>(
    (
      resolve,
      reject
    ) => {
      server.close(
        error => {
          if (
            error !==
            undefined
          ) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    }
  );
}

function selectEligibleDisclosure(
  disclosures:
    PageDisclosureControl[]
): SelectedDisclosure {
  const control =
    disclosures.find(
      candidate =>
        candidate
          .eligibleForDisclosureAction &&
        candidate.controlId !==
          null &&
        candidate.accessibleName !==
          null &&
        candidate.ariaExpanded !==
          null &&
        candidate.ariaControls !==
          null &&
        candidate
          .controlledRegionVisible !==
          null
    );

  if (
    control === undefined ||
    control.controlId === null ||
    control.accessibleName ===
      null ||
    control.ariaExpanded ===
      null ||
    control.ariaControls ===
      null ||
    control
      .controlledRegionVisible ===
      null
  ) {
    throw new Error(
      [
        'The owned Stage 4A browser fixture did not produce an eligible disclosure.',
        `Extracted disclosure candidates: ${JSON.stringify(
          disclosures.map(
            candidate => ({
              controlId:
                candidate.controlId,
              accessibleName:
                candidate
                  .accessibleName,
              controlledRegionId:
                candidate
                  .ariaControls,
              currentExpandedState:
                candidate
                  .ariaExpanded,
              eligible:
                candidate
                  .eligibleForDisclosureAction,
              rejectionReasons:
                candidate
                  .eligibilityRejectionReasons
            })
          )
        )}`
      ].join(' ')
    );
  }

  return {
    control: {
      ...control,
      controlId:
        control.controlId,
      accessibleName:
        control.accessibleName,
      ariaExpanded:
        control.ariaExpanded,
      ariaControls:
        control.ariaControls,
      controlledRegionVisible:
        control
          .controlledRegionVisible
    },

    desiredState:
      control.ariaExpanded ===
        'true'
        ? 'collapsed'
        : 'expanded'
  };
}

function createCandidate(
  selected:
    SelectedDisclosure
): PageCandidate {
  const finding:
    ExploratoryQaFinding = {
    category:
      'interaction',
    severity:
      'low',
    confidence:
      'medium',
    title:
      `Guarded disclosure transition: ${selected.control.accessibleName}`,
    evidence:
      `Production extraction identified eligible disclosure "${selected.control.accessibleName}" controlling "${selected.control.ariaControls}".`,
    reasoning:
      'A reversible disclosure-state transition can provide deterministic browser acceptance evidence.',
    suggestedCheck:
      `Set the disclosure to ${selected.desiredState} and verify restoration.`,
    evidenceTarget: {
      kind:
        'disclosure-state',
      controlId:
        selected.control
          .controlId,
      accessibleName:
        selected.control
          .accessibleName,
      controlledRegionId:
        selected.control
          .ariaControls,
      desiredState:
        selected.desiredState
    }
  };

  return assignPageCandidateReferences(
    [
      finding
    ]
  )[0];
}

function createDecision(
  candidate:
    PageCandidate
): PlannerDecision {
  const target =
    candidate.finding
      .evidenceTarget;

  if (
    target === null ||
    target.kind !==
      'disclosure-state'
  ) {
    throw new Error(
      'Acceptance candidate does not have a disclosure-state target.'
    );
  }

  return {
    candidateReference:
      candidate.reference,
    hypothesis:
      'The informational disclosure should reach the requested state without producing a safety event.',
    reasoning:
      'The action exactly matches the candidate identity extracted from the browser fixture.',
    action: {
      kind:
        'set-disclosure-state',
      target: {
        controlId:
          target.controlId,
        accessibleName:
          target.accessibleName,
        controlledRegionId:
          target
            .controlledRegionId
      },
      desiredState:
        target.desiredState
    },
    expectedObservation:
      'The requested ARIA and controlled-region transition should be observed, followed by verified rollback.'
  };
}

async function runProductionInvestigation(
  pageUrl: string,
  page:
    Parameters<
      typeof runExploratoryLoop
    >[0],
  candidate:
    PageCandidate
): Promise<ExploratoryLoopResult> {
  let plannerCalls =
    0;

  const result =
    await runExploratoryLoop(
      page,
      pageUrl,
      1,
      [
        candidate
      ],
      {
        plan:
          async input => {
            plannerCalls +=
              1;

            assert.equal(
              input
                .investigableCandidates
                .length,
              1,
              'The exact acceptance candidate was not supplied to the deterministic planner.'
            );
            assert.equal(
              input
                .investigableCandidates[0]
                ?.reference,
              candidate.reference,
              'Candidate identity changed before planner execution.'
            );

            return createDecision(
              candidate
            );
          }
      }
    );

  assert.equal(
    plannerCalls,
    1,
    'The deterministic planner should run exactly once.'
  );

  return result;
}

function assertSuccessfulTransaction(
  investigation:
    ExploratoryLoopResult,
  selected:
    SelectedDisclosure,
  candidate:
    PageCandidate
): void {
  assert.equal(
    investigation.steps.length,
    1
  );

  const step =
    investigation.steps[0];

  assert.equal(
    step.decision
      .candidateReference,
    candidate.reference,
    'Candidate identity mismatch reached the execution result.'
  );
  assert.equal(
    step.decision.action.kind,
    'set-disclosure-state'
  );
  assert.equal(
    step.executionResult.status,
    'executed',
    `Guarded disclosure execution did not succeed: ${step.executionResult.detail}`
  );

  if (
    step.executionResult.status !==
      'executed'
  ) {
    throw new Error(
      step.executionResult.detail
    );
  }

  assert.equal(
    investigation.stopReason,
    'max-planner-decisions-reached'
  );
  assert.equal(
    investigation
      .executedInvestigationActionCount,
    1
  );
  assert.equal(
    step.executionResult.kind,
    'set-disclosure-state'
  );
  assert.deepEqual(
    step.executionResult
      .safetyEvents ??
      [],
    [],
    'The browser transaction recorded a prohibited safety event.'
  );
  assert.equal(
    step.executionResult
      .hardBreach ??
      false,
    false,
    'The browser transaction recorded a hard safety breach.'
  );

  const evidence =
    step.executionResult
      .disclosureEvidence;

  assert.ok(
    evidence,
    'The guarded executor did not return deterministic disclosure evidence.'
  );
  assert.equal(
    evidence.before.expanded,
    selected.control
      .ariaExpanded ===
      'true'
  );
  assert.equal(
    evidence.before
      .controlledRegionVisible,
    selected.control
      .controlledRegionVisible
  );
  assert.equal(
    evidence.desiredState,
    selected.desiredState
  );
  assert.equal(
    evidence
      .stateTransitionObserved,
    true,
    'The requested aria-expanded transition was not observed.'
  );
  assert.equal(
    evidence
      .controlledRegionChangedConsistently,
    true,
    'Controlled-region visibility did not change consistently.'
  );
  assert.equal(
    evidence.rollbackAttempted,
    true,
    'Mandatory rollback was not attempted.'
  );
  assert.equal(
    evidence.rollbackSucceeded,
    true,
    'Mandatory rollback did not restore the original state.'
  );
  assert.equal(
    evidence.after?.expanded,
    selected.desiredState ===
      'expanded'
  );
  assert.equal(
    evidence.after
      ?.controlledRegionVisible,
    selected.desiredState ===
      'expanded'
  );
  assert.deepEqual(
    evidence.rollback,
    evidence.before,
    'Rollback evidence differs from the original disclosure state.'
  );
}

async function main():
  Promise<void> {
  const fixture =
    await startFixtureServer();

  let browser:
    Awaited<
      ReturnType<
        typeof chromium.launch
      >
    > |
    null =
      null;

  try {
    browser =
      await chromium.launch({
        headless: true
      });

    const context =
      await browser.newContext({
        acceptDownloads:
          true,
        serviceWorkers:
          'block'
      });

    try {
      const page =
        await context.newPage();

      await preparePageForGuardedInteractions(
        page
      );

      const response =
        await page.goto(
          fixture.url,
          {
            waitUntil:
              'domcontentloaded',
            timeout:
              30_000
          }
        );

      assert.equal(
        response?.status(),
        200,
        'The local acceptance fixture did not return HTTP 200.'
      );

      const initialContent =
        await extractPageContent(
          page
        );

      const selected =
        selectEligibleDisclosure(
          initialContent
            .disclosures
        );

      assert.equal(
        initialContent
          .disclosures
          .filter(
            disclosure =>
              disclosure
                .eligibleForDisclosureAction
          )
          .length,
        1,
        'The fixture should expose exactly one eligible disclosure.'
      );

      const candidate =
        createCandidate(
          selected
        );

      const requestsAfterLoad =
        fixture.getRequestCount();

      const investigation =
        await runProductionInvestigation(
          page.url(),
          page,
          candidate
        );

      assertSuccessfulTransaction(
        investigation,
        selected,
        candidate
      );

      const restoredContent =
        await extractPageContent(
          page
        );

      const restoredControl =
        restoredContent
          .disclosures
          .find(
            disclosure =>
              disclosure.controlId ===
                selected.control
                  .controlId &&
              disclosure
                .accessibleName ===
                selected.control
                  .accessibleName &&
              disclosure
                .ariaControls ===
                selected.control
                  .ariaControls
          );

      assert.ok(
        restoredControl,
        'The exact disclosure identity was not present after rollback.'
      );
      assert.equal(
        restoredControl
          .ariaExpanded,
        selected.control
          .ariaExpanded,
        'The browser DOM aria-expanded value was not restored.'
      );
      assert.equal(
        restoredControl
          .controlledRegionVisible,
        selected.control
          .controlledRegionVisible,
        'The controlled-region visibility was not restored.'
      );

      const outcome =
        evaluateFindingInvestigationOutcome(
          candidate,
          investigation
        );

      assert.equal(
        outcome.status,
        'verified',
        `The deterministic finding outcome was ${outcome.status}: ${outcome.summary}`
      );

      const followUpInvestigation =
        await runProductionInvestigation(
          page.url(),
          page,
          candidate
        );

      assertSuccessfulTransaction(
        followUpInvestigation,
        selected,
        candidate
      );

      assert.equal(
        fixture.getRequestCount(),
        requestsAfterLoad,
        'A disclosure interaction triggered unexpected fixture-server traffic.'
      );

      console.log(
        '\nStage 4A real-browser acceptance passed.'
      );
      console.log(
        JSON.stringify(
          {
            fixtureUrl:
              fixture.url,
            fixtureRequestCount:
              fixture
                .getRequestCount(),
            selectedDisclosure: {
              controlId:
                selected.control
                  .controlId,
              accessibleName:
                selected.control
                  .accessibleName,
              controlledRegionId:
                selected.control
                  .ariaControls,
              originalExpanded:
                selected.control
                  .ariaExpanded,
              originalRegionVisible:
                selected.control
                  .controlledRegionVisible,
              desiredState:
                selected.desiredState
            },
            firstTransaction:
              investigation
                .steps[0]
                .executionResult
                .status ===
                'executed'
                ? {
                    status:
                      investigation
                        .steps[0]
                        .executionResult
                        .status,
                    safetyEvents:
                      investigation
                        .steps[0]
                        .executionResult
                        .safetyEvents ??
                      [],
                    evidence:
                      investigation
                        .steps[0]
                        .executionResult
                        .disclosureEvidence
                  }
                : null,
            restoredState: {
              expanded:
                restoredControl
                  .ariaExpanded,
              regionVisible:
                restoredControl
                  .controlledRegionVisible
            },
            secondTransactionStatus:
              followUpInvestigation
                .steps[0]
                .executionResult
                .status,
            findingOutcome:
              outcome
          },
          null,
          2
        )
      );
    } finally {
      await context.close();
    }
  } finally {
    if (browser !== null) {
      await browser.close();
    }

    await closeFixtureServer(
      fixture.server
    );
  }
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Stage 4A real-browser acceptance failed.'
    );
    console.error(
      error
    );
    process.exitCode =
      1;
  }
);
