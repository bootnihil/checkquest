import type {
  DisclosureStateEvidenceTarget,
  ExploratoryQaFinding,
  SelectOptionEvidenceTarget
} from '../analysis/exploratory-qa-schema';
import type {
  ExtractedPageContent,
  PageDisclosureControl,
  PageSelectControl
} from '../browser/extract-page-content';
import type {
  FindingInvestigationOutcome,
  FindingInvestigationStatus
} from './evaluate-finding-investigation-outcome';
import {
  createExploratoryFindingFingerprint,
  createDisclosureStateTargetFingerprint,
  createSelectOptionTargetFingerprint,
  normalizeFingerprintText
} from './finding-fingerprint';

export type KnownFindingReference =
  `known-${number}`;

export type KnownFindingMatchingBasis =
  | 'initial-finding'
  | 'structured-target'
  | 'finding-fingerprint';

export interface KnownFindingOccurrence {
  knownFindingReference:
    KnownFindingReference;

  fingerprint: string;

  representativeFinding:
    ExploratoryQaFinding;

  pageUrl: string;

  pageTitle: string;

  screenshotPath:
    string | null;

  occurrenceEvidence:
    string[];

  evidenceTarget:
    ExploratoryQaFinding['evidenceTarget'];

  matchingBases:
    KnownFindingMatchingBasis[];

  modelKnownFindingReference:
    string | null;

  modelReferenceMatched:
    boolean | null;

  redundantInvestigationSkipped:
    boolean;

  verificationOutcome:
    FindingInvestigationOutcome | null;
}

export interface KnownFindingEntry {
  knownFindingReference:
    KnownFindingReference;

  fingerprint: string;

  representativeFinding:
    ExploratoryQaFinding;

  occurrences:
    KnownFindingOccurrence[];

  affectedPageUrls:
    Set<string>;

  effectiveVerificationStatus:
    FindingInvestigationStatus;

  updatedSequence: number;
}

export interface KnownFindingState {
  entriesByFingerprint:
    Map<string, KnownFindingEntry>;

  entriesByReference:
    Map<KnownFindingReference, KnownFindingEntry>;

  nextReferenceNumber: number;

  nextSequence: number;
}

export interface KnownFindingPromptContext {
  knownFindingReference:
    KnownFindingReference;

  title: string;

  category:
    ExploratoryQaFinding['category'];

  severity:
    ExploratoryQaFinding['severity'];

  verificationStatus:
    FindingInvestigationStatus;

  evidenceTarget:
    ExploratoryQaFinding['evidenceTarget'];

  affectedPageCount: number;
}

export interface KnownFindingOccurrenceDraft {
  knownFindingReference:
    KnownFindingReference;

  fingerprint: string;

  finding:
    ExploratoryQaFinding;

  occurrenceEvidence:
    string[];

  evidenceTarget:
    ExploratoryQaFinding['evidenceTarget'];

  matchingBases:
    KnownFindingMatchingBasis[];

  modelKnownFindingReference:
    string | null;

  modelReferenceMatched:
    boolean | null;

  redundantInvestigationSkipped:
    boolean;

  reinvestigationEligible:
    boolean;
}

export interface ReinvestigationFinding {
  fingerprint: string;

  finding:
    ExploratoryQaFinding;
}

export interface ReconciledPageFindings {
  newFindings:
    ExploratoryQaFinding[];

  knownOccurrenceDrafts:
    KnownFindingOccurrenceDraft[];

  reinvestigationFindings:
    ReinvestigationFinding[];
}

const knownFindingContextLimit =
  20;

export function createKnownFindingState():
  KnownFindingState {
  return {
    entriesByFingerprint:
      new Map(),

    entriesByReference:
      new Map(),

    nextReferenceNumber:
      1,

    nextSequence:
      1
  };
}

export function getKnownFindingEntries(
  state: KnownFindingState
): KnownFindingEntry[] {
  return Array.from(
    state
      .entriesByFingerprint
      .values()
  );
}

