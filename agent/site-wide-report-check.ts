import {
  readFile
} from 'node:fs/promises';

import {
  classifyDiagnostics
} from './analysis/classify-diagnostics';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import type {
  PageDiagnostics
} from './browser/collect-page-diagnostics';

import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  createExploratoryFindingFingerprint
} from './investigation/finding-fingerprint';
import {
  reconcileFindingObservations
} from './findings/reconcile-finding-observations';
import {
  attachInvestigationOutcome,
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  registerCompatibilityOccurrence,
  registerUnifiedPageFindings
} from './findings/unified-finding-registry';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';

import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';

import type {
  InspectedPageResult,
  SiteAgentReport
} from './reporting/report-types';

import {
  writeJsonReport
} from './reporting/write-json-report';

import {
  writeMarkdownReport
} from './reporting/write-markdown-report';

function createCountryFinding(
  title: string,
  controlLabel: string | null,
  controlName: string | null,
  category:
    ExploratoryQaFinding['category'] =
      'content'
): ExploratoryQaFinding {
  return {
    category,

    severity:
      'low',

    confidence:
      'high',

    title,

    evidence:
      'The country dropdown contains both "Ecuador" and "Equador".',

    reasoning:
      'Equador appears to be a misspelling of Ecuador.',

    suggestedCheck:
      'Confirm whether both options are selectable.',

    evidenceTarget: {
      kind:
        'select-option',

      controlLabel,

      controlName,

      controlId:
        null,

      optionText:
        'Equador'
    }
  };
}

function createPageResult(
  pageNumber: number,
  slug: string,
  title: string,
  finding:
    ExploratoryQaFinding
): InspectedPageResult {
  const candidate =
    assignPageCandidateReferences([
      finding
    ])[0];

  const pageUrl =
    `https://example.com/${slug}`;

  const diagnostics:
    PageDiagnostics = {
    consoleErrors: [],
    failedRequests: []
  };

  const exploratoryInvestigation =
    null;

  return {
    selection:
      pageNumber === 1
        ? {
            type:
              'start-url',
            url:
              pageUrl
          }
        : {
            type:
              'agent-navigation',
            link: {
              text:
                title,

              url:
                pageUrl
            },

            reason:
              'Synthetic site-wide report check.',

            navigationAudit: {
              traversalDepth:
                1,
              requestedUrl:
                pageUrl,
              policyBand:
                'neutral-unseen-area',
              valueClass:
                'neutral',
              valueReasons:
                [],
              eligibleValueClassCounts: {
                neutral:
                  3,
                'weak-low-value':
                  1,
                'strong-low-value':
                  1
              },
              deferredValueReasonCounts: {
                'content-route-segment':
                  1,
                'administrative-document-segment':
                  1
              },
              predictedAreaKey:
                slug,
              predictedRouteFamilyKey:
                `/${slug}`,
              firstDiscoveredFromUrl:
                'https://example.com/radiology',
              minimumDepthDiscoveredFromUrl:
                'https://example.com/radiology',
              budgetAtDecision: {
                remainingPageSlots:
                  2,
                remainingNavigationDecisionSlots:
                  2,
                remainingPotentialInspections:
                  2
              }
            }
          },

    observation: {
      requestedUrl:
        pageUrl,

      finalUrl:
        pageUrl,

      title,

      httpStatus:
        200,

      headings: [
        title
      ]
    },

    pageNovelty: {
      predictedIdentity: {
        areaKey:
          slug,

        routeFamilyKey:
          `/${slug}`
      },

      observedTemplateKey:
        'observed-v1:synthetic-form'
    },

    diagnostics,

    classifiedDiagnostics:
      classifyDiagnostics(
        diagnostics
      ),

    screenshotPath:
      `agent-results\\site-wide-report-check\\evidence\\page-${String(pageNumber).padStart(2, '0')}.png`,

    findings: [],

    exploratoryQaAnalysis: {
      findings: [
        finding
      ],

      summary:
        'A possible misspelled country option was identified.'
    },

    exploratoryInvestigation,

    exploratoryFindingResults: [
      {
        candidateReference:
          candidate.reference,

        finding:
          candidate.finding,

        outcome:
          evaluateFindingInvestigationOutcome(
            candidate,
            exploratoryInvestigation
          )
      }
    ],

    knownFindingOccurrences: []
  };
}

function countOccurrences(
  text: string,
  value: string
): number {
  return text
    .split(
      value
    )
    .length -
    1;
}

