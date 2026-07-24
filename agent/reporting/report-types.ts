import type {
  ClassifiedDiagnostics
} from '../analysis/classify-diagnostics';

import type {
  PageFinding
} from '../analysis/evaluate-page';

import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';

import type {
  PageDiagnostics
} from '../browser/collect-page-diagnostics';

import type {
  NavigationLink
} from '../browser/inspect-navigation';

import type {
  VisitedPageObservation
} from '../browser/visit-approved-link';

import type {
  FindingInvestigationOutcome
} from '../investigation/evaluate-finding-investigation-outcome';
import type {
  PageCandidateReference
} from '../investigation/page-candidates';
import type {
  KnownFindingOccurrence
} from '../investigation/known-findings';

import type {
  InspectedPageNovelty
} from '../exploration/page-novelty';
import type {
  NavigationBudgetContext,
  NavigationPolicyBand,
  RouteValueClassCounts,
  RouteValueReasonCounts
} from '../exploration/navigation-policy';
import type {
  RouteValueClass,
  RouteValueReason
} from '../exploration/route-value';
import type {
  UnifiedFinding
} from '../findings/finding-model';

import type {
  ExploratoryLoopResult
} from '../planning/run-exploratory-loop';

import type {
  SiteWideExploratoryFinding
} from './build-site-wide-exploratory-findings';

export interface HomepageObservation {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  httpStatus: number | null;
}

export interface NavigationSelectionAudit {
  traversalDepth: number;
  requestedUrl: string;
  policyBand:
    | 'start-page'
    | NavigationPolicyBand;
  valueClass:
    RouteValueClass | null;
  valueReasons:
    RouteValueReason[];
  eligibleValueClassCounts:
    RouteValueClassCounts | null;
  deferredValueReasonCounts:
    RouteValueReasonCounts;
  predictedAreaKey: string;
  predictedRouteFamilyKey: string;
  firstDiscoveredFromUrl: string | null;
  minimumDepthDiscoveredFromUrl: string | null;
  budgetAtDecision: NavigationBudgetContext | null;
}

export interface SelectedNavigationTarget {
  type: 'agent-navigation';
  link: NavigationLink;
  reason: string;
  navigationAudit?:
    NavigationSelectionAudit;
}

export interface StartUrlInspectionTarget {
  type: 'start-url';
  url: string;
  navigationAudit?:
    NavigationSelectionAudit;
}

export type PageInspectionSelection =
  | StartUrlInspectionTarget
  | SelectedNavigationTarget;

/**
 * Connects one original exploratory QA candidate finding
 * with the deterministic conclusion produced from its
 * investigation evidence.
 *
 * Keeping the finding and outcome together avoids relying
 * on array positions and makes the result suitable for
 * CLI, JSON, desktop, and web presentation layers.
 */
export interface ExploratoryFindingResult {
  candidateReference:
    PageCandidateReference;

  finding:
    ExploratoryQaFinding;

  outcome:
    FindingInvestigationOutcome;
}

export interface InspectedPageResult {
  selection: PageInspectionSelection;

  observation: VisitedPageObservation;

  /*
   * Run-local predicted and observed page identities used
   * to make page-type diversity decisions auditable.
   */
  pageNovelty: InspectedPageNovelty;

  /*
   * Raw browser evidence exactly as it was collected.
   */
  diagnostics: PageDiagnostics;

  /*
   * The same evidence after generic QA classification.
   * Nothing is deleted from the raw diagnostics.
   */
  classifiedDiagnostics: ClassifiedDiagnostics;

  /*
   * Screenshot evidence is captured only when the page
   * has something potentially worth investigating.
   */
  screenshotPath: string | null;

  /*
   * Deterministic findings produced by explicit rules.
   */
  findings: PageFinding[];

  /*
   * Evidence-grounded candidate findings produced
   * by Gemini exploratory QA analysis.
   */
  exploratoryQaAnalysis: ExploratoryQaAnalysis;

  /*
   * The bounded autonomous investigation performed
   * after exploratory QA analysis.
   *
   * This records the planner decisions, approved actions,
   * execution results, and before/after observations.
   *
   * Null means that no autonomous investigation was run
   * for this page.
   */
  exploratoryInvestigation:
    ExploratoryLoopResult | null;

  /*
   * Candidate findings paired with their deterministic
   * investigation conclusions.
   *
   * Every exploratory candidate receives a result.
   *
   * When no conclusive investigation evidence exists,
   * the outcome is "inconclusive" rather than silently
   * treating the candidate as disproven.
   */
  exploratoryFindingResults:
    ExploratoryFindingResult[];

  /*
   * Occurrences reconciled to findings already known earlier
   * in this run.
   *
   * These do not receive page-local candidate references
   * unless an unresolved known finding is deliberately
   * reinvestigated.
   */
  knownFindingOccurrences:
    KnownFindingOccurrence[];
}

export interface AgentRunOutcome {
  type:
    | 'completed'
    | 'finished';

  summary: string;
}

export interface SiteAgentReport {
  reportSchemaVersion:
    '2';

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
  inspectedPages:
    InspectedPageResult[];

  /*
   * Canonical run-level findings.
   *
   * This is the sole authoritative finding collection for report consumers.
   * Raw per-page fields remain exhaustive execution detail.
   */
  findings:
    UnifiedFinding[];

  /*
   * Stage 3 compatibility projection generated from `findings`.
   * It is not an independent source of truth.
   */
  siteWideExploratoryFindings:
    SiteWideExploratoryFinding[];

  summary: {
    pagesInspected: number;

    logicalFindingsCount:
      number;

    findingOccurrencesCount:
      number;

    findingsCount: number;

    highestSeverity:
      | 'high'
      | 'medium'
      | 'low'
      | 'none';

    /*
     * Total number of original exploratory findings,
     * including repeated occurrences across pages.
     */
    exploratoryQaFindingsCount: number;

    /*
     * Number of unique site-wide exploratory findings
     * after deterministic deduplication.
     */
    siteWideExploratoryFindingsCount:
      number;

    /*
     * Occurrences reconciled to findings discovered earlier
     * in the same run.
     */
    knownFindingOccurrencesCount:
      number;

    /*
     * Total compact known-finding entries supplied across all
     * page-analysis calls.
     */
    knownFindingsSuppliedToAnalysisCount:
      number;

    /*
     * Findings that remained genuinely new after runtime
     * fingerprint reconciliation.
     */
    newCandidateFindingsCount:
      number;

    redundantInvestigationsSkippedCount:
      number;

    highestExploratoryQaSeverity:
      | 'high'
      | 'medium'
      | 'low'
      | 'none';

    actionableDiagnosticsCount: number;

    diagnosticsNeedingReviewCount: number;

    ignoredDiagnosticNoiseCount: number;
  };
}
