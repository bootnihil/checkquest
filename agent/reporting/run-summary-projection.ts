import type { UnifiedFinding } from '../findings/finding-model';
import { exploratoryQaFindingSchema } from '../analysis/exploratory-qa-schema';
import { createTechnicalObservationFingerprint } from '../analysis/technical-observation-reconciliation';
import type { SiteAgentReport } from './report-types';

export interface ReconciledRunSummaryProjection {
  inspectedPageCount: number;
  confirmedFindingCount: number;
  reviewFindingCount: number;
  technicalObservationCount: number;
  securityObservationCount: number;
  primaryFindingCount: number;
}

export function hasRuntimeTechnicalGrounding(finding: UnifiedFinding): boolean {
  if (finding.category !== 'technical') {
    return false;
  }

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.source === 'deterministic-rule') {
        return true;
      }

      if (evidence.source === 'browser' && evidence.kind === 'browser-observation') {
        return true;
      }

      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);
      const technicalIdentity = parsed.success ? (parsed.data.technicalIdentity ?? null) : null;

      if (
        technicalIdentity !== null &&
        finding.fingerprint === createTechnicalObservationFingerprint(technicalIdentity)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function isPrimaryHumanFinding(finding: UnifiedFinding): boolean {
  return (
    finding.verification.state !== 'not-verified' &&
    (finding.category !== 'technical' ||
      finding.verification.state === 'verified' ||
      !hasRuntimeTechnicalGrounding(finding))
  );
}

export function isHumanTechnicalObservation(finding: UnifiedFinding): boolean {
  return (
    finding.category === 'technical' &&
    finding.verification.state === 'inconclusive' &&
    hasRuntimeTechnicalGrounding(finding)
  );
}

/**
 * The single logical-count projection shared by run events and the human
 * report. Occurrences and affected pages never inflate item counts.
 */
export function buildReconciledRunSummaryProjection(
  report: SiteAgentReport
): ReconciledRunSummaryProjection {
  const primaryFindings = report.findings.filter(isPrimaryHumanFinding);
  const technicalObservations = report.findings.filter(isHumanTechnicalObservation);

  return {
    inspectedPageCount: report.inspectedPages.length,
    confirmedFindingCount: primaryFindings.filter(
      finding => finding.verification.state === 'verified'
    ).length,
    reviewFindingCount: primaryFindings.filter(
      finding => finding.verification.state === 'inconclusive'
    ).length,
    technicalObservationCount: technicalObservations.length,
    securityObservationCount: report.passiveSecurity.observations.length,
    primaryFindingCount: primaryFindings.length
  };
}
