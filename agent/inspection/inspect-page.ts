import type { Page } from '@playwright/test';

import { analyzePageForQa } from '../analysis/analyze-page-for-qa';
import { classifyDiagnostics } from '../analysis/classify-diagnostics';
import { evaluatePageObservation } from '../analysis/evaluate-page';
import { capturePageScreenshot } from '../browser/capture-page-screenshot';
import { captureFindingPresentationEvidence } from '../browser/capture-finding-presentation-evidence';
import type { PageDiagnosticsCollector } from '../browser/collect-page-diagnostics';
import { extractPageContent } from '../browser/extract-page-content';
import { inspectNavigation } from '../browser/inspect-navigation';
import { runPageOperationWithCancellation } from '../browser/run-page-operation-with-cancellation';
import type { SiteConfig } from '../config/site-config';
import { markFinalUrlInspected, type NavigationUrlState } from '../exploration/visited-links';
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
import { evaluateFindingInvestigationOutcome } from '../investigation/evaluate-finding-investigation-outcome';
import { normalizeRunCancellation, waitForRunDelay } from '../errors/run-cancellation';
import { CheckQuestError } from '../errors/checkquest-error';
import type { GeminiRequestEvent } from '../ai/run-gemini-request';
import { commitRunPageFindings } from '../findings/commit-run-page-findings';
import {
  prepareKnownFindingAnalysis,
  prepareRunPageFindings
} from '../findings/prepare-run-page-findings';
import type { RunFindingLifecycleState } from '../findings/run-finding-lifecycle';
import { runExploratoryLoop } from '../planning/run-exploratory-loop';
import type { planNextAction } from '../planning/plan-next-action';
import type { PassivePageSecuritySnapshot } from '../security/passive-security-model';
import {
  registerPassiveSecuritySnapshot,
  type PassiveSecurityRegistry
} from '../security/passive-security-registry';
import type { FindingPresentationEvidence, InspectedPageResult } from './inspected-page-result';

export interface OpenPageInspectionInput {
  selection: InspectedPageResult['selection'];

  observation: InspectedPageResult['observation'];

  passiveSecuritySnapshot: PassivePageSecuritySnapshot;

  traversalDepth: number;
}

export interface PageInspectionFindingMetrics {
  knownFindingsSuppliedToAnalysisCount: number;
  newCandidateFindingsCount: number;
  redundantInvestigationsSkippedCount: number;
}

export interface InspectPageDependencies {
  analyzePageForQa?: typeof analyzePageForQa;
  planNextAction?: typeof planNextAction;
  geminiApiKey?: string;
  model?: string;
  signal?: AbortSignal;
  onModelRequestEvent?: (event: GeminiRequestEvent) => void;
}

export interface InspectPageInput {
  page: Page;
  site: SiteConfig;
  runId: string;
  pageIndex: number;
  currentPage: OpenPageInspectionInput;
  diagnosticsCollector: PageDiagnosticsCollector;
  navigationFrontier: NavigationFrontier;
  navigationUrlState: NavigationUrlState;
  pageNoveltyState: PageNoveltyState;
  passiveSecurityRegistry: PassiveSecurityRegistry;
  findingLifecycle: RunFindingLifecycleState;
  dependencies?: InspectPageDependencies;
}

export interface InspectPageResult {
  pageResult: InspectedPageResult;
  findingMetrics: PageInspectionFindingMetrics;
}

