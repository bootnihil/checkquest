import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';
import { admitAccessibilityFindings } from '../analysis/accessibility-finding-admission';
import type { ClassifiedDiagnostics } from '../analysis/classify-diagnostics';
import { normalizeTechnicalObservations } from '../analysis/technical-observation-reconciliation';
import type { PageFinding } from '../analysis/evaluate-page';
import type { ExtractedPageContent } from '../browser/extract-page-content';
import { createExploratoryFindingFingerprint } from '../investigation/finding-fingerprint';
import type { FindingInvestigationOutcome } from '../investigation/evaluate-finding-investigation-outcome';
import {
  buildKnownFindingPromptContext,
  createKnownFindingState,
  detectStructuredKnownFindingOccurrences,
  reconcilePageFindings,
  registerKnownFindingOccurrence,
  registerNewFinding,
  type KnownFindingOccurrence,
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
  attachInvestigationOutcome,
  createUnifiedOccurrenceKey,
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  getUnifiedFindingVerificationState,
  markOccurrenceSuppressed,
  registerCompatibilityOccurrence,
  registerUnifiedPageFindings,
  unifiedOccurrenceKeysEqual,
  type RegisterCompatibilityOccurrenceInput,
  type UnifiedOccurrenceKey,
  type UnifiedFindingRegistry
} from './unified-finding-registry';
import {
  reconcileFindingObservations,
  type ReconciledPageFindingObservations
} from './reconcile-finding-observations';
import type { UnifiedFinding } from './finding-model';
import { applyRunTechnicalObservationPolicy } from './technical-observation-policy';

export interface RunFindingLifecycleState {
  unifiedFindingRegistry: UnifiedFindingRegistry;

  knownFindingState: KnownFindingState;
}

export interface KnownFindingAnalysisPreparation {
  deterministicKnownOccurrenceDrafts: KnownFindingOccurrenceDraft[];

  knownFindingContext: KnownFindingPromptContext[];
}

interface CandidateLifecycleInput {
  finding: ExploratoryQaFinding;

  knownFingerprint: string | null;

  unifiedFingerprint: string;
}

export interface ReconciledRunPageFindings {
  exploratoryQaAnalysis: ExploratoryQaAnalysis;

  reconciledFindingObservations: ReconciledPageFindingObservations;

  reconciledPageFindings: ReconciledPageFindings;

  pageCandidates: PageCandidate[];

  knownFingerprintByCandidateReference: Map<PageCandidateReference, string>;

  unifiedFingerprintByCandidateReference: Map<PageCandidateReference, string>;
}

export interface ReconcileRunPageFindingsInput {
  pageUrl: string;
  pageTitle: string;
  pageContent?: ExtractedPageContent;
  ruleFindings: PageFinding[];
  rawExploratoryQaAnalysis: ExploratoryQaAnalysis;
  classifiedDiagnostics?: ClassifiedDiagnostics;
  knownFindingPreparation: KnownFindingAnalysisPreparation;
}

export interface PageFindingInvestigationResult {
  candidateReference: PageCandidateReference;

  finding: ExploratoryQaFinding;

  outcome: FindingInvestigationOutcome;
}

export interface CommitRunPageFindingsInput {
  page: ReconciledRunPageFindings;

  pageUrl: string;
  pageTitle: string;
  pageNumber: number;

  screenshotPath: string | null;

  exploratoryFindingResults: PageFindingInvestigationResult[];
}

