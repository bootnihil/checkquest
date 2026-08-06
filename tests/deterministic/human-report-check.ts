import assert from 'node:assert/strict';

import {
  calculateFocusedEvidenceClip,
  groupFocusedEvidenceTargets
} from '../../agent/browser/capture-finding-presentation-evidence';
import {
  exploratoryQaFindingSchema,
  type ExploratoryQaFinding,
  type TechnicalObservationIdentity
} from '../../agent/analysis/exploratory-qa-schema';
import type { FindingEvidence, UnifiedFinding } from '../../agent/findings/finding-model';
import {
  buildHumanReportPresentation,
  getHumanFindingStatus,
  humanReportDetailedFindingLimit,
  rankHumanReportNotableItems
} from '../../agent/reporting/human-report-model';
import {
  buildReconciledRunSummaryProjection,
  classifyHumanReportItem
} from '../../agent/reporting/run-summary-projection';
import { createTechnicalObservationFingerprint } from '../../agent/analysis/technical-observation-reconciliation';
import { commitRunPageFindings } from '../../agent/findings/commit-run-page-findings';
import { prepareRunPageFindings } from '../../agent/findings/prepare-run-page-findings';
import {
  createRunFindingLifecycle,
  getRunFindings
} from '../../agent/findings/run-finding-lifecycle';
import type { SiteAgentReport } from '../../agent/reporting/report-types';
import { renderHumanMarkdownReport } from '../../agent/reporting/write-markdown-report';

function createFinding(
  index: number,
  options: {
    state?: UnifiedFinding['verification']['state'];
    severity?: UnifiedFinding['severity'];
    category?: UnifiedFinding['category'];
    title?: string;
    runtimeGroundedTechnical?: boolean;
    modelSuppliedTechnicalIdentity?: boolean;
    technicalIdentity?: TechnicalObservationIdentity;
    browserObservationSummary?: string;
  } = {}
): UnifiedFinding {
  const state = options.state ?? 'inconclusive';
  const candidateReference = `candidate-${index}`;
  const defaultTechnicalIdentity: TechnicalObservationIdentity = {
    kind: 'failed-request' as const,
    failureText: 'net::ERR_FAILED',
    method: 'GET',
    resourceType: 'script',
    resourceUrl: `https://telemetry.example.net/request-${index}.js`,
    originRelation: 'cross-origin' as const
  };
  const technicalIdentity = options.technicalIdentity ?? defaultTechnicalIdentity;
  const hasTechnicalIdentity =
    options.runtimeGroundedTechnical === true || options.modelSuppliedTechnicalIdentity === true;
  const isTechnicalCandidate = options.category === 'technical';
  const evidence: FindingEvidence[] = [
    {
      evidenceReference: `evidence-${index}`,
      source: 'model',
      kind: 'model-observation',
      relation: 'inconclusive',
      verificationCapable: false,
      summary: `Observed text for finding ${index}.`,
      rawReference: {
        pageNumber: 1,
        candidateReference
      },
      rawSource: {
        type: 'exploratory-qa-finding',
        value: isTechnicalCandidate
          ? {
              category: 'technical',
              severity: options.severity ?? 'low',
              confidence: 'medium',
              title: options.title ?? `Finding ${index}`,
              evidence: `Concrete observation ${index}.`,
              reasoning: 'Runtime-grounded technical context.',
              suggestedCheck: 'Review the exact runtime diagnostic.',
              evidenceTarget: null,
              presentationTarget: null,
              structuredIdentity: null,
              technicalEvidenceReferences:
                technicalIdentity.kind === 'console-error'
                  ? null
                  : [
                      options.runtimeGroundedTechnical === true
                        ? technicalIdentity.kind === 'cors'
                          ? 'technical-cors-1'
                          : 'technical-request-1'
                        : 'technical-request-99'
                    ],
              technicalIdentity: hasTechnicalIdentity ? technicalIdentity : null
            }
          : {
              evidence: `Concrete observation ${index}.`,
              reasoning: 'An unsupported root cause.'
            }
      }
    }
  ];

  if (options.browserObservationSummary !== undefined) {
    evidence.push({
      evidenceReference: `evidence-${index}-browser`,
      source: 'browser',
      kind: 'browser-observation',
      relation: 'inconclusive',
      verificationCapable: false,
      summary: options.browserObservationSummary,
      rawSource: {
        type: 'console-error-observation',
        value: {
          text: options.browserObservationSummary,
          sourceUrl:
            technicalIdentity.kind === 'console-error' ? technicalIdentity.sourceUrl : null,
          lineNumber: 0,
          columnNumber: 0
        }
      }
    });
  }
  const verificationEvidenceReferences: FindingEvidence['evidenceReference'][] = [];

  if (state === 'verified') {
    const evidenceReference = `evidence-${index}-verification` as const;

    evidence.push({
      evidenceReference,
      source: 'deterministic-rule',
      kind: 'rule-observation',
      relation: 'supports',
      verificationCapable: true,
      summary: `Deterministic confirmation for finding ${index}.`
    });
    verificationEvidenceReferences.push(evidenceReference);
  }

  return {
    findingReference: `finding-${index}`,
    fingerprint:
      options.runtimeGroundedTechnical === true
        ? createTechnicalObservationFingerprint(technicalIdentity)
        : `fingerprint-${index}`,
    category: options.category ?? 'content',
    severity: options.severity ?? 'low',
    title: options.title ?? `Finding ${index}`,
    description: 'The model speculated that a database defect caused this.',
    suggestedCheck: 'Replace the production database.',
    occurrences: [
      {
        occurrenceReference: `occurrence-${index}`,
        pageUrl: 'https://example.com/path',
        pageTitle: 'Example page',
        target: null,
        evidence,
        verification: {
          state,
          reason: 'Internal verification reason.',
          evidenceReferences: verificationEvidenceReferences
        },
        screenshotReferences: ['C:\\private\\full-page.png'],
        redundantInvestigationSkipped: false
      }
    ],
    verification: {
      state,
      reason: 'Internal aggregate verification reason.',
      evidenceReferences: verificationEvidenceReferences
    }
  };
}

function createReport(): SiteAgentReport {
  const findings = Array.from(
    {
      length: 20
    },
    (_value, index) =>
      createFinding(index + 1, {
        severity: index === 0 ? 'medium' : 'low',
        state: index === 1 ? 'verified' : 'inconclusive'
      })
  );

  findings.push(
    createFinding(21, {
      category: 'technical',
      title: 'Third-party telemetry request failed',
      runtimeGroundedTechnical: true
    }),
    createFinding(22, {
      state: 'not-verified',
      title: 'Disproved candidate'
    })
  );
  findings[1]?.occurrences.push({
    occurrenceReference: 'occurrence-102',
    pageUrl: 'https://example.com/other',
    pageTitle: 'Other example page',
    target: null,
    evidence: [
      {
        evidenceReference: 'evidence-2-other',
        source: 'model',
        kind: 'model-observation',
        relation: 'inconclusive',
        verificationCapable: false,
        summary: 'A second occurrence was observed without confirmation evidence.',
        rawReference: {
          pageNumber: 2,
          candidateReference: 'candidate-2-other'
        },
        rawSource: {
          type: 'exploratory-qa-finding',
          value: {
            evidence: 'A similar pattern was observed on another page.',
            reasoning: 'The second occurrence was not independently confirmed.'
          }
        }
      }
    ],
    verification: {
      state: 'inconclusive',
      reason: 'The second occurrence was not confirmed.',
      evidenceReferences: []
    },
    screenshotReferences: [],
    redundantInvestigationSkipped: false
  });

  return {
    reportSchemaVersion: '3',
    runId: 'human-report-check',
    startedAt: '2026-07-28T10:00:00.000Z',
    finishedAt: '2026-07-28T10:01:05.000Z',
    site: {
      id: 'runtime',
      name: 'Runtime exploration: example.com',
      startUrl: 'https://example.com/'
    },
    outcome: {
      status: 'completed',
      reason: 'page-limit-reached',
      summary: 'Reached the configured page limit of 1.'
    },
    inspectedPages: [
      {
        selection: {
          type: 'start-url',
          url: 'https://example.com/'
        },
        observation: {
          title: 'Example page',
          finalUrl: 'https://example.com/path'
        },
        presentationEvidence: [
          {
            candidateReference: 'candidate-1',
            pageNumber: 1,
            pageUrl: 'https://example.com/path',
            target: {
              kind: 'visible-text',
              elementKind: 'heading',
              text: 'Example'
            },
            screenshotPaths: [
              'agent-results/human-report-check/evidence/focused-1.png',
              'agent-results/human-report-check/evidence/focused-2.png',
              'agent-results/human-report-check/evidence/focused-3.png'
            ],
            totalTargetCount: 7,
            shownTargetCount: 4
          },
          {
            candidateReference: 'candidate-2',
            pageNumber: 1,
            pageUrl: 'https://example.com/path',
            target: {
              kind: 'visible-text',
              elementKind: 'heading',
              text: 'Verified example'
            },
            screenshotPaths: ['agent-results/human-report-check/evidence/focused-confirmed.png'],
            totalTargetCount: 1,
            shownTargetCount: 1
          }
        ]
      } as unknown as SiteAgentReport['inspectedPages'][number]
    ],
    findings,
    passiveSecurity: {
      mode: 'passive-observation-only',
      disclaimer: 'Passive browsing only; no active security probing was performed.',
      pageSnapshots: [],
      observations: [
        {
          observationReference: 'security-observation-1',
          fingerprint: 'security|header|strict-transport-security',
          code: 'HSTS_NOT_OBSERVED',
          category: 'transport',
          posture: 'defense-in-depth-gap',
          severity: 'low',
          confidence: 'high',
          source: 'deterministic-passive',
          scope: {
            type: 'origin',
            key: 'https://example.com'
          },
          subject: 'strict-transport-security',
          title: 'HSTS response header was not observed',
          description: 'The inspected HTTPS response did not include an HSTS header.',
          remediation: 'Confirm whether HSTS is intended for this origin.',
          occurrences: [
            {
              pageUrl: 'https://example.com/path',
              pageTitle: 'Example page',
              responseUrl: 'https://example.com/path',
              evidence: [
                {
                  kind: 'response-header',
                  subject: 'strict-transport-security',
                  summary: 'No Strict-Transport-Security response header was observed.',
                  headerName: 'strict-transport-security',
                  headerValues: []
                }
              ]
            }
          ]
        }
      ],
      summary: {
        observationsCount: 1,
        bySeverity: {
          medium: 0,
          low: 1,
          info: 0
        },
        byCategory: {
          transport: 1,
          'response-policy': 0,
          'frame-protection': 0,
          'technology-disclosure': 0,
          cookie: 0,
          'request-inventory': 0,
          infrastructure: 0
        },
        originsObserved: 0
      }
    }
  } as unknown as SiteAgentReport;
}

