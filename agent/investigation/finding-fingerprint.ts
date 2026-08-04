import type {
  DisclosureStateEvidenceTarget,
  ExploratoryQaFinding,
  FindingStructuredIdentity,
  SelectOptionEvidenceTarget,
  TabStateEvidenceTarget
} from '../analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../browser/extract-page-content';
import { createTechnicalObservationFingerprint } from '../analysis/technical-observation-reconciliation';

type SelectControlIdentity = {
  controlLabel: string | null;
  controlName: string | null;
  controlId: string | null;
};

/*
 * Normalize AI-produced and browser-extracted text so that
 * harmless differences in capitalization, punctuation, and
 * whitespace do not prevent deterministic matching.
 *
 * Examples:
 *
 *   "COUNTRY*"  -> "country"
 *   " Equador " -> "equador"
 */
export function normalizeFingerprintText(value: string | null): string {
  if (value === null) {
    return '';
  }

  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/*
 * Choose the most meaningful available identity for a
 * supported select control.
 *
 * Labels are preferred because they are normally the most
 * human-readable and stable across pages. The field name and
 * element ID are used only when no label is available.
 */
function getSelectControlIdentity(target: SelectControlIdentity): string {
  const candidates = [target.controlLabel, target.controlName, target.controlId];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeFingerprintText(candidate);

    if (normalizedCandidate.length > 0) {
      return normalizedCandidate;
    }
  }

  return 'unknown control';
}

export function createSelectOptionTargetFingerprint(target: SelectOptionEvidenceTarget): string {
  return [
    'target',
    target.kind,
    getSelectControlIdentity(target),
    normalizeFingerprintText(target.optionText)
  ].join('|');
}

export function createDisclosureStateTargetFingerprint(
  target: DisclosureStateEvidenceTarget
): string {
  return [
    'target',
    target.kind,
    normalizeFingerprintText(target.controlId),
    normalizeFingerprintText(target.accessibleName),
    normalizeFingerprintText(target.controlledRegionId),
    target.desiredState
  ].join('|');
}

export function createTabStateTargetFingerprint(target: TabStateEvidenceTarget): string {
  return [
    'target',
    target.kind,
    normalizeFingerprintText(target.controlId),
    normalizeFingerprintText(target.accessibleName),
    normalizeFingerprintText(target.tabListId),
    normalizeFingerprintText(target.controlledPanelId),
    target.desiredState
  ].join('|');
}

function getStructuredSubjectIdentity(identity: FindingStructuredIdentity): string {
  return normalizeFingerprintText(identity.subject.componentId ?? identity.subject.controlId);
}

export function createStructuredIdentityFingerprint(identity: FindingStructuredIdentity): string {
  return [
    'identity',
    normalizeFingerprintText(identity.mechanism),
    normalizeFingerprintText(identity.observedValue),
    normalizeFingerprintText(identity.source),
    normalizeFingerprintText(identity.subject.controlType),
    getStructuredSubjectIdentity(identity)
  ].join('|');
}

export function validateStructuredIdentity(
  identity: FindingStructuredIdentity,
  content: ExtractedPageContent
): boolean {
  const subject = identity.subject;

  if (subject.controlType === 'tab') {
    return content.tabs.some(
      control =>
        control.controlId === subject.controlId &&
        control.accessibleName === identity.observedValue &&
        (subject.componentId === null || control.tabListId === subject.componentId)
    );
  }

  return content.disclosures.some(
    control =>
      control.controlId === subject.controlId &&
      control.accessibleName === identity.observedValue &&
      (subject.componentId === null || control.ariaControls === subject.componentId)
  );
}

/*
 * Machine-readable evidence targets provide the strongest
 * available basis for run-level and cross-page identity.
 *
 * The real Aidoc issue, for example, becomes approximately:
 *
 *   target|select-option|country|equador
 */
export function createExploratoryFindingFingerprint(
  finding: ExploratoryQaFinding,
  content?: ExtractedPageContent,
  unstructuredDiscriminator = 'no-stable-identity'
): string {
  const target = finding.evidenceTarget;

  if (target !== null) {
    switch (target.kind) {
      case 'select-option':
        return createSelectOptionTargetFingerprint(target);

      case 'disclosure-state':
        return createDisclosureStateTargetFingerprint(target);

      case 'tab-state':
        return createTabStateTargetFingerprint(target);
    }
  }

  const technicalIdentity = finding.technicalIdentity ?? null;

  if (technicalIdentity !== null) {
    return createTechnicalObservationFingerprint(technicalIdentity);
  }

  const structuredIdentity = finding.structuredIdentity ?? null;

  if (
    structuredIdentity !== null &&
    (content === undefined || validateStructuredIdentity(structuredIdentity, content))
  ) {
    return createStructuredIdentityFingerprint(structuredIdentity);
  }

  /*
   * Generated prose is deliberately absent. Without validated structured
   * identity, the caller must supply an observation-scoped discriminator and
   * must not infer sameness from wording.
   */
  return ['unstructured', normalizeFingerprintText(unstructuredDiscriminator)].join('|');
}
