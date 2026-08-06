import assert from 'node:assert/strict';

import type { ClassifiedDiagnostics } from '../../agent/analysis/classify-diagnostics';
import { buildExploratoryQaPrompt } from '../../agent/analysis/build-exploratory-qa-prompt';
import {
  exploratoryQaAnalysisSchema,
  type ExploratoryQaAnalysis,
  type ExploratoryQaFinding
} from '../../agent/analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../../agent/browser/extracted-page-content';
import { commitRunPageFindings } from '../../agent/findings/commit-run-page-findings';
import type { UnifiedFinding } from '../../agent/findings/finding-model';
import {
  prepareKnownFindingAnalysis,
  prepareRunPageFindings,
  type PreparedRunPageFindings
} from '../../agent/findings/prepare-run-page-findings';
import {
  createRunFindingLifecycle,
  getRunFindings,
  type RunFindingLifecycleState
} from '../../agent/findings/run-finding-lifecycle';
import type { FindingInvestigationOutcome } from '../../agent/investigation/evaluate-finding-investigation-outcome';
import type { SiteAgentReport } from '../../agent/reporting/report-types';
import { renderHumanMarkdownReport } from '../../agent/reporting/write-markdown-report';

interface FailedRequestFixture {
  url: string;
  resourceType: string;
  failureText: string;
  disposition?: 'actionable' | 'needs-review';
}

interface CorsDiagnosticFixture {
  resourceUrl?: string;
  mechanism?: string;
  method?: string;
  resourceType?: 'fetch' | 'xhr';
  includeMatchingRequest?: boolean;
  reverseDiagnosticOrder?: boolean;
}

function createContent(title: string): ExtractedPageContent {
  return {
    title,
    headings: [title],
    bodyText: title,
    links: [],
    buttons: [],
    textFields: [],
    selects: [],
    disclosures: [],
    tabs: []
  };
}

function createDiagnostics(requests: FailedRequestFixture[]): ClassifiedDiagnostics {
  return {
    consoleErrors: [],
    failedRequests: requests.map(request => ({
      request: {
        ...request,
        method: 'GET'
      },
      disposition: request.disposition ?? 'actionable',
      reason: 'Synthetic deterministic technical observation.'
    }))
  };
}

function createCorsDiagnostics(
  pageUrl: string,
  fixture: CorsDiagnosticFixture = {}
): ClassifiedDiagnostics {
  const resourceUrl = fixture.resourceUrl ?? 'https://tr.capterra.com/events/';
  const mechanism =
    fixture.mechanism ??
    "Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
  const resourceType = fixture.resourceType ?? 'xhr';
  const requestKind = resourceType === 'xhr' ? 'XMLHttpRequest' : 'fetch';
  const requestingOrigin = new URL(pageUrl).origin;
  const corsConsoleError = {
    text: `Access to ${requestKind} at '${resourceUrl}' from origin '${requestingOrigin}' has been blocked by CORS policy: ${mechanism}`,
    sourceUrl: pageUrl,
    lineNumber: 0,
    columnNumber: 0
  };
  const unrelatedConsoleError = {
    text: 'Synthetic unrelated console error.',
    sourceUrl: pageUrl,
    lineNumber: 1,
    columnNumber: 1
  };
  const matchingRequest = {
    request: {
      url: resourceUrl,
      method: fixture.method ?? 'POST',
      resourceType,
      failureText: 'net::ERR_FAILED'
    },
    disposition: 'needs-review' as const,
    reason: 'Synthetic browser failure paired with the CORS console diagnostic.'
  };
  const unrelatedRequest = {
    request: {
      url: 'https://unrelated.example.net/noise.png',
      method: 'GET',
      resourceType: 'image',
      failureText: 'net::ERR_ABORTED'
    },
    disposition: 'needs-review' as const,
    reason: 'Synthetic unrelated browser failure.'
  };
  const consoleErrors = fixture.reverseDiagnosticOrder
    ? [unrelatedConsoleError, corsConsoleError]
    : [corsConsoleError, unrelatedConsoleError];
  const failedRequests =
    fixture.includeMatchingRequest === false
      ? [unrelatedRequest]
      : fixture.reverseDiagnosticOrder
        ? [unrelatedRequest, matchingRequest]
        : [matchingRequest, unrelatedRequest];

  return {
    consoleErrors,
    failedRequests
  };
}

function createConsoleDiagnostics(
  consoleErrors: ClassifiedDiagnostics['consoleErrors']
): ClassifiedDiagnostics {
  return {
    consoleErrors,
    failedRequests: []
  };
}

function createTechnicalFinding(
  references: string[] | null,
  overrides: Partial<ExploratoryQaFinding> = {}
): ExploratoryQaFinding {
  return {
    knownFindingReference: null,
    relatedRuleCode: null,
    category: 'technical',
    severity: 'medium',
    confidence: 'high',
    title: 'Failed external script resource requests',
    evidence: 'One or more supplied resource requests failed.',
    reasoning: 'The failed requests may affect dependent functionality.',
    suggestedCheck: 'Confirm whether the affected resources are required.',
    evidenceTarget: null,
    presentationTarget: null,
    structuredIdentity: null,
    technicalEvidenceReferences: references,

    /*
     * This deliberately untrusted value proves runtime normalization does not
     * accept model-supplied identity when no valid evidence reference exists.
     */
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'invented failure',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://invented.invalid/fake.js',
      originRelation: 'cross-origin'
    },
    ...overrides
  };
}

