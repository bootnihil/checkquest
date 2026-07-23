import assert from 'node:assert/strict';

import type {
  Page
} from '@playwright/test';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import {
  buildExploratoryQaPrompt
} from './analysis/build-exploratory-qa-prompt';
import type {
  ExtractedPageContent
} from './browser/extract-page-content';
import {
  evaluateFindingInvestigationOutcome,
  type FindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  createExploratoryFindingFingerprint
} from './investigation/finding-fingerprint';
import {
  buildKnownFindingPromptContext,
  createKnownFindingState,
  detectStructuredKnownFindingOccurrences,
  reconcilePageFindings,
  registerKnownFindingOccurrence,
  registerNewFinding
} from './investigation/known-findings';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';
import {
  runExploratoryLoop,
  type ExploratoryLoopResult
} from './planning/run-exploratory-loop';

const verifiedOutcome:
  FindingInvestigationOutcome = {
  status:
    'verified',

  summary:
    'The suspicious option was verified.',

  evidence: [
    'Deterministic selected-state evidence.'
  ]
};

const inconclusiveOutcome:
  FindingInvestigationOutcome = {
  status:
    'inconclusive',

  summary:
    'No conclusive action evidence was collected.',

  evidence: []
};

const notVerifiedOutcome:
  FindingInvestigationOutcome = {
  status:
    'not-verified',

  summary:
    'The action did not verify the expected selected state.',

  evidence: [
    'The option remained unselected.'
  ]
};

function createSelectFinding(
  optionText: string,
  options: {
    title?: string;
    category?:
      ExploratoryQaFinding['category'];
    controlLabel?: string;
    knownFindingReference?:
      string | null;
  } = {}
): ExploratoryQaFinding {
  return {
    knownFindingReference:
      options
        .knownFindingReference ??
      null,

    category:
      options.category ??
      'content',

    severity:
      'low',

    confidence:
      'high',

    title:
      options.title ??
      `Suspicious option ${optionText}`,

    evidence:
      `The Country select contains "${optionText}".`,

    reasoning:
      'The option may contain incorrect content.',

    suggestedCheck:
      'Verify whether the option can be selected.',

    evidenceTarget: {
      kind:
        'select-option',

      controlLabel:
        options.controlLabel ??
        'COUNTRY*',

      controlName:
        'country',

      controlId:
        'country-first-page',

      optionText
    }
  };
}

function createDisclosureFinding():
  ExploratoryQaFinding {
  return {
    category:
      'interaction',
    severity:
      'low',
    confidence:
      'medium',
    title:
      'FAQ disclosure state issue',
    evidence:
      'The FAQ disclosure has a structured state target.',
    reasoning:
      'The informational disclosure requires deterministic state verification.',
    suggestedCheck:
      'Expand the disclosure and verify its controlled region.',
    evidenceTarget: {
      kind:
        'disclosure-state',
      controlId:
        'faq-control',
      accessibleName:
        'What does CheckQuest test?',
      controlledRegionId:
        'faq-answer',
      desiredState:
        'expanded'
    }
  };
}

function createPageContent(
  optionText = 'Equador'
): ExtractedPageContent {
  return {
    title:
      'Later page',

    headings: [
      'Later page'
    ],

    bodyText:
      `Country Ecuador ${optionText}`,

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
          'country-later-page',

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
              true
          },

          {
            text:
              optionText,

            value:
              optionText,

            selected:
              false
          }
        ]
      }
    ],

    disclosures: []
  };
}

function buildVerifiedInvestigation():
  ExploratoryLoopResult {
  const content =
    createPageContent();

  const selectedContent:
    ExtractedPageContent = {
    ...content,

    selects:
      content.selects.map(
        select => ({
          ...select,

          id:
            'country-first-page',

          label:
            'COUNTRY*',

          options:
            select.options.map(
              option => ({
                ...option,

                selected:
                  option.text ===
                  'Equador'
              })
            )
        })
      )
  };

  return {
    pageUrl:
      'https://example.com/first',

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
          selectedContent,

        decision: {
          candidateReference:
            'candidate-1',

          hypothesis:
            'Verify the suspicious option.',

          reasoning:
            'The action directly investigates candidate-1.',

          action: {
            kind:
              'select-option',

            target: {
              label:
                'COUNTRY*',

              name:
                'country',

              id:
                'country-first-page',

              placeholder:
                null
            },

            optionText:
              'Equador'
          },

          expectedObservation:
            'The post-action state will show whether the option is selected.'
        },

        executionResult: {
          kind:
            'select-option',

          status:
            'executed',

          detail:
            'Selected Equador.'
        },

        observationAfter:
          selectedContent
      }
    ]
  };
}

