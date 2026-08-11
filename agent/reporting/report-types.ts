import type { AgentRunOutcome, HomepageObservation } from '../exploration/site-exploration-result';
import type { UnifiedFinding } from '../findings/finding-model';
import type { InspectedPageResult } from '../inspection/inspected-page-result';
import type { PassiveSecurityReport } from '../security/passive-security-model';
import type { SiteWideExploratoryFinding } from './build-site-wide-exploratory-findings';

export interface PersistedExploratoryHumanNarrative {
  findingReference: UnifiedFinding['findingReference'];
  plainTitle: string;
  plainCondition: string;
  impactStatement: string;
  whatToCheck: string;
}

interface SiteAgentReportBase {
  runId: string;
  startedAt: string;
  finishedAt: string;

  site: {
    id: string;
    name: string;
    startUrl: string;
  };

  homepage: HomepageObservation;

  outcome: AgentRunOutcome;

  /*
   * Full page-by-page execution detail.
   *
   * These retain raw observations, legacy compatibility fields, diagnostics,
   * and investigation transcripts. Canonical finding interpretation lives in
   * the run-level `findings` collection below.
   */
  inspectedPages: InspectedPageResult[];

  /*
   * Canonical run-level findings.
   *
   * This is the sole authoritative finding collection for report consumers.
   * Raw per-page fields remain exhaustive execution detail.
   */
  findings: UnifiedFinding[];

  /*
   * Stage 3 compatibility projection generated from `findings`.
   * It is not an independent source of truth.
   */
  siteWideExploratoryFindings: SiteWideExploratoryFinding[];

  /*
   * Dedicated deterministic passive-security posture.
   *
   * This collection is intentionally separate from functional findings,
   * verification, Gemini analysis, and autonomous investigation.
   */
  passiveSecurity: PassiveSecurityReport;

  summary: {
    pagesInspected: number;

    logicalFindingsCount: number;

    findingOccurrencesCount: number;

    findingsCount: number;

    highestSeverity: 'high' | 'medium' | 'low' | 'none';

    /*
     * Total number of original exploratory findings,
     * including repeated occurrences across pages.
     */
    exploratoryQaFindingsCount: number;

    /*
     * Number of unique site-wide exploratory findings
     * after deterministic deduplication.
     */
    siteWideExploratoryFindingsCount: number;

    /*
     * Occurrences reconciled to findings discovered earlier
     * in the same run.
     */
    knownFindingOccurrencesCount: number;

    /*
     * Total compact known-finding entries supplied across all
     * page-analysis calls.
     */
    knownFindingsSuppliedToAnalysisCount: number;

    /*
     * Findings that remained genuinely new after runtime
     * fingerprint reconciliation.
     */
    newCandidateFindingsCount: number;

    redundantInvestigationsSkippedCount: number;

    highestExploratoryQaSeverity: 'high' | 'medium' | 'low' | 'none';

    actionableDiagnosticsCount: number;

    diagnosticsNeedingReviewCount: number;

    ignoredDiagnosticNoiseCount: number;
  };
}

/*
 * Historical schema-v3 packages remain readable and are never migrated.
 * Schema v4 adds only report-owned prose for exploratory findings whose
 * wording cannot be reproduced deterministically from trusted report state.
 */
export interface SiteAgentReportV3 extends SiteAgentReportBase {
  reportSchemaVersion: '3';
}

export interface SiteAgentReportV4 extends SiteAgentReportBase {
  reportSchemaVersion: '4';
  humanNarratives: {
    state: 'pending' | 'complete';
    exploratory: PersistedExploratoryHumanNarrative[];
  };
}

export type SiteAgentReport = SiteAgentReportV3 | SiteAgentReportV4;
