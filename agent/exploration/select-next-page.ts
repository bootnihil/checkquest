import type { Page } from '@playwright/test';

import type { GeminiRequestEvent } from '../ai/run-gemini-request';
import type { PageDiagnosticsCollector } from '../browser/collect-page-diagnostics';
import { visitApprovedLinkWithPassiveSecurity } from '../browser/visit-approved-link';
import type { SiteConfig } from '../config/site-config';
import { chooseNavigationLink } from '../decisions/choose-navigation-link';
import { CheckQuestError } from '../errors/checkquest-error';
import { throwIfRunCancelled } from '../errors/run-cancellation';
import { createSafeDisplayUrl } from '../errors/safe-display-url';
import type { OpenPageInspectionInput } from '../inspection/inspect-page';
import type { RunEventEmitter } from '../run/run-event';
import {
  buildNavigationPolicyWindow,
  consumeNavigationDecision,
  createNavigationBudgetContext,
  type NavigationFrontier
} from './navigation-policy';
import type { PageNoveltyState } from './page-novelty';
import {
  markNavigationUrlAttempted,
  recordNavigationResolution,
  type NavigationUrlState
} from './visited-links';

export interface SelectNextPageInput {
  page: Page;
  site: SiteConfig;
  runId: string;
  completedPageCount: number;
  navigationStepsUsed: number;
  navigationFrontier: NavigationFrontier;
  navigationUrlState: NavigationUrlState;
  pageNoveltyState: PageNoveltyState;
  diagnosticsCollector: PageDiagnosticsCollector;
  chooseNavigationLink?: typeof chooseNavigationLink;
  geminiApiKey?: string;
  model?: string;
  signal?: AbortSignal;
  onModelRequestEvent?: (event: GeminiRequestEvent) => void;
  emit: RunEventEmitter;
}

export type NextPageSelectionResult =
  | {
      type: 'ready-for-inspection';
      page: OpenPageInspectionInput;
      navigationStepsUsed: number;
    }
  | {
      type: 'exploration-stopped';
      outcome: ExplorationStopOutcome | null;
      navigationStepsUsed: number;
    };

export interface ExplorationStopOutcome {
  type: 'finished';
  summary: string;
}