function validateInvestigationResults(
  input: CommitRunPageFindingsInput
): Map<PageCandidateReference, PageFindingInvestigationResult> {
  const candidateByReference = new Map<PageCandidateReference, PageCandidate>();

  for (const candidate of input.page.pageCandidates) {
    if (candidateByReference.has(candidate.reference)) {
      throw new Error(
        `Prepared lifecycle contains duplicate candidate reference "${candidate.reference}".`
      );
    }

    candidateByReference.set(candidate.reference, candidate);

    if (!input.page.unifiedFingerprintByCandidateReference.has(candidate.reference)) {
      throw new Error(
        `Candidate "${candidate.reference}" is missing its unified finding identity.`
      );
    }
  }

  const newFindingCandidateCount = input.page.pageCandidates.filter(
    candidate => !input.page.knownFingerprintByCandidateReference.has(candidate.reference)
  ).length;

  if (newFindingCandidateCount !== input.page.reconciledPageFindings.newFindings.length) {
    throw new Error(
      'Prepared lifecycle candidate identities do not match the new-finding collection.'
    );
  }

  const resultByCandidateReference = new Map<
    PageCandidateReference,
    PageFindingInvestigationResult
  >();

  for (const result of input.exploratoryFindingResults) {
    if (resultByCandidateReference.has(result.candidateReference)) {
      throw new Error(
        `Duplicate investigation result for candidate "${result.candidateReference}".`
      );
    }

    const candidate = candidateByReference.get(result.candidateReference);

    if (candidate === undefined) {
      throw new Error(
        `Unexpected investigation result for candidate "${result.candidateReference}".`
      );
    }

    if (
      createExploratoryFindingFingerprint(result.finding) !==
      createExploratoryFindingFingerprint(candidate.finding)
    ) {
      throw new Error(
        `Investigation result for candidate "${result.candidateReference}" does not match its prepared finding identity.`
      );
    }

    resultByCandidateReference.set(result.candidateReference, result);
  }

  for (const candidate of input.page.pageCandidates) {
    if (!resultByCandidateReference.has(candidate.reference)) {
      throw new Error(`Missing investigation result for candidate "${candidate.reference}".`);
    }
  }

  return resultByCandidateReference;
}

interface ValidatedInvestigationAttachment {
  readonly candidate: PageCandidate;
  readonly result: PageFindingInvestigationResult;
  readonly occurrenceKey: UnifiedOccurrenceKey;
}

interface ValidatedCompatibilityOccurrence {
  readonly registration: Readonly<RegisterCompatibilityOccurrenceInput>;
  readonly occurrenceKey: UnifiedOccurrenceKey;
}

interface ValidatedOccurrenceSuppression {
  readonly occurrenceKey: UnifiedOccurrenceKey;
}

interface ValidatedCommitAssociations {
  readonly investigationAttachments: readonly ValidatedInvestigationAttachment[];
  readonly compatibilityOccurrences: readonly ValidatedCompatibilityOccurrence[];
  readonly suppressions: readonly ValidatedOccurrenceSuppression[];
}

function occurrenceKeyIdentity(key: UnifiedOccurrenceKey): string {
  return JSON.stringify(key);
}