export function buildKnownFindingPromptContext(
  state: KnownFindingState,
  relevantFingerprints:
    Iterable<string> = []
): KnownFindingPromptContext[] {
  const relevant =
    new Set(
      relevantFingerprints
    );

  const severityPriority = {
    high:
      3,
    medium:
      2,
    low:
      1
  } as const;

  return getKnownFindingEntries(
    state
  )
    .sort(
      (
        left,
        right
      ) => {
        const relevanceDifference =
          Number(
            relevant.has(
              right.fingerprint
            )
          ) -
          Number(
            relevant.has(
              left.fingerprint
            )
          );

        if (
          relevanceDifference !==
          0
        ) {
          return relevanceDifference;
        }

        const severityDifference =
          severityPriority[
            right
              .representativeFinding
              .severity
          ] -
          severityPriority[
            left
              .representativeFinding
              .severity
          ];

        if (
          severityDifference !==
          0
        ) {
          return severityDifference;
        }

        return (
          right.updatedSequence -
          left.updatedSequence
        );
      }
    )
    .slice(
      0,
      knownFindingContextLimit
    )
    .map(
      entry => ({
        knownFindingReference:
          entry
            .knownFindingReference,

        title:
          entry
            .representativeFinding
            .title,

        category:
          entry
            .representativeFinding
            .category,

        severity:
          entry
            .representativeFinding
            .severity,

        verificationStatus:
          entry
            .effectiveVerificationStatus,

        evidenceTarget:
          entry
            .representativeFinding
            .evidenceTarget,

        affectedPageCount:
          entry
            .affectedPageUrls
            .size
      })
    );
}

export function detectStructuredKnownFindingOccurrences(
  state: KnownFindingState,
  content: ExtractedPageContent
): KnownFindingOccurrenceDraft[] {
  const detected:
    KnownFindingOccurrenceDraft[] = [];

  for (
    const entry of
      getKnownFindingEntries(
        state
      )
  ) {
    const knownTarget =
      entry
        .representativeFinding
        .evidenceTarget;

    if (
      knownTarget ===
      null
    ) {
      continue;
    }

    if (
      knownTarget.kind ===
      'select-option'
    ) {
      const match =
        findSelectOptionMatch(
          entry.fingerprint,
          knownTarget,
          content.selects
        );

      if (match === null) {
        continue;
      }

      const currentTarget:
        SelectOptionEvidenceTarget = {
        kind:
          'select-option',

        controlLabel:
          match.select.label,

        controlName:
          match.select.name,

        controlId:
          match.select.id,

        optionText:
          match.optionText
      };

      const isVerified =
        entry
          .effectiveVerificationStatus ===
        'verified';

      detected.push({
        knownFindingReference:
          entry
            .knownFindingReference,

        fingerprint:
          entry.fingerprint,

        finding: {
          ...entry
            .representativeFinding,

          knownFindingReference:
            entry
              .knownFindingReference,

          evidenceTarget:
            currentTarget
        },

        occurrenceEvidence: [
          `Current structured page evidence contains option "${match.optionText}" in the matched select control.`
        ],

        evidenceTarget:
          currentTarget,

        matchingBases: [
          'structured-target'
        ],

        modelKnownFindingReference:
          null,

        modelReferenceMatched:
          null,

        redundantInvestigationSkipped:
          isVerified,

        reinvestigationEligible:
          !isVerified &&
          !match.select.disabled
      });

      continue;
    }

    const match =
      findDisclosureMatch(
        entry.fingerprint,
        knownTarget,
        content.disclosures
      );

    if (match === null) {
      continue;
    }

    const currentTarget:
      DisclosureStateEvidenceTarget = {
      kind:
        'disclosure-state',
      controlId:
        match.control.controlId!,
      accessibleName:
        match.control
          .accessibleName!,
      controlledRegionId:
        match.control
          .ariaControls!,
      desiredState:
        knownTarget.desiredState
    };

    const isVerified =
      entry
        .effectiveVerificationStatus ===
      'verified';

    detected.push({
      knownFindingReference:
        entry
          .knownFindingReference,
      fingerprint:
        entry.fingerprint,
      finding: {
        ...entry
          .representativeFinding,
        knownFindingReference:
          entry
            .knownFindingReference,
        evidenceTarget:
          currentTarget
      },
      occurrenceEvidence: [
        `Current structured page evidence contains eligible disclosure "${currentTarget.accessibleName}" controlling "${currentTarget.controlledRegionId}".`
      ],
      evidenceTarget:
        currentTarget,
      matchingBases: [
        'structured-target'
      ],
      modelKnownFindingReference:
        null,
      modelReferenceMatched:
        null,
      redundantInvestigationSkipped:
        isVerified,
      reinvestigationEligible:
        !isVerified &&
        match.control
          .eligibleForDisclosureAction
    });
  }

  return detected;
}

