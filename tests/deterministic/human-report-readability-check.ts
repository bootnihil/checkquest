import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
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
import type {
  PassivePageSecuritySnapshot,
  PassiveSecurityObservation
} from '../../agent/security/passive-security-model';

import {
  createPassiveSecurityRegistry,
  registerPassiveSecuritySnapshot,
  getPassiveSecurityReport
} from '../../agent/security/passive-security-registry';
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

function pageSecuritySnapshot(
  url: string,
  title: string,
  contentTypes?: string[]
): PassivePageSecuritySnapshot {
  return {
    requestedUrl: url,
    finalUrl: url,
    responseUrl: url,
    responseStatus: 200,
    responseReceived: true,
    finalScheme: 'https:',
    origin: new URL(url).origin,
    pageTitle: title,
    redirects: [],
    headers: contentTypes === undefined ? {} : { 'content-type': contentTypes }
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

async function checkSecurityProjection(base: SiteAgentReportV4): Promise<void> {
  function fixture(
    snapshots: PassivePageSecuritySnapshot[],
    includePages = true
  ): SiteAgentReportV4 {
    const report = structuredClone(base);
    report.findings = [];
    report.inspectedPages = includePages
      ? snapshots.map(snapshot => {
          const page = structuredClone(base.inspectedPages[0]!);
          page.observation.requestedUrl = snapshot.requestedUrl;
          page.observation.finalUrl = snapshot.finalUrl;
          page.observation.title = snapshot.pageTitle;
          return page;
        })
      : [];
    const registry = createPassiveSecurityRegistry();
    for (const snapshot of snapshots) {
      registerPassiveSecuritySnapshot(registry, snapshot);
    }
    report.passiveSecurity = getPassiveSecurityReport(registry);
    return report;
  }
  const html = pageSecuritySnapshot('https://example.com/html', 'HTML page', ['text/html']);
  html.headers.server = ['HTML_SERVER_EVIDENCE'];
  const pdf = pageSecuritySnapshot('https://example.com/file.pdf', 'PDF response', [
    'application/pdf'
  ]);
  pdf.headers.server = ['PDF_SERVER_EVIDENCE'];
  const protectedHtml = pageSecuritySnapshot('https://example.com/protected', 'Protected page', [
    'text/html'
  ]);
  protectedHtml.headers = {
    ...protectedHtml.headers,
    'content-security-policy': ["default-src 'self'; frame-ancestors 'none'"],
    'strict-transport-security': ['max-age=31536000'],
    'x-content-type-options': ['nosniff']
  };
  const failures: unknown[] = [];
  function check(name: string, operation: () => void): void {
    try {
      operation();
      console.log('PASS: ' + name);
    } catch (error) {
      failures.push(error);
      console.error('FAIL: ' + name, error);
    }
  }
  for (const [name, snapshots, expectedPages, expectedNotes] of [
    ['excluded-only', [pdf], 0, 0],
    ['included-only', [html], 1, 5],
    ['mixed HTML/PDF', [html, pdf], 1, 5],
    ['zero pages', [], 0, 0]
  ] as const) {
    check('security projection: ' + name, () => {
      const report = fixture([...snapshots]);
      const canonicalBefore = JSON.stringify(report);
      const presentation = buildHumanReportPresentation(report);
      const markdown = renderHumanMarkdownReport(report);
      assert.equal(presentation.pagesInspected, expectedPages);
      assert.equal(presentation.securityObservationCount, expectedNotes);
      assert.equal(presentation.securityObservations.length, expectedNotes);
      assert.equal(presentation.atAGlance.length, expectedNotes);
      if (expectedNotes === 0) {
        assert.match(
          markdown,
          /No security-related observations are listed for the inspected web pages/
        );
      }
      assert.ok(presentation.atAGlance.every(item => item.type === 'Security note'));
      for (const note of presentation.securityObservations) {
        assert.deepEqual(
          note.pages.map(page => page.title),
          ['HTML page']
        );
        assert.equal(note.scope, '1 page');
        assert.doesNotMatch(note.evidence.join('\n'), /PDF_SERVER_EVIDENCE/);
      }
      assert.doesNotMatch(markdown, /PDF_SERVER_EVIDENCE|file\.pdf|PDF response/);
      assert.equal(
        JSON.stringify(report),
        canonicalBefore,
        'Human projection must not change canonical JSON.'
      );
    });
  }
  check('one excluded-only note leaves no human security items', () => {
    const report = fixture([pdf]);
    report.passiveSecurity.observations = report.passiveSecurity.observations.filter(
      note => note.code === 'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED'
    );
    const canonicalBefore = JSON.stringify(report);
    const presentation = buildHumanReportPresentation(report);
    assert.equal(report.passiveSecurity.observations.length, 1);
    assert.equal(presentation.pagesInspected, 0);
    assert.equal(presentation.securityObservationCount, 0);
    assert.equal(presentation.atAGlance.length, 0);
    assert.equal(JSON.stringify(report), canonicalBefore);
  });
  check('excluded-only notes do not leave gaps or suppress unassociated notes', () => {
    const report = fixture([pdf, protectedHtml]);
    const unassociated = structuredClone(report.passiveSecurity.observations[0]!);
    unassociated.occurrences[0]!.pageUrl = 'https://example.com/unassociated';
    unassociated.occurrences[0]!.pageTitle = 'Unassociated response';
    report.passiveSecurity.observations.push(unassociated);
    const presentation = buildHumanReportPresentation(report);
    assert.equal(presentation.securityObservationCount, 1);
    assert.equal(presentation.securityObservations[0]!.displayId, 'S01');
    assert.deepEqual(
      presentation.securityObservations[0]!.pages.map(page => page.title),
      ['Unassociated response']
    );
  });
  check('unassociated security observations remain visible', () => {
    const report = fixture([html], false);
    const presentation = buildHumanReportPresentation(report);
    assert.equal(presentation.pagesInspected, 0);
    assert.equal(presentation.securityObservationCount, report.passiveSecurity.observations.length);
    assert.ok(
      presentation.securityObservations.some(note =>
        note.evidence.join(' ').includes('HTML_SERVER_EVIDENCE')
      )
    );
    report.passiveSecurity.observations[0]!.occurrences = [];
    assert.match(renderHumanMarkdownReport(report), /No page location was recorded/);
    assert.doesNotMatch(renderHumanMarkdownReport(report), /Found on 0 pages/);
    assert.equal(
      buildHumanReportPresentation(report).securityObservationCount,
      presentation.securityObservationCount
    );
  });
  check('response-scoped security wording with mixed header coverage', () => {
    const report = fixture([html, protectedHtml]);
    const canonicalBefore = JSON.stringify(report);
    const presentation = buildHumanReportPresentation(report);
    const markdown = renderHumanMarkdownReport(report);
    for (const code of [
      'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED',
      'PS_HSTS_NOT_OBSERVED',
      'PS_NOSNIFF_NOT_ENFORCING',
      'PS_FRAME_POLICY_NOT_OBSERVED'
    ]) {
      const note = presentation.securityObservations.find(item =>
        item.technicalDetails.includes('Security code: ' + code)
      )!;
      assert.deepEqual(
        note.pages.map(page => page.title),
        ['HTML page']
      );
      assert.match(note.whatHappened, /response/i);
      assert.doesNotMatch(note.whatHappened, /The site /);
    }
    const hsts = presentation.securityObservations.find(item =>
      item.technicalDetails.includes('Security code: PS_HSTS_NOT_OBSERVED')
    )!;
    assert.match(hsts.whyItMayMatter, /Other protections may still apply/);
    assert.doesNotMatch(
      markdown,
      /Future visits were not required|This removes a browser safeguard|The site did not send/
    );
    assert.equal(JSON.stringify(report), canonicalBefore);
    const nonEnforcing = structuredClone(html);
    nonEnforcing.headers['strict-transport-security'] = ['max-age=0'];
    const invalidHsts = buildHumanReportPresentation(
      fixture([nonEnforcing])
    ).securityObservations.find(item =>
      item.technicalDetails.includes('Security code: PS_HSTS_NOT_ENFORCING')
    )!;
    assert.match(invalidHsts.whatHappened, /response/i);
    assert.match(invalidHsts.whyItMayMatter, /Other protections may still apply/);
  });
  assert.equal(failures.length, 0, 'Security projection regressions failed.');
  for (const [name, snapshots] of [
    ['mixed-html-pdf', [html, pdf]],
    ['mixed-header-coverage', [html, protectedHtml]]
  ] as const) {
    const report = fixture([...snapshots]);
    report.runId = 'human-security-' + name + '-' + Date.now();
    const expectedJson = JSON.stringify(report, null, 2) + '\n';
    const paths = await persistSiteAgentReport(report);
    assert.equal(await readFile(paths.jsonReportPath, 'utf8'), expectedJson);
    assert.equal(
      await readFile(paths.markdownReportPath, 'utf8'),
      renderHumanMarkdownReport(report)
    );
    for (const note of buildHumanReportPresentation(report).securityObservations) {
      const evidenceText = await readFile(join(paths.directoryPath, note.evidencePath), 'utf8');
      assert.doesNotMatch(evidenceText, /PDF_SERVER_EVIDENCE|file\.pdf|PDF response/);
      assert.ok(evidenceText.includes(note.whatHappened));
    }
    console.log('Security example: ' + paths.markdownReportPath);
  }
}

function checkUnstructuredHttp404Presentation(): void {
  const resourceUrl = 'https://media.example.net/catalog/reviews.json';
  const observation = `A request to ${resourceUrl.replace('https://', '')} returned a 404 status.`;
  const browserText = 'Failed to load resource: the server responded with a status of 404 ()';
  const condition = 'A file required to display review content could not be found.';
  const impact = 'The endpoint does not exist, which may affect the visible review scores.';
  const report = createAcceptanceReport();
  const finding = createFinding(27, {
    title: 'Review content might be missing',
    evidence: observation,
    reasoning: impact,
    category: 'technical'
  });
  report.findings = [finding];
  report.humanNarratives = {
    state: 'complete',
    exploratory: [
      {
        findingReference: finding.findingReference,
        plainTitle: 'Review content might be missing',
        plainCondition: condition,
        impactStatement: impact,
        whatToCheck: 'Confirm whether the resource URL is correct and check the visible scores.'
      }
    ]
  };
  const page = report.inspectedPages[0]!;
  const rawCandidate = exploratoryQaFindingSchema.parse(
    finding.occurrences[0]!.evidence[0]!.rawSource!.value
  );
  page.exploratoryFindingResults = [
    {
      candidateReference: 'candidate-27',
      finding: rawCandidate,
      outcome: {
        status: 'inconclusive',
        summary: 'The visible impact was not established.',
        evidence: []
      }
    }
  ];
  page.diagnostics = {
    consoleErrors: [{ text: browserText, sourceUrl: resourceUrl, lineNumber: 0, columnNumber: 0 }],
    failedRequests: []
  };

  const before = JSON.stringify(report);
  const presentation = buildHumanReportPresentation(report).detailedFindings[0]!;
  const markdown = renderHumanMarkdownReport(report);
  assert.equal(
    JSON.stringify(report),
    before,
    'Rendering must not mutate saved data or narratives.'
  );
  assert.equal(presentation.findingReference, finding.findingReference);
  assert.equal(presentation.status, 'Needs review');
  assert.equal(presentation.severity, 'low');
  assert.ok(
    presentation.whatHappened.startsWith('The browser recorded an HTTP 404 (Not Found) response')
  );
  assert.ok(presentation.whyItMayMatter.startsWith('If the page depends on this resource,'));
  assert.ok(presentation.whyItMayMatter.includes('response alone does not establish'));
  assert.ok(presentation.whatStillNeedsChecking.includes('repeat the request'));
  assert.ok(presentation.whatStillNeedsChecking.includes('works as intended'));
  const ordinaryReadingPath = visibleMarkdown(markdown);
  assert.ok(!ordinaryReadingPath.includes(condition));
  assert.ok(!ordinaryReadingPath.includes(impact));
  assert.ok(!ordinaryReadingPath.includes('Original AI'));
  const technicalDetails = markdown.match(/<details>[\s\S]*?<\/details>/)?.[0] ?? '';
  assert.ok(technicalDetails.includes(`Recorded browser observation: ${browserText}`));
  assert.ok(
    technicalDetails.includes(
      'Original AI title (unverified interpretation): Review content might be missing'
    )
  );
  assert.ok(
    technicalDetails.includes(`Original AI condition (unverified interpretation): ${condition}`)
  );
  assert.ok(technicalDetails.includes(`Original AI impact (unverified interpretation): ${impact}`));
  assert.ok(
    technicalDetails.includes(
      `Original AI suggested check: ${report.humanNarratives.exploratory[0]!.whatToCheck}`
    )
  );
  assert.ok(markdown.includes(`Resource URL: ${resourceUrl}`));
  assert.ok(markdown.includes(`Candidate observation (AI analysis): ${observation}`));
  assert.ok(markdown.includes('https://example.com/settings'));

  function changeObservation(copy: SiteAgentReportV4, value: string): void {
    const candidate = copy.inspectedPages[0]!.exploratoryFindingResults[0]!.finding;
    candidate.evidence = value;
    copy.findings[0]!.occurrences[0]!.evidence[0]!.rawSource!.value = structuredClone(candidate);
  }

  const rejectedAssociations: [string, (copy: SiteAgentReportV4) => void][] = [
    [
      'missing browser evidence',
      copy => {
        copy.inspectedPages[0]!.diagnostics.consoleErrors = [];
      }
    ],
    [
      'missing candidate evidence',
      copy => {
        copy.findings[0]!.occurrences[0]!.evidence = [];
      }
    ],
    [
      'missing provenance',
      copy => {
        delete copy.findings[0]!.occurrences[0]!.evidence[0]!.rawReference;
      }
    ],
    [
      'wrong page',
      copy => {
        copy.inspectedPages[0]!.observation.finalUrl = 'https://example.com/other';
      }
    ],
    [
      'wrong candidate',
      copy => {
        copy.inspectedPages[0]!.exploratoryFindingResults[0]!.candidateReference = 'candidate-28';
      }
    ],
    [
      'different candidate observation',
      copy => {
        copy.inspectedPages[0]!.exploratoryFindingResults[0]!.finding.evidence =
          'Another request failed.';
      }
    ],
    [
      'multiple possible resources',
      copy => {
        changeObservation(
          copy,
          `A request to ${resourceUrl} or https://other.example.net/data.json returned HTTP 404.`
        );
      }
    ],
    [
      'unidentified resource',
      copy => {
        changeObservation(copy, 'A resource request returned HTTP 404.');
      }
    ],
    [
      'unrelated 404',
      copy => {
        copy.inspectedPages[0]!.diagnostics.consoleErrors[0]!.sourceUrl =
          'https://other.example.net/data.json';
      }
    ],
    [
      'different browser status',
      copy => {
        copy.inspectedPages[0]!.diagnostics.consoleErrors[0]!.text =
          'Failed to load resource: HTTP 500';
      }
    ],
    [
      'ambiguous protocol',
      copy => {
        copy.inspectedPages[0]!.diagnostics.consoleErrors.push({
          ...page.diagnostics.consoleErrors[0]!,
          sourceUrl: resourceUrl.replace('https:', 'http:')
        });
      }
    ],
    [
      '404 in resource name only',
      copy => {
        changeObservation(copy, `A request to ${resourceUrl}/404 is pending.`);
      }
    ]
  ];

  for (const [label, modify] of rejectedAssociations) {
    const copy = structuredClone(report);
    modify(copy);
    const unchanged = JSON.stringify(copy);
    const item = buildHumanReportPresentation(copy).detailedFindings[0]!;
    assert.ok(!item.technicalDetails.some(detail => detail.startsWith('Resource URL:')), label);
    assert.ok(!item.whatHappened.includes('Recorded browser observation:'), label);
    assert.ok(!item.whatHappened.startsWith('The browser recorded an HTTP 404'), label);
    assert.equal(
      item.whatStillNeedsChecking,
      report.humanNarratives.exploratory[0]!.whatToCheck,
      label
    );
    if (
      item.whatHappened.startsWith(
        'Candidate observation (AI analysis; not independently confirmed):'
      )
    ) {
      assert.ok(
        item.whatHappened.endsWith(`Original AI interpretation (unverified): ${condition}`),
        label
      );
      assert.ok(
        item.whyItMayMatter.startsWith(`Original AI interpretation (unverified): ${impact}`),
        label
      );
    }
    assert.equal(JSON.stringify(copy), unchanged, label);
  }

  const fullUrl = structuredClone(report);
  changeObservation(fullUrl, `A request to ${resourceUrl} returned HTTP 404.`);
  fullUrl.inspectedPages[0]!.diagnostics.consoleErrors.push({
    ...page.diagnostics.consoleErrors[0]!,
    sourceUrl: 'https://unrelated.example.net/404.json'
  });
  const fullUrlItem = buildHumanReportPresentation(fullUrl).detailedFindings[0]!;
  assert.ok(fullUrlItem.technicalDetails.includes(`Resource URL: ${resourceUrl}`));
  assert.ok(!fullUrlItem.technicalDetails.join('\n').includes('unrelated.example.net'));
  console.log(
    'Unstructured HTTP 404 presentation and conservative evidence association checks passed.'
  );
}

async function main(): Promise<void> {
  checkUnstructuredHttp404Presentation();
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
  exploratoryFinding.suggestedCheck =
    'Verify whether quantity changes should update the checkout total.';
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
  const exploratoryNarrative = exploratoryEnriched.humanNarratives.exploratory[0]!;

  assert.equal(exploratoryNarrative.impactStatement, 'This may cause confusion.');
  assert.equal(
    exploratoryNarrative.whatToCheck,
    'Verify whether quantity changes should update the checkout total.'
  );
  const exploratoryPresentation = buildHumanReportPresentation(exploratoryEnriched);
  const exploratoryDetail = exploratoryPresentation.detailedFindings[0]!;
  assert.equal(exploratoryDetail.status, 'Needs review');
  assert.equal(
    exploratoryDetail.whyItMayMatter,
    'The available evidence suggests: This may cause confusion.'
  );
  assert.equal(
    exploratoryDetail.whatStillNeedsChecking,
    'Verify whether quantity changes should update the checkout total.'
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
  assert.match(exploratoryRenderOne, /The available evidence suggests: This may cause confusion\./);
  assert.match(
    exploratoryRenderOne,
    /Verify whether quantity changes should update the checkout total\./
  );
  assert.doesNotMatch(
    exploratoryRenderOne,
    /CheckQuest has not established any further user impact yet\./
  );
  assert.doesNotMatch(
    exploratoryRenderOne,
    /Check whether this behavior is intentional\. If not, correct the affected part\./
  );
  assert.doesNotMatch(exploratoryRenderOne, /users may select the wrong option/i);
  assert.doesNotMatch(exploratoryRenderOne, /Possible stale total/);

  const distinctGuidanceReport = createAcceptanceReport();
  const trackingGuidanceFinding = createFinding(20, {
    title: 'Possible tracking configuration issue',
    evidence: 'A tracking request did not complete.',
    reasoning: 'The service configuration may need review.'
  });
  trackingGuidanceFinding.suggestedCheck =
    'Verify whether the tracking service is required and correctly configured.';
  const promotionGuidanceFinding = createFinding(21, {
    title: 'Possible promotional-link placement issue',
    evidence: 'Promotional links appear alongside the main content.',
    reasoning: 'The placement may make the content harder to distinguish.'
  });
  promotionGuidanceFinding.suggestedCheck =
    'Check whether promotional links are clearly separated from the main content.';
  distinctGuidanceReport.findings = [trackingGuidanceFinding, promotionGuidanceFinding];
  let distinctGuidanceGeneratorCalls = 0;
  const distinctGuidanceEnriched = await enrichSiteAgentReportWithHumanNarratives(
    distinctGuidanceReport,
    {
      generateNarrative: async input => {
        distinctGuidanceGeneratorCalls += 1;
        return fixedNarrative(input);
      }
    }
  );

  assert.deepEqual(
    distinctGuidanceEnriched.humanNarratives.exploratory.map(narrative => narrative.whatToCheck),
    [
      'Verify whether the tracking service is required and correctly configured.',
      'Check whether promotional links are clearly separated from the main content.'
    ]
  );
  renderHumanMarkdownReport(distinctGuidanceEnriched);
  assert.equal(distinctGuidanceGeneratorCalls, 2);

  const fallbackGuidanceReport = createAcceptanceReport();
  const missingGuidanceFinding = createFinding(22, {
    title: 'Possible missing-guidance condition',
    evidence: 'A possible condition was observed.',
    reasoning: 'The condition may need review.'
  });
  missingGuidanceFinding.suggestedCheck = null;
  const blankGuidanceFinding = createFinding(23, {
    title: 'Possible blank-guidance condition',
    evidence: 'Another possible condition was observed.',
    reasoning: 'The condition may need review.'
  });
  blankGuidanceFinding.suggestedCheck = '  \n  ';
  fallbackGuidanceReport.findings = [missingGuidanceFinding, blankGuidanceFinding];
  const fallbackGuidanceEnriched = await enrichSiteAgentReportWithHumanNarratives(
    fallbackGuidanceReport,
    { generateNarrative: async input => fixedNarrative(input) }
  );
  const genericWhatToCheck =
    'Confirm whether the reported condition is present and unintended. If confirmed, review the affected value or behavior and decide whether it should be corrected.';

  assert.deepEqual(
    fallbackGuidanceEnriched.humanNarratives.exploratory.map(narrative => narrative.whatToCheck),
    [genericWhatToCheck, genericWhatToCheck]
  );

  const duplicateOptionReport = structuredClone(exploratoryEnriched);
  const duplicateOptionFinding = duplicateOptionReport.findings[0]!;
  const duplicateOptionNarrative = duplicateOptionReport.humanNarratives.exploratory[0]!;
  duplicateOptionFinding.title = 'Duplicate entry in country selection dropdown';
  duplicateOptionFinding.occurrences[0]!.target = {
    kind: 'select-option',
    controlLabel: 'Country',
    controlName: 'country',
    controlId: 'country',
    optionText: 'קנדה'
  };
  duplicateOptionNarrative.plainTitle = 'Duplicate country option in menu';
  duplicateOptionNarrative.plainCondition =
    'The country selection list displays the name for Canada twice.';
  const duplicateOptionPresentation =
    buildHumanReportPresentation(duplicateOptionReport).detailedFindings[0]!;
  const duplicateOptionMarkdown = renderHumanMarkdownReport(duplicateOptionReport);

  assert.equal(
    duplicateOptionPresentation.title,
    'Possible issue: Duplicate country option in menu'
  );
  assert.equal(
    duplicateOptionPresentation.whatHappened,
    'The available evidence suggests: The country selection list displays the name for Canada twice.'
  );
  assert.match(
    duplicateOptionMarkdown,
    /### 01 — Possible issue: Duplicate country option in menu/
  );
  assert.match(
    duplicateOptionMarkdown,
    /The available evidence suggests: The country selection list displays the name for Canada twice\./
  );
  assert.doesNotMatch(duplicateOptionMarkdown, /Visible option “קנדה” may need review/);
  assert.doesNotMatch(duplicateOptionMarkdown, /includes the visible option “קנדה”/);

  const ordinaryOptionReport = structuredClone(exploratoryEnriched);
  const ordinaryOptionFinding = ordinaryOptionReport.findings[0]!;
  const ordinaryOptionNarrative = ordinaryOptionReport.humanNarratives.exploratory[0]!;
  ordinaryOptionFinding.title = 'Country option may need review';
  ordinaryOptionFinding.occurrences[0]!.target = {
    kind: 'select-option',
    controlLabel: 'Country',
    controlName: 'country',
    controlId: 'country',
    optionText: 'Canada'
  };
  ordinaryOptionNarrative.plainTitle = 'Country option may need review';
  ordinaryOptionNarrative.plainCondition = 'The Country list includes the visible option Canada.';
  const ordinaryOptionPresentation =
    buildHumanReportPresentation(ordinaryOptionReport).detailedFindings[0]!;

  assert.equal(ordinaryOptionPresentation.title, 'Visible option “Canada” may need review');
  assert.equal(
    ordinaryOptionPresentation.whatHappened,
    'The “Country” list includes the visible option “Canada”.'
  );

  const missingNarrativeFields = structuredClone(exploratoryEnriched);
  const incompleteNarrative = missingNarrativeFields.humanNarratives.exploratory[0] as Partial<
    (typeof missingNarrativeFields.humanNarratives.exploratory)[number]
  >;

  delete incompleteNarrative.impactStatement;
  incompleteNarrative.whatToCheck = '   ';

  const missingNarrativeDetail =
    buildHumanReportPresentation(missingNarrativeFields).detailedFindings[0]!;

  assert.equal(
    missingNarrativeDetail.whyItMayMatter,
    'CheckQuest has not established any further user impact yet.'
  );
  assert.equal(
    missingNarrativeDetail.whatStillNeedsChecking,
    'Check whether this behavior is intentional. If not, correct the affected part.'
  );

  const confirmedExploratoryFinding = createFinding(15, {
    title: 'Checkout total does not update',
    evidence: 'The total remained unchanged after a quantity change.',
    reasoning: 'This may block checkout with the intended quantity.',
    state: 'verified',
    browserBacked: true
  });
  const confirmedExploratoryReport = createAcceptanceReport();
  confirmedExploratoryReport.findings = [confirmedExploratoryFinding];
  const confirmedExploratoryEnriched = await enrichSiteAgentReportWithHumanNarratives(
    confirmedExploratoryReport,
    {
      generateNarrative: async input => fixedNarrative(input)
    }
  );
  const confirmedExploratoryDetail = buildHumanReportPresentation(confirmedExploratoryEnriched)
    .detailedFindings[0]!;

  assert.equal(confirmedExploratoryDetail.status, 'Confirmed issue');
  assert.equal(
    confirmedExploratoryDetail.whyItMayMatter,
    'This may block checkout with the intended quantity.'
  );
  assert.equal(
    confirmedExploratoryDetail.whatStillNeedsChecking,
    'Review the confirmed condition and decide how the affected value or behavior should be corrected.'
  );

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

  await checkSecurityProjection(enriched);

  const unrelatedContentBefore = buildHumanReportPresentation(enriched);
  const contentTypeReport = structuredClone(enriched);
  const contentTypeCases = [
    {
      url: 'https://example.com/content-a',
      title: 'HTML content',
      contentTypes: ['text/html; charset=UTF-8']
    },
    {
      url: 'https://example.com/content-b',
      title: 'XHTML content',
      contentTypes: ['application/xhtml+xml']
    },
    {
      url: 'https://example.com/content-c',
      title: 'Image response',
      contentTypes: ['image/png']
    },
    {
      url: 'https://example.com/content-d',
      title: 'PDF response',
      contentTypes: ['application/pdf']
    },
    {
      url: 'https://example.com/content-e',
      title: 'XML response',
      contentTypes: ['text/xml']
    },
    {
      url: 'https://example.com/content-f',
      title: 'Missing content type',
      contentTypes: undefined
    },
    {
      url: 'https://example.com/content-g',
      title: 'Malformed content type',
      contentTypes: ['not a media type']
    }
  ];
  contentTypeReport.inspectedPages = contentTypeCases.map(item => {
    const page = structuredClone(contentTypeReport.inspectedPages[0]!);

    page.observation.requestedUrl = item.url;
    page.observation.finalUrl = item.url;
    page.observation.title = item.title;
    return page;
  });
  contentTypeReport.passiveSecurity.pageSnapshots = contentTypeCases.map(item =>
    pageSecuritySnapshot(item.url, item.title, item.contentTypes)
  );
  for (const observation of contentTypeReport.passiveSecurity.observations) {
    const occurrence = observation.occurrences[0]!;
    observation.occurrences = contentTypeCases.map(item => ({
      ...structuredClone(occurrence),
      pageUrl: item.url,
      pageTitle: item.title,
      responseUrl: item.url
    }));
  }
  contentTypeReport.summary.pagesInspected = contentTypeReport.inspectedPages.length;
  const contentTypePersistedBefore = JSON.stringify({
    inspectedPages: contentTypeReport.inspectedPages,
    findings: contentTypeReport.findings,
    securityObservations: contentTypeReport.passiveSecurity.observations
  });
  const contentTypeGeneratorCallsBeforeRender = generatorCalls;
  const contentTypePresentation = buildHumanReportPresentation(contentTypeReport);
  const contentTypeMarkdown = renderHumanMarkdownReport(contentTypeReport);
  const pagesInspectedSection = contentTypeMarkdown.slice(
    contentTypeMarkdown.indexOf('## Pages inspected')
  );

  assert.equal(contentTypePresentation.pagesInspected, 4);
  assert.deepEqual(
    contentTypePresentation.inspectedPages.map(page => page.page.title),
    ['HTML content', 'XHTML content', 'Missing content type', 'Malformed content type']
  );
  assert.match(contentTypeMarkdown, /CheckQuest inspected 4 pages/);
  assert.equal(pagesInspectedSection.split('\n').filter(line => /^\| \d+ \|/.test(line)).length, 4);
  assert.match(pagesInspectedSection, /content-a/);
  assert.match(pagesInspectedSection, /content-b/);
  assert.match(pagesInspectedSection, /content-f/);
  assert.match(pagesInspectedSection, /content-g/);
  assert.doesNotMatch(pagesInspectedSection, /content-c/);
  assert.doesNotMatch(pagesInspectedSection, /content-d/);
  assert.doesNotMatch(pagesInspectedSection, /content-e/);
  assert.equal(contentTypeReport.inspectedPages.length, 7);
  assert.equal(contentTypeReport.summary.pagesInspected, 7);
  assert.deepEqual(
    contentTypePresentation.securityObservations[0]!.pages.map(page => page.title),
    ['HTML content', 'XHTML content', 'Missing content type', 'Malformed content type']
  );
  assert.ok(
    contentTypePresentation.securityObservations.every(
      observation => observation.pages.length === 4
    )
  );
  const contentTypeSecuritySection = contentTypeMarkdown.slice(
    contentTypeMarkdown.indexOf('### S01 —'),
    contentTypeMarkdown.indexOf('## Pages inspected')
  );
  assert.match(contentTypeSecuritySection, /Found on all 4 inspected pages/);
  assert.doesNotMatch(contentTypeSecuritySection, /content-c|content-d|content-e/);
  assert.deepEqual(
    contentTypePresentation.detailedFindings,
    unrelatedContentBefore.detailedFindings
  );
  assert.deepEqual(
    contentTypePresentation.technicalObservations,
    unrelatedContentBefore.technicalObservations
  );
  assert.equal(
    JSON.stringify({
      inspectedPages: contentTypeReport.inspectedPages,
      findings: contentTypeReport.findings,
      securityObservations: contentTypeReport.passiveSecurity.observations
    }),
    contentTypePersistedBefore
  );
  assert.equal(generatorCalls, contentTypeGeneratorCallsBeforeRender);

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
  assert.match(
    firstRender,
    /The affected page responses did not include a security header that limits unwanted scripts and other content\./
  );
  assert.match(firstRender, /Its absence from a response does not prove the page is vulnerable/);
  assert.doesNotMatch(
    firstRender.match(
      /### S01 — A page response lacked a header that limits unwanted scripts[\s\S]*?(?=\n---)/
    )?.[0] ?? '',
    /scripts? only/i
  );
  assert.match(firstRender, /server technology used to deliver them/);
  assert.match(firstRender, /software or platform used to deliver them/);
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
    /A page response lacked a header that limits unwanted scripts/
  );
  assert.match(representativeMarkdown, /A page response identifies its server technology/);
  assert.match(representativeMarkdown, /A page response identifies its software platform/);
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
