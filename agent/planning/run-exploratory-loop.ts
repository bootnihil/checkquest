import type { Page } from '@playwright/test';

import type { AgentAction } from '../actions/agent-action-schema';
import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
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

export interface ExploratoryLoopStep {
  step: number;

  observationBefore:
    ExtractedPageContent;

  decision:
    PlannerDecision;

  executionResult:
    ExecutedAgentActionResult;

  observationAfter:
    ExtractedPageContent;
}

export interface ExploratoryLoopResult {
  pageUrl: string;

  maxSteps: number;

  completedSteps: number;

  stopReason:
    | 'planner-stop'
    | 'max-steps-reached';

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
  maxSteps: number,
  candidateFindings:
    ExploratoryQaFinding[] = []
): Promise<ExploratoryLoopResult> {
  const steps:
    ExploratoryLoopStep[] = [];

  const history:
    PlannerHistoryEntry[] = [];

  for (
    let stepNumber = 1;
    stepNumber <= maxSteps;
    stepNumber += 1
  ) {
    console.log(
      `\nExploratory planner step ${stepNumber}/${maxSteps}`
    );

    const observationBefore =
      await extractPageContent(page);

    const decision =
      await planNextAction({
        pageUrl,

        pageContent:
          observationBefore,

        history,

        currentStep:
          stepNumber,

        maxSteps,

        candidateFindings
      });

    console.log(
      `Planner hypothesis: ${decision.hypothesis}`
    );

    console.log(
      `Requested action: ${decision.action.kind}`
    );

    const executionResult =
      await executeAgentAction(
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

    history.push({
      step:
        stepNumber,

      action:
        decision.action,

      result:
        historyResult
    });

    console.log(
      `Execution result: ${historyResult}`
    );

    if (
      decision.action.kind ===
      'stop'
    ) {
      return {
        pageUrl,

        maxSteps,

        completedSteps:
          steps.length,

        stopReason:
          'planner-stop',

        steps
      };
    }
  }

  return {
    pageUrl,

    maxSteps,

    completedSteps:
      steps.length,

    stopReason:
      'max-steps-reached',

    steps
  };
}
