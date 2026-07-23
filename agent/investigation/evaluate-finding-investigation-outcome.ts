import type {
  DisclosureStateEvidenceTarget,
  SelectOptionEvidenceTarget,
  ExploratoryQaFinding,
  TabStateEvidenceTarget
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

    case 'disclosure-state':
      return evaluateDisclosureStateFinding(
        finding.evidenceTarget,
        investigation,
        candidateReference
      );

    case 'tab-state':
      return evaluateTabStateFinding(
        finding.evidenceTarget,
        investigation,
        candidateReference
      );
  }
}

function evaluateTabStateFinding(
  target:
    TabStateEvidenceTarget,
  investigation:
    ExploratoryLoopResult,
  candidateReference:
    string
): FindingInvestigationOutcome {
  const relevantStep =
    investigation.steps.find(
      step =>
        step.decision
          .candidateReference ===
          candidateReference &&
        step.decision.action
          .kind ===
          'select-tab' &&
        step.decision.action
          .target.controlId ===
          target.controlId &&
        step.decision.action
          .target.accessibleName ===
          target.accessibleName &&
        step.decision.action
          .target.tabListId ===
          target.tabListId &&
        step.decision.action
          .target
          .controlledPanelId ===
          target.controlledPanelId &&
        step.decision.action
          .desiredState ===
          target.desiredState
    );

  if (
    relevantStep === undefined
  ) {
    return inconclusive(
      `The investigation did not execute the candidate-linked tab action for "${target.accessibleName}".`
    );
  }

  if (
    relevantStep.executionResult
      .status === 'unsafe'
  ) {
    return inconclusive(
      `The tab interaction was blocked or aborted by the safety boundary: ${relevantStep.executionResult.detail}`,
      [
        relevantStep.executionResult
          .detail
      ]
    );
  }

  if (
    relevantStep.executionResult
      .status !== 'executed'
  ) {
    return inconclusive(
      'The tab interaction did not execute successfully.'
    );
  }

  const evidence =
    relevantStep.executionResult
      .tabEvidence;

  if (evidence == null) {
    return inconclusive(
      'The tab interaction is missing deterministic before, after, or rollback evidence.'
    );
  }

  if (
    (
      relevantStep.executionResult
        .safetyEvents?.length ??
      0
    ) > 0
  ) {
    return inconclusive(
      'The tab interaction produced a safety event and cannot verify the finding.',
      relevantStep.executionResult
        .safetyEvents
        ?.map(
          event =>
            event.detail
        ) ??
        []
    );
  }

  if (
    !evidence.rollbackSucceeded
  ) {
    return inconclusive(
      'The tab interaction did not restore and verify the exact original tab and panel state.'
    );
  }

  if (
    evidence
      .selectedTabTransitionObserved &&
    evidence
      .previousTabDeselected &&
    evidence
      .targetPanelChangedConsistently &&
    evidence
      .previousPanelChangedConsistently
  ) {
    return {
      status: 'verified',
      summary:
        `The investigation verified that tab "${target.accessibleName}" became selected, revealed its corresponding panel, and restored the original tab afterward.`,
      evidence: [
        `Observed exact aria-selected transition and panel "${target.controlledPanelId}" becoming visible.`,
        'Verified mandatory rollback to the exact original tab and both original panel visibility states.'
      ]
    };
  }

  return {
    status: 'not-verified',
    summary:
      `The safe tab interaction did not produce the requested selected-tab and corresponding-panel transition for "${target.accessibleName}".`,
    evidence: [
      relevantStep.executionResult
        .detail,
      'The exact original tab and panel state was restored successfully.'
    ]
  };
}

function evaluateDisclosureStateFinding(
  target:
    DisclosureStateEvidenceTarget,
  investigation:
    ExploratoryLoopResult,
  candidateReference:
    string
): FindingInvestigationOutcome {
  const relevantStep =
    investigation.steps.find(
      step =>
        step.decision
          .candidateReference ===
          candidateReference &&
        step.decision.action
          .kind ===
          'set-disclosure-state' &&
        step.decision.action
          .target.controlId ===
          target.controlId &&
        step.decision.action
          .target.accessibleName ===
          target.accessibleName &&
        step.decision.action
          .target
          .controlledRegionId ===
          target.controlledRegionId &&
        step.decision.action
          .desiredState ===
          target.desiredState
    );

  if (
    relevantStep === undefined
  ) {
    return inconclusive(
      `The investigation did not execute the candidate-linked disclosure action for "${target.accessibleName}".`
    );
  }

  if (
    relevantStep.executionResult
      .status === 'unsafe'
  ) {
    return inconclusive(
      `The disclosure interaction was blocked or aborted by the safety boundary: ${relevantStep.executionResult.detail}`,
      [
        relevantStep.executionResult
          .detail
      ]
    );
  }

  if (
    relevantStep.executionResult
      .status !== 'executed'
  ) {
    return inconclusive(
      'The disclosure interaction did not execute successfully.'
    );
  }

  const evidence =
    relevantStep.executionResult
      .disclosureEvidence;

  if (evidence == null) {
    return inconclusive(
      'The disclosure interaction is missing deterministic before, after, or rollback evidence.'
    );
  }

  if (
    (
      relevantStep.executionResult
        .safetyEvents?.length ??
      0
    ) > 0
  ) {
    return inconclusive(
      'The disclosure interaction produced a safety event and cannot verify the finding.',
      relevantStep.executionResult
        .safetyEvents
        ?.map(
          event =>
            event.detail
        ) ??
        []
    );
  }

  if (
    !evidence.rollbackSucceeded
  ) {
    return inconclusive(
      'The disclosure interaction did not restore and verify the original state.'
    );
  }

  if (
    evidence
      .stateTransitionObserved &&
    evidence
      .controlledRegionChangedConsistently
  ) {
    return {
      status: 'verified',
      summary:
        `The investigation verified that disclosure "${target.accessibleName}" reached the requested ${target.desiredState} state and was restored afterward.`,
      evidence: [
        `Observed aria-expanded and controlled-region visibility change to ${target.desiredState}.`,
        'Verified mandatory rollback to the original disclosure state.'
      ]
    };
  }

  return {
    status: 'not-verified',
    summary:
      `The safe disclosure interaction did not produce the requested ${target.desiredState} state transition.`,
    evidence: [
      relevantStep.executionResult
        .detail,
      'The original disclosure state was restored successfully.'
    ]
  };
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
