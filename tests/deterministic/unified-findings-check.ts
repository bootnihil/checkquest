import assert from 'node:assert/strict';

import type { ExploratoryQaFinding } from '../../agent/analysis/exploratory-qa-schema';
import type { PageFinding } from '../../agent/analysis/evaluate-page';
import {
  adaptExploratoryFindingResult,
  adaptExploratoryQaFinding,
  adaptPageFinding,
  assessFindingInvestigationOutcome,
  pageFindingRuleEvidenceClassifications
} from '../../agent/findings/current-finding-adapters';
import {
  deriveLogicalFindingVerification,
  deriveOccurrenceVerification
} from '../../agent/findings/derive-verification-state';
import type {
  FindingEvidence,
  FindingEvidenceRelation,
  FindingEvidenceSource,
  FindingOccurrence
} from '../../agent/findings/finding-model';
import type { FindingInvestigationOutcome } from '../../agent/investigation/evaluate-finding-investigation-outcome';
import type { ExploratoryFindingResult } from '../../agent/inspection/inspected-page-result';

function createEvidence(
  id: string,
  input: {
    source?: FindingEvidenceSource;
    relation: FindingEvidenceRelation;
    verificationCapable: boolean;
  }
): FindingEvidence {
  return {
    evidenceReference: `evidence-${id}`,
    source: input.source ?? 'browser',
    kind: 'browser-observation',
    relation: input.relation,
    verificationCapable: input.verificationCapable,
    summary: `Synthetic ${input.relation} evidence.`
  };
}

function createOccurrence(
  number: number,
  evidence: FindingEvidence[],
  redundantInvestigationSkipped = false
): FindingOccurrence {
  return {
    occurrenceReference: `occurrence-${number}`,
    pageUrl: `https://example.com/page-${number}`,
    pageTitle: `Page ${number}`,
    target: null,
    evidence,
    verification: deriveOccurrenceVerification(evidence),
    screenshotReferences: [],
    redundantInvestigationSkipped
  };
}