function createAnalysis(finding: ExploratoryQaFinding): ExploratoryQaAnalysis {
  return {
    findings: [finding],
    summary: 'Synthetic technical reconciliation analysis.'
  };
}

function reconcilePage(
  lifecycle: RunFindingLifecycleState,
  input: {
    pageUrl: string;
    diagnostics: ClassifiedDiagnostics;
    finding: ExploratoryQaFinding;
  }
): PreparedRunPageFindings {
  const pageContent = createContent('Technical observations');
  const knownFindingPreparation = prepareKnownFindingAnalysis(
    lifecycle.knownFindingState,
    pageContent
  );

  return prepareRunPageFindings(lifecycle.knownFindingState, {
    pageUrl: input.pageUrl,
    pageTitle: 'Technical observations',
    pageContent,
    ruleFindings: [],
    rawExploratoryQaAnalysis: createAnalysis(input.finding),
    classifiedDiagnostics: input.diagnostics,
    knownFindingPreparation
  });
}

function commitPage(
  lifecycle: RunFindingLifecycleState,
  page: PreparedRunPageFindings,
  pageUrl: string
): void {
  const outcome: FindingInvestigationOutcome = {
    status: 'inconclusive',
    summary: 'No supported deterministic investigation action is available.',
    evidence: []
  };

  commitRunPageFindings(lifecycle, {
    page,
    pageUrl,
    pageTitle: 'Technical observations',
    pageNumber: 1,
    screenshotPath: null,
    exploratoryFindingResults: page.pageCandidates.map(candidate => ({
      candidateReference: candidate.reference,
      finding: candidate.finding,
      outcome
    }))
  });
}

function createMinimalReport(
  findings: UnifiedFinding[],
  pages: Array<{
    url: string;
    diagnostics: ClassifiedDiagnostics;
  }>
): SiteAgentReport {
  return {
    reportSchemaVersion: '3',
    runId: 'console-association-check',
    startedAt: '2026-08-06T06:00:00.000Z',
    finishedAt: '2026-08-06T06:01:00.000Z',
    site: {
      id: 'runtime',
      name: 'Runtime exploration: example.com',
      startUrl: pages[0]?.url ?? 'https://example.com/'
    },
    homepage: {
      requestedUrl: pages[0]?.url ?? 'https://example.com/',
      finalUrl: pages[0]?.url ?? 'https://example.com/',
      title: 'Synthetic homepage',
      httpStatus: 200,
      headings: []
    },
    outcome: {
      type: 'finished',
      summary: 'Synthetic deterministic run.'
    },
    inspectedPages: pages.map((page, index) => ({
      selection: {
        type: index === 0 ? 'start-url' : 'navigation',
        url: page.url
      },
      observation: {
        requestedUrl: page.url,
        finalUrl: page.url,
        title: `Page ${index + 1}`,
        httpStatus: 200,
        headings: []
      },
      diagnostics: page.diagnostics,
      presentationEvidence: []
    })),
    findings,
    siteWideExploratoryFindings: [],
    passiveSecurity: {
      disclaimer: 'Synthetic passive-security disclaimer.',
      observations: []
    },
    summary: {}
  } as unknown as SiteAgentReport;
}

function createConsoleFinding(
  evidence: string,
  overrides: Partial<ExploratoryQaFinding> = {}
): ExploratoryQaFinding {
  return createTechnicalFinding(null, {
    title: 'Invalid SVG attribute value',
    evidence,
    technicalIdentity: null,
    ...overrides
  });
}

function assertUnmatchedConsoleCandidate(input: {
  pageUrl: string;
  finding: ExploratoryQaFinding;
  diagnostics: ClassifiedDiagnostics;
}): PreparedRunPageFindings {
  const lifecycle = createRunFindingLifecycle();
  const page = reconcilePage(lifecycle, input);
  const reconciled = page.reconciledFindingObservations.findings[0];

  assert.equal(page.exploratoryQaAnalysis.findings[0]?.technicalIdentity, null);
  assert.match(reconciled?.fingerprint ?? '', /^unstructured\|/);
  assert.equal(
    reconciled?.occurrences[0]?.evidence.some(evidence => evidence.source === 'browser'),
    false
  );

  return page;
}