function setFindingPages(finding: UnifiedFinding, pageNumbers: readonly number[]): void {
  const template = finding.occurrences[0]!;

  finding.occurrences = pageNumbers.map((pageNumber, occurrenceIndex) => ({
    ...structuredClone(template),
    occurrenceReference: `occurrence-${pageNumber * 100 + occurrenceIndex}`,
    pageUrl: `https://example.com/page-${pageNumber}`,
    pageTitle: `Page ${pageNumber}`
  }));
}

function createTechnicalGroupingReport(): SiteAgentReport {
  const report = createReport();
  const analyticsTitle = 'Failed network requests for analytics script';
  const trackingTitle = 'Failed network requests for tracking and analytics scripts';
  const findings = [
    createFinding(1, {
      severity: 'medium',
      title: 'Product finding'
    }),
    createFinding(2, {
      category: 'technical',
      severity: 'medium',
      title: analyticsTitle,
      runtimeGroundedTechnical: true,
      technicalIdentity: {
        kind: 'failed-request',
        failureText: 'net::ERR_ABORTED',
        method: 'GET',
        resourceType: 'script',
        resourceUrl: 'https://www.googletagmanager.com/gtag/js',
        originRelation: 'same-origin'
      }
    }),
    createFinding(3, {
      category: 'technical',
      severity: 'medium',
      title: analyticsTitle,
      runtimeGroundedTechnical: true,
      technicalIdentity: {
        kind: 'failed-request',
        failureText: 'net::ERR_BLOCKED_BY_ORB',
        method: 'GET',
        resourceType: 'script',
        resourceUrl: 'https://cdn.example.net/splide.min.js',
        originRelation: 'cross-origin'
      }
    }),
    ...Array.from(
      {
        length: 5
      },
      (_value, index) =>
        createFinding(index + 4, {
          category: 'technical',
          severity: 'medium',
          title: trackingTitle,
          runtimeGroundedTechnical: true
        })
    )
  ];
  const pageSets = [
    [1, 2, 3],
    [2, 3, 4],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [1, 5]
  ];

  for (const [index, pages] of pageSets.entries()) {
    setFindingPages(findings[index + 1]!, pages);
  }

  report.findings = findings;

  return report;
}

function createClassificationReport(): SiteAgentReport {
  const report = createReport();
  const placeholder = createFinding(51, {
    category: 'content',
    severity: 'low',
    title: 'Placeholder content detected in link text'
  });
  const poster = createFinding(52, {
    category: 'technical',
    severity: 'medium',
    title: 'Failed resource request for poster image',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'console-error',
      message: 'Failed to load resource: the server responded with a status of 404 ()',
      source: 'resource',
      sourceUrl: 'https://example.com/assets/poster.jpg',
      httpStatus: 404
    },
    browserObservationSummary:
      'Console error: Failed to load resource: the server responded with a status of 404 (). Source: https://example.com/assets/poster.jpg; line 0, column 0.'
  });
  const svg = createFinding(53, {
    category: 'technical',
    severity: 'low',
    title: 'Invalid SVG attribute value',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'console-error',
      message: 'Error: <svg> attribute height: Expected length, "auto".',
      source: 'inspected-page',
      sourceUrl: null,
      httpStatus: null
    },
    browserObservationSummary:
      'Console error: Error: <svg> attribute height: Expected length, "auto".'
  });
  const dns = createFinding(54, {
    category: 'technical',
    severity: 'low',
    title: 'Cross-origin DNS resolution failure observed',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_NAME_NOT_RESOLVED',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://assets.example.net/app.js',
      originRelation: 'cross-origin'
    }
  });
  const abortedScript = createFinding(55, {
    category: 'technical',
    severity: 'medium',
    title: 'Failed script request execution',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_ABORTED',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://example.com/application.js',
      originRelation: 'same-origin'
    }
  });
  const orbScript = createFinding(56, {
    category: 'technical',
    severity: 'medium',
    title: 'Failed script request execution',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_BLOCKED_BY_ORB',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://cdn.example.net/splide.js',
      originRelation: 'cross-origin'
    }
  });
  const cors = createFinding(57, {
    category: 'technical',
    severity: 'low',
    title: 'Cross-origin resource access failure',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'cors',
      mechanism: "No 'Access-Control-Allow-Origin' header is present.",
      method: 'POST',
      resourceType: 'xhr',
      resourceUrl: 'https://api.example.net/events',
      requestingOrigin: 'https://example.com',
      originRelation: 'cross-origin'
    }
  });

  setFindingPages(svg, [1, 2, 3, 4]);
  report.findings = [placeholder, poster, svg, dns, abortedScript, orbScript, cors];
  report.inspectedPages[0]!.presentationEvidence = [
    {
      candidateReference: 'candidate-51',
      pageNumber: 1,
      pageUrl: placeholder.occurrences[0]!.pageUrl,
      target: {
        kind: 'visible-text',
        elementKind: 'link',
        text: 'template_store.categories_list.ai.title'
      },
      screenshotPaths: ['agent-results/classification-check/evidence/placeholder.png'],
      totalTargetCount: 1,
      shownTargetCount: 1
    }
  ];

  return report;
}

