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

const disclosureTarget = {
  controlId: 'faq-control',
  accessibleName:
    'What does CheckQuest test?',
  controlledRegionId:
    'faq-answer'
};

function disclosureFinding(
  overrides: Partial<
    typeof disclosureTarget
  > = {}
): ExploratoryQaFinding {
  const target = {
    ...disclosureTarget,
    ...overrides
  };

  return {
    category: 'interaction',
    severity: 'low',
    confidence: 'medium',
    title:
      `Informational disclosure ${target.accessibleName}`,
    evidence:
      `Structured page evidence identifies disclosure "${target.accessibleName}".`,
    reasoning:
      'The candidate requires a reversible disclosure-state check.',
    suggestedCheck:
      'Expand the disclosure and verify its controlled region.',
    evidenceTarget: {
      kind:
        'disclosure-state',
      ...target,
      desiredState:
        'expanded'
    }
  };
}

function disclosureDecision(
  candidateReference:
    string,
  target = disclosureTarget
): PlannerDecision {
  return {
    candidateReference,
    hypothesis:
      'The informational disclosure should reveal its controlled answer region.',
    reasoning:
      'The action exactly matches the candidate disclosure target.',
    action: {
      kind:
        'set-disclosure-state',
      target,
      desiredState:
        'expanded'
    },
    expectedObservation:
      'aria-expanded and controlled-region visibility should change and then be restored.'
  };
}