function checkSvgConsoleAssociation(): void {
  const lifecycle = createRunFindingLifecycle();
  const message = 'Error: <svg> attribute height: Expected length, "auto".';
  const fixtures = [
    {
      url: 'https://monday.com/',
      evidence: `The console reported: '${message}'.`,
      lines: [567]
    },
    {
      url: 'https://monday.com/w/enterprise',
      evidence: `The console reported multiple errors: '${message}'.`,
      lines: [742, 759, 1407]
    },
    {
      url: 'https://monday.com/crm',
      evidence: `${message} observed at lines 632 and 698.`,
      lines: [632, 698]
    },
    {
      url: 'https://monday.com/w/nonprofits',
      evidence: `Console error: ${message}`,
      lines: [814]
    }
  ];
  const pages: Array<{ url: string; diagnostics: ClassifiedDiagnostics }> = [];

  for (const fixture of fixtures) {
    const diagnostics = createConsoleDiagnostics(
      fixture.lines.map(lineNumber => ({
        text: message,
        sourceUrl: fixture.url,
        lineNumber,
        columnNumber: 0
      }))
    );
    const page = reconcilePage(lifecycle, {
      pageUrl: fixture.url,
      diagnostics,
      finding: createConsoleFinding(fixture.evidence)
    });
    const reconciled = page.reconciledFindingObservations.findings[0]!;
    const browserEvidence = reconciled.occurrences[0]!.evidence.filter(
      evidence => evidence.source === 'browser' && evidence.kind === 'browser-observation'
    );

    assert.equal(
      page.reconciledFindingObservations.candidateFindings[0]?.technicalIdentity?.kind,
      'console-error'
    );
    assert.match(reconciled.fingerprint, /^technical\|console-error\|inspected-page\|/);
    assert.equal(browserEvidence.length, fixture.lines.length);
    assert.equal(
      browserEvidence.every(evidence => evidence.rawSource?.type === 'console-error-observation'),
      true
    );

    commitPage(lifecycle, page, fixture.url);
    pages.push({ url: fixture.url, diagnostics });
  }

  const findings = getRunFindings(lifecycle);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.occurrences.length, 4);
  assert.deepEqual(
    findings[0]?.occurrences.map(occurrence => occurrence.pageUrl),
    fixtures.map(fixture => fixture.url)
  );

  const markdown = renderHumanMarkdownReport(createMinimalReport(findings, pages));

  assert.match(markdown, /Technical observation/);
  assert.match(markdown, /Console error: Error: &lt;svg&gt; attribute height: Expected length/);
  assert.match(markdown, /\*\*Pages:\*\* [^\n]*\/w\/enterprise[^\n]*\/crm[^\n]*\/w\/nonprofits/);
  assert.doesNotMatch(
    markdown,
    /CheckQuest did not match it to browser, network, console, or runtime diagnostics/
  );
}

function checkPosterImageAssociation(): void {
  const lifecycle = createRunFindingLifecycle();
  const pageUrl = 'https://monday.com/w/enterprise';
  const sourceUrl = 'https://monday.com/w/poster-image.jpg';
  const diagnostic = {
    text: 'Failed to load resource: the server responded with a status of 404 ()',
    sourceUrl,
    lineNumber: 0,
    columnNumber: 0
  };
  const diagnostics = createConsoleDiagnostics([diagnostic]);
  const page = reconcilePage(lifecycle, {
    pageUrl,
    diagnostics,
    finding: createConsoleFinding(
      `A 404 error was observed for the resource located at ${sourceUrl}.`,
      {
        title: 'Failed resource request for poster image'
      }
    )
  });
  const reconciled = page.reconciledFindingObservations.findings[0]!;
  const identity = page.reconciledFindingObservations.candidateFindings[0]?.technicalIdentity;

  assert.deepEqual(identity, {
    kind: 'console-error',
    message: diagnostic.text,
    source: 'resource',
    sourceUrl,
    httpStatus: 404
  });
  assert.match(reconciled.fingerprint, /^technical\|console-error\|resource\|404\|/);
  assert.deepEqual(
    reconciled.occurrences[0]?.evidence
      .filter(evidence => evidence.source === 'browser')
      .map(evidence => evidence.rawSource?.value),
    [diagnostic]
  );

  commitPage(lifecycle, page, pageUrl);

  const markdown = renderHumanMarkdownReport(
    createMinimalReport(getRunFindings(lifecycle), [{ url: pageUrl, diagnostics }])
  );

  assert.match(markdown, /Failed to load resource: the server responded with a status of 404/);
  assert.match(markdown, /https:\/\/monday\.com\/w\/poster-image\.jpg/);
  assert.doesNotMatch(
    markdown,
    /CheckQuest did not match it to browser, network, console, or runtime diagnostics/
  );
}

