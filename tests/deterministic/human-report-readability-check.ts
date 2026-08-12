import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseModelJsonResponse } from '../../agent/ai/parse-model-json-response';
import { sanitizeApplicationError } from '../../agent/application/sanitize-application-boundary';
import {
  exploratoryQaFindingSchema,
  findingStructuredIdentitySchema
} from '../../agent/analysis/exploratory-qa-schema';
import { createTechnicalObservationFingerprint } from '../../agent/analysis/technical-observation-reconciliation';
import { CheckQuestError, formatPublicError } from '../../agent/errors/checkquest-error';
import { formatDeveloperErrorDiagnostic } from '../../agent/errors/format-developer-diagnostic';
import type { FindingEvidence, UnifiedFinding } from '../../agent/findings/finding-model';
import { createStructuredIdentityFingerprint } from '../../agent/investigation/finding-fingerprint';
import {
  determineHumanNarrativeRoute,
  enrichSiteAgentReportWithHumanNarratives,
  exploratoryHumanNarrativeSchema,
  validateGeneratedHumanNarrative,
  type ExploratoryHumanNarrativeInput,
  type ExploratoryHumanNarrativeOutput,
  type HumanNarrativeGenerator
} from '../../agent/reporting/human-narrative-generation';
import {
  buildHumanReportPresentation,
  getHumanReaderStatus
} from '../../agent/reporting/human-report-model';
import { persistSiteAgentReport } from '../../agent/reporting/persist-site-agent-report';
import type { SiteAgentReportV4 } from '../../agent/reporting/report-types';
import { renderHumanMarkdownReport } from '../../agent/reporting/write-markdown-report';
import type { PassiveSecurityObservation } from '../../agent/security/passive-security-model';

function modelEvidence(
  index: number,
  input: {
    title: string;
    evidence: string;
    reasoning: string;
    category?: UnifiedFinding['category'];
    structuredIdentity?: unknown;
    technicalIdentity?: unknown;
  }
): FindingEvidence {
  const structuredIdentity =
    input.structuredIdentity === undefined
      ? null
      : findingStructuredIdentitySchema.parse(input.structuredIdentity);
  const parsed = exploratoryQaFindingSchema.parse({
    knownFindingReference: null,
    relatedRuleCode: null,
    category: input.category ?? 'content',
    severity: 'low',
    confidence: 'medium',
    title: input.title,
    evidence: input.evidence,
    reasoning: input.reasoning,
    suggestedCheck: 'Review the condition on the affected page.',
    evidenceTarget: null,
    presentationTarget: null,
    structuredIdentity,
    accessibilityDefectBasis:
      structuredIdentity === null
        ? null
        : {
            expectation: 'The control needs a meaningful label.',
            conflict: 'The current label is an unresolved token.',
            supportingEvidence: [
              {
                controlType: structuredIdentity.subject.controlType,
                controlId: structuredIdentity.subject.controlId,
                property: 'accessible-name',
                value: structuredIdentity.observedValue
              }
            ]
          },
    technicalEvidenceReferences:
      input.technicalIdentity === undefined ? null : ['technical-request-1'],
    technicalIdentity: input.technicalIdentity ?? null
  });

  return {
    evidenceReference: `evidence-${index}-model`,
    source: 'model',
    kind: 'model-observation',
    relation: 'inconclusive',
    verificationCapable: false,
    summary: input.evidence,
    rawReference: { pageNumber: 1, candidateReference: `candidate-${index}` },
    rawSource: { type: 'exploratory-qa-finding', value: parsed }
  };
}

function createFinding(
  index: number,
  input: {
    title: string;
    evidence: string;
    reasoning: string;
    category?: UnifiedFinding['category'];
    state?: UnifiedFinding['verification']['state'];
    structuredIdentity?: unknown;
    technicalIdentity?: Parameters<typeof createTechnicalObservationFingerprint>[0];
    browserBacked?: boolean;
  }
): UnifiedFinding {
  const structuredIdentity =
    input.structuredIdentity === undefined
      ? null
      : findingStructuredIdentitySchema.parse(input.structuredIdentity);
  const evidence = [
    modelEvidence(index, {
      ...input,
      technicalIdentity: input.technicalIdentity
    })
  ];

  if (input.browserBacked === true) {
    evidence.push({
      evidenceReference: `evidence-${index}-browser`,
      source: 'browser',
      kind: 'browser-observation',
      relation: 'inconclusive',
      verificationCapable: false,
      summary: 'The browser captured the referenced page values.'
    });
  }

  const state = input.state ?? 'inconclusive';

  return {
    findingReference: `finding-${index}`,
    fingerprint:
      input.technicalIdentity === undefined
        ? structuredIdentity === null
          ? `readability-fingerprint-${index}`
          : createStructuredIdentityFingerprint(structuredIdentity)
        : createTechnicalObservationFingerprint(input.technicalIdentity),
    category: input.category ?? 'content',
    severity: 'low',
    title: input.title,
    description: input.reasoning,
    suggestedCheck: 'Review the condition on the affected page.',
    occurrences: [
      {
        occurrenceReference: `occurrence-${index}`,
        pageUrl: 'https://example.com/settings',
        pageTitle: 'Settings',
        target: null,
        evidence,
        verification: { state, reason: 'Synthetic final state.', evidenceReferences: [] },
        screenshotReferences: [],
        redundantInvestigationSkipped: false
      }
    ],
    verification: { state, reason: 'Synthetic final state.', evidenceReferences: [] }
  };
}

function securityObservation(
  index: number,
  code: string,
  title: string,
  description: string,
  headerName: 'content-security-policy' | 'server' | 'x-powered-by',
  headerValues: string[]
): PassiveSecurityObservation {
  return {
    observationReference: `security-observation-${index}`,
    fingerprint: `security-${index}`,
    code,
    category:
      headerName === 'content-security-policy' ? 'response-policy' : 'technology-disclosure',
    posture: headerName === 'content-security-policy' ? 'defense-in-depth-gap' : 'informational',
    severity: headerName === 'content-security-policy' ? 'low' : 'info',
    confidence: 'high',
    source: 'deterministic-passive',
    scope: { type: 'origin', key: 'https://example.com' },
    subject: headerName,
    title,
    description,
    remediation: null,
    occurrences: [
      {
        pageUrl: 'https://example.com/settings',
        pageTitle: 'Settings',
        responseUrl: 'https://example.com/settings',
        evidence: [
          {
            kind: 'response-header',
            subject: headerName,
            summary: `${headerName} evidence.`,
            headerName,
            headerValues
          }
        ]
      }
    ]
  };
}

