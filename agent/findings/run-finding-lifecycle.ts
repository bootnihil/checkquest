import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';
import type {
  PageFinding
} from '../analysis/evaluate-page';
import type {
  ExtractedPageContent
} from '../browser/extract-page-content';
import {
  createExploratoryFindingFingerprint
} from '../investigation/finding-fingerprint';
import type {
  FindingInvestigationOutcome
} from '../investigation/evaluate-finding-investigation-outcome';
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
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  getUnifiedFindingVerificationState,
  markOccurrenceSuppressed,
  registerCompatibilityOccurrence,
  registerUnifiedPageFindings,
  type UnifiedFindingRegistry
} from './unified-finding-registry';
import {
  reconcileFindingObservations,
  type ReconciledPageFindingObservations
} from './reconcile-finding-observations';
import type {
  UnifiedFinding
} from './finding-model';

export interface RunFindingLifecycleState {
  unifiedFindingRegistry:
    UnifiedFindingRegistry;

  knownFindingState:
    KnownFindingState;

  unifiedFingerprintAliases:
    Map<string, string>;
}

export interface KnownFindingAnalysisPreparation {
  deterministicKnownOccurrenceDrafts:
    KnownFindingOccurrenceDraft[];

  knownFindingContext:
    KnownFindingPromptContext[];
}

interface CandidateLifecycleInput {
  finding:
    ExploratoryQaFinding;

  knownFingerprint:
    string | null;

  unifiedFingerprint:
    string;
}

export interface ReconciledRunPageFindings {
  exploratoryQaAnalysis:
    ExploratoryQaAnalysis;

  reconciledFindingObservations:
    ReconciledPageFindingObservations;

  reconciledPageFindings:
    ReconciledPageFindings;

  pageCandidates:
    PageCandidate[];

  knownFingerprintByCandidateReference:
    Map<
      PageCandidateReference,
      string
    >;

  unifiedFingerprintByCandidateReference:
    Map<
      PageCandidateReference,
      string
    >;
}

export interface ReconcileRunPageFindingsInput {
  pageUrl: string;
  pageTitle: string;
  pageContent?:
    ExtractedPageContent;
  ruleFindings:
    PageFinding[];
  rawExploratoryQaAnalysis:
    ExploratoryQaAnalysis;
  knownFindingPreparation:
    KnownFindingAnalysisPreparation;
}

export interface PageFindingInvestigationResult {
  candidateReference:
    PageCandidateReference;

  finding:
    ExploratoryQaFinding;

  outcome:
    FindingInvestigationOutcome;
}

export interface CommitRunPageFindingsInput {
  page:
    ReconciledRunPageFindings;

  pageUrl: string;
  pageTitle: string;

  screenshotPath:
    string | null;

  exploratoryFindingResults:
    PageFindingInvestigationResult[];
}

function validateInvestigationResults(
  input:
    CommitRunPageFindingsInput
): Map<
  PageCandidateReference,
  PageFindingInvestigationResult
> {
  const candidateByReference =
    new Map<
      PageCandidateReference,
      PageCandidate
    >();

  for (
    const candidate of
      input.page.pageCandidates
  ) {
    if (
      candidateByReference.has(
        candidate.reference
      )
    ) {
      throw new Error(
        `Prepared lifecycle contains duplicate candidate reference "${candidate.reference}".`
      );
    }

    candidateByReference.set(
      candidate.reference,
      candidate
    );

    if (
      !input
        .page
        .unifiedFingerprintByCandidateReference
        .has(
          candidate.reference
        )
    ) {
      throw new Error(
        `Candidate "${candidate.reference}" is missing its unified finding identity.`
      );
    }
  }

  const newFindingCandidateCount =
    input
      .page
      .pageCandidates
      .filter(
        candidate =>
          !input
            .page
            .knownFingerprintByCandidateReference
            .has(
              candidate.reference
            )
      )
      .length;

  if (
    newFindingCandidateCount !==
    input
      .page
      .reconciledPageFindings
      .newFindings
      .length
  ) {
    throw new Error(
      'Prepared lifecycle candidate identities do not match the new-finding collection.'
    );
  }

  const resultByCandidateReference =
    new Map<
      PageCandidateReference,
      PageFindingInvestigationResult
    >();

  for (
    const result of
      input.exploratoryFindingResults
  ) {
    if (
      resultByCandidateReference.has(
        result.candidateReference
      )
    ) {
      throw new Error(
        `Duplicate investigation result for candidate "${result.candidateReference}".`
      );
    }

    const candidate =
      candidateByReference.get(
        result.candidateReference
      );

    if (
      candidate ===
      undefined
    ) {
      throw new Error(
        `Unexpected investigation result for candidate "${result.candidateReference}".`
      );
    }

    if (
      createExploratoryFindingFingerprint(
        result.finding
      ) !==
      createExploratoryFindingFingerprint(
        candidate.finding
      )
    ) {
      throw new Error(
        `Investigation result for candidate "${result.candidateReference}" does not match its prepared finding identity.`
      );
    }

    resultByCandidateReference.set(
      result.candidateReference,
      result
    );
  }

  for (
    const candidate of
      input.page.pageCandidates
  ) {
    if (
      !resultByCandidateReference.has(
        candidate.reference
      )
    ) {
      throw new Error(
        `Missing investigation result for candidate "${candidate.reference}".`
      );
    }
  }

  return resultByCandidateReference;
}

