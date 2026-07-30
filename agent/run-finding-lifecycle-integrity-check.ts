import assert from 'node:assert/strict';

import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import type {
  PageFinding
} from './analysis/evaluate-page';
import type {
  ExtractedPageContent
} from './browser/extract-page-content';
import {
  attachInvestigationOutcome,
  registerUnifiedPageFindings
} from './findings/unified-finding-registry';
import {
  commitRunPageFindings,
  createRunFindingLifecycle,
  getRunFindings,
  prepareKnownFindingAnalysis,
  reconcileRunPageFindings,
  type PageFindingInvestigationResult,
  type ReconciledRunPageFindings,
  type RunFindingLifecycleState
} from './findings/run-finding-lifecycle';
import {
  createExploratoryFindingFingerprint
} from './investigation/finding-fingerprint';
import type {
  FindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  registerNewFinding
} from './investigation/known-findings';
import type {
  PageCandidateReference
} from './investigation/page-candidates';

interface SelectFixture {
  label: string;
  name: string;
  id: string;
  ordinaryOption: string;
  suspiciousOption: string;
}

const equadorSelect: SelectFixture = {
  label:
    'Country',
  name:
    'country',
  id:
    'country',
  ordinaryOption:
    'Ecuador',
  suspiciousOption:
    'Equador'
};

const pirateSelect: SelectFixture = {
  label:
    'Language',
  name:
    'language',
  id:
    'language',
  ordinaryOption:
    'English',
  suspiciousOption:
    'Pirate'
};

function createSelectFinding(
  fixture:
    SelectFixture,
  title:
    string
): ExploratoryQaFinding {
  return {
    knownFindingReference:
      null,
    category:
      'content',
    severity:
      'low',
    confidence:
      'high',
    title,
    evidence:
      `The ${fixture.label} select contains "${fixture.suspiciousOption}".`,
    reasoning:
      `"${fixture.suspiciousOption}" may be unintended.`,
    suggestedCheck:
      `Check whether "${fixture.suspiciousOption}" can be selected.`,
    evidenceTarget: {
      kind:
        'select-option',
      controlLabel:
        fixture.label,
      controlName:
        fixture.name,
      controlId:
        fixture.id,
      optionText:
        fixture.suspiciousOption
    }
  };
}

function createTargetlessFinding(
  finding:
    PageFinding
): ExploratoryQaFinding {
  return {
    knownFindingReference:
      null,
    relatedRuleCode:
      finding.code,
    category:
      'technical',
    severity:
      finding.severity,
    confidence:
      'high',
    title:
      finding.title,
    evidence:
      finding.evidence,
    reasoning:
      `Model reasoning for ${finding.code}.`,
    suggestedCheck:
      `Review ${finding.code}.`,
    evidenceTarget:
      null
  };
}

function createPageContent(
  title: string,
  fixtures:
    SelectFixture[]
): ExtractedPageContent {
  return {
    title,
    headings: [
      title
    ],
    bodyText:
      fixtures
        .flatMap(
          fixture => [
            fixture.label,
            fixture.ordinaryOption,
            fixture.suspiciousOption
          ]
        )
        .join(' '),
    links: [],
    buttons: [],
    textFields: [],
    selects:
      fixtures.map(
        fixture => ({
          label:
            fixture.label,
          name:
            fixture.name,
          id:
            fixture.id,
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
                fixture.ordinaryOption,
              value:
                fixture.ordinaryOption,
              selected:
                true
            },
            {
              text:
                fixture.suspiciousOption,
              value:
                fixture.suspiciousOption,
              selected:
                false
            }
          ]
        })
      ),
    disclosures: [],
    tabs: []
  };
}

function createAnalysis(
  findings:
    ExploratoryQaFinding[]
): ExploratoryQaAnalysis {
  return {
    findings,
    summary:
      'Synthetic lifecycle-integrity analysis.'
  };
}