export async function selectNextPageForInspection(
  input: SelectNextPageInput
): Promise<NextPageSelectionResult> {
  let navigationStepsUsed = input.navigationStepsUsed;

  while (true) {
    throwIfRunCancelled(input.signal, input.runId, 'navigation-selection');

    const navigationBudget = createNavigationBudgetContext(
      input.site.maxPages,
      input.completedPageCount,
      input.site.maxAgentSteps,
      navigationStepsUsed
    );

    if (
      navigationBudget.remainingPageSlots === 0 ||
      navigationBudget.remainingNavigationDecisionSlots === 0
    ) {
      return {
        type: 'exploration-stopped',
        outcome: null,
        navigationStepsUsed
      };
    }

    const policyWindow = buildNavigationPolicyWindow({
      frontier: input.navigationFrontier,
      urlState: input.navigationUrlState,
      pageNoveltyState: input.pageNoveltyState,
      budget: navigationBudget
    });

    if (policyWindow.candidates.length === 0) {
      return {
        type: 'exploration-stopped',
        outcome: {
          type: 'finished',
          summary: 'No unattempted safe navigation links remained.'
        },
        navigationStepsUsed
      };
    }

    /*
     * Preserve the historical budget definition exactly: every Gemini
     * navigation decision consumes one agent step, including FINISH and
     * redirect aliases.
     */
    navigationStepsUsed = consumeNavigationDecision(input.site.maxAgentSteps, navigationStepsUsed);

    const decision = await (input.chooseNavigationLink ?? chooseNavigationLink)(
      input.site,
      policyWindow.candidates,
      navigationBudget,
      {
        geminiApiKey: input.geminiApiKey,
        model: input.model,
        signal: input.signal,
        onEvent: input.onModelRequestEvent
      }
    );

    throwIfRunCancelled(input.signal, input.runId, 'navigation-selection');

    if (decision.type === 'finish') {
      return {
        type: 'exploration-stopped',
        outcome: {
          type: 'finished',
          summary: decision.summary
        },
        navigationStepsUsed
      };
    }

    markNavigationUrlAttempted(input.navigationUrlState, decision.link.url);
    input.diagnosticsCollector.reset();

    const pageNumber = input.completedPageCount + 1;

    input.emit({
      type: 'navigation-started',
      message: `Navigation ${navigationStepsUsed} started.`,
      navigationStep: navigationStepsUsed,
      navigationBudget: input.site.maxAgentSteps,
      pageNumber,
      requestedUrl: createSafeDisplayUrl(decision.link.url)
    });

    let approvedPageVisit: Awaited<ReturnType<typeof visitApprovedLinkWithPassiveSecurity>>;

    try {
      approvedPageVisit = await visitApprovedLinkWithPassiveSecurity(
        input.page,
        decision.link,
        input.site.allowedHosts,
        input.signal
      );
    } catch (error: unknown) {
      throw new CheckQuestError('NAVIGATION', 'Unable to open the selected navigation target.', {
        phase: 'agent-navigation',
        runId: input.runId,
        pageNumber,
        navigationStep: navigationStepsUsed,
        requestedUrl: createSafeDisplayUrl(decision.link.url),
        cause: error
      });
    }

    const { observation: pageObservation, passiveSecuritySnapshot } = approvedPageVisit;
    const navigationResolution = recordNavigationResolution(
      input.navigationUrlState,
      decision.link.url,
      pageObservation.finalUrl
    );

    if (navigationResolution.finalUrlAlreadyInspected) {
      input.emit({
        type: 'navigation-completed',
        message: `Navigation ${navigationStepsUsed} resolved to an already-inspected page.`,
        navigationStep: navigationStepsUsed,
        navigationBudget: input.site.maxAgentSteps,
        pageNumber,
        requestedUrl: createSafeDisplayUrl(navigationResolution.requestedUrl),
        finalUrl: createSafeDisplayUrl(navigationResolution.finalUrl),
        outcome: 'duplicate-final-url'
      });

      continue;
    }

    input.emit({
      type: 'navigation-completed',
      message: `Navigation ${navigationStepsUsed} completed.`,
      navigationStep: navigationStepsUsed,
      navigationBudget: input.site.maxAgentSteps,
      pageNumber,
      requestedUrl: createSafeDisplayUrl(navigationResolution.requestedUrl),
      finalUrl: createSafeDisplayUrl(navigationResolution.finalUrl),
      outcome: 'ready-for-inspection'
    });

    return {
      type: 'ready-for-inspection',
      navigationStepsUsed,
      page: {
        selection: {
          type: 'agent-navigation',
          link: decision.link,
          reason: decision.reason,
          navigationAudit: {
            traversalDepth: decision.policyCandidate.minimumDiscoveryDepth,
            requestedUrl: decision.link.url,
            policyBand: decision.policyCandidate.policyBand,
            valueClass: decision.policyCandidate.valueClass,
            valueReasons: decision.policyCandidate.valueReasons,
            eligibleValueClassCounts: policyWindow.eligibleValueClassCounts,
            deferredValueReasonCounts: policyWindow.deferredValueReasonCounts,
            predictedAreaKey: decision.predictedIdentity.areaKey,
            predictedRouteFamilyKey: decision.predictedIdentity.routeFamilyKey,
            firstDiscoveredFromUrl: decision.policyCandidate.firstDiscoveredFromUrl,
            minimumDepthDiscoveredFromUrl: decision.policyCandidate.minimumDepthDiscoveredFromUrl,
            budgetAtDecision: navigationBudget
          }
        },
        observation: pageObservation,
        passiveSecuritySnapshot,
        traversalDepth: decision.policyCandidate.minimumDiscoveryDepth
      }
    };
  }
}