function checkConsoleAssociationRejections(): void {
  const pageA = 'https://example.com/a';
  const pageB = 'https://example.com/b';
  const resourceA = 'https://example.com/a.jpg';
  const resourceB = 'https://example.com/b.jpg';
  const message404 = 'Failed to load resource: the server responded with a status of 404 ()';
  const svgMessage = 'Error: <svg> attribute height: Expected length, "auto".';
  const resourceDiagnostic = (sourceUrl: string, status = 404) =>
    createConsoleDiagnostics([
      {
        text: `Failed to load resource: the server responded with a status of ${status} ()`,
        sourceUrl,
        lineNumber: 0,
        columnNumber: 0
      }
    ]);

  // 1. A named resource cannot match an anonymous 404.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding(`A 404 error was observed for ${resourceA}.`),
    diagnostics: createConsoleDiagnostics([
      { text: message404, sourceUrl: null, lineNumber: 0, columnNumber: 0 }
    ])
  });

  // 2. Equal 404 prose with different sources retains distinct canonical identity.
  const sourceLifecycle = createRunFindingLifecycle();
  for (const [pageUrl, resourceUrl] of [
    [pageA, resourceA],
    [pageB, resourceB]
  ] as const) {
    const page = reconcilePage(sourceLifecycle, {
      pageUrl,
      diagnostics: resourceDiagnostic(resourceUrl),
      finding: createConsoleFinding(`A 404 error was observed for ${resourceUrl}.`)
    });
    commitPage(sourceLifecycle, page, pageUrl);
  }
  assert.equal(getRunFindings(sourceLifecycle).length, 2);

  // 3. Title equality never bridges different diagnostic messages.
  for (const [pageUrl, candidateMessage, diagnosticMessage] of [
    [pageA, 'Console error: First exact message.', 'Second exact message.'],
    [pageB, 'Console error: Second exact message.', 'First exact message.']
  ] as const) {
    assertUnmatchedConsoleCandidate({
      pageUrl,
      finding: createConsoleFinding(candidateMessage, { title: 'Shared generated title' }),
      diagnostics: createConsoleDiagnostics([
        { text: diagnosticMessage, sourceUrl: pageUrl, lineNumber: 1, columnNumber: 1 }
      ])
    });
  }

  // 4. Similar but non-equal console messages do not match.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding('Console error: Expected length, "auto".'),
    diagnostics: createConsoleDiagnostics([
      { text: svgMessage, sourceUrl: pageA, lineNumber: 1, columnNumber: 1 }
    ])
  });

  // 5. Diagnostics are constrained to the inspected page supplied for preparation.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding(`Console error: ${svgMessage}`),
    diagnostics: createConsoleDiagnostics([])
  });

  // 6. A contradictory stable technical identity is not reassigned.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding(`Console error: ${svgMessage}`, {
      technicalIdentity: {
        kind: 'failed-request',
        failureText: 'net::ERR_ABORTED',
        method: 'GET',
        resourceType: 'script',
        resourceUrl: 'https://cdn.example.net/other.js',
        originRelation: 'cross-origin'
      }
    }),
    diagnostics: createConsoleDiagnostics([
      { text: svgMessage, sourceUrl: pageA, lineNumber: 1, columnNumber: 1 }
    ])
  });

  // 7. A malformed candidate URL does not match.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding('A 404 error was observed for https://[invalid.example/a.jpg.'),
    diagnostics: resourceDiagnostic(resourceA)
  });

  // 8. Multiple candidate URLs are ambiguous.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding(`A 404 affected ${resourceA} and ${resourceB}.`),
    diagnostics: resourceDiagnostic(resourceA)
  });

  // 9. Candidate and captured status codes must agree.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding(`A 500 error was observed for ${resourceA}.`),
    diagnostics: resourceDiagnostic(resourceA)
  });

  // 10. Generic failed-resource prose lacks exact URL/status identity.
  assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding('Failed to load resource'),
    diagnostics: resourceDiagnostic(resourceA)
  });

  // 11. A genuine AI-only technical candidate remains uncorroborated.
  const aiOnlyPage = assertUnmatchedConsoleCandidate({
    pageUrl: pageA,
    finding: createConsoleFinding('The runtime may have reported an unknown client failure.'),
    diagnostics: createConsoleDiagnostics([])
  });

  // 12. Existing failed-request/CORS/DNS identity kinds remain authoritative.
  const structuredLifecycle = createRunFindingLifecycle();
  const failedPage = reconcilePage(structuredLifecycle, {
    pageUrl: pageA,
    diagnostics: createDiagnostics([
      {
        url: 'https://cdn.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]),
    finding: createTechnicalFinding(['technical-request-1'])
  });
  const corsPage = reconcilePage(structuredLifecycle, {
    pageUrl: pageB,
    diagnostics: createCorsDiagnostics(pageB),
    finding: createTechnicalFinding(['technical-cors-1'])
  });
  assert.equal(
    failedPage.reconciledFindingObservations.candidateFindings[0]?.technicalIdentity?.kind,
    'failed-request'
  );
  assert.equal(
    corsPage.reconciledFindingObservations.candidateFindings[0]?.technicalIdentity?.kind,
    'cors'
  );
  assert.match(
    failedPage.reconciledFindingObservations.findings[0]?.fingerprint ?? '',
    /^technical\|failed-request\|net::err_name_not_resolved\|/
  );
  assert.match(
    corsPage.reconciledFindingObservations.findings[0]?.fingerprint ?? '',
    /^technical\|cors\|/
  );

  // 13. Rendering does not search matching-looking diagnostics elsewhere in report input.
  const unlinkedFinding = aiOnlyPage.reconciledFindingObservations.findings[0]!;
  const unlinkedMarkdown = renderHumanMarkdownReport(
    createMinimalReport(
      [unlinkedFinding],
      [
        {
          url: pageB,
          diagnostics: createConsoleDiagnostics([
            {
              text: 'The runtime may have reported an unknown client failure.',
              sourceUrl: pageB,
              lineNumber: 1,
              columnNumber: 1
            }
          ])
        }
      ]
    )
  );
  assert.match(
    unlinkedMarkdown,
    /CheckQuest did not match it to browser, network, console, or runtime diagnostics/
  );
  assert.doesNotMatch(unlinkedMarkdown, /Structured technical evidence/);
}

function checkCrossPageReconciliation(): void {
  const lifecycle = createRunFindingLifecycle();
  const request = {
    url: 'https://cdn.example.net/runtime.js?v=7',
    resourceType: 'script',
    failureText: 'net::ERR_NAME_NOT_RESOLVED'
  };

  for (const pageUrl of ['https://example.com/', 'https://example.com/pricing']) {
    const page = reconcilePage(lifecycle, {
      pageUrl,
      diagnostics: createDiagnostics([request]),
      finding: createTechnicalFinding(['technical-request-1'])
    });

    commitPage(lifecycle, page, pageUrl);
  }

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    1,
    'The same structured technical phenomenon must reconcile across pages.'
  );
  assert.match(findings[0]?.fingerprint ?? '', /^technical\|failed-request\|/);
  assert.deepEqual(
    findings[0]?.occurrences.map(occurrence => occurrence.pageUrl),
    ['https://example.com/', 'https://example.com/pricing']
  );
  assert.equal(findings[0]?.verification.state, 'inconclusive');
}

function checkCorsCrossPageReconciliation(): void {
  const lifecycle = createRunFindingLifecycle();
  const pageUrls = ['https://monday.com/operations', 'https://monday.com/w/nonprofits'];
  const promptDiagnostics = createCorsDiagnostics(pageUrls[0]!);
  const prompt = buildExploratoryQaPrompt({
    observation: {
      requestedUrl: pageUrls[0]!,
      finalUrl: pageUrls[0]!,
      title: 'Monday operations',
      httpStatus: 200,
      headings: []
    },
    content: createContent('Monday operations'),
    classifiedDiagnostics: promptDiagnostics,
    ruleBasedFindings: []
  });

  assert.match(
    prompt,
    /"technicalObservationReference": "technical-cors-1"/,
    'Eligible deterministic CORS evidence must expose an exact reference to the model.'
  );

  pageUrls.forEach((pageUrl, index) => {
    const page = reconcilePage(lifecycle, {
      pageUrl,
      diagnostics: createCorsDiagnostics(pageUrl, {
        reverseDiagnosticOrder: index === 1
      }),
      finding: createTechnicalFinding(['technical-cors-1'])
    });

    assert.equal(
      page.exploratoryQaAnalysis.findings[0]?.technicalIdentity?.kind,
      'cors',
      'A model reference receives CORS identity only from the matched deterministic diagnostic.'
    );
    assert.equal(
      exploratoryQaAnalysisSchema.safeParse(page.exploratoryQaAnalysis).success,
      true,
      'The runtime-derived CORS identity must retain the analysis schema.'
    );

    commitPage(lifecycle, page, pageUrl);
  });

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    1,
    'The same trusted CORS phenomenon must reconcile across inspected pages.'
  );
  assert.match(findings[0]?.fingerprint ?? '', /^technical\|cors\|/);
  assert.deepEqual(
    findings[0]?.occurrences.map(occurrence => occurrence.pageUrl),
    pageUrls,
    'Page and diagnostic ordering must not alter the logical CORS identity.'
  );
  assert.equal(
    findings[0]?.verification.state,
    'inconclusive',
    'Structured CORS identity must not upgrade verification.'
  );
}