function createAcceptanceReport(): SiteAgentReportV4 {
  const tab = createFinding(1, {
    title: 'Unresolved accessibility label token',
    evidence: 'The tab control has the accessible name "[#IABV2SETTINGS#]".',
    reasoning: 'The unresolved token is not a meaningful control label.',
    category: 'accessibility',
    state: 'verified',
    structuredIdentity: {
      mechanism: 'unresolved-token',
      observedValue: '[#IABV2SETTINGS#]',
      source: 'accessible-name',
      subject: {
        kind: 'semantic-control',
        controlType: 'tab',
        controlId: 'CybotCookiebotDialogNavAdSettings',
        componentId: 'CybotCookiebotDialogNavAd',
        locator: '#CybotCookiebotDialogNavAdSettings'
      }
    }
  });
  const imageIdentity = {
    kind: 'console-error' as const,
    message: 'Failed to load resource: the server responded with a status of 404',
    source: 'resource' as const,
    sourceUrl: 'https://example.com/assets/hero-image.jpg',
    httpStatus: 404
  };
  const image = createFinding(2, {
    title: 'Failed resource request for hero image',
    evidence: 'The image request returned HTTP 404.',
    reasoning: 'The browser recorded a failed image response.',
    category: 'technical',
    technicalIdentity: imageIdentity
  });
  const ecuador = createFinding(3, {
    title: 'Possible duplicate country option',
    evidence: 'The country list contains both "Ecuador" and "Equador".',
    reasoning: 'This may cause confusion.',
    browserBacked: true
  });
  const aiOnly = createFinding(4, {
    title: 'Possible stale checkout total',
    evidence: 'The checkout total may not update after quantity changes.',
    reasoning: 'The model noticed wording that could indicate a stale total.'
  });
  const script = createFinding(5, {
    title: 'Failed resource request for application script',
    evidence: 'The script request failed in browser network data.',
    reasoning: 'The browser recorded a failed script request.',
    category: 'technical',
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_FAILED',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://example.com/assets/application.js',
      originRelation: 'same-origin'
    }
  });
  const observations = [
    securityObservation(
      1,
      'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED',
      'Enforcing CSP response header was not observed',
      'No enforcing Content-Security-Policy response header was observed.',
      'content-security-policy',
      []
    ),
    securityObservation(
      2,
      'PS_TECHNOLOGY_DISCLOSURE',
      'Server response header was observed',
      'The Server header disclosed technology information.',
      'server',
      ['cloudflare']
    ),
    securityObservation(
      3,
      'PS_TECHNOLOGY_DISCLOSURE',
      'X-Powered-By response header was observed',
      'The X-Powered-By header disclosed platform information.',
      'x-powered-by',
      ['WP Engine']
    )
  ];

  return {
    reportSchemaVersion: '4',
    humanNarratives: { state: 'pending', exploratory: [] },
    runId: 'human-readability-acceptance',
    startedAt: '2026-08-10T10:00:00.000Z',
    finishedAt: '2026-08-10T10:00:03.000Z',
    site: { id: 'example', name: 'Example', startUrl: 'https://example.com/settings' },
    homepage: {
      requestedUrl: 'https://example.com/settings',
      finalUrl: 'https://example.com/settings',
      title: 'Settings',
      httpStatus: 200
    },
    outcome: { type: 'finished', summary: 'The planned inspection completed.' },
    inspectedPages: [
      {
        observation: {
          finalUrl: 'https://example.com/settings',
          title: 'Settings'
        },
        selection: { type: 'start-url' }
      }
    ] as unknown as SiteAgentReportV4['inspectedPages'],
    findings: [tab, image, ecuador, aiOnly, script],
    siteWideExploratoryFindings: [],
    passiveSecurity: {
      mode: 'passive-observation-only',
      disclaimer:
        'CheckQuest observed normal browser responses only. It did not attempt to exploit the site.',
      pageSnapshots: [],
      observations,
      summary: {
        observationsCount: 3,
        bySeverity: { medium: 0, low: 1, info: 2 },
        byCategory: {
          transport: 0,
          'response-policy': 1,
          'frame-protection': 0,
          'technology-disclosure': 2,
          cookie: 0,
          'request-inventory': 0,
          infrastructure: 0
        },
        originsObserved: 1
      }
    },
    summary: {
      pagesInspected: 1,
      logicalFindingsCount: 5,
      findingOccurrencesCount: 5,
      findingsCount: 5,
      highestSeverity: 'low',
      exploratoryQaFindingsCount: 5,
      siteWideExploratoryFindingsCount: 5,
      knownFindingOccurrencesCount: 0,
      knownFindingsSuppliedToAnalysisCount: 0,
      newCandidateFindingsCount: 5,
      redundantInvestigationsSkippedCount: 0,
      highestExploratoryQaSeverity: 'low',
      actionableDiagnosticsCount: 2,
      diagnosticsNeedingReviewCount: 0,
      ignoredDiagnosticNoiseCount: 0
    }
  };
}

function fixedNarrative(input: ExploratoryHumanNarrativeInput): ExploratoryHumanNarrativeOutput {
  if (input.findingReference === 'finding-3') {
    return {
      plainTitle: 'Country list contains a likely spelling duplicate',
      plainCondition:
        'The country list contains both “Ecuador” and “Equador”, which appears to be a duplicate misspelled entry.'
    };
  }

  return {
    plainTitle: 'Checkout total may not update',
    plainCondition:
      'The checkout total may stay unchanged after a visitor changes an item quantity.'
  };
}

function visibleMarkdown(markdown: string): string {
  return markdown.replace(/<details>[\s\S]*?<\/details>/g, '');
}

function semanticState(report: SiteAgentReportV4): string {
  return JSON.stringify({
    findings: report.findings,
    passiveSecurity: report.passiveSecurity,
    summary: report.summary,
    siteWideExploratoryFindings: report.siteWideExploratoryFindings
  });
}

function createStructuredRoutingProofReport(): SiteAgentReportV4 {
  const tab = createFinding(11, {
    title: 'Button opens an internal settings dialog',
    evidence: 'The semantic control exposes the value "[#LABEL_42#]".',
    reasoning: 'The exposed value is not a meaningful accessible name.',
    category: 'interaction',
    state: 'verified',
    structuredIdentity: {
      mechanism: 'unresolved-token',
      observedValue: '[#LABEL_42#]',
      source: 'accessible-name',
      subject: {
        kind: 'semantic-control',
        controlType: 'tab',
        controlId: 'InternalSettingsDialogTab',
        componentId: 'AccountMenu',
        locator: '#NavigationSettings'
      }
    }
  });
  const disclosure = createFinding(12, {
    title: 'Menu opens a product dialog',
    evidence: 'The semantic control exposes the value "{{label.key.42}}".',
    reasoning: 'The exposed value is not a meaningful accessible name.',
    category: 'consistency',
    state: 'verified',
    structuredIdentity: {
      mechanism: 'unresolved-token',
      observedValue: '{{label.key.42}}',
      source: 'accessible-name',
      subject: {
        kind: 'semantic-control',
        controlType: 'disclosure',
        controlId: 'BillingMenuDisclosure',
        componentId: 'ProductDialog',
        locator: '#InternalNavigation'
      }
    }
  });
  const report = createAcceptanceReport();

  report.runId = 'structured-routing-proof';
  report.findings = [tab, disclosure];
  report.passiveSecurity.observations = [];
  report.passiveSecurity.summary.observationsCount = 0;
  report.passiveSecurity.summary.bySeverity = { medium: 0, low: 0, info: 0 };

  return report;
}

async function assertRejectsWithMessage(
  operation: () => Promise<unknown>,
  pattern: RegExp
): Promise<void> {
  await assert.rejects(operation, pattern);
}

