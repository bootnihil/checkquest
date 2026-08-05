import assert from 'node:assert/strict';

import type { ClassifiedDiagnostics } from '../../agent/analysis/classify-diagnostics';
import { buildExploratoryQaPrompt } from '../../agent/analysis/build-exploratory-qa-prompt';
import {
  exploratoryQaAnalysisSchema,
  type ExploratoryQaAnalysis,
  type ExploratoryQaFinding
} from '../../agent/analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../../agent/browser/extract-page-content';
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

  console.log('Structured technical-observation reconciliation checks passed.');
}

main();