function createOutcome(
  status:
    FindingInvestigationOutcome[
      'status'
    ],
  subject:
    string
): FindingInvestigationOutcome {
  return {
    status,
    summary:
      `${subject} outcome was ${status}.`,
    evidence: [
      `${subject} evidence was ${status}.`
    ]
  };
}

function reconcilePage(
  lifecycle:
    RunFindingLifecycleState,
  input: {
    pageUrl: string;
    pageTitle: string;
    fixtures:
      SelectFixture[];
    findings:
      ExploratoryQaFinding[];
    ruleFindings?:
      PageFinding[];
  }
): ReconciledRunPageFindings {
  const knownFindingPreparation =
    prepareKnownFindingAnalysis(
      lifecycle,
      createPageContent(
        input.pageTitle,
        input.fixtures
      )
    );

  return reconcileRunPageFindings(
    lifecycle,
    {
      pageUrl:
        input.pageUrl,
      pageTitle:
        input.pageTitle,
      ruleFindings:
        input.ruleFindings ??
        [],
      rawExploratoryQaAnalysis:
        createAnalysis(
          input.findings
        ),
      knownFindingPreparation
    }
  );
}

function createResult(
  page:
    ReconciledRunPageFindings,
  candidateReference:
    PageCandidateReference,
  outcome:
    FindingInvestigationOutcome,
  finding?:
    ExploratoryQaFinding
): PageFindingInvestigationResult {
  const candidate =
    page
      .pageCandidates
      .find(
        item =>
          item.reference ===
          candidateReference
      );

  assert.ok(
    candidate,
    `Missing prepared candidate ${candidateReference}.`
  );

  return {
    candidateReference,
    finding:
      finding ??
      candidate.finding,
    outcome
  };
}

function getRawOutcomeStatus(
  lifecycle:
    RunFindingLifecycleState,
  fingerprint:
    string,
  pageUrl:
    string
): string | undefined {
  const occurrence =
    getRunFindings(
      lifecycle
    )
      .find(
        finding =>
          finding.fingerprint ===
          fingerprint
      )
      ?.occurrences
      .find(
        item =>
          item.pageUrl ===
          pageUrl
      );

  const rawOutcome =
    occurrence
      ?.evidence
      .find(
        evidence =>
          evidence.kind ===
          'investigation-outcome'
      )
      ?.rawSource
      ?.value as
        | {
            status?: string;
          }
        | undefined;

  return rawOutcome
    ?.status;
}

function assertNoCommittedState(
  lifecycle:
    RunFindingLifecycleState
): void {
  assert.equal(
    getRunFindings(
      lifecycle
    ).length,
    0,
    'Malformed result input mutated canonical findings.'
  );

  assert.equal(
    lifecycle
      .knownFindingState
      .entriesByFingerprint
      .size,
    0,
    'Malformed result input mutated compatibility findings.'
  );
}