async function main():
  Promise<void> {
  const state =
    createKnownFindingState();

  const firstFinding =
    createSelectFinding(
      'Equador'
    );

  const firstCandidates =
    assignPageCandidateReferences([
      firstFinding
    ]);

  assert.equal(
    firstCandidates[0].reference,
    'candidate-1'
  );

  const firstOutcome =
    evaluateFindingInvestigationOutcome(
      firstCandidates[0],
      buildVerifiedInvestigation()
    );

  assert.equal(
    firstOutcome.status,
    'verified'
  );

  const firstOccurrence =
    registerNewFinding(
      state,
      {
        finding:
          firstFinding,

        pageUrl:
          'https://example.com/first',

        pageTitle:
          'First page',

        screenshotPath:
          'page-01.png',

        verificationOutcome:
          firstOutcome
      }
    );

  assert.equal(
    firstOccurrence
      .knownFindingReference,
    'known-1'
  );

  const laterContent =
    createPageContent();

  const detected =
    detectStructuredKnownFindingOccurrences(
      state,
      laterContent
    );

  assert.equal(
    detected.length,
    1
  );

  assert.equal(
    detected[0]
      .knownFindingReference,
    'known-1'
  );

  assert.equal(
    detected[0]
      .redundantInvestigationSkipped,
    true
  );

  const context =
    buildKnownFindingPromptContext(
      state,
      detected.map(
        item =>
          item.fingerprint
      )
    );

  assert.equal(
    context.length,
    1
  );

  assert.equal(
    context[0]
      .knownFindingReference,
    'known-1'
  );

  assert.equal(
    context[0]
      .verificationStatus,
    'verified'
  );

  const serializedContext =
    JSON.stringify(
      context
    );

  assert.equal(
    serializedContext.includes(
      'fingerprint'
    ),
    false
  );

  assert.equal(
    serializedContext.includes(
      'planner'
    ),
    false
  );

  assert.equal(
    serializedContext.includes(
      'screenshot'
    ),
    false
  );

  const promptWithKnownContext =
    buildExploratoryQaPrompt({
      observation: {
        requestedUrl:
          'https://example.com/later',

        finalUrl:
          'https://example.com/later',

        title:
          'Later page',

        httpStatus:
          200,

        headings: [
          'Later page'
        ]
      },

      content:
        laterContent,

      classifiedDiagnostics: {
        consoleErrors: [],
        failedRequests: []
      },

      ruleBasedFindings: [],

      knownFindings:
        context
    });

  assert.match(
    promptWithKnownContext,
    /known-1/
  );

  assert.match(
    promptWithKnownContext,
    /prioritize genuinely new issues/i
  );

  assert.equal(
    promptWithKnownContext.includes(
      firstOccurrence.fingerprint
    ),
    false
  );

  assert.equal(
    promptWithKnownContext.includes(
      'page-01.png'
    ),
    false
  );

  const suppressedDuplicate =
    reconcilePageFindings(
      state,
      [],
      detected
    );

  assert.equal(
    suppressedDuplicate
      .newFindings
      .length,
    0
  );

  assert.equal(
    suppressedDuplicate
      .knownOccurrenceDrafts
      .length,
    1
  );

  assert.equal(
    suppressedDuplicate
      .reinvestigationFindings
      .length,
    0
  );

  let plannerCalls =
    0;

  let executorCalls =
    0;

  const skippedLoop =
    await runExploratoryLoop(
      null as unknown as Page,
      'https://example.com/later',
      3,
      assignPageCandidateReferences(
        suppressedDuplicate
          .reinvestigationFindings
          .map(
            item =>
              item.finding
          )
      ),
      {
        plan: async () => {
          plannerCalls +=
            1;

          throw new Error(
            'Planner must not be called for a verified duplicate.'
          );
        },

        execute: async () => {
          executorCalls +=
            1;

          throw new Error(
            'Executor must not be called for a verified duplicate.'
          );
        }
      }
    );

  assert.equal(
    skippedLoop
      .plannerDecisionCount,
    0
  );

  assert.equal(
    plannerCalls,
    0
  );

  assert.equal(
    executorCalls,
    0
  );

  const differentlyWordedDuplicate =
    createSelectFinding(
      'Equador',
      {
        title:
          'Registration list contains an unexpected country spelling',

        category:
          'consistency',

        knownFindingReference:
          'known-999'
      }
    );

  const reconciledModelDuplicate =
    reconcilePageFindings(
      state,
      [
        differentlyWordedDuplicate
      ],
      detected
    );

  assert.equal(
    reconciledModelDuplicate
      .newFindings
      .length,
    0
  );

  assert.equal(
    reconciledModelDuplicate
      .knownOccurrenceDrafts
      .length,
    1
  );

  assert.deepEqual(
    reconciledModelDuplicate
      .knownOccurrenceDrafts[0]
      .matchingBases,
    [
      'structured-target',
      'finding-fingerprint'
    ]
  );

  assert.equal(
    reconciledModelDuplicate
      .knownOccurrenceDrafts[0]
      .knownFindingReference,
    'known-1'
  );

  assert.equal(
    reconciledModelDuplicate
      .knownOccurrenceDrafts[0]
      .modelKnownFindingReference,
    'known-999'
  );

  assert.equal(
    reconciledModelDuplicate
      .knownOccurrenceDrafts[0]
      .modelReferenceMatched,
    false
  );

  const distinctFinding =
    createSelectFinding(
      'Ecuador',
      {
        title:
          'Possible country option issue',

        knownFindingReference:
          'known-1'
      }
    );

  const distinctResult =
    reconcilePageFindings(
      state,
      [
        distinctFinding
      ],
      []
    );

  assert.equal(
    distinctResult
      .newFindings
      .length,
    1
  );

  assert.equal(
    distinctResult
      .newFindings[0]
      .knownFindingReference,
    null
  );

  const secondKnownFinding =
    createSelectFinding(
      'Atlantis',
      {
        title:
          'Unexpected fictional country option',

        controlLabel:
          'Region'
      }
    );

  const secondOccurrence =
    registerNewFinding(
      state,
      {
        finding:
          secondKnownFinding,

        pageUrl:
          'https://example.com/region',

        pageTitle:
          'Region page',

        screenshotPath:
          null,

        verificationOutcome:
          verifiedOutcome
      }
    );

  assert.equal(
    secondOccurrence
      .knownFindingReference,
    'known-2'
  );

  const wrongExistingReference =
    reconcilePageFindings(
      state,
      [
        createSelectFinding(
          'Equador',
          {
            knownFindingReference:
              'known-2'
          }
        )
      ],
      []
    );

  assert.equal(
    wrongExistingReference
      .knownOccurrenceDrafts[0]
      .knownFindingReference,
    'known-1'
  );

  assert.equal(
    wrongExistingReference
      .knownOccurrenceDrafts[0]
      .modelReferenceMatched,
    false
  );

  const inconclusiveState =
    createKnownFindingState();

  registerNewFinding(
    inconclusiveState,
    {
      finding:
        firstFinding,

      pageUrl:
        'https://example.com/inconclusive-first',

      pageTitle:
        'Inconclusive first page',

      screenshotPath:
        null,

      verificationOutcome:
        inconclusiveOutcome
    }
  );

  const inconclusiveDetected =
    detectStructuredKnownFindingOccurrences(
      inconclusiveState,
      laterContent
    );

  const inconclusiveReconciled =
    reconcilePageFindings(
      inconclusiveState,
      [],
      inconclusiveDetected
    );

  assert.equal(
    inconclusiveReconciled
      .reinvestigationFindings
      .length,
    1
  );

  assert.equal(
    assignPageCandidateReferences(
      inconclusiveReconciled
        .reinvestigationFindings
        .map(
          item =>
            item.finding
        )
    )[0]
      .reference,
    'candidate-1'
  );

  const notVerifiedState =
    createKnownFindingState();

  registerNewFinding(
    notVerifiedState,
    {
      finding:
        firstFinding,

      pageUrl:
        'https://example.com/not-verified-first',

      pageTitle:
        'Not verified first page',

      screenshotPath:
        null,

      verificationOutcome:
        notVerifiedOutcome
    }
  );

  const notVerifiedReconciled =
    reconcilePageFindings(
      notVerifiedState,
      [],
      detectStructuredKnownFindingOccurrences(
        notVerifiedState,
        laterContent
      )
    );

  assert.equal(
    notVerifiedReconciled
      .reinvestigationFindings
      .length,
    1
  );

  const registeredLaterOccurrence =
    registerKnownFindingOccurrence(
      inconclusiveState,
      {
        fingerprint:
          inconclusiveReconciled
            .knownOccurrenceDrafts[0]
            .fingerprint,

        finding:
          inconclusiveReconciled
            .knownOccurrenceDrafts[0]
            .finding,

        pageUrl:
          'https://example.com/later',

        pageTitle:
          'Later page',

        screenshotPath:
          'page-02.png',

        occurrenceEvidence:
          inconclusiveReconciled
            .knownOccurrenceDrafts[0]
            .occurrenceEvidence,

        evidenceTarget:
          inconclusiveReconciled
            .knownOccurrenceDrafts[0]
            .evidenceTarget,

        matchingBases:
          inconclusiveReconciled
            .knownOccurrenceDrafts[0]
            .matchingBases,

        modelKnownFindingReference:
          null,

        modelReferenceMatched:
          null,

        redundantInvestigationSkipped:
          false,

        verificationOutcome:
          verifiedOutcome
      }
    );

  assert.equal(
    registeredLaterOccurrence
      .verificationOutcome
      ?.status,
    'verified'
  );

  assert.equal(
    buildKnownFindingPromptContext(
      inconclusiveState
    )[0]
      .verificationStatus,
    'verified'
  );

  /*
   * The prompt projection is deterministically capped at 20,
   * while a relevant structured match remains first.
   */
  const cappedState =
    createKnownFindingState();

  const cappedFingerprints:
    string[] = [];

  for (
    let index = 1;
    index <= 25;
    index += 1
  ) {
    const finding =
      createSelectFinding(
        `Option ${index}`,
        {
          controlLabel:
            `Control ${index}`
        }
      );

    cappedFingerprints.push(
      createExploratoryFindingFingerprint(
        finding
      )
    );

    registerNewFinding(
      cappedState,
      {
        finding,

        pageUrl:
          `https://example.com/page-${index}`,

        pageTitle:
          `Page ${index}`,

        screenshotPath:
          null,

        verificationOutcome:
          verifiedOutcome
      }
    );
  }

  const cappedContext =
    buildKnownFindingPromptContext(
      cappedState,
      [
        cappedFingerprints[0]
      ]
    );

  assert.equal(
    cappedContext.length,
    20
  );

  assert.equal(
    cappedContext[0]
      .knownFindingReference,
    'known-1'
  );

  /*
   * Candidate references restart per page and remain isolated
   * from known-N run identity.
   */
  assert.equal(
    assignPageCandidateReferences([
      distinctFinding
    ])[0]
      .reference,
    'candidate-1'
  );

  assert.equal(
    assignPageCandidateReferences([
      secondKnownFinding
    ])[0]
      .reference,
    'candidate-1'
  );

  /*
   * Stage 4A disclosure targets use the same authoritative
   * fingerprint and structured-occurrence pipeline as select targets.
   */
  const disclosureState =
    createKnownFindingState();
  const disclosureFinding =
    createDisclosureFinding();
  const disclosureOccurrence =
    registerNewFinding(
      disclosureState,
      {
        finding:
          disclosureFinding,
        pageUrl:
          'https://example.com/faq',
        pageTitle:
          'FAQ',
        screenshotPath:
          null,
        verificationOutcome:
          verifiedOutcome
      }
    );
  const disclosureContent:
    ExtractedPageContent = {
    title: 'FAQ',
    headings: [
      'Frequently Asked Questions'
    ],
    bodyText:
      'What does CheckQuest test?',
    links: [],
    buttons: [
      'What does CheckQuest test?'
    ],
    textFields: [],
    selects: [],
    disclosures: [
      {
        tagName:
          'button',
        role:
          null,
        buttonType:
          'button',
        controlId:
          'faq-control',
        accessibleName:
          'What does CheckQuest test?',
        ariaExpanded:
          'false',
        ariaControls:
          'faq-answer',
        disabled:
          false,
        ariaDisabled:
          false,
        href:
          null,
        hasLinkSemantics:
          false,
        ariaHasPopup:
          null,
        formAssociated:
          false,
        formAncestor:
          false,
        hasSubmitOrResetSemantics:
          false,
        controlledRegionExists:
          true,
        controlledRegionVisible:
          false,
        controlledRegionHasEditableOrSubmissionControls:
          false,
        eligibleForDisclosureAction:
          true,
        eligibilityRejectionReasons:
          []
      }
    ]
  };
  const detectedDisclosure =
    detectStructuredKnownFindingOccurrences(
      disclosureState,
      disclosureContent
    );

  assert.equal(
    detectedDisclosure.length,
    1
  );
  assert.equal(
    detectedDisclosure[0]
      .fingerprint,
    disclosureOccurrence
      .fingerprint
  );
  assert.equal(
    detectedDisclosure[0]
      .redundantInvestigationSkipped,
    true
  );
  assert.equal(
    detectedDisclosure[0]
      .reinvestigationEligible,
    false
  );

  console.log(
    'All Stage 3 known-finding context checks passed.'
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Stage 3 known-finding context check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
