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
import {
  isInvestigablePageCandidate
} from '../investigation/page-candidates';
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

  console.log(
    selection.type ===
      'start-url'
      ? '\nInspecting configured start page as page 1.'
      : '\nSelected page visited successfully:'
  );

  console.log(
    JSON.stringify(
      pageObservation,
      null,
      2
    )
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

  const ignoredNoiseCount =
    classifiedDiagnostics
      .failedRequests
      .filter(
        item =>
          item.disposition ===
          'ignored-noise'
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

  console.log(
    '\nBrowser diagnostics collected:'
  );

  console.log(
    `Console errors: ${diagnostics.consoleErrors.length}`
  );

  console.log(
    `Failed network requests: ${diagnostics.failedRequests.length}`
  );

  console.log(
    '\nDiagnostic classification:'
  );

  console.log(
    `Actionable failed requests: ${actionableRequestCount}`
  );

  console.log(
    `Needs review: ${needsReviewCount}`
  );

  console.log(
    `Ignored noise: ${ignoredNoiseCount}`
  );

  const findings =
    evaluatePageObservation(
      pageObservation
    );

  if (
    findings.length ===
    0
  ) {
    console.log(
      '\nDeterministic evaluation: no rule-based page health issues found.'
    );
  } else {
    console.log(
      `\nDeterministic evaluation: ${findings.length} potential issue(s) found.`
    );

    console.log(
      JSON.stringify(
        findings,
        null,
        2
      )
    );
  }

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

  console.log(
    '\nStructured page content extracted:'
  );

  console.log(
    `Headings: ${pageContent.headings.length}`
  );

  console.log(
    `Links: ${pageContent.links.length}`
  );

  console.log(
    `Buttons: ${pageContent.buttons.length}`
  );

  console.log(
    `Text fields: ${pageContent.textFields.length}`
  );

  console.log(
    `Select controls: ${pageContent.selects.length}`
  );

  console.log(
    `Body text characters: ${pageContent.bodyText.length}`
  );

  console.log(
    `Predicted area: ${pageNovelty.predictedIdentity.areaKey}`

  );

  console.log(
    `Predicted route family: ${pageNovelty.predictedIdentity.routeFamilyKey}`
  );

  console.log(
    `Observed template: ${pageNovelty.observedTemplateKey}`
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

  console.log(
    `Known findings supplied to analysis: ${knownFindingContext.length}`
  );

  const rawExploratoryQaAnalysis =
    await (
      input
        .dependencies
        ?.analyzePageForQa ??
      analyzePageForQa
    )({
      observation:
        pageObservation,

      content:
        pageContent,

      classifiedDiagnostics,

      ruleBasedFindings:
        findings,

      knownFindings:
        knownFindingContext
    });

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

  console.log(
    '\nExploratory QA analysis:'
  );

  console.log(
    `New candidate findings: ${reconciledPageFindings.newFindings.length}`
  );

  console.log(
    `Known finding occurrences: ${reconciledPageFindings.knownOccurrenceDrafts.length}`
  );

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

  console.log(
    `Redundant investigations skipped: ${pageRedundantInvestigationsSkipped}`
  );

  for (
    const draft of
      reconciledPageFindings
        .knownOccurrenceDrafts
  ) {
    if (
      draft
        .redundantInvestigationSkipped
    ) {
      console.log(
        `- ${draft.knownFindingReference}: known verified occurrence recorded; redundant investigation skipped.`
      );
    }
  }

  console.log(
    `Summary: ${exploratoryQaAnalysis.summary}`
  );

  for (
    const exploratoryFinding of
      exploratoryQaAnalysis.findings
  ) {
    console.log(
      `- [${exploratoryFinding.severity}/${exploratoryFinding.confidence}] ${exploratoryFinding.title}`
    );
  }

  let exploratoryInvestigation:
    InspectedPageResult['exploratoryInvestigation'] =
      null;

  if (
    containsPasswordField
  ) {
    console.log(
      '\nAutonomous investigation skipped: password field detected.'
    );
  } else if (
    site.maxExploratoryStepsPerPage >
      0 &&
    pageCandidates.length >
      0
  ) {
    console.log(
      '\nStarting autonomous page investigation...'
    );

    console.log(
      `Maximum investigation steps: ${site.maxExploratoryStepsPerPage}`
    );

    console.log(
      `Investigable candidates supplied to planner: ${pageCandidates.filter(isInvestigablePageCandidate).length}`
    );

    exploratoryInvestigation =
      await runExploratoryLoop(
        page,
        pageObservation.finalUrl,
        site.maxExploratoryStepsPerPage,
        pageCandidates
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

    console.log(
      '\nAutonomous page investigation completed:'
    );

    console.log(
      `Planner decisions: ${exploratoryInvestigation.plannerDecisionCount}/${exploratoryInvestigation.maxPlannerDecisions}`
    );

    console.log(
      `Executed candidate-investigation actions: ${exploratoryInvestigation.executedInvestigationActionCount}`
    );

    console.log(
      `Stop reason: ${exploratoryInvestigation.stopReason}`
    );
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

  if (
    exploratoryFindingResults.length >
    0
  ) {
    console.log(
      '\nExploratory finding outcomes:'
    );

    for (
      const result of
        exploratoryFindingResults
    ) {
      console.log(
        `- [${result.outcome.status.toUpperCase()}] ${result.finding.title}`
      );

      console.log(
        `  ${result.outcome.summary}`
      );
    }
  }

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

    console.log(
      '\nScreenshot evidence captured:'
    );

    console.log(
      screenshotPath
    );
  } else {
    console.log(
      '\nScreenshot evidence: not required for this page.'
    );
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

  const newlyAddedLinks =
    registerDiscoveredNavigationLinks(
      navigationFrontier,
      discoveredLinks,
      pageObservation
        .finalUrl,
      traversalDepth
    );

  console.log(
    selection.type ===
      'start-url'
      ? `\nInitial safe navigation candidates found: ${discoveredLinks.length}`
      : `\nAdditional safe links discovered on this page: ${newlyAddedLinks}`
  );

  console.log(
    `Total unique safe links in frontier: ${navigationFrontier.entries.size}`
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
