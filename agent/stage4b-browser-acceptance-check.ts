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
  type PageTabControl
} from './browser/extract-page-content';
import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences,
  type PageCandidate
} from './investigation/page-candidates';
import {
  runExploratoryLoop
} from './planning/run-exploratory-loop';
import type {
  PlannerDecision
} from './planning/planner-decision-schema';

const fixtureHtml = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>Stage 4B Browser Acceptance</title>
      <link
        rel="icon"
        href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"
      >
    </head>
    <body>
      <h1>Guarded tab acceptance fixture</h1>
      <div
        id="acceptance-tabs"
        role="tablist"
        aria-label="Acceptance topics"
      >
        <button
          id="summary-tab"
          type="button"
          role="tab"
          aria-selected="true"
          aria-controls="summary-panel"
        >
          Summary
        </button>
        <button
          id="evidence-tab"
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="evidence-panel"
        >
          Safety evidence
        </button>
      </div>
      <section
        id="summary-panel"
        role="tabpanel"
      >
        The initial tab is selected.
      </section>
      <section
        id="evidence-panel"
        role="tabpanel"
        hidden
      >
        The guarded transaction reveals this informational panel.
      </section>
      <script>
        const tabs =
          Array.from(
            document.querySelectorAll(
              '[role="tab"]'
            )
          );

        for (const tab of tabs) {
          tab.addEventListener(
            'click',
            () => {
              for (
                const candidate of
                  tabs
              ) {
                const selected =
                  candidate === tab;
                candidate.setAttribute(
                  'aria-selected',
                  String(selected)
                );
                const panel =
                  document.getElementById(
                    candidate.getAttribute(
                      'aria-controls'
                    )
                  );
                panel.hidden =
                  !selected;
              }
            }
          );
        }
      </script>
    </body>
  </html>
`;

interface FixtureServer {
  server: Server;
  url: string;
  getRequestCount: () => number;
}

async function startFixtureServer():
  Promise<FixtureServer> {
  let requestCount = 0;
  const server =
    createServer(
      (
        request,
        response
      ) => {
        requestCount += 1;

        if (
          request.method === 'GET' &&
          request.url === '/'
        ) {
          response.writeHead(
            200,
            {
              'content-type':
                'text/html; charset=utf-8',
              'cache-control':
                'no-store'
            }
          );
          response.end(
            fixtureHtml
          );
          return;
        }

        response.writeHead(404);
        response.end(
          'Not found'
        );
      }
    );

  await new Promise<void>(
    (
      resolve,
      reject
    ) => {
      server.once(
        'error',
        reject
      );
      server.listen(
        0,
        '127.0.0.1',
        () => {
          server.off(
            'error',
            reject
          );
          resolve();
        }
      );
    }
  );

  const address =
    server.address();

  if (
    address === null ||
    typeof address === 'string'
  ) {
    throw new Error(
      'The Stage 4B fixture server did not expose an ephemeral TCP port.'
    );
  }

  return {
    server,
    url:
      `http://127.0.0.1:${address.port}/`,
    getRequestCount: () =>
      requestCount
  };
}