function validateCommitAssociations(
  state: RunFindingLifecycleState,
  input: CommitRunPageFindingsInput,
  findingResultByCandidateReference: ReadonlyMap<
    PageCandidateReference,
    PageFindingInvestigationResult
  >
): ValidatedCommitAssociations {
  /*
   * Match prepared keys only. Registration remains authoritative for whether
   * each valid key creates or merges an occurrence.
   */
  const preparedOccurrenceKeys = new Map<string, UnifiedOccurrenceKey>();
  const preparedFindingFingerprints = new Set<string>();

  for (const finding of input.page.reconciledFindingObservations.findings) {
    preparedFindingFingerprints.add(finding.fingerprint);

    for (const occurrence of finding.occurrences) {
      const occurrenceKey = createUnifiedOccurrenceKey({
        fingerprint: finding.fingerprint,
        pageUrl: occurrence.pageUrl,
        target: occurrence.target
      });
      const identity = occurrenceKeyIdentity(occurrenceKey);

      if (preparedOccurrenceKeys.has(identity)) {
        throw new Error(`Prepared canonical occurrence association is duplicated: ${identity}.`);
      }

      preparedOccurrenceKeys.set(identity, occurrenceKey);
    }
  }

  const compatibilityOccurrenceKeys = new Set<string>();
  const compatibilityOccurrences: ValidatedCompatibilityOccurrence[] = [];

  for (const draft of input.page.reconciledPageFindings.knownOccurrenceDrafts) {
    if (!draft.matchingBases.includes('structured-target')) {
      continue;
    }

    const canonicalFinding = state.unifiedFindingRegistry.findingsByFingerprint.get(
      draft.fingerprint
    );
    const knownFinding = state.knownFindingState.entriesByFingerprint.get(draft.fingerprint);

    if (
      canonicalFinding === undefined ||
      knownFinding === undefined ||
      knownFinding.knownFindingReference !== draft.knownFindingReference
    ) {
      throw new Error(
        `Compatibility occurrence for "${draft.fingerprint}" has no prepared canonical target.`
      );
    }

    const occurrenceKey = createUnifiedOccurrenceKey({
      fingerprint: draft.fingerprint,
      pageUrl: input.pageUrl,
      target: draft.evidenceTarget
    });
    const findingOccurrenceKey = createUnifiedOccurrenceKey({
      fingerprint: draft.fingerprint,
      pageUrl: input.pageUrl,
      target: draft.finding.evidenceTarget
    });

    if (
      createExploratoryFindingFingerprint(draft.finding) !== draft.fingerprint ||
      !unifiedOccurrenceKeysEqual(occurrenceKey, findingOccurrenceKey)
    ) {
      throw new Error(
        `Compatibility occurrence for "${draft.fingerprint}" conflicts with its prepared canonical target.`
      );
    }

    const identity = occurrenceKeyIdentity(occurrenceKey);

    if (compatibilityOccurrenceKeys.has(identity)) {
      throw new Error(`Compatibility occurrence association is duplicated: ${identity}.`);
    }

    compatibilityOccurrenceKeys.add(identity);
    preparedOccurrenceKeys.set(identity, occurrenceKey);
    preparedFindingFingerprints.add(draft.fingerprint);

    compatibilityOccurrences.push(
      Object.freeze({
        registration: Object.freeze({
          fingerprint: draft.fingerprint,
          finding: draft.finding,
          pageUrl: input.pageUrl,
          pageTitle: input.pageTitle,
          target: draft.evidenceTarget,
          evidenceSummaries: draft.occurrenceEvidence,
          screenshotPath: input.screenshotPath,
          redundantInvestigationSkipped: draft.redundantInvestigationSkipped
        }),
        occurrenceKey
      })
    );
  }

  const suppressionKeys = new Set<string>();
  const suppressions: ValidatedOccurrenceSuppression[] = [];

  for (const draft of input.page.reconciledPageFindings.knownOccurrenceDrafts) {
    if (!draft.redundantInvestigationSkipped) {
      continue;
    }

    const occurrenceKey = createUnifiedOccurrenceKey({
      fingerprint: draft.fingerprint,
      pageUrl: input.pageUrl,
      target: draft.evidenceTarget
    });
    const identity = occurrenceKeyIdentity(occurrenceKey);

    if (!preparedOccurrenceKeys.has(identity)) {
      throw new Error(`Suppression target has no prepared canonical occurrence: ${identity}.`);
    }

    if (suppressionKeys.has(identity)) {
      throw new Error(`Suppression target association is duplicated: ${identity}.`);
    }

    suppressionKeys.add(identity);
    suppressions.push(Object.freeze({ occurrenceKey }));
  }

  const investigationKeys = new Set<string>();
  const investigationAttachments: ValidatedInvestigationAttachment[] = [];

  for (const candidate of input.page.pageCandidates) {
    const result = findingResultByCandidateReference.get(candidate.reference);
    const unifiedFingerprint = input.page.unifiedFingerprintByCandidateReference.get(
      candidate.reference
    );

    if (result === undefined || unifiedFingerprint === undefined) {
      throw new Error(`Candidate "${candidate.reference}" has no validated investigation result.`);
    }

    const occurrenceKey = createUnifiedOccurrenceKey({
      fingerprint: unifiedFingerprint,
      pageUrl: input.pageUrl,
      target: candidate.finding.evidenceTarget
    });
    const identity = occurrenceKeyIdentity(occurrenceKey);

    if (!preparedFindingFingerprints.has(unifiedFingerprint)) {
      throw new Error(
        `Candidate "${candidate.reference}" maps to unprepared canonical finding "${unifiedFingerprint}".`
      );
    }

    if (!preparedOccurrenceKeys.has(identity)) {
      throw new Error(
        `Candidate "${candidate.reference}" has no prepared canonical occurrence: ${identity}.`
      );
    }

    if (investigationKeys.has(identity)) {
      throw new Error(`Investigation attachment association is duplicated: ${identity}.`);
    }

    investigationKeys.add(identity);
    investigationAttachments.push(Object.freeze({ candidate, result, occurrenceKey }));
  }

  return Object.freeze({
    investigationAttachments: Object.freeze(investigationAttachments),
    compatibilityOccurrences: Object.freeze(compatibilityOccurrences),
    suppressions: Object.freeze(suppressions)
  });
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

export function createRunFindingLifecycle(): RunFindingLifecycleState {
  const unifiedFindingRegistry = createUnifiedFindingRegistry();

  const knownFindingState = createKnownFindingState(fingerprint =>
    getUnifiedFindingVerificationState(unifiedFindingRegistry, fingerprint)
  );

  return {
    unifiedFindingRegistry,
    knownFindingState
  };
}

export function prepareKnownFindingAnalysis(
  state: RunFindingLifecycleState,
  pageContent: ExtractedPageContent
): KnownFindingAnalysisPreparation {
  const deterministicKnownOccurrenceDrafts = detectStructuredKnownFindingOccurrences(
    state.knownFindingState,
    pageContent
  );

  const knownFindingContext = buildKnownFindingPromptContext(
    state.knownFindingState,
    deterministicKnownOccurrenceDrafts.map(draft => draft.fingerprint)
  );

  return {
    deterministicKnownOccurrenceDrafts,
    knownFindingContext
  };
}

export function reconcileRunPageFindings(
  state: RunFindingLifecycleState,
  input: ReconcileRunPageFindingsInput
): ReconciledRunPageFindings {
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
    state.knownFindingState,
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

export function commitRunPageFindings(
  state: RunFindingLifecycleState,
  input: CommitRunPageFindingsInput
): KnownFindingOccurrence[] {
  /*
   * Validate the complete result and association contracts before either
   * registry is mutated. Malformed prepared input must fail without residue.
   */
  const findingResultByCandidateReference = validateInvestigationResults(input);
  const validatedAssociations = validateCommitAssociations(
    state,
    input,
    findingResultByCandidateReference
  );

  registerUnifiedPageFindings(
    state.unifiedFindingRegistry,
    input.page.reconciledFindingObservations.findings,
    input.screenshotPath
  );

  for (const association of validatedAssociations.compatibilityOccurrences) {
    registerCompatibilityOccurrence(
      state.unifiedFindingRegistry,
      association.registration,
      association.occurrenceKey
    );
  }

  for (const association of validatedAssociations.suppressions) {
    if (!markOccurrenceSuppressed(state.unifiedFindingRegistry, association.occurrenceKey)) {
      throw new Error(
        `Validated suppression target was not registered: ${occurrenceKeyIdentity(association.occurrenceKey)}.`
      );
    }
  }

  for (const association of validatedAssociations.investigationAttachments) {
    attachInvestigationOutcome(
      state.unifiedFindingRegistry,
      {
        fingerprint: association.occurrenceKey.fingerprint,
        pageUrl: association.occurrenceKey.pageUrl,
        target: association.candidate.finding.evidenceTarget,
        finding: association.candidate.finding,
        outcome: association.result.outcome,
        candidateReference: association.candidate.reference,
        pageNumber: input.pageNumber
      },
      association.occurrenceKey
    );
  }

  const knownFindingOccurrences = input.page.reconciledPageFindings.knownOccurrenceDrafts.map(
    draft => {
      const reinvestigationCandidateReference = Array.from(
        input.page.knownFingerprintByCandidateReference.entries()
      ).find(([, fingerprint]) => fingerprint === draft.fingerprint)?.[0];

      const verificationOutcome =
        reinvestigationCandidateReference === undefined
          ? null
          : (findingResultByCandidateReference.get(reinvestigationCandidateReference)?.outcome ??
            null);

      return registerKnownFindingOccurrence(state.knownFindingState, {
        fingerprint: draft.fingerprint,
        finding: draft.finding,
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle,
        screenshotPath: input.screenshotPath,
        occurrenceEvidence: draft.occurrenceEvidence,
        evidenceTarget: draft.evidenceTarget,
        matchingBases: draft.matchingBases,
        modelKnownFindingReference: draft.modelKnownFindingReference,
        modelReferenceMatched: draft.modelReferenceMatched,
        redundantInvestigationSkipped: draft.redundantInvestigationSkipped,
        verificationOutcome
      });
    }
  );

  const newFindingCandidates = input.page.pageCandidates.filter(
    candidate => !input.page.knownFingerprintByCandidateReference.has(candidate.reference)
  );

  for (const candidate of newFindingCandidates) {
    const association = validatedAssociations.investigationAttachments.find(
      item => item.candidate.reference === candidate.reference
    );

    if (association === undefined) {
      throw new Error(
        `Validated new-finding association is missing for candidate "${candidate.reference}".`
      );
    }

    registerNewFinding(state.knownFindingState, {
      finding: candidate.finding,
      fingerprint: association.occurrenceKey.fingerprint,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      screenshotPath: input.screenshotPath,
      verificationOutcome: association.result.outcome
    });
  }

  return knownFindingOccurrences;
}

export function getRunFindings(state: RunFindingLifecycleState): UnifiedFinding[] {
  return applyRunTechnicalObservationPolicy(getUnifiedFindings(state.unifiedFindingRegistry));
}
