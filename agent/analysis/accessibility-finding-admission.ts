import type {
  AccessibilityEvidenceFact,
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from './exploratory-qa-schema';
import type {
  ExtractedPageContent,
  PageDisclosureControl,
  PageTabControl
} from '../browser/extracted-page-content';
import { validateStructuredIdentity } from '../investigation/finding-fingerprint';

type AccessibilityControl = PageDisclosureControl | PageTabControl;

interface ResolvedAccessibilityFact {
  found: boolean;
  value: string | boolean | null;
}

function resolveAccessibilityFact(
  fact: AccessibilityEvidenceFact,
  content: ExtractedPageContent
): ResolvedAccessibilityFact {
  const control: AccessibilityControl | undefined =
    fact.controlType === 'tab'
      ? content.tabs.find(item => item.controlId === fact.controlId)
      : content.disclosures.find(item => item.controlId === fact.controlId);

  if (control === undefined) {
    return {
      found: false,
      value: null
    };
  }

  switch (fact.property) {
    case 'visible-text':
      return {
        found: true,
        value: control.visibleText ?? null
      };

    case 'accessible-name':
      return {
        found: true,
        value: control.accessibleName
      };

    case 'aria-expanded':
      return 'ariaExpanded' in control
        ? {
            found: true,
            value: control.ariaExpanded
          }
        : {
            found: false,
            value: null
          };

    case 'aria-selected':
      return 'ariaSelected' in control
        ? {
            found: true,
            value: control.ariaSelected
          }
        : {
            found: false,
            value: null
          };

    case 'aria-controls':
      return {
        found: true,
        value: control.ariaControls
      };

    case 'controlled-content-exists':
      return {
        found: true,
        value:
          'controlledPanelExists' in control
            ? control.controlledPanelExists
            : control.controlledRegionExists
      };

    case 'controlled-content-visible':
      return {
        found: true,
        value:
          'controlledPanelVisible' in control
            ? control.controlledPanelVisible
            : control.controlledRegionVisible
      };
  }
}

function valuesAreEqual(left: string | boolean | null, right: string | boolean | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return (
    String(left).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim() ===
    String(right).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  );
}

function factMatchesPage(fact: AccessibilityEvidenceFact, content: ExtractedPageContent): boolean {
  const resolved = resolveAccessibilityFact(fact, content);

  return resolved.found && valuesAreEqual(resolved.value, fact.value);
}

function factsExpressConflict(
  left: AccessibilityEvidenceFact,
  right: AccessibilityEvidenceFact
): boolean {
  if (left.controlType !== right.controlType || left.controlId !== right.controlId) {
    return false;
  }

  const properties = new Set([left.property, right.property]);

  if (properties.has('visible-text') && properties.has('accessible-name')) {
    return !valuesAreEqual(left.value, right.value);
  }

  const stateProperty = left.controlType === 'tab' ? 'aria-selected' : 'aria-expanded';

  if (properties.has(stateProperty) && properties.has('controlled-content-visible')) {
    const stateFact = left.property === stateProperty ? left : right;
    const visibilityFact = left.property === 'controlled-content-visible' ? left : right;

    return (
      (stateFact.value === 'true' || stateFact.value === 'false') &&
      typeof visibilityFact.value === 'boolean' &&
      (stateFact.value === 'true') !== visibilityFact.value
    );
  }

  return false;
}

function hasConcreteDefectBasis(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent
): boolean {
  const basis = finding.accessibilityDefectBasis ?? null;

  if (basis === null || basis.supportingEvidence.some(fact => !factMatchesPage(fact, content))) {
    return false;
  }

  const hasMissingRequiredProperty = basis.supportingEvidence.some(
    fact =>
      fact.value === null &&
      ['accessible-name', 'aria-expanded', 'aria-selected'].includes(fact.property)
  );
  const hasInvalidRelationship = basis.supportingEvidence.some(
    fact => fact.property === 'controlled-content-exists' && fact.value === false
  );
  const hasConflictingValues = basis.supportingEvidence.some((left, leftIndex) =>
    basis.supportingEvidence.slice(leftIndex + 1).some(right => factsExpressConflict(left, right))
  );

  return hasMissingRequiredProperty || hasInvalidRelationship || hasConflictingValues;
}

function usesGroundedAccessibilityCapability(finding: ExploratoryQaFinding): boolean {
  if (finding.accessibilityDefectBasis !== null && finding.accessibilityDefectBasis !== undefined) {
    return true;
  }

  const target = finding.evidenceTarget;

  if (target?.kind === 'disclosure-state' || target?.kind === 'tab-state') {
    return true;
  }

  /*
   * The model-supplied mechanism is not a trusted capability signal.
   * Grounded routing is selected only by fields whose evidence is validated
   * independently below.
   */
  return false;
}

function isUnresolvedTemplateToken(value: string): boolean {
  const normalized = value.trim();

  return (
    /^\[#[\p{L}\p{N}_.:-]+#\]$/u.test(normalized) ||
    /^\{\{[^{}\r\n]+\}\}$/.test(normalized) ||
    /^\$\{[^{}\r\n]+\}$/.test(normalized)
  );
}

function hasRuntimeRecognizedUnresolvedTokenIdentity(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent | undefined
): boolean {
  const identity = finding.structuredIdentity ?? null;

  return (
    identity !== null &&
    content !== undefined &&
    validateStructuredIdentity(identity, content) &&
    isUnresolvedTemplateToken(identity.observedValue)
  );
}

function hasLegacySupportedAccessibilityShape(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent | undefined
): boolean {
  if (finding.evidenceTarget?.kind === 'select-option') {
    return true;
  }

  const identity = finding.structuredIdentity ?? null;

  if (identity !== null) {
    return hasRuntimeRecognizedUnresolvedTokenIdentity(finding, content);
  }

  if (finding.relatedRuleCode !== null && finding.relatedRuleCode !== undefined) {
    /*
     * Reconciliation remains authoritative for accepting the exact rule
     * relationship. Admission preserves the pre-Chunk-3 candidate shape
     * without granting the model-supplied rule reference any new authority.
     */
    return true;
  }

  return finding.evidenceTarget === null || finding.evidenceTarget === undefined;
}

function admitAccessibilityFinding(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent | undefined
): ExploratoryQaFinding | null {
  if (finding.category !== 'accessibility') {
    return finding;
  }

  if (usesGroundedAccessibilityCapability(finding)) {
    return content !== undefined && hasConcreteDefectBasis(finding, content) ? finding : null;
  }

  if (!hasLegacySupportedAccessibilityShape(finding, content)) {
    return null;
  }

  if (hasRuntimeRecognizedUnresolvedTokenIdentity(finding, content)) {
    return {
      ...finding,
      structuredIdentity: {
        ...finding.structuredIdentity!,
        /*
         * Admission owns this mechanism for the supported compatibility
         * shape. Downstream canonicalization and fingerprinting must not
         * retain the model's label for the same browser-backed observation.
         */
        mechanism: 'unresolved-token'
      }
    };
  }

  return finding;
}

export function admitAccessibilityFindings(
  analysis: ExploratoryQaAnalysis,
  content: ExtractedPageContent | undefined
): ExploratoryQaAnalysis {
  return {
    ...analysis,
    findings: analysis.findings.flatMap(finding => {
      const admitted = admitAccessibilityFinding(finding, content);

      return admitted === null ? [] : [admitted];
    })
  };
}
