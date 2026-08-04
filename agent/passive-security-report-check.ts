import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { UnifiedFinding } from './findings/finding-model';

import type { SiteAgentReport } from './reporting/report-types';

import { buildSiteAgentReport } from './reporting/build-site-agent-report';

import { writeJsonReport } from './reporting/write-json-report';

import { writeMarkdownReport } from './reporting/write-markdown-report';

import type { PassivePageSecuritySnapshot } from './security/passive-security-model';

import {
  createPassiveSecurityRegistry,
  getPassiveSecurityReport,
  registerPassiveSecuritySnapshot
} from './security/passive-security-registry';

import { sanitizePassiveSecurityHeaderValue } from './security/capture-main-document-security';

const passiveHeaderSecrets = [
  'REPORT_NONCE_SECRET',
  'REPORT_HASH_SECRET',
  'REPORT_QUERY_SECRET',
  'REPORT_FRAGMENT_SECRET',
  'REPORT_USER_SECRET',
  'REPORT_PASSWORD_SECRET'
] as const;

function createSnapshot(pageNumber: number): PassivePageSecuritySnapshot {
  const finalUrl = `https://example.com/page-${pageNumber}`;

  return {
    requestedUrl: finalUrl,
    finalUrl,
    responseUrl: finalUrl,
    responseStatus: 200,
    responseReceived: true,
    finalScheme: 'https:',
    origin: 'https://example.com',
    pageTitle: `Page ${pageNumber}`,
    redirects: [],
    headers: {
      'content-security-policy': [
        sanitizePassiveSecurityHeaderValue(
          'content-security-policy',
          "default-src 'self'; script-src 'nonce-REPORT_NONCE_SECRET' 'sha256-REPORT_HASH_SECRET'; connect-src https://REPORT_USER_SECRET:REPORT_PASSWORD_SECRET@api.example.test/path?token=REPORT_QUERY_SECRET#REPORT_FRAGMENT_SECRET; frame-ancestors 'self'"
        )
      ],
      'x-content-type-options': ['nosniff'],
      'x-frame-options': ['DENY'],
      server: ['fixture`server | [edge]']
    }
  };
}

