import assert from 'node:assert/strict';

import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from '../../agent/analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../../agent/browser/extract-page-content';
import { commitRunPageFindings } from '../../agent/findings/commit-run-page-findings';
import {
  prepareKnownFindingAnalysis,
  prepareRunPageFindings
} from '../../agent/findings/prepare-run-page-findings';
import {
  createRunFindingLifecycle,
  getRunFindings
} from '../../agent/findings/run-finding-lifecycle';

function createEquadorFinding(controlId: string): ExploratoryQaFinding {
  return {
    knownFindingReference: null,
    category: 'content',
    severity: 'low',
    confidence: 'high',
    title: 'Misspelled country option',
    evidence: 'The country dropdown contains both Ecuador and Equador.',
    reasoning: 'Equador appears to be a misspelling of Ecuador.',
    suggestedCheck: 'Confirm whether the option can be selected.',
    evidenceTarget: {
      kind: 'select-option',
      controlLabel: 'Country',
      controlName: 'country',
      controlId,
      optionText: 'Equador'
    }
  };
}

function createPageContent(title: string, controlId: string): ExtractedPageContent {
  return {
    title,
    headings: [title],
    bodyText: 'Country Ecuador Equador',
    links: [],
    buttons: [],
    textFields: [],
    selects: [
      {
        label: 'Country',
        name: 'country',
        id: controlId,
        required: true,
        disabled: false,
        totalOptions: 2,
        optionsTruncated: false,
        options: [
          {
            text: 'Ecuador',
            value: 'Ecuador',
            selected: true
          },
          {
            text: 'Equador',
            value: 'Equador',
            selected: false
          }
        ]
      }
    ],
    disclosures: [],
    tabs: []
  };
}

function createAnalysis(findings: ExploratoryQaFinding[]): ExploratoryQaAnalysis {
  return {
    findings,
    summary: 'Synthetic run-level finding lifecycle check.'
  };
}

function getInvestigationStatus(
  evidence: ReturnType<typeof getRunFindings>[number]['occurrences'][number]['evidence']
): string | undefined {
  return evidence.find(item => item.kind === 'investigation-outcome')?.rawSource?.value !==
    undefined
    ? (
        evidence.find(item => item.kind === 'investigation-outcome')?.rawSource?.value as {
          status?: string;
        }
      ).status
    : undefined;
}

function main(): void {
  const lifecycle = createRunFindingLifecycle();

  const firstUrl = 'https://example.com/first';

  const firstFinding = createEquadorFinding('country-first');

  const firstPreparation = prepareKnownFindingAnalysis(
    lifecycle.knownFindingState,
    createPageContent('First page', 'country-first')
  );

  assert.deepEqual(firstPreparation.knownFindingContext, []);

  const firstPage = prepareRunPageFindings(lifecycle.knownFindingState, {
    pageUrl: firstUrl,
    pageTitle: 'First page',
    ruleFindings: [],
    rawExploratoryQaAnalysis: createAnalysis([firstFinding]),
    knownFindingPreparation: firstPreparation
  });

  assert.deepEqual(
    firstPage.pageCandidates.map(candidate => candidate.reference),
    ['candidate-1']
  );

  assert.equal(
    firstPage.unifiedFingerprintByCandidateReference.get('candidate-1'),
    'target|select-option|country|equador'
  );

  commitRunPageFindings(lifecycle, {
    page: firstPage,
    pageUrl: firstUrl,
    pageTitle: 'First page',
    pageNumber: 1,
    screenshotPath: 'page-01.png',
    exploratoryFindingResults: [
      {
        candidateReference: 'candidate-1',
        finding: firstFinding,
        outcome: {
          status: 'verified',
          summary: 'Equador could be selected.',
          evidence: ['The selected option was Equador.']
        }
      }
    ]
  });

  const afterFirstPage = getRunFindings(lifecycle);

  assert.equal(afterFirstPage.length, 1);

  assert.equal(afterFirstPage[0].verification.state, 'inconclusive');

  assert.equal(afterFirstPage[0].occurrences[0].verification.state, 'inconclusive');

  assert.equal(getInvestigationStatus(afterFirstPage[0].occurrences[0].evidence), 'verified');

  const secondUrl = 'https://example.com/second';

  const secondPreparation = prepareKnownFindingAnalysis(
    lifecycle.knownFindingState,
    createPageContent('Second page', 'country-second')
  );

  assert.equal(secondPreparation.knownFindingContext[0].knownFindingReference, 'known-1');

  assert.equal(secondPreparation.knownFindingContext[0].verificationStatus, 'inconclusive');

  assert.equal(
    secondPreparation.deterministicKnownOccurrenceDrafts[0].redundantInvestigationSkipped,
    false
  );

  const secondPage = prepareRunPageFindings(lifecycle.knownFindingState, {
    pageUrl: secondUrl,
    pageTitle: 'Second page',
    ruleFindings: [],
    rawExploratoryQaAnalysis: createAnalysis([]),
    knownFindingPreparation: secondPreparation
  });

  assert.deepEqual(
    secondPage.pageCandidates.map(candidate => candidate.reference),
    ['candidate-1']
  );

  assert.equal(
    secondPage.knownFingerprintByCandidateReference.get('candidate-1'),
    'target|select-option|country|equador'
  );

  const secondOccurrences = commitRunPageFindings(lifecycle, {
    page: secondPage,
    pageUrl: secondUrl,
    pageTitle: 'Second page',
    pageNumber: 2,
    screenshotPath: 'page-02.png',
    exploratoryFindingResults: [
      {
        candidateReference: 'candidate-1',
        finding: secondPage.pageCandidates[0].finding,
        outcome: {
          status: 'inconclusive',
          summary: 'No conclusive semantic evidence was collected.',
          evidence: []
        }
      }
    ]
  });

  assert.equal(secondOccurrences[0].knownFindingReference, 'known-1');

  assert.equal(secondOccurrences[0].verificationOutcome?.status, 'inconclusive');

  const finalFindings = getRunFindings(lifecycle);

  assert.equal(finalFindings.length, 1);

  assert.equal(finalFindings[0].fingerprint, 'target|select-option|country|equador');

  assert.deepEqual(
    finalFindings[0].occurrences.map(occurrence => occurrence.occurrenceReference),
    ['occurrence-1', 'occurrence-2']
  );

  assert.deepEqual(
    finalFindings[0].occurrences.map(occurrence => occurrence.redundantInvestigationSkipped),
    [false, false]
  );

  assert.equal(finalFindings[0].verification.state, 'inconclusive');

  console.log('Run-level finding lifecycle check passed.');
}

main();
