import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import type {
  PageFinding
} from './analysis/evaluate-page';
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
  createExploratoryFindingFingerprint
} from './investigation/finding-fingerprint';
import type {
  FindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  buildKnownFindingPromptContext,
  createKnownFindingState,
  reconcilePageFindings,
  registerNewFinding
} from './investigation/known-findings';
import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';
import type {
  SiteAgentReport
} from './reporting/report-types';
import {
  writeJsonReport
} from './reporting/write-json-report';
import {
  writeMarkdownReport
} from './reporting/write-markdown-report';

function createRule(
  code: string,
  pageUrl: string,
  overrides:
    Partial<PageFinding> = {}
): PageFinding {
  return {
    code,
    severity:
      'medium',
    title:
      `Rule ${code}`,
    evidence:
      `Deterministic evidence for ${code}.`,
    url:
      pageUrl,
    ...overrides
  };
}

function createTarget(
  optionText:
    string
): ExploratoryQaFinding[
  'evidenceTarget'
] {
  return {
    kind:
      'select-option',
    controlLabel:
      'Country',
    controlName:
      'country',
    controlId:
      'country',
    optionText
  };
}

function createModel(
  title: string,
  evidence: string,
  optionText:
    string | null = null
): ExploratoryQaFinding {
  return {
    category:
      'content',
    severity:
      'low',
    confidence:
      'medium',
    title,
    evidence,
    reasoning:
      `Reasoning for ${title}.`,
    suggestedCheck:
      `Check ${title}.`,
    evidenceTarget:
      optionText ===
        null
        ? null
        : createTarget(
            optionText
          )
  };
}

function createDisclosureModel(
  title: string,
  evidence: string,
  controlId: string
): ExploratoryQaFinding {
  return {
    ...createModel(
      title,
      evidence
    ),
    evidenceTarget: {
      kind:
        'disclosure-state',
      controlId,
      accessibleName:
        title,
      controlledRegionId:
        `${controlId}-region`,
      desiredState:
        'expanded'
    }
  };
}

function createOutcome(
  status:
    FindingInvestigationOutcome[
      'status'
    ],
  summary:
    string
): FindingInvestigationOutcome {
  return {
    status,
    summary,
    evidence: [
      `${summary} evidence`
    ]
  };
}

function registerPage(
  registry:
    ReturnType<
      typeof createUnifiedFindingRegistry
    >,
  input: {
    pageUrl: string;
    pageTitle: string;
    rules?: PageFinding[];
    models?: ExploratoryQaFinding[];
    screenshotPath?: string;
  }
) {
  const reconciled =
    reconcileFindingObservations({
      pageUrl:
        input.pageUrl,
      pageTitle:
        input.pageTitle,
      ruleFindings:
        input.rules ?? [],
      modelFindings:
        input.models ?? []
    });

  registerUnifiedPageFindings(
    registry,
    reconciled.findings,
    input.screenshotPath ??
      null
  );

  return reconciled;
}