function checkMultipleNewFindings(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const equadorFinding =
    createSelectFinding(
      equadorSelect,
      'Misspelled country option'
    );
  const pirateFinding =
    createSelectFinding(
      pirateSelect,
      'Unexpected language option'
    );
  const pageUrl =
    'https://example.com/multiple-new';
  const page =
    reconcilePage(
      lifecycle,
      {
        pageUrl,
        pageTitle:
          'Multiple new findings',
        fixtures: [
          equadorSelect,
          pirateSelect
        ],
        findings: [
          equadorFinding,
          pirateFinding
        ]
      }
    );
  const equadorFingerprint =
    createExploratoryFindingFingerprint(
      equadorFinding
    );
  const pirateFingerprint =
    createExploratoryFindingFingerprint(
      pirateFinding
    );

  assert.deepEqual(
    page.pageCandidates.map(
      candidate => [
        candidate.reference,
        page
          .unifiedFingerprintByCandidateReference
          .get(
            candidate.reference
          )
      ]
    ),
    [
      [
        'candidate-1',
        equadorFingerprint
      ],
      [
        'candidate-2',
        pirateFingerprint
      ]
    ]
  );

  commitRunPageFindings(
    lifecycle,
    {
      page,
      pageUrl,
      pageTitle:
        'Multiple new findings',
      pageNumber:
        1,
      screenshotPath:
        null,
      exploratoryFindingResults: [
        createResult(
          page,
          'candidate-1',
          createOutcome(
            'verified',
            'Equador'
          )
        ),
        createResult(
          page,
          'candidate-2',
          createOutcome(
            'not-verified',
            'Pirate'
          )
        )
      ]
    }
  );

  assert.deepEqual(
    getRunFindings(
      lifecycle
    ).map(
      finding =>
        finding.fingerprint
    ),
    [
      equadorFingerprint,
      pirateFingerprint
    ]
  );

  assert.equal(
    getRawOutcomeStatus(
      lifecycle,
      equadorFingerprint,
      pageUrl
    ),
    'verified'
  );

  assert.equal(
    getRawOutcomeStatus(
      lifecycle,
      pirateFingerprint,
      pageUrl
    ),
    'not-verified'
  );

  assert.equal(
    lifecycle
      .knownFindingState
      .entriesByFingerprint
      .get(
        equadorFingerprint
      )
      ?.occurrences[0]
      .verificationOutcome
      ?.status,
    'verified'
  );

  assert.equal(
    lifecycle
      .knownFindingState
      .entriesByFingerprint
      .get(
        pirateFingerprint
      )
      ?.occurrences[0]
      .verificationOutcome
      ?.status,
    'not-verified'
  );

  const canonicalEquador =
    getRunFindings(
      lifecycle
    ).find(
      finding =>
        finding.fingerprint ===
        equadorFingerprint
    );
  const canonicalPirate =
    getRunFindings(
      lifecycle
    ).find(
      finding =>
        finding.fingerprint ===
        pirateFingerprint
    );
  const equadorEvidence =
    canonicalEquador
      ?.occurrences[0]
      .evidence
      .map(
        evidence =>
          evidence.summary
      )
      .join(' ') ??
    '';
  const pirateEvidence =
    canonicalPirate
      ?.occurrences[0]
      .evidence
      .map(
        evidence =>
          evidence.summary
      )
      .join(' ') ??
    '';

  assert.match(
    equadorEvidence,
    /Equador/
  );
  assert.doesNotMatch(
    equadorEvidence,
    /Pirate/
  );
  assert.match(
    pirateEvidence,
    /Pirate/
  );
  assert.doesNotMatch(
    pirateEvidence,
    /Equador/
  );
}