export async function inspectPage(input: InspectPageInput): Promise<InspectPageResult> {
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
  const pageNumber = pageIndex + 1;

  const {
    observation: pageObservation,
    passiveSecuritySnapshot,
    selection,
    traversalDepth
  } = currentPage;

  registerPassiveSecuritySnapshot(passiveSecurityRegistry, passiveSecuritySnapshot);

  await waitForRunDelay(1_000, input.dependencies?.signal, runId, 'page-observation-settle');

  const diagnostics = diagnosticsCollector.snapshot();

  const classifiedDiagnostics = classifyDiagnostics(diagnostics);

  const findings = evaluatePageObservation(pageObservation);

  const pageContent = await extractPageContent(page);

  const discoveredLinks = await runPageOperationWithCancellation(
    page,
    () => inspectNavigation(page, site.allowedHosts),
    {
      signal: input.dependencies?.signal,
      runId,
      phase: 'navigation-inspection'
    }
  );

  const effectivePredictedIdentity = predictPageIdentity(pageObservation.finalUrl, [
    ...getNavigationFrontierEntries(navigationFrontier).map(entry => entry.link),
    ...discoveredLinks
  ]);

  if (selection.type === 'start-url' && selection.navigationAudit) {
    selection.navigationAudit.predictedAreaKey = effectivePredictedIdentity.areaKey;

    selection.navigationAudit.predictedRouteFamilyKey = effectivePredictedIdentity.routeFamilyKey;
  }

  const pageNovelty = registerInspectedPageNovelty(
    pageNoveltyState,
    effectivePredictedIdentity,
    pageContent
  );

  const containsPasswordField = pageContent.textFields.some(
    field => field.inputType === 'password'
  );

  const knownFindingPreparation = prepareKnownFindingAnalysis(
    findingLifecycle.knownFindingState,
    pageContent
  );

  const { knownFindingContext } = knownFindingPreparation;

  const knownFindingsSuppliedToAnalysisCount = knownFindingContext.length;

  const rawExploratoryQaAnalysis = await (input.dependencies?.analyzePageForQa ?? analyzePageForQa)(
    {
      observation: pageObservation,

      content: pageContent,

      classifiedDiagnostics,

      ruleBasedFindings: findings,

      knownFindings: knownFindingContext
    },
    {
      geminiApiKey: input.dependencies?.geminiApiKey,
      model: input.dependencies?.model,
      signal: input.dependencies?.signal,
      onEvent: input.dependencies?.onModelRequestEvent
    }
  );

  const preparedPageFindings = prepareRunPageFindings(findingLifecycle.knownFindingState, {
    pageUrl: pageObservation.finalUrl,
    pageTitle: pageObservation.title,
    pageContent,
    ruleFindings: findings,
    rawExploratoryQaAnalysis,
    classifiedDiagnostics,
    knownFindingPreparation
  });

  const { exploratoryQaAnalysis, reconciledPageFindings, pageCandidates } = preparedPageFindings;

  const newCandidateFindingsCount = reconciledPageFindings.newFindings.length;

  const pageRedundantInvestigationsSkipped = reconciledPageFindings.knownOccurrenceDrafts.filter(
    draft => draft.redundantInvestigationSkipped
  ).length;

  const redundantInvestigationsSkippedCount = pageRedundantInvestigationsSkipped;

  let exploratoryInvestigation: InspectedPageResult['exploratoryInvestigation'] = null;

  if (!containsPasswordField && site.maxExploratoryStepsPerPage > 0 && pageCandidates.length > 0) {
    exploratoryInvestigation = await runExploratoryLoop(
      page,
      pageObservation.finalUrl,
      site.maxExploratoryStepsPerPage,
      pageCandidates,
      {
        plan: input.dependencies?.planNextAction,
        geminiApiKey: input.dependencies?.geminiApiKey,
        model: input.dependencies?.model,
        signal: input.dependencies?.signal,
        onModelRequestEvent: input.dependencies?.onModelRequestEvent
      }
    );

    const postInvestigationUrl = new URL(page.url());

    if (!site.allowedHosts.includes(postInvestigationUrl.hostname)) {
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
  const exploratoryFindingResults = pageCandidates.map(candidate => ({
    candidateReference: candidate.reference,

    finding: candidate.finding,

    outcome: evaluateFindingInvestigationOutcome(candidate, exploratoryInvestigation)
  }));

  /*
   * A generic page image does not prove a specific claim. Human-facing
   * screenshots are now captured only for exact focused targets below.
   * Investigation and diagnostic facts remain structured non-visual evidence.
   */
  const shouldCaptureScreenshot = false;

  const presentationEvidence: FindingPresentationEvidence[] = [];

  for (const [candidateIndex, exploratoryFindingResult] of exploratoryFindingResults.entries()) {
    const target =
      exploratoryFindingResult.finding.presentationTarget ??
      (exploratoryFindingResult.finding.evidenceTarget?.kind === 'select-option'
        ? exploratoryFindingResult.finding.evidenceTarget
        : null);

    if (
      exploratoryFindingResult.outcome.status === 'not-verified' ||
      target === null ||
      target === undefined
    ) {
      continue;
    }

    try {
      const allowObservedStateReplay =
        target.kind === 'select-option' &&
        (exploratoryInvestigation?.steps.some(
          step =>
            step.decision.candidateReference === exploratoryFindingResult.candidateReference &&
            step.decision.action.kind === 'select-option' &&
            step.decision.action.optionText === target.optionText &&
            step.executionResult.status === 'executed'
        ) ??
          false);
      const focusedEvidence = await captureFindingPresentationEvidence(page, {
        runId,
        pageNumber: pageNumber,
        candidateNumber: candidateIndex + 1,
        target,
        allowObservedStateReplay,
        signal: input.dependencies?.signal
      });

      if (focusedEvidence.totalTargetCount > 0) {
        presentationEvidence.push({
          candidateReference: exploratoryFindingResult.candidateReference,
          pageNumber: pageNumber,
          pageUrl: pageObservation.finalUrl,
          target,
          screenshotPaths: focusedEvidence.screenshotPaths,
          totalTargetCount: focusedEvidence.totalTargetCount,
          shownTargetCount: focusedEvidence.shownTargetCount,
          replay: focusedEvidence.replay
        });
      }
    } catch (error: unknown) {
      const normalizedError = normalizeRunCancellation(
        error,
        input.dependencies?.signal,
        runId,
        'focused-evidence-screenshot'
      );

      if (normalizedError instanceof CheckQuestError && normalizedError.code === 'CANCELLED') {
        throw normalizedError;
      }
    }
  }

  let screenshotPath: string | null = null;

  if (shouldCaptureScreenshot) {
    const screenshot = await capturePageScreenshot(
      page,
      runId,
      pageNumber,
      input.dependencies?.signal
    );

    screenshotPath = screenshot.filePath;
  }

  const knownFindingOccurrences = commitRunPageFindings(findingLifecycle, {
    page: preparedPageFindings,
    pageUrl: pageObservation.finalUrl,
    pageTitle: pageObservation.title,
    pageNumber,
    screenshotPath,
    exploratoryFindingResults
  });

  registerDiscoveredNavigationLinks(
    navigationFrontier,
    discoveredLinks,
    pageObservation.finalUrl,
    traversalDepth
  );

  markFinalUrlInspected(navigationUrlState, pageObservation.finalUrl);

  const pageResult: InspectedPageResult = {
    selection,

    observation: pageObservation,

    pageNovelty,

    diagnostics,

    classifiedDiagnostics,

    screenshotPath,

    presentationEvidence,

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
