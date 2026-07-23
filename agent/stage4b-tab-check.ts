import assert from 'node:assert/strict';

import {
  chromium,
  type Browser,
  type Page
} from '@playwright/test';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import {
  executeAgentAction
} from './browser/execute-agent-action';
import {
  preparePageForGuardedInteractions
} from './browser/execute-guarded-disclosure-action';
import {
  extractPageContent
} from './browser/extract-page-content';
import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';
import {
  runExploratoryLoop
} from './planning/run-exploratory-loop';
import type {
  PlannerDecision
} from './planning/planner-decision-schema';

const tabTarget = {
  controlId: 'details-tab',
  accessibleName: 'Details',
  tabListId: 'product-tabs',
  controlledPanelId:
    'details-panel'
};

function tabFinding(
  overrides: Partial<
    typeof tabTarget
  > = {}
): ExploratoryQaFinding {
  const target = {
    ...tabTarget,
    ...overrides
  };

  return {
    category: 'interaction',
    severity: 'low',
    confidence: 'medium',
    title:
      `Tab content for ${target.accessibleName}`,
    evidence:
      `Structured page evidence identifies tab "${target.accessibleName}".`,
    reasoning:
      'The candidate requires a reversible selected-tab check.',
    suggestedCheck:
      'Select the tab and verify its corresponding panel.',
    evidenceTarget: {
      kind: 'tab-state',
      ...target,
      desiredState: 'selected'
    }
  };
}

function tabDecision(
  candidateReference:
    string,
  overrides: Partial<
    typeof tabTarget
  > = {}
): PlannerDecision {
  return {
    candidateReference,
    hypothesis:
      'The exact tab should reveal its corresponding panel.',
    reasoning:
      'The action exactly matches the candidate tab-state target.',
    action: {
      kind: 'select-tab',
      target: {
        ...tabTarget,
        ...overrides
      },
      desiredState: 'selected'
    },
    expectedObservation:
      'The target tab and panel should transition, then the exact original tab should be restored.'
  };
}

function tabMarkup(
  options: {
    detailsAttributes?:
      string;
    detailsText?:
      string;
    detailsElement?:
      'button' | 'a';
    detailsPanelRole?:
      string;
    detailsPanelMarkup?:
      string;
    clickEffect?:
      string;
    preventTransition?:
      boolean;
    preventRollback?:
      boolean;
  } = {}
): string {
  const {
    detailsAttributes =
      'id="details-tab" type="button" role="tab" aria-selected="false" aria-controls="details-panel"',
    detailsText =
      'Details',
    detailsElement =
      'button',
    detailsPanelRole =
      'tabpanel',
    detailsPanelMarkup =
      'Deterministic details content.',
    clickEffect =
      '',
    preventTransition =
      false,
    preventRollback =
      false
  } = options;

  return `
    <!doctype html>
    <html>
      <head>
        <title>Stage 4B Tab Check</title>
      </head>
      <body>
        <div
          id="product-tabs"
          role="tablist"
          aria-label="Product information"
        >
          <button
            id="overview-tab"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="overview-panel"
          >
            Overview
          </button>
          <${detailsElement}
            ${detailsAttributes}
          >
            ${detailsText}
          </${detailsElement}>
        </div>

        <div
          id="overview-panel"
          role="tabpanel"
        >
          Overview content.
        </div>
        <div
          id="details-panel"
          role="${detailsPanelRole}"
          hidden
        >
          ${detailsPanelMarkup}
        </div>

        <script>
          const overviewTab =
            document.getElementById(
              'overview-tab'
            );
          const detailsTab =
            document.getElementById(
              'details-tab'
            );
          const overviewPanel =
            document.getElementById(
              'overview-panel'
            );
          const detailsPanel =
            document.getElementById(
              'details-panel'
            );

          if (detailsTab) {
            detailsTab.addEventListener(
              'click',
              () => {
                ${
                  preventTransition
                    ? ''
                    : `
                      overviewTab.setAttribute(
                        'aria-selected',
                        'false'
                      );
                      detailsTab.setAttribute(
                        'aria-selected',
                        'true'
                      );
                      overviewPanel.hidden =
                        true;
                      detailsPanel.hidden =
                        false;
                    `
                }
                ${clickEffect}
              }
            );
          }

          overviewTab.addEventListener(
            'click',
            () => {
              ${
                preventRollback
                  ? ''
                  : `
                    overviewTab.setAttribute(
                      'aria-selected',
                      'true'
                    );
                    detailsTab.setAttribute(
                      'aria-selected',
                      'false'
                    );
                    overviewPanel.hidden =
                      false;
                    detailsPanel.hidden =
                      true;
                  `
              }
            }
          );
        </script>
      </body>
    </html>
  `;
}

