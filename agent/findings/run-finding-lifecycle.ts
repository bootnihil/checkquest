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

function createModelFindingIdentity(
  finding:
    ExploratoryQaFinding
): string {
  return [
    createExploratoryFindingFingerprint(
      finding
    ),
    finding.relatedRuleCode ?? ''
  ].join(
    '|related-rule|'
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
          .findings
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

        state
          .unifiedFingerprintAliases
          .set(
            createExploratoryFindingFingerprint(
              finding
            ),
            reconciliation
              .fingerprint
          );
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

  const findingResultByCandidateReference =
    new Map(
      input
        .exploratoryFindingResults
        .map(
          result => [
            result.candidateReference,
            result
          ]
        )
    );

  for (
    const result of
      input.exploratoryFindingResults
  ) {
    const unifiedFingerprint =
      input
        .page
        .unifiedFingerprintByCandidateReference
        .get(
          result.candidateReference
        );

    if (
      unifiedFingerprint ===
      undefined
    ) {
      throw new Error(
        `Candidate "${result.candidateReference}" is missing its unified finding identity.`
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
          result.finding
            .evidenceTarget,
        finding:
          result.finding,
        outcome:
          result.outcome,
        candidateReference:
          result.candidateReference
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

  /*
   * Preserve the existing positional contract between the leading
   * new-finding candidates and their page-local investigation results.
   */
  for (
    let findingIndex = 0;
    findingIndex <
      input
        .page
        .reconciledPageFindings
        .newFindings
        .length;
    findingIndex +=
      1
  ) {
    const result =
      input
        .exploratoryFindingResults[
          findingIndex
        ];

    if (
      result ===
      undefined
    ) {
      throw new Error(
        'A new exploratory finding is missing its page-local investigation result.'
      );
    }

    registerNewFinding(
      state.knownFindingState,
      {
        finding:
          result.finding,
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
