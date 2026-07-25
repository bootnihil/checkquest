import type {
  Page
} from '@playwright/test';

import {
  analyzePageForQa
} from '../analysis/analyze-page-for-qa';
import {
  classifyDiagnostics
} from '../analysis/classify-diagnostics';
import {
  evaluatePageObservation
} from '../analysis/evaluate-page';
import {
  capturePageScreenshot
} from '../browser/capture-page-screenshot';
import type {
  PageDiagnosticsCollector
} from '../browser/collect-page-diagnostics';
import {
  extractPageContent
} from '../browser/extract-page-content';
import {
  inspectNavigation
} from '../browser/inspect-navigation';
import type {
  SiteConfig
} from '../config/site-config';
import {
  markFinalUrlInspected,
  type NavigationUrlState
} from '../exploration/visited-links';
import {
  predictPageIdentity,
  registerInspectedPageNovelty,
  type PageNoveltyState
} from '../exploration/page-novelty';
import {
  getNavigationFrontierEntries,
  registerDiscoveredNavigationLinks,
  type NavigationFrontier
} from '../exploration/navigation-policy';
import {
  evaluateFindingInvestigationOutcome
} from '../investigation/evaluate-finding-investigation-outcome';
import type {
  GeminiRequestEvent
} from '../ai/run-gemini-request';
import {
  commitRunPageFindings,
  prepareKnownFindingAnalysis,
  reconcileRunPageFindings,
  type RunFindingLifecycleState
} from '../findings/run-finding-lifecycle';
import {
  runExploratoryLoop
} from '../planning/run-exploratory-loop';
import type {
  InspectedPageResult
} from '../reporting/report-types';
import type {
  PassivePageSecuritySnapshot
} from '../security/passive-security-model';
import {
  registerPassiveSecuritySnapshot,
  type PassiveSecurityRegistry
} from '../security/passive-security-registry';

export interface OpenPageInspectionInput {
  selection:
    InspectedPageResult['selection'];

  observation:
    InspectedPageResult['observation'];

  passiveSecuritySnapshot:
    PassivePageSecuritySnapshot;

  traversalDepth:
    number;
}

export interface PageInspectionFindingMetrics {
  knownFindingsSuppliedToAnalysisCount:
    number;
  newCandidateFindingsCount:
    number;
  redundantInvestigationsSkippedCount:
    number;
}

export interface InspectPageDependencies {
  analyzePageForQa?:
    typeof analyzePageForQa;
  onModelRequestEvent?:
    (
      event:
        GeminiRequestEvent
    ) => void;
}

export interface InspectPageInput {
  page: Page;
  site: SiteConfig;
  runId: string;
  pageIndex: number;
  currentPage:
    OpenPageInspectionInput;
  diagnosticsCollector:
    PageDiagnosticsCollector;
  navigationFrontier:
    NavigationFrontier;
  navigationUrlState:
    NavigationUrlState;
  pageNoveltyState:
    PageNoveltyState;
  passiveSecurityRegistry:
    PassiveSecurityRegistry;
  findingLifecycle:
    RunFindingLifecycleState;
  dependencies?:
    InspectPageDependencies;
}

export interface InspectPageResult {
  pageResult:
    InspectedPageResult;
  findingMetrics:
    PageInspectionFindingMetrics;
}

