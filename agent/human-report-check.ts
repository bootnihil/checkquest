import assert from 'node:assert/strict';

import {
  calculateFocusedEvidenceClip,
  groupFocusedEvidenceTargets
} from './browser/capture-finding-presentation-evidence';
import type {
  FindingEvidence,
  UnifiedFinding
} from './findings/finding-model';
import {
  buildHumanReportPresentation,
  getHumanFindingStatus,
  humanReportDetailedFindingLimit
} from './reporting/human-report-model';
import {
  buildReconciledRunSummaryProjection
} from './reporting/run-summary-projection';
import type {
  SiteAgentReport
} from './reporting/report-types';
import {
  renderHumanMarkdownReport
} from './reporting/write-markdown-report';

function createFinding(
  index:
    number,
  options: {
    state?:
      UnifiedFinding[
        'verification'
      ][
        'state'
      ];
    severity?:
      UnifiedFinding[
        'severity'
      ];
    category?:
      UnifiedFinding[
        'category'
      ];
    title?:
      string;
  } =
    {}
): UnifiedFinding {
  const state =
    options.state ??
    'inconclusive';
  const candidateReference =
    `candidate-${index}`;
  const evidence:
    FindingEvidence[] =
      [
        {
          evidenceReference:
            `evidence-${index}`,
          source:
            'model',
          kind:
            'model-observation',
          relation:
            'inconclusive',
          verificationCapable:
            false,
          summary:
            `Observed text for finding ${index}.`,
          rawReference: {
            pageNumber:
              1,
            candidateReference
          },
          rawSource: {
            type:
              'exploratory-qa-finding',
            value: {
              evidence:
                `Concrete observation ${index}.`,
              reasoning:
                'An unsupported root cause.'
            }
          }
        }
      ];
  const verificationEvidenceReferences:
    FindingEvidence[
      'evidenceReference'
    ][] =
      [];

  if (
    state ===
    'verified'
  ) {
    const evidenceReference =
      `evidence-${index}-verification` as
        const;

    evidence.push({
      evidenceReference,
      source:
        'deterministic-rule',
      kind:
        'rule-observation',
      relation:
        'supports',
      verificationCapable:
        true,
      summary:
        `Deterministic confirmation for finding ${index}.`
    });
    verificationEvidenceReferences.push(
      evidenceReference
    );
  }

  return {
    findingReference:
      `finding-${index}`,
    fingerprint:
      `fingerprint-${index}`,
    category:
      options.category ??
      'content',
    severity:
      options.severity ??
      'low',
    title:
      options.title ??
      `Finding ${index}`,
    description:
      'The model speculated that a database defect caused this.',
    suggestedCheck:
      'Replace the production database.',
    occurrences:
      [
        {
          occurrenceReference:
            `occurrence-${index}`,
          pageUrl:
            'https://example.com/path',
          pageTitle:
            'Example page',
          target:
            null,
          evidence,
          verification: {
            state,
            reason:
              'Internal verification reason.',
            evidenceReferences:
              verificationEvidenceReferences
          },
          screenshotReferences:
            [
              'C:\\private\\full-page.png'
            ],
          redundantInvestigationSkipped:
            false
        }
      ],
    verification: {
      state,
      reason:
        'Internal aggregate verification reason.',
      evidenceReferences:
        verificationEvidenceReferences
    }
  };
}

