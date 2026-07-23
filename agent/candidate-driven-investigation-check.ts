import assert from 'node:assert/strict';

import { chromium, type Page } from '@playwright/test';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';
import {
  runExploratoryLoop
} from './planning/run-exploratory-loop';
import type {
  PlannerDecision
} from './planning/planner-decision-schema';

const unsupportedCandidate: ExploratoryQaFinding = {
  category: 'content',
  severity: 'low',
  confidence: 'high',
  title: 'Visible copy issue',
  evidence: 'A duplicated word is visible.',
  reasoning: 'The rendered copy appears duplicated.',
  suggestedCheck: 'Review the rendered copy.',
  evidenceTarget: null
};

function selectCandidate(
  optionText: string
): ExploratoryQaFinding {
  return {
    category: 'content',
    severity: 'low',
    confidence: 'high',
    title: `Suspicious option ${optionText}`,
    evidence: `The Country select contains ${optionText}.`,
    reasoning: 'The option may be erroneous.',
    suggestedCheck: 'Verify that the option is selectable.',
    evidenceTarget: {
      kind: 'select-option',
      controlLabel: 'Country',
      controlName: 'country',
      controlId: 'country',
      optionText
    }
  };
}

function selectDecision(
  candidateReference: string,
  optionText: string
): PlannerDecision {
  return {
    candidateReference,
    hypothesis: `Check whether ${optionText} can be selected.`,
    reasoning: 'This action directly tests the referenced candidate.',
    action: {
      kind: 'select-option',
      target: {
        label: 'Country',
        name: 'country',
        id: 'country',
        placeholder: null
      },
      optionText
    },
    expectedObservation: 'The selected state will provide deterministic evidence.'
  };
}

async function main(): Promise<void> {
  let plannerCalls = 0;
  let executorCalls = 0;

  const unusedPage = null as unknown as Page;
  const dependencies = {
    plan: async (): Promise<PlannerDecision> => {
      plannerCalls += 1;
      return selectDecision('candidate-1', 'Equador');
    },
    execute: async () => {
      executorCalls += 1;
      throw new Error('Executor must not be reached.');
    }
  };

  const noCandidates = await runExploratoryLoop(
    unusedPage,
    'https://example.com',
    3,
    assignPageCandidateReferences([]),
    dependencies
  );

  assert.equal(noCandidates.plannerDecisionCount, 0);
  assert.equal(noCandidates.executedInvestigationActionCount, 0);
  assert.equal(noCandidates.stopReason, 'no-investigable-candidates');
  assert.equal(plannerCalls, 0);
  assert.equal(executorCalls, 0);

  const unsupportedOnly = await runExploratoryLoop(
    unusedPage,
    'https://example.com',
    3,
    assignPageCandidateReferences([
      unsupportedCandidate
    ]),
    dependencies
  );

  assert.equal(unsupportedOnly.plannerDecisionCount, 0);
  assert.equal(unsupportedOnly.executedInvestigationActionCount, 0);
  assert.equal(unsupportedOnly.stopReason, 'no-investigable-candidates');
  assert.equal(plannerCalls, 0);
  assert.equal(executorCalls, 0);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <label for="country">Country</label>
      <select id="country" name="country">
        <option>Ecuador</option>
        <option>Equador</option>
        <option>Egypt</option>
      </select>
    `);

    const candidateA = selectCandidate('Equador');
    const candidateB = selectCandidate('Equador');
    const pageCandidates =
      assignPageCandidateReferences([
        unsupportedCandidate,
        candidateA,
        candidateB
      ]);

    assert.equal(pageCandidates[1].reference, 'candidate-2');

    let observedPlannerCandidateReference:
      string | undefined;

    const matching = await runExploratoryLoop(
      page,
      'https://example.com',
      1,
      pageCandidates,
      {
        plan: async input => {
          observedPlannerCandidateReference =
            input.investigableCandidates[0]?.reference;

          return selectDecision('candidate-2', 'Equador');
        }
      }
    );

    assert.equal(
      observedPlannerCandidateReference,
      'candidate-2'
    );
    assert.equal(
      matching.steps[0].decision.candidateReference,
      'candidate-2'
    );
    assert.equal(matching.steps[0].executionResult.status, 'executed');
    assert.equal(matching.plannerDecisionCount, 1);
    assert.equal(matching.executedInvestigationActionCount, 1);
    assert.equal(
      await page.locator('#country').inputValue(),
      'Equador'
    );

    executorCalls = 0;

    const rejected = await runExploratoryLoop(
      page,
      'https://example.com',
      2,
      pageCandidates,
      {
        plan: async () => selectDecision('candidate-2', 'Egypt'),
        execute: async (_page, action) => {
          executorCalls += 1;
          return {
            kind: action.kind,
            status: 'executed',
            detail: 'Unexpected execution.'
          };
        }
      }
    );

    assert.equal(rejected.stopReason, 'invalid-planner-decision');
    assert.equal(rejected.steps[0].executionResult.status, 'rejected');
    assert.match(rejected.rejectionReason ?? '', /does not match/i);
    assert.equal(executorCalls, 0);
    assert.equal(rejected.plannerDecisionCount, 1);
    assert.equal(rejected.executedInvestigationActionCount, 0);

    const unknownReference = await runExploratoryLoop(
      page,
      'https://example.com',
      2,
      pageCandidates,
      {
        plan: async () => selectDecision('candidate-999', 'Equador'),
        execute: async (_page, action) => {
          executorCalls += 1;
          return {
            kind: action.kind,
            status: 'executed',
            detail: 'Unexpected execution.'
          };
        }
      }
    );

    assert.equal(
      unknownReference.stopReason,
      'invalid-planner-decision'
    );
    assert.match(
      unknownReference.rejectionReason ?? '',
      /not an investigable candidate/i
    );
    assert.equal(executorCalls, 0);
    assert.equal(
      unknownReference.executedInvestigationActionCount,
      0
    );

    const stopped = await runExploratoryLoop(
      page,
      'https://example.com',
      2,
      pageCandidates,
      {
        plan: async () => ({
          hypothesis: 'No further candidate action is useful.',
          reasoning: 'The planner is stopping safely.',
          action: {
            kind: 'stop',
            reason: 'No useful candidate-linked action remains.'
          },
          expectedObservation: 'No candidate-investigation action executes.'
        })
      }
    );

    assert.equal(stopped.stopReason, 'planner-stop');
    assert.equal(stopped.plannerDecisionCount, 1);
    assert.equal(stopped.executedInvestigationActionCount, 0);

    const candidateAOutcome = evaluateFindingInvestigationOutcome(
      pageCandidates[1],
      matching
    );
    const candidateBOutcome = evaluateFindingInvestigationOutcome(
      pageCandidates[2],
      matching
    );

    assert.equal(candidateAOutcome.status, 'verified');
    assert.equal(candidateBOutcome.status, 'inconclusive');
  } finally {
    await browser.close();
  }

  console.log('All candidate-driven investigation checks passed.');
}

main().catch(error => {
  console.error('Candidate-driven investigation check failed.');
  console.error(error);
  process.exitCode = 1;
});
