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

export interface SelectedNavigationTarget {
  link: NavigationLink;
  reason: string;
}

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
  selection: SelectedNavigationTarget;

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
   * Full page-by-page observations and findings.
   *
   * These remain the source of truth for everything
   * the agent observed on each individual page.
   */
  inspectedPages:
    InspectedPageResult[];

  /*
   * Deterministically grouped exploratory findings
   * representing the site-wide QA view.
   *
   * The original page-level findings are not removed.
   */
  siteWideExploratoryFindings:
    SiteWideExploratoryFinding[];

  summary: {
    pagesInspected: number;

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
