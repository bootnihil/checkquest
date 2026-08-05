import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import type { PageFinding } from '../analysis/evaluate-page';
import type { ExtractedPageContent } from '../browser/extracted-page-content';
import {
  createDisclosureStateTargetFingerprint,
  createExploratoryFindingFingerprint,
  createSelectOptionTargetFingerprint,
  createTabStateTargetFingerprint,
  normalizeFingerprintText,
  validateStructuredIdentity
} from '../investigation/finding-fingerprint';
import { adaptExploratoryQaFinding, adaptPageFinding } from './current-finding-adapters';
import {
  deriveLogicalFindingVerification,
  deriveOccurrenceVerification
} from './derive-verification-state';
import type { FindingEvidence, FindingOccurrence, UnifiedFinding } from './finding-model';

export type FindingObservationMatchingBasis =
  | 'same-page-rule'
  | 'structured-target'
  | 'structured-identity'
  | 'fallback-fingerprint';

export interface ModelObservationReconciliation {
  modelIndex: number;
  fingerprint: string;
  matchingBasis: FindingObservationMatchingBasis;
  acceptedRelatedRuleCode: string | null;
}

export interface ExplicitFindingEvidenceContribution {
  /**
   * Evidence is accepted only for an exact finding fingerprint already present
   * in this page's reconciliation input.
   */
  fingerprint: string;
  evidence: FindingEvidence;
}

export interface ReconcileFindingObservationsInput {
  pageUrl: string;
  pageTitle: string;
  ruleFindings: PageFinding[];
  modelFindings: ExploratoryQaFinding[];
  pageContent?: ExtractedPageContent;
  screenshotReferences?: string[];
  evidenceContributions?: ExplicitFindingEvidenceContribution[];
}

export interface ReconciledPageFindingObservations {
  findings: UnifiedFinding[];
  /**
   * Transitional input for the existing Stage 3 candidate/registry flow.
   * There is at most one representative for each exact reconciled model group.
   */
  candidateFindings: ExploratoryQaFinding[];
  candidateFingerprints: string[];
  modelReconciliations: ModelObservationReconciliation[];
}

interface FindingGroup {
  finding: UnifiedFinding;
  modelPresentationApplied: boolean;
}

export function createRuleFindingFingerprint(finding: PageFinding): string {
  return `rule|${finding.code}`;
}

function evidenceIdentity(evidence: FindingEvidence): string {
  return JSON.stringify({
    source: evidence.source,
    kind: evidence.kind,
    relation: evidence.relation,
    verificationCapable: evidence.verificationCapable,
    summary: evidence.summary,
    rawSource: evidence.rawSource ?? null
  });
}

function mergeEvidence(target: FindingOccurrence, incomingEvidence: FindingEvidence[]): void {
  const knownEvidence = new Set(target.evidence.map(evidenceIdentity));

  for (const evidence of incomingEvidence) {
    const identity = evidenceIdentity(evidence);

    if (!knownEvidence.has(identity)) {
      target.evidence.push(evidence);
      knownEvidence.add(identity);
    }
  }

  target.verification = deriveOccurrenceVerification(target.evidence);
}

function refreshLogicalVerification(finding: UnifiedFinding): void {
  finding.verification = deriveLogicalFindingVerification(finding.occurrences);
}

function targetIdentity(target: FindingOccurrence['target']): string {
  if (target === null) {
    return 'target|null';
  }

  switch (target.kind) {
    case 'select-option':
      return createSelectOptionTargetFingerprint(target);

    case 'disclosure-state':
      return createDisclosureStateTargetFingerprint(target);

    case 'tab-state':
      return createTabStateTargetFingerprint(target);
  }
}

