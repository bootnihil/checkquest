import assert from 'node:assert/strict';

import { admitAccessibilityFindings } from './analysis/accessibility-finding-admission';
import { buildExploratoryQaPrompt } from './analysis/build-exploratory-qa-prompt';
import {
  exploratoryQaAnalysisSchema,
  exploratoryQaFindingSchema,
  type AccessibilityEvidenceFact,
  type ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import type {
  ExtractedPageContent,
  PageDisclosureControl,
  PageSelectControl,
  PageTabControl
} from './browser/extract-page-content';
import { reconcileFindingObservations } from './findings/reconcile-finding-observations';
import { createExploratoryFindingFingerprint } from './investigation/finding-fingerprint';

function createDisclosure(overrides: Partial<PageDisclosureControl> = {}): PageDisclosureControl {
  return {
    tagName: 'button',
    role: 'button',
    buttonType: 'button',
    controlId: 'product-disclosure',
    visibleText: 'Product',
    accessibleName: 'Product',
    ariaExpanded: 'false',
    ariaControls: 'product-panel',
    disabled: false,
    ariaDisabled: false,
    href: null,
    hasLinkSemantics: false,
    ariaHasPopup: null,
    formAssociated: false,
    formAncestor: false,
    hasSubmitOrResetSemantics: false,
    controlledRegionExists: true,
    controlledRegionVisible: false,
    controlledRegionHasEditableOrSubmissionControls: false,
    eligibleForDisclosureAction: true,
    eligibilityRejectionReasons: [],
    ...overrides
  };
}

function createContent(
  disclosure: PageDisclosureControl,
  overrides: Partial<ExtractedPageContent> = {}
): ExtractedPageContent {
  return {
    title: 'Synthetic accessibility fixture',
    headings: [],
    bodyText: '',
    links: [],
    buttons: [],
    textFields: [],
    selects: [],
    disclosures: [disclosure],
    tabs: [],
    ...overrides
  };
}

function createSelect(overrides: Partial<PageSelectControl> = {}): PageSelectControl {
  return {
    label: null,
    name: 'country',
    id: 'country',
    required: true,
    disabled: false,
    totalOptions: 2,
    optionsTruncated: false,
    options: [
      {
        text: 'Please select',
        value: '',
        selected: true
      },
      {
        text: 'Equador',
        value: 'Equador',
        selected: false
      }
    ],
    ...overrides
  };
}

function createTab(overrides: Partial<PageTabControl> = {}): PageTabControl {
  return {
    tagName: 'button',
    role: 'tab',
    controlId: 'details-tab',
    visibleText: 'Details',
    accessibleName: '[#DETAILS#]',
    tabListId: 'account-tabs',
    ariaSelected: 'false',
    ariaControls: 'details-panel',
    disabled: false,
    ariaDisabled: false,
    href: null,
    hasLinkSemantics: false,
    ariaHasPopup: null,
    formAssociated: false,
    formAncestor: false,
    hasSubmitOrResetSemantics: false,
    controlledPanelExists: true,
    controlledPanelRole: 'tabpanel',
    controlledPanelVisible: false,
    controlledPanelHasEditableOrSubmissionControls: false,
    eligibleForTabAction: true,
    eligibilityRejectionReasons: [],
    ...overrides
  };
}

function createAccessibilityFinding(
  supportingEvidence: AccessibilityEvidenceFact[],
  overrides: Partial<ExploratoryQaFinding> = {}
): ExploratoryQaFinding {
  return exploratoryQaFindingSchema.parse({
    knownFindingReference: null,
    relatedRuleCode: null,
    category: 'accessibility',
    severity: 'medium',
    confidence: 'medium',
    title: 'Synthetic accessibility concern',
    evidence: 'Synthetic structured control evidence.',
    reasoning: 'The supplied facts identify a concrete accessibility conflict.',
    suggestedCheck: 'Review the exact structured control state.',
    evidenceTarget: null,
    presentationTarget: null,
    structuredIdentity: null,
    accessibilityDefectBasis: {
      expectation:
        'The relevant accessibility properties should communicate the observed control consistently.',
      conflict: 'The supplied structured properties do not communicate the control consistently.',
      supportingEvidence
    },
    technicalEvidenceReferences: null,
    ...overrides
  });
}

function isAdmitted(finding: ExploratoryQaFinding, content: ExtractedPageContent): boolean {
  return (
    admitAccessibilityFindings(
      {
        findings: [finding],
        summary: 'Synthetic accessibility admission fixture.'
      },
      content
    ).findings.length === 1
  );
}

function getAdmittedFinding(
  finding: ExploratoryQaFinding,
  content: ExtractedPageContent
): ExploratoryQaFinding | null {
  return (
    admitAccessibilityFindings(
      {
        findings: [finding],
        summary: 'Synthetic accessibility admission fixture.'
      },
      content
    ).findings[0] ?? null
  );
}

function main(): void {
  /*
   * Case A is real-derived from the Monday /crm "Product" finding:
   * a visible/navigation label and accessible name that agree.
   */
  const neutralContent = createContent(createDisclosure());
  const neutralFinding = createAccessibilityFinding(
    [
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'visible-text',
        value: 'Product'
      },
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'accessible-name',
        value: 'Product'
      }
    ],
    {
      title: 'Accessibility semantics in disclosure accessible name',
      evidence: 'The disclosure has the accessible name "Product".',
      reasoning: 'This may violate WAI-ARIA and affect screen-reader users.'
    }
  );

  assert.equal(
    isAdmitted(neutralFinding, neutralContent),
    false,
    'Case A: a neutral accessible-name property must not be admitted as a defect.'
  );

  const incompleteOriginalProductFinding = {
    ...neutralFinding,
    structuredIdentity: {
      mechanism: 'accessibility-semantics' as const,
      observedValue: 'Product',
      source: 'accessible-name' as const,
      subject: {
        kind: 'semantic-control' as const,
        controlType: 'disclosure' as const,
        controlId: 'product-disclosure',
        componentId: 'product-panel',
        locator: null
      }
    },
    accessibilityDefectBasis: null
  };

  assert.equal(
    isAdmitted(incompleteOriginalProductFinding, neutralContent),
    false,
    'The original structured Product hypothesis must fail closed when its grounded basis is missing.'
  );

  // Case B is synthetic: an interactive disclosure has no usable name.
  const missingNameContent = createContent(
    createDisclosure({
      visibleText: null,
      accessibleName: null,
      eligibleForDisclosureAction: false,
      eligibilityRejectionReasons: ['an accessible name is required']
    })
  );
  const missingNameFinding = createAccessibilityFinding([
    {
      controlType: 'disclosure',
      controlId: 'product-disclosure',
      property: 'accessible-name',
      value: null
    }
  ]);

  assert.equal(
    isAdmitted(missingNameFinding, missingNameContent),
    true,
    'Case B: a missing accessible name must remain eligible.'
  );

  // Case C is synthetic: visible and accessible labels materially conflict.
  const mismatchedNameContent = createContent(
    createDisclosure({
      accessibleName: 'Delete account'
    })
  );
  const mismatchedNameFinding = createAccessibilityFinding(
    [
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'visible-text',
        value: 'Product'
      },
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'accessible-name',
        value: 'Delete account'
      }
    ],
    {
      title: 'Accessible name conflicts with visible label',
      evidence: 'The visible label is "Product", while the accessible name is "Delete account".',
      structuredIdentity: {
        mechanism: 'unexpected-value',
        observedValue: 'Delete account',
        source: 'accessible-name',
        subject: {
          kind: 'semantic-control',
          controlType: 'disclosure',
          controlId: 'product-disclosure',
          componentId: 'product-panel',
          locator: null
        }
      }
    }
  );

  assert.equal(
    isAdmitted(mismatchedNameFinding, mismatchedNameContent),
    true,
    'Case C: a material visible/accessibility label mismatch must remain eligible.'
  );

  // Case D is synthetic: collapsed state contradicts visible controlled content.
  const contradictoryStateContent = createContent(
    createDisclosure({
      ariaExpanded: 'false',
      controlledRegionVisible: true
    })
  );
  const contradictoryStateFinding = createAccessibilityFinding([
    {
      controlType: 'disclosure',
      controlId: 'product-disclosure',
      property: 'aria-expanded',
      value: 'false'
    },
    {
      controlType: 'disclosure',
      controlId: 'product-disclosure',
      property: 'controlled-content-visible',
      value: true
    }
  ]);

  assert.equal(
    isAdmitted(contradictoryStateFinding, contradictoryStateContent),
    true,
    'Case D: contradictory semantic and visible state must remain eligible.'
  );

  // Case E is synthetic: standards rhetoric plus one neutral property.
  const rhetoricFinding = createAccessibilityFinding(
    [
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'accessible-name',
        value: 'Product'
      }
    ],
    {
      reasoning: 'This may violate WAI-ARIA and affect screen-reader users.'
    }
  );

  assert.equal(
    isAdmitted(rhetoricFinding, neutralContent),
    false,
    'Case E: generic standards rhetoric cannot replace a concrete defect basis.'
  );

  const unrelatedFactsFinding = createAccessibilityFinding([
    {
      controlType: 'disclosure',
      controlId: 'product-disclosure',
      property: 'aria-expanded',
      value: 'false'
    },
    {
      controlType: 'disclosure',
      controlId: 'product-disclosure',
      property: 'aria-controls',
      value: 'product-panel'
    }
  ]);

  assert.equal(
    isAdmitted(unrelatedFactsFinding, neutralContent),
    false,
    'Case E: two exact but unrelated neutral properties cannot manufacture a conflict.'
  );

  /*
   * Synthetic precision fixture: a supported disclosure-state candidate that
   * omits its required grounded basis must fail closed instead of falling
   * through to legacy compatibility.
   */
  const incompleteGroundedFinding = createAccessibilityFinding([], {
    evidenceTarget: {
      kind: 'disclosure-state',
      controlId: 'product-disclosure',
      accessibleName: 'Product',
      controlledRegionId: 'product-panel',
      desiredState: 'expanded'
    },
    accessibilityDefectBasis: null
  });

  assert.equal(
    isAdmitted(incompleteGroundedFinding, neutralContent),
    false,
    'A supported grounded target with a missing basis must not escape through legacy compatibility.'
  );

  /*
   * The same fail-closed rule applies to tab-state. Include an otherwise
   * compatibility-eligible token identity so this fixture proves that the
   * grounded target cannot fall through to token compatibility.
   */
  const tokenTab = createTab();
  const tabContent = createContent(createDisclosure(), {
    tabs: [tokenTab]
  });
  const incompleteTabStateFinding = createAccessibilityFinding([], {
    evidenceTarget: {
      kind: 'tab-state',
      controlId: tokenTab.controlId!,
      accessibleName: tokenTab.accessibleName!,
      tabListId: tokenTab.tabListId!,
      controlledPanelId: tokenTab.ariaControls!,
      desiredState: 'selected'
    },
    structuredIdentity: {
      mechanism: 'unresolved-token',
      observedValue: tokenTab.accessibleName!,
      source: 'accessible-name',
      subject: {
        kind: 'semantic-control',
        controlType: 'tab',
        controlId: tokenTab.controlId!,
        componentId: tokenTab.tabListId,
        locator: null
      }
    },
    accessibilityDefectBasis: null
  });

  assert.equal(
    isAdmitted(incompleteTabStateFinding, tabContent),
    false,
    'A malformed tab-state target must reject without falling through to an otherwise eligible token identity.'
  );

  /*
   * Synthetic compatibility fixture: select-option was a structured target
   * before Chunk 3, but select accessibility facts are outside the current
   * grounded tab/disclosure vocabulary.
   */
  const selectContent = createContent(createDisclosure(), {
    selects: [createSelect()]
  });
  const selectCompatibilityFinding = createAccessibilityFinding([], {
    title: 'Select control requires label review',
    evidence: 'The structured select control has no extracted label.',
    evidenceTarget: {
      kind: 'select-option',
      controlLabel: null,
      controlName: 'country',
      controlId: 'country',
      optionText: 'Equador'
    },
    accessibilityDefectBasis: null
  });

  assert.equal(
    isAdmitted(selectCompatibilityFinding, selectContent),
    true,
    'A pre-Chunk-3 structured select-backed accessibility candidate must retain its conservative path.'
  );
  assert.equal(
    admitAccessibilityFindings(
      {
        findings: [
          {
            ...selectCompatibilityFinding,
            category: 'content'
          }
        ],
        summary: 'Synthetic category-symmetry fixture.'
      },
      selectContent
    ).findings.length,
    1,
    'The same supported select shape must not disappear solely when categorized as accessibility.'
  );

  /*
   * Synthetic compatibility fixture derived from the pre-Chunk-3 structured
   * identity check: an exact unresolved token remains a conservative finding.
   */
  const tokenContent = createContent(
    createDisclosure({
      visibleText: 'Settings',
      accessibleName: '[#IABV2SETTINGS#]'
    })
  );
  const tokenCompatibilityFinding = createAccessibilityFinding([], {
    title: 'Unresolved token in disclosure accessible name',
    evidence: 'The disclosure accessible name is "[#IABV2SETTINGS#]".',
    structuredIdentity: {
      mechanism: 'unresolved-token',
      observedValue: '[#IABV2SETTINGS#]',
      source: 'accessible-name',
      subject: {
        kind: 'semantic-control',
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        componentId: 'product-panel',
        locator: null
      }
    },
    accessibilityDefectBasis: null
  });

  assert.equal(
    isAdmitted(tokenCompatibilityFinding, tokenContent),
    true,
    'A browser-grounded unresolved-token identity must retain its pre-Chunk-3 path.'
  );

  const modelMechanisms = ['unresolved-token', 'unexpected-value', 'other'] as const;
  const admittedTokenVariants = modelMechanisms.map(mechanism => {
    const admitted = getAdmittedFinding(
      {
        ...tokenCompatibilityFinding,
        structuredIdentity: {
          ...tokenCompatibilityFinding.structuredIdentity!,
          mechanism
        }
      },
      tokenContent
    );

    assert.ok(
      admitted,
      `The browser-backed token observation must be admitted when the model proposes "${mechanism}".`
    );
    assert.equal(
      admitted.structuredIdentity?.mechanism,
      'unresolved-token',
      'Admission must replace the model label with the runtime-recognized token mechanism.'
    );

    return admitted;
  });

  assert.equal(
    new Set(
      admittedTokenVariants.map(finding =>
        createExploratoryFindingFingerprint(finding, tokenContent)
      )
    ).size,
    1,
    'The runtime-recognized token fingerprint must be stable across model mechanism labels.'
  );

  const reconciledTokenVariants = admittedTokenVariants.map((finding, index) =>
    reconcileFindingObservations({
      pageUrl: `https://example.com/runtime-token-${index + 1}`,
      pageTitle: 'Synthetic runtime token fixture',
      ruleFindings: [],
      modelFindings: [finding],
      pageContent: tokenContent
    })
  );
  const reconciledTokenFingerprints = reconciledTokenVariants.map(
    result => result.modelReconciliations[0]?.fingerprint
  );

  assert.ok(
    reconciledTokenFingerprints.every(fingerprint =>
      fingerprint?.startsWith('identity|unresolved token|')
    ),
    'Reconciliation must fingerprint the runtime-owned token mechanism.'
  );
  assert.equal(
    new Set(reconciledTokenFingerprints).size,
    1,
    'Reconciliation must retain one canonical identity for the same runtime-recognized token.'
  );
  assert.deepEqual(
    reconciledTokenVariants.map(result => result.findings[0]?.title),
    modelMechanisms.map(() => 'Unresolved token in disclosure accessible name'),
    'Canonical observation wording must not drift with the model mechanism label.'
  );

  assert.equal(
    isAdmitted(
      {
        ...tokenCompatibilityFinding,
        structuredIdentity: {
          ...tokenCompatibilityFinding.structuredIdentity!,
          observedValue: 'Product'
        }
      },
      neutralContent
    ),
    false,
    'A false unresolved-token label must not create a legacy escape hatch for Product.'
  );

  assert.equal(
    isAdmitted(
      {
        ...tokenCompatibilityFinding,
        accessibilityDefectBasis: {
          expectation: 'The accessible name should be meaningful.',
          conflict: 'The model claims the exact accessible name is defective.',
          supportingEvidence: [
            {
              controlType: 'disclosure',
              controlId: 'product-disclosure',
              property: 'accessible-name',
              value: '[#IABV2SETTINGS#]'
            }
          ]
        }
      },
      tokenContent
    ),
    false,
    'A neutral grounded basis must reject without falling through to runtime token compatibility.'
  );

  /*
   * Synthetic compatibility fixture: genuinely unstructured accessibility
   * candidates retain their old observation-scoped, inconclusive path.
   */
  const unstructuredCompatibilityFinding = createAccessibilityFinding([], {
    title: 'Legacy unstructured accessibility concern',
    evidence: 'A supplied page observation warrants human accessibility review.',
    structuredIdentity: null,
    evidenceTarget: null,
    accessibilityDefectBasis: null
  });
  const admittedUnstructured = admitAccessibilityFindings(
    {
      findings: [unstructuredCompatibilityFinding],
      summary: 'Synthetic unstructured compatibility fixture.'
    },
    neutralContent
  );
  const reconciledUnstructured = reconcileFindingObservations({
    pageUrl: 'https://example.com/synthetic-unstructured',
    pageTitle: 'Synthetic unstructured fixture',
    ruleFindings: [],
    modelFindings: admittedUnstructured.findings,
    pageContent: neutralContent
  });

  assert.equal(
    admittedUnstructured.findings.length,
    1,
    'A pre-Chunk-3 unstructured accessibility candidate must not be globally erased.'
  );
  assert.equal(
    reconciledUnstructured.findings[0]?.verification.state,
    'inconclusive',
    'Legacy unstructured compatibility must not upgrade verification.'
  );

  /*
   * Synthetic precedence fixture: a select target is legacy-compatible, but
   * the supplied tab/disclosure basis makes the grounded gate authoritative.
   */
  const groundedPrecedenceFinding = createAccessibilityFinding(
    [
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'visible-text',
        value: 'Product'
      },
      {
        controlType: 'disclosure',
        controlId: 'product-disclosure',
        property: 'accessible-name',
        value: 'Product'
      }
    ],
    {
      evidenceTarget: selectCompatibilityFinding.evidenceTarget
    }
  );

  assert.equal(
    isAdmitted(groundedPrecedenceFinding, selectContent),
    false,
    'A neutral grounded basis must reject even when the candidate also has a legacy-compatible select target.'
  );

  /*
   * Synthetic rule-compatibility fixture: admission preserves the old shape;
   * reconciliation remains responsible for validating exact rule identity.
   */
  const ruleFinding = {
    code: 'NO_PRIMARY_HEADINGS',
    severity: 'low' as const,
    title: 'No H1 or H2 headings were found',
    evidence: 'The page contained no visible text collected from H1 or H2 elements.',
    url: 'https://example.com/synthetic-rule'
  };
  const ruleCompatibilityFinding = createAccessibilityFinding([], {
    relatedRuleCode: ruleFinding.code,
    title: ruleFinding.title,
    evidence: ruleFinding.evidence,
    accessibilityDefectBasis: null
  });
  const admittedRule = admitAccessibilityFindings(
    {
      findings: [ruleCompatibilityFinding],
      summary: 'Synthetic exact-rule compatibility fixture.'
    },
    neutralContent
  );
  const reconciledRule = reconcileFindingObservations({
    pageUrl: ruleFinding.url,
    pageTitle: 'Synthetic rule fixture',
    ruleFindings: [ruleFinding],
    modelFindings: admittedRule.findings,
    pageContent: neutralContent
  });

  assert.equal(
    admittedRule.findings.length,
    1,
    'A pre-Chunk-3 rule-backed accessibility observation must reach reconciliation.'
  );
  assert.equal(
    reconciledRule.modelReconciliations[0]?.acceptedRelatedRuleCode,
    'NO_PRIMARY_HEADINGS',
    'Reconciliation must retain authority for exact deterministic-rule correlation.'
  );
  assert.equal(
    isAdmitted(
      {
        ...ruleCompatibilityFinding,
        accessibilityDefectBasis: neutralFinding.accessibilityDefectBasis
      },
      neutralContent
    ),
    false,
    'An exact rule reference must not bypass a neutral grounded-basis rejection.'
  );

  /*
   * Case F is synthetic: a concrete mismatch is admitted, but model evidence
   * alone retains the existing inconclusive verification state.
   */
  const admittedInconclusive = admitAccessibilityFindings(
    {
      findings: [mismatchedNameFinding],
      summary: 'Synthetic inconclusive accessibility fixture.'
    },
    mismatchedNameContent
  );
  const reconciled = reconcileFindingObservations({
    pageUrl: 'https://example.com/synthetic-accessibility',
    pageTitle: 'Synthetic accessibility fixture',
    ruleFindings: [],
    modelFindings: admittedInconclusive.findings,
    pageContent: mismatchedNameContent
  });

  assert.equal(
    reconciled.findings[0]?.verification.state,
    'inconclusive',
    'Case F: a legitimate admitted concern may remain inconclusive.'
  );
  assert.equal(
    reconciled.findings[0]?.title,
    'Accessible name conflicts with visible label',
    'An admitted accessibility basis must not be collapsed back to a neutral property title.'
  );
  assert.equal(
    reconciled.findings[0]?.occurrences[0]?.evidence[0]?.summary,
    'The visible label is "Product", while the accessible name is "Delete account".',
    'An admitted accessibility basis must preserve its concrete conflict observation.'
  );

  const prompt = buildExploratoryQaPrompt({
    observation: {
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      title: 'Synthetic accessibility fixture',
      httpStatus: 200,
      headings: []
    },
    content: neutralContent,
    classifiedDiagnostics: {
      consoleErrors: [],
      failedRequests: []
    },
    ruleBasedFindings: []
  });

  assert.match(prompt, /A neutral property is not a defect basis by itself\./);
  assert.match(prompt, /Generic references to WCAG, WAI-ARIA, assistive technology/);
  assert.match(prompt, /"accessibilityDefectBasis": null/);

  assert.equal(
    exploratoryQaAnalysisSchema.safeParse(admittedInconclusive).success,
    true,
    'The admitted synthetic analysis must retain the public response schema.'
  );

  console.log(
    'Accessibility admission precision, compatibility, precedence, and cases A-F passed.'
  );
}

main();