function checkMixedReorderedResults(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const equadorFinding =
    createSelectFinding(
      equadorSelect,
      'Misspelled country option'
    );
  const pirateFinding =
    createSelectFinding(
      pirateSelect,
      'Unexpected language option'
    );
  const equadorFingerprint =
    createExploratoryFindingFingerprint(
      equadorFinding
    );
  const pirateFingerprint =
    createExploratoryFindingFingerprint(
      pirateFinding
    );
  const firstUrl =
    'https://example.com/first';
  const firstPage =
    reconcilePage(
      lifecycle,
      {
        pageUrl:
          firstUrl,
        pageTitle:
          'First page',
        fixtures: [
          equadorSelect
        ],
        findings: [
          equadorFinding
        ]
      }
    );

  commitRunPageFindings(
    lifecycle,
    {
      page:
        firstPage,
      pageUrl:
        firstUrl,
      pageTitle:
        'First page',
      pageNumber:
        1,
      screenshotPath:
        null,
      exploratoryFindingResults: [
        createResult(
          firstPage,
          'candidate-1',
          createOutcome(
            'verified',
            'Equador first page'
          )
        )
      ]
    }
  );

  assert.equal(
    getRunFindings(
      lifecycle
    )[0]
      .verification.state,
    'inconclusive',
    'Raw mechanical success must not semantically verify Equador.'
  );

  const secondUrl =
    'https://example.com/mixed';
  const secondPreparation =
    prepareKnownFindingAnalysis(
      lifecycle,
      createPageContent(
        'Mixed page',
        [
          equadorSelect,
          pirateSelect
        ]
      )
    );

  assert.equal(
    secondPreparation
      .deterministicKnownOccurrenceDrafts[0]
      .redundantInvestigationSkipped,
    false,
    'Raw VERIFIED incorrectly triggered canonical suppression.'
  );

  const secondPage =
    reconcileRunPageFindings(
      lifecycle,
      {
        pageUrl:
          secondUrl,
        pageTitle:
          'Mixed page',
        ruleFindings: [],
        rawExploratoryQaAnalysis:
          createAnalysis([
            pirateFinding
          ]),
        knownFindingPreparation:
          secondPreparation
      }
    );

  assert.deepEqual(
    secondPage.pageCandidates.map(
      candidate => [
        candidate.reference,
        secondPage
          .knownFingerprintByCandidateReference
          .get(
            candidate.reference
          ) ??
        null
      ]
    ),
    [
      [
        'candidate-1',
        null
      ],
      [
        'candidate-2',
        equadorFingerprint
      ]
    ]
  );

  const knownOccurrences =
    commitRunPageFindings(
      lifecycle,
      {
        page:
          secondPage,
        pageUrl:
          secondUrl,
        pageTitle:
          'Mixed page',
        pageNumber:
          2,
        screenshotPath:
          null,

        /*
         * Deliberately reverse valid result order. Association must follow
         * candidateReference, not the incidental array position.
         */
        exploratoryFindingResults: [
          createResult(
            secondPage,
            'candidate-2',
            createOutcome(
              'inconclusive',
              'Equador known occurrence'
            )
          ),
          createResult(
            secondPage,
            'candidate-1',
            createOutcome(
              'not-verified',
              'Pirate new occurrence'
            )
          )
        ]
      }
    );

  assert.equal(
    knownOccurrences.length,
    1
  );
  assert.equal(
    knownOccurrences[0]
      .fingerprint,
    equadorFingerprint
  );
  assert.equal(
    knownOccurrences[0]
      .verificationOutcome
      ?.status,
    'inconclusive'
  );

  assert.equal(
    lifecycle
      .knownFindingState
      .entriesByFingerprint
      .get(
        pirateFingerprint
      )
      ?.occurrences[0]
      .verificationOutcome
      ?.status,
    'not-verified',
    'Reordered known outcome leaked into the new finding.'
  );

  assert.equal(
    getRawOutcomeStatus(
      lifecycle,
      pirateFingerprint,
      secondUrl
    ),
    'not-verified'
  );
  assert.equal(
    getRawOutcomeStatus(
      lifecycle,
      equadorFingerprint,
      secondUrl
    ),
    'inconclusive'
  );

  const finalFindings =
    getRunFindings(
      lifecycle
    );
  const finalEquador =
    finalFindings.find(
      finding =>
        finding.fingerprint ===
        equadorFingerprint
    );
  const finalPirate =
    finalFindings.find(
      finding =>
        finding.fingerprint ===
        pirateFingerprint
    );

  assert.deepEqual(
    finalEquador
      ?.occurrences
      .map(
        occurrence =>
          occurrence
            .occurrenceReference
      ),
    [
      'occurrence-1',
      'occurrence-3'
    ]
  );
  assert.deepEqual(
    finalPirate
      ?.occurrences
      .map(
        occurrence =>
          occurrence
            .occurrenceReference
      ),
    [
      'occurrence-2'
    ]
  );
  assert.deepEqual(
    finalEquador
      ?.occurrences
      .map(
        occurrence =>
          occurrence
            .redundantInvestigationSkipped
      ),
    [
      false,
      false
    ]
  );
}