async function withPreparedPage(
  browser: Browser,
  markup: string,
  operation:
    (
      page: Page
    ) => Promise<void>
): Promise<void> {
  const context =
    await browser.newContext({
      acceptDownloads: true,
      serviceWorkers: 'block'
    });
  const page =
    await context.newPage();

  await preparePageForGuardedInteractions(
    page
  );
  await page.setContent(markup);

  try {
    await operation(page);
  } finally {
    await context.close();
  }
}

async function extractTargetTab(
  browser: Browser,
  markup: string
) {
  let extracted:
    Awaited<
      ReturnType<
        typeof extractPageContent
      >
    >['tabs'][number] |
    undefined;

  await withPreparedPage(
    browser,
    markup,
    async page => {
      extracted =
        (
          await extractPageContent(
            page
          )
        ).tabs.find(
          tab =>
            tab.controlId ===
            tabTarget.controlId ||
            tab.accessibleName ===
            tabTarget
              .accessibleName
        );
    }
  );

  return extracted;
}

async function assertIneligible(
  browser: Browser,
  name: string,
  markup: string,
  reasonPattern:
    RegExp
): Promise<void> {
  const extracted =
    await extractTargetTab(
      browser,
      markup
    );

  assert.ok(
    extracted,
    `${name}: target tab was not extracted`
  );
  assert.equal(
    extracted
      .eligibleForTabAction,
    false,
    name
  );
  assert.match(
    extracted
      .eligibilityRejectionReasons
      .join(' '),
    reasonPattern,
    name
  );

  console.log(
    `✓ INELIGIBLE: ${name}`
  );
}

async function expectUnsafe(
  browser: Browser,
  name: string,
  clickEffect: string,
  expectedKind:
    string,
  hardBreach:
    boolean
): Promise<void> {
  await withPreparedPage(
    browser,
    tabMarkup({
      clickEffect
    }),
    async page => {
      const result =
        await executeAgentAction(
          page,
          {
            kind: 'select-tab',
            target:
              tabTarget,
            desiredState:
              'selected'
          }
        );

      assert.equal(
        result.status,
        'unsafe',
        name
      );
      assert.equal(
        result.hardBreach,
        hardBreach,
        name
      );
      assert.ok(
        result.safetyEvents
          ?.some(
            event =>
              event.kind ===
              expectedKind
          ),
        `${name}: missing ${expectedKind} event`
      );
    }
  );

  console.log(
    `✓ SAFE ABORT: ${name}`
  );
}