function createModelFindingIdentity(
  finding:
    ExploratoryQaFinding
): string {
  return JSON.stringify(
    finding
  );
}

export function createRunFindingLifecycle():
  RunFindingLifecycleState {
  const unifiedFindingRegistry =
    createUnifiedFindingRegistry();

  const unifiedFingerprintAliases =
    new Map<string, string>();

  const knownFindingState =
    createKnownFindingState(
      fingerprint =>
        getUnifiedFindingVerificationState(
          unifiedFindingRegistry,
          unifiedFingerprintAliases
            .get(
              fingerprint
            ) ??
          fingerprint
        )
    );

  return {
    unifiedFindingRegistry,
    knownFindingState,
    unifiedFingerprintAliases
  };
}

export function prepareKnownFindingAnalysis(
  state:
    RunFindingLifecycleState,
  pageContent:
    ExtractedPageContent
): KnownFindingAnalysisPreparation {
  const deterministicKnownOccurrenceDrafts =
    detectStructuredKnownFindingOccurrences(
      state.knownFindingState,
      pageContent
    );

  const knownFindingContext =
    buildKnownFindingPromptContext(
      state.knownFindingState,
      deterministicKnownOccurrenceDrafts.map(
        draft =>
          draft.fingerprint
      )
    );

  return {
    deterministicKnownOccurrenceDrafts,
    knownFindingContext
  };
}

