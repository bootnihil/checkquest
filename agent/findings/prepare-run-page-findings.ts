import { admitAccessibilityFindings } from '../analysis/accessibility-finding-admission';
import type { ClassifiedDiagnostics } from '../analysis/classify-diagnostics';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';
import { normalizeTechnicalObservations } from '../analysis/technical-observation-reconciliation';
import type { PageFinding } from '../analysis/evaluate-page';
import type { ExtractedPageContent } from '../browser/extract-page-content';
import {
  buildKnownFindingPromptContext,
  detectStructuredKnownFindingOccurrences,
  reconcilePageFindings,
  type KnownFindingOccurrenceDraft,
  type KnownFindingPromptContext,
  type KnownFindingState,
  type ReconciledPageFindings
} from '../investigation/known-findings';
import {
  assignPageCandidateReferences,
  type PageCandidate,
  type PageCandidateReference
} from '../investigation/page-candidates';
import {
  reconcileFindingObservations,
  type ReconciledPageFindingObservations
} from './reconcile-finding-observations';

export interface KnownFindingAnalysisPreparation {
  deterministicKnownOccurrenceDrafts: KnownFindingOccurrenceDraft[];

  knownFindingContext: KnownFindingPromptContext[];
}

interface CandidateLifecycleInput {
  finding: ExploratoryQaFinding;

  knownFingerprint: string | null;

  unifiedFingerprint: string;
}

export interface PreparedRunPageFindings {
  exploratoryQaAnalysis: ExploratoryQaAnalysis;

  reconciledFindingObservations: ReconciledPageFindingObservations;

  reconciledPageFindings: ReconciledPageFindings;

  pageCandidates: PageCandidate[];

  knownFingerprintByCandidateReference: Map<PageCandidateReference, string>;

  unifiedFingerprintByCandidateReference: Map<PageCandidateReference, string>;
}

export interface PrepareRunPageFindingsInput {
  pageUrl: string;
  pageTitle: string;
  pageContent?: ExtractedPageContent;
  ruleFindings: PageFinding[];
  rawExploratoryQaAnalysis: ExploratoryQaAnalysis;
  classifiedDiagnostics?: ClassifiedDiagnostics;
  knownFindingPreparation: KnownFindingAnalysisPreparation;
}

function createModelFindingIdentity(finding: ExploratoryQaFinding): string {
  const { knownFindingReference: _knownFindingReference, ...identity } = finding;

  return JSON.stringify(identity);
}

function createCandidateFingerprintQueues(
  page: ReconciledPageFindingObservations
): Map<string, string[]> {
  const queues = new Map<string, string[]>();

  page.candidateFindings.forEach((finding, index) => {
    const fingerprint = page.candidateFingerprints[index];

    if (fingerprint === undefined) {
      throw new Error(
        `Reconciled candidate at index ${index} is missing its unified finding identity.`
      );
    }

    const identity = createModelFindingIdentity(finding);
    const queue = queues.get(identity) ?? [];

    queue.push(fingerprint);
    queues.set(identity, queue);
  });

  return queues;
}

function takeCandidateFingerprint(
  queues: Map<string, string[]>,
  finding: ExploratoryQaFinding
): string {
  const identity = createModelFindingIdentity(finding);
  const fingerprint = queues.get(identity)?.shift();

  if (fingerprint === undefined) {
    throw new Error('Reconciled candidate is missing its unified finding identity.');
  }

  return fingerprint;
}

export function prepareKnownFindingAnalysis(
  knownFindingState: KnownFindingState,
  pageContent: ExtractedPageContent
): KnownFindingAnalysisPreparation {
  const deterministicKnownOccurrenceDrafts = detectStructuredKnownFindingOccurrences(
    knownFindingState,
    pageContent
  );

  const knownFindingContext = buildKnownFindingPromptContext(
    knownFindingState,
    deterministicKnownOccurrenceDrafts.map(draft => draft.fingerprint)
  );

  return {
    deterministicKnownOccurrenceDrafts,
    knownFindingContext
  };
}

export function prepareRunPageFindings(
  knownFindingState: KnownFindingState,
  input: PrepareRunPageFindingsInput
): PreparedRunPageFindings {
  const normalizedExploratoryQaAnalysis =
    input.classifiedDiagnostics === undefined
      ? input.rawExploratoryQaAnalysis
      : normalizeTechnicalObservations(
          input.rawExploratoryQaAnalysis,
          input.classifiedDiagnostics,
          input.pageUrl
        );
  const admittedExploratoryQaAnalysis = admitAccessibilityFindings(
    normalizedExploratoryQaAnalysis,
    input.pageContent
  );
  const reconciledFindingObservations = reconcileFindingObservations({
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    ruleFindings: input.ruleFindings,
    modelFindings: admittedExploratoryQaAnalysis.findings,
    pageContent: input.pageContent
  });

  const reconciledPageFindings = reconcilePageFindings(
    knownFindingState,
    reconciledFindingObservations.candidateFindings,
    input.knownFindingPreparation.deterministicKnownOccurrenceDrafts
  );

  const exploratoryQaAnalysis = {
    ...admittedExploratoryQaAnalysis,

    /*
     * Keep page-local analysis findings limited to genuinely
     * new findings. Known occurrences are recorded separately.
     */
    findings: reconciledPageFindings.newFindings
  };

  const candidateFingerprintQueues = createCandidateFingerprintQueues(
    reconciledFindingObservations
  );

  const candidateInputs: CandidateLifecycleInput[] = [
    ...reconciledPageFindings.newFindings.map(finding => ({
      finding,
      knownFingerprint: null,
      unifiedFingerprint: takeCandidateFingerprint(candidateFingerprintQueues, finding)
    })),

    ...reconciledPageFindings.reinvestigationFindings.map(item => ({
      finding: item.finding,
      knownFingerprint: item.fingerprint,
      unifiedFingerprint: item.fingerprint
    }))
  ];

  const pageCandidates = assignPageCandidateReferences(candidateInputs.map(item => item.finding));

  const knownFingerprintByCandidateReference = new Map<PageCandidateReference, string>();

  const unifiedFingerprintByCandidateReference = new Map<PageCandidateReference, string>();

  /*
   * Preserve the existing candidate ordering contract:
   * new findings are assigned references first, followed by
   * reinvestigation candidates.
   */
  pageCandidates.forEach((candidate, index) => {
    unifiedFingerprintByCandidateReference.set(
      candidate.reference,
      candidateInputs[index].unifiedFingerprint
    );

    if (candidateInputs[index].knownFingerprint !== null) {
      knownFingerprintByCandidateReference.set(
        candidate.reference,
        candidateInputs[index].knownFingerprint
      );
    }
  });

  return {
    exploratoryQaAnalysis,
    reconciledFindingObservations,
    reconciledPageFindings,
    pageCandidates,
    knownFingerprintByCandidateReference,
    unifiedFingerprintByCandidateReference
  };
}
