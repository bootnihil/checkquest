import type {
  DisclosureStateEvidenceTarget,
  ExploratoryQaFinding,
  SelectOptionEvidenceTarget
} from '../analysis/exploratory-qa-schema';

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
export function normalizeFingerprintText(
  value: string | null
): string {
  if (value === null) {
    return '';
  }

  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ' '
    )
    .trim()
    .replace(
      /\s+/g,
      ' '
    );
}

/*
 * Choose the most meaningful available identity for a
 * supported select control.
 *
 * Labels are preferred because they are normally the most
 * human-readable and stable across pages. The field name and
 * element ID are used only when no label is available.
 */
function getSelectControlIdentity(
  target: SelectControlIdentity
): string {
  const candidates = [
    target.controlLabel,
    target.controlName,
    target.controlId
  ];

  for (const candidate of candidates) {
    const normalizedCandidate =
      normalizeFingerprintText(
        candidate
      );

    if (
      normalizedCandidate.length >
      0
    ) {
      return normalizedCandidate;
    }
  }

  return 'unknown control';
}

export function createSelectOptionTargetFingerprint(
  target: SelectOptionEvidenceTarget
): string {
  return [
    'target',
    target.kind,
    getSelectControlIdentity(
      target
    ),
    normalizeFingerprintText(
      target.optionText
    )
  ].join('|');
}

export function createDisclosureStateTargetFingerprint(
  target:
    DisclosureStateEvidenceTarget
): string {
  return [
    'target',
    target.kind,
    normalizeFingerprintText(
      target.controlId
    ),
    normalizeFingerprintText(
      target.accessibleName
    ),
    normalizeFingerprintText(
      target.controlledRegionId
    ),
    target.desiredState
  ].join('|');
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
  finding: ExploratoryQaFinding
): string {
  const target =
    finding.evidenceTarget;

  if (target !== null) {
    switch (target.kind) {
      case 'select-option':
        return createSelectOptionTargetFingerprint(
          target
        );

      case 'disclosure-state':
        return createDisclosureStateTargetFingerprint(
          target
        );
    }
  }

  /*
   * Findings without a machine-readable target use a
   * deliberately conservative fallback.
   *
   * Category is retained here because, without structured
   * target information, it helps prevent unrelated findings
   * from being incorrectly merged.
   */
  return [
    'fallback',
    normalizeFingerprintText(
      finding.category
    ),
    normalizeFingerprintText(
      finding.title
    ),
    normalizeFingerprintText(
      finding.evidence
    )
  ].join('|');
}