function createMalformedInputFixture(): {
  lifecycle:
    RunFindingLifecycleState;
  page:
    ReconciledRunPageFindings;
  pageUrl:
    string;
} {
  const lifecycle =
    createRunFindingLifecycle();
  const pageUrl =
    'https://example.com/malformed';
  const page =
    reconcilePage(
      lifecycle,
      {
        pageUrl,
        pageTitle:
          'Malformed results',
        fixtures: [
          equadorSelect,
          pirateSelect
        ],
        findings: [
          createSelectFinding(
            equadorSelect,
            'Misspelled country option'
          ),
          createSelectFinding(
            pirateSelect,
            'Unexpected language option'
          )
        ]
      }
    );

  return {
    lifecycle,
    page,
    pageUrl
  };
}

function commitMalformed(
  fixture:
    ReturnType<
      typeof createMalformedInputFixture
    >,
  exploratoryFindingResults:
    PageFindingInvestigationResult[]
): void {
  commitRunPageFindings(
    fixture.lifecycle,
    {
      page:
        fixture.page,
      pageUrl:
        fixture.pageUrl,
      pageTitle:
        'Malformed results',
      pageNumber:
        1,
      screenshotPath:
        null,
      exploratoryFindingResults
    }
  );
}

function checkMalformedResultsFailClosed(): void {
  const missing =
    createMalformedInputFixture();

  assert.throws(
    () =>
      commitMalformed(
        missing,
        [
          createResult(
            missing.page,
            'candidate-1',
            createOutcome(
              'verified',
              'Only first result'
            )
          )
        ]
      ),
    /Missing investigation result for candidate "candidate-2"\./
  );
  assertNoCommittedState(
    missing.lifecycle
  );

  const duplicate =
    createMalformedInputFixture();
  const duplicateResult =
    createResult(
      duplicate.page,
      'candidate-1',
      createOutcome(
        'verified',
        'Duplicate result'
      )
    );

  assert.throws(
    () =>
      commitMalformed(
        duplicate,
        [
          duplicateResult,
          duplicateResult
        ]
      ),
    /Duplicate investigation result for candidate "candidate-1"\./
  );
  assertNoCommittedState(
    duplicate.lifecycle
  );

  const stale =
    createMalformedInputFixture();

  assert.throws(
    () =>
      commitMalformed(
        stale,
        [
          {
            ...createResult(
              stale.page,
              'candidate-1',
              createOutcome(
                'verified',
                'Stale result'
              )
            ),
            candidateReference:
              'candidate-999'
          }
        ]
      ),
    /Unexpected investigation result for candidate "candidate-999"\./
  );
  assertNoCommittedState(
    stale.lifecycle
  );

  const mismatched =
    createMalformedInputFixture();

  assert.throws(
    () =>
      commitMalformed(
        mismatched,
        [
          createResult(
            mismatched.page,
            'candidate-1',
            createOutcome(
              'verified',
              'Mismatched result'
            ),
            mismatched
              .page
              .pageCandidates[1]
              .finding
          ),
          createResult(
            mismatched.page,
            'candidate-2',
            createOutcome(
              'inconclusive',
              'Second result'
            )
          )
        ]
      ),
    /Investigation result for candidate "candidate-1" does not match its prepared finding identity\./
  );
  assertNoCommittedState(
    mismatched.lifecycle
  );
}