function mergeOccurrence(
  targetFinding: UnifiedFinding,
  incomingOccurrence: FindingOccurrence
): void {
  const existingOccurrence = targetFinding.occurrences.find(
    occurrence =>
      occurrence.pageUrl === incomingOccurrence.pageUrl &&
      targetIdentity(occurrence.target) === targetIdentity(incomingOccurrence.target)
  );

  if (existingOccurrence) {
    mergeEvidence(existingOccurrence, incomingOccurrence.evidence);

    const screenshotReferences = new Set(existingOccurrence.screenshotReferences);

    for (const reference of incomingOccurrence.screenshotReferences) {
      if (!screenshotReferences.has(reference)) {
        existingOccurrence.screenshotReferences.push(reference);

        screenshotReferences.add(reference);
      }
    }
  } else {
    targetFinding.occurrences.push(incomingOccurrence);
  }

  refreshLogicalVerification(targetFinding);
}

function mergeRuleFinding(
  groups: Map<string, FindingGroup>,
  finding: PageFinding,
  ruleIndex: number,
  pageTitle: string,
  screenshotReferences: string[]
): void {
  const fingerprint = createRuleFindingFingerprint(finding);

  const adapted = adaptPageFinding(finding, {
    findingReference: `finding-${ruleIndex + 1}`,

    fingerprint,

    occurrenceReference: `occurrence-${ruleIndex + 1}`,

    pageTitle,
    screenshotReferences
  });

  const existing = groups.get(fingerprint);

  if (existing) {
    for (const occurrence of adapted.occurrences) {
      mergeOccurrence(existing.finding, occurrence);
    }

    return;
  }

  groups.set(fingerprint, {
    finding: adapted,
    modelPresentationApplied: false
  });
}

function applyModelPresentation(target: UnifiedFinding, modelFinding: ExploratoryQaFinding): void {
  if (target.description.length === 0) {
    target.description = modelFinding.reasoning;
  } else if (!target.description.includes(modelFinding.reasoning)) {
    target.description = `${target.description} Model observation: ${modelFinding.reasoning}`;
  }

  target.suggestedCheck ??= modelFinding.suggestedCheck;
}

function hasExactRuleAssertionIdentity(
  ruleFinding: PageFinding,
  modelFinding: ExploratoryQaFinding
): boolean {
  /*
   * relatedRuleCode is model-supplied correlation metadata, not trusted
   * identity. Current deterministic rules are targetless, so a model finding
   * with a structured target necessarily describes a different occurrence.
   * A runtime-derived technical identity is likewise an independent stable
   * observation, even when the model copied a deterministic rule's metadata.
   *
   * For targetless observations, require exact normalized assertion content.
   * A paraphrase remains separate until a stronger deterministic subject
   * identity exists.
   */
  return (
    modelFinding.evidenceTarget === null &&
    (modelFinding.technicalIdentity === null || modelFinding.technicalIdentity === undefined) &&
    (modelFinding.structuredIdentity === null || modelFinding.structuredIdentity === undefined) &&
    normalizeFingerprintText(modelFinding.title) === normalizeFingerprintText(ruleFinding.title) &&
    normalizeFingerprintText(modelFinding.evidence) ===
      normalizeFingerprintText(ruleFinding.evidence)
  );
}

function canonicalizeStructuredObservation(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent | undefined
): ExploratoryQaFinding {
  const identity = finding.structuredIdentity ?? null;

  if (identity === null) {
    return finding;
  }

  if (content === undefined || !validateStructuredIdentity(identity, content)) {
    return {
      ...finding,
      structuredIdentity: null
    };
  }

  /*
   * An admitted accessibility finding already carries a browser-grounded
   * defect basis. Preserve its concrete observation/conflict wording rather
   * than collapsing it back to the neutral accessible-name property used for
   * stable identity.
   */
  if (
    finding.category === 'accessibility' &&
    finding.accessibilityDefectBasis !== null &&
    finding.accessibilityDefectBasis !== undefined
  ) {
    return finding;
  }

  const subject = `${identity.subject.controlType} control with id "${identity.subject.controlId}"`;
  const mechanismTitle = identity.mechanism.split('-').join(' ');

  return {
    ...finding,
    title: `${mechanismTitle.charAt(0).toUpperCase()}${mechanismTitle.slice(1)} in ${identity.subject.controlType} accessible name`,
    evidence: `The ${subject} has the accessible name "${identity.observedValue}".`,
    reasoning:
      identity.mechanism === 'unresolved-token'
        ? 'People using assistive technology may hear the unresolved token instead of a meaningful control name.'
        : finding.reasoning,
    suggestedCheck: `Review the accessible-name source for the ${subject} and confirm that "${identity.observedValue}" is the intended name.`
  };
}