function checkCorsIdentitySeparation(): void {
  const lifecycle = createRunFindingLifecycle();
  const cases: Array<{
    pageUrl: string;
    fixture: CorsDiagnosticFixture;
  }> = [
    {
      pageUrl: 'https://monday.com/base',
      fixture: {}
    },
    {
      pageUrl: 'https://monday.com/other-endpoint',
      fixture: {
        resourceUrl: 'https://tr.capterra.com/other-events/'
      }
    },
    {
      pageUrl: 'https://monday.com/other-mechanism',
      fixture: {
        mechanism: "No 'Access-Control-Allow-Origin' header is present on the requested resource."
      }
    },
    {
      pageUrl: 'https://other.example.com/other-origin',
      fixture: {}
    }
  ];

  for (const item of cases) {
    const page = reconcilePage(lifecycle, {
      pageUrl: item.pageUrl,
      diagnostics: createCorsDiagnostics(item.pageUrl, item.fixture),
      finding: createTechnicalFinding(['technical-cors-1'])
    });

    commitPage(lifecycle, page, item.pageUrl);
  }

  const failedRequestPageUrl = 'https://monday.com/non-cors-failure';
  const failedRequestPage = reconcilePage(lifecycle, {
    pageUrl: failedRequestPageUrl,
    diagnostics: createDiagnostics([
      {
        url: 'https://tr.capterra.com/events/',
        resourceType: 'script',
        failureText: 'net::ERR_BLOCKED_BY_ORB'
      }
    ]),
    finding: createTechnicalFinding(['technical-request-1'])
  });

  commitPage(lifecycle, failedRequestPage, failedRequestPageUrl);

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    5,
    'Different CORS endpoints, mechanisms, origins, and non-CORS failures must remain distinct.'
  );
  assert.equal(new Set(findings.map(finding => finding.fingerprint)).size, 5);
  assert.equal(
    findings.filter(finding => finding.fingerprint.startsWith('technical|cors|')).length,
    4
  );
  assert.equal(
    findings.filter(finding => finding.fingerprint.startsWith('technical|failed-request|')).length,
    1,
    'CORS identity must not merge with ORB or other requestfailed mechanisms.'
  );
}

