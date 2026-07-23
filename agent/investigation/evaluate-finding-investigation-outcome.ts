import type {
  SelectOptionEvidenceTarget,
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';

import type {
  ExploratoryLoopResult,
  ExploratoryLoopStep
} from '../planning/run-exploratory-loop';
import type {
  PageCandidate
} from './page-candidates';

export type FindingInvestigationStatus =
  | 'verified'
  | 'not-verified'
  | 'inconclusive';

export interface FindingInvestigationOutcome {
  status:
    FindingInvestigationStatus;

  summary:
    string;

  evidence:
    string[];
}

/**
 * Determines whether an exploratory finding was confirmed,
 * contradicted, or could not be conclusively resolved by
 * the autonomous investigation.
 *
 * This evaluator is deterministic.
 *
 * Gemini may identify the candidate finding and choose
 * investigation actions, but Gemini does not decide the
 * final verification status.
 */
export function evaluateFindingInvestigationOutcome(
  candidate:
    PageCandidate,

  investigation:
    ExploratoryLoopResult | null
): FindingInvestigationOutcome {
  const {
    finding,
    reference: candidateReference
  } = candidate;

  if (investigation === null) {
    return inconclusive(
      'No autonomous investigation was performed for this finding.'
    );
  }

  if (finding.evidenceTarget === null) {
    return inconclusive(
      'The finding has no supported machine-readable evidence target that can currently be evaluated deterministically.'
    );
  }

  switch (finding.evidenceTarget.kind) {
    case 'select-option':
      return evaluateSelectOptionFinding(
        finding.evidenceTarget,
        investigation,
        candidateReference
      );
  }
}

/**
 * Evaluates the currently supported select-option evidence target.
 *
 * A finding is verified only when:
 * 1. the planner requested the exact suspicious option;
 * 2. the deterministic executor reports that the action executed; and
 * 3. the after-state confirms that exact option is selected.
 *
 * A finding is not verified only when the action executed but the
 * deterministic after-state directly contradicts the expected result.
 *
 * All other cases remain inconclusive.
 */
function evaluateSelectOptionFinding(
  target:
    SelectOptionEvidenceTarget,

  investigation:
    ExploratoryLoopResult,

  candidateReference:
    string
): FindingInvestigationOutcome {
  const relevantStep =
    investigation.steps.find(
      step =>
        isMatchingSelectOptionStep(
          step,
          target,
          candidateReference
        )
    );

  if (relevantStep === undefined) {
    return inconclusive(
      `The investigation did not execute a select-option action for "${target.optionText}".`
    );
  }

  if (
    relevantStep.executionResult.status !==
    'executed'
  ) {
    return inconclusive(
      `The investigation did not successfully execute the select-option action for "${target.optionText}".`,
      [
        relevantStep.executionResult.detail
      ]
    );
  }

  const observedSelect =
    relevantStep.observationAfter.selects.find(
      select =>
        matchesObservedSelect(
          select,
          target
        )
    );

  if (observedSelect === undefined) {
    return inconclusive(
      'The target select control could not be identified in the browser state collected after the investigation action.',
      [
        relevantStep.executionResult.detail
      ]
    );
  }

  const observedOption =
    observedSelect.options.find(
      option =>
        option.text ===
        target.optionText
    );

  if (observedOption === undefined) {
    return inconclusive(
      `The option "${target.optionText}" was not present in the captured post-action select evidence, so its final state cannot be determined safely.`,
      [
        relevantStep.executionResult.detail
      ]
    );
  }

  if (observedOption.selected) {
    return {
      status:
        'verified',

      summary:
        `The investigation verified that the suspicious option "${target.optionText}" can be selected.`,

      evidence: [
        relevantStep.executionResult.detail,

        `Post-action browser evidence shows "${target.optionText}" selected in the targeted control.`
      ]
    };
  }

  return {
    status:
      'not-verified',

    summary:
      `The investigation did not verify that the suspicious option "${target.optionText}" remains selected after the action.`,

    evidence: [
      relevantStep.executionResult.detail,

      `Post-action browser evidence shows "${target.optionText}" present but not selected in the targeted control.`
    ]
  };
}

function isMatchingSelectOptionStep(
  step:
    ExploratoryLoopStep,

  target:
    SelectOptionEvidenceTarget,

  candidateReference:
    string
): boolean {
  if (
    step.decision.candidateReference !==
    candidateReference
  ) {
    return false;
  }

  if (
    step.decision.action.kind !==
    'select-option'
  ) {
    return false;
  }

  if (
    step.decision.action.optionText !==
    target.optionText
  ) {
    return false;
  }

  return matchesControlIdentity(
    {
      label:
        step.decision.action
          .target.label,

      name:
        step.decision.action
          .target.name,

      id:
        step.decision.action
          .target.id
    },
    target
  );
}

function matchesObservedSelect(
  select: {
    label: string | null;
    name: string | null;
    id: string | null;
  },

  target:
    SelectOptionEvidenceTarget
): boolean {
  return matchesControlIdentity(
    select,
    target
  );
}

/**
 * Candidate evidence targets may identify a control using any
 * combination of label, name, and id.
 *
 * Every non-null identity supplied by the candidate must agree
 * with the browser evidence. At least one identity is required.
 */
function matchesControlIdentity(
  control: {
    label: string | null;
    name: string | null;
    id: string | null;
  },

  target:
    SelectOptionEvidenceTarget
): boolean {
  const comparisons = [
    {
      expected:
        target.controlLabel,

      actual:
        control.label
    },

    {
      expected:
        target.controlName,

      actual:
        control.name
    },

    {
      expected:
        target.controlId,

      actual:
        control.id
    }
  ].filter(
    comparison =>
      comparison.expected !==
      null
  );

  if (comparisons.length === 0) {
    return false;
  }

  return comparisons.every(
    comparison =>
      comparison.actual ===
      comparison.expected
  );
}

function inconclusive(
  summary:
    string,

  evidence:
    string[] = []
): FindingInvestigationOutcome {
  return {
    status:
      'inconclusive',

    summary,

    evidence
  };
}
