import type { ClassifiedDiagnostics } from '../analysis/classify-diagnostics';
import type { PageFinding } from '../analysis/evaluate-page';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding,
  FindingPresentationTarget
} from '../analysis/exploratory-qa-schema';
import type { PageDiagnostics } from '../browser/collect-page-diagnostics';
import type { NavigationLink } from '../browser/inspect-navigation';
import type { VisitedPageObservation } from '../browser/visit-approved-link';
import type {
  NavigationBudgetContext,
  NavigationPolicyBand,
  RouteValueClassCounts,
  RouteValueReasonCounts
} from '../exploration/navigation-policy';
import type { InspectedPageNovelty } from '../exploration/page-novelty';
import type { RouteValueClass, RouteValueReason } from '../exploration/route-value';
import type { FindingInvestigationOutcome } from '../investigation/evaluate-finding-investigation-outcome';
import type { KnownFindingOccurrence } from '../investigation/known-findings';
import type { PageCandidateReference } from '../investigation/page-candidates';
import type { ExploratoryLoopResult } from '../planning/run-exploratory-loop';

/* Runtime inspection result embedded unchanged in the final report. */
export interface NavigationSelectionAudit {
  traversalDepth: number;
  requestedUrl: string;
  policyBand: 'start-page' | NavigationPolicyBand;
  valueClass: RouteValueClass | null;
  valueReasons: RouteValueReason[];
  eligibleValueClassCounts: RouteValueClassCounts | null;
  deferredValueReasonCounts: RouteValueReasonCounts;
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
  navigationAudit?: NavigationSelectionAudit;
}

export interface StartUrlInspectionTarget {
  type: 'start-url';
  url: string;
  navigationAudit?: NavigationSelectionAudit;
}

export type PageInspectionSelection = StartUrlInspectionTarget | SelectedNavigationTarget;

export interface ExploratoryFindingResult {
  candidateReference: PageCandidateReference;
  finding: ExploratoryQaFinding;
  outcome: FindingInvestigationOutcome;
}

export interface FindingPresentationEvidence {
  candidateReference: PageCandidateReference;
  pageNumber: number;
  pageUrl: string;
  target: FindingPresentationTarget | ExploratoryQaFinding['evidenceTarget'];
  screenshotPaths: string[];
  totalTargetCount: number;
  shownTargetCount: number;
  replay?: {
    action: 'select-option';
    restored: boolean;
  } | null;
}

export interface InspectedPageResult {
  selection: PageInspectionSelection;
  observation: VisitedPageObservation;
  pageNovelty: InspectedPageNovelty;
  diagnostics: PageDiagnostics;
  classifiedDiagnostics: ClassifiedDiagnostics;
  screenshotPath: string | null;
  presentationEvidence?: FindingPresentationEvidence[];
  findings: PageFinding[];
  exploratoryQaAnalysis: ExploratoryQaAnalysis;
  exploratoryInvestigation: ExploratoryLoopResult | null;
  exploratoryFindingResults: ExploratoryFindingResult[];
  knownFindingOccurrences: KnownFindingOccurrence[];
}
