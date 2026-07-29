import assert from 'node:assert/strict';

import type {
  ClassifiedDiagnostics
} from './analysis/classify-diagnostics';
import {
  buildExploratoryQaPrompt
} from './analysis/build-exploratory-qa-prompt';
import {
  exploratoryQaAnalysisSchema,
  type ExploratoryQaAnalysis,
  type ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import type {
  ExtractedPageContent
} from './browser/extract-page-content';
import {
  commitRunPageFindings,
  createRunFindingLifecycle,
  getRunFindings,
  prepareKnownFindingAnalysis,
  reconcileRunPageFindings,
  type ReconciledRunPageFindings,
  type RunFindingLifecycleState
} from './findings/run-finding-lifecycle';
import type {
  FindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';

interface FailedRequestFixture {
  url: string;
  resourceType: string;
  failureText: string;
  disposition?:
    'actionable' |
    'needs-review';
}

interface CorsDiagnosticFixture {
  resourceUrl?: string;
  mechanism?: string;
  method?: string;
  resourceType?:
    'fetch' |
    'xhr';
  includeMatchingRequest?:
    boolean;
  reverseDiagnosticOrder?:
    boolean;
}

function createContent(
  title:
    string
): ExtractedPageContent {
  return {
    title,
    headings: [
      title
    ],
    bodyText:
      title,
    links: [],
    buttons: [],
    textFields: [],
    selects: [],
    disclosures: [],
    tabs: []
  };
}

function createDiagnostics(
  requests:
    FailedRequestFixture[]
): ClassifiedDiagnostics {
  return {
    consoleErrors: [],
    failedRequests:
      requests.map(
        request => ({
          request: {
            ...request,
            method:
              'GET'
          },
          disposition:
            request.disposition ??
            'actionable',
          reason:
            'Synthetic deterministic technical observation.'
        })
      )
  };
}

function createCorsDiagnostics(
  pageUrl:
    string,
  fixture:
    CorsDiagnosticFixture =
    {}
): ClassifiedDiagnostics {
  const resourceUrl =
    fixture.resourceUrl ??
    'https://tr.capterra.com/events/';
  const mechanism =
    fixture.mechanism ??
    "Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
  const resourceType =
    fixture.resourceType ??
    'xhr';
  const requestKind =
    resourceType ===
      'xhr'
      ? 'XMLHttpRequest'
      : 'fetch';
  const requestingOrigin =
    new URL(
      pageUrl
    ).origin;
  const corsConsoleError = {
    text:
      `Access to ${requestKind} at '${resourceUrl}' from origin '${requestingOrigin}' has been blocked by CORS policy: ${mechanism}`,
    sourceUrl:
      pageUrl,
    lineNumber:
      0,
    columnNumber:
      0
  };
  const unrelatedConsoleError = {
    text:
      'Synthetic unrelated console error.',
    sourceUrl:
      pageUrl,
    lineNumber:
      1,
    columnNumber:
      1
  };
  const matchingRequest = {
    request: {
      url:
        resourceUrl,
      method:
        fixture.method ??
        'POST',
      resourceType,
      failureText:
        'net::ERR_FAILED'
    },
    disposition:
      'needs-review' as const,
    reason:
      'Synthetic browser failure paired with the CORS console diagnostic.'
  };
  const unrelatedRequest = {
    request: {
      url:
        'https://unrelated.example.net/noise.png',
      method:
        'GET',
      resourceType:
        'image',
      failureText:
        'net::ERR_ABORTED'
    },
    disposition:
      'needs-review' as const,
    reason:
      'Synthetic unrelated browser failure.'
  };
  const consoleErrors =
    fixture.reverseDiagnosticOrder
      ? [
          unrelatedConsoleError,
          corsConsoleError
        ]
      : [
          corsConsoleError,
          unrelatedConsoleError
        ];
  const failedRequests =
    fixture.includeMatchingRequest ===
      false
      ? [
          unrelatedRequest
        ]
      : fixture.reverseDiagnosticOrder
        ? [
            unrelatedRequest,
            matchingRequest
          ]
        : [
            matchingRequest,
            unrelatedRequest
          ];

  return {
    consoleErrors,
    failedRequests
  };
}

function createTechnicalFinding(
  references:
    string[] | null
): ExploratoryQaFinding {
  return {
    knownFindingReference:
      null,
    relatedRuleCode:
      null,
    category:
      'technical',
    severity:
      'medium',
    confidence:
      'high',
    title:
      'Failed external script resource requests',
    evidence:
      'One or more supplied resource requests failed.',
    reasoning:
      'The failed requests may affect dependent functionality.',
    suggestedCheck:
      'Confirm whether the affected resources are required.',
    evidenceTarget:
      null,
    presentationTarget:
      null,
    structuredIdentity:
      null,
    technicalEvidenceReferences:
      references,

    /*
     * This deliberately untrusted value proves runtime normalization does not
     * accept model-supplied identity when no valid evidence reference exists.
     */
    technicalIdentity: {
      kind:
        'failed-request',
      failureText:
        'invented failure',
      method:
        'GET',
      resourceType:
        'script',
      resourceUrl:
        'https://invented.invalid/fake.js',
      originRelation:
        'cross-origin'
    }
  };
}

function createAnalysis(
  finding:
    ExploratoryQaFinding
): ExploratoryQaAnalysis {
  return {
    findings: [
      finding
    ],
    summary:
      'Synthetic technical reconciliation analysis.'
  };
}

function reconcilePage(
  lifecycle:
    RunFindingLifecycleState,
  input: {
    pageUrl: string;
    diagnostics:
      ClassifiedDiagnostics;
    finding:
      ExploratoryQaFinding;
  }
): ReconciledRunPageFindings {
  const pageContent =
    createContent(
      'Technical observations'
    );
  const knownFindingPreparation =
    prepareKnownFindingAnalysis(
      lifecycle,
      pageContent
    );

  return reconcileRunPageFindings(
    lifecycle,
    {
      pageUrl:
        input.pageUrl,
      pageTitle:
        'Technical observations',
      pageContent,
      ruleFindings: [],
      rawExploratoryQaAnalysis:
        createAnalysis(
          input.finding
        ),
      classifiedDiagnostics:
        input.diagnostics,
      knownFindingPreparation
    }
  );
}

function commitPage(
  lifecycle:
    RunFindingLifecycleState,
  page:
    ReconciledRunPageFindings,
  pageUrl:
    string
): void {
  const outcome:
    FindingInvestigationOutcome = {
      status:
        'inconclusive',
      summary:
        'No supported deterministic investigation action is available.',
      evidence: []
    };

  commitRunPageFindings(
    lifecycle,
    {
      page,
      pageUrl,
      pageTitle:
        'Technical observations',
      screenshotPath:
        null,
      exploratoryFindingResults:
        page.pageCandidates.map(
          candidate => ({
            candidateReference:
              candidate.reference,
            finding:
              candidate.finding,
            outcome
          })
        )
    }
  );
}

function checkCrossPageReconciliation(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const request = {
    url:
      'https://cdn.example.net/runtime.js?v=7',
    resourceType:
      'script',
    failureText:
      'net::ERR_NAME_NOT_RESOLVED'
  };

  for (
    const pageUrl of
      [
        'https://example.com/',
        'https://example.com/pricing'
      ]
  ) {
    const page =
      reconcilePage(
        lifecycle,
        {
          pageUrl,
          diagnostics:
            createDiagnostics([
              request
            ]),
          finding:
            createTechnicalFinding([
              'technical-request-1'
            ])
        }
      );

    commitPage(
      lifecycle,
      page,
      pageUrl
    );
  }

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    1,
    'The same structured technical phenomenon must reconcile across pages.'
  );
  assert.match(
    findings[0]
      ?.fingerprint ??
      '',
    /^technical\|failed-request\|/
  );
  assert.deepEqual(
    findings[0]
      ?.occurrences
      .map(
        occurrence =>
          occurrence.pageUrl
      ),
    [
      'https://example.com/',
      'https://example.com/pricing'
    ]
  );
  assert.equal(
    findings[0]
      ?.verification
      .state,
    'inconclusive'
  );
}

function checkCorsCrossPageReconciliation(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const pageUrls = [
    'https://monday.com/operations',
    'https://monday.com/w/nonprofits'
  ];
  const promptDiagnostics =
    createCorsDiagnostics(
      pageUrls[0]!
    );
  const prompt =
    buildExploratoryQaPrompt({
      observation: {
        requestedUrl:
          pageUrls[0]!,
        finalUrl:
          pageUrls[0]!,
        title:
          'Monday operations',
        httpStatus:
          200,
        headings:
          []
      },
      content:
        createContent(
          'Monday operations'
        ),
      classifiedDiagnostics:
        promptDiagnostics,
      ruleBasedFindings:
        []
    });

  assert.match(
    prompt,
    /"technicalObservationReference": "technical-cors-1"/,
    'Eligible deterministic CORS evidence must expose an exact reference to the model.'
  );

  pageUrls.forEach(
    (
      pageUrl,
      index
    ) => {
      const page =
        reconcilePage(
          lifecycle,
          {
            pageUrl,
            diagnostics:
              createCorsDiagnostics(
                pageUrl,
                {
                  reverseDiagnosticOrder:
                    index ===
                    1
                }
              ),
            finding:
              createTechnicalFinding([
                'technical-cors-1'
              ])
          }
        );

      assert.equal(
        page.exploratoryQaAnalysis
          .findings[0]
          ?.technicalIdentity
          ?.kind,
        'cors',
        'A model reference receives CORS identity only from the matched deterministic diagnostic.'
      );
      assert.equal(
        exploratoryQaAnalysisSchema
          .safeParse(
            page.exploratoryQaAnalysis
          )
          .success,
        true,
        'The runtime-derived CORS identity must retain the analysis schema.'
      );

      commitPage(
        lifecycle,
        page,
        pageUrl
      );
    }
  );

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    1,
    'The same trusted CORS phenomenon must reconcile across inspected pages.'
  );
  assert.match(
    findings[0]
      ?.fingerprint ??
      '',
    /^technical\|cors\|/
  );
  assert.deepEqual(
    findings[0]
      ?.occurrences
      .map(
        occurrence =>
          occurrence.pageUrl
      ),
    pageUrls,
    'Page and diagnostic ordering must not alter the logical CORS identity.'
  );
  assert.equal(
    findings[0]
      ?.verification
      .state,
    'inconclusive',
    'Structured CORS identity must not upgrade verification.'
  );
}

