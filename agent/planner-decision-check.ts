import {
  planNextAction
} from './planning/plan-next-action';
import {
  assignPageCandidateReferences,
  isInvestigablePageCandidate
} from './investigation/page-candidates';

async function main(): Promise<void> {
  console.log(
    'Asking Gemini to handle a non-interactive candidate finding safely...\n'
  );

  const investigableCandidates =
    assignPageCandidateReferences([
      {
        category: 'content',
        severity: 'low',
        confidence: 'high',
        title: 'Suspicious country option',
        evidence: 'Analysis reported an Equador option.',
        reasoning: 'Equador may be a misspelling.',
        suggestedCheck: 'Verify the option in the current browser evidence.',
        evidenceTarget: {
          kind: 'select-option',
          controlLabel: 'Country',
          controlName: 'country',
          controlId: 'country',
          optionText: 'Equador'
        }
      }
    ]).filter(
      isInvestigablePageCandidate
    );

  const decision =
    await planNextAction({
      pageUrl:
        'https://example.com/platform',

      currentStep:
        1,

      maxSteps:
        3,

      history:
        [],

      investigableCandidates,

      pageContent: {
        title:
          'Clinical AI Platform',

        headings: [
          'Clinical AI Platform',
          'Built for Enterprise Scale'
        ],

        bodyText:
          'Our clinical clinical workflow platform helps healthcare teams coordinate care across the enterprise.',

        links:
          [],

        /*
         * This intentionally reproduces the tempting but irrelevant
         * cookie-control evidence from the real-site run.
         *
         * Buttons are evidence only and cannot be clicked by the
         * current safe action vocabulary.
         */
        buttons: [
          'Allow all',
          'Deny'
        ],

        /*
         * No editable form controls exist that could meaningfully
         * investigate the candidate content issue.
         */
        textFields:
          [],

        selects:
          [],

        disclosures:
          []
      }
    });

  console.log(
    'Validated Gemini planner decision:\n'
  );

  console.log(
    JSON.stringify(
      decision,
      null,
      2
    )
  );

  console.log(
    '\nDecision passed plannerDecisionSchema validation.'
  );

  console.log(
    `Requested safe action: ${decision.action.kind}`
  );

  /*
   * This is the actual regression assertion.
   *
   * The supported evidence target is absent from the current browser
   * evidence, so real orchestration must stop rather than substitute
   * an unrelated action.
   *
   * The planner should therefore stop rather than drifting into an
   * unrelated cookie-banner test or meaningless scroll action.
   */
  if (
    decision.action.kind !==
    'stop'
  ) {
    throw new Error(
      `Expected planner to stop when the candidate target is absent, but it requested "${decision.action.kind}".`
    );
  }

  console.log(
    '\nPlanner correctly stopped instead of performing unrelated exploration.'
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      '\nGemini planner decision check failed.'
    );

    if (
      error instanceof Error
    ) {
      console.error(
        error.message
      );
    } else {
      console.error(
        error
      );
    }

    process.exitCode =
      1;
  }
);