function checkAliasIntegrity(): void {
  const emptyTitleRule: PageFinding = {
    code:
      'EMPTY_PAGE_TITLE',
    severity:
      'medium',
    title:
      'Page has no browser title',
    evidence:
      'The document title was empty after navigation completed.',
    url:
      'https://example.com/aliases'
  };
  const noHeadingsRule: PageFinding = {
    code:
      'NO_PRIMARY_HEADINGS',
    severity:
      'low',
    title:
      'No H1 or H2 headings were found',
    evidence:
      'The page contained no visible text collected from H1 or H2 elements.',
    url:
      'https://example.com/aliases'
  };
  const emptyTitleModel =
    createTargetlessFinding(
      emptyTitleRule
    );
  const noHeadingsModel =
    createTargetlessFinding(
      noHeadingsRule
    );

  for (
    const modelOrder of
      [
        [
          emptyTitleModel,
          noHeadingsModel
        ],
        [
          noHeadingsModel,
          emptyTitleModel
        ]
      ]
  ) {
    const lifecycle =
      createRunFindingLifecycle();
    const page =
      reconcilePage(
        lifecycle,
        {
          pageUrl:
            'https://example.com/aliases',
          pageTitle:
            'Aliases',
          fixtures: [],
          findings:
            modelOrder,
          ruleFindings: [
            emptyTitleRule,
            noHeadingsRule
          ]
        }
      );

    assert.equal(
      lifecycle
        .unifiedFingerprintAliases
        .has(
          createExploratoryFindingFingerprint(
            emptyTitleModel
          )
        ),
      false,
      'Generated targetless prose is not retained as a substantive fingerprint alias.'
    );
    assert.deepEqual(
      new Set(
        page
          .unifiedFingerprintByCandidateReference
          .values()
      ),
      new Set([
        'rule|EMPTY_PAGE_TITLE',
        'rule|NO_PRIMARY_HEADINGS'
      ])
    );
  }
}

function checkRejectedStructuredIdentityCommit(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const pageUrl =
    'https://monday.com/w/enterprise';
  const finding:
    ExploratoryQaFinding = {
      knownFindingReference:
        null,
      category:
        'other',
      severity:
        'low',
      confidence:
        'medium',
      title:
        'Potential semantic control issue',
      evidence:
        'The model proposed an identity that is absent from current browser evidence.',
      reasoning:
        'The observation requires browser-grounded confirmation.',
      suggestedCheck:
        'Confirm the control identity before treating the observation as verified.',
      evidenceTarget:
        null,
      presentationTarget:
        null,
      structuredIdentity: {
        mechanism:
          'unexpected-value',
        observedValue:
          'Invented enterprise control',
        source:
          'accessible-name',
        subject: {
          kind:
            'semantic-control',
          controlType:
            'tab',
          controlId:
            'missing-enterprise-tab',
          componentId:
            'missing-enterprise-tab-list',
          locator:
            null
        }
      }
    };
  const page =
    reconcilePage(
      lifecycle,
      {
        pageUrl,
        pageTitle:
          'Enterprise',
        fixtures: [],
        findings: [
          finding
        ]
      }
    );
  const fingerprint =
    page
      .unifiedFingerprintByCandidateReference
      .get(
        'candidate-1'
      );

  assert.ok(
    fingerprint
  );
  assert.match(
    fingerprint,
    /^unstructured\|/
  );
  assert.notEqual(
    fingerprint,
    'unstructured|no stable identity',
    'Rejected structured identity must retain its observation-scoped canonical fingerprint.'
  );

  commitRunPageFindings(
    lifecycle,
    {
      page,
      pageUrl,
      pageTitle:
        'Enterprise',
      pageNumber:
        1,
      screenshotPath:
        null,
      exploratoryFindingResults: [
        createResult(
          page,
          'candidate-1',
          createOutcome(
            'inconclusive',
            'Rejected structured identity'
          )
        )
      ]
    }
  );

  assert.equal(
    getRawOutcomeStatus(
      lifecycle,
      fingerprint,
      pageUrl
    ),
    'inconclusive',
    'The canonical occurrence receives the investigation outcome without manufacturing verification.'
  );
}

