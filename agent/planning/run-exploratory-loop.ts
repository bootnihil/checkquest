import type { Page } from '@playwright/test';

import type { AgentAction } from '../actions/agent-action-schema';
import {
  executeAgentAction,
  type ExecutedAgentActionResult
} from '../browser/execute-agent-action';
import {
  extractPageContent,
  type ExtractedPageContent
} from '../browser/extract-page-content';
import type {
  PlannerHistoryEntry
} from './build-planner-prompt';
import {
  planNextAction
} from './plan-next-action';
import type {
  PlannerDecision
} from './planner-decision-schema';
import {
  isInvestigablePageCandidate,
  type InvestigablePageCandidate,
  type PageCandidate
} from '../investigation/page-candidates';

export interface RejectedAgentActionResult {
  kind: AgentAction['kind'];
  status: 'rejected';
  detail: string;
}

export interface ExploratoryLoopStep {
  step: number;

  observationBefore:
    ExtractedPageContent;

  decision:
    PlannerDecision;

  executionResult:
    | ExecutedAgentActionResult
    | RejectedAgentActionResult;

  observationAfter:
    ExtractedPageContent;
}

export interface ExploratoryLoopResult {
  pageUrl: string;

  maxPlannerDecisions: number;

  plannerDecisionCount: number;

  executedInvestigationActionCount:
    number;

  stopReason:
    | 'planner-stop'
    | 'max-planner-decisions-reached'
    | 'no-investigable-candidates'
    | 'invalid-planner-decision';

  rejectionReason?: string;

  steps:
    ExploratoryLoopStep[];
}

/**
 * Builds a compact deterministic description of what happened after
 * an action.
 *
 * The current full page state will be supplied to the planner on the
 * next iteration, while this summary is kept in history to help the
 * planner understand what actions it has already performed.
 */
function buildHistoryResult(
  action: AgentAction,
  executionResult:
    ExecutedAgentActionResult,
  after: ExtractedPageContent
): string {
  if (
    action.kind ===
      'fill-text-field' ||
    action.kind ===
      'clear-field' ||
    action.kind ===
      'blur-field'
  ) {
    const field =
      after.textFields.find(
        candidate =>
          (
            action.target.id !== null &&
            candidate.id ===
              action.target.id
          ) ||
          (
            action.target.name !==
              null &&
            candidate.name ===
              action.target.name
          ) ||
          (
            action.target.label !==
              null &&
            candidate.label ===
              action.target.label
          ) ||
          (
            action.target
              .placeholder !== null &&
            candidate.placeholder ===
              action.target.placeholder
          )
      );

    if (field !== undefined) {
      return [
        executionResult.detail,

        `Observed value: ${JSON.stringify(
          field.value
        )}.`,

        `Browser-valid: ${field.valid}.`,

        `Validation message: ${JSON.stringify(
          field.validationMessage
        )}.`,

        `aria-invalid: ${JSON.stringify(
          field.ariaInvalid
        )}.`
      ].join(' ');
    }
  }

  if (
    action.kind ===
    'select-option'
  ) {
    const select =
      after.selects.find(
        candidate =>
          (
            action.target.id !== null &&
            candidate.id ===
              action.target.id
          ) ||
          (
            action.target.name !==
              null &&
            candidate.name ===
              action.target.name
          ) ||
          (
            action.target.label !==
              null &&
            candidate.label ===
              action.target.label
          )
      );

    if (select !== undefined) {
      const selectedOptions =
        select.options
          .filter(
            option =>
              option.selected
          )
          .map(
            option =>
              option.text
          );

      return [
        executionResult.detail,

        `Selected option(s): ${JSON.stringify(
          selectedOptions
        )}.`
      ].join(' ');
    }
  }

  return executionResult.detail;
}

/**
 * Runs a bounded exploratory planner/action loop on one already-open page.
 *
 * Candidate findings from the separate exploratory QA analysis layer may
 * be supplied as prioritized investigation leads.
 *
 * Gemini decides what is worth testing.
 *
 * Zod constrains the action vocabulary.
 *
 * The deterministic executor controls what Playwright is actually allowed
 * to do.
 *
 * The loop ends when:
 * - the planner explicitly chooses "stop"; or
 * - maxSteps is reached.
 */
