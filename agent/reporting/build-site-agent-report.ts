import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import type { SiteConfig } from '../config/site-config';
import type { AgentRunOutcome, HomepageObservation } from '../exploration/site-exploration-result';
import type { UnifiedFinding } from '../findings/finding-model';
import type { InspectedPageResult } from '../inspection/inspected-page-result';
import type { PassiveSecurityReport } from '../security/passive-security-model';
import { buildSiteWideExploratoryFindings } from './build-site-wide-exploratory-findings';
import { getHighestSeverity } from './report-utils';
import type { SiteAgentReport } from './report-types';

export interface SiteRunFindingMetrics {
  knownFindingsSuppliedToAnalysisCount: number;
  newCandidateFindingsCount: number;
  redundantInvestigationsSkippedCount: number;
}

export interface BuildSiteAgentReportInput {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  site: SiteConfig;
  homepage: HomepageObservation;
  outcome: AgentRunOutcome;
  inspectedPages: InspectedPageResult[];
  canonicalFindings: UnifiedFinding[];
  passiveSecurity: PassiveSecurityReport;
  findingMetrics: SiteRunFindingMetrics;
}

function getHighestExploratoryQaSeverity(
  findings: ExploratoryQaFinding[]
): 'high' | 'medium' | 'low' | 'none' {
  if (findings.some(finding => finding.severity === 'high')) {
    return 'high';
  }

  if (findings.some(finding => finding.severity === 'medium')) {
    return 'medium';
  }

  if (findings.some(finding => finding.severity === 'low')) {
    return 'low';
  }

  return 'none';
}

export function buildSiteAgentReport(input: BuildSiteAgentReportInput): SiteAgentReport {
  const allFindings = input.inspectedPages.flatMap(pageResult => pageResult.findings);

  const allExploratoryQaFindings = input.inspectedPages.flatMap(
    pageResult => pageResult.exploratoryQaAnalysis.findings
  );

  const siteWideExploratoryFindings = buildSiteWideExploratoryFindings(
    input.canonicalFindings,
    input.inspectedPages.map(pageResult => pageResult.observation.finalUrl)
  );

  const allKnownFindingOccurrences = input.inspectedPages.flatMap(
    pageResult => pageResult.knownFindingOccurrences
  );

  const allClassifiedFailedRequests = input.inspectedPages.flatMap(
    pageResult => pageResult.classifiedDiagnostics.failedRequests
  );

  const actionableDiagnosticsCount = allClassifiedFailedRequests.filter(
    item => item.disposition === 'actionable'
  ).length;

  const diagnosticsNeedingReviewCount = allClassifiedFailedRequests.filter(
    item => item.disposition === 'needs-review'
  ).length;

  const ignoredDiagnosticNoiseCount = allClassifiedFailedRequests.filter(
    item => item.disposition === 'ignored-noise'
  ).length;

  return {
    reportSchemaVersion: '3',

    runId: input.runId,

    startedAt: input.startedAt.toISOString(),

    finishedAt: input.finishedAt.toISOString(),

    site: {
      id: input.site.id,

      name: input.site.name,

      startUrl: input.site.startUrl
    },

    homepage: input.homepage,

    outcome: input.outcome,

    inspectedPages: input.inspectedPages,

    findings: input.canonicalFindings,

    siteWideExploratoryFindings,

    passiveSecurity: input.passiveSecurity,

    summary: {
      pagesInspected: input.inspectedPages.length,

      logicalFindingsCount: input.canonicalFindings.length,

      findingOccurrencesCount: input.canonicalFindings.reduce(
        (total, finding) => total + finding.occurrences.length,
        0
      ),

      findingsCount: allFindings.length,

      highestSeverity: getHighestSeverity(input.canonicalFindings),

      exploratoryQaFindingsCount: siteWideExploratoryFindings.reduce(
        (total, finding) => total + finding.occurrenceCount,
        0
      ),

      siteWideExploratoryFindingsCount: siteWideExploratoryFindings.length,

      knownFindingOccurrencesCount: allKnownFindingOccurrences.length,

      knownFindingsSuppliedToAnalysisCount:
        input.findingMetrics.knownFindingsSuppliedToAnalysisCount,

      newCandidateFindingsCount: input.findingMetrics.newCandidateFindingsCount,

      redundantInvestigationsSkippedCount: input.findingMetrics.redundantInvestigationsSkippedCount,

      highestExploratoryQaSeverity: getHighestExploratoryQaSeverity(allExploratoryQaFindings),

      actionableDiagnosticsCount,

      diagnosticsNeedingReviewCount,

      ignoredDiagnosticNoiseCount
    }
  };
}