function checkUnmatchedCorsFallback(): void {
  const lifecycle = createRunFindingLifecycle();
  const pageUrls = ['https://monday.com/model-only', 'https://monday.com/unmatched-console'];
  const diagnostics = [
    createDiagnostics([]),
    createCorsDiagnostics(pageUrls[1]!, {
      includeMatchingRequest: false
    })
  ];

  pageUrls.forEach((pageUrl, index) => {
    const page = reconcilePage(lifecycle, {
      pageUrl,
      diagnostics: diagnostics[index]!,
      finding: createTechnicalFinding(['technical-cors-1'])
    });

    assert.equal(
      page.exploratoryQaAnalysis.findings[0]?.technicalIdentity,
      null,
      'An unmatched or model-only CORS claim must not receive structured identity.'
    );

    commitPage(lifecycle, page, pageUrl);
  });

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    2,
    'Ungrounded CORS claims must retain page-scoped fallback identity.'
  );
  assert.equal(
    findings.every(finding => finding.fingerprint.startsWith('unstructured|')),
    true
  );
}

function checkHeterogeneousBundleSplitting(): void {
  const lifecycle = createRunFindingLifecycle();
  const pageUrl = 'https://example.com/crm';
  const diagnostics = createDiagnostics([
    {
      url: 'https://cdn.example.net/runtime.js',
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    },
    {
      url: 'https://cdn.example.net/runtime.js',
      resourceType: 'script',
      failureText: 'net::ERR_BLOCKED_BY_ORB'
    },
    {
      url: 'https://cdn.example.net/runtime.css',
      resourceType: 'stylesheet',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    },
    {
      url: 'https://other.example.net/runtime.js',
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    }
  ]);
  const page = reconcilePage(lifecycle, {
    pageUrl,
    diagnostics,
    finding: createTechnicalFinding([
      'technical-request-1',
      'technical-request-2',
      'technical-request-3',
      'technical-request-4'
    ])
  });

  assert.equal(
    page.exploratoryQaAnalysis.findings.length,
    4,
    'One heterogeneous model bundle must become homogeneous technical observations.'
  );

  commitPage(lifecycle, page, pageUrl);

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    4,
    'Different mechanisms, resource classes, and resources must remain distinct.'
  );
  assert.equal(new Set(findings.map(finding => finding.fingerprint)).size, 4);
  assert.equal(
    findings.every(finding => finding.verification.state === 'inconclusive'),
    true
  );
}

function checkConservativeFallback(): void {
  const lifecycle = createRunFindingLifecycle();

  for (const pageUrl of ['https://example.com/', 'https://example.com/pricing']) {
    const page = reconcilePage(lifecycle, {
      pageUrl,
      diagnostics: createDiagnostics([
        {
          url: 'https://telemetry.example.net/collect',
          resourceType: 'fetch',
          failureText: 'net::ERR_ABORTED',
          disposition: 'needs-review'
        }
      ]),
      finding: createTechnicalFinding(['technical-request-1'])
    });

    commitPage(lifecycle, page, pageUrl);
  }

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    2,
    'Technical observations without validated structured evidence remain page-scoped.'
  );
  assert.equal(
    findings.every(finding => finding.fingerprint.startsWith('unstructured|')),
    true
  );
  assert.equal(
    findings.some(finding => finding.fingerprint.includes('invented')),
    false,
    'Model-supplied technical identity must not receive authority.'
  );
}

function getVisibleTechnicalText(finding: UnifiedFinding): string {
  const rawEvidence = finding.occurrences
    .flatMap(occurrence => occurrence.evidence)
    .flatMap(evidence => {
      const rawValue = evidence.rawSource?.value;

      if (
        typeof rawValue === 'object' &&
        rawValue !== null &&
        'evidence' in rawValue &&
        typeof rawValue.evidence === 'string'
      ) {
        return [rawValue.evidence];
      }

      return [evidence.summary];
    });

  return [finding.title, finding.description, finding.suggestedCheck ?? '', ...rawEvidence].join(
    ' '
  );
}

function getTechnicalEvidenceDetails(finding: UnifiedFinding): {
  references: string[];
  resourceUrls: string[];
} {
  const references: string[] = [];
  const resourceUrls: string[] = [];

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      const rawValue = evidence.rawSource?.value;

      if (typeof rawValue !== 'object' || rawValue === null) {
        continue;
      }

      if (
        'technicalEvidenceReferences' in rawValue &&
        Array.isArray(rawValue.technicalEvidenceReferences)
      ) {
        references.push(
          ...rawValue.technicalEvidenceReferences.filter(
            (reference): reference is string => typeof reference === 'string'
          )
        );
      }

      if (
        'technicalIdentity' in rawValue &&
        typeof rawValue.technicalIdentity === 'object' &&
        rawValue.technicalIdentity !== null &&
        'resourceUrl' in rawValue.technicalIdentity &&
        typeof rawValue.technicalIdentity.resourceUrl === 'string'
      ) {
        resourceUrls.push(rawValue.technicalIdentity.resourceUrl);
      }
    }
  }

  return {
    references,
    resourceUrls
  };
}