export async function runExploratoryLoop(
  page: Page,
  pageUrl: string,
  maxPlannerDecisions: number,
  pageCandidates:
    PageCandidate[],
  dependencies: {
    plan?: typeof planNextAction;
    execute?: typeof executeAgentAction;
  } = {}
): Promise<ExploratoryLoopResult> {
  const steps:
    ExploratoryLoopStep[] = [];

  const history:
    PlannerHistoryEntry[] = [];

  const investigableCandidates =
    pageCandidates.filter(
      isInvestigablePageCandidate
    );

  if (investigableCandidates.length === 0) {
    console.log(
      'Autonomous investigation skipped: no candidates have a supported machine-readable evidence target.'
    );

    return {
      pageUrl,
      maxPlannerDecisions,
      plannerDecisionCount: 0,
      executedInvestigationActionCount: 0,
      stopReason: 'no-investigable-candidates',
      steps
    };
  }

  const planner = dependencies.plan ?? planNextAction;
  const executor = dependencies.execute ?? executeAgentAction;

  for (
    let stepNumber = 1;
    stepNumber <= maxPlannerDecisions;
    stepNumber += 1
  ) {
    console.log(
      `\nExploratory planner decision ${stepNumber}/${maxPlannerDecisions}`
    );

    const observationBefore =
      await extractPageContent(page);

    const decision =
      await planner({
        pageUrl,

        pageContent:
          observationBefore,

        history,

        currentStep:
          stepNumber,

        maxSteps:
          maxPlannerDecisions,

        investigableCandidates
      });

    console.log(
      `Planner hypothesis: ${decision.hypothesis}`
    );

    console.log(
      `Requested action: ${decision.action.kind}`
    );

    const rejectionReason =
      validateDecisionCandidateRelevance(
        decision,
        investigableCandidates
      );

    if (rejectionReason !== null) {
      console.log(
        `Investigation decision rejected before browser execution: ${rejectionReason}`
      );

      const executionResult: RejectedAgentActionResult = {
        kind: decision.action.kind,
        status: 'rejected',
        detail: rejectionReason
      };

      steps.push({
        step: stepNumber,
        observationBefore,
        decision,
        executionResult,
        observationAfter: observationBefore
      });

      return {
        pageUrl,
        maxPlannerDecisions,
        plannerDecisionCount:
          steps.length,
        executedInvestigationActionCount:
          countExecutedInvestigationActions(steps),
        stopReason: 'invalid-planner-decision',
        rejectionReason,
        steps
      };
    }

    const executionResult =
      await executor(
        page,
        decision.action
      );

    const observationAfter =
      await extractPageContent(page);

    steps.push({
      step:
        stepNumber,

      observationBefore,

      decision,

      executionResult,

      observationAfter
    });

    const historyResult =
      buildHistoryResult(
        decision.action,
        executionResult,
        observationAfter
      );

    console.log(
      `Execution result: ${historyResult}`
    );

    if (
      decision.action.kind ===
      'stop'
    ) {
      return {
        pageUrl,

        maxPlannerDecisions,

        plannerDecisionCount:
          steps.length,

        executedInvestigationActionCount:
          countExecutedInvestigationActions(steps),

        stopReason:
          'planner-stop',

        steps
      };
    }

    history.push({
      step:
        stepNumber,

      action:
        decision.action,

      candidateReference:
        requireCandidateReference(
          decision
        ),

      result:
        historyResult
    });
  }

  return {
    pageUrl,

    maxPlannerDecisions,

    plannerDecisionCount:
      steps.length,

    executedInvestigationActionCount:
      countExecutedInvestigationActions(steps),

    stopReason:
      'max-planner-decisions-reached',

    steps
  };
}

export function validateDecisionCandidateRelevance(
  decision: PlannerDecision,
  candidates: InvestigablePageCandidate[]
): string | null {
  if (decision.action.kind === 'stop') {
    return null;
  }

  const candidate = candidates.find(
    item => item.reference === decision.candidateReference
  );

  if (candidate === undefined) {
    return `Candidate reference "${decision.candidateReference}" is not an investigable candidate on this page.`;
  }

  const target = candidate.finding.evidenceTarget;

  if (
    target.kind !== 'select-option' ||
    decision.action.kind !== 'select-option'
  ) {
    return `Action "${decision.action.kind}" does not match candidate "${candidate.reference}" evidence target "${target.kind}".`;
  }

  const actionTarget = decision.action.target;
  const identities = [
    [target.controlLabel, actionTarget.label],
    [target.controlName, actionTarget.name],
    [target.controlId, actionTarget.id]
  ];

  if (
    !identities.some(([expected]) => expected !== null) ||
    !identities.every(([expected, actual]) => expected === actual) ||
    actionTarget.placeholder !== null ||
    decision.action.optionText !== target.optionText
  ) {
    return `Select-option action does not match candidate "${candidate.reference}" evidence target.`;
  }

  return null;
}

function countExecutedInvestigationActions(
  steps: ExploratoryLoopStep[]
): number {
  return steps.filter(
    step =>
      step.decision.action.kind !== 'stop' &&
      step.executionResult.status === 'executed'
  ).length;
}

function requireCandidateReference(
  decision: PlannerDecision
): string {
  if (decision.candidateReference == null) {
    throw new Error(
      'A validated non-stop investigation decision unexpectedly lacks a candidate reference.'
    );
  }

  return decision.candidateReference;
}