export function reconcilePageFindings(
  state: KnownFindingState,
  geminiFindings:
    ExploratoryQaFinding[],
  deterministicDrafts:
    KnownFindingOccurrenceDraft[]
): ReconciledPageFindings {
  const knownDraftsByFingerprint =
    new Map<
      string,
      KnownFindingOccurrenceDraft
    >(
      deterministicDrafts.map(
        draft => [
          draft.fingerprint,
          draft
        ]
      )
    );

  const newFindings:
    ExploratoryQaFinding[] = [];

  for (
    const modelFinding of
      geminiFindings
  ) {
    const fingerprint =
      createExploratoryFindingFingerprint(
        modelFinding
      );

    const knownEntry =
      state
        .entriesByFingerprint
        .get(
          fingerprint
        );

    if (
      knownEntry ===
      undefined
    ) {
      newFindings.push({
        ...modelFinding,

        /*
         * A model-supplied reference cannot make an otherwise
         * distinct finding known. Clear the advisory value so it
         * cannot leak into later page-local identity handling.
         */
        knownFindingReference:
          null
      });

      continue;
    }

    const suppliedReference =
      modelFinding
        .knownFindingReference ??
      null;

    const existingDraft =
      knownDraftsByFingerprint
        .get(
          fingerprint
        );

    const isVerified =
      knownEntry
        .effectiveVerificationStatus ===
      'verified';

    if (
      existingDraft !==
      undefined
    ) {
      addUnique(
        existingDraft
          .occurrenceEvidence,
        modelFinding.evidence
      );

      addUnique(
        existingDraft
          .matchingBases,
        'finding-fingerprint'
      );

      existingDraft
        .modelKnownFindingReference =
          suppliedReference;

      existingDraft
        .modelReferenceMatched =
          suppliedReference ===
            null
            ? null
            : suppliedReference ===
              knownEntry
                .knownFindingReference;

      continue;
    }

    knownDraftsByFingerprint.set(
      fingerprint,
      {
        knownFindingReference:
          knownEntry
            .knownFindingReference,

        fingerprint,

        finding: {
          ...modelFinding,

          knownFindingReference:
            knownEntry
              .knownFindingReference
        },

        occurrenceEvidence: [
          modelFinding.evidence
        ],

        evidenceTarget:
          modelFinding
            .evidenceTarget,

        matchingBases: [
          'finding-fingerprint'
        ],

        modelKnownFindingReference:
          suppliedReference,

        modelReferenceMatched:
          suppliedReference ===
            null
            ? null
            : suppliedReference ===
              knownEntry
                .knownFindingReference,

        redundantInvestigationSkipped:
          isVerified,

        reinvestigationEligible:
          !isVerified &&
          modelFinding
            .evidenceTarget !==
            null
      }
    );
  }

  const knownOccurrenceDrafts =
    Array.from(
      knownDraftsByFingerprint
        .values()
    );

  const reinvestigationFindings =
    knownOccurrenceDrafts
      .filter(
        draft =>
          draft
            .reinvestigationEligible
      )
      .map(
        draft => ({
          fingerprint:
            draft.fingerprint,

          finding:
            draft.finding
        })
      );

  return {
    newFindings,
    knownOccurrenceDrafts,
    reinvestigationFindings
  };
}