function createReportWithFindings(
  source: SiteAgentReport,
  findings: readonly UnifiedFinding[]
): SiteAgentReport {
  const report = structuredClone(source);

  report.findings = findings.map(finding => structuredClone(finding));

  return report;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function getMarkdownItemBlock(markdown: string, title: string): string {
  const headingIndex = markdown.indexOf(` — ${title}\n`);
  const endIndex = markdown.indexOf('\n---', headingIndex);

  assert.notEqual(headingIndex, -1, `Missing Markdown item heading for "${title}".`);
  assert.notEqual(endIndex, -1, `Missing Markdown item terminator for "${title}".`);

  return markdown.slice(headingIndex, endIndex);
}

function main(): void {
  assert.equal(getHumanFindingStatus('verified'), 'Confirmed issue');
  assert.equal(getHumanFindingStatus('inconclusive'), 'Needs human review');
  assert.equal(getHumanFindingStatus('not-verified'), null);

  const report = createReport();
  const canonicalBefore = JSON.stringify(report);
  const markdown = renderHumanMarkdownReport(report);
  const mixedFindingSection = markdown.slice(
    markdown.indexOf('### 02 — Finding 2'),
    markdown.indexOf('### 03 — Finding 3')
  );
  const fullyConfirmedReport = createReport();
  fullyConfirmedReport.findings[1]!.occurrences =
    fullyConfirmedReport.findings[1]!.occurrences.slice(0, 1);
  const fullyConfirmedMarkdown = renderHumanMarkdownReport(fullyConfirmedReport);
  const fullyConfirmedFindingSection = fullyConfirmedMarkdown.slice(
    fullyConfirmedMarkdown.indexOf('### 02 — Finding 2'),
    fullyConfirmedMarkdown.indexOf('### 03 — Finding 3')
  );
  const summaryProjection = buildReconciledRunSummaryProjection(report);
  const humanPresentation = buildHumanReportPresentation(report);
  const duplicateTitleReport = createReport();
  duplicateTitleReport.findings[0]!.title = 'Identical title';
  duplicateTitleReport.findings[1]!.title = 'Identical title';
  const duplicateTitlePresentation = buildHumanReportPresentation(duplicateTitleReport);
  const duplicateTitleMarkdown = renderHumanMarkdownReport(duplicateTitleReport);
  const groupingReport = createTechnicalGroupingReport();
  const groupingCanonicalBefore = JSON.stringify(groupingReport);
  const groupingMarkdown = renderHumanMarkdownReport(groupingReport);
  const groupingPresentation = buildHumanReportPresentation(groupingReport);
  const groupingAtAGlance = groupingMarkdown.slice(
    groupingMarkdown.indexOf('## At a glance'),
    groupingMarkdown.indexOf('## Possible issues')
  );
  const groupingTechnicalSection = groupingMarkdown.slice(
    groupingMarkdown.indexOf('## Technical notes'),
    groupingMarkdown.indexOf('## Security notes')
  );
  const classificationReport = createClassificationReport();
  const classificationCanonicalBefore = JSON.stringify(classificationReport.findings);
  const classificationSecurityBefore = JSON.stringify(classificationReport.passiveSecurity);
  const classificationPresentation = buildHumanReportPresentation(classificationReport);
  const classificationMarkdown = renderHumanMarkdownReport(classificationReport);
  const classificationPosterBlock = getMarkdownItemBlock(
    classificationMarkdown,
    'Failed resource request for poster image'
  );
  const classificationSvgBlock = getMarkdownItemBlock(
    classificationMarkdown,
    'Invalid SVG attribute value'
  );
  const classificationDnsBlock = getMarkdownItemBlock(
    classificationMarkdown,
    'Cross-origin DNS resolution failure observed'
  );
  const classificationWithoutPresentation = structuredClone(classificationReport);
  classificationWithoutPresentation.inspectedPages[0]!.presentationEvidence = [];
  const classificationWithoutPresentationModel = buildHumanReportPresentation(
    classificationWithoutPresentation
  );
  const classificationWithPosterPresentation = structuredClone(classificationReport);
  const posterOccurrence = classificationWithPosterPresentation.findings[1]!.occurrences[0]!;
  classificationWithPosterPresentation.inspectedPages[0]!.presentationEvidence!.push({
    candidateReference: 'candidate-52',
    pageNumber: 1,
    pageUrl: posterOccurrence.pageUrl,
    target: {
      kind: 'visible-text',
      elementKind: 'heading',
      text: 'Poster presentation evidence'
    },
    screenshotPaths: ['agent-results/classification-check/evidence/poster.png'],
    totalTargetCount: 1,
    shownTargetCount: 1
  });
  const posterWithMultipleEvidenceSources = buildHumanReportPresentation(
    classificationWithPosterPresentation
  ).detailedFindings.find(finding => finding.title === 'Failed resource request for poster image')!;
  const classificationWithHigherPlaceholderSeverity = structuredClone(classificationReport);
  classificationWithHigherPlaceholderSeverity.findings[0]!.severity = 'high';
  const higherPlaceholderSeverityModel = buildHumanReportPresentation(
    classificationWithHigherPlaceholderSeverity
  );
  const deterministicRuleOnly = createFinding(75, {
    category: 'content',
    title: 'Deterministic rule only'
  });
  deterministicRuleOnly.occurrences[0]!.evidence = [
    {
      evidenceReference: 'evidence-75-rule',
      source: 'deterministic-rule',
      kind: 'rule-observation',
      relation: 'inconclusive',
      verificationCapable: false,
      summary: 'An inspected-page rule observed this condition.',
      rawSource: {
        type: 'page-finding',
        value: {
          code: 'SYNTHETIC_RULE',
          evidence: 'An inspected-page rule observed this condition.'
        }
      }
    }
  ];
  const deterministicRuleWithModel = createFinding(76, {
    category: 'content',
    title: 'Deterministic rule plus model evidence'
  });
  deterministicRuleWithModel.occurrences[0]!.evidence.push({
    evidenceReference: 'evidence-76-rule',
    source: 'deterministic-rule',
    kind: 'rule-observation',
    relation: 'inconclusive',
    verificationCapable: false,
    summary: 'A linked deterministic observation accompanies the model evidence.'
  });
  const browserBackedAccessibility = createFinding(77, {
    category: 'accessibility',
    title: 'Accessible name conflicts with visible label'
  });
  browserBackedAccessibility.occurrences[0]!.evidence[0]!.rawSource = {
    type: 'exploratory-qa-finding',
    value: exploratoryQaFindingSchema.parse({
      knownFindingReference: null,
      relatedRuleCode: null,
      category: 'accessibility',
      severity: 'low',
      confidence: 'high',
      title: 'Accessible name conflicts with visible label',
      evidence: 'The visible label is "Product", while the accessible name is "Delete account".',
      reasoning: 'The browser-backed values conflict.',
      suggestedCheck: 'Review the visible and accessible labels.',
      evidenceTarget: null,
      presentationTarget: null,
      structuredIdentity: {
        mechanism: 'unexpected-value',
        observedValue: 'Delete account',
        source: 'accessible-name',
        subject: {
          kind: 'semantic-control',
          controlType: 'disclosure',
          controlId: 'product-disclosure',
          componentId: 'product-panel',
          locator: null
        }
      },
      accessibilityDefectBasis: {
        expectation: 'The visible and accessible labels should identify the same control.',
        conflict: 'The visible and accessible labels differ.',
        supportingEvidence: [
          {
            controlType: 'disclosure',
            controlId: 'product-disclosure',
            property: 'visible-text',
            value: 'Product'
          },
          {
            controlType: 'disclosure',
            controlId: 'product-disclosure',
            property: 'accessible-name',
            value: 'Delete account'
          }
        ]
      },
      technicalEvidenceReferences: null,
      technicalIdentity: null
    })
  };
  const modelEvidenceOnly = createFinding(78, {
    category: 'content',
    title: 'Model evidence only'
  });
  const evidenceSourceModel = buildHumanReportPresentation(
    createReportWithFindings(classificationReport, [
      deterministicRuleOnly,
      deterministicRuleWithModel,
      browserBackedAccessibility,
      modelEvidenceOnly
    ])
  );
  const classificationFindingSection = classificationMarkdown.slice(
    classificationMarkdown.indexOf('## Possible issues'),
    classificationMarkdown.indexOf('## Technical notes')
  );
  const classificationTechnicalSection = classificationMarkdown.slice(
    classificationMarkdown.indexOf('## Technical notes'),
    classificationMarkdown.indexOf('## Security notes')
  );
  const failedImage = createFinding(61, {
    category: 'technical',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_FAILED',
      method: 'GET',
      resourceType: 'image',
      resourceUrl: 'https://example.com/hero.webp',
      originRelation: 'same-origin'
    }
  });
  const failedStylesheet = createFinding(62, {
    category: 'technical',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_FAILED',
      method: 'GET',
      resourceType: 'stylesheet',
      resourceUrl: 'https://example.com/site.css',
      originRelation: 'same-origin'
    }
  });
  const failedFont = createFinding(63, {
    category: 'technical',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_FAILED',
      method: 'GET',
      resourceType: 'font',
      resourceUrl: 'https://example.com/site.woff2',
      originRelation: 'same-origin'
    }
  });
  const analyticsScript = createFinding(64, {
    category: 'technical',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'failed-request',
      failureText: 'net::ERR_ABORTED',
      method: 'GET',
      resourceType: 'script',
      resourceUrl: 'https://analytics.example.net/collect.js',
      originRelation: 'cross-origin'
    }
  });
  const genericConsoleIdentity: TechnicalObservationIdentity = {
    kind: 'console-error',
    message: 'Synthetic JavaScript console warning.',
    source: 'inspected-page',
    sourceUrl: null,
    httpStatus: null
  };
  const genericConsole = createFinding(65, {
    category: 'technical',
    severity: 'high',
    runtimeGroundedTechnical: true,
    technicalIdentity: genericConsoleIdentity
  });
  const browserBackedContent = createFinding(66, {
    category: 'content',
    browserObservationSummary: 'Browser-observed visible localization token.'
  });
  const verifiedGenericConsole = createFinding(67, {
    state: 'verified',
    category: 'technical',
    title: 'Verified generic console observation',
    runtimeGroundedTechnical: true,
    technicalIdentity: genericConsoleIdentity
  });
  const verifiedCors = createFinding(68, {
    state: 'verified',
    category: 'technical',
    title: 'Verified CORS observation',
    runtimeGroundedTechnical: true,
    technicalIdentity: {
      kind: 'cors',
      mechanism: "No 'Access-Control-Allow-Origin' header is present.",
      method: 'GET',
      resourceType: 'fetch',
      resourceUrl: 'https://api.example.net/verified',
      requestingOrigin: 'https://example.com',
      originRelation: 'cross-origin'
    }
  });
  const typeIndependenceReport = createReport();
  typeIndependenceReport.findings = [
    verifiedCors,
    verifiedGenericConsole,
    classificationReport.findings[1]!
  ];
  const typeIndependencePresentation = buildHumanReportPresentation(typeIndependenceReport);
  const classificationSummary = buildReconciledRunSummaryProjection(classificationReport);
  const classificationRankedTitles = rankHumanReportNotableItems(classificationReport).map(
    finding => finding.title
  );
  const directlyObservedVersusNoiseReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[3]!,
    classificationReport.findings[0]!
  ]);
  const presentationAssetVersusSyntaxReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[2]!,
    classificationReport.findings[1]!
  ]);
  const aiOnlyTechnicalCandidate = createFinding(69, {
    category: 'technical',
    severity: 'high',
    title: 'AI-only technical candidate'
  });
  const browserTechnicalVersusAiReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[2]!,
    aiOnlyTechnicalCandidate
  ]);
  const dnsVersusAiReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[3]!,
    aiOnlyTechnicalCandidate
  ]);
  const corsVersusAiReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[6]!,
    aiOnlyTechnicalCandidate
  ]);
  const abortedVersusAiReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[4]!,
    aiOnlyTechnicalCandidate
  ]);
  const orbVersusAiReport = createReportWithFindings(classificationReport, [
    classificationReport.findings[5]!,
    aiOnlyTechnicalCandidate
  ]);
  const mediumAiOnly = createFinding(70, {
    category: 'technical',
    severity: 'medium',
    title: 'AI-only Medium candidate'
  });
  const aiMediumVersusDirectLowReport = createReportWithFindings(classificationReport, [
    mediumAiOnly,
    classificationReport.findings[0]!
  ]);
  const manyPageDns = structuredClone(classificationReport.findings[3]!);
  setFindingPages(manyPageDns, [1, 2, 3, 4, 5, 6, 7, 8]);
  const breadthVersusRelevanceReport = createReportWithFindings(classificationReport, [
    manyPageDns,
    classificationReport.findings[0]!
  ]);
  const severityTieReport = createReportWithFindings(classificationReport, [
    createFinding(71, {
      category: 'content',
      severity: 'low',
      title: 'Comparable Low item'
    }),
    createFinding(72, {
      category: 'content',
      severity: 'medium',
      title: 'Comparable Medium item'
    })
  ]);
  const stableTieReport = createReportWithFindings(classificationReport, [
    createFinding(73, {
      category: 'content',
      severity: 'low',
      title: 'Canonical first tie'
    }),
    createFinding(74, {
      category: 'content',
      severity: 'low',
      title: 'Canonical second tie'
    })
  ]);
  const distinctTechnicalReport = createReport();

  distinctTechnicalReport.findings = [
    createFinding(31, {
      category: 'technical',
      title: 'Distinct technical title A',
      runtimeGroundedTechnical: true
    }),
    createFinding(32, {
      category: 'technical',
      title: 'Distinct technical title B',
      runtimeGroundedTechnical: true
    })
  ];
  const distinctTechnicalMarkdown = renderHumanMarkdownReport(distinctTechnicalReport);
  const duplicateSecurityReport = createReport();
  const duplicateSecurityObservation = structuredClone(
    duplicateSecurityReport.passiveSecurity.observations[0]!
  );

  duplicateSecurityObservation.observationReference = 'security-observation-2';
  duplicateSecurityObservation.fingerprint = 'security|header|strict-transport-security|second';
  duplicateSecurityReport.passiveSecurity.observations.push(duplicateSecurityObservation);
  const duplicateSecurityMarkdown = renderHumanMarkdownReport(duplicateSecurityReport);
  const ungroundedTechnicalReport = createReport();

  ungroundedTechnicalReport.findings = [
    createFinding(41, {
      category: 'technical',
      title: ' model candidate:   Browser network request definitely failed '
    })
  ];
  const ungroundedCanonicalTitleBefore = ungroundedTechnicalReport.findings[0]!.title;
  const ungroundedTechnicalPresentation = buildHumanReportPresentation(ungroundedTechnicalReport);
  const ungroundedTechnicalMarkdown = renderHumanMarkdownReport(ungroundedTechnicalReport);
  const modelIdentityReport = createReport();

  modelIdentityReport.findings = [
    createFinding(42, {
      category: 'technical',
      title: 'Model-supplied technical identity',
      modelSuppliedTechnicalIdentity: true
    })
  ];
  const modelIdentityPresentation = buildHumanReportPresentation(modelIdentityReport);
  const legitimateCandidateReport = createReport();
  legitimateCandidateReport.findings = [
    createFinding(43, {
      title: 'Candidate selection is broken'
    })
  ];
  const legitimateCandidateMarkdown = renderHumanMarkdownReport(legitimateCandidateReport);
  const prefixedTechnicalReport = createReport();
  prefixedTechnicalReport.findings = [
    createFinding(44, {
      category: 'technical',
      title: 'MODEL CANDIDATE:   Invalid SVG attribute value',
      runtimeGroundedTechnical: true,
      technicalIdentity: {
        kind: 'console-error',
        message: 'Error: <svg> attribute height: Expected length, "auto".',
        source: 'inspected-page',
        sourceUrl: null,
        httpStatus: null
      }
    })
  ];
  const plainTechnicalReport = createReport();
  plainTechnicalReport.findings = [
    createFinding(44, {
      category: 'technical',
      title: 'Invalid SVG attribute value',
      runtimeGroundedTechnical: true,
      technicalIdentity: {
        kind: 'console-error',
        message: 'Error: <svg> attribute height: Expected length, "auto".',
        source: 'inspected-page',
        sourceUrl: null,
        httpStatus: null
      }
    })
  ];
  const prefixedTechnicalPresentation = buildHumanReportPresentation(prefixedTechnicalReport);
  const plainTechnicalPresentation = buildHumanReportPresentation(plainTechnicalReport);
  const prefixedTechnicalMarkdown = renderHumanMarkdownReport(prefixedTechnicalReport);
  const placeholderReport = createReport();
  const placeholderFinding = createFinding(42, {
    category: 'content',
    title: 'Placeholder content detected in link text'
  });
  placeholderFinding.fingerprint = 'unstructured|https monday com templates model 1';
  placeholderFinding.description =
    'The observed text appears to be a programmatic identifier or localization key rather than human-readable content, which is likely a content display error.';
  placeholderFinding.suggestedCheck =
    'Verify that the correct category title is correctly localized and rendered in the template store navigation.';
  placeholderFinding.occurrences[0]!.pageUrl = 'https://monday.com/templates';
  placeholderFinding.occurrences[0]!.pageTitle =
    'Customizable templates to get your team started in minutes';
  placeholderFinding.occurrences[0]!.evidence[0]!.summary =
    "The link text 'template_store.categories_list.ai.title' appears in the body content.";
  placeholderFinding.occurrences[0]!.evidence[0]!.rawReference = {
    pageNumber: 1,
    candidateReference: 'candidate-42'
  };
  placeholderFinding.occurrences[0]!.evidence[0]!.rawSource = {
    type: 'exploratory-qa-finding',
    value: {
      evidence:
        "The link text 'template_store.categories_list.ai.title' appears in the body content."
    }
  };
  placeholderReport.findings = [placeholderFinding];
  placeholderReport.inspectedPages[0]!.observation.title =
    placeholderFinding.occurrences[0]!.pageTitle;
  placeholderReport.inspectedPages[0]!.observation.finalUrl =
    placeholderFinding.occurrences[0]!.pageUrl;
  placeholderReport.inspectedPages[0]!.presentationEvidence = [
    {
      candidateReference: 'candidate-42',
      pageNumber: 1,
      pageUrl: 'https://monday.com/templates',
      target: {
        kind: 'visible-text',
        elementKind: 'link',
        text: 'template_store.categories_list.ai.title'
      },
      screenshotPaths: ['agent-results/placeholder-check/evidence/placeholder.png'],
      totalTargetCount: 1,
      shownTargetCount: 1
    }
  ];
  const placeholderIdentityBefore = placeholderFinding.fingerprint;
  const placeholderEvidenceBefore = JSON.stringify(placeholderFinding.occurrences[0]!.evidence);
  const placeholderMarkdown = renderHumanMarkdownReport(placeholderReport);
  const placeholderBlock = placeholderMarkdown.slice(
    placeholderMarkdown.indexOf('<a id="item-01"></a>'),
    placeholderMarkdown.indexOf('---', placeholderMarkdown.indexOf('<a id="item-01"></a>')) + 3
  );
  const expectedPlaceholderBlock = [
    '<a id="item-01"></a>',
    '### 01 — Placeholder content detected in link text',
    '',
    '**Possible issue · Observed directly · Needs human review · Low**  ',
    '**Page:** [/templates](https://monday.com/templates)',
    '',
    '**What happened**',
    '',
    'The text `template_store.categories_list.ai.title` appeared visibly in a link.',
    '',
    '**Why it may matter**',
    '',
    'If this visible text is unintended, it may confuse people using the page.',
    '',
    '**What still needs checking**',
    '',
    'Confirm whether this text is intended to appear for ordinary users.',
    '',
    '**Where this came from**',
    '',
    'Focused screenshot evidence captured on the inspected page.',
    '',
    '![Focused evidence for Placeholder content detected in link text](evidence/01-PLACEHOLDER-CONTENT-DETECTED-IN-LINK-TEXT-evidence-01.png)',
    '',
    '---'
  ].join('\n');

  assert.equal(
    placeholderBlock,
    expectedPlaceholderBlock,
    'The placeholder finding full Markdown item block must remain byte-for-byte stable.'
  );
  assert.equal(
    buildHumanReportPresentation(placeholderReport).detailedFindings[0]?.whatHappened,
    'The text `template_store.categories_list.ai.title` appeared visibly in a link.',
    'Plain-language projection must retain the exact safe observed value.'
  );
  assert.equal(placeholderFinding.fingerprint, placeholderIdentityBefore);
  assert.equal(
    JSON.stringify(placeholderFinding.occurrences[0]!.evidence),
    placeholderEvidenceBefore
  );
  assert.equal(placeholderReport.reportSchemaVersion, '3');
  const collisionReport = createReport();
  const collisionLifecycle = createRunFindingLifecycle();
  const collisionFixtures = [
    {
      pageNumber: 1,
      pageUrl: 'https://example.com/#/home',
      pageTitle: 'Home route',
      findingTitle: 'Home route candidate',
      screenshotPath: 'agent-results/exact-home.png'
    },
    {
      pageNumber: 2,
      pageUrl: 'https://example.com/#/settings',
      pageTitle: 'Settings route',
      findingTitle: 'Settings route candidate',
      screenshotPath: 'agent-results/exact-settings.png'
    }
  ] as const;

  collisionReport.inspectedPages = collisionFixtures.map(fixture => {
    const modelFinding: ExploratoryQaFinding = {
      category: 'content',
      severity: 'low',
      confidence: 'medium',
      title: fixture.findingTitle,
      evidence: `${fixture.pageTitle} contains a candidate observation.`,
      reasoning: 'The candidate requires human review.',
      suggestedCheck: 'Review the focused page evidence.',
      evidenceTarget: null,
      presentationTarget: {
        kind: 'visible-text',
        elementKind: 'heading',
        text: fixture.pageTitle
      }
    };
    const reconciledPage = prepareRunPageFindings(collisionLifecycle.knownFindingState, {
      pageUrl: fixture.pageUrl,
      pageTitle: fixture.pageTitle,
      ruleFindings: [],
      rawExploratoryQaAnalysis: {
        findings: [modelFinding],
        summary: 'One candidate.'
      },
      knownFindingPreparation: {
        deterministicKnownOccurrenceDrafts: [],
        knownFindingContext: []
      }
    });
    const candidate = reconciledPage.pageCandidates[0]!;

    assert.equal(
      candidate.reference,
      'candidate-1',
      'Candidate references must remain page-local in the hash-route integration fixture.'
    );

    commitRunPageFindings(collisionLifecycle, {
      page: reconciledPage,
      pageUrl: fixture.pageUrl,
      pageTitle: fixture.pageTitle,
      pageNumber: fixture.pageNumber,
      screenshotPath: null,
      exploratoryFindingResults: [
        {
          candidateReference: candidate.reference,
          finding: candidate.finding,
          outcome: {
            status: 'inconclusive',
            summary: 'No deterministic confirmation was collected.',
            evidence: []
          }
        }
      ]
    });

    return {
      selection: {
        type: 'start-url',
        url: fixture.pageUrl
      },
      observation: {
        title: fixture.pageTitle,
        finalUrl: fixture.pageUrl
      },
      presentationEvidence: [
        {
          candidateReference: candidate.reference,
          pageNumber: fixture.pageNumber,
          pageUrl: fixture.pageUrl,
          target: modelFinding.presentationTarget!,
          screenshotPaths: [fixture.screenshotPath],
          totalTargetCount: 1,
          shownTargetCount: 1
        }
      ]
    } as unknown as SiteAgentReport['inspectedPages'][number];
  });
  collisionReport.findings = getRunFindings(collisionLifecycle);
  const collisionPresentation = buildHumanReportPresentation(collisionReport);
  const collisionEvidenceByUrl = new Map(
    collisionPresentation.detailedFindings.map(
      finding =>
        [
          finding.pages[0]!.url,
          finding.focusedEvidence.map(evidence => evidence.sourcePath)
        ] as const
    )
  );

  assert.notEqual(
    duplicateTitlePresentation.atAGlance[0]?.anchor,
    duplicateTitlePresentation.atAGlance[1]?.anchor,
    'Run-scoped display IDs produce unique navigation anchors even for identical titles.'
  );
  assert.notEqual(
    duplicateTitlePresentation.atAGlance[0]?.displayId,
    duplicateTitlePresentation.atAGlance[1]?.displayId,
    'Display numbering is assigned independently of canonical titles and fingerprints.'
  );
  assert.equal(
    JSON.stringify(groupingReport),
    groupingCanonicalBefore,
    'Technical title grouping must not mutate canonical findings or occurrences.'
  );
  assert.equal(
    groupingPresentation.technicalObservationCount,
    7,
    'Grouping must not change the canonical technical-observation count.'
  );
  assert.equal(
    groupingPresentation.technicalObservations.length,
    7,
    'All canonical technical observations must remain present in the human presentation model.'
  );
  assert.match(
    groupingMarkdown,
    /- \*\*7\*\* technical observations/,
    'The human summary must retain the canonical technical-observation count.'
  );
  assert.equal(
    countOccurrences(groupingAtAGlance, '| Technical note |'),
    7,
    'Every canonical technical observation must retain its own at-a-glance row.'
  );
  assert.doesNotMatch(
    groupingMarkdown,
    /\(\d+ related\)|distinct technical observations share this title|distinct observations/,
    'No title-only relatedness or umbrella wording may remain.'
  );

  for (let displayId = 2; displayId <= 8; displayId += 1) {
    const paddedId = String(displayId).padStart(2, '0');

    assert.match(
      groupingTechnicalSection,
      new RegExp(`<a id="item-${paddedId}"></a>\\n### ${paddedId} —`),
      `Technical observation ${paddedId} must render as its own canonical item.`
    );
    assert.match(
      groupingAtAGlance,
      new RegExp(`\\[${paddedId}\\]\\(#item-${paddedId}\\)`),
      `Technical observation ${paddedId} must remain individually linkable from At a glance.`
    );
  }

  assert.equal(
    countOccurrences(groupingTechnicalSection, '[Structured technical evidence]'),
    7,
    'Every canonical technical observation must retain its evidence link.'
  );
  assert.deepEqual(
    classificationPresentation.detailedFindings.map(finding => finding.title),
    ['Failed resource request for poster image', 'Placeholder content detected in link text'],
    'The poster presentation asset and visible placeholder must route to Findings.'
  );
  assert.deepEqual(
    classificationPresentation.technicalObservations.map(observation => observation.title),
    [
      'Failed script request execution',
      'Failed script request execution',
      'Invalid SVG attribute value',
      'Cross-origin DNS resolution failure observed',
      'Cross-origin resource access failure'
    ],
    'SVG, DNS, CORS, aborted script, and ORB-blocked script observations must route to Technical observations.'
  );
  assert.equal(
    classificationPresentation.atAGlance.find(
      item => item.title === 'Failed resource request for poster image'
    )?.type,
    'Possible issue'
  );
  assert.equal(
    classificationPresentation.atAGlance.find(item => item.title === 'Invalid SVG attribute value')
      ?.type,
    'Technical note'
  );
  assert.match(
    classificationFindingSection,
    /### 01 — Failed resource request for poster image[\s\S]*The browser reported an HTTP 404 response for the page resource “https:\/\/example\.com\/assets\/poster\.jpg”\./
  );
  assert.doesNotMatch(
    classificationFindingSection,
    /CheckQuest did not match it to browser, network, console, or runtime diagnostics/
  );
  assert.equal(
    countOccurrences(classificationTechnicalSection, '### 05 — Invalid SVG attribute value'),
    1,
    'One canonical SVG finding must render once.'
  );
  assert.match(
    classificationTechnicalSection,
    /### 05 — Invalid SVG attribute value[\s\S]*\*\*Pages:\*\* [^\n]+page-1[^\n]+page-2[^\n]+page-3[^\n]+page-4/
  );
  assert.equal(
    countOccurrences(classificationTechnicalSection, '— Failed script request execution'),
    2,
    'The aborted and ORB-blocked script identities must render separately despite equal titles.'
  );
  assert.doesNotMatch(
    classificationMarkdown,
    /\(2 related\)|share this title|technical-group-item-/
  );
  assert.equal(classificationReport.findings[2]?.occurrences.length, 4);
  assert.notEqual(
    classificationReport.findings[4]?.fingerprint,
    classificationReport.findings[5]?.fingerprint
  );
  assert.equal(
    JSON.stringify(classificationReport.findings),
    classificationCanonicalBefore,
    'Classification and rendering must not mutate fingerprints, occurrences, evidence, or verification.'
  );
  assert.equal(
    JSON.stringify(classificationReport.passiveSecurity),
    classificationSecurityBefore,
    'Security observations must remain unchanged.'
  );
  assert.equal(classificationReport.reportSchemaVersion, '3');
  assert.equal(classifyHumanReportItem(failedImage), 'finding');
  assert.equal(classifyHumanReportItem(failedStylesheet), 'finding');
  assert.equal(classifyHumanReportItem(failedFont), 'finding');
  assert.equal(classifyHumanReportItem(analyticsScript), 'technical-observation');
  assert.equal(classifyHumanReportItem(genericConsole), 'technical-observation');
  assert.equal(
    classifyHumanReportItem(classificationReport.findings[3]!),
    'technical-observation',
    'Cross-origin DNS identity must override presentation-asset routing.'
  );
  assert.equal(
    classifyHumanReportItem(browserBackedContent),
    'finding',
    'Browser evidence alone must not determine report section.'
  );
  assert.equal(
    classifyHumanReportItem(genericConsole),
    'technical-observation',
    'High severity must not promote a console warning into Findings.'
  );
  assert.equal(
    classifyHumanReportItem(verifiedCors),
    'technical-observation',
    'Verified CORS must remain a Technical observation.'
  );
  assert.equal(
    classifyHumanReportItem(verifiedGenericConsole),
    'technical-observation',
    'A verified generic console error must remain a Technical observation.'
  );
  const inconclusivePoster = classificationReport.findings[1]!;
  assert.equal(inconclusivePoster.verification.state, 'inconclusive');
  assert.ok(
    inconclusivePoster.occurrences.some(occurrence =>
      occurrence.evidence.some(
        evidence => evidence.source === 'browser' && evidence.kind === 'browser-observation'
      )
    ),
    'The inconclusive poster failure case must retain browser evidence.'
  );
  assert.equal(
    classifyHumanReportItem(inconclusivePoster),
    'finding',
    'An inconclusive presentation-asset failure with browser evidence must remain a Finding.'
  );
  assert.equal(
    verifiedGenericConsole.fingerprint,
    genericConsole.fingerprint,
    'The comparison cases must have the same technical identity.'
  );
  assert.notEqual(verifiedGenericConsole.verification.state, genericConsole.verification.state);
  assert.equal(
    classifyHumanReportItem(verifiedGenericConsole),
    classifyHumanReportItem(genericConsole),
    'The same technical identity must retain its section across verification states.'
  );
  assert.deepEqual(
    typeIndependencePresentation.technicalObservations.map(observation => observation.title),
    ['Verified CORS observation', 'Verified generic console observation'],
    'Verified technical identities must render in Technical observations.'
  );
  assert.deepEqual(
    typeIndependencePresentation.detailedFindings.map(finding => finding.title),
    ['Failed resource request for poster image'],
    'The inconclusive poster asset failure must render in Findings.'
  );
  const projectedPlaceholder = classificationPresentation.detailedFindings.find(
    finding => finding.title === 'Placeholder content detected in link text'
  )!;
  const projectedPoster = classificationPresentation.detailedFindings.find(
    finding => finding.title === 'Failed resource request for poster image'
  )!;
  const projectedSvg = classificationPresentation.technicalObservations.find(
    observation => observation.title === 'Invalid SVG attribute value'
  )!;
  const projectedVerifiedCors = typeIndependencePresentation.technicalObservations.find(
    observation => observation.title === 'Verified CORS observation'
  )!;
  const projectedInconclusiveCors = classificationPresentation.technicalObservations.find(
    observation => observation.title === 'Cross-origin resource access failure'
  )!;
  assert.deepEqual(
    {
      type: projectedPlaceholder.itemType,
      evidence: projectedPlaceholder.evidenceSource,
      assessment: projectedPlaceholder.assessment
    },
    {
      type: 'Possible issue',
      evidence: 'Observed directly',
      assessment: 'Needs human review'
    }
  );
  assert.deepEqual(
    {
      type: projectedPoster.itemType,
      evidence: projectedPoster.evidenceSource,
      assessment: projectedPoster.assessment
    },
    {
      type: 'Possible issue',
      evidence: 'Seen in browser data',
      assessment: 'Needs human review'
    }
  );
  assert.deepEqual(
    {
      type: posterWithMultipleEvidenceSources.itemType,
      evidence: posterWithMultipleEvidenceSources.evidenceSource,
      assessment: posterWithMultipleEvidenceSources.assessment
    },
    {
      type: 'Possible issue',
      evidence: 'Observed directly',
      assessment: 'Needs human review'
    },
    'Successfully linked focused evidence must outrank retained browser and model evidence.'
  );
  assert.deepEqual(
    {
      type: projectedVerifiedCors.itemType,
      evidence: projectedVerifiedCors.evidenceSource,
      assessment: projectedVerifiedCors.assessment
    },
    {
      type: 'Technical note',
      evidence: 'Seen in browser data',
      assessment: 'Confirmed observation'
    }
  );
  assert.deepEqual(
    {
      type: projectedSvg.itemType,
      evidence: projectedSvg.evidenceSource,
      assessment: projectedSvg.assessment
    },
    {
      type: 'Technical note',
      evidence: 'Seen in browser data',
      assessment: 'Needs human review'
    }
  );
  assert.deepEqual(
    {
      type: projectedInconclusiveCors.itemType,
      evidence: projectedInconclusiveCors.evidenceSource
    },
    {
      type: projectedVerifiedCors.itemType,
      evidence: projectedVerifiedCors.evidenceSource
    },
    'Verification must change assessment without changing type or evidence source.'
  );
  const placeholderWithoutPresentation =
    classificationWithoutPresentationModel.detailedFindings.find(
      finding => finding.title === 'Placeholder content detected in link text'
    )!;
  assert.deepEqual(
    {
      type: placeholderWithoutPresentation.itemType,
      assessment: placeholderWithoutPresentation.assessment
    },
    {
      type: projectedPlaceholder.itemType,
      assessment: projectedPlaceholder.assessment
    },
    'Evidence source changes must not change type or assessment.'
  );
  assert.equal(placeholderWithoutPresentation.evidenceSource, 'AI analysis only');
  assert.deepEqual(
    evidenceSourceModel.detailedFindings.map(finding => [finding.title, finding.evidenceSource]),
    [
      ['Deterministic rule only', 'Seen in browser data'],
      ['Deterministic rule plus model evidence', 'Seen in browser data'],
      ['Accessible name conflicts with visible label', 'Seen in browser data'],
      ['Model evidence only', 'AI analysis only']
    ],
    'Deterministic and admitted accessibility facts must remain distinct from model-only evidence.'
  );
  assert.equal(
    projectedPlaceholder.evidenceSource,
    'Observed directly',
    'A successfully linked focused screenshot must retain evidence-source precedence.'
  );
  assert.equal(
    projectedPoster.evidenceSource,
    'Seen in browser data',
    'A linked browser observation without a focused screenshot must remain browser-backed.'
  );
  assert.equal(
    projectedSvg.evidenceSource,
    'Seen in browser data',
    'A technical identity validated against browser facts must remain browser-backed.'
  );
  assert.equal(
    classificationPresentation.securityObservations[0]?.evidenceSource,
    'Seen in browser data',
    'The existing passive-security evidence label must remain browser-backed.'
  );
  const higherSeverityPlaceholder = higherPlaceholderSeverityModel.detailedFindings.find(
    finding => finding.title === 'Placeholder content detected in link text'
  )!;
  assert.deepEqual(
    {
      type: higherSeverityPlaceholder.itemType,
      evidence: higherSeverityPlaceholder.evidenceSource,
      assessment: higherSeverityPlaceholder.assessment
    },
    {
      type: projectedPlaceholder.itemType,
      evidence: projectedPlaceholder.evidenceSource,
      assessment: projectedPlaceholder.assessment
    },
    'Severity changes must not change type, evidence source, or assessment.'
  );
  assert.deepEqual(
    buildReconciledRunSummaryProjection(typeIndependenceReport),
    {
      inspectedPageCount: 1,
      confirmedFindingCount: 0,
      reviewFindingCount: 1,
      technicalObservationCount: 2,
      securityObservationCount: 1,
      primaryFindingCount: 1
    },
    'Verified technical observations must not increment the confirmed-Finding count.'
  );
  assert.deepEqual(
    classificationSummary,
    {
      inspectedPageCount: 1,
      confirmedFindingCount: 0,
      reviewFindingCount: 2,
      technicalObservationCount: 5,
      securityObservationCount: 1,
      primaryFindingCount: 2
    },
    'Saved-run-style counts must derive from Loop 2A classification and keep security separate.'
  );
  assert.match(classificationMarkdown, /- \*\*0\*\* confirmed findings/);
  assert.match(classificationMarkdown, /- \*\*2\*\* findings needing review/);
  assert.match(classificationMarkdown, /- \*\*5\*\* technical observations/);
  assert.deepEqual(
    classificationRankedTitles.slice(0, 3),
    [
      'Placeholder content detected in link text',
      'Failed resource request for poster image',
      'Invalid SVG attribute value'
    ],
    'The saved-run ranking must put the directly observed placeholder first, poster asset second, and SVG observation third.'
  );
  assert.equal(
    classificationPresentation.notableSummary,
    'The most notable items were placeholder content detected in link text and failed resource request for poster image.'
  );
  assert.ok(
    !classificationRankedTitles
      .slice(0, 2)
      .includes('Cross-origin DNS resolution failure observed') &&
      !classificationRankedTitles.slice(0, 2).includes('Failed script request execution'),
    'DNS and aborted/ORB script diagnostics must not displace stronger user-facing findings.'
  );
  assert.equal(
    rankHumanReportNotableItems(directlyObservedVersusNoiseReport)[0]?.title,
    'Placeholder content detected in link text',
    'A directly observed Low-severity Finding must outrank Medium technical noise.'
  );
  assert.equal(
    rankHumanReportNotableItems(presentationAssetVersusSyntaxReport)[0]?.title,
    'Failed resource request for poster image',
    'A browser-backed presentation-asset Finding must outrank a browser-backed syntax warning.'
  );
  assert.equal(
    rankHumanReportNotableItems(browserTechnicalVersusAiReport)[0]?.title,
    'Invalid SVG attribute value',
    'A browser-backed technical observation must outrank an AI-only technical candidate.'
  );
  assert.equal(
    rankHumanReportNotableItems(dnsVersusAiReport)[0]?.title,
    'AI-only technical candidate',
    'The structured cross-origin DNS environment pattern must use the environment-sensitive tier.'
  );
  assert.equal(
    rankHumanReportNotableItems(corsVersusAiReport)[0]?.title,
    'Cross-origin resource access failure',
    'Generic CORS must remain an ordinary browser-backed technical observation.'
  );
  assert.equal(
    rankHumanReportNotableItems(abortedVersusAiReport)[0]?.title,
    'Failed script request execution',
    'A generic first-party ERR_ABORTED request must remain an ordinary browser-backed technical observation.'
  );
  assert.equal(
    rankHumanReportNotableItems(orbVersusAiReport)[0]?.title,
    'Failed script request execution',
    'A generic ORB-blocked resource must remain an ordinary browser-backed technical observation.'
  );
  assert.equal(
    rankHumanReportNotableItems(aiMediumVersusDirectLowReport)[0]?.title,
    'Placeholder content detected in link text',
    'An AI-only Medium item must not outrank a directly observed Low item.'
  );
  assert.equal(
    rankHumanReportNotableItems(breadthVersusRelevanceReport)[0]?.title,
    'Placeholder content detected in link text',
    'Environment-sensitive breadth must not outrank one-page user-facing evidence.'
  );
  assert.deepEqual(
    rankHumanReportNotableItems(severityTieReport).map(finding => finding.title),
    ['Comparable Medium item', 'Comparable Low item'],
    'Severity must break ties only after ranking tier, assessment, and breadth.'
  );
  const stableTieOrder = ['Canonical first tie', 'Canonical second tie'];
  assert.deepEqual(
    rankHumanReportNotableItems(stableTieReport).map(finding => finding.title),
    stableTieOrder,
    'Stable canonical order must be the final tie-breaker.'
  );
  assert.deepEqual(
    rankHumanReportNotableItems(stableTieReport).map(finding => finding.title),
    stableTieOrder,
    'Repeated notable projections must be deterministic.'
  );
  assert.match(classificationMarkdown, /## Security notes/);
  assert.match(classificationMarkdown, /### S01 — HSTS response header was not observed/);
  assert.match(
    classificationPosterBlock,
    /Possible issue · Seen in browser data · Needs human review · Medium/
  );
  assert.match(
    classificationPosterBlock,
    /\*\*What happened\*\*[\s\S]*HTTP 404 response for the page resource “https:\/\/example\.com\/assets\/poster\.jpg”/
  );
  assert.match(
    classificationPosterBlock,
    /\*\*Why it may matter\*\*[\s\S]*no visible problem was captured/
  );
  assert.doesNotMatch(
    classificationPosterBlock,
    /image (?:was|is) visibly missing|visible image (?:failure|defect)|confirmed visible/i,
    'Poster wording must not claim that the failed image was visibly missing.'
  );
  assert.match(
    classificationSvgBlock,
    /Technical note · Seen in browser data · Needs human review · Low/
  );
  assert.match(
    classificationSvgBlock,
    /\*\*What happened\*\*[\s\S]*&lt;svg&gt;[\s\S]*same observation appeared on 4 inspected pages/i
  );
  assert.match(
    classificationSvgBlock,
    /\*\*Why it may matter\*\*[\s\S]*practical impact is not clear from the evidence collected/
  );
  assert.doesNotMatch(
    classificationSvgBlock,
    /visible (?:SVG )?(?:defect|problem)|visibly broken|confirmed rendering/i,
    'SVG wording must not upgrade a console message into a visible defect.'
  );
  assert.notEqual(
    projectedSvg.whatHappened,
    projectedSvg.whereThisCameFrom,
    'What happened and Where this came from must communicate different facts.'
  );
  assert.match(
    classificationDnsBlock,
    /Technical note · Seen in browser data · Needs human review · Low/
  );
  assert.match(
    classificationDnsBlock,
    /DNS failure may reflect the test environment rather than the website/
  );
  assert.match(
    classificationDnsBlock,
    /Repeat the check from another environment before attributing the failure to the website/
  );
  assert.match(
    distinctTechnicalMarkdown,
    /\| \[01\]\(#item-01\) \| \[Distinct technical title A\]\(#item-01\) \| Technical note/
  );
  assert.match(distinctTechnicalMarkdown, /### 01 — Distinct technical title A/);
  assert.match(distinctTechnicalMarkdown, /### 02 — Distinct technical title B/);
  assert.doesNotMatch(
    distinctTechnicalMarkdown,
    /\(\d+ related\)/,
    'All-distinct technical titles must retain the existing rendering.'
  );
  assert.equal(countOccurrences(duplicateTitleMarkdown, '### 01 — Identical title'), 1);
  assert.equal(countOccurrences(duplicateTitleMarkdown, '### 02 — Identical title'), 1);
  assert.doesNotMatch(
    duplicateTitleMarkdown,
    /Identical title \(2 related\)/,
    'Product findings must not be grouped by title.'
  );
  assert.match(duplicateSecurityMarkdown, /### S01 — HSTS response header was not observed/);
  assert.match(duplicateSecurityMarkdown, /### S02 — HSTS response header was not observed/);
  assert.doesNotMatch(
    duplicateSecurityMarkdown,
    /HSTS response header was not observed \(2 related\)/,
    'Security observations must not be grouped by title.'
  );
  assert.deepEqual(
    {
      needsReview: ungroundedTechnicalPresentation.needsReviewCount,
      technical: ungroundedTechnicalPresentation.technicalObservationCount,
      provenance: ungroundedTechnicalPresentation.detailedFindings[0]?.modelCandidateProvenance
    },
    {
      needsReview: 1,
      technical: 0,
      provenance: true
    },
    'An ungrounded model-only technical candidate remains a Possible issue needing human review.'
  );
  assert.equal(
    ungroundedTechnicalReport.findings[0]?.verification.state,
    'inconclusive',
    'Presentation projection must not alter canonical verification for an ungrounded technical candidate.'
  );
  assert.equal(
    exploratoryQaFindingSchema.safeParse(
      ungroundedTechnicalReport.findings[0]?.occurrences[0]?.evidence[0]?.rawSource?.value
    ).success,
    true,
    'The ungrounded regression fixture must remain a schema-valid model candidate.'
  );
  assert.match(
    ungroundedTechnicalMarkdown,
    /Possible issue · AI analysis only · Needs human review · Low[\s\S]*\*\*What happened\*\*[\s\S]*Concrete observation 41\.[\s\S]*\*\*Where this came from\*\*[\s\S]*AI analysis only; no matching browser or screenshot evidence was linked\./
  );
  assert.doesNotMatch(
    ungroundedTechnicalMarkdown,
    /Structured technical evidence|The model proposed|CheckQuest did not match/
  );
  assert.doesNotMatch(
    ungroundedTechnicalMarkdown,
    /Model candidate:/i,
    'The internal model-candidate prefix must not appear in reader-facing Markdown.'
  );
  assert.match(
    ungroundedTechnicalMarkdown,
    /\| \[01\]\(#item-01\) \| \[Browser network request definitely failed\]\(#item-01\) \| Possible issue \| AI analysis only \| Needs human review \| Low \| [^|]+ \|/
  );
  assert.match(
    ungroundedTechnicalMarkdown,
    /The most notable item was browser network request definitely failed\./
  );
  assert.match(ungroundedTechnicalMarkdown, /### 01 — Browser network request definitely failed/);
  assert.equal(
    ungroundedTechnicalReport.findings[0]?.title,
    ungroundedCanonicalTitleBefore,
    'Display-title cleanup must not mutate the canonical title.'
  );
  assert.match(
    legitimateCandidateMarkdown,
    /### 01 — Candidate selection is broken/,
    'Legitimate uses of candidate outside the exact prefix must be preserved.'
  );
  assert.match(
    prefixedTechnicalMarkdown,
    /\| \[01\]\(#item-01\) \| \[Invalid SVG attribute value\]\(#item-01\) \| Technical note \| Seen in browser data \| Needs human review/
  );
  assert.match(
    prefixedTechnicalMarkdown,
    /The most notable item was invalid SVG attribute value\./
  );
  assert.match(prefixedTechnicalMarkdown, /### 01 — Invalid SVG attribute value/);
  assert.doesNotMatch(prefixedTechnicalMarkdown, /Model candidate:/i);
  assert.equal(
    prefixedTechnicalPresentation.atAGlance[0]?.anchor,
    plainTechnicalPresentation.atAGlance[0]?.anchor,
    'Display-title cleanup must not change the stable display-ID anchor.'
  );
  assert.equal(
    prefixedTechnicalReport.findings[0]?.title,
    'MODEL CANDIDATE:   Invalid SVG attribute value',
    'Technical canonical titles must remain unchanged.'
  );
  assert.doesNotMatch(
    ungroundedTechnicalMarkdown.slice(
      ungroundedTechnicalMarkdown.indexOf('## Technical notes'),
      ungroundedTechnicalMarkdown.indexOf('## Security notes')
    ),
    /Browser network request definitely failed/
  );
  assert.deepEqual(
    {
      needsReview: modelIdentityPresentation.needsReviewCount,
      technical: modelIdentityPresentation.technicalObservationCount,
      provenance: modelIdentityPresentation.detailedFindings[0]?.modelCandidateProvenance
    },
    {
      needsReview: 1,
      technical: 0,
      provenance: true
    },
    'A model-supplied technical identity without the runtime-derived fingerprint must not qualify as technical grounding.'
  );
  assert.equal(
    humanPresentation.technicalObservations.some(
      observation => observation.title === 'Third-party telemetry request failed'
    ),
    true,
    'A runtime-grounded technical candidate remains a technical observation.'
  );
  for (const fixture of collisionFixtures) {
    assert.deepEqual(
      collisionEvidenceByUrl.get(fixture.pageUrl),
      [fixture.screenshotPath],
      'Each hash-route screenshot must attach only through its production page-number and page-local candidate-reference pair.'
    );

    const canonicalFinding = collisionReport.findings.find(finding =>
      finding.occurrences.some(occurrence => occurrence.pageUrl === fixture.pageUrl)
    );
    const candidateLinkedEvidence =
      canonicalFinding?.occurrences[0]?.evidence.filter(
        evidence =>
          evidence.kind === 'model-observation' || evidence.kind === 'investigation-outcome'
      ) ?? [];

    assert.deepEqual(
      candidateLinkedEvidence.map(evidence => ({
        kind: evidence.kind,
        pageNumber: evidence.rawReference?.pageNumber,
        candidateReference: evidence.rawReference?.candidateReference
      })),
      [
        {
          kind: 'model-observation',
          pageNumber: fixture.pageNumber,
          candidateReference: 'candidate-1'
        },
        {
          kind: 'investigation-outcome',
          pageNumber: fixture.pageNumber,
          candidateReference: 'candidate-1'
        }
      ],
      'The production lifecycle must stamp both model and investigation evidence with complete candidate provenance.'
    );
  }

  assert.deepEqual(
    {
      confirmed: humanPresentation.confirmedIssueCount,
      review: humanPresentation.needsReviewCount,
      technical: humanPresentation.technicalObservationCount
    },
    {
      confirmed: summaryProjection.confirmedFindingCount,
      review: summaryProjection.reviewFindingCount,
      technical: summaryProjection.technicalObservationCount
    },
    'GUI-event and human-report accounting must share one reconciled projection.'
  );

  assert.equal(
    JSON.stringify(report),
    canonicalBefore,
    'Rendering must not mutate the canonical report.'
  );
  assert.ok(
    markdown.indexOf('Finding 1') < markdown.indexOf('Finding 2'),
    'Severity order should be stable and put medium before low.'
  );
  assert.match(markdown, /- \*\*19\*\* findings needing review/);
  assert.match(markdown, /- \*\*1\*\* confirmed finding/);
  assert.match(markdown, /- \*\*1\*\* technical observation/);
  assert.equal(
    countOccurrences(markdown, '### How to read this report'),
    1,
    'The compact report vocabulary must render exactly once.'
  );
  for (const label of [
    'Possible issue',
    'Technical note',
    'Security note',
    'Observed directly',
    'Seen in browser data',
    'AI analysis only',
    'Confirmed issue',
    'Confirmed observation',
    'Needs human review'
  ]) {
    assert.match(markdown, new RegExp(`\\*\\*${label}:\\*\\*`));
  }
  const humanItemCount =
    humanPresentation.detailedFindings.length +
    humanPresentation.additionalFindings.length +
    humanPresentation.technicalObservations.length +
    humanPresentation.securityObservations.length;
  const possibleIssueCount =
    humanPresentation.confirmedIssueCount + humanPresentation.needsReviewCount;
  assert.equal(
    humanPresentation.detailedFindings.length,
    Math.min(humanReportDetailedFindingLimit, possibleIssueCount)
  );
  assert.equal(
    humanPresentation.additionalFindings.length,
    Math.max(0, possibleIssueCount - humanReportDetailedFindingLimit)
  );
  for (const heading of [
    '**What happened**',
    '**Why it may matter**',
    '**What still needs checking**',
    '**Where this came from**'
  ]) {
    assert.equal(
      countOccurrences(markdown, heading),
      humanItemCount,
      `Every projected human item must render ${heading}.`
    );
  }
  assert.doesNotMatch(markdown, /\*\*(?:What I saw|Evidence status|Evidence provenance)\*\*/);
  assert.doesNotMatch(
    markdown,
    /verification-capable|verification state|canonical|fingerprint|projection/i,
    'Prominent human Markdown must not expose internal report-pipeline terminology.'
  );
  assert.match(
    markdown,
    /### 01 — Finding 1[\s\S]*Possible issue · Observed directly · Needs human review · Medium[\s\S]*\*\*What happened\*\*[\s\S]*The text `Example` appeared visibly in a heading\.[\s\S]*01-FINDING-1-evidence-01\.png/
  );
  assert.match(
    markdown,
    /### 02 — Finding 2[\s\S]*Possible issue · Observed directly · Confirmed issue · Low[\s\S]*02-FINDING-2-evidence-01\.png/
  );
  assert.match(
    mixedFindingSection,
    /\*\*Pages:\*\* \[\/path\]\(https:\/\/example\.com\/path\), \[\/other\]\(https:\/\/example\.com\/other\)/
  );
  assert.equal(
    humanPresentation.detailedFindings.find(finding => finding.title === 'Finding 2')
      ?.confirmationCoverage,
    'partial',
    'The mixed fixture must contain one confirmed and one unconfirmed occurrence.'
  );
  assert.match(fullyConfirmedFindingSection, /02-FINDING-2-evidence-01\.png/);
  assert.match(markdown, /## Security notes[\s\S]*HSTS response header was not observed/);
  assert.match(markdown, /## Additional possible issues/);

  for (let index = 1; index <= 20; index += 1) {
    assert.match(markdown, new RegExp(`Finding ${index}(?:\\D|$)`));
  }

  assert.match(markdown, /4 of 7 observed instances are shown\./);
  assert.match(markdown, /\]\(evidence\/01-FINDING-1-evidence-01\.png\)/);
  assert.match(markdown, /## Technical notes[\s\S]*Third-party telemetry request failed/);
  assert.doesNotMatch(markdown, /Disproved candidate/);
  assert.doesNotMatch(markdown, /C:\\private/);
  assert.doesNotMatch(
    markdown,
    /database defect|Replace the production database|unsupported root cause/i
  );
  assert.doesNotMatch(
    markdown,
    /Unexpected, repeated, or unclear content|Review the observed area and confirm|No focused visual evidence/i
  );
  assert.doesNotMatch(markdown, /Reached the configured page limit/);
  assert.match(
    markdown,
    /\| # \| Item \| Type \| Evidence \| Assessment \| Severity \| Page\(s\) \|/
  );
  assert.match(
    markdown,
    /\| \[21\]\(#item-21\) \| \[Third-party telemetry request failed\]\(#item-21\) \| Technical note \| Seen in browser data \| Needs human review \| Low \|/
  );
  assert.match(markdown, /### 01 — Finding 1/);
  assert.match(
    markdown,
    /\| \[\/path\]\(https:\/\/example\.com\/path\) \| Start URL \| \[01\]\(#item-01\)/
  );
  assert.doesNotMatch(
    markdown,
    /findingReference|candidateReference|occurrenceReference|fingerprint/
  );
  assert.doesNotMatch(markdown, /Verification:|Derivation:|Occurrence:/);
  assert.match(
    markdown,
    /Full machine-readable evidence, diagnostics, assessments, and execution details are available in `report\.json`\./
  );
  assert.doesNotMatch(markdown, /could be real, could be nothing/i);

  const groups = groupFocusedEvidenceTargets(
    [
      {
        x: 10,
        y: 10,
        width: 100,
        height: 20
      },
      {
        x: 10,
        y: 100,
        width: 100,
        height: 20
      },
      {
        x: 10,
        y: 900,
        width: 100,
        height: 20
      }
    ],
    500
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.boxes.length, 2);
  assert.deepEqual(
    calculateFocusedEvidenceClip(
      {
        boxes: [
          {
            x: 4,
            y: 6,
            width: 20,
            height: 10
          }
        ]
      },
      {
        width: 100,
        height: 100
      },
      10
    ),
    {
      x: 0,
      y: 0,
      width: 34,
      height: 26
    }
  );

  console.log('Human report semantics check passed.');
}

main();