function main(): void {
  const modelFinding: ExploratoryQaFinding = {
    category: 'content',
    severity: 'low',
    confidence: 'medium',
    title: 'Possible wording issue',
    evidence: 'Gemini observed possibly malformed wording.',
    reasoning: 'The wording may confuse a user.',
    suggestedCheck: 'Review the exact rendered wording.',
    evidenceTarget: null
  };

  const modelOnly = adaptExploratoryQaFinding(modelFinding, {
    findingReference: 'finding-1',
    fingerprint: 'fallback|content|possible wording issue',
    occurrenceReference: 'occurrence-1',
    pageUrl: 'https://example.com/model',
    pageTitle: 'Model observation'
  });

  assert.equal(modelOnly.occurrences[0].evidence[0].source, 'model');
  assert.equal(modelOnly.occurrences[0].verification.state, 'inconclusive');
  assert.equal(modelOnly.verification.state, 'inconclusive');

  const supporting = createOccurrence(2, [
    createEvidence('support', {
      relation: 'supports',
      verificationCapable: true
    })
  ]);

  assert.equal(supporting.verification.state, 'verified');

  const contradicting = createOccurrence(3, [
    createEvidence('contradiction', {
      relation: 'contradicts',
      verificationCapable: true
    })
  ]);

  assert.equal(contradicting.verification.state, 'not-verified');

  const conflicting = createOccurrence(4, [
    createEvidence('conflict-support', {
      relation: 'supports',
      verificationCapable: true
    }),
    createEvidence('conflict-contradiction', {
      relation: 'contradicts',
      verificationCapable: true
    })
  ]);

  assert.equal(conflicting.verification.state, 'inconclusive');
  assert.match(conflicting.verification.reason, /conflicting deterministic evidence/i);

  const nonVerifying = createOccurrence(5, [
    createEvidence('non-verifying', {
      relation: 'supports',
      verificationCapable: false
    })
  ]);

  assert.equal(nonVerifying.verification.state, 'inconclusive');

  assert.equal(deriveLogicalFindingVerification([nonVerifying, supporting]).state, 'verified');

  assert.equal(
    deriveLogicalFindingVerification([contradicting, nonVerifying]).state,
    'inconclusive'
  );

  const secondContradiction = createOccurrence(6, [
    createEvidence('second-contradiction', {
      relation: 'contradicts',
      verificationCapable: true
    })
  ]);

  assert.equal(
    deriveLogicalFindingVerification([contradicting, secondContradiction]).state,
    'not-verified'
  );

  const incorrectlyMarkedModelEvidence = createOccurrence(7, [
    createEvidence('model-cannot-verify', {
      source: 'model',
      relation: 'supports',
      verificationCapable: true
    })
  ]);

  assert.equal(
    incorrectlyMarkedModelEvidence.verification.state,
    'inconclusive',
    'Model evidence must never independently verify a finding.'
  );

  const emptyTitleFinding: PageFinding = {
    code: 'EMPTY_PAGE_TITLE',
    severity: 'medium',
    title: 'Page has no browser title',
    evidence: 'The document title was empty after navigation completed.',
    url: 'https://example.com/empty-title'
  };

  const adaptedEmptyTitle = adaptPageFinding(emptyTitleFinding, {
    findingReference: 'finding-2',
    fingerprint: 'rule|EMPTY_PAGE_TITLE',
    occurrenceReference: 'occurrence-8',
    pageTitle: ''
  });

  assert.equal(adaptedEmptyTitle.verification.state, 'verified');
  assert.equal(pageFindingRuleEvidenceClassifications.EMPTY_PAGE_TITLE.verificationCapable, true);

  const unknownStatusFinding: PageFinding = {
    code: 'HTTP_STATUS_UNKNOWN',
    severity: 'low',
    title: 'HTTP response status could not be determined',
    evidence: 'Playwright did not receive a main-document HTTP response status.',
    url: 'https://example.com/unknown-status'
  };

  const adaptedUnknownStatus = adaptPageFinding(unknownStatusFinding, {
    findingReference: 'finding-3',
    fingerprint: 'rule|HTTP_STATUS_UNKNOWN',
    occurrenceReference: 'occurrence-9',
    pageTitle: 'Unknown status'
  });

  assert.equal(adaptedUnknownStatus.verification.state, 'inconclusive');
  assert.equal(
    pageFindingRuleEvidenceClassifications.HTTP_STATUS_UNKNOWN.verificationCapable,
    false
  );

  const rawOutcome: FindingInvestigationOutcome = {
    status: 'verified',
    summary: 'The option can be selected.',
    evidence: ['Post-action browser evidence shows the option selected.']
  };

  const semanticSelectFinding: ExploratoryQaFinding = {
    ...modelFinding,
    title: 'Typographical error in country selection dropdown',
    evidence: 'The Country dropdown contains both Ecuador and Equador.',
    evidenceTarget: {
      kind: 'select-option',
      controlLabel: 'Country',
      controlName: 'country',
      controlId: 'country',
      optionText: 'Equador'
    }
  };

  const semanticSelectAssessment = assessFindingInvestigationOutcome(
    semanticSelectFinding,
    rawOutcome
  );

  assert.equal(semanticSelectAssessment.relation, 'inconclusive');
  assert.equal(semanticSelectAssessment.verificationCapable, false);
  assert.match(semanticSelectAssessment.summary, /no explicit trusted assessment/);

  const semanticSelectContradictionAssessment = assessFindingInvestigationOutcome(
    semanticSelectFinding,
    {
      status: 'not-verified',
      summary: 'The option did not remain selected.',
      evidence: ['Post-action evidence did not show the option selected.']
    }
  );

  assert.equal(semanticSelectContradictionAssessment.relation, 'inconclusive');
  assert.equal(semanticSelectContradictionAssessment.verificationCapable, false);

  const cannotSelectFinding: ExploratoryQaFinding = {
    ...semanticSelectFinding,
    title: 'The Equador option cannot be selected',
    reasoning: 'The specific option is asserted to reject selection.'
  };

  const cannotSelectResult = adaptExploratoryFindingResult(
    {
      candidateReference: 'candidate-2',
      finding: cannotSelectFinding,
      outcome: rawOutcome
    },
    {
      findingReference: 'finding-5',
      fingerprint: 'target|select-option|country|equador',
      occurrenceReference: 'occurrence-11',
      pageUrl: 'https://example.com/cannot-select',
      pageTitle: 'Cannot select',
      rawReference: {
        pageNumber: 1
      }
    },
    {
      relation: 'contradicts',
      verificationCapable: true,
      summary:
        'Exact post-action DOM evidence confirms the option became selected, contradicting the specific assertion that it cannot be selected.'
    }
  );

  assert.equal(cannotSelectResult.verification.state, 'not-verified');

  const selectableFinding: ExploratoryQaFinding = {
    ...semanticSelectFinding,
    title: 'The Equador option is selectable',
    reasoning: 'The specific option is asserted to accept selection.'
  };

  const selectableResult = adaptExploratoryFindingResult(
    {
      candidateReference: 'candidate-3',
      finding: selectableFinding,
      outcome: rawOutcome
    },
    {
      findingReference: 'finding-6',
      fingerprint: 'target|select-option|country|equador',
      occurrenceReference: 'occurrence-12',
      pageUrl: 'https://example.com/selectable',
      pageTitle: 'Selectable',
      rawReference: {
        pageNumber: 2
      }
    },
    {
      relation: 'supports',
      verificationCapable: true,
      summary:
        'Exact post-action DOM evidence confirms the option became selected, supporting the specific assertion that it is selectable.'
    }
  );

  assert.equal(selectableResult.verification.state, 'verified');

  const unsupportedSelectableAssessment = assessFindingInvestigationOutcome(
    selectableFinding,
    rawOutcome
  );

  assert.equal(unsupportedSelectableAssessment.relation, 'inconclusive');
  assert.equal(unsupportedSelectableAssessment.verificationCapable, false);

  const currentResult: ExploratoryFindingResult = {
    candidateReference: 'candidate-1',
    finding: semanticSelectFinding,
    outcome: rawOutcome
  };

  const adaptedInvestigation = adaptExploratoryFindingResult(
    currentResult,
    {
      findingReference: 'finding-4',
      fingerprint: 'fallback|content|possible wording issue',
      occurrenceReference: 'occurrence-10',
      pageUrl: 'https://example.com/investigation',
      pageTitle: 'Investigation result',
      rawReference: {
        pageNumber: 3
      }
    },
    semanticSelectAssessment
  );

  const investigationEvidence = adaptedInvestigation.occurrences[0].evidence.find(
    item => item.kind === 'investigation-outcome'
  );

  assert.equal(adaptedInvestigation.verification.state, 'inconclusive');
  assert.equal(
    investigationEvidence?.rawSource?.value,
    rawOutcome,
    'The exact raw Stage 4 outcome should be retained.'
  );

  const skippedOccurrence = createOccurrence(
    13,
    [
      createEvidence('skipped-observation', {
        relation: 'supports',
        verificationCapable: false
      })
    ],
    true
  );

  assert.equal(skippedOccurrence.verification.state, 'inconclusive');
  assert.equal(deriveLogicalFindingVerification([supporting, skippedOccurrence]).state, 'verified');

  console.log('Stage 5 unified finding foundation checks passed.');
}

main();