export function reconcileFindingObservations(
  input: ReconcileFindingObservationsInput
): ReconciledPageFindingObservations {
  const screenshotReferences = input.screenshotReferences ?? [];

  const groups = new Map<string, FindingGroup>();

  const samePageRulesByCode = new Map(
    input.ruleFindings.map(finding => [finding.code, finding] as const)
  );

  input.ruleFindings.forEach((finding, index) => {
    mergeRuleFinding(groups, finding, index, input.pageTitle, screenshotReferences);
  });

  const candidateFindings: ExploratoryQaFinding[] = [];

  const candidateFingerprints = new Set<string>();
  const orderedCandidateFingerprints: string[] = [];

  const modelReconciliations: ModelObservationReconciliation[] = [];

  input.modelFindings.forEach((modelFinding, index) => {
    const canonicalFinding = canonicalizeStructuredObservation(modelFinding, input.pageContent);
    const requestedRuleCode = canonicalFinding.relatedRuleCode ?? null;

    const requestedRule =
      requestedRuleCode === null ? undefined : samePageRulesByCode.get(requestedRuleCode);

    const acceptedRelatedRuleCode =
      requestedRule !== undefined && hasExactRuleAssertionIdentity(requestedRule, canonicalFinding)
        ? requestedRuleCode
        : null;

    const fingerprint =
      acceptedRelatedRuleCode === null
        ? createExploratoryFindingFingerprint(
            canonicalFinding,
            input.pageContent,
            `${input.pageUrl}|model-${index + 1}`
          )
        : `rule|${acceptedRelatedRuleCode}`;

    const matchingBasis: FindingObservationMatchingBasis =
      acceptedRelatedRuleCode !== null
        ? 'same-page-rule'
        : canonicalFinding.evidenceTarget !== null && canonicalFinding.evidenceTarget !== undefined
          ? 'structured-target'
          : canonicalFinding.structuredIdentity !== null &&
              canonicalFinding.structuredIdentity !== undefined &&
              createExploratoryFindingFingerprint(canonicalFinding, input.pageContent).startsWith(
                'identity|'
              )
            ? 'structured-identity'
            : 'fallback-fingerprint';

    const adapted = adaptExploratoryQaFinding(canonicalFinding, {
      findingReference: `finding-${input.ruleFindings.length + index + 1}`,

      fingerprint,

      occurrenceReference: `occurrence-${input.ruleFindings.length + index + 1}`,

      pageUrl: input.pageUrl,

      pageTitle: input.pageTitle,

      screenshotReferences
    });

    const existing = groups.get(fingerprint);

    if (existing) {
      for (const occurrence of adapted.occurrences) {
        mergeOccurrence(existing.finding, occurrence);
      }

      if (!existing.modelPresentationApplied) {
        applyModelPresentation(existing.finding, canonicalFinding);

        existing.modelPresentationApplied = true;
      }
    } else {
      groups.set(fingerprint, {
        finding: adapted,
        modelPresentationApplied: true
      });
    }

    if (!candidateFingerprints.has(fingerprint)) {
      candidateFindings.push(canonicalFinding);
      orderedCandidateFingerprints.push(fingerprint);
      candidateFingerprints.add(fingerprint);
    }

    modelReconciliations.push({
      modelIndex: index,
      fingerprint,
      matchingBasis,
      acceptedRelatedRuleCode
    });
  });

  for (const contribution of input.evidenceContributions ?? []) {
    const group = groups.get(contribution.fingerprint);

    const occurrence = group?.finding.occurrences[0];

    if (!group || !occurrence) {
      continue;
    }

    mergeEvidence(occurrence, [contribution.evidence]);

    refreshLogicalVerification(group.finding);
  }

  return {
    findings: Array.from(groups.values(), group => group.finding),
    candidateFindings,
    candidateFingerprints: orderedCandidateFingerprints,
    modelReconciliations
  };
}
