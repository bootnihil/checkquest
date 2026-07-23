import assert from 'node:assert/strict';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import type {
  ExtractedPageContent
} from './browser/extract-page-content';

import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';

import type {
  ExploratoryLoopResult
} from './planning/run-exploratory-loop';

const finding: ExploratoryQaFinding = {
  category:
    'content',

  severity:
    'low',

  confidence:
    'high',

  title:
    'Possible typo in country selection list',

  evidence:
    'The Country select contains both Ecuador and Equador.',

  reasoning:
    'Equador appears to be a misspelling of Ecuador and both values are present in the same country list.',

  suggestedCheck:
    'Verify whether Equador is a genuinely selectable option.',

  evidenceTarget: {
    kind:
      'select-option',

    controlLabel:
      'Country',

    controlName:
      'country',

    controlId:
      'country',

    optionText:
      'Equador'
  }
};

const candidate =
  assignPageCandidateReferences([
    finding
  ])[0];

function buildPageContent(
  selectedOption:
    'Ecuador' | 'Equador' | null
): ExtractedPageContent {
  return {
    title:
      'Contact Us',

    headings: [
      'Contact Us'
    ],

    bodyText:
      'Country Ecuador Equador',

    links: [],

    buttons: [],

    textFields: [],

    selects: [
      {
        label:
          'Country',

        name:
          'country',

        id:
          'country',

        required:
          true,

        disabled:
          false,

        totalOptions:
          2,

        optionsTruncated:
          false,

        options: [
          {
            text:
              'Ecuador',

            value:
              'Ecuador',

            selected:
              selectedOption ===
              'Ecuador'
          },

          {
            text:
              'Equador',

            value:
              'Equador',

            selected:
              selectedOption ===
              'Equador'
          }
        ]
      }
    ],

    disclosures: []
  };
}

function buildSelectInvestigation(
  selectedAfter:
    'Ecuador' | 'Equador' | null
): ExploratoryLoopResult {
  return {
    pageUrl:
      'https://example.com/contact',

    maxPlannerDecisions:
      1,

    plannerDecisionCount:
      1,

    executedInvestigationActionCount:
      1,

    stopReason:
      'max-planner-decisions-reached',

    steps: [
      {
        step:
          1,

        observationBefore:
          buildPageContent(
            'Ecuador'
          ),

        decision: {
          candidateReference:
            'candidate-1',

          hypothesis:
            'Verify whether the suspicious Equador option can actually be selected.',

          reasoning:
            'The observed Country select contains the suspicious option and selecting it is a safe way to collect direct evidence.',

          action: {
            kind:
              'select-option',

            target: {
              label:
                'Country',

              name:
                'country',

              id:
                'country',

              placeholder:
                null
            },

            optionText:
              'Equador'
          },

          expectedObservation:
            'The post-action browser state may show whether Equador became the selected option.'
        },

        executionResult: {
          kind:
            'select-option',

          status:
            'executed',

          detail:
            'Selected option "Equador" from approved native select control.'
        },

        observationAfter:
          buildPageContent(
            selectedAfter
          )
      }
    ]
  };
}

/*
 * VERIFIED
 *
 * The exact suspicious option was requested,
 * the action executed successfully,
 * and deterministic browser evidence confirms
 * that the option is selected afterwards.
 */
const verified =
  evaluateFindingInvestigationOutcome(
    candidate,
    buildSelectInvestigation(
      'Equador'
    )
  );

assert.equal(
  verified.status,
  'verified'
);

assert.match(
  verified.summary,
  /verified/i
);

assert.ok(
  verified.evidence.length >
  0
);

console.log(
  'Verified outcome check passed.'
);

/*
 * NOT VERIFIED
 *
 * The relevant action executed, but the captured
 * post-action browser state directly contradicts
 * the expected result.
 */
const notVerified =
  evaluateFindingInvestigationOutcome(
    candidate,
    buildSelectInvestigation(
      'Ecuador'
    )
  );

assert.equal(
  notVerified.status,
  'not-verified'
);

assert.match(
  notVerified.summary,
  /did not verify/i
);

assert.ok(
  notVerified.evidence.length >
  0
);

console.log(
  'Not-verified outcome check passed.'
);

/*
 * INCONCLUSIVE
 *
 * No investigation evidence exists.
 *
 * Lack of evidence must never be treated as proof
 * that the candidate finding is false.
 */
const inconclusive =
  evaluateFindingInvestigationOutcome(
    candidate,
    null
  );

assert.equal(
  inconclusive.status,
  'inconclusive'
);

assert.match(
  inconclusive.summary,
  /no autonomous investigation/i
);

console.log(
  'Inconclusive outcome check passed.'
);

/*
 * INCONCLUSIVE — WRONG INVESTIGATION
 *
 * Also verify that performing some other action
 * does not accidentally count as evidence for
 * this candidate finding.
 */
const unrelatedInvestigation:
  ExploratoryLoopResult = {
    pageUrl:
      'https://example.com/contact',

    maxPlannerDecisions:
      1,

    plannerDecisionCount:
      1,

    executedInvestigationActionCount:
      0,

    stopReason:
      'planner-stop',

    steps: [
      {
        step:
          1,

        observationBefore:
          buildPageContent(
            'Ecuador'
          ),

        decision: {
          hypothesis:
            'No further useful action is available.',

          reasoning:
            'Stop without investigating the candidate.',

          action: {
            kind:
              'stop',

            reason:
              'No useful safe action selected.'
          },

          expectedObservation:
            'No browser interaction will occur.'
        },

        executionResult: {
          kind:
            'stop',

          status:
            'stopped',

          detail:
            'No useful safe action selected.'
        },

        observationAfter:
          buildPageContent(
            'Ecuador'
          )
      }
    ]
  };

const unrelatedOutcome =
  evaluateFindingInvestigationOutcome(
    candidate,
    unrelatedInvestigation
  );

assert.equal(
  unrelatedOutcome.status,
  'inconclusive'
);

console.log(
  'Unrelated-investigation safety check passed.'
);

console.log(
  '\nAll finding investigation outcome checks passed.'
);
