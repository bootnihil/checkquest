import type { Page, Response } from '@playwright/test';

import type { GeminiRequestEvent } from '../ai/run-gemini-request';
import type { PageDiagnosticsCollector } from '../browser/collect-page-diagnostics';
import type { SiteConfig } from '../config/site-config';
import type { chooseNavigationLink } from '../decisions/choose-navigation-link';
import { throwIfRunCancelled } from '../errors/run-cancellation';
import { createSafeDisplayUrl } from '../errors/safe-display-url';
import type { UnifiedFinding } from '../findings/finding-model';
import { createRunFindingLifecycle, getRunFindings } from '../findings/run-finding-lifecycle';
import {
  inspectPage,
  type InspectPageDependencies,
  type InspectPageResult,
  type OpenPageInspectionInput
} from '../inspection/inspect-page';
import type { planNextAction } from '../planning/plan-next-action';
import type { SiteRunFindingMetrics } from '../reporting/build-site-agent-report';
import type {
  AgentRunOutcome,
  HomepageObservation,
  InspectedPageResult
} from '../reporting/report-types';
import type { RunEventEmitter } from '../run/run-event';
import { captureMainDocumentSecurity } from '../security/capture-main-document-security';
import type { PassiveSecurityReport } from '../security/passive-security-model';
import {
  createPassiveSecurityRegistry,
  getPassiveSecurityReport
} from '../security/passive-security-registry';
import { createNavigationFrontier, type NavigationFrontier } from './navigation-policy';
import { createPageNoveltyState, predictPageIdentity } from './page-novelty';
import { runPageInspectionSequence } from './run-page-inspection-sequence';
import { selectNextPageForInspection, type ExplorationStopOutcome } from './select-next-page';
import {
  createNavigationUrlState,
  markNavigationUrlAttempted,
  recordNavigationResolution
} from './visited-links';

export interface SiteExplorationDependencies {
  analyzePageForQa?: NonNullable<InspectPageDependencies['analyzePageForQa']>;
  planNextAction?: typeof planNextAction;
  chooseNavigationLink?: typeof chooseNavigationLink;
}

export interface RunSiteExplorationInput {
  page: Page;
  site: SiteConfig;
  runId: string;
  homepage: HomepageObservation;
  homepageResponse: Response | null;
  diagnosticsCollector: PageDiagnosticsCollector;
  dependencies?: SiteExplorationDependencies;
  geminiApiKey?: string;
  model?: string;
  signal?: AbortSignal;
  onModelRequestEvent?: (event: GeminiRequestEvent) => void;
  emit: RunEventEmitter;
}

export interface CompletedSiteExploration {
  outcome: AgentRunOutcome;
  inspectedPages: InspectedPageResult[];
  canonicalFindings: UnifiedFinding[];
  passiveSecurity: PassiveSecurityReport;
  findingMetrics: SiteRunFindingMetrics;
}

interface SiteExplorationState {
  navigationFrontier: NavigationFrontier;
  navigationUrlState: ReturnType<typeof createNavigationUrlState>;
  pageNoveltyState: ReturnType<typeof createPageNoveltyState>;
  passiveSecurityRegistry: ReturnType<typeof createPassiveSecurityRegistry>;
  findingLifecycle: ReturnType<typeof createRunFindingLifecycle>;
}

function aggregateFindingMetrics(pageExecutions: InspectPageResult[]): SiteRunFindingMetrics {
  return pageExecutions.reduce<SiteRunFindingMetrics>(
    (totals, execution) => ({
      knownFindingsSuppliedToAnalysisCount:
        totals.knownFindingsSuppliedToAnalysisCount +
        execution.findingMetrics.knownFindingsSuppliedToAnalysisCount,
      newCandidateFindingsCount:
        totals.newCandidateFindingsCount + execution.findingMetrics.newCandidateFindingsCount,
      redundantInvestigationsSkippedCount:
        totals.redundantInvestigationsSkippedCount +
        execution.findingMetrics.redundantInvestigationsSkippedCount
    }),
    {
      knownFindingsSuppliedToAnalysisCount: 0,
      newCandidateFindingsCount: 0,
      redundantInvestigationsSkippedCount: 0
    }
  );
}

function completeExplorationOutcome(
  outcome: ExplorationStopOutcome | null,
  inspectedPageCount: number,
  navigationStepsUsed: number,
  site: SiteConfig
): AgentRunOutcome {
  if (outcome !== null) {
    return outcome;
  }

  if (inspectedPageCount >= site.maxPages) {
    return {
      type: 'completed',
      summary: `Reached the configured page limit of ${site.maxPages}.`
    };
  }

  if (navigationStepsUsed >= site.maxAgentSteps) {
    return {
      type: 'completed',
      summary: `Reached the configured navigation-step limit of ${site.maxAgentSteps}.`
    };
  }

  return {
    type: 'completed',
    summary: 'Exploration completed successfully.'
  };
}