function checkCorsIdentitySeparation(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const cases: Array<{
    pageUrl: string;
    fixture:
      CorsDiagnosticFixture;
  }> = [
    {
      pageUrl:
        'https://monday.com/base',
      fixture:
        {}
    },
    {
      pageUrl:
        'https://monday.com/other-endpoint',
      fixture: {
        resourceUrl:
          'https://tr.capterra.com/other-events/'
      }
    },
    {
      pageUrl:
        'https://monday.com/other-mechanism',
      fixture: {
        mechanism:
          "No 'Access-Control-Allow-Origin' header is present on the requested resource."
      }
    },
    {
      pageUrl:
        'https://other.example.com/other-origin',
      fixture:
        {}
    }
  ];

  for (
    const item of
      cases
  ) {
    const page =
      reconcilePage(
        lifecycle,
        {
          pageUrl:
            item.pageUrl,
          diagnostics:
            createCorsDiagnostics(
              item.pageUrl,
              item.fixture
            ),
          finding:
            createTechnicalFinding([
              'technical-cors-1'
            ])
        }
      );

    commitPage(
      lifecycle,
      page,
      item.pageUrl
    );
  }

  const failedRequestPageUrl =
    'https://monday.com/non-cors-failure';
  const failedRequestPage =
    reconcilePage(
      lifecycle,
      {
        pageUrl:
          failedRequestPageUrl,
        diagnostics:
          createDiagnostics([
            {
              url:
                'https://tr.capterra.com/events/',
              resourceType:
                'script',
              failureText:
                'net::ERR_BLOCKED_BY_ORB'
            }
          ]),
        finding:
          createTechnicalFinding([
            'technical-request-1'
          ])
      }
    );

  commitPage(
    lifecycle,
    failedRequestPage,
    failedRequestPageUrl
  );

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    5,
    'Different CORS endpoints, mechanisms, origins, and non-CORS failures must remain distinct.'
  );
  assert.equal(
    new Set(
      findings.map(
        finding =>
          finding.fingerprint
      )
    ).size,
    5
  );
  assert.equal(
    findings.filter(
      finding =>
        finding.fingerprint
          .startsWith(
            'technical|cors|'
          )
    ).length,
    4
  );
  assert.equal(
    findings.filter(
      finding =>
        finding.fingerprint
          .startsWith(
            'technical|failed-request|'
          )
    ).length,
    1,
    'CORS identity must not merge with ORB or other requestfailed mechanisms.'
  );
}