async function main(): Promise<void> {
  const registry = createPassiveSecurityRegistry();

  registerPassiveSecuritySnapshot(registry, createSnapshot(1));

  registerPassiveSecuritySnapshot(registry, createSnapshot(2));

  const passiveSecurity = getPassiveSecurityReport(registry);

  const functionalFindings: UnifiedFinding[] = [
    {
      findingReference: 'finding-1',
      fingerprint: 'rule|HTTP_CLIENT_ERROR',
      category: 'technical',
      severity: 'high',
      title: 'Page [docs] (legacy) #1 | `status`\n## injected heading',
      description:
        'The main document returned a client-error response with <literal> text.\n# This line is content, not a report section.',
      suggestedCheck: null,
      occurrences: [
        {
          occurrenceReference: 'occurrence-1',
          pageUrl: 'https://example.com/missing_(draft)?functional-page-token=retained',
          pageTitle: 'Missing [docs] (draft) | details',
          target: null,
          evidence: [
            {
              evidenceReference: 'evidence-1',
              source: 'deterministic-rule',
              kind: 'rule-observation',
              relation: 'supports',
              verificationCapable: true,
              summary:
                'The main document returned HTTP 404 with `status` | [details] (synthetic).\n# Evidence continuation.'
            }
          ],
          verification: {
            state: 'verified',
            reason: 'Deterministic evidence supports the exact assertion | with `detail`.',
            evidenceReferences: ['evidence-1']
          },
          screenshotReferences: [],
          redundantInvestigationSkipped: false
        }
      ],
      verification: {
        state: 'verified',
        reason: 'At least one occurrence was deterministically verified.',
        evidenceReferences: ['evidence-1']
      }
    },
    {
      findingReference: 'finding-2',
      fingerprint: 'target|select-option|country|exampleland',
      category: 'content',
      severity: 'medium',
      title: 'Structured target finding',
      description: 'A model observation was tied to one exact option.',
      suggestedCheck: 'Review the source data.',
      occurrences: [
        {
          occurrenceReference: 'occurrence-2',
          pageUrl: 'https://example.com/form-b',
          pageTitle: 'Form B',
          target: {
            kind: 'select-option',
            controlLabel: 'Country',
            controlName: 'country',
            controlId: null,
            optionText: 'Exampleland'
          },
          evidence: [
            {
              evidenceReference: 'evidence-2b',
              source: 'model',
              kind: 'model-observation',
              relation: 'supports',
              verificationCapable: false,
              summary: 'Second encounter-order evidence item.'
            },
            {
              evidenceReference: 'evidence-2a',
              source: 'browser',
              kind: 'browser-observation',
              relation: 'inconclusive',
              verificationCapable: false,
              summary: 'First source label is intentionally not alphabetic.'
            }
          ],
          verification: {
            state: 'inconclusive',
            reason: 'The observation was not deterministically confirmed.',
            evidenceReferences: ['evidence-2b', 'evidence-2a']
          },
          screenshotReferences: [],
          redundantInvestigationSkipped: false
        },
        {
          occurrenceReference: 'occurrence-3',
          pageUrl: 'https://example.com/form-a',
          pageTitle: 'Form A',
          target: {
            kind: 'select-option',
            controlLabel: 'Country',
            controlName: 'country',
            controlId: null,
            optionText: 'Exampleland'
          },
          evidence: [
            {
              evidenceReference: 'evidence-3',
              source: 'model',
              kind: 'model-observation',
              relation: 'supports',
              verificationCapable: false,
              summary: 'A repeated structured observation.'
            }
          ],
          verification: {
            state: 'inconclusive',
            reason: 'The repeated observation was not reinvestigated.',
            evidenceReferences: ['evidence-3']
          },
          screenshotReferences: [],
          redundantInvestigationSkipped: true
        }
      ],
      verification: {
        state: 'inconclusive',
        reason: 'Only model observations are available.',
        evidenceReferences: ['evidence-2b', 'evidence-2a', 'evidence-3']
      }
    },
    {
      findingReference: 'finding-3',
      fingerprint: 'model|targetless|navigation|synthetic',
      category: 'navigation',
      severity: 'low',
      title: 'Targetless model-only finding',
      description: 'The observation has no structured target.',
      suggestedCheck: null,
      occurrences: [
        {
          occurrenceReference: 'occurrence-4',
          pageUrl: 'https://example.com/navigation',
          pageTitle: 'Navigation',
          target: null,
          evidence: [
            {
              evidenceReference: 'evidence-4',
              source: 'model',
              kind: 'model-observation',
              relation: 'supports',
              verificationCapable: false,
              summary: 'A targetless synthetic model observation.'
            }
          ],
          verification: {
            state: 'inconclusive',
            reason: 'No deterministic evidence was available.',
            evidenceReferences: ['evidence-4']
          },
          screenshotReferences: [],
          redundantInvestigationSkipped: false
        }
      ],
      verification: {
        state: 'inconclusive',
        reason: 'No deterministic evidence was available.',
        evidenceReferences: ['evidence-4']
      }
    }
  ];

  const report = buildSiteAgentReport({
    runId: 'passive-security-report-check',
    startedAt: new Date('2026-07-24T00:00:00.000Z'),
    finishedAt: new Date('2026-07-24T00:01:00.000Z'),
    site: {
      id: 'synthetic-stage-7-1',
      name: 'Synthetic Stage 7.1 report',
      startUrl: 'https://example.com/?functional-page-token=retained',
      allowedHosts: ['example.com'],
      maxPages: 1,
      maxAgentSteps: 0,
      maxExploratoryStepsPerPage: 0,
      allowFormSubmission: false
    },
    homepage: {
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      title: 'Synthetic',
      httpStatus: 200
    },
    outcome: {
      type: 'completed',
      summary: 'Synthetic Stage 7.1 report completed.'
    },
    inspectedPages: [],
    canonicalFindings: functionalFindings,
    passiveSecurity,
    findingMetrics: {
      knownFindingsSuppliedToAnalysisCount: 0,
      newCandidateFindingsCount: 0,
      redundantInvestigationsSkippedCount: 0
    }
  });

  const jsonReport = await writeJsonReport(report);

  const markdownReport = await writeMarkdownReport(report);

  const jsonText = await readFile(jsonReport.filePath, 'utf8');

  const markdown = await readFile(markdownReport.filePath, 'utf8');

  const parsed = JSON.parse(jsonText) as SiteAgentReport;

  assert.equal(parsed.reportSchemaVersion, '3');

  assert.deepEqual(parsed.findings, functionalFindings);

  assert.equal(parsed.summary.highestSeverity, 'high');

  assert.deepEqual(
    parsed.findings.map(finding => [
      finding.category,
      finding.severity,
      finding.occurrences.length
    ]),
    [
      ['technical', 'high', 1],
      ['content', 'medium', 2],
      ['navigation', 'low', 1]
    ]
  );

  assert.equal(parsed.summary.logicalFindingsCount, 3);

  assert.equal(parsed.summary.findingOccurrencesCount, 4);

  assert.equal(
    parsed.findings.some(finding => finding.fingerprint.startsWith('https://example.com|PS_')),
    false
  );

  assert.equal(
    parsed.passiveSecurity.observations.some(
      observation => observation.fingerprint === 'rule|HTTP_CLIENT_ERROR'
    ),
    false
  );

  assert.equal(parsed.findings[0].verification.state, 'verified');

  assert.deepEqual(
    parsed.findings.map(finding => finding.findingReference),
    ['finding-1', 'finding-2', 'finding-3']
  );

  assert.deepEqual(
    parsed.findings[1].occurrences.map(occurrence => occurrence.occurrenceReference),
    ['occurrence-2', 'occurrence-3']
  );

  assert.deepEqual(
    parsed.findings[1].occurrences[0].evidence.map(evidence => evidence.evidenceReference),
    ['evidence-2b', 'evidence-2a']
  );

  assert.equal(
    parsed.passiveSecurity.summary.observationsCount,
    passiveSecurity.observations.length
  );

  assert.equal(
    parsed.passiveSecurity.observations.find(
      observation => observation.code === 'PS_HSTS_NOT_OBSERVED'
    )?.occurrences.length,
    2
  );

  assert.match(markdown, /## Security observations/);

  assert.match(markdown, /did not perform penetration testing or active vulnerability probing/);

  assert.match(
    markdown,
    /\| \[S01\]\(#security-s01\) \| \[HSTS response header was not observed\]\(#security-s01\) \| Low \| 2 pages \|/
  );

  assert.match(markdown, /### S01 — HSTS response header was not observed/);

  assert.match(
    markdown,
    /\[Security evidence file\]\(evidence\/S01-HSTS-RESPONSE-HEADER-WAS-NOT-OBSERVED-evidence\.txt\)/
  );

  assert.match(markdown, /\*\*Low · Security observation · 2 pages\*\*/);

  assert.match(markdown, /\*\*High · Confirmed issue\*\*/);

  assert.equal(markdown.includes('\n## injected heading'), false);

  assert.equal(markdown.includes('\n# This line is content'), false);

  assert.equal(markdown.includes('\n# Evidence continuation'), false);

  assert.match(markdown, /Values: fixture`server \| \[edge\]\./);

  assert.match(
    markdown,
    /\[\/missing_\(draft\)\?functional-page-token=retained\]\(https:\/\/example\.com\/missing_%28draft%29\?functional-page-token=retained\)/
  );

  assert.equal(markdown.includes('undefined'), false);

  assert.equal(markdown.includes('**Recommended next step:** null'), false);

  assert.equal(jsonText.includes('functional-page-token=retained'), true);

  assert.equal(/verified vulnerability/i.test(markdown), false);

  for (const observation of parsed.passiveSecurity.observations) {
    assert.match(markdown, new RegExp(observation.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.equal(
      markdown.includes(observation.code),
      false,
      'Human Markdown must not expose internal security codes.'
    );

    assert.equal(
      markdown.includes(observation.observationReference),
      false,
      'Human Markdown must not expose internal security references.'
    );
  }

  for (const forbiddenValue of [
    'Set-Cookie',
    'super-secret-cookie',
    'Authorization',
    'Bearer ',
    ...passiveHeaderSecrets
  ]) {
    assert.equal(jsonText.includes(forbiddenValue), false);

    assert.equal(markdown.includes(forbiddenValue), false);
  }

  console.log(
    'Stage 7.1 JSON/Markdown separation, aggregation, provenance, and functional-regression report checks passed.'
  );
}

main().catch(error => {
  console.error('Stage 7.1 report checks failed.');
  console.error(error);
  process.exitCode = 1;
});