function disclosureMarkup(
  options: {
    controlAttributes?: string;
    regionMarkup?: string;
    clickBody?: string;
    secondDisclosure?: boolean;
    extraMarkup?: string;
  } = {}
): string {
  const {
    controlAttributes =
      'type="button" aria-expanded="false" aria-controls="faq-answer"',
    regionMarkup =
      '<div id="faq-answer" hidden>CheckQuest safely investigates public UI.</div>',
    clickBody = `
      const expanded =
        control.getAttribute('aria-expanded') === 'true';
      control.setAttribute(
        'aria-expanded',
        String(!expanded)
      );
      region.hidden = expanded;
    `,
    secondDisclosure = false,
    extraMarkup = ''
  } = options;

  return `
    <!doctype html>
    <html>
      <head>
        <title>Stage 4A Disclosure Check</title>
      </head>
      <body>
        <button
          id="faq-control"
          ${controlAttributes}
        >
          What does CheckQuest test?
        </button>

        ${regionMarkup}

        ${
          secondDisclosure
            ? `
              <button
                id="other-control"
                type="button"
                aria-expanded="false"
                aria-controls="other-answer"
              >
                Another question
              </button>
              <div id="other-answer" hidden>
                Another answer
              </div>
            `
            : ''
        }

        ${extraMarkup}

        <script>
          const control =
            document.getElementById(
              'faq-control'
            );
          const region =
            document.getElementById(
              'faq-answer'
            );

          control.addEventListener(
            'click',
            () => {
              ${clickBody}
            }
          );

          const otherControl =
            document.getElementById(
              'other-control'
            );
          const otherRegion =
            document.getElementById(
              'other-answer'
            );

          if (
            otherControl &&
            otherRegion
          ) {
            otherControl.addEventListener(
              'click',
              () => {
                const expanded =
                  otherControl.getAttribute(
                    'aria-expanded'
                  ) === 'true';
                otherControl.setAttribute(
                  'aria-expanded',
                  String(!expanded)
                );
                otherRegion.hidden =
                  expanded;
              }
            );
          }
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

async function expectUnsafe(
  browser: Browser,
  name: string,
  markup: string,
  expectedPattern:
    RegExp
): Promise<void> {
  await withPreparedPage(
    browser,
    markup,
    async page => {
      const result =
        await executeAgentAction(
          page,
          {
            kind:
              'set-disclosure-state',
            target:
              disclosureTarget,
            desiredState:
              'expanded'
          }
        );

      assert.equal(
        result.status,
        'unsafe',
        name
      );
      assert.match(
        result.detail,
        expectedPattern,
        name
      );
    }
  );

  console.log(
    `✓ SAFE REJECTION: ${name}`
  );
}

async function main():
  Promise<void> {
  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    let verifiedInvestigation:
      Awaited<
        ReturnType<
          typeof runExploratoryLoop
        >
      >;
    let verifiedCandidate:
      ReturnType<
        typeof assignPageCandidateReferences
      >[number];

    await withPreparedPage(
      browser,
      disclosureMarkup(),
      async page => {
        const extracted =
          await extractPageContent(
            page
          );

        assert.equal(
          extracted.disclosures
            .length,
          1
        );
        assert.equal(
          extracted.disclosures[0]
            .eligibleForDisclosureAction,
          true
        );

        verifiedCandidate =
          assignPageCandidateReferences(
            [
              disclosureFinding()
            ]
          )[0];

        verifiedInvestigation =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              verifiedCandidate
            ],
            {
              plan: async () =>
                disclosureDecision(
                  'candidate-1'
                )
            }
          );

        assert.equal(
          verifiedInvestigation
            .steps[0]
            .executionResult.status,
          'executed'
        );
        assert.equal(
          verifiedInvestigation
            .steps[0]
            .executionResult
            .disclosureEvidence
            ?.stateTransitionObserved,
          true
        );
        assert.equal(
          verifiedInvestigation
            .steps[0]
            .executionResult
            .disclosureEvidence
            ?.rollbackSucceeded,
          true
        );
        assert.equal(
          await page
            .locator(
              '#faq-control'
            )
            .getAttribute(
              'aria-expanded'
            ),
          'false'
        );
        assert.equal(
          await page
            .locator(
              '#faq-answer'
            )
            .isHidden(),
          true
        );

        const outcome =
          evaluateFindingInvestigationOutcome(
            verifiedCandidate,
            verifiedInvestigation
          );

        assert.equal(
          outcome.status,
          'verified'
        );
      }
    );

    console.log(
      '✓ exact candidate-linked disclosure executed, verified, and rolled back'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup(),
      async page => {
        const candidates =
          assignPageCandidateReferences(
            [
              disclosureFinding()
            ]
          );
        let executorCalls =
          0;

        const result =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            candidates,
            {
              plan:
                async () =>
                  disclosureDecision(
                    'candidate-999'
                  ),
              execute:
                async (
                  _page,
                  action
                ) => {
                  executorCalls +=
                    1;
                  return {
                    kind:
                      action.kind,
                    status:
                      'executed',
                    detail:
                      'Unexpected execution.'
                  };
                }
            }
          );

        assert.equal(
          result.stopReason,
          'invalid-planner-decision'
        );
        assert.equal(
          executorCalls,
          0
        );
      }
    );

    console.log(
      '✓ wrong candidate reference rejected before executor'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup({
        secondDisclosure:
          true
      }),
      async page => {
        const candidates =
          assignPageCandidateReferences(
            [
              disclosureFinding()
            ]
          );

        const result =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            candidates,
            {
              plan:
                async () =>
                  disclosureDecision(
                    'candidate-1',
                    {
                      controlId:
                        'other-control',
                      accessibleName:
                        'Another question',
                      controlledRegionId:
                        'other-answer'
                    }
                  )
            }
          );

        assert.equal(
          result.stopReason,
          'invalid-planner-decision'
        );
        assert.equal(
          result
            .executedInvestigationActionCount,
          0
        );
      }
    );

    console.log(
      '✓ unrelated disclosure rejected by relevance gate'
    );

    await expectUnsafe(
      browser,
      'missing aria-expanded',
      disclosureMarkup({
        controlAttributes:
          'type="button" aria-controls="faq-answer"'
      }),
      /aria-expanded/i
    );

    await expectUnsafe(
      browser,
      'missing or mismatched aria-controls',
      disclosureMarkup({
        controlAttributes:
          'type="button" aria-expanded="false" aria-controls="missing-answer"'
      }),
      /aria-controls|region/i
    );

    await expectUnsafe(
      browser,
      'disabled disclosure',
      disclosureMarkup({
        controlAttributes:
          'type="button" disabled aria-expanded="false" aria-controls="faq-answer"'
      }),
      /disabled/i
    );

    await expectUnsafe(
      browser,
      'aria-disabled disclosure',
      disclosureMarkup({
        controlAttributes:
          'type="button" aria-disabled="true" aria-expanded="false" aria-controls="faq-answer"'
      }),
      /disabled/i
    );

    await expectUnsafe(
      browser,
      'link or href disclosure',
      disclosureMarkup({
        controlAttributes:
          'role="link" href="#unsafe" aria-expanded="false" aria-controls="faq-answer"'
      }),
      /link|href/i
    );

    await expectUnsafe(
      browser,
      'aria-haspopup disclosure',
      disclosureMarkup({
        controlAttributes:
          'type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="faq-answer"'
      }),
      /aria-haspopup/i
    );

    await expectUnsafe(
      browser,
      'form-associated disclosure',
      disclosureMarkup({
        controlAttributes:
          'type="button" form="other-form" aria-expanded="false" aria-controls="faq-answer"',
        extraMarkup:
          '<form id="other-form"></form>'
      }),
      /form-associated/i
    );

    await expectUnsafe(
      browser,
      'controlled region containing an editable control',
      disclosureMarkup({
        regionMarkup:
          '<div id="faq-answer" hidden><input type="text" /></div>'
      }),
      /editable|submission/i
    );

    {
      const context =
        await browser.newContext({
          serviceWorkers:
            'block'
        });
      const page =
        await context.newPage();

      try {
        await page.setContent(
          disclosureMarkup()
        );

        const result =
          await executeAgentAction(
            page,
            {
              kind:
                'set-disclosure-state',
              target:
                disclosureTarget,
              desiredState:
                'expanded'
            }
          );

        assert.equal(
          result.status,
          'unsafe'
        );
        assert.match(
          result.detail,
          /not prepared|realtime-channel tracking/i
        );
      } finally {
        await context.close();
      }
    }

    console.log(
      '✓ unprepared realtime environment fails closed'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup(),
      async page => {
        await page.evaluate(
          () => {
            new WebSocket(
              'ws://example.test/socket'
            );
          }
        );
        await page.waitForTimeout(
          500
        );

        const result =
          await executeAgentAction(
            page,
            {
              kind:
                'set-disclosure-state',
              target:
                disclosureTarget,
              desiredState:
                'expanded'
            }
          );

        assert.equal(
          result.status,
          'unsafe'
        );
        assert.equal(
          result.hardBreach,
          true
        );
        assert.ok(
          result.safetyEvents
            ?.some(
              event =>
                event.kind ===
                'realtime-channel'
            )
        );
      }
    );

    console.log(
      '✓ attempted realtime channel fails closed'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup(),
      async page => {
        await page.route(
          'https://example.test/slow',
          () => {
            // Deliberately leave the synthetic request pending.
          }
        );

        await page.evaluate(
          () => {
            void fetch(
              'https://example.test/slow'
            ).catch(
              () => undefined
            );
          }
        );
        await page.waitForTimeout(
          50
        );

        const result =
          await executeAgentAction(
            page,
            {
              kind:
                'set-disclosure-state',
              target:
                disclosureTarget,
              desiredState:
                'expanded'
            }
          );

        assert.equal(
          result.status,
          'unsafe'
        );
        assert.match(
          result.detail,
          /network-quiet/i
        );
      }
    );

    console.log(
      '✓ unstable network environment fails closed before interaction'
    );

    await withPreparedPage(
      browser,
      `
        <label for="first">
          First field
        </label>
        <input
          id="first"
          name="first"
          type="text"
        />
        <label for="second">
          Second field
        </label>
        <input
          id="second"
          name="second"
          type="text"
        />
      `,
      async page => {
        await assert.rejects(
          executeAgentAction(
            page,
            {
              kind:
                'fill-text-field',
              target: {
                id: 'first',
                name: 'second',
                label:
                  'First field',
                placeholder:
                  null
              },
              value: 'test'
            }
          ),
          /conflicting form-control identity/i
        );
      }
    );

    console.log(
      '✓ conflicting existing form-control identities rejected'
    );

    await expectUnsafe(
      browser,
      'submit event is prevented',
      disclosureMarkup({
        extraMarkup:
          '<form id="hidden-form"></form>',
        clickBody: `
          document
            .getElementById(
              'hidden-form'
            )
            .requestSubmit();
        `
      }),
      /form|submit/i
    );

    await expectUnsafe(
      browser,
      'navigation attempt is prevented',
      disclosureMarkup({
        clickBody: `
          history.pushState(
            {},
            '',
            '#unsafe-navigation'
          );
        `
      }),
      /navigation|pushState/i
    );

    await expectUnsafe(
      browser,
      'popup attempt is prevented',
      disclosureMarkup({
        clickBody: `
          window.open(
            'about:blank',
            '_blank'
          );
        `
      }),
      /popup|window.open/i
    );

    await expectUnsafe(
      browser,
      'download attempt is cancelled',
      disclosureMarkup({
        clickBody: `
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
          anchor.remove();
        `
      }),
      /download/i
    );

    await expectUnsafe(
      browser,
      'outbound request is aborted',
      disclosureMarkup({
        clickBody: `
          fetch(
            'https://example.invalid/check'
          ).catch(
            () => undefined
          );
        `
      }),
      /blocked get request|outbound request/i
    );

    await withPreparedPage(
      browser,
      disclosureMarkup({
        clickBody: `
          fetch(
            '/mutation',
            {
              method: 'POST'
            }
          ).catch(
            () => undefined
          );
        `
      }),
      async page => {
        const result =
          await executeAgentAction(
            page,
            {
              kind:
                'set-disclosure-state',
              target:
                disclosureTarget,
              desiredState:
                'expanded'
            }
          );

        assert.equal(
          result.status,
          'unsafe'
        );
        assert.equal(
          result.hardBreach,
          true
        );
        assert.ok(
          result.safetyEvents
            ?.some(
              event =>
                event.kind ===
                  'mutation-request' &&
                event.method ===
                  'POST'
            )
        );

        const secondResult =
          await executeAgentAction(
            page,
            {
              kind:
                'set-disclosure-state',
              target:
                disclosureTarget,
              desiredState:
                'expanded'
            }
          );

        assert.equal(
          secondResult.status,
          'unsafe'
        );
        assert.match(
          secondResult.detail,
          /disabled for this run/i
        );
      }
    );

    console.log(
      '✓ mutation-method request identified as a hard breach'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup({
        clickBody: `
          if (
            control.getAttribute(
              'aria-expanded'
            ) === 'false'
          ) {
            control.setAttribute(
              'aria-expanded',
              'true'
            );
            region.hidden =
              false;
          }
        `
      }),
      async page => {
        const candidate =
          assignPageCandidateReferences(
            [
              disclosureFinding()
            ]
          )[0];
        const investigation =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              candidate
            ],
            {
              plan:
                async () =>
                  disclosureDecision(
                    'candidate-1'
                  )
            }
          );
        const outcome =
          evaluateFindingInvestigationOutcome(
            candidate,
            investigation
          );

        assert.equal(
          investigation.steps[0]
            .executionResult.status,
          'unsafe'
        );
        assert.equal(
          outcome.status,
          'inconclusive'
        );
      }
    );

    console.log(
      '✓ rollback failure cannot produce VERIFIED'
    );

    await withPreparedPage(
      browser,
      disclosureMarkup({
        clickBody:
          '/* intentionally no state change */'
      }),
      async page => {
        const candidate =
          assignPageCandidateReferences(
            [
              disclosureFinding()
            ]
          )[0];
        const investigation =
          await runExploratoryLoop(
            page,
            page.url(),
            1,
            [
              candidate
            ],
            {
              plan:
                async () =>
                  disclosureDecision(
                    'candidate-1'
                  )
            }
          );
        const outcome =
          evaluateFindingInvestigationOutcome(
            candidate,
            investigation
          );

        assert.equal(
          outcome.status,
          'not-verified'
        );
      }
    );

    console.log(
      '✓ deterministic safe non-transition produces NOT-VERIFIED'
    );

    const unrelatedCandidate =
      assignPageCandidateReferences(
        [
          disclosureFinding({
            controlId:
              'other-control',
            accessibleName:
              'Another question',
            controlledRegionId:
              'other-answer'
          })
        ]
      )[0];
    const unrelatedOutcome =
      evaluateFindingInvestigationOutcome(
        unrelatedCandidate,
        verifiedInvestigation!
      );

    assert.equal(
      unrelatedOutcome.status,
      'inconclusive'
    );

    console.log(
      '✓ unrelated disclosure evidence cannot satisfy a candidate'
    );
    console.log(
      '\nAll Stage 4A disclosure and safety checks passed.'
    );
  } finally {
    await browser.close();
  }
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      '\nStage 4A disclosure check failed.'
    );
    console.error(error);
    process.exitCode = 1;
  }
);