function checkVerifiedKnownSuppression(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const finding =
    createSelectFinding(
      pirateSelect,
      'Pirate option is selectable'
    );
  const fingerprint =
    createExploratoryFindingFingerprint(
      finding
    );
  const firstUrl =
    'https://example.com/verified-first';
  const firstPage =
    reconcilePage(
      lifecycle,
      {
        pageUrl:
          firstUrl,
        pageTitle:
          'Verified first page',
        fixtures: [
          pirateSelect
        ],
        findings: [
          finding
        ]
      }
    );
  const rawOutcome =
    createOutcome(
      'verified',
      'Pirate trusted outcome'
    );

  /*
   * The run coordinator currently supplies contextual assessments only.
   * Seed the existing public registry components with an explicit trusted
   * assertion-specific assessment to exercise the canonical verified-known
   * suppression policy itself.
   */
  registerUnifiedPageFindings(
    lifecycle
      .unifiedFindingRegistry,
    firstPage
      .reconciledFindingObservations
      .findings
  );

  attachInvestigationOutcome(
    lifecycle
      .unifiedFindingRegistry,
    {
      fingerprint,
      pageUrl:
        firstUrl,
      target:
        finding.evidenceTarget,
      finding,
      outcome:
        rawOutcome,
      assessment: {
        relation:
          'supports',
        verificationCapable:
          true,
        summary:
          'Trusted assertion-specific evidence proves this exact finding.'
      },
      pageNumber:
        1,
      candidateReference:
        'candidate-1'
    }
  );

  registerNewFinding(
    lifecycle
      .knownFindingState,
    {
      finding,
      pageUrl:
        firstUrl,
      pageTitle:
        'Verified first page',
      screenshotPath:
        null,
      verificationOutcome:
        rawOutcome
    }
  );

  assert.equal(
    getRunFindings(
      lifecycle
    )[0]
      .verification.state,
    'verified'
  );

  const secondUrl =
    'https://example.com/verified-second';
  const secondPreparation =
    prepareKnownFindingAnalysis(
      lifecycle,
      createPageContent(
        'Verified second page',
        [
          pirateSelect
        ]
      )
    );

  assert.equal(
    secondPreparation
      .deterministicKnownOccurrenceDrafts[0]
      .redundantInvestigationSkipped,
    true
  );
  assert.equal(
    secondPreparation
      .deterministicKnownOccurrenceDrafts[0]
      .reinvestigationEligible,
    false
  );

  const secondPage =
    reconcileRunPageFindings(
      lifecycle,
      {
        pageUrl:
          secondUrl,
        pageTitle:
          'Verified second page',
        ruleFindings: [],
        rawExploratoryQaAnalysis:
          createAnalysis([]),
        knownFindingPreparation:
          secondPreparation
      }
    );

  assert.deepEqual(
    secondPage.pageCandidates,
    []
  );

  const knownOccurrences =
    commitRunPageFindings(
      lifecycle,
      {
        page:
          secondPage,
        pageUrl:
          secondUrl,
        pageTitle:
          'Verified second page',
        pageNumber:
          2,
        screenshotPath:
          null,
        exploratoryFindingResults:
          []
      }
    );

  assert.equal(
    knownOccurrences[0]
      .redundantInvestigationSkipped,
    true
  );
  assert.equal(
    knownOccurrences[0]
      .verificationOutcome,
    null
  );
  assert.deepEqual(
    getRunFindings(
      lifecycle
    )[0]
      .occurrences
      .map(
        occurrence => [
          occurrence
            .occurrenceReference,
          occurrence
            .redundantInvestigationSkipped
        ]
      ),
    [
      [
        'occurrence-1',
        false
      ],
      [
        'occurrence-2',
        true
      ]
    ]
  );
}

function main(): void {
  checkMultipleNewFindings();
  checkMixedReorderedResults();
  checkMalformedResultsFailClosed();
  checkAliasIntegrity();
  checkRejectedStructuredIdentityCommit();
  checkVerifiedKnownSuppression();

  console.log(
    'Run-level finding lifecycle reference-integrity checks passed.'
  );
}

main();
