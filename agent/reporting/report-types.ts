import type { ClassifiedDiagnostics } from '../analysis/classify-diagnostics';
import type { PageFinding } from '../analysis/evaluate-page';
import type { PageDiagnostics } from '../browser/collect-page-diagnostics';
import type { NavigationLink } from '../browser/inspect-navigation';
import type { VisitedPageObservation } from '../browser/visit-approved-link';

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

export interface InspectedPageResult {
  selection: SelectedNavigationTarget;
  observation: VisitedPageObservation;

  /*
   * Raw browser evidence exactly as it was collected.
   */
  diagnostics: PageDiagnostics;

  /*
   * The same evidence after generic QA classification.
   * Nothing is deleted from the raw diagnostics.
   */
  classifiedDiagnostics: ClassifiedDiagnostics;

  findings: PageFinding[];
}

export interface AgentRunOutcome {
  type: 'completed' | 'finished';
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

  inspectedPages: InspectedPageResult[];

  summary: {
    pagesInspected: number;

    findingsCount: number;
    highestSeverity: 'high' | 'medium' | 'low' | 'none';

    actionableDiagnosticsCount: number;
    diagnosticsNeedingReviewCount: number;
    ignoredDiagnosticNoiseCount: number;
  };
}