function checkUnmatchedCorsFallback(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const pageUrls = [
    'https://monday.com/model-only',
    'https://monday.com/unmatched-console'
  ];
  const diagnostics = [
    createDiagnostics(
      []
    ),
    createCorsDiagnostics(
      pageUrls[1]!,
      {
        includeMatchingRequest:
          false
      }
    )
  ];

  pageUrls.forEach(
    (
      pageUrl,
      index
    ) => {
      const page =
        reconcilePage(
          lifecycle,
          {
            pageUrl,
            diagnostics:
              diagnostics[index]!,
            finding:
              createTechnicalFinding([
                'technical-cors-1'
              ])
          }
        );

      assert.equal(
        page.exploratoryQaAnalysis
          .findings[0]
          ?.technicalIdentity,
        null,
        'An unmatched or model-only CORS claim must not receive structured identity.'
      );

      commitPage(
        lifecycle,
        page,
        pageUrl
      );
    }
  );

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    2,
    'Ungrounded CORS claims must retain page-scoped fallback identity.'
  );
  assert.equal(
    findings.every(
      finding =>
        finding.fingerprint
          .startsWith(
            'unstructured|'
          )
    ),
    true
  );
}

function checkHeterogeneousBundleSplitting(): void {
  const lifecycle =
    createRunFindingLifecycle();
  const pageUrl =
    'https://example.com/crm';
  const diagnostics =
    createDiagnostics([
      {
        url:
          'https://cdn.example.net/runtime.js',
        resourceType:
          'script',
        failureText:
          'net::ERR_NAME_NOT_RESOLVED'
      },
      {
        url:
          'https://cdn.example.net/runtime.js',
        resourceType:
          'script',
        failureText:
          'net::ERR_BLOCKED_BY_ORB'
      },
      {
        url:
          'https://cdn.example.net/runtime.css',
        resourceType:
          'stylesheet',
        failureText:
          'net::ERR_NAME_NOT_RESOLVED'
      },
      {
        url:
          'https://other.example.net/runtime.js',
        resourceType:
          'script',
        failureText:
          'net::ERR_NAME_NOT_RESOLVED'
      }
    ]);
  const page =
    reconcilePage(
      lifecycle,
      {
        pageUrl,
        diagnostics,
        finding:
          createTechnicalFinding([
            'technical-request-1',
            'technical-request-2',
            'technical-request-3',
            'technical-request-4'
          ])
      }
    );

  assert.equal(
    page.exploratoryQaAnalysis
      .findings.length,
    4,
    'One heterogeneous model bundle must become homogeneous technical observations.'
  );

  commitPage(
    lifecycle,
    page,
    pageUrl
  );

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    4,
    'Different mechanisms, resource classes, and resources must remain distinct.'
  );
  assert.equal(
    new Set(
      findings.map(
        finding =>
          finding.fingerprint
      )
    ).size,
    4
  );
  assert.equal(
    findings.every(
      finding =>
        finding.verification
          .state ===
        'inconclusive'
    ),
    true
  );
}

