import assert from 'node:assert/strict';

import type {
  ExploratoryQaFinding,
  FindingStructuredIdentity
} from '../../agent/analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../../agent/browser/extracted-page-content';
import { reconcileFindingObservations } from '../../agent/findings/reconcile-finding-observations';
import {
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  registerUnifiedPageFindings
} from '../../agent/findings/unified-finding-registry';
import {
  createExploratoryFindingFingerprint,
  createStructuredIdentityFingerprint,
  validateStructuredIdentity
} from '../../agent/investigation/finding-fingerprint';

function createContent(
  controls: {
    controlId: string;
    accessibleName: string;
    tabListId: string | null;
  }[]
): ExtractedPageContent {
  return {
    title: 'Settings',
    headings: [],
    bodyText: '',
    links: [],
    buttons: [],
    textFields: [],
    selects: [],
    disclosures: [],
    tabs: controls.map(control => ({
      tagName: 'button',
      role: 'tab',
      controlId: control.controlId,
      accessibleName: control.accessibleName,
      tabListId: control.tabListId,
      ariaSelected: 'false',
      ariaControls: null,
      disabled: false,
      ariaDisabled: false,
      href: null,
      hasLinkSemantics: false,
      ariaHasPopup: null,
      formAssociated: false,
      formAncestor: false,
      hasSubmitOrResetSemantics: false,
      controlledPanelExists: false,
      controlledPanelRole: null,
      controlledPanelVisible: null,
      controlledPanelHasEditableOrSubmissionControls: null,
      eligibleForTabAction: false,
      eligibilityRejectionReasons: ['Synthetic non-actionable tab.']
    }))
  };
}

function createIdentity(
  overrides: Partial<FindingStructuredIdentity> = {}
): FindingStructuredIdentity {
  return {
    mechanism: 'unresolved-token',
    observedValue: '[#IABV2SETTINGS#]',
    source: 'accessible-name',
    subject: {
      kind: 'semantic-control',
      controlType: 'tab',
      controlId: 'CybotCookiebotDialogNavAdSettings',
      componentId: 'CybotCookiebotDialogNav',
      locator: '#first-page-locator'
    },
    ...overrides
  };
}

function createFinding(identity: FindingStructuredIdentity, wording: string): ExploratoryQaFinding {
  return {
    category: 'content',
    severity: 'low',
    confidence: 'high',
    title: wording,
    evidence: `${wording} evidence`,
    reasoning: `${wording} reasoning`,
    suggestedCheck: `${wording} check`,
    evidenceTarget: null,
    presentationTarget: null,
    structuredIdentity: identity
  };
}

function main(): void {
  const content = createContent([
    {
      controlId: 'CybotCookiebotDialogNavAdSettings',
      accessibleName: '[#IABV2SETTINGS#]',
      tabListId: 'CybotCookiebotDialogNav'
    },
    {
      controlId: 'unrelated-control',
      accessibleName: '[#IABV2SETTINGS#]',
      tabListId: 'unrelated-component'
    }
  ]);
  const identity = createIdentity();

  assert.equal(
    validateStructuredIdentity(identity, content),
    true,
    'A. exact browser-extracted semantic identity is accepted'
  );

  const wordingDrift = reconcileFindingObservations({
    pageUrl: 'https://example.com/page-a',
    pageTitle: 'Page A',
    pageContent: content,
    ruleFindings: [],
    modelFindings: [
      createFinding(identity, 'Unrendered placeholder'),
      createFinding(
        {
          ...identity,
          subject: {
            ...identity.subject,
            locator: '#different-page-locator'
          }
        },
        'Template token appears in accessibility label'
      )
    ]
  });

  assert.equal(
    wordingDrift.findings.length,
    1,
    'B. generated title/evidence wording and locator drift cannot split one structured issue'
  );
  assert.equal(
    wordingDrift.findings[0]?.title,
    'Unresolved token in tab accessible name',
    'C. canonical title is generated once from validated evidence semantics'
  );
  assert.match(
    wordingDrift.findings[0]?.occurrences[0]?.evidence[0]?.summary ?? '',
    /accessible name/i,
    'D. canonical observation distinguishes an accessible name from visible text'
  );
  assert.doesNotMatch(
    wordingDrift.findings[0]?.occurrences[0]?.evidence[0]?.summary ?? '',
    /\b(?:shown|displayed|visible|rendered)\b/i,
    'Accessibility-only evidence does not become an unsupported visual claim.'
  );
  assert.equal(
    wordingDrift.findings[0]?.verification.state,
    'inconclusive',
    'Canonicalization and stronger prose do not change verification state.'
  );

  const registry = createUnifiedFindingRegistry();

  for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
    const pageFinding = createFinding(
      {
        ...identity,
        subject: {
          ...identity.subject,
          locator: `#page-${pageNumber}-locator`
        }
      },
      `Generated wording variant ${pageNumber}`
    );
    const pageReconciliation = reconcileFindingObservations({
      pageUrl: `https://example.com/page-${pageNumber}`,
      pageTitle: `Page ${pageNumber}`,
      pageContent: content,
      ruleFindings: [],
      modelFindings: [pageFinding]
    });

    registerUnifiedPageFindings(registry, pageReconciliation.findings);
  }

  const sixPageFindings = getUnifiedFindings(registry);

  assert.equal(
    sixPageFindings.length,
    1,
    'E. six pages with wording and locator drift produce one canonical finding'
  );
  assert.equal(
    sixPageFindings[0]?.occurrences.length,
    6,
    'F. the canonical finding preserves six affected-page occurrences'
  );

  const sharedComponentOtherControl = createIdentity({
    subject: {
      ...identity.subject,
      controlId: 'dynamic-page-control',
      locator: '#dynamic'
    }
  });

  assert.equal(
    createStructuredIdentityFingerprint(identity),
    createStructuredIdentityFingerprint(sharedComponentOtherControl),
    'G. a shared stable component, mechanism, value, and role can reconcile despite page-specific control locators'
  );

  const unrelatedComponent = createIdentity({
    subject: {
      ...identity.subject,
      controlId: 'unrelated-control',
      componentId: 'unrelated-component'
    }
  });

  assert.notEqual(
    createStructuredIdentityFingerprint(identity),
    createStructuredIdentityFingerprint(unrelatedComponent),
    'H. the same text in unrelated components remains separate'
  );

  assert.notEqual(
    createStructuredIdentityFingerprint(identity),
    createStructuredIdentityFingerprint(
      createIdentity({
        observedValue: '[#OTHER_TOKEN#]'
      })
    ),
    'I. different observed tokens remain separate'
  );

  assert.notEqual(
    createStructuredIdentityFingerprint(identity),
    createStructuredIdentityFingerprint(
      createIdentity({
        mechanism: 'state-mismatch'
      })
    ),
    'J. different defects on the same control remain separate'
  );

  assert.notEqual(
    createExploratoryFindingFingerprint(createFinding(identity, 'Same title')),
    createExploratoryFindingFingerprint(createFinding(unrelatedComponent, 'Same title')),
    'K. similar titles with different structured evidence remain separate'
  );

  const invalid = createFinding(
    createIdentity({
      observedValue: 'invented value'
    }),
    'Invented identity'
  );
  const rejected = reconcileFindingObservations({
    pageUrl: 'https://example.com/',
    pageTitle: 'Example',
    pageContent: content,
    ruleFindings: [],
    modelFindings: [invalid]
  });

  assert.equal(
    rejected.modelReconciliations[0]?.matchingBasis,
    'fallback-fingerprint',
    'L. structured identity not found in current browser evidence is rejected'
  );

  console.log('Structured finding identity check passed.');
}

main();