export function registerKnownFindingOccurrence(
  state: KnownFindingState,
  input: {
    fingerprint: string;
    finding: ExploratoryQaFinding;
    pageUrl: string;
    pageTitle: string;
    screenshotPath: string | null;
    occurrenceEvidence: string[];
    evidenceTarget: ExploratoryQaFinding['evidenceTarget'];
    matchingBases: KnownFindingMatchingBasis[];
    modelKnownFindingReference: string | null;
    modelReferenceMatched: boolean | null;
    redundantInvestigationSkipped: boolean;
    verificationOutcome: FindingInvestigationOutcome | null;
  }
): KnownFindingOccurrence {
  let entry =
    state
      .entriesByFingerprint
      .get(
        input.fingerprint
      );

  if (
    entry ===
    undefined
  ) {
    const knownFindingReference:
      KnownFindingReference =
        `known-${state.nextReferenceNumber}`;

    state.nextReferenceNumber +=
      1;

    entry = {
      knownFindingReference,

      fingerprint:
        input.fingerprint,

      representativeFinding: {
        ...input.finding,

        knownFindingReference:
          knownFindingReference
      },

      occurrences: [],

      affectedPageUrls:
        new Set(),

      effectiveVerificationStatus:
        'inconclusive',

      updatedSequence:
        state.nextSequence
    };

    state.nextSequence +=
      1;

    state
      .entriesByFingerprint
      .set(
        input.fingerprint,
        entry
      );

    state
      .entriesByReference
      .set(
        knownFindingReference,
        entry
      );
  }

  const existingOccurrence =
    entry
      .occurrences
      .find(
        occurrence =>
          occurrence.pageUrl ===
          input.pageUrl
      );

  if (
    existingOccurrence !==
    undefined
  ) {
    for (
      const evidence of
        input.occurrenceEvidence
    ) {
      addUnique(
        existingOccurrence
          .occurrenceEvidence,
        evidence
      );
    }

    for (
      const matchingBasis of
        input.matchingBases
    ) {
      addUnique(
        existingOccurrence
          .matchingBases,
        matchingBasis
      );
    }

    existingOccurrence.screenshotPath =
      input.screenshotPath ??
      existingOccurrence
        .screenshotPath;

    existingOccurrence.evidenceTarget =
      input.evidenceTarget ??
      existingOccurrence
        .evidenceTarget;

    existingOccurrence.modelKnownFindingReference =
      input.modelKnownFindingReference ??
      existingOccurrence
        .modelKnownFindingReference;

    existingOccurrence.modelReferenceMatched =
      input.modelReferenceMatched ??
      existingOccurrence
        .modelReferenceMatched;

    existingOccurrence.redundantInvestigationSkipped =
      existingOccurrence
        .redundantInvestigationSkipped &&
      input
        .redundantInvestigationSkipped;

    existingOccurrence.verificationOutcome =
      input.verificationOutcome ??
      existingOccurrence
        .verificationOutcome;

    updateKnownFindingEntry(
      state,
      entry
    );

    return existingOccurrence;
  }

  const occurrence:
    KnownFindingOccurrence = {
    knownFindingReference:
      entry
        .knownFindingReference,

    fingerprint:
      input.fingerprint,

    representativeFinding:
      entry
        .representativeFinding,

    pageUrl:
      input.pageUrl,

    pageTitle:
      input.pageTitle,

    screenshotPath:
      input.screenshotPath,

    occurrenceEvidence: [
      ...input.occurrenceEvidence
    ],

    evidenceTarget:
      input.evidenceTarget,

    matchingBases: [
      ...input.matchingBases
    ],

    modelKnownFindingReference:
      input.modelKnownFindingReference,

    modelReferenceMatched:
      input.modelReferenceMatched,

    redundantInvestigationSkipped:
      input
        .redundantInvestigationSkipped,

    verificationOutcome:
      input.verificationOutcome
  };

  entry.occurrences.push(
    occurrence
  );

  entry
    .affectedPageUrls
    .add(
      input.pageUrl
    );

  updateKnownFindingEntry(
    state,
    entry
  );

  return occurrence;
}