function checkConservativeFallback(): void {
  const lifecycle =
    createRunFindingLifecycle();

  for (
    const pageUrl of
      [
        'https://example.com/',
        'https://example.com/pricing'
      ]
  ) {
    const page =
      reconcilePage(
        lifecycle,
        {
          pageUrl,
          diagnostics:
            createDiagnostics([
              {
                url:
                  'https://telemetry.example.net/collect',
                resourceType:
                  'fetch',
                failureText:
                  'net::ERR_ABORTED',
                disposition:
                  'needs-review'
              }
            ]),
          finding:
            createTechnicalFinding([
              'technical-request-1'
            ])
        }
      );

    commitPage(
      lifecycle,
      page,
      pageUrl
    );
  }

  const findings =
    getRunFindings(
      lifecycle
    );

  assert.equal(
    findings.length,
    2,
    'Technical observations without validated structured evidence remain page-scoped.'
  );
  assert.equal(
    findings.every(
      finding =>
        finding.fingerprint
          .startsWith(
            'unstructured|'
          )
    ),
    true
  );
  assert.equal(
    findings.some(
      finding =>
        finding.fingerprint
          .includes(
            'invented'
          )
    ),
    false,
    'Model-supplied technical identity must not receive authority.'
  );
}

function main(): void {
  checkCrossPageReconciliation();
  checkCorsCrossPageReconciliation();
  checkCorsIdentitySeparation();
  checkUnmatchedCorsFallback();
  checkHeterogeneousBundleSplitting();
  checkConservativeFallback();

  console.log(
    'Structured technical-observation reconciliation checks passed.'
  );
}

main();