export function reconcileRunPageFindings(
  state:
    RunFindingLifecycleState,
  input:
    ReconcileRunPageFindingsInput
): ReconciledRunPageFindings {
  const reconciledFindingObservations =
    reconcileFindingObservations({
      pageUrl:
        input.pageUrl,
      pageTitle:
        input.pageTitle,
      ruleFindings:
        input.ruleFindings,
      modelFindings:
        input
          .rawExploratoryQaAnalysis
          .findings,
      pageContent:
        input.pageContent
    });

  const reconciledPageFindings =
    reconcilePageFindings(
      state.knownFindingState,
      reconciledFindingObservations
        .candidateFindings,
      input
        .knownFindingPreparation
        .deterministicKnownOccurrenceDrafts
    );

  const exploratoryQaAnalysis = {
    ...input.rawExploratoryQaAnalysis,

    /*
     * Keep page-local analysis findings limited to genuinely
     * new findings. Known occurrences are recorded separately.
     */
    findings:
      reconciledPageFindings
        .newFindings
  };

  const unifiedFingerprintByModelIdentity =
    new Map<string, string>();

  input
    .rawExploratoryQaAnalysis
    .findings
    .forEach(
      (
        finding,
        index
      ) => {
        const reconciliation =
          reconciledFindingObservations
            .modelReconciliations[
              index
            ];

        if (
          reconciliation ===
          undefined
        ) {
          return;
        }

        unifiedFingerprintByModelIdentity
          .set(
            createModelFindingIdentity(
              finding
            ),
            reconciliation
              .fingerprint
          );

        const modelFingerprint =
          createExploratoryFindingFingerprint(
            finding
          );

        if (
          !modelFingerprint.startsWith(
            'unstructured|'
          )
        ) {
          state
            .unifiedFingerprintAliases
            .set(
              modelFingerprint,
              reconciliation
                .fingerprint
            );
        }
      }
    );

  const candidateInputs:
    CandidateLifecycleInput[] = [
      ...reconciledPageFindings
        .newFindings
        .map(
          finding => ({
            finding,
            knownFingerprint:
              null,
            unifiedFingerprint:
              unifiedFingerprintByModelIdentity
                .get(
                  createModelFindingIdentity(
                    finding
                  )
                ) ??
              createExploratoryFindingFingerprint(
                finding
              )
          })
        ),

      ...reconciledPageFindings
        .reinvestigationFindings
        .map(
          item => ({
            finding:
              item.finding,
            knownFingerprint:
              item.fingerprint,
            unifiedFingerprint:
              item.fingerprint
          })
        )
    ];

  const pageCandidates =
    assignPageCandidateReferences(
      candidateInputs.map(
        item =>
          item.finding
      )
    );

  const knownFingerprintByCandidateReference =
    new Map<
      PageCandidateReference,
      string
    >();

  const unifiedFingerprintByCandidateReference =
    new Map<
      PageCandidateReference,
      string
    >();

  /*
   * Preserve the existing candidate ordering contract:
   * new findings are assigned references first, followed by
   * reinvestigation candidates.
   */
  pageCandidates.forEach(
    (
      candidate,
      index
    ) => {
      unifiedFingerprintByCandidateReference
        .set(
          candidate.reference,
          candidateInputs[
            index
          ]
            .unifiedFingerprint
        );

      if (
        candidateInputs[
          index
        ]
          .knownFingerprint !==
        null
      ) {
        knownFingerprintByCandidateReference
          .set(
            candidate.reference,
            candidateInputs[
              index
            ]
              .knownFingerprint
          );
      }
    }
  );

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
  state:
    RunFindingLifecycleState,
  input:
    CommitRunPageFindingsInput
): KnownFindingOccurrence[] {
  /*
   * Validate the complete candidate/result contract before either registry
   * is mutated. A malformed result collection must fail closed without
   * leaving partial canonical or compatibility state behind.
   */
  const findingResultByCandidateReference =
    validateInvestigationResults(
      input
    );

  registerUnifiedPageFindings(
    state.unifiedFindingRegistry,
    input
      .page
      .reconciledFindingObservations
      .findings,
    input.screenshotPath
  );

  for (
    const draft of
      input
        .page
        .reconciledPageFindings
        .knownOccurrenceDrafts
  ) {
    if (
      draft.matchingBases
        .includes(
          'structured-target'
        )
    ) {
      registerCompatibilityOccurrence(
        state.unifiedFindingRegistry,
        {
          fingerprint:
            draft.fingerprint,
          finding:
            draft.finding,
          pageUrl:
            input.pageUrl,
          pageTitle:
            input.pageTitle,
          target:
            draft.evidenceTarget,
          evidenceSummaries:
            draft.occurrenceEvidence,
          screenshotPath:
            input.screenshotPath,
          redundantInvestigationSkipped:
            draft
              .redundantInvestigationSkipped
        }
      );
    }

    if (
      draft
        .redundantInvestigationSkipped
    ) {
      markOccurrenceSuppressed(
        state.unifiedFindingRegistry,
        {
          fingerprint:
            draft.fingerprint,
          pageUrl:
            input.pageUrl,
          target:
            draft.evidenceTarget
        }
      );
    }
  }

  for (
    const candidate of
      input.page.pageCandidates
  ) {
    const result =
      findingResultByCandidateReference
        .get(
          candidate.reference
        )!;

    const unifiedFingerprint =
      input
        .page
        .unifiedFingerprintByCandidateReference
        .get(
          candidate.reference
        );

    if (
      unifiedFingerprint ===
      undefined
    ) {
      throw new Error(
        `Candidate "${candidate.reference}" is missing its unified finding identity.`
      );
    }

    attachInvestigationOutcome(
      state.unifiedFindingRegistry,
      {
        fingerprint:
          unifiedFingerprint,
        pageUrl:
          input.pageUrl,
        target:
          candidate.finding
            .evidenceTarget,
        finding:
          candidate.finding,
        outcome:
          result.outcome,
        candidateReference:
          candidate.reference
      }
    );
  }

  const knownFindingOccurrences =
    input
      .page
      .reconciledPageFindings
      .knownOccurrenceDrafts
      .map(
        draft => {
          const reinvestigationCandidateReference =
            Array.from(
              input
                .page
                .knownFingerprintByCandidateReference
                .entries()
            )
              .find(
                (
                  [
                    ,
                    fingerprint
                  ]
                ) =>
                  fingerprint ===
                  draft.fingerprint
              )
              ?.[0];

          const verificationOutcome =
            reinvestigationCandidateReference ===
              undefined
              ? null
              : findingResultByCandidateReference
                  .get(
                    reinvestigationCandidateReference
                  )
                  ?.outcome ??
                null;

          return registerKnownFindingOccurrence(
            state.knownFindingState,
            {
              fingerprint:
                draft.fingerprint,
              finding:
                draft.finding,
              pageUrl:
                input.pageUrl,
              pageTitle:
                input.pageTitle,
              screenshotPath:
                input.screenshotPath,
              occurrenceEvidence:
                draft.occurrenceEvidence,
              evidenceTarget:
                draft.evidenceTarget,
              matchingBases:
                draft.matchingBases,
              modelKnownFindingReference:
                draft
                  .modelKnownFindingReference,
              modelReferenceMatched:
                draft
                  .modelReferenceMatched,
              redundantInvestigationSkipped:
                draft
                  .redundantInvestigationSkipped,
              verificationOutcome
            }
          );
        }
      );

  const newFindingCandidates =
    input
      .page
      .pageCandidates
      .filter(
        candidate =>
          !input
            .page
            .knownFingerprintByCandidateReference
            .has(
              candidate.reference
            )
      );

  for (
    const candidate of
      newFindingCandidates
  ) {
    const result =
      findingResultByCandidateReference
        .get(
          candidate.reference
        )!;

    registerNewFinding(
      state.knownFindingState,
      {
        finding:
          candidate.finding,
        fingerprint:
          input.page
            .unifiedFingerprintByCandidateReference
            .get(
              candidate.reference
            ),
        pageUrl:
          input.pageUrl,
        pageTitle:
          input.pageTitle,
        screenshotPath:
          input.screenshotPath,
        verificationOutcome:
          result.outcome
      }
    );
  }

  return knownFindingOccurrences;
}

export function getRunFindings(
  state:
    RunFindingLifecycleState
): UnifiedFinding[] {
  return getUnifiedFindings(
    state.unifiedFindingRegistry
  );
}