function commitTechnicalFixture(
  lifecycle: RunFindingLifecycleState,
  input: {
    pageUrl: string;
    requests: FailedRequestFixture[];
    finding?: ExploratoryQaFinding;
  }
): PreparedRunPageFindings {
  const finding =
    input.finding ??
    createTechnicalFinding(
      input.requests.map((_request, index) => `technical-request-${index + 1}`)
    );
  const page = reconcilePage(lifecycle, {
    pageUrl: input.pageUrl,
    diagnostics: createDiagnostics(input.requests),
    finding
  });

  commitPage(lifecycle, page, input.pageUrl);

  return page;
}

function checkSingleCrossOriginDnsPolicy(): void {
  const lifecycle = createRunFindingLifecycle();

  commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: [
      {
        url: 'https://assets-a.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]
  });

  const findings = getRunFindings(lifecycle);
  const finding = findings[0]!;
  const visibleText = getVisibleTechnicalText(finding);

  assert.equal(findings.length, 1);
  assert.equal(
    finding.severity,
    'low',
    'A single cross-origin DNS failure must be runtime-normalized to low severity.'
  );
  assert.match(visibleText, /observed browser environment/i);
  assert.match(
    visibleText,
    /local DNS policy, filtering, privacy tooling, proxy configuration, or another observer-environment condition/i
  );
  assert.doesNotMatch(
    visibleText,
    /missing functionality|missing dependency|degraded functionality|UI delay|critical dependency|target-site defect/i,
    'Single-failure wording must not claim unsupported target-site impact.'
  );
}

function checkCorrelatedCrossOriginDnsPolicy(): void {
  const lifecycle = createRunFindingLifecycle();
  const urls = [
    'https://assets-a.example.net/app.js',
    'https://assets-b.example.org/runtime.js',
    'https://assets-c.example.edu/vendor.js'
  ];

  commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: urls.map(url => ({
      url,
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    }))
  });

  const findings = getRunFindings(lifecycle);
  const finding = findings[0]!;
  const details = getTechnicalEvidenceDetails(finding);
  const visibleText = getVisibleTechnicalText(finding);

  assert.equal(
    findings.length,
    1,
    'Three distinct cross-origin DNS-failing hostnames must become one visible technical observation.'
  );
  assert.equal(finding.severity, 'low');
  assert.match(finding.title, /correlated cross-origin DNS resolution failures/i);
  assert.match(
    visibleText,
    /Several distinct cross-origin hosts \(3\) failed DNS resolution in the observed browser environment/i
  );
  assert.match(
    visibleText,
    /local DNS policy, filtering, privacy tooling, proxy configuration, or another observer-environment condition/i
  );
  assert.deepEqual(
    new Set(details.references),
    new Set(['technical-request-1', 'technical-request-2', 'technical-request-3']),
    'The correlated observation must preserve every deterministic technical evidence reference.'
  );
  assert.deepEqual(
    new Set(details.resourceUrls),
    new Set(urls),
    'The correlated observation must preserve every exact failed resource URL.'
  );
}

