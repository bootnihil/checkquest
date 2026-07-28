import type {
  UnifiedFinding
} from '../findings/finding-model';
import type {
  SiteAgentReport
} from './report-types';

export interface ReconciledRunSummaryProjection {
  inspectedPageCount:
    number;
  confirmedFindingCount:
    number;
  reviewFindingCount:
    number;
  technicalObservationCount:
    number;
  securityObservationCount:
    number;
  primaryFindingCount:
    number;
}

export function isPrimaryHumanFinding(
  finding:
    UnifiedFinding
): boolean {
  return (
    finding.verification.state !==
      'not-verified' &&
    (
      finding.category !==
        'technical' ||
      finding.verification.state ===
        'verified'
    )
  );
}

export function isHumanTechnicalObservation(
  finding:
    UnifiedFinding
): boolean {
  return (
    finding.category ===
      'technical' &&
    finding.verification.state ===
      'inconclusive'
  );
}

/**
 * The single logical-count projection shared by run events and the human
 * report. Occurrences and affected pages never inflate item counts.
 */
export function buildReconciledRunSummaryProjection(
  report:
    SiteAgentReport
): ReconciledRunSummaryProjection {
  const primaryFindings =
    report.findings.filter(
      isPrimaryHumanFinding
    );
  const technicalObservations =
    report.findings.filter(
      isHumanTechnicalObservation
    );

  return {
    inspectedPageCount:
      report.inspectedPages
        .length,
    confirmedFindingCount:
      primaryFindings.filter(
        finding =>
          finding.verification
            .state ===
          'verified'
      ).length,
    reviewFindingCount:
      primaryFindings.filter(
        finding =>
          finding.verification
            .state ===
          'inconclusive'
      ).length,
    technicalObservationCount:
      technicalObservations
        .length,
    securityObservationCount:
      report.passiveSecurity
        .observations
        .length,
    primaryFindingCount:
      primaryFindings.length
  };
}
