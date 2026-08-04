import assert from 'node:assert/strict';

import { buildSiteAgentReport } from '../../agent/reporting/build-site-agent-report';
import { runSite } from '../../agent/run/run-site';
import { createEmptyPassiveSecurityReport } from '../../agent/security/passive-security-registry';

async function main(): Promise<void> {
  const report = buildSiteAgentReport({
    runId: 'site-agent-report-builder-check',
    startedAt: new Date('2026-07-24T00:00:00.000Z'),
    finishedAt: new Date('2026-07-24T00:01:00.000Z'),
    site: {
      id: 'synthetic',
      name: 'Synthetic site',
      startUrl: 'https://example.com/',
      allowedHosts: ['example.com'],
      maxPages: 1,
      maxAgentSteps: 1,
      maxExploratoryStepsPerPage: 0,
      allowFormSubmission: false
    },
    homepage: {
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      title: 'Synthetic homepage',
      httpStatus: 200
    },
    outcome: {
      type: 'completed',
      summary: 'Synthetic report assembly completed.'
    },
    inspectedPages: [],
    canonicalFindings: [],
    passiveSecurity: createEmptyPassiveSecurityReport(),
    findingMetrics: {
      knownFindingsSuppliedToAnalysisCount: 0,
      newCandidateFindingsCount: 0,
      redundantInvestigationsSkippedCount: 0
    }
  });

  assert.equal(report.reportSchemaVersion, '3');

  assert.equal(report.startedAt, '2026-07-24T00:00:00.000Z');

  assert.equal(report.finishedAt, '2026-07-24T00:01:00.000Z');

  assert.deepEqual(report.summary, {
    pagesInspected: 0,
    logicalFindingsCount: 0,
    findingOccurrencesCount: 0,
    findingsCount: 0,
    highestSeverity: 'none',
    exploratoryQaFindingsCount: 0,
    siteWideExploratoryFindingsCount: 0,
    knownFindingOccurrencesCount: 0,
    knownFindingsSuppliedToAnalysisCount: 0,
    newCandidateFindingsCount: 0,
    redundantInvestigationsSkippedCount: 0,
    highestExploratoryQaSeverity: 'none',
    actionableDiagnosticsCount: 0,
    diagnosticsNeedingReviewCount: 0,
    ignoredDiagnosticNoiseCount: 0
  });

  await assert.rejects(
    () =>
      runSite({
        runId: 'invalid-run-site-input',
        startedAt: new Date('2026-07-24T00:00:00.000Z'),
        site: {
          id: 'invalid-host',
          name: 'Invalid host',
          startUrl: 'https://example.com/',
          allowedHosts: ['different.example'],
          maxPages: 1,
          maxAgentSteps: 1,
          maxExploratoryStepsPerPage: 0,
          allowFormSubmission: false
        }
      }),
    /Configured start host "example\.com" is not allowed\./
  );

  console.log('Reusable run-site API and pure report assembly checks passed.');
}

main().catch((error: unknown) => {
  console.error('Reusable run-site API check failed.', error);

  process.exitCode = 1;
});