async function main():
  Promise<void> {
  const registry =
    createUnifiedFindingRegistry();

  const httpUrl =
    'https://example.com/http-error';

  const httpRule =
    createRule(
      'HTTP_CLIENT_ERROR',
      httpUrl,
      {
        severity:
          'high',
        title:
          'Page returned HTTP 404'
      }
    );

  registerPage(
    registry,
    {
      pageUrl:
        httpUrl,
      pageTitle:
        'Missing page',
      rules: [
        httpRule
      ]
    }
  );

  const unknownUrl =
    'https://example.com/status-unknown';

  registerPage(
    registry,
    {
      pageUrl:
        unknownUrl,
      pageTitle:
        'Unknown status',
      rules: [
        createRule(
          'HTTP_STATUS_UNKNOWN',
          unknownUrl
        )
      ]
    }
  );

  const modelOnly =
    createModel(
      'Possible wording issue',
      'The wording may be incomplete.'
    );

  registerPage(
    registry,
    {
      pageUrl:
        'https://example.com/model-only',
      pageTitle:
        'Model only',
      models: [
        modelOnly
      ]
    }
  );

  const emptyTitleUrl =
    'https://example.com/no-title';

  const emptyTitleRule =
    createRule(
      'EMPTY_PAGE_TITLE',
      emptyTitleUrl,
      {
        title:
          'Page has no browser title',
        evidence:
          'The document title was empty after navigation completed.'
      }
    );

  const linkedModel =
    {
      ...createModel(
        emptyTitleRule.title,
        emptyTitleRule.evidence
      ),
      relatedRuleCode:
        emptyTitleRule.code
    };

  registerPage(
    registry,
    {
      pageUrl:
        emptyTitleUrl,
      pageTitle:
        '',
      rules: [
        emptyTitleRule
      ],
      models: [
        linkedModel
      ]
    }
  );

  const contradictionModel =
    createModel(
      'The Blocked option cannot be selected',
      'The exact selected state can be checked deterministically.',
      'Blocked'
    );

  const contradictionUrl =
    'https://example.com/contradiction';

  registerPage(
    registry,
    {
      pageUrl:
        contradictionUrl,
      pageTitle:
        'Contradiction',
      models: [
        contradictionModel
      ]
    }
  );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        createExploratoryFindingFingerprint(
          contradictionModel
        ),
      pageUrl:
        contradictionUrl,
      target:
        contradictionModel
          .evidenceTarget,
      finding:
        contradictionModel,
      outcome:
        createOutcome(
          'not-verified',
          'The exact target state was not observed.'
        ),
      assessment: {
        relation:
          'contradicts',
        verificationCapable:
          true,
        summary:
          'Trusted test assessment: the exact deterministic state result contradicts this specific finding assertion.'
      }
    }
  );

  const semanticSelectModel =
    createModel(
      'Typographical error in country selection dropdown',
      'The dropdown contains both Ecuador and Equador.',
      'Equador'
    );

  const semanticSelectUrl =
    'https://example.com/semantic-select';

  registerPage(
    registry,
    {
      pageUrl:
        semanticSelectUrl,
      pageTitle:
        'Semantic select finding',
      models: [
        semanticSelectModel
      ]
    }
  );

  const semanticSelectOutcome =
    createOutcome(
      'verified',
      'The option Equador could be selected.'
    );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        createExploratoryFindingFingerprint(
          semanticSelectModel
        ),
      pageUrl:
        semanticSelectUrl,
      target:
        semanticSelectModel
          .evidenceTarget,
      finding:
        semanticSelectModel,
      outcome:
        semanticSelectOutcome
    }
  );

  const conflictModel =
    createDisclosureModel(
      'Conflicting disclosure state result',
      'The disclosure state produced conflicting deterministic evidence.',
      'conflict-disclosure'
    );

  const conflictUrl =
    'https://example.com/conflict';

  registerPage(
    registry,
    {
      pageUrl:
        conflictUrl,
      pageTitle:
        'Conflict',
      models: [
        conflictModel
      ],
      screenshotPath:
        'evidence/conflict.png'
    }
  );

  const conflictFingerprint =
    createExploratoryFindingFingerprint(
      conflictModel
    );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        conflictFingerprint,
      pageUrl:
        conflictUrl,
      target:
        conflictModel
          .evidenceTarget,
      finding:
        conflictModel,
      outcome:
        createOutcome(
          'verified',
          'One deterministic observation supported the assertion.'
        ),
      assessment: {
        relation:
          'supports',
        verificationCapable:
          true,
        summary:
          'Trusted test assessment: the exact deterministic state result supports this specific finding assertion.'
      }
    }
  );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        conflictFingerprint,
      pageUrl:
        conflictUrl,
      target:
        conflictModel
          .evidenceTarget,
      finding:
        conflictModel,
      outcome:
        createOutcome(
          'not-verified',
          'A second deterministic observation contradicted the assertion.'
        ),
      assessment: {
        relation:
          'contradicts',
        verificationCapable:
          true,
        summary:
          'Trusted test assessment: the exact deterministic state result contradicts this specific finding assertion.'
      }
    }
  );

  const multiModel =
    createModel(
      'The Narnia option is selectable',
      'The exact selected state recurs on multiple pages.',
      'Narnia'
    );

  const multiFingerprint =
    createExploratoryFindingFingerprint(
      multiModel
    );

  registerPage(
    registry,
    {
      pageUrl:
        'https://example.com/multi-one',
      pageTitle:
        'Multi one',
      models: [
        multiModel
      ]
    }
  );

  registerPage(
    registry,
    {
      pageUrl:
        'https://example.com/multi-two',
      pageTitle:
        'Multi two',
      models: [
        {
          ...multiModel,
          title:
            'Same target, later page'
        }
      ]
    }
  );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        multiFingerprint,
      pageUrl:
        'https://example.com/multi-two',
      target:
        multiModel
          .evidenceTarget,
      finding:
        multiModel,
      outcome:
        createOutcome(
          'verified',
          'The later occurrence was deterministically demonstrated.'
        ),
      assessment: {
        relation:
          'supports',
        verificationCapable:
          true,
        summary:
          'Trusted test assessment: the exact deterministic state result supports this specific finding assertion.'
      }
    }
  );

  const suppressedModel =
    createDisclosureModel(
      'Known exact disclosure target',
      'The disclosure state was observed.',
      'known-disclosure'
    );

  const suppressedFingerprint =
    createExploratoryFindingFingerprint(
      suppressedModel
    );

  registerPage(
    registry,
    {
      pageUrl:
        'https://example.com/known-one',
      pageTitle:
        'Known one',
      models: [
        suppressedModel
      ]
    }
  );

  attachInvestigationOutcome(
    registry,
    {
      fingerprint:
        suppressedFingerprint,
      pageUrl:
        'https://example.com/known-one',
      target:
        suppressedModel
          .evidenceTarget,
      finding:
        suppressedModel,
      outcome:
        createOutcome(
          'verified',
          'The first exact occurrence was demonstrated.'
        ),
      assessment: {
        relation:
          'supports',
        verificationCapable:
          true,
        summary:
          'Trusted test assessment: the exact deterministic state result supports this specific finding assertion.'
      }
    }
  );

  registerCompatibilityOccurrence(
    registry,
    {
      fingerprint:
        suppressedFingerprint,
      finding:
        suppressedModel,
      pageUrl:
        'https://example.com/known-two',
      pageTitle:
        'Known two',
      target:
        suppressedModel
          .evidenceTarget,
      evidenceSummaries: [
        'The exact structured target was observed again.'
      ],
      screenshotPath:
        null,
      redundantInvestigationSkipped:
        true
    }
  );

  const visibleErrorUrl =
    'https://example.com/error-wording';

  registerPage(
    registry,
    {
      pageUrl:
        visibleErrorUrl,
      pageTitle:
        'Error wording',
      rules: [
        createRule(
          'VISIBLE_ERROR_PAGE',
          visibleErrorUrl
        )
      ]
    }
  );

  const duplicate =
    createModel(
      'Exact duplicate',
      'The same evidence.'
    );

  const duplicateReconciliation =
    reconcileFindingObservations({
      pageUrl:
        'https://example.com/duplicates',
      pageTitle:
        'Duplicates',
      ruleFindings: [],
      modelFindings: [
        duplicate,
        {
          ...duplicate,
          reasoning:
            'A second source observation.'
        }
      ]
    });

  assert.equal(
    duplicateReconciliation
      .findings.length,
    1
  );

  assert.equal(
    duplicateReconciliation
      .candidateFindings.length,
    1
  );

  const distinctReconciliation =
    reconcileFindingObservations({
      pageUrl:
        'https://example.com/distinct',
      pageTitle:
        'Distinct',
      ruleFindings: [],
      modelFindings: [
        createModel(
          'First assertion',
          'First exact evidence.'
        ),
        createModel(
          'Second assertion',
          'Second exact evidence.'
        )
      ]
    });

  assert.equal(
    distinctReconciliation
      .findings.length,
    2
  );

  const findings =
    getUnifiedFindings(
      registry
    );

  const byFingerprint =
    new Map(
      findings.map(
        finding => [
          finding.fingerprint,
          finding
        ]
      )
    );

  assert.equal(
    byFingerprint
      .get(
        'rule|HTTP_CLIENT_ERROR'
      )
      ?.verification.state,
    'verified'
  );

  assert.equal(
    byFingerprint
      .get(
        'rule|HTTP_STATUS_UNKNOWN'
      )
      ?.verification.state,
    'inconclusive'
  );

  assert.equal(
    byFingerprint
      .get(
        createExploratoryFindingFingerprint(
          modelOnly
        )
      )
      ?.verification.state,
    'inconclusive'
  );

  const linkedFinding =
    byFingerprint.get(
      'rule|EMPTY_PAGE_TITLE'
    );

  assert.equal(
    linkedFinding
      ?.occurrences[0]
      .evidence
      .some(
        evidence =>
          evidence.source ===
          'deterministic-rule'
      ),
    true
  );

  assert.equal(
    linkedFinding
      ?.occurrences[0]
      .evidence
      .some(
        evidence =>
          evidence.source ===
          'model'
      ),
    true
  );

  assert.equal(
    linkedFinding
      ?.verification.state,
    'verified'
  );

  assert.equal(
    byFingerprint
      .get(
        createExploratoryFindingFingerprint(
          semanticSelectModel
        )
      )
      ?.verification.state,
    'inconclusive'
  );

  const semanticSelectEvidence =
    byFingerprint
      .get(
        createExploratoryFindingFingerprint(
          semanticSelectModel
        )
      )
      ?.occurrences[0]
      .evidence.find(
        evidence =>
          evidence.kind ===
          'investigation-outcome'
      );

  assert.equal(
    semanticSelectEvidence
      ?.verificationCapable,
    false
  );

  assert.equal(
    semanticSelectEvidence
      ?.rawSource
      ?.value,
    semanticSelectOutcome
  );

  assert.equal(
    byFingerprint
      .get(
        createExploratoryFindingFingerprint(
          contradictionModel
        )
      )
      ?.verification.state,
    'not-verified'
  );

  const conflictFinding =
    byFingerprint.get(
      conflictFingerprint
    );

  assert.equal(
    conflictFinding
      ?.verification.state,
    'inconclusive'
  );

  assert.match(
    conflictFinding
      ?.occurrences[0]
      .verification.reason ??
      '',
    /Conflicting deterministic evidence/
  );

  const multiFinding =
    byFingerprint.get(
      multiFingerprint
    );

  assert.deepEqual(
    multiFinding
      ?.occurrences
      .map(
        occurrence =>
          occurrence
            .verification.state
      ),
    [
      'inconclusive',
      'verified'
    ]
  );

  assert.equal(
    multiFinding
      ?.verification.state,
    'verified'
  );

  const suppressedFinding =
    byFingerprint.get(
      suppressedFingerprint
    );

  assert.equal(
    suppressedFinding
      ?.occurrences.length,
    2
  );

  assert.equal(
    suppressedFinding
      ?.occurrences[1]
      .redundantInvestigationSkipped,
    true
  );

  assert.equal(
    suppressedFinding
      ?.occurrences[1]
      .verification.state,
    'inconclusive'
  );

  assert.equal(
    suppressedFinding
      ?.verification.state,
    'verified'
  );

  const compatibilityState =
    createKnownFindingState(
      fingerprint =>
        registry
          .findingsByFingerprint
          .get(
            fingerprint
          )
          ?.verification.state ??
        null
    );

  registerNewFinding(
    compatibilityState,
    {
      finding:
        suppressedModel,
      pageUrl:
        'https://example.com/known-one',
      pageTitle:
        'Known one',
      screenshotPath:
        null,
      verificationOutcome:
        createOutcome(
          'inconclusive',
          'Legacy compatibility status must not override canonical verification.'
        )
    }
  );

  assert.equal(
    buildKnownFindingPromptContext(
      compatibilityState
    )[0]
      .verificationStatus,
    'verified'
  );

  assert.equal(
    reconcilePageFindings(
      compatibilityState,
      [
        suppressedModel
      ],
      []
    )
      .knownOccurrenceDrafts[0]
      .redundantInvestigationSkipped,
    true
  );

  assert.equal(
    byFingerprint
      .get(
        'rule|VISIBLE_ERROR_PAGE'
      )
      ?.verification.state,
    'inconclusive'
  );

  assert.equal(
    createExploratoryFindingFingerprint(
      semanticSelectModel
    ),
    'target|select-option|country|equador'
  );

  const modelOnlyFinding =
    byFingerprint.get(
      createExploratoryFindingFingerprint(
        modelOnly
      )
    );

  assert.equal(
    modelOnlyFinding
      ?.verification.state,
    'inconclusive'
  );

  const siteWideProjection =
    buildSiteWideExploratoryFindings(
      findings,
      Array.from(
        new Set(
          findings.flatMap(
            finding =>
              finding
                .occurrences
                .map(
                  occurrence =>
                    occurrence.pageUrl
                )
          )
        )
      )
    );

  const report:
    SiteAgentReport = {
    reportSchemaVersion:
      '2',
    runId:
      'unified-finding-lifecycle-check',
    startedAt:
      '2026-07-23T00:00:00.000Z',
    finishedAt:
      '2026-07-23T00:01:00.000Z',
    site: {
      id:
        'synthetic-unified',
      name:
        'Synthetic unified lifecycle',
      startUrl:
        'https://example.com/'
    },
    homepage: {
      requestedUrl:
        'https://example.com/',
      finalUrl:
        'https://example.com/',
      title:
        'Synthetic',
      httpStatus:
        200
    },
    outcome: {
      type:
        'completed',
      summary:
        'Synthetic lifecycle completed.'
    },
    inspectedPages: [],
    findings,
    siteWideExploratoryFindings:
      siteWideProjection,
    summary: {
      pagesInspected:
        0,
      logicalFindingsCount:
        findings.length,
      findingOccurrencesCount:
        findings.reduce(
          (
            total,
            finding
          ) =>
            total +
            finding
              .occurrences
              .length,
          0
        ),
      findingsCount:
        findings.filter(
          finding =>
            finding.occurrences
              .some(
                occurrence =>
                  occurrence.evidence
                    .some(
                      evidence =>
                        evidence.source ===
                        'deterministic-rule'
                    )
              )
        ).length,
      highestSeverity:
        'high',
      exploratoryQaFindingsCount:
        findings.filter(
          finding =>
            finding.occurrences
              .some(
                occurrence =>
                  occurrence.evidence
                    .some(
                      evidence =>
                        evidence.source ===
                        'model'
                    )
              )
        ).length,
      siteWideExploratoryFindingsCount:
        siteWideProjection.length,
      knownFindingOccurrencesCount:
        1,
      knownFindingsSuppliedToAnalysisCount:
        1,
      newCandidateFindingsCount:
        0,
      redundantInvestigationsSkippedCount:
        1,
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

  const parsed =
    JSON.parse(
      json
    ) as
      SiteAgentReport;

  assert.equal(
    parsed.findings[0]
      .occurrences[0]
      .verification.state,
    findings[0]
      .occurrences[0]
      .verification.state
  );

  assert.match(
    markdown,
    /verification-capable:\*\* .*contradict/i
  );

  assert.equal(
    markdown.includes(
      '## Rule-Based Findings'
    ),
    false
  );

  assert.match(
    markdown,
    /KNOWN, NOT REINVESTIGATED/
  );

  assert.match(
    markdown,
    /The issue was deterministically demonstrated/
  );

  assert.match(
    markdown,
    /Deterministic evidence contradicted the asserted issue/
  );

  assert.match(
    markdown,
    /does not have sufficient deterministic evidence/
  );

  const linkedHeading =
    'VERIFIED - Page has no browser title';

  assert.equal(
    markdown
      .split(
        linkedHeading
      )
      .length -
      1,
    1
  );

  console.log(
    'Canonical unified finding lifecycle and reporting checks passed.'
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Unified finding lifecycle check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