export function registerNewFinding(
  state: KnownFindingState,
  input: {
    finding: ExploratoryQaFinding;
    pageUrl: string;
    pageTitle: string;
    screenshotPath: string | null;
    verificationOutcome: FindingInvestigationOutcome;
  }
): KnownFindingOccurrence {
  return registerKnownFindingOccurrence(
    state,
    {
      fingerprint:
        createExploratoryFindingFingerprint(
          input.finding
        ),

      finding:
        input.finding,

      pageUrl:
        input.pageUrl,

      pageTitle:
        input.pageTitle,

      screenshotPath:
        input.screenshotPath,

      occurrenceEvidence: [
        input.finding.evidence
      ],

      evidenceTarget:
        input.finding
          .evidenceTarget,

      matchingBases: [
        'initial-finding'
      ],

      modelKnownFindingReference:
        input.finding
          .knownFindingReference ??
        null,

      modelReferenceMatched:
        null,

      redundantInvestigationSkipped:
        false,

      verificationOutcome:
        input.verificationOutcome
    }
  );
}

function findSelectOptionMatch(
  knownFingerprint: string,
  knownTarget:
    SelectOptionEvidenceTarget,
  selects:
    PageSelectControl[]
): {
  select: PageSelectControl;
  optionText: string;
} | null {
  for (
    const select of selects
  ) {
    for (
      const option of
        select.options
    ) {
      if (
        normalizeFingerprintText(
          option.text
        ) !==
        normalizeFingerprintText(
          knownTarget.optionText
        )
      ) {
        continue;
      }

      const currentTarget:
        SelectOptionEvidenceTarget = {
        kind:
          'select-option',

        controlLabel:
          select.label,

        controlName:
          select.name,

        controlId:
          select.id,

        optionText:
          option.text
      };

      if (
        createSelectOptionTargetFingerprint(
          currentTarget
        ) ===
        knownFingerprint
      ) {
        return {
          select,
          optionText:
            option.text
        };
      }
    }
  }

  return null;
}

function findDisclosureMatch(
  knownFingerprint: string,
  knownTarget:
    DisclosureStateEvidenceTarget,
  disclosures:
    PageDisclosureControl[]
): {
  control:
    PageDisclosureControl;
} | null {
  for (
    const control of
      disclosures
  ) {
    if (
      !control
        .eligibleForDisclosureAction ||
      control.controlId === null ||
      control.accessibleName ===
        null ||
      control.ariaControls ===
        null
    ) {
      continue;
    }

    const currentTarget:
      DisclosureStateEvidenceTarget = {
      kind:
        'disclosure-state',
      controlId:
        control.controlId,
      accessibleName:
        control.accessibleName,
      controlledRegionId:
        control.ariaControls,
      desiredState:
        knownTarget.desiredState
    };

    if (
      createDisclosureStateTargetFingerprint(
        currentTarget
      ) === knownFingerprint
    ) {
      return {
        control
      };
    }
  }

  return null;
}

function updateKnownFindingEntry(
  state: KnownFindingState,
  entry: KnownFindingEntry
): void {
  entry.effectiveVerificationStatus =
    getEffectiveVerificationStatus(
      entry.occurrences
    );

  entry.updatedSequence =
    state.nextSequence;

  state.nextSequence +=
    1;
}

function getEffectiveVerificationStatus(
  occurrences:
    KnownFindingOccurrence[]
): FindingInvestigationStatus {
  const statuses =
    occurrences
      .map(
        occurrence =>
          occurrence
            .verificationOutcome
            ?.status
      )
      .filter(
        (
          status
        ): status is FindingInvestigationStatus =>
          status !==
          undefined
      );

  if (
    statuses.includes(
      'verified'
    )
  ) {
    return 'verified';
  }

  if (
    statuses.includes(
      'not-verified'
    )
  ) {
    return 'not-verified';
  }

  return 'inconclusive';
}

function addUnique<T>(
  values: T[],
  value: T
): void {
  if (
    !values.includes(
      value
    )
  ) {
    values.push(
      value
    );
  }
}