async function inspectExplorationPage(
  input: RunSiteExplorationInput,
  currentPage: OpenPageInspectionInput,
  pageIndex: number,
  state: SiteExplorationState
): Promise<InspectPageResult> {
  const pageNumber = pageIndex + 1;

  throwIfRunCancelled(input.signal, input.runId, 'page-inspection');

  input.emit({
    type: 'inspection-started',
    message: `Page ${pageNumber} inspection started.`,
    pageNumber,
    url: createSafeDisplayUrl(currentPage.observation.finalUrl)
  });

  const result = await inspectPage({
    page: input.page,
    site: input.site,
    runId: input.runId,
    pageIndex,
    currentPage,
    diagnosticsCollector: input.diagnosticsCollector,
    navigationFrontier: state.navigationFrontier,
    navigationUrlState: state.navigationUrlState,
    pageNoveltyState: state.pageNoveltyState,
    passiveSecurityRegistry: state.passiveSecurityRegistry,
    findingLifecycle: state.findingLifecycle,
    dependencies: {
      analyzePageForQa: input.dependencies?.analyzePageForQa,
      planNextAction: input.dependencies?.planNextAction,
      geminiApiKey: input.geminiApiKey,
      model: input.model,
      signal: input.signal,
      onModelRequestEvent: input.onModelRequestEvent
    }
  });

  throwIfRunCancelled(input.signal, input.runId, 'page-inspection');

  const { pageResult } = result;

  if (pageResult.exploratoryInvestigation !== null) {
    for (const findingResult of pageResult.exploratoryFindingResults) {
      input.emit({
        type: 'investigation-completed',
        message: `Candidate ${findingResult.candidateReference} investigation completed.`,
        pageNumber,
        candidateReference: findingResult.candidateReference,
        status: findingResult.outcome.status,
        stepsUsed: pageResult.exploratoryInvestigation.plannerDecisionCount
      });
    }
  }

  input.emit({
    type: 'inspection-completed',
    message: `Page ${pageNumber} inspection completed.`,
    pageNumber,
    url: createSafeDisplayUrl(pageResult.observation.finalUrl),
    findingCount:
      pageResult.findings.length +
      pageResult.exploratoryFindingResults.length +
      pageResult.knownFindingOccurrences.length,
    diagnosticCount:
      pageResult.diagnostics.consoleErrors.length + pageResult.diagnostics.failedRequests.length
  });

  return result;
}

export async function runSiteExploration(
  input: RunSiteExplorationInput
): Promise<CompletedSiteExploration> {
  const navigationUrlState = createNavigationUrlState();
  markNavigationUrlAttempted(navigationUrlState, input.homepage.requestedUrl);
  recordNavigationResolution(
    navigationUrlState,
    input.homepage.requestedUrl,
    input.homepage.finalUrl
  );

  const state = {
    navigationFrontier: createNavigationFrontier(),
    navigationUrlState,
    pageNoveltyState: createPageNoveltyState(),
    passiveSecurityRegistry: createPassiveSecurityRegistry(),
    findingLifecycle: createRunFindingLifecycle()
  };
  let navigationStepsUsed = 0;
  let outcome: ExplorationStopOutcome | null = null;

  const startPageObservation: InspectedPageResult['observation'] = {
    ...input.homepage,
    headings: (await input.page.locator('h1, h2').allTextContents())
      .map(heading => heading.replace(/\s+/g, ' ').trim())
      .filter(heading => heading.length > 0)
      .slice(0, 10)
  };
  const startPagePassiveSecuritySnapshot = await captureMainDocumentSecurity({
    response: input.homepageResponse,
    requestedUrl: input.homepage.requestedUrl,
    finalUrl: input.homepage.finalUrl,
    pageTitle: input.homepage.title
  });
  const predictedStartIdentity = predictPageIdentity(input.homepage.finalUrl);

  const pageExecutions = await runPageInspectionSequence<
    OpenPageInspectionInput,
    InspectPageResult
  >({
    startPage: {
      selection: {
        type: 'start-url',
        url: input.site.startUrl,
        navigationAudit: {
          traversalDepth: 0,
          requestedUrl: input.site.startUrl,
          policyBand: 'start-page',
          valueClass: null,
          valueReasons: [],
          eligibleValueClassCounts: null,
          deferredValueReasonCounts: {},
          predictedAreaKey: predictedStartIdentity.areaKey,
          predictedRouteFamilyKey: predictedStartIdentity.routeFamilyKey,
          firstDiscoveredFromUrl: null,
          minimumDepthDiscoveredFromUrl: null,
          budgetAtDecision: null
        }
      },
      observation: startPageObservation,
      passiveSecuritySnapshot: startPagePassiveSecuritySnapshot,
      traversalDepth: 0
    },
    maxPages: input.site.maxPages,
    inspectPage: (currentPage, pageIndex) =>
      inspectExplorationPage(input, currentPage, pageIndex, state),
    getNextPage: async completedPages => {
      const nextPage = await selectNextPageForInspection({
        page: input.page,
        site: input.site,
        runId: input.runId,
        completedPageCount: completedPages.length,
        navigationStepsUsed,
        navigationFrontier: state.navigationFrontier,
        navigationUrlState: state.navigationUrlState,
        pageNoveltyState: state.pageNoveltyState,
        diagnosticsCollector: input.diagnosticsCollector,
        chooseNavigationLink: input.dependencies?.chooseNavigationLink,
        geminiApiKey: input.geminiApiKey,
        model: input.model,
        signal: input.signal,
        onModelRequestEvent: input.onModelRequestEvent,
        emit: input.emit
      });

      navigationStepsUsed = nextPage.navigationStepsUsed;

      if (nextPage.type === 'exploration-stopped') {
        outcome = nextPage.outcome;
        return null;
      }

      return nextPage.page;
    }
  });

  const inspectedPages = pageExecutions.map(execution => execution.pageResult);

  return {
    outcome: completeExplorationOutcome(
      outcome,
      inspectedPages.length,
      navigationStepsUsed,
      input.site
    ),
    inspectedPages,
    canonicalFindings: getRunFindings(state.findingLifecycle),
    passiveSecurity: getPassiveSecurityReport(state.passiveSecurityRegistry),
    findingMetrics: aggregateFindingMetrics(pageExecutions)
  };
}