function createReport(): SiteAgentReport {
  const findings =
    Array.from(
      {
        length:
          20
      },
      (
        _value,
        index
      ) =>
        createFinding(
          index +
            1,
          {
            severity:
              index ===
                0
                ? 'medium'
                : 'low',
            state:
              index ===
                1
                ? 'verified'
                : 'inconclusive'
          }
        )
    );

  findings.push(
    createFinding(
      21,
      {
        category:
          'technical',
        title:
          'Third-party telemetry request failed'
      }
    ),
    createFinding(
      22,
      {
        state:
          'not-verified',
        title:
          'Disproved candidate'
      }
    )
  );
  findings[1]
    ?.occurrences.push({
      occurrenceReference:
        'occurrence-102',
      pageUrl:
        'https://example.com/other',
      pageTitle:
        'Other example page',
      target:
        null,
      evidence:
        [
          {
            evidenceReference:
              'evidence-2-other',
            source:
              'model',
            kind:
              'model-observation',
            relation:
              'inconclusive',
            verificationCapable:
              false,
            summary:
              'A second occurrence was observed without confirmation evidence.',
            rawReference: {
              pageNumber:
                2,
              candidateReference:
                'candidate-2-other'
            },
            rawSource: {
              type:
                'exploratory-qa-finding',
              value: {
                evidence:
                  'A similar pattern was observed on another page.',
                reasoning:
                  'The second occurrence was not independently confirmed.'
              }
            }
          }
        ],
      verification: {
        state:
          'inconclusive',
        reason:
          'The second occurrence was not confirmed.',
        evidenceReferences:
          []
      },
      screenshotReferences:
        [],
      redundantInvestigationSkipped:
        false
    });

  return {
    reportSchemaVersion:
      '3',
    runId:
      'human-report-check',
    startedAt:
      '2026-07-28T10:00:00.000Z',
    finishedAt:
      '2026-07-28T10:01:05.000Z',
    site: {
      id:
        'runtime',
      name:
        'Runtime exploration: example.com',
      startUrl:
        'https://example.com/'
    },
    outcome: {
      status:
        'completed',
      reason:
        'page-limit-reached',
      summary:
        'Reached the configured page limit of 1.'
    },
    inspectedPages:
      [
        {
          selection: {
            type:
              'start-url',
            url:
              'https://example.com/'
          },
          observation: {
            title:
              'Example page',
            finalUrl:
              'https://example.com/path'
          },
          presentationEvidence:
            [
              {
                candidateReference:
                  'candidate-1',
                pageUrl:
                  'https://example.com/path',
                target: {
                  kind:
                    'visible-text',
                  elementKind:
                    'heading',
                  text:
                    'Example'
                },
                screenshotPaths:
                  [
                    'agent-results/human-report-check/evidence/focused-1.png',
                    'agent-results/human-report-check/evidence/focused-2.png',
                    'agent-results/human-report-check/evidence/focused-3.png'
                  ],
                totalTargetCount:
                  7,
                shownTargetCount:
                  4
              },
              {
                candidateReference:
                  'candidate-2',
                pageUrl:
                  'https://example.com/path',
                target: {
                  kind:
                    'visible-text',
                  elementKind:
                    'heading',
                  text:
                    'Verified example'
                },
                screenshotPaths:
                  [
                    'agent-results/human-report-check/evidence/focused-confirmed.png'
                  ],
                totalTargetCount:
                  1,
                shownTargetCount:
                  1
              }
            ]
        } as unknown as
          SiteAgentReport[
            'inspectedPages'
          ][
            number
          ]
      ],
    findings,
    passiveSecurity: {
      mode:
        'passive-observation-only',
      disclaimer:
        'Passive browsing only; no active security probing was performed.',
      pageSnapshots:
        [],
      observations:
        [
          {
            observationReference:
              'security-observation-1',
            fingerprint:
              'security|header|strict-transport-security',
            code:
              'HSTS_NOT_OBSERVED',
            category:
              'transport',
            posture:
              'defense-in-depth-gap',
            severity:
              'low',
            confidence:
              'high',
            source:
              'deterministic-passive',
            scope: {
              type:
                'origin',
              key:
                'https://example.com'
            },
            subject:
              'strict-transport-security',
            title:
              'HSTS response header was not observed',
            description:
              'The inspected HTTPS response did not include an HSTS header.',
            remediation:
              'Confirm whether HSTS is intended for this origin.',
            occurrences:
              [
                {
                  pageUrl:
                    'https://example.com/path',
                  pageTitle:
                    'Example page',
                  responseUrl:
                    'https://example.com/path',
                  evidence:
                    [
                      {
                        kind:
                          'response-header',
                        subject:
                          'strict-transport-security',
                        summary:
                          'No Strict-Transport-Security response header was observed.',
                        headerName:
                          'strict-transport-security',
                        headerValues:
                          []
                      }
                    ]
                }
              ]
          }
        ],
      summary: {
        observationsCount:
          1,
        bySeverity: {
          medium:
            0,
          low:
            1,
          info:
            0
        },
        byCategory: {
          transport:
            1,
          'response-policy':
            0,
          'frame-protection':
            0,
          'technology-disclosure':
            0,
          cookie:
            0,
          'request-inventory':
            0,
          infrastructure:
            0
        },
        originsObserved:
          0
      }
    }
  } as unknown as
    SiteAgentReport;
}