function checkCrossPageDnsCorrelation(): void {
  const lifecycle = createRunFindingLifecycle();
  const firstPage = 'https://target.example/';
  const secondPage = 'https://target.example/pricing';

  commitTechnicalFixture(lifecycle, {
    pageUrl: firstPage,
    requests: [
      {
        url: 'https://assets-a.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      },
      {
        url: 'https://assets-b.example.org/runtime.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]
  });
  commitTechnicalFixture(lifecycle, {
    pageUrl: secondPage,
    requests: [
      {
        url: 'https://assets-a.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      },
      {
        url: 'https://assets-c.example.edu/vendor.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]
  });

  const findings = getRunFindings(lifecycle);
  const finding = findings[0]!;

  assert.equal(
    findings.length,
    1,
    'A qualifying cross-page DNS pattern must remain one visible technical observation.'
  );
  assert.deepEqual(
    new Set(finding.occurrences.map(occurrence => occurrence.pageUrl)),
    new Set([firstPage, secondPage]),
    'Cross-page DNS correlation must preserve every affected page.'
  );
  assert.equal(
    finding.occurrences.length,
    4,
    'Cross-page correlation must preserve recurrence rather than collapsing occurrences.'
  );
}

function checkSameOriginDnsExclusion(): void {
  const lifecycle = createRunFindingLifecycle();
  const pageUrl = 'https://target.example/page';
  const sameOriginUrl = 'https://target.example/same.js';
  const requests: FailedRequestFixture[] = [
    {
      url: sameOriginUrl,
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    },
    ...[
      'https://assets-a.example.net/app.js',
      'https://assets-b.example.org/runtime.js',
      'https://assets-c.example.edu/vendor.js'
    ].map(url => ({
      url,
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    }))
  ];

  commitTechnicalFixture(lifecycle, {
    pageUrl,
    requests
  });

  const findings = getRunFindings(lifecycle);
  const sameOriginFinding = findings.find(finding =>
    getTechnicalEvidenceDetails(finding).resourceUrls.includes(sameOriginUrl)
  );

  assert.equal(
    findings.length,
    2,
    'The correlated cross-origin pattern and same-origin DNS failure must remain separate.'
  );
  assert.ok(
    sameOriginFinding,
    'The genuinely same-origin DNS observation must not be absorbed into the cross-origin pattern.'
  );
  assert.equal(
    sameOriginFinding.severity,
    'medium',
    'Same-origin DNS severity remains outside this policy.'
  );
  assert.match(
    JSON.stringify(sameOriginFinding),
    /"originRelation":"same-origin"/,
    'A request with the same scheme, hostname, and effective port must remain same-origin.'
  );
}

function checkSchemeMismatchIsCrossOrigin(): void {
  const lifecycle = createRunFindingLifecycle();
  const resourceUrl = 'http://target.example:443/cross.js';
  const page = commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: [
      {
        url: resourceUrl,
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]
  });
  const finding = getRunFindings(lifecycle)[0]!;

  assert.equal(
    finding.severity,
    'low',
    'A scheme mismatch must enter the cross-origin DNS policy even when hostname and effective port match.'
  );
  assert.equal(
    page.exploratoryQaAnalysis.findings[0]?.confidence,
    'medium',
    'The scheme-mismatch observation must receive runtime-owned cautious confidence.'
  );
  assert.match(
    JSON.stringify(finding),
    /"originRelation":"cross-origin"/,
    'Browser origin identity must include scheme as well as hostname and effective port.'
  );
}

function checkBelowThresholdDnsPolicy(): void {
  const lifecycle = createRunFindingLifecycle();

  commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: [
      {
        url: 'https://assets-a.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      },
      {
        url: 'https://assets-b.example.org/runtime.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ]
  });

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    2,
    'Two distinct DNS-failing hosts must remain separate observations.'
  );
  assert.equal(
    findings.every(
      finding =>
        finding.severity === 'low' &&
        !/correlated/i.test(finding.title) &&
        /observed browser environment/i.test(getVisibleTechnicalText(finding))
    ),
    true,
    'Each below-threshold observation must retain low severity and observer-environment uncertainty.'
  );
}

function checkOtherFailureMechanismsUnchanged(): void {
  const lifecycle = createRunFindingLifecycle();

  commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: [
      {
        url: 'https://assets-a.example.net/aborted.js',
        resourceType: 'script',
        failureText: 'net::ERR_ABORTED'
      },
      {
        url: 'https://assets-b.example.org/reset.js',
        resourceType: 'script',
        failureText: 'net::ERR_CONNECTION_RESET'
      }
    ]
  });

  const findings = getRunFindings(lifecycle);

  assert.equal(
    findings.length,
    2,
    'Non-DNS failure mechanisms must retain their existing separate identities.'
  );
  assert.equal(
    findings.every(
      finding =>
        finding.severity === 'medium' &&
        finding.title === 'Failed external script resource requests'
    ),
    true,
    'ERR_ABORTED and other non-DNS failures must retain existing model presentation behavior.'
  );
}

function checkModelCannotOverrideDnsPolicy(): void {
  const lifecycle = createRunFindingLifecycle();
  const hostileFinding = createTechnicalFinding(['technical-request-1'], {
    severity: 'medium',
    confidence: 'high',
    title: 'Critical dependency failure',
    evidence: 'A missing dependency causes missing functionality.',
    reasoning: 'The failure causes degraded functionality and UI delay.',
    suggestedCheck: 'Repair the target-site defect.'
  });

  const page = commitTechnicalFixture(lifecycle, {
    pageUrl: 'https://target.example/page',
    requests: [
      {
        url: 'https://assets-a.example.net/app.js',
        resourceType: 'script',
        failureText: 'net::ERR_NAME_NOT_RESOLVED'
      }
    ],
    finding: hostileFinding
  });

  const finding = getRunFindings(lifecycle)[0]!;
  const visibleText = getVisibleTechnicalText(finding);

  assert.equal(
    finding.severity,
    'low',
    'Runtime policy must override incompatible model severity.'
  );
  assert.equal(
    page.exploratoryQaAnalysis.findings[0]?.confidence,
    'medium',
    'Runtime policy must replace inflated model confidence with cautious medium confidence.'
  );
  assert.match(visibleText, /observed browser environment/i);
  assert.doesNotMatch(
    visibleText,
    /missing functionality|missing dependency|degraded functionality|UI delay|critical dependency|target-site defect/i,
    'Runtime policy must remove unsupported model impact claims from visible observation fields.'
  );
}

function main(): void {
  checkSvgConsoleAssociation();
  checkPosterImageAssociation();
  checkConsoleAssociationRejections();
  checkCrossPageReconciliation();
  checkCorsCrossPageReconciliation();
  checkCorsIdentitySeparation();
  checkUnmatchedCorsFallback();
  checkHeterogeneousBundleSplitting();
  checkConservativeFallback();
  checkSingleCrossOriginDnsPolicy();
  checkCorrelatedCrossOriginDnsPolicy();
  checkCrossPageDnsCorrelation();
  checkSameOriginDnsExclusion();
  checkSchemeMismatchIsCrossOrigin();
  checkBelowThresholdDnsPolicy();
  checkOtherFailureMechanismsUnchanged();
  checkModelCannotOverrideDnsPolicy();

  console.log(
    'Structured technical-observation reconciliation checks passed (29 scenarios: 14 existing, 2 positive console associations, 13 rejection/preservation cases).'
  );
}

main();