export async function inspectPage(
  input:
    InspectPageInput
): Promise<InspectPageResult> {
  const {
    page,
    site,
    runId,
    pageIndex,
    currentPage,
    diagnosticsCollector,
    navigationFrontier,
    navigationUrlState,
    pageNoveltyState,
    passiveSecurityRegistry,
    findingLifecycle
  } = input;

  const {
    observation:
      pageObservation,
    passiveSecuritySnapshot,
    selection,
    traversalDepth
  } = currentPage;

  registerPassiveSecuritySnapshot(
    passiveSecurityRegistry,
    passiveSecuritySnapshot
  );

  await page.waitForTimeout(
    1_000
  );

  const diagnostics =
    diagnosticsCollector.snapshot();

  const classifiedDiagnostics =
    classifyDiagnostics(
      diagnostics
    );

  const actionableRequestCount =
    classifiedDiagnostics
      .failedRequests
      .filter(
        item =>
          item.disposition ===
          'actionable'
      )
      .length;

  const needsReviewCount =
    classifiedDiagnostics
      .failedRequests
      .filter(
        item =>
          item.disposition ===
          'needs-review'
      )
      .length;

  const findings =
    evaluatePageObservation(
      pageObservation
    );

  const pageContent =
    await extractPageContent(
      page
    );

  const discoveredLinks =
    await inspectNavigation(
      page,
      site.allowedHosts
    );

  const effectivePredictedIdentity =
    predictPageIdentity(
      pageObservation
        .finalUrl,
      [
        ...getNavigationFrontierEntries(
          navigationFrontier
        ).map(
          entry =>
            entry.link
        ),
        ...discoveredLinks
      ]
    );

  if (
    selection.type ===
      'start-url' &&
    selection
      .navigationAudit
  ) {
    selection
      .navigationAudit
      .predictedAreaKey =
        effectivePredictedIdentity
          .areaKey;

    selection
      .navigationAudit
      .predictedRouteFamilyKey =
        effectivePredictedIdentity
          .routeFamilyKey;
  }

  const pageNovelty =
    registerInspectedPageNovelty(
      pageNoveltyState,
      effectivePredictedIdentity,
      pageContent
    );

  const containsPasswordField =
    pageContent.textFields.some(
      field =>
        field.inputType ===
        'password'
    );

  const knownFindingPreparation =
    prepareKnownFindingAnalysis(
      findingLifecycle,
      pageContent
    );

  const {
    knownFindingContext
  } = knownFindingPreparation;

  const knownFindingsSuppliedToAnalysisCount =
    knownFindingContext.length;

  const rawExploratoryQaAnalysis =
    await (
      input
        .dependencies
        ?.analyzePageForQa ??
      analyzePageForQa
    )(
      {
        observation:
          pageObservation,

        content:
          pageContent,

        classifiedDiagnostics,

        ruleBasedFindings:
          findings,

        knownFindings:
          knownFindingContext
      },
      {
        onEvent:
          input
            .dependencies
            ?.onModelRequestEvent
      }
    );

  const pageFindingLifecycle =
    reconcileRunPageFindings(
      findingLifecycle,
      {
        pageUrl:

          pageObservation.finalUrl,
        pageTitle:
          pageObservation.title,
        ruleFindings:
          findings,
        rawExploratoryQaAnalysis,
        knownFindingPreparation
      }
    );

  const {
    exploratoryQaAnalysis,
    reconciledPageFindings,
    pageCandidates
  } = pageFindingLifecycle;

  const newCandidateFindingsCount =
    reconciledPageFindings
      .newFindings
      .length;

  const pageRedundantInvestigationsSkipped =
    reconciledPageFindings
      .knownOccurrenceDrafts
      .filter(
        draft =>
          draft
            .redundantInvestigationSkipped
      )
      .length;

  const redundantInvestigationsSkippedCount =
    pageRedundantInvestigationsSkipped;

  let exploratoryInvestigation:
    InspectedPageResult['exploratoryInvestigation'] =
      null;

  if (
    !containsPasswordField &&
    site.maxExploratoryStepsPerPage >
      0 &&
    pageCandidates.length >
      0
  ) {
    exploratoryInvestigation =
      await runExploratoryLoop(
        page,
        pageObservation.finalUrl,
        site.maxExploratoryStepsPerPage,
        pageCandidates,
        {
          onModelRequestEvent:
            input
              .dependencies
              ?.onModelRequestEvent
        }
      );

    const postInvestigationUrl =
      new URL(
        page.url()
      );

    if (
      !site.allowedHosts.includes(
        postInvestigationUrl.hostname
      )
    ) {
      throw new Error(
        `Autonomous investigation escaped to disallowed host "${postInvestigationUrl.hostname}".`
      );
    }
  }

  /*
   * Convert candidate findings plus collected investigation
   * evidence into deterministic finding outcomes.
   *
   * This is deliberately separate from Gemini reasoning.
   * The same structured result can later be consumed by the
   * CLI, Windows UI, SaaS UI, JSON, or Markdown.
   */
  const exploratoryFindingResults =
    pageCandidates.map(
      candidate => ({
        candidateReference:
          candidate.reference,

        finding:
          candidate.finding,

        outcome:
          evaluateFindingInvestigationOutcome(
            candidate,
            exploratoryInvestigation,
          )
      })
    );

  const investigationPerformedAction =

    exploratoryInvestigation
      ?.steps
      .some(
        step =>
          step.decision.action.kind !==
            'stop' &&
          step.executionResult.status ===
            'executed'
      ) ??
    false;

  const shouldCaptureScreenshot =
    findings.length >
      0 ||
    actionableRequestCount >
      0 ||
    needsReviewCount >
      0 ||
    exploratoryQaAnalysis
      .findings
      .length >
      0 ||
    reconciledPageFindings
      .knownOccurrenceDrafts
      .length >
      0 ||
    investigationPerformedAction;

  let screenshotPath:
    string | null =
      null;

  if (
    shouldCaptureScreenshot
  ) {
    const pageNumber =
      pageIndex + 1;

    const screenshot =
      await capturePageScreenshot(
        page,
        runId,
        pageNumber
      );

    screenshotPath =
      screenshot.filePath;
  }

  const knownFindingOccurrences =
    commitRunPageFindings(
      findingLifecycle,
      {
        page:
          pageFindingLifecycle,
        pageUrl:
          pageObservation.finalUrl,
        pageTitle:
          pageObservation.title,
        screenshotPath,
        exploratoryFindingResults
      }
    );

  registerDiscoveredNavigationLinks(
    navigationFrontier,
    discoveredLinks,
    pageObservation
      .finalUrl,
    traversalDepth
  );

  markFinalUrlInspected(
    navigationUrlState,
    pageObservation
      .finalUrl
  );

  const pageResult:
    InspectedPageResult = {
    selection,

    observation:
      pageObservation,

    pageNovelty,

    diagnostics,

    classifiedDiagnostics,

    screenshotPath,

    findings,

    exploratoryQaAnalysis,

    exploratoryInvestigation,

    exploratoryFindingResults,

    knownFindingOccurrences
  };

  return {
    pageResult,

    findingMetrics: {
      knownFindingsSuppliedToAnalysisCount,
      newCandidateFindingsCount,
      redundantInvestigationsSkippedCount
    }
  };
}