async function closeFixtureServer(
  server: Server
): Promise<void> {
  await new Promise<void>(
    (
      resolve,
      reject
    ) => {
      server.close(error => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    }
  );
}

function selectEligibleInactiveTab(
  tabs:
    PageTabControl[]
): PageTabControl {
  const selected =
    tabs.find(
      tab =>
        tab
          .eligibleForTabAction &&
        tab.ariaSelected ===
          'false'
    );

  if (
    selected === undefined ||
    selected.controlId === null ||
    selected.accessibleName ===
      null ||
    selected.tabListId === null ||
    selected.ariaControls ===
      null
  ) {
    throw new Error(
      `The owned Stage 4B browser fixture did not produce an eligible inactive tab. Extracted tabs: ${JSON.stringify(
        tabs.map(tab => ({
          controlId:
            tab.controlId,
          accessibleName:
            tab.accessibleName,
          tabListId:
            tab.tabListId,
          controlledPanelId:
            tab.ariaControls,
          ariaSelected:
            tab.ariaSelected,
          eligible:
            tab
              .eligibleForTabAction,
          rejectionReasons:
            tab
              .eligibilityRejectionReasons
        })),
        null,
        2
      )}`
    );
  }

  return selected;
}

function createCandidate(
  selected:
    PageTabControl
): PageCandidate {
  const finding:
    ExploratoryQaFinding = {
    category: 'interaction',
    severity: 'low',
    confidence: 'high',
    title:
      `Guarded tab transition: ${selected.accessibleName}`,
    evidence:
      `Production extraction identified eligible tab "${selected.accessibleName}" controlling "${selected.ariaControls}" in tablist "${selected.tabListId}".`,
    reasoning:
      'A reversible selected-tab transition can provide deterministic browser acceptance evidence.',
    suggestedCheck:
      'Select the exact tab, verify its panel, and restore the original tab.',
    evidenceTarget: {
      kind: 'tab-state',
      controlId:
        selected.controlId!,
      accessibleName:
        selected
          .accessibleName!,
      tabListId:
        selected.tabListId!,
      controlledPanelId:
        selected.ariaControls!,
      desiredState: 'selected'
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

  assert.ok(
    target !== null &&
    target.kind ===
      'tab-state'
  );

  return {
    candidateReference:
      candidate.reference,
    hypothesis:
      'The exact inactive tab should become selected and reveal only its corresponding informational panel.',
    reasoning:
      'The deterministic action exactly matches the production-extracted candidate identity.',
    action: {
      kind: 'select-tab',
      target: {
        controlId:
          target.controlId,
        accessibleName:
          target.accessibleName,
        tabListId:
          target.tabListId,
        controlledPanelId:
          target
            .controlledPanelId
      },
      desiredState:
        target.desiredState
    },
    expectedObservation:
      'The target aria-selected and panel visibility should transition, then mandatory rollback should restore the original tab and panels.'
  };
}

async function runTransaction(
  page:
    Parameters<
      typeof runExploratoryLoop
    >[0],
  fixtureUrl: string,
  candidate:
    PageCandidate
) {
  return runExploratoryLoop(
    page,
    fixtureUrl,
    1,
    [
      candidate
    ],
    {
      plan: async () =>
        createDecision(
          candidate
        )
    }
  );
}

function assertSuccessfulTransaction(
  investigation:
    Awaited<
      ReturnType<
        typeof runExploratoryLoop
      >
    >
) {
  assert.equal(
    investigation.steps.length,
    1
  );
  assert.equal(
    investigation
      .executedInvestigationActionCount,
    1
  );
  const result =
    investigation.steps[0]
      .executionResult;

  assert.equal(
    result.status,
    'executed',
    result.detail
  );
  assert.deepEqual(
    result.safetyEvents,
    []
  );
  assert.equal(
    result.hardBreach,
    false
  );
  assert.ok(
    result.tabEvidence
  );
  assert.equal(
    result.tabEvidence
      .selectedTabTransitionObserved,
    true
  );
  assert.equal(
    result.tabEvidence
      .previousTabDeselected,
    true
  );
  assert.equal(
    result.tabEvidence
      .targetPanelChangedConsistently,
    true
  );
  assert.equal(
    result.tabEvidence
      .previousPanelChangedConsistently,
    true
  );
  assert.equal(
    result.tabEvidence
      .rollbackAttempted,
    true
  );
  assert.equal(
    result.tabEvidence
      .rollbackSucceeded,
    true
  );
  assert.deepEqual(
    result.tabEvidence
      .rollback,
    result.tabEvidence
      .before
  );

  return result.tabEvidence;
}

async function main():
  Promise<void> {
  const fixture =
    await startFixtureServer();
  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    const context =
      await browser.newContext({
        acceptDownloads: true,
        serviceWorkers: 'block'
      });
    const page =
      await context.newPage();

    try {
      await preparePageForGuardedInteractions(
        page
      );
      const response =
        await page.goto(
          fixture.url,
          {
            waitUntil:
              'load'
          }
        );

      assert.equal(
        response?.status(),
        200
      );

      const extracted =
        await extractPageContent(
          page
        );
      const selected =
        selectEligibleInactiveTab(
          extracted.tabs
        );
      const candidate =
        createCandidate(
          selected
        );
      const requestCountBefore =
        fixture
          .getRequestCount();
      const first =
        await runTransaction(
          page,
          fixture.url,
          candidate
        );
      const firstEvidence =
        assertSuccessfulTransaction(
          first
        );
      const restored =
        await extractPageContent(
          page
        );
      const restoredTarget =
        restored.tabs.find(
          tab =>
            tab.controlId ===
            selected.controlId
        );
      const restoredOriginal =
        restored.tabs.find(
          tab =>
            tab.controlId ===
            firstEvidence.before
              .selectedTab
              .controlId
        );

      assert.equal(
        restoredTarget
          ?.ariaSelected,
        'false'
      );
      assert.equal(
        restoredTarget
          ?.controlledPanelVisible,
        false
      );
      assert.equal(
        restoredOriginal
          ?.ariaSelected,
        'true'
      );
      assert.equal(
        restoredOriginal
          ?.controlledPanelVisible,
        true
      );

      const second =
        await runTransaction(
          page,
          fixture.url,
          candidate
        );
      assertSuccessfulTransaction(
        second
      );

      assert.equal(
        fixture
          .getRequestCount(),
        requestCountBefore,
        'A guarded tab interaction triggered unexpected fixture-server traffic.'
      );

      const outcome =
        evaluateFindingInvestigationOutcome(
          candidate,
          first
        );

      assert.equal(
        outcome.status,
        'verified'
      );

      console.log(
        'Stage 4B real-browser acceptance passed.'
      );
      console.log(
        JSON.stringify(
          {
            fixtureUrl:
              fixture.url,
            fixtureRequestCount:
              fixture
                .getRequestCount(),
            selectedTab: {
              controlId:
                selected.controlId,
              accessibleName:
                selected
                  .accessibleName,
              tabListId:
                selected.tabListId,
              controlledPanelId:
                selected
                  .ariaControls,
              originalSelected:
                selected
                  .ariaSelected,
              originalPanelVisible:
                selected
                  .controlledPanelVisible,
              desiredState:
                'selected'
            },
            firstTransaction: {
              status:
                first.steps[0]
                  .executionResult
                  .status,
              safetyEvents:
                'safetyEvents' in
                  first.steps[0]
                    .executionResult
                  ? first.steps[0]
                      .executionResult
                      .safetyEvents
                  : undefined,
              evidence:
                firstEvidence
            },
            restoredState: {
              originalTabId:
                restoredOriginal
                  ?.controlId,
              originalSelected:
                restoredOriginal
                  ?.ariaSelected,
              originalPanelVisible:
                restoredOriginal
                  ?.controlledPanelVisible,
              targetSelected:
                restoredTarget
                  ?.ariaSelected,
              targetPanelVisible:
                restoredTarget
                  ?.controlledPanelVisible
            },
            secondTransactionStatus:
              second.steps[0]
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
    await browser.close();
    await closeFixtureServer(
      fixture.server
    );
  }
}

main().catch(error => {
  console.error(
    'Stage 4B real-browser acceptance failed.'
  );
  console.error(error);
  process.exitCode = 1;
});