async function main():
  Promise<void> {
  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    const eligible =
      await extractTargetTab(
        browser,
        tabMarkup()
      );

    assert.ok(eligible);
    assert.equal(
      eligible
        .eligibleForTabAction,
      true
    );
    assert.equal(
      eligible.tabListId,
      tabTarget.tabListId
    );
    assert.equal(
      eligible.ariaControls,
      tabTarget
        .controlledPanelId
    );
    console.log(
      '✓ eligible conventional tab extracted with exact tablist and panel identity'
    );

    await assertIneligible(
      browser,
      'missing stable control id',
      tabMarkup({
        detailsAttributes:
          'type="button" role="tab" aria-selected="false" aria-controls="details-panel"'
      }),
      /stable control id/i
    );
    await assertIneligible(
      browser,
      'missing accessible name',
      tabMarkup({
        detailsText: ''
      }),
      /accessible name/i
    );
    await assertIneligible(
      browser,
      'ambiguous duplicate accessible identity',
      tabMarkup({
        detailsText:
          'Overview'
      }),
      /ambiguous/i
    );
    await assertIneligible(
      browser,
      'missing explicit aria-selected',
      tabMarkup({
        detailsAttributes:
          'id="details-tab" type="button" role="tab" aria-controls="details-panel"'
      }),
      /aria-selected/i
    );
    await assertIneligible(
      browser,
      'missing aria-controls',
      tabMarkup({
        detailsAttributes:
          'id="details-tab" type="button" role="tab" aria-selected="false"'
      }),
      /aria-controls/i
    );
    await assertIneligible(
      browser,
      'multiple aria-controls values',
      tabMarkup({
        detailsAttributes:
          'id="details-tab" type="button" role="tab" aria-selected="false" aria-controls="details-panel other-panel"'
      }),
      /exactly one panel/i
    );
    await assertIneligible(
      browser,
      'invalid controlled panel role',
      tabMarkup({
        detailsPanelRole:
          'region'
      }),
      /role=tabpanel/i
    );
    await assertIneligible(
      browser,
      'navigation-like anchor tab',
      tabMarkup({
        detailsElement: 'a',
        detailsAttributes:
          'id="details-tab" href="#details-panel" role="tab" aria-selected="false" aria-controls="details-panel"'
      }),
      /link|href/i
    );
    await assertIneligible(
      browser,
      'interaction-heavy controlled panel',
      tabMarkup({
        detailsPanelMarkup:
          '<input aria-label="Unsafe editable field">'
      }),
      /editable|submission/i
    );

    let verifiedInvestigation:
      Awaited<
        ReturnType<
          typeof runExploratoryLoop
        >
      >;
    const candidate =
      assignPageCandidateReferences(
        [
          tabFinding()
        ]
      )[0];

    await withPreparedPage(
      browser,
      tabMarkup(),
      async page => {
        verifiedInvestigation =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              candidate
            ],
            {
              plan: async () =>
                tabDecision(
                  candidate.reference
                )
            }
          );

        const result =
          verifiedInvestigation
            .steps[0]
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
          result.tabEvidence
            ?.selectedTabTransitionObserved,
          true
        );
        assert.equal(
          result.tabEvidence
            ?.previousTabDeselected,
          true
        );
        assert.equal(
          result.tabEvidence
            ?.targetPanelChangedConsistently,
          true
        );
        assert.equal(
          result.tabEvidence
            ?.previousPanelChangedConsistently,
          true
        );
        assert.equal(
          result.tabEvidence
            ?.rollbackAttempted,
          true
        );
        assert.equal(
          result.tabEvidence
            ?.rollbackSucceeded,
          true
        );

        const restored =
          await extractPageContent(
            page
          );
        const overview =
          restored.tabs.find(
            tab =>
              tab.controlId ===
              'overview-tab'
          );
        const details =
          restored.tabs.find(
            tab =>
              tab.controlId ===
              'details-tab'
          );

        assert.equal(
          overview?.ariaSelected,
          'true'
        );
        assert.equal(
          overview
            ?.controlledPanelVisible,
          true
        );
        assert.equal(
          details?.ariaSelected,
          'false'
        );
        assert.equal(
          details
            ?.controlledPanelVisible,
          false
        );

        const second =
          await executeAgentAction(
            page,
            {
              kind:
                'select-tab',
              target:
                tabTarget,
              desiredState:
                'selected'
            }
          );

        assert.equal(
          second.status,
          'executed'
        );
        assert.equal(
          second.tabEvidence
            ?.rollbackSucceeded,
          true
        );
      }
    );

    assert.equal(
      evaluateFindingInvestigationOutcome(
        candidate,
        verifiedInvestigation!
      ).status,
      'verified'
    );
    console.log(
      '✓ exact candidate-linked tab transitioned, verified, rolled back, and remained enabled for a second safe transaction'
    );

    for (
      const mismatch of
        [
          {
            name:
              'mismatched tab id',
            overrides: {
              controlId:
                'overview-tab'
            }
          },
          {
            name:
              'mismatched accessible name',
            overrides: {
              accessibleName:
                'Overview'
            }
          },
          {
            name:
              'mismatched panel id',
            overrides: {
              controlledPanelId:
                'overview-panel'
            }
          },
          {
            name:
              'mismatched tablist id',
            overrides: {
              tabListId:
                'other-tabs'
            }
          }
        ]
    ) {
      await withPreparedPage(
        browser,
        tabMarkup(),
        async page => {
          const rejected =
            await runExploratoryLoop(
              page,
              page.url(),
              1,
              [
                candidate
              ],
              {
                plan: async () =>
                  tabDecision(
                    candidate.reference,
                    mismatch.overrides
                  )
              }
            );

          assert.equal(
            rejected.steps[0]
              .executionResult
              .status,
            'rejected',
            mismatch.name
          );
          assert.match(
            rejected.steps[0]
              .executionResult
              .detail,
            /does not match candidate/i,
            mismatch.name
          );
        }
      );
      console.log(
        `✓ relevance gate rejected ${mismatch.name}`
      );
    }

    let nonTransition:
      Awaited<
        ReturnType<
          typeof runExploratoryLoop
        >
      >;

    await withPreparedPage(
      browser,
      tabMarkup({
        preventTransition:
          true
      }),
      async page => {
        nonTransition =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              candidate
            ],
            {
              plan: async () =>
                tabDecision(
                  candidate.reference
                )
            }
          );

        assert.equal(
          nonTransition.steps[0]
            .executionResult.status,
          'executed'
        );
        assert.equal(
          nonTransition.steps[0]
            .executionResult
            .tabEvidence
            ?.selectedTabTransitionObserved,
          false
        );
      }
    );
    assert.equal(
      evaluateFindingInvestigationOutcome(
        candidate,
        nonTransition!
      ).status,
      'not-verified'
    );
    console.log(
      '✓ safe deterministic non-transition is NOT-VERIFIED'
    );

    await expectUnsafe(
      browser,
      'outbound GET is blocked',
      `
        fetch(
          'https://example.invalid/tab'
        ).catch(
          () => undefined
        );
      `,
      'network-request',
      false
    );
    await expectUnsafe(
      browser,
      'mutation-capable request is a hard breach',
      `
        fetch(
          '/mutation',
          {
            method: 'POST'
          }
        ).catch(
          () => undefined
        );
      `,
      'mutation-request',
      true
    );
    await expectUnsafe(
      browser,
      'form submission is blocked',
      `
        const form =
          document.createElement(
            'form'
          );
        document.body.appendChild(
          form
        );
        form.requestSubmit();
      `,
      'form-submission',
      true
    );
    await expectUnsafe(
      browser,
      'history navigation is blocked',
      `
        history.pushState(
          {},
          '',
          '#unsafe-tab'
        );
      `,
      'navigation',
      true
    );
    await expectUnsafe(
      browser,
      'top-frame navigation is blocked',
      `
        location.href =
          'https://example.invalid/unsafe-tab';
      `,
      'navigation',
      true
    );
    await expectUnsafe(
      browser,
      'popup is blocked',
      `
        window.open(
          'about:blank',
          '_blank'
        );
      `,
      'popup',
      true
    );
    await expectUnsafe(
      browser,
      'download is cancelled',
      `
        const anchor =
          document.createElement(
            'a'
          );
        anchor.href =
          'data:text/plain,unsafe';
        anchor.download =
          'unsafe.txt';
        document.body.appendChild(
          anchor
        );
        anchor.click();
      `,
      'download',
      true
    );
    await expectUnsafe(
      browser,
      'realtime WebSocket attempt is a hard breach',
      `
        new WebSocket(
          'ws://example.test/tab'
        );
      `,
      'realtime-channel',
      true
    );

    let rollbackFailure:
      Awaited<
        ReturnType<
          typeof runExploratoryLoop
        >
      >;

    await withPreparedPage(
      browser,
      tabMarkup({
        preventRollback:
          true
      }),
      async page => {
        rollbackFailure =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              candidate
            ],
            {
              plan: async () =>
                tabDecision(
                  candidate.reference
                )
            }
          );

        assert.equal(
          rollbackFailure
            .steps[0]
            .executionResult.status,
          'unsafe'
        );
        assert.equal(
          rollbackFailure
            .steps[0]
            .executionResult
            .tabEvidence
            ?.rollbackSucceeded,
          false
        );
      }
    );
    assert.equal(
      evaluateFindingInvestigationOutcome(
        candidate,
        rollbackFailure!
      ).status,
      'inconclusive'
    );
    console.log(
      '✓ rollback failure is unsafe and INCONCLUSIVE'
    );

    console.log(
      '\nAll Stage 4B tab and safety checks passed.'
    );
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(
    '\nStage 4B tab check failed.'
  );
  console.error(error);
  process.exitCode = 1;
});