async function main(): Promise<void> {
  assert.equal(getHumanReaderStatus('Observed directly', 'Confirmed issue'), 'Confirmed issue');
  assert.equal(getHumanReaderStatus('Seen in browser data', 'Confirmed issue'), 'Confirmed issue');
  assert.equal(getHumanReaderStatus('Observed directly', 'Needs human review'), 'Needs review');
  assert.equal(getHumanReaderStatus('Seen in browser data', 'Needs human review'), 'Needs review');
  assert.equal(getHumanReaderStatus('AI analysis only', 'Needs human review'), 'Needs review');
  assert.equal(
    getHumanReaderStatus('Seen in browser data', 'Confirmed observation'),
    'Confirmed observation'
  );
  assert.throws(() => getHumanReaderStatus('AI analysis only', 'Confirmed issue'));
  assert.throws(() => getHumanReaderStatus('AI analysis only', 'Confirmed observation'));
  assert.throws(() => getHumanReaderStatus('Observed directly', 'Confirmed observation'));

  const structuredRoutingReport = createStructuredRoutingProofReport();
  const structuredTab = structuredRoutingReport.findings[0]!;
  const structuredDisclosure = structuredRoutingReport.findings[1]!;

  assert.deepEqual(determineHumanNarrativeRoute(structuredTab), {
    kind: 'supported-deterministic',
    mechanism: 'structured-semantic-control'
  });
  assert.deepEqual(determineHumanNarrativeRoute(structuredDisclosure), {
    kind: 'supported-deterministic',
    mechanism: 'structured-semantic-control'
  });

  let structuredGeneratorCalls = 0;
  const structuredEnriched = await enrichSiteAgentReportWithHumanNarratives(
    structuredRoutingReport,
    {
      generateNarrative: async input => {
        structuredGeneratorCalls += 1;
        return fixedNarrative(input);
      }
    }
  );

  assert.equal(structuredGeneratorCalls, 0);
  assert.deepEqual(structuredEnriched.humanNarratives.exploratory, []);

  const structuredPresentation = buildHumanReportPresentation(structuredEnriched);
  const tabPresentation = structuredPresentation.detailedFindings.find(
    item => item.findingReference === structuredTab.findingReference
  )!;
  const disclosurePresentation = structuredPresentation.detailedFindings.find(
    item => item.findingReference === structuredDisclosure.findingReference
  )!;

  assert.deepEqual(
    {
      title: tabPresentation.title,
      status: tabPresentation.status,
      severity: tabPresentation.severity,
      whatsWrong: tabPresentation.whatHappened,
      whyItMatters: tabPresentation.whyItMayMatter,
      whatToCheck: tabPresentation.whatStillNeedsChecking
    },
    {
      title: 'Accessibility tools may announce placeholder text instead of the control’s name',
      status: 'Confirmed issue',
      severity: 'low',
      whatsWrong:
        'Accessibility tools receive the placeholder text “[#LABEL_42#]” as this control’s name instead of a clear description.',
      whyItMatters: 'People using a screen reader may not understand what this control does.',
      whatToCheck:
        'Check the control’s name and replace the unclear value with wording that explains what the control does.'
    }
  );
  assert.deepEqual(
    {
      title: disclosurePresentation.title,
      status: disclosurePresentation.status,
      severity: disclosurePresentation.severity,
      whatsWrong: disclosurePresentation.whatHappened,
      whyItMatters: disclosurePresentation.whyItMayMatter,
      whatToCheck: disclosurePresentation.whatStillNeedsChecking
    },
    {
      title: 'Accessibility tools may announce placeholder text instead of the control’s name',
      status: 'Confirmed issue',
      severity: 'low',
      whatsWrong:
        'Accessibility tools receive the placeholder text “{{label.key.42}}” as this control’s name instead of a clear description.',
      whyItMatters: 'People using a screen reader may not understand what this control does.',
      whatToCheck:
        'Check the control’s name and replace the unclear value with wording that explains what the control does.'
    }
  );

  const tabIndexTitle = structuredPresentation.atAGlance.find(
    item => item.displayId === tabPresentation.displayId
  )!.title;
  assert.equal(tabIndexTitle, tabPresentation.title);
  assert.equal(structuredPresentation.notableSummary, null);

  const structuredMarkdown = renderHumanMarkdownReport(structuredEnriched);
  const structuredVisibleMarkdown = visibleMarkdown(structuredMarkdown);
  const structuredNarrativeText = [
    tabPresentation.title,
    tabPresentation.whatHappened,
    tabPresentation.whyItMayMatter,
    tabPresentation.whatStillNeedsChecking,
    disclosurePresentation.title,
    disclosurePresentation.whatHappened,
    disclosurePresentation.whyItMayMatter,
    disclosurePresentation.whatStillNeedsChecking
  ].join('\n');

  assert.match(
    structuredMarkdown,
    /\| \[01\]\(#item-01\) \| \[Accessibility tools may announce placeholder text instead of the control’s name\]\(#item-01\) \|/
  );
  assert.match(
    structuredMarkdown,
    /### 01 — Accessibility tools may announce placeholder text instead of the control’s name/
  );
  assert.match(structuredMarkdown, /Status: Confirmed issue · Severity: Low/);
  assert.match(structuredMarkdown, /\*\*What’s wrong\*\*/);
  assert.match(structuredMarkdown, /\*\*What to do\*\*/);
  assert.doesNotMatch(structuredMarkdown, /confirm whether (?:the )?(?:issue|finding) exists/i);
  assert.doesNotMatch(structuredMarkdown, /The most notable item/);

  for (const unsupportedTerm of [
    'button',
    'settings',
    'dialog',
    'account',
    'menu',
    'navigation',
    'billing',
    'product'
  ]) {
    assert.doesNotMatch(structuredNarrativeText, new RegExp(unsupportedTerm, 'i'));
  }

  for (const technicalOrStaleValue of [
    'InternalSettingsDialogTab',
    'AccountMenu',
    '#NavigationSettings',
    'BillingMenuDisclosure',
    'ProductDialog',
    '#InternalNavigation',
    'Button opens an internal settings dialog',
    'Menu opens a product dialog'
  ]) {
    assert.doesNotMatch(
      structuredVisibleMarkdown,
      new RegExp(technicalOrStaleValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    );
  }

  const defectBasisFinding = createFinding(15, {
    title: 'Model title for a missing accessibility property',
    evidence: 'The disclosure has no accessible name.',
    reasoning: 'The browser-backed accessibility fact records a missing value.',
    category: 'accessibility',
    state: 'verified'
  });
  const defectBasisRawSource = defectBasisFinding.occurrences[0]!.evidence[0]!.rawSource!;
  defectBasisRawSource.value = exploratoryQaFindingSchema.parse({
    ...(defectBasisRawSource.value as Record<string, unknown>),
    accessibilityDefectBasis: {
      expectation: 'The control needs an accessible name.',
      conflict: 'The accessible name is missing.',
      supportingEvidence: [
        {
          controlType: 'disclosure',
          controlId: 'InternalControlReference',
          property: 'accessible-name',
          value: null
        }
      ]
    }
  });
  assert.deepEqual(determineHumanNarrativeRoute(defectBasisFinding), {
    kind: 'supported-deterministic',
    mechanism: 'accessibility-defect-basis'
  });
  const defectBasisReport = createAcceptanceReport();
  defectBasisReport.findings = [defectBasisFinding];
  let defectBasisGeneratorCalls = 0;
  const defectBasisEnriched = await enrichSiteAgentReportWithHumanNarratives(defectBasisReport, {
    generateNarrative: async input => {
      defectBasisGeneratorCalls += 1;
      return fixedNarrative(input);
    }
  });
  assert.equal(defectBasisGeneratorCalls, 0);
  const defectBasisPresentation =
    buildHumanReportPresentation(defectBasisEnriched).detailedFindings[0]!;
  assert.deepEqual(
    {
      title: defectBasisPresentation.title,
      whatsWrong: defectBasisPresentation.whatHappened,
      whyItMatters: defectBasisPresentation.whyItMayMatter,
      whatToCheck: defectBasisPresentation.whatStillNeedsChecking
    },
    {
      title: 'Disclosure has inconsistent accessibility information',
      whatsWrong:
        'Browser-backed facts for a disclosure show missing or conflicting accessibility information.',
      whyItMatters:
        'People using assistive technology may receive incomplete or inconsistent information about the control.',
      whatToCheck:
        'Review the control’s accessibility information and confirm that it agrees with what is visible and how the control behaves.'
    }
  );
  assert.doesNotMatch(
    visibleMarkdown(renderHumanMarkdownReport(defectBasisEnriched)),
    /InternalControlReference/
  );

  const partialFinding = createFinding(13, {
    title: 'Partial structured control',
    evidence: 'A model supplied an incomplete structured control.',
    reasoning: 'The final structured state is incomplete.',
    category: 'interaction'
  });
  const partialRawSource = partialFinding.occurrences[0]!.evidence[0]!.rawSource!;
  partialRawSource.value = {
    ...(partialRawSource.value as Record<string, unknown>),
    structuredIdentity: {
      mechanism: 'unresolved-token',
      source: 'accessible-name',
      subject: { kind: 'semantic-control', controlType: 'tab' }
    }
  };
  assert.deepEqual(determineHumanNarrativeRoute(partialFinding), {
    kind: 'partial-recognized-structured',
    mechanism: 'structured-semantic-control'
  });
  const partialReport = createAcceptanceReport();
  partialReport.findings = [partialFinding];
  let partialGeneratorCalls = 0;
  await assertRejectsWithMessage(
    () =>
      enrichSiteAgentReportWithHumanNarratives(partialReport, {
        generateNarrative: async input => {
          partialGeneratorCalls += 1;
          return fixedNarrative(input);
        }
      }),
    /recognized structured-semantic-control narrative mechanism is incomplete/i
  );
  assert.equal(partialGeneratorCalls, 0);

  const exploratoryFinding = createFinding(14, {
    title: 'Possible stale total',
    evidence: 'The total may not update after a quantity change.',
    reasoning: 'This may cause confusion.',
    browserBacked: true
  });
  assert.deepEqual(determineHumanNarrativeRoute(exploratoryFinding), { kind: 'exploratory' });
  const exploratoryReport = createAcceptanceReport();
  exploratoryReport.runId = 'human-readability-valid-replay';
  exploratoryReport.findings = [exploratoryFinding];
  let exploratoryGeneratorCalls = 0;
  const exploratoryEnriched = await enrichSiteAgentReportWithHumanNarratives(exploratoryReport, {
    generateNarrative: async input => {
      exploratoryGeneratorCalls += 1;
      return fixedNarrative(input);
    }
  });
  assert.equal(exploratoryGeneratorCalls, 1);
  assert.equal(exploratoryEnriched.humanNarratives.exploratory.length, 1);
  const exploratoryPresentation = buildHumanReportPresentation(exploratoryEnriched);
  const exploratoryDetail = exploratoryPresentation.detailedFindings[0]!;
  assert.equal(exploratoryDetail.status, 'Needs review');
  assert.equal(
    exploratoryDetail.whyItMayMatter,
    'CheckQuest has not established any further user impact yet.'
  );
  assert.equal(
    exploratoryDetail.whatStillNeedsChecking,
    'Check whether this behavior is intentional. If not, correct the affected part.'
  );
  assert.equal(exploratoryPresentation.atAGlance[0]?.title, exploratoryDetail.title);
  assert.equal(exploratoryPresentation.notableSummary, null);

  const persistedExploratory = await persistSiteAgentReport(exploratoryEnriched);
  assert.match(persistedExploratory.jsonReportPath, /report\.json$/);
  assert.match(persistedExploratory.markdownReportPath, /report\.md$/);
  const exploratoryRenderOne = renderHumanMarkdownReport(exploratoryEnriched);
  const exploratoryRenderTwo = renderHumanMarkdownReport(exploratoryEnriched);
  assert.equal(exploratoryGeneratorCalls, 1);
  assert.equal(exploratoryRenderOne, exploratoryRenderTwo);
  assert.doesNotMatch(exploratoryRenderOne, /users may select the wrong option/i);
  assert.doesNotMatch(exploratoryRenderOne, /Possible stale total/);

  const strengtheningAttempt = {
    plainTitle: 'Checkout total may not update',
    plainCondition: 'The total may stay unchanged after a quantity change.',
    impactStatement: 'Users may select the wrong option.'
  };
  assert.equal(exploratoryHumanNarrativeSchema.safeParse(strengtheningAttempt).success, false);

  const leakFinding = createFinding(16, {
    title: 'InternalCountryControl42 may contain an unusual option',
    evidence: 'The list contains the visible option "[#VISIBLE_OPTION_42#]".',
    reasoning: 'This may cause confusion.',
    browserBacked: true
  });
  leakFinding.occurrences[0]!.target = {
    kind: 'select-option',
    controlLabel: 'Country',
    controlName: 'InternalCountryControl42',
    controlId: 'InternalCountryControl42',
    optionText: '[#VISIBLE_OPTION_42#]'
  };
  const leakReport = createAcceptanceReport();
  leakReport.findings = [leakFinding];
  const leakedOutput = exploratoryHumanNarrativeSchema.parse({
    plainTitle: 'InternalCountryControl42 contains an unusual option',
    plainCondition: 'The list contains an unusual option.'
  });
  let leakResponseReceived = false;
  let leakInput: ExploratoryHumanNarrativeInput | undefined;
  let invalidCompletedReport: SiteAgentReportV4 | undefined;
  let invalidPersistedReport: SiteAgentReportV4 | undefined;
  let invalidMarkdown: string | undefined;
  await assertRejectsWithMessage(async () => {
    invalidCompletedReport = await enrichSiteAgentReportWithHumanNarratives(leakReport, {
      generateNarrative: async input => {
        leakResponseReceived = true;
        leakInput = input;
        return leakedOutput;
      }
    });
    invalidPersistedReport = structuredClone(invalidCompletedReport);
    invalidMarkdown = renderHumanMarkdownReport(invalidPersistedReport);
  }, /Required exploratory human narrative generation failed/);
  assert.equal(leakResponseReceived, true);
  assert.equal(leakInput?.supportedClaim.title, null);
  assert.doesNotMatch(JSON.stringify(leakInput), /InternalCountryControl42/);
  assert.equal(leakReport.humanNarratives.state, 'pending');
  assert.deepEqual(leakReport.humanNarratives.exploratory, []);
  assert.equal(invalidCompletedReport, undefined);
  assert.equal(invalidPersistedReport, undefined);
  assert.equal(invalidMarkdown, undefined);

  let directLeakError: unknown;

  try {
    validateGeneratedHumanNarrative(leakFinding, leakedOutput);
  } catch (error: unknown) {
    directLeakError = error;
  }

  assert.ok(directLeakError instanceof CheckQuestError);
  assert.deepEqual(directLeakError.developerContext, {
    findingReference: 'finding-16',
    generatedField: 'plainTitle',
    matchedForbiddenValue: 'InternalCountryControl42',
    forbiddenSource: 'control-identifier:controlId',
    matchMode: 'normalized-substring'
  });
  const directLeakDiagnostic = formatDeveloperErrorDiagnostic(directLeakError);
  assert.match(directLeakDiagnostic, /diagnostic\.findingReference: finding-16/);
  assert.match(directLeakDiagnostic, /diagnostic\.generatedField: plainTitle/);
  assert.match(directLeakDiagnostic, /diagnostic\.matchedForbiddenValue: InternalCountryControl42/);
  assert.match(directLeakDiagnostic, /diagnostic\.forbiddenSource: control-identifier:controlId/);
  assert.match(directLeakDiagnostic, /diagnostic\.matchMode: normalized-substring/);
  const sanitizedDirectLeak = sanitizeApplicationError(
    directLeakError,
    'human-readability-acceptance',
    undefined
  );
  assert.equal(sanitizedDirectLeak.developerContext, undefined);
  const publicDirectLeak = formatPublicError(sanitizedDirectLeak);

  for (const privateValue of [
    'finding-16',
    'plainTitle',
    'InternalCountryControl42',
    'control-identifier:controlId',
    'normalized-substring'
  ]) {
    assert.equal(publicDirectLeak.includes(privateValue), false);
  }

  const allowedReport = createAcceptanceReport();
  allowedReport.findings = [structuredClone(leakFinding)];
  const allowedEnriched = await enrichSiteAgentReportWithHumanNarratives(allowedReport, {
    generateNarrative: async () => ({
      plainTitle: 'List contains an unusual visible option',
      plainCondition: 'The list visibly contains “[#VISIBLE_OPTION_42#]”.'
    })
  });
  assert.equal(allowedEnriched.humanNarratives.state, 'complete');
  assert.match(renderHumanMarkdownReport(allowedEnriched), /\[#VISIBLE_OPTION_42#\]/);

  const ordinaryLanguageOverlapFinding = createFinding(17, {
    title: 'Possible spelling error in country selection list',
    evidence: 'The country selection includes both "Ecuador" and "Equador".',
    reasoning: 'This may cause confusion.',
    browserBacked: true
  });
  ordinaryLanguageOverlapFinding.occurrences[0]!.target = {
    kind: 'select-option',
    controlLabel: 'COUNTRY*',
    controlName: 'country',
    controlId: 'country-control-17',
    optionText: 'Equador'
  };
  const ordinaryLanguageOverlapReport = createAcceptanceReport();
  ordinaryLanguageOverlapReport.findings = [ordinaryLanguageOverlapFinding];
  const ordinaryLanguageOverlapEnriched = await enrichSiteAgentReportWithHumanNarratives(
    ordinaryLanguageOverlapReport,
    {
      generateNarrative: async () => ({
        plainTitle: 'Spelling error in country selection list',
        plainCondition: 'The country selection includes both “Ecuador” and “Equador”.'
      })
    }
  );
  assert.equal(ordinaryLanguageOverlapEnriched.humanNarratives.state, 'complete');
  assert.match(
    renderHumanMarkdownReport(ordinaryLanguageOverlapEnriched),
    /Visible option “Equador” may need review/
  );

  const normalizedVisibleOverlapFinding = structuredClone(ordinaryLanguageOverlapFinding);
  const normalizedVisibleTarget = normalizedVisibleOverlapFinding.occurrences[0]!.target;
  assert.equal(normalizedVisibleTarget?.kind, 'select-option');

  if (normalizedVisibleTarget?.kind === 'select-option') {
    normalizedVisibleTarget.controlLabel = '“  ＣＯＵＮＴＲＹ＊  ”';
  }

  assert.doesNotThrow(() =>
    validateGeneratedHumanNarrative(normalizedVisibleOverlapFinding, {
      plainTitle: 'Country selection spelling error',
      plainCondition: 'The country selection includes an unusual visible option.'
    })
  );

  const semanticControlNameFinding = structuredClone(ordinaryLanguageOverlapFinding);
  const semanticControlNameTarget = semanticControlNameFinding.occurrences[0]!.target;
  assert.equal(semanticControlNameTarget?.kind, 'select-option');

  if (semanticControlNameTarget?.kind === 'select-option') {
    semanticControlNameTarget.controlLabel = 'Location';
  }

  assert.doesNotThrow(() =>
    validateGeneratedHumanNarrative(semanticControlNameFinding, {
      plainTitle: 'Country selection spelling error',
      plainCondition: 'The country selection includes an unusual option.'
    })
  );
  assert.throws(
    () =>
      validateGeneratedHumanNarrative(semanticControlNameFinding, {
        plainTitle: 'country',
        plainCondition: 'The selection includes an unusual option.'
      }),
    /Generated human narrative contains a technical-only report value/
  );

  const selectorLeakFinding = createFinding(18, {
    title: 'Possible unusual control state',
    evidence: 'A control may have an unusual state.',
    reasoning: 'This may cause confusion.'
  });
  const selectorEvidence = selectorLeakFinding.occurrences[0]!.evidence[0]!;
  selectorEvidence.rawSource = {
    type: 'exploratory-qa-finding',
    value: {
      ...(selectorEvidence.rawSource?.value as Record<string, unknown>),
      selector: '#internal-panel-18'
    }
  };
  assert.throws(
    () =>
      validateGeneratedHumanNarrative(selectorLeakFinding, {
        plainTitle: 'Unusual control state',
        plainCondition: 'The element #internal-panel-18 may have an unusual state.'
      }),
    /Generated human narrative contains a technical-only report value/
  );
  assert.throws(
    () =>
      validateGeneratedHumanNarrative(selectorLeakFinding, {
        plainTitle: 'Review finding-18',
        plainCondition: 'A control may have an unusual state.'
      }),
    /Generated human narrative contains a technical-only report value/
  );

  const unicodeIdentifierFinding = createFinding(19, {
    title: 'Possible unusual option',
    evidence: 'A selection contains an unusual option.',
    reasoning: 'This may cause confusion.'
  });
  unicodeIdentifierFinding.occurrences[0]!.target = {
    kind: 'select-option',
    controlLabel: 'Location',
    controlName: 'location',
    controlId: 'INTERNAL-Å-19',
    optionText: 'Unusual option'
  };
  assert.throws(
    () =>
      validateGeneratedHumanNarrative(unicodeIdentifierFinding, {
        plainTitle: 'Unusual selection option',
        plainCondition: 'The control internal-a\u030a-19 contains an unusual option.'
      }),
    /Generated human narrative contains a technical-only report value/
  );

  const pending = createAcceptanceReport();
  const before = semanticState(pending);
  let generatorCalls = 0;
  const generator: HumanNarrativeGenerator = async input => {
    generatorCalls += 1;
    return fixedNarrative(input);
  };
  const enriched = await enrichSiteAgentReportWithHumanNarratives(pending, {
    generateNarrative: generator
  });

  assert.equal(enriched.reportSchemaVersion, '4');
  assert.equal(enriched.humanNarratives.state, 'complete');
  assert.equal(generatorCalls, 2);
  assert.equal(enriched.humanNarratives.exploratory.length, 2);
  assert.equal(semanticState(enriched), before);

  const callsBeforeRender = generatorCalls;
  const firstRender = renderHumanMarkdownReport(enriched);
  const firstRenderCalls = generatorCalls - callsBeforeRender;
  const secondRender = renderHumanMarkdownReport(enriched);
  const secondRenderCalls = generatorCalls - callsBeforeRender - firstRenderCalls;

  assert.equal(firstRenderCalls, 0);
  assert.equal(secondRenderCalls, 0);
  assert.equal(firstRender, secondRender);
  const acceptancePresentation = buildHumanReportPresentation(enriched);
  const structuredAcceptance = acceptancePresentation.detailedFindings.find(
    item => item.findingReference === 'finding-1'
  )!;
  const imageAcceptance = acceptancePresentation.detailedFindings.find(
    item => item.findingReference === 'finding-2'
  )!;
  const browserExploratoryAcceptance = acceptancePresentation.detailedFindings.find(
    item => item.findingReference === 'finding-3'
  )!;
  const aiOnlyAcceptance = acceptancePresentation.detailedFindings.find(
    item => item.findingReference === 'finding-4'
  )!;
  const scriptAcceptance = acceptancePresentation.technicalObservations.find(
    item => item.findingReference === 'finding-5'
  )!;
  const cspAcceptance = acceptancePresentation.securityObservations[0]!;

  assert.match(structuredAcceptance.technicalDetails.join('\n'), /Control id:/);
  assert.match(structuredAcceptance.technicalDetails.join('\n'), /Identity mechanism:/);
  assert.doesNotMatch(
    browserExploratoryAcceptance.technicalDetails.join('\n'),
    /Browser evidence:/
  );
  assert.match(browserExploratoryAcceptance.technicalDetails.join('\n'), /Candidate reference:/);
  assert.match(scriptAcceptance.technicalDetails.join('\n'), /Request URL:/);
  assert.match(scriptAcceptance.technicalDetails.join('\n'), /Resource type: script/);
  assert.match(cspAcceptance.technicalDetails.join('\n'), /Security code:/);
  assert.match(cspAcceptance.evidence.join('\n'), /content-security-policy evidence/);

  assert.equal(imageAcceptance.title, 'An image file failed to load');
  assert.match(imageAcceptance.whatHappened, /^An image file /);
  assert.equal(scriptAcceptance.title, 'A script file failed to load');
  assert.match(scriptAcceptance.whatHappened, /^A script file /);
  assert.match(imageAcceptance.whyItMayMatter, /did not capture a visible consequence/);
  assert.match(scriptAcceptance.whyItMayMatter, /did not capture a visible consequence/);

  assert.equal(aiOnlyAcceptance.status, 'Needs review');
  assert.doesNotMatch(aiOnlyAcceptance.whatHappened, /\b(?:AI|model)\b/i);
  assert.doesNotMatch(aiOnlyAcceptance.whatStillNeedsChecking, /\b(?:AI|model)\b/i);
  assert.match(firstRender, /\| # \| Finding \| Status \| Severity \| Found on \|/);
  assert.doesNotMatch(firstRender, /\| # \| Item \| Type \| Evidence \| Assessment/);
  assert.doesNotMatch(firstRender, /Possible issue · Seen in browser data · Needs human review/);
  assert.match(firstRender, /Status: Needs review · Severity: Low/);
  assert.doesNotMatch(firstRender, /AI suggestion|AI suggested|model analysis/i);
  assert.match(firstRender, /The country list contains both “Ecuador” and “Equador”/);
  assert.match(
    firstRender,
    /Accessibility tools receive the placeholder text “\[#IABV2SETTINGS#\]” as this control’s name/
  );
  assert.match(firstRender, /An image file requested by the page returned a 404 error\./);
  assert.match(firstRender, /did not capture a visible consequence/);
  assert.match(firstRender, /A script file failed to load/);
  assert.match(firstRender, /A script file requested by the page failed to load\./);
  assert.doesNotMatch(
    firstRender.match(/### 05 — A script file failed to load[\s\S]*?(?=\n---)/)?.[0] ?? '',
    /broken image|missing imagery/i
  );
  assert.match(firstRender, /The site did not send an enforcing Content Security Policy \(CSP\)\./);
  assert.match(firstRender, /Its absence does not prove the site is vulnerable\./);
  assert.doesNotMatch(
    firstRender.match(
      /### S01 — A restriction on what the browser may load was not enforced[\s\S]*?(?=\n---)/
    )?.[0] ?? '',
    /scripts? only/i
  );
  assert.match(firstRender, /server technology it uses/);
  assert.match(firstRender, /software or platform serving the page/);
  assert.match(firstRender, /<summary>Technical details<\/summary>/);
  assert.doesNotMatch(firstRender, /- Assessment:/);
  assert.match(firstRender, /Status: Confirmed observation · Severity: Low/);
  assert.match(firstRender, /\| Confirmed observation \| Low \| 1 page \|/);
  assert.doesNotMatch(firstRender, /All 1 page/);

  const exploratorySummaryItem = acceptancePresentation.atAGlance.find(
    item => item.displayId === browserExploratoryAcceptance.displayId
  )!;
  assert.equal(exploratorySummaryItem.title, browserExploratoryAcceptance.title);
  assert.doesNotMatch(firstRender, /Possible duplicate country option/);

  const twoPageReport = structuredClone(enriched);
  const secondInspectedPage = structuredClone(twoPageReport.inspectedPages[0]!);
  secondInspectedPage.observation.finalUrl = 'https://example.com/checkout';
  secondInspectedPage.observation.title = 'Checkout';
  twoPageReport.inspectedPages.push(secondInspectedPage);
  const secondSecurityOccurrence = structuredClone(
    twoPageReport.passiveSecurity.observations[0]!.occurrences[0]!
  );
  secondSecurityOccurrence.pageUrl = 'https://example.com/checkout';
  secondSecurityOccurrence.pageTitle = 'Checkout';
  secondSecurityOccurrence.responseUrl = 'https://example.com/checkout';
  twoPageReport.passiveSecurity.observations[0]!.occurrences.push(secondSecurityOccurrence);
  const twoPageMarkdown = renderHumanMarkdownReport(twoPageReport);
  assert.match(twoPageMarkdown, /\| Confirmed observation \| Low \| 2 pages \|/);
  assert.match(twoPageMarkdown, /Found on all 2 inspected pages/);
  assert.doesNotMatch(
    twoPageMarkdown.match(/### S01 —[\s\S]*?(?=\n---)/)?.[0] ?? '',
    /<summary>Found on 2 pages<\/summary>|https:\/\/example\.com\/checkout/
  );

  const visible = visibleMarkdown(firstRender);

  for (const phrase of [
    'CybotCookiebotDialogNavAdSettings',
    'accessible-name',
    'exact-target occurrence',
    'semantic finding',
    'structured page evidence',
    'candidate reference',
    'rawSource',
    'verification capability',
    'https://example.com/assets/hero-image.jpg',
    'cloudflare',
    'WP Engine'
  ]) {
    assert.doesNotMatch(visible, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  const reordered = structuredClone(enriched);
  reordered.findings.reverse();
  const reorderedMarkdown = renderHumanMarkdownReport(reordered);
  assert.match(reorderedMarkdown, /Checkout total may not update/);
  assert.match(reorderedMarkdown, /Country list contains a likely spelling duplicate/);

  const grouped = createAcceptanceReport();
  grouped.findings = [structuredClone(grouped.findings[2]!)];
  grouped.findings[0]!.occurrences = Array.from({ length: 10 }, (_value, index) => ({
    ...structuredClone(grouped.findings[0]!.occurrences[0]!),
    occurrenceReference: `occurrence-${index + 20}`,
    pageUrl: `https://example.com/page-${index + 1}`
  }));
  grouped.inspectedPages = Array.from({ length: 10 }, (_value, index) => ({
    ...structuredClone(grouped.inspectedPages[0]!),
    observation: {
      ...structuredClone(grouped.inspectedPages[0]!.observation),
      finalUrl: `https://example.com/page-${index + 1}`,
      title: `Page ${index + 1}`
    }
  }));
  let groupedCalls = 0;
  const groupedEnriched = await enrichSiteAgentReportWithHumanNarratives(grouped, {
    generateNarrative: async input => {
      groupedCalls += 1;
      return fixedNarrative(input);
    }
  });
  assert.equal(grouped.findings[0]!.occurrences.length, 10);
  assert.equal(grouped.findings.length, 1);
  assert.equal(groupedCalls, 1);
  assert.equal(groupedEnriched.humanNarratives.exploratory.length, 1);
  const groupedMarkdown = renderHumanMarkdownReport(groupedEnriched);
  assert.match(groupedMarkdown, /Found on all 10 inspected pages/);
  const groupedDetail = groupedMarkdown.match(/### 01 —[\s\S]*?(?=\n---)/)?.[0] ?? '';
  assert.doesNotMatch(groupedDetail, /<summary>Found on 10 pages<\/summary>|\/page-10/);
  assert.doesNotMatch(groupedMarkdown, /Affected/);

  const technicalGrouped = createAcceptanceReport();
  technicalGrouped.findings = [structuredClone(technicalGrouped.findings[4]!)];
  technicalGrouped.findings[0]!.occurrences = Array.from({ length: 10 }, (_value, index) => ({
    ...structuredClone(technicalGrouped.findings[0]!.occurrences[0]!),
    occurrenceReference: `occurrence-${index + 40}`,
    pageUrl: `https://example.com/technical-page-${index + 1}`
  }));
  technicalGrouped.inspectedPages = Array.from({ length: 10 }, (_value, index) => ({
    ...structuredClone(technicalGrouped.inspectedPages[0]!),
    observation: {
      ...structuredClone(technicalGrouped.inspectedPages[0]!.observation),
      finalUrl: `https://example.com/technical-page-${index + 1}`,
      title: `Technical page ${index + 1}`
    }
  }));
  const technicalGroupedEnriched = await enrichSiteAgentReportWithHumanNarratives(
    technicalGrouped,
    { generateNarrative: async input => fixedNarrative(input) }
  );
  const technicalGroupedMarkdown = renderHumanMarkdownReport(technicalGroupedEnriched);
  assert.match(technicalGroupedMarkdown, /Found on all 10 inspected pages/);
  const technicalGroupedDetail =
    technicalGroupedMarkdown.match(/### 01 —[\s\S]*?(?=\n---)/)?.[0] ?? '';
  assert.doesNotMatch(
    technicalGroupedDetail,
    /<summary>Found on 10 pages<\/summary>|\/technical-page-10/
  );
  assert.doesNotMatch(technicalGroupedMarkdown, /Affected/);

  const missing = structuredClone(enriched);
  missing.humanNarratives.exploratory.pop();
  assert.throws(
    () => renderHumanMarkdownReport(missing),
    /required exploratory human narrative is missing/i
  );
  const duplicate = structuredClone(enriched);
  duplicate.humanNarratives.exploratory.push(
    structuredClone(duplicate.humanNarratives.exploratory[0]!)
  );
  assert.throws(
    () => renderHumanMarkdownReport(duplicate),
    /duplicate human narrative references/i
  );
  const orphan = structuredClone(enriched);
  orphan.humanNarratives.exploratory.push({
    ...structuredClone(orphan.humanNarratives.exploratory[0]!),
    findingReference: 'finding-999'
  });
  assert.throws(() => renderHumanMarkdownReport(orphan), /points to no eligible report item/i);

  await assertRejectsWithMessage(
    () =>
      enrichSiteAgentReportWithHumanNarratives(createAcceptanceReport(), {
        generateNarrative: async () =>
          ({ plainTitle: 'Incomplete' }) as unknown as ExploratoryHumanNarrativeOutput
      }),
    /Required exploratory human narrative generation failed/
  );
  await assertRejectsWithMessage(
    () =>
      enrichSiteAgentReportWithHumanNarratives(createAcceptanceReport(), {
        generateNarrative: async () => {
          throw new Error('Synthetic provider failure');
        }
      }),
    /Required exploratory human narrative generation failed/
  );
  await assert.rejects(
    () =>
      enrichSiteAgentReportWithHumanNarratives(createAcceptanceReport(), {
        generateNarrative: async () => {
          throw new CheckQuestError('CANCELLED', 'Synthetic cancellation.');
        }
      }),
    (error: unknown) => error instanceof CheckQuestError && error.code === 'CANCELLED'
  );
  assert.throws(
    () =>
      parseModelJsonResponse(
        '{',
        'human-report-narrative-response',
        exploratoryHumanNarrativeSchema
      ),
    /malformed JSON/i
  );

  const representativeReport = structuredClone(enriched);
  representativeReport.findings = representativeReport.findings.slice(0, 3);
  representativeReport.humanNarratives.exploratory =
    representativeReport.humanNarratives.exploratory.filter(
      narrative => narrative.findingReference === 'finding-3'
    );
  representativeReport.findings[0]!.verification.state = 'inconclusive';
  representativeReport.findings[0]!.occurrences[0]!.verification.state = 'inconclusive';
  representativeReport.findings[0]!.occurrences = Array.from({ length: 8 }, (_value, index) => ({
    ...structuredClone(representativeReport.findings[0]!.occurrences[0]!),
    occurrenceReference: `occurrence-${index + 40}`,
    pageUrl: `https://example.com/page-${index + 1}`,
    pageTitle:
      index === 5
        ? 'Insights, Research &amp; Education'
        : index === 6
          ? 'Research &#38; Development'
          : `Example page ${index + 1}`
  }));
  representativeReport.findings[1]!.occurrences[0]!.pageUrl = 'https://example.com/page-1';
  representativeReport.findings[1]!.occurrences[0]!.pageTitle = 'Example page 1';
  representativeReport.findings[2]!.title = 'Typo in country selection dropdown';
  representativeReport.findings[2]!.description =
    'The visible option may cause confusion or validation issues for users.';
  representativeReport.findings[2]!.occurrences = Array.from({ length: 6 }, (_value, index) => ({
    ...structuredClone(representativeReport.findings[2]!.occurrences[0]!),
    occurrenceReference: `occurrence-${index + 60}`,
    pageUrl: `https://example.com/page-${index + 2}`,
    pageTitle: index === 4 ? 'Insights, Research &amp; Education' : `Example page ${index + 2}`,
    target: {
      kind: 'select-option' as const,
      controlLabel: 'COUNTRY*',
      controlName: 'country',
      controlId: `country-control-${(index % 3) + 1}`,
      optionText: 'Equador'
    }
  }));
  const representativeNarrative = representativeReport.humanNarratives.exploratory[0]!;
  representativeNarrative.plainTitle = 'Spelling error in country selection menu';
  representativeNarrative.plainCondition =
    'The country selection menu includes the misspelled entry Equador alongside Ecuador.';
  representativeNarrative.impactStatement =
    'The visible option may cause confusion or validation issues for users.';
  representativeNarrative.whatToCheck =
    'Confirm whether the reported condition is present and unintended. If confirmed, review the affected value or behavior and decide whether it should be corrected.';
  representativeReport.inspectedPages = Array.from({ length: 10 }, (_value, index) => {
    const page = structuredClone(representativeReport.inspectedPages[0]!);
    page.observation.finalUrl = `https://example.com/page-${index + 1}`;
    page.observation.title =
      index === 5
        ? 'Insights, Research &amp; Education'
        : index === 6
          ? 'Research &#38; Development'
          : `Example page ${index + 1}`;
    return page;
  });
  representativeReport.summary.pagesInspected = 10;
  representativeReport.summary.logicalFindingsCount = 3;
  representativeReport.summary.findingOccurrencesCount = 15;
  const representativeMarkdown = renderHumanMarkdownReport(representativeReport);
  const representativePresentation = buildHumanReportPresentation(representativeReport);
  const representativeStructured = representativePresentation.detailedFindings.find(
    finding => finding.findingReference === 'finding-1'
  )!;
  const representativeImage = representativePresentation.detailedFindings.find(
    finding => finding.findingReference === 'finding-2'
  )!;
  const representativeExploratory = representativePresentation.detailedFindings.find(
    finding => finding.findingReference === 'finding-3'
  )!;

  assert.deepEqual(
    {
      status: representativeExploratory.status,
      title: representativeExploratory.title,
      whatHappened: representativeExploratory.whatHappened,
      whyItMayMatter: representativeExploratory.whyItMayMatter,
      whatStillNeedsChecking: representativeExploratory.whatStillNeedsChecking
    },
    {
      status: 'Needs review',
      title: 'Visible option “Equador” may need review',
      whatHappened: 'The “COUNTRY*” list includes the visible option “Equador”.',
      whyItMayMatter: 'CheckQuest has not established any further user impact yet.',
      whatStillNeedsChecking:
        'Check whether “Equador” is intentional in “COUNTRY*”. If not, correct or remove it.'
    }
  );
  assert.equal(
    representativeStructured.whatStillNeedsChecking,
    'Check whether the control name “[#IABV2SETTINGS#]” is intentional. If not, replace it with wording that explains what the control does.'
  );
  assert.equal(representativeImage.title, 'An image file failed to load');
  assert.match(representativeImage.whyItMayMatter, /did not capture a visible consequence/);
  assert.equal(representativePresentation.notableSummary, null);
  assert.match(
    representativeMarkdown,
    /CheckQuest inspected 10 pages in 3s and identified 6 items:/
  );
  assert.match(representativeMarkdown, /- \*\*3\*\* need review/);
  assert.match(representativeMarkdown, /- \*\*3\*\* confirmed observations/);
  assert.doesNotMatch(representativeMarkdown, /- \*\*0\*\* confirmed/);
  assert.doesNotMatch(representativeMarkdown, /- \*\*0\*\* technical observations/);
  assert.doesNotMatch(representativeMarkdown, /## Technical notes/);
  assert.doesNotMatch(representativeMarkdown, /\[Technical notes\]\(#technical-notes\)/);
  assert.doesNotMatch(representativeMarkdown, /The most notable item/);
  assert.match(representativeMarkdown, /## Findings: At a Glance/);
  assert.match(representativeMarkdown, /## Findings: In Detail/);
  assert.match(representativeMarkdown, /\| # \| Finding \| Status \| Severity \| Found on \|/);
  assert.match(representativeMarkdown, /Status — how sure CheckQuest is/);
  assert.match(representativeMarkdown, /Severity — how important it may be/);
  assert.doesNotMatch(
    representativeMarkdown,
    /Evidence found — needs review|AI suggestion — needs review/
  );
  assert.deepEqual(
    [...new Set(representativePresentation.atAGlance.map(item => item.status))].sort(),
    ['Confirmed observation', 'Needs review']
  );
  assert.equal(representativePresentation.atAGlance.length, 6);
  const representativeAtAGlance = representativeMarkdown.slice(
    representativeMarkdown.indexOf('## Findings: At a Glance'),
    representativeMarkdown.indexOf('## Findings: In Detail')
  );
  assert.equal(
    representativeAtAGlance.split('\n').filter(line => /^\| \[(?:\d+|S\d+)\]/.test(line)).length,
    6
  );
  assert.match(representativeAtAGlance, /\[S01\]\(#security-s01\)/);
  assert.doesNotMatch(
    representativeMarkdown,
    /machine-readable evidence target|evaluated deterministically|semantic finding|exact-target occurrence evidence|does not independently verify|semantic verification/i
  );
  assert.equal(
    representativeExploratory.technicalDetails.filter(detail => detail === 'Option text: Equador')
      .length,
    1
  );
  assert.equal(
    representativePresentation.inspectedPages[5]?.page.title,
    'Insights, Research & Education'
  );
  assert.equal(representativePresentation.inspectedPages[6]?.page.title, 'Research & Development');
  assert.equal(
    representativeReport.inspectedPages[5]?.observation.title,
    'Insights, Research &amp; Education'
  );
  assert.doesNotMatch(representativeMarkdown, /reported condition|affected value or behavior/i);
  assert.doesNotMatch(representativeMarkdown, /validation issues/i);
  assert.match(representativeMarkdown, /<summary>Found on 8 pages<\/summary>/);
  assert.match(representativeMarkdown, /<summary>Found on 6 pages<\/summary>/);
  assert.doesNotMatch(representativeMarkdown, /Affected(?: pages)?:/);
  assert.match(representativeMarkdown, /An image file failed to load/);
  assert.match(
    representativeMarkdown,
    /Accessibility tools may announce placeholder text instead of the control’s name/
  );
  assert.match(
    representativeMarkdown,
    /A restriction on what the browser may load was not enforced/
  );
  assert.match(representativeMarkdown, /The site publicly identifies its server technology/);
  assert.match(representativeMarkdown, /The site publicly identifies its software platform/);
  assert.match(representativeMarkdown, /## Security testing scope/);
  assert.doesNotMatch(representativeMarkdown, /## Security notes/);
  const firstSecurityBlock = representativeMarkdown.slice(
    representativeMarkdown.indexOf('### S01 —'),
    representativeMarkdown.indexOf('### S02 —')
  );
  assert.match(firstSecurityBlock, /\*\*What CheckQuest observed\*\*/);
  assert.doesNotMatch(firstSecurityBlock, /\*\*What’s wrong\*\*/);
  const technologyBlock = representativeMarkdown.slice(
    representativeMarkdown.indexOf('### S02 —'),
    representativeMarkdown.indexOf('### S03 —')
  );
  assert.match(technologyBlock, /Consider whether this technology information/);
  assert.doesNotMatch(technologyBlock, /Confirm whether/i);
  assert.match(representativeMarkdown, /\| # \| Page \|/);
  assert.doesNotMatch(representativeMarkdown, /Reached via|\| Exploration \|/);
  assert.match(
    representativeMarkdown,
    /\| 1 \| \[Example page 1\]\(https:\/\/example\.com\/page-1\)<br><small>Start URL<br>\/page-1<\/small> \|/
  );
  assert.match(
    representativeMarkdown,
    /\[Example page 2\]\(https:\/\/example\.com\/page-2\)<br><small>\/page-2<\/small>/
  );

  const standoutReport = structuredClone(representativeReport);
  standoutReport.findings[1]!.severity = 'high';
  assert.equal(buildHumanReportPresentation(standoutReport).notableSummary, null);
  assert.doesNotMatch(renderHumanMarkdownReport(standoutReport), /most notable/i);

  const acceptancePath = join(tmpdir(), 'checkquest-human-report-reader-cleanup.md');
  await writeFile(acceptancePath, representativeMarkdown, 'utf8');

  console.log('Human report readability checks passed.');
  console.log(`Representative report: ${acceptancePath}`);
  console.log(
    JSON.stringify(
      {
        generatorCallsDuringEnrichment: generatorCalls,
        generatorCallsFirstRender: firstRenderCalls,
        generatorCallsSecondRender: secondRenderCalls,
        rendersIdentical: firstRender === secondRender,
        groupedOccurrences: grouped.findings[0]!.occurrences.length,
        groupedReportItems: grouped.findings.length,
        groupedGeneratorCalls: groupedCalls,
        groupedPersistedNarratives: groupedEnriched.humanNarratives.exploratory.length
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
