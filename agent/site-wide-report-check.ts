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
    selection: {
      link: {
        text:
          title,

        url:
          pageUrl
      },

      reason:
        'Synthetic site-wide report check.'
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
    ]
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

  const siteWideExploratoryFindings =
    buildSiteWideExploratoryFindings(
      inspectedPages.map(
        pageResult => ({
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

          findings:
            pageResult
              .exploratoryQaAnalysis
              .findings
        })
      )
    );

  const report:
    SiteAgentReport = {
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

    siteWideExploratoryFindings,

    summary: {
      pagesInspected:
        inspectedPages.length,

      findingsCount:
        0,

      highestSeverity:
        'none',

      exploratoryQaFindingsCount:
        3,

      siteWideExploratoryFindingsCount:
        siteWideExploratoryFindings
          .length,

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
      '| Unique exploratory findings | 1 |'
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
      '**Status:** INCONCLUSIVE'
    )
  ) {
    throw new Error(
      'Markdown finding does not contain the expected aggregated investigation status.'
    );
  }

  if (
    !markdown.includes(
      '| [Radiology](https://example.com/radiology) | INCONCLUSIVE | [page-01.png](evidence/page-01.png) |'
    )
  ) {
    throw new Error(
      'Markdown finding does not contain the expected concise occurrence row.'
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
   * Each synthetic candidate had no autonomous
   * investigation.
   *
   * JSON remains the exhaustive execution record, so all
   * three deterministic inconclusive outcomes must still be
   * preserved there even though the Markdown report presents
   * them once at site level.
   */
  if (
    countOccurrences(
      json,
      '"status": "inconclusive"'
    ) !==
    3
  ) {
    throw new Error(
      'JSON report does not contain the expected 3 inconclusive finding outcomes.'
    );
  }

  if (
    countOccurrences(
      markdown,
      'INCONCLUSIVE'
    ) <
    4
  ) {
    throw new Error(
      'Markdown report does not present the site-wide and occurrence-level investigation statuses.'
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
    'Synthetic finding outcomes: 3 inconclusive'
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