async function main(): Promise<void> {
  const inspectedPages:
    InspectedPageResult[] = [
      createPageResult(
        1,
        'radiology',
        'Radiology',
        createCountryFinding(
          'Misspelled country name in selection list',
          'COUNTRY*',
          'country'
        )
      ),

      createPageResult(
        2,
        'platform',
        'Platform',
        createCountryFinding(
          'Misspelled country name in registration form',
          'Country',
          'country'
        )
      ),

      createPageResult(
        3,
        'solutions',
        'Solutions',
        createCountryFinding(
          'Misspelled country option in form',
          null,
          'country',
          'consistency'
        )
      )
    ];

  const representativeFinding =
    inspectedPages[0]
      .exploratoryQaAnalysis
      .findings[0];

  const fingerprint =
    createExploratoryFindingFingerprint(
      representativeFinding
    );

  inspectedPages[0]
    .exploratoryFindingResults[0]
    .outcome = {
      status:
        'verified',

      summary:
        'The first occurrence verified that Equador can be selected.',

      evidence: [
        'Deterministic selected-state evidence.'
      ]
    };

  for (
    const pageResult of
      inspectedPages.slice(
        1
      )
  ) {
    const emittedFinding =
      pageResult
        .exploratoryQaAnalysis
        .findings[0];

    pageResult.knownFindingOccurrences = [
      {
        knownFindingReference:
          'known-1',

        fingerprint,

        representativeFinding: {
          ...representativeFinding,

          knownFindingReference:
            'known-1'
        },

        pageUrl:
          pageResult
            .observation
            .finalUrl,

        pageTitle:
          pageResult
            .observation
            .title,

        screenshotPath:
          pageResult
            .screenshotPath,

        occurrenceEvidence: [
          emittedFinding.evidence
        ],

        evidenceTarget:
          emittedFinding
            .evidenceTarget,

        matchingBases: [
          'structured-target',
          'finding-fingerprint'
        ],

        modelKnownFindingReference:
          'known-1',

        modelReferenceMatched:
          true,

        redundantInvestigationSkipped:
          true,

        verificationOutcome:
          null
      }
    ];

    pageResult.exploratoryQaAnalysis = {
      ...pageResult
        .exploratoryQaAnalysis,

      findings: []
    };

    pageResult.exploratoryFindingResults =
      [];
  }

  const registry =
    createUnifiedFindingRegistry();

  const firstReconciliation =
    reconcileFindingObservations({
      pageUrl:
        inspectedPages[0]
          .observation
          .finalUrl,
      pageTitle:
        inspectedPages[0]
          .observation
          .title,
      ruleFindings: [],
      modelFindings: [
        representativeFinding
      ]
    });

  registerUnifiedPageFindings(
    registry,
    firstReconciliation
      .findings,
    inspectedPages[0]
      .screenshotPath
  );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint,
      pageUrl:
        inspectedPages[0]
          .observation
          .finalUrl,
      target:
        representativeFinding
          .evidenceTarget,
      finding:
        representativeFinding,
      outcome:
        inspectedPages[0]
          .exploratoryFindingResults[0]
          .outcome,
      candidateReference:
        inspectedPages[0]
          .exploratoryFindingResults[0]
          .candidateReference
    }
  );

  for (
    const pageResult of
      inspectedPages.slice(
        1
      )
  ) {
    const knownOccurrence =
      pageResult
        .knownFindingOccurrences[0];

    registerCompatibilityOccurrence(
      registry,
      {
        fingerprint:
          knownOccurrence
            .fingerprint,
        finding:
          knownOccurrence
            .representativeFinding,
        pageUrl:
          knownOccurrence
            .pageUrl,
        pageTitle:
          knownOccurrence
            .pageTitle,
        target:
          knownOccurrence
            .evidenceTarget,
        evidenceSummaries:
          knownOccurrence
            .occurrenceEvidence,
        screenshotPath:
          knownOccurrence
            .screenshotPath,
        redundantInvestigationSkipped:
          true
      }
    );
  }

  const canonicalFindings =
    getUnifiedFindings(
      registry
    );

  const siteWideExploratoryFindings =
    buildSiteWideExploratoryFindings(
      canonicalFindings,
      inspectedPages.map(
        pageResult =>
          pageResult
            .observation
            .finalUrl
      )
    );

  const report:
    SiteAgentReport = {
    reportSchemaVersion:
      '2',

    runId:
      'site-wide-report-check',

    startedAt:
      '2026-07-22T00:00:00.000Z',

    finishedAt:
      '2026-07-22T00:01:00.000Z',

    site: {
      id:
        'synthetic-site-wide',

      name:
        'Synthetic site-wide finding report',

      startUrl:
        'https://example.com/'
    },

    homepage: {
      requestedUrl:
        'https://example.com/',

      finalUrl:
        'https://example.com/',

      title:
        'Synthetic Homepage',

      httpStatus:
        200
    },

    outcome: {
      type:
        'completed',

      summary:
        'Completed synthetic site-wide finding report check.'
    },

    inspectedPages,

    findings:
      canonicalFindings,

    siteWideExploratoryFindings,

    summary: {
      pagesInspected:
        inspectedPages.length,

      logicalFindingsCount:
        canonicalFindings.length,

      findingOccurrencesCount:
        canonicalFindings[0]
          .occurrences
          .length,

      findingsCount:
        0,

      highestSeverity:
        'none',

      exploratoryQaFindingsCount:
        3,

      siteWideExploratoryFindingsCount:
        siteWideExploratoryFindings
          .length,

      knownFindingOccurrencesCount:
        2,

      knownFindingsSuppliedToAnalysisCount:
        2,

      newCandidateFindingsCount:
        1,

      redundantInvestigationsSkippedCount:
        2,

      highestExploratoryQaSeverity:
        'low',

      actionableDiagnosticsCount:
        0,

      diagnosticsNeedingReviewCount:
        0,

      ignoredDiagnosticNoiseCount:
        0
    }
  };

  const jsonReport =
    await writeJsonReport(
      report
    );

  const markdownReport =
    await writeMarkdownReport(
      report
    );

  const json =
    await readFile(
      jsonReport.filePath,
      'utf8'
    );

  const markdown =
    await readFile(
      markdownReport.filePath,
      'utf8'
    );

  const parsedJsonReport =
    JSON.parse(
      json
    ) as SiteAgentReport;

  if (
    parsedJsonReport
      .inspectedPages[0]
      ?.selection.type !==
      'start-url' ||
    parsedJsonReport
      .inspectedPages[1]
      ?.selection.type !==
      'agent-navigation'
  ) {
    throw new Error(
      'JSON page reporting does not distinguish start-page inspection from agent-selected navigation.'
    );
  }

  const selectedNavigationAudit =
    parsedJsonReport
      .inspectedPages[1]
      ?.selection
      .navigationAudit;

  if (
    selectedNavigationAudit
      ?.valueClass !==
      'neutral' ||
    selectedNavigationAudit
      .policyBand !==
      'neutral-unseen-area' ||
    selectedNavigationAudit
      .eligibleValueClassCounts
      ?.['weak-low-value'] !==
      1 ||
    selectedNavigationAudit
      .deferredValueReasonCounts[
        'administrative-document-segment'
      ] !==
      1
  ) {
    throw new Error(
      'JSON navigation audit does not preserve Stage 6.2 route-value selection metadata.'
    );
  }

  if (
    siteWideExploratoryFindings.length !==
    1
  ) {
    throw new Error(
      `Expected 1 unique site-wide finding, received ${siteWideExploratoryFindings.length}.`
    );
  }

  if (
    siteWideExploratoryFindings[0]
      .occurrenceCount !==
    3
  ) {
    throw new Error(
      'Expected the site-wide finding to contain 3 occurrences.'
    );
  }

  if (
    siteWideExploratoryFindings[0]
      .affectedPageCount !==
    3
  ) {
    throw new Error(
      'Expected the site-wide finding to affect 3 pages.'
    );
  }

  /*
   * This explicitly protects the real-world deduplication
   * case where Gemini describes equivalent findings using
   * different categories.
   */
  if (
    siteWideExploratoryFindings[0]
      .fingerprint !==
    'target|select-option|country|equador'
  ) {
    throw new Error(
      'The site-wide finding does not use the expected category-independent target fingerprint.'
    );
  }

  if (
    !markdown.includes(
      '| Logical findings | 1 |'
    )
  ) {
    throw new Error(
      'Markdown summary does not contain the unique exploratory finding count.'
    );
  }

  if (
    !markdown.includes(
      '| Finding occurrences | 3 |'
    )
  ) {
    throw new Error(
      'Markdown summary does not contain the expected finding occurrence count.'
    );
  }

  if (
    !markdown.includes(
      '**Observed on:** 3 pages (3 occurrences)'
    )
  ) {
    throw new Error(
      'Markdown finding does not contain the expected affected-page summary.'
    );
  }

  if (
    !markdown.includes(
      '### 1. INCONCLUSIVE - Misspelled country name in selection list'
    )
  ) {
    throw new Error(
      'Markdown finding must not treat selectability as proof of the semantic typo assertion.'
    );
  }

  if (
    !markdown.includes(
      '**Occurrence status:** INCONCLUSIVE'
    )
  ) {
    throw new Error(
      'Markdown finding does not contain the conservative occurrence status.'
    );
  }

  if (
    parsedJsonReport
      .findings[0]
      .verification.state !==
      'inconclusive' ||
    parsedJsonReport
      .findings[0]
      .occurrences[0]
      .verification.state !==
      'inconclusive'
  ) {
    throw new Error(
      'Canonical JSON must keep a semantic select-option finding inconclusive when investigation proves only selectability.'
    );
  }

  const preservedInvestigation =
    parsedJsonReport
      .findings[0]
      .occurrences[0]
      .evidence.find(
        evidence =>
          evidence.kind ===
          'investigation-outcome'
      );

  if (
    preservedInvestigation
      ?.verificationCapable !==
      false ||
    (
      preservedInvestigation
        .rawSource
        ?.value as
          {
            status?: string;
          } | undefined
    )
      ?.status !==
      'verified'
  ) {
    throw new Error(
      'Canonical evidence must preserve the raw verified outcome without making it verification-capable.'
    );
  }

  if (
    !markdown.includes(
      '## Pages Inspected'
    )
  ) {
    throw new Error(
      'Markdown report does not contain the pages-inspected summary.'
    );
  }

  if (
    !markdown.includes(
      '| [Radiology](https://example.com/radiology) | Configured start URL |'
    ) ||
    !markdown.includes(
      '| [Platform](https://example.com/platform) | Agent-selected navigation (depth 1, value neutral, neutral-unseen-area) |'
    )
  ) {
    throw new Error(
      'Markdown page reporting does not distinguish the start page or expose selected Stage 6.2 navigation value.'
    );
  }

  if (
    !markdown.includes(
      'observed-v1:synthetic-form'
    )
  ) {
    throw new Error(
      'Markdown page summary does not expose the observed template identity.'
    );
  }

  if (
    !markdown.includes(
      '## Technical Health'
    )
  ) {
    throw new Error(
      'Markdown report does not contain the technical-health summary.'
    );
  }

  /*
   * The human-readable report must not regress into a raw
   * execution transcript.
   *
   * These details still exist in report.json.
   */
  const verboseMarkdownSections = [
    '### Agent Selection',
    '### Page Observation',
    '### Headings',
    '### Browser Diagnostics',
    '### Diagnostic Classification',
    '#### Console Errors',
    '#### Classified Failed Network Requests',
    '#### Raw Failed Network Requests',
    '### Exploratory QA Analysis',
    '### Finding Investigation Outcomes',
    '### Autonomous Investigation',
    '#### Investigation Step',
    'Fingerprint:'
  ];

  verboseMarkdownSections.forEach(
    section => {
      if (
        markdown.includes(
          section
        )
      ) {
        throw new Error(
          `Markdown report still contains verbose execution detail: ${section}`
        );
      }
    }
  );

  /*
   * JSON remains the exhaustive execution record. Only the
   * first occurrence was investigated, but selectability does
   * not prove the semantic typo assertion. Later known occurrences
   * likewise must not be represented as independently verified.
   */
  if (
    parsedJsonReport
      .findings[0]
      ?.occurrences[0]
      ?.verification.state !==
      'inconclusive'
  ) {
    throw new Error(
      'Canonical JSON does not contain the conservative first-occurrence verification state.'
    );
  }

  if (
    countOccurrences(
      markdown,
      'KNOWN, NOT REINVESTIGATED'
    ) <
    2
  ) {
    throw new Error(
      'Markdown report does not distinguish skipped known occurrences from independent verification.'
    );
  }

  if (
    markdown.includes(
      'тАФ'
    )
  ) {
    throw new Error(
      'The Markdown report still contains the corrupted dash encoding.'
    );
  }

  console.log(
    'Human-readable Markdown and exhaustive JSON report check passed.'
  );

  console.log(
    `Unique findings: ${siteWideExploratoryFindings.length}`
  );

  console.log(
    `Original occurrences: ${report.summary.exploratoryQaFindingsCount}`
  );

  console.log(
    'Raw compatibility outcomes: 1 verified interaction, 2 known and not reinvestigated; canonical semantic finding remains inconclusive'
  );

  console.log(
    `JSON report: ${jsonReport.filePath}`
  );

  console.log(
    `Markdown report: ${markdownReport.filePath}`
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Site-wide report check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
