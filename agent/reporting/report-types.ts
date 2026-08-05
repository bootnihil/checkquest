import type { AgentRunOutcome, HomepageObservation } from '../exploration/site-exploration-result';
import type { UnifiedFinding } from '../findings/finding-model';
import type { InspectedPageResult } from '../inspection/inspected-page-result';
import type { PassiveSecurityReport } from '../security/passive-security-model';
import type { SiteWideExploratoryFinding } from './build-site-wide-exploratory-findings';

export interface SiteAgentReport {
  reportSchemaVersion: '3';

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
