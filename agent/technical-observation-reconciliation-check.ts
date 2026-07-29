import assert from 'node:assert/strict';

import type {
  ClassifiedDiagnostics
} from './analysis/classify-diagnostics';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
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
  checkHeterogeneousBundleSplitting();
  checkConservativeFallback();

  console.log(
    'Structured technical-observation reconciliation checks passed.'
  );
}

main();