function countOccurrences(
  value:
    string,
  needle:
    string
): number {
  return value
    .split(
      needle
    )
    .length -
    1;
}

function main(): void {
  assert.equal(
    getHumanFindingStatus(
      'verified'
    ),
    'Confirmed issue'
  );
  assert.equal(
    getHumanFindingStatus(
      'inconclusive'
    ),
    'Needs review'
  );
  assert.equal(
    getHumanFindingStatus(
      'not-verified'
    ),
    null
  );

  const report =
    createReport();
  const canonicalBefore =
    JSON.stringify(
      report
    );
  const markdown =
    renderHumanMarkdownReport(
      report
    );
  const mixedFindingSection =
    markdown.slice(
      markdown.indexOf(
        '### 02 — Finding 2'
      ),
      markdown.indexOf(
        '### 03 — Finding 3'
      )
    );
  const fullyConfirmedReport =
    createReport();
  fullyConfirmedReport.findings[1]!
    .occurrences =
      fullyConfirmedReport
        .findings[1]!
        .occurrences.slice(
          0,
          1
        );
  const fullyConfirmedMarkdown =
    renderHumanMarkdownReport(
      fullyConfirmedReport
    );
  const fullyConfirmedFindingSection =
    fullyConfirmedMarkdown.slice(
      fullyConfirmedMarkdown.indexOf(
        '### 02 — Finding 2'
      ),
      fullyConfirmedMarkdown.indexOf(
        '### 03 — Finding 3'
      )
    );
  const summaryProjection =
    buildReconciledRunSummaryProjection(
      report
    );
  const humanPresentation =
    buildHumanReportPresentation(
      report
    );
  const duplicateTitleReport =
    createReport();
  duplicateTitleReport.findings[0]!.title =
    'Identical title';
  duplicateTitleReport.findings[1]!.title =
    'Identical title';
  const duplicateTitlePresentation =
    buildHumanReportPresentation(
      duplicateTitleReport
    );

  assert.notEqual(
    duplicateTitlePresentation
      .atAGlance[0]
      ?.anchor,
    duplicateTitlePresentation
      .atAGlance[1]
      ?.anchor,
    'Run-scoped display IDs produce unique navigation anchors even for identical titles.'
  );
  assert.notEqual(
    duplicateTitlePresentation
      .atAGlance[0]
      ?.displayId,
    duplicateTitlePresentation
      .atAGlance[1]
      ?.displayId,
    'Display numbering is assigned independently of canonical titles and fingerprints.'
  );

  assert.deepEqual(
    {
      confirmed:
        humanPresentation
          .confirmedIssueCount,
      review:
        humanPresentation
          .needsReviewCount,
      technical:
        humanPresentation
          .technicalObservationCount
    },
    {
      confirmed:
        summaryProjection
          .confirmedFindingCount,
      review:
        summaryProjection
          .reviewFindingCount,
      technical:
        summaryProjection
          .technicalObservationCount
    },
    'GUI-event and human-report accounting must share one reconciled projection.'
  );

  assert.equal(
    JSON.stringify(
      report
    ),
    canonicalBefore,
    'Rendering must not mutate the canonical report.'
  );
  assert.ok(
    markdown.indexOf(
      'Finding 1'
    ) <
      markdown.indexOf(
        'Finding 2'
      ),
    'Severity order should be stable and put medium before low.'
  );
  assert.match(
    markdown,
    /- \*\*19\*\* findings needing review/
  );
  assert.match(
    markdown,
    /- \*\*1\*\* confirmed finding/
  );
  assert.match(
    markdown,
    /- \*\*1\*\* technical observation/
  );
  assert.equal(
    countOccurrences(
      markdown,
      '### How to read this report'
    ),
    1,
    'The compact report vocabulary must render exactly once.'
  );
  assert.match(
    markdown,
    /\*\*Finding:\*\* a potential product issue worth human attention\. Item type is separate from evidence status\./
  );
  assert.match(
    markdown,
    /\*\*Technical observation:\*\* browser, network, or runtime diagnostic context; an item type, not a confidence level or automatic product defect\./
  );
  assert.match(
    markdown,
    /\*\*Security observation:\*\* passive security or configuration information; not automatically a vulnerability\./
  );
  assert.match(
    markdown,
    /\*\*Confirmed issue \/ Verified:\*\* sufficient evidence under CheckQuest’s verification rules\./
  );
  assert.match(
    markdown,
    /\*\*Needs review \/ Inconclusive:\*\* relevant observation, but insufficient evidence to prove the full claim\./
  );
  assert.equal(
    countOccurrences(
      markdown,
      'CheckQuest did not gather enough evidence to confirm this finding.'
    ),
    19,
    'Each unconfirmed finding must communicate that CheckQuest could not confirm the claim.'
  );
  assert.equal(
    countOccurrences(
      markdown,
      'CheckQuest confirmed some occurrences of this finding, but not all.'
    ),
    1,
    'A mixed-evidence finding must communicate partial occurrence confirmation once.'
  );
  assert.equal(
    countOccurrences(
      markdown,
      '**Evidence status**'
    ),
    20,
    'Evidence status must be scoped to unconfirmed or partially confirmed human-facing findings.'
  );
  assert.doesNotMatch(
    markdown,
    /\bno evidence\b/i,
    'The report must not collapse non-verifying observation or context into a claim that no evidence exists.'
  );
  assert.doesNotMatch(
    markdown,
    /verification-capable/i,
    'Human Markdown must not expose internal evidence-model terminology.'
  );
  assert.match(
    markdown,
    /### 01 — Finding 1[\s\S]*\*\*What I saw\*\*[\s\S]*Concrete observation 1\.[\s\S]*\*\*Evidence\*\*[\s\S]*01-FINDING-1-evidence-01\.png[\s\S]*\*\*Evidence status\*\*[\s\S]*CheckQuest did not gather enough evidence to confirm this finding\./
  );
  assert.match(
    mixedFindingSection,
    /\*\*Evidence status\*\*[\s\S]*CheckQuest confirmed some occurrences of this finding, but not all\./
  );
  assert.match(
    markdown,
    /### 02 — Finding 2[\s\S]*\*\*What I saw\*\*[\s\S]*Concrete observation 2\.[\s\S]*\*\*Evidence\*\*[\s\S]*02-FINDING-2-evidence-01\.png/
  );
  assert.match(
    mixedFindingSection,
    /\*\*Pages:\*\* \[\/path\]\(https:\/\/example\.com\/path\), \[\/other\]\(https:\/\/example\.com\/other\)/
  );
  assert.equal(
    humanPresentation
      .detailedFindings
      .find(
        finding =>
          finding.title ===
          'Finding 2'
      )
      ?.confirmationCoverage,
    'partial',
    'The mixed fixture must contain one confirmed and one unconfirmed occurrence.'
  );
  assert.match(
    fullyConfirmedFindingSection,
    /02-FINDING-2-evidence-01\.png/
  );
  assert.doesNotMatch(
    fullyConfirmedFindingSection,
    /\*\*Evidence status\*\*/,
    'A fully confirmed finding must keep its evidence without redundant status boilerplate.'
  );
  assert.match(
    markdown,
    /## Security observations[\s\S]*HSTS response header was not observed/
  );
  assert.doesNotMatch(
    markdown.slice(
      markdown.indexOf(
        '## Technical observations'
      )
    ),
    /\*\*Evidence status\*\*/,
    'Finding-specific evidence status must not be added to technical or security observations.'
  );
  assert.match(
    markdown,
    /## Additional findings/
  );
  assert.equal(
    countOccurrences(
      markdown,
      '**What I saw**'
    ),
    humanReportDetailedFindingLimit
  );

  for (
    let index = 1;
    index <=
      20;
    index +=
      1
  ) {
    assert.match(
      markdown,
      new RegExp(
        `Finding ${index}(?:\\D|$)`
      )
    );
  }

  assert.match(
    markdown,
    /4 of 7 observed instances are shown\./
  );
  assert.match(
    markdown,
    /\]\(evidence\/01-FINDING-1-evidence-01\.png\)/
  );
  assert.match(
    markdown,
    /## Technical observations[\s\S]*Third-party telemetry request failed/
  );
  assert.doesNotMatch(
    markdown,
    /Disproved candidate/
  );
  assert.doesNotMatch(
    markdown,
    /C:\\private/
  );
  assert.doesNotMatch(
    markdown,
    /database defect|Replace the production database|unsupported root cause/i
  );
  assert.doesNotMatch(
    markdown,
    /Unexpected, repeated, or unclear content|Review the observed area and confirm|No focused visual evidence/i
  );
  assert.doesNotMatch(
    markdown,
    /Reached the configured page limit/
  );
  assert.match(
    markdown,
    /\| # \| Finding \/ observation \| Type \| Severity \| Page\(s\) \| Status \|/
  );
  assert.match(
    markdown,
    /\| \[21\]\(#item-21\) \| \[Third-party telemetry request failed\]\(#item-21\) \| Technical/
  );
  assert.match(
    markdown,
    /### 01 — Finding 1/
  );
  assert.match(
    markdown,
    /\| \[\/path\]\(https:\/\/example\.com\/path\) \| Start URL \| \[01\]\(#item-01\)/
  );
  assert.doesNotMatch(
    markdown,
    /findingReference|candidateReference|occurrenceReference|fingerprint/
  );
  assert.doesNotMatch(
    markdown,
    /Verification:|Derivation:|Occurrence:/
  );
  assert.match(
    markdown,
    /Full machine-readable evidence, diagnostics, verification states, and execution details are available in `report\.json`\./
  );

  const groups =
    groupFocusedEvidenceTargets(
      [
        {
          x:
            10,
          y:
            10,
          width:
            100,
          height:
            20
        },
        {
          x:
            10,
          y:
            100,
          width:
            100,
          height:
            20
        },
        {
          x:
            10,
          y:
            900,
          width:
            100,
          height:
            20
        }
      ],
      500
    );

  assert.equal(
    groups.length,
    2
  );
  assert.equal(
    groups[0]
      ?.boxes
      .length,
    2
  );
  assert.deepEqual(
    calculateFocusedEvidenceClip(
      {
        boxes:
          [
            {
              x:
                4,
              y:
                6,
              width:
                20,
              height:
                10
            }
          ]
      },
      {
        width:
          100,
        height:
          100
      },
      10
    ),
    {
      x:
        0,
      y:
        0,
      width:
        34,
      height:
        26
    }
  );

  console.log(
    'Human report semantics check passed.'
  );
}

main();
