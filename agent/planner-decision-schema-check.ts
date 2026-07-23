import { plannerDecisionSchema } from './planning/planner-decision-schema';

function expectValid(name: string, input: unknown): void {
  const result = plannerDecisionSchema.safeParse(input);

  if (!result.success) {
    throw new Error(
      `${name}: expected planner decision to be valid, but validation failed:\n${result.error}`
    );
  }

  console.log(`✓ VALID: ${name}`);
  console.log(result.data);
}

function expectInvalid(name: string, input: unknown): void {
  const result = plannerDecisionSchema.safeParse(input);

  if (result.success) {
    throw new Error(
      `${name}: expected planner decision to be rejected, but validation succeeded.`
    );
  }

  console.log(`✓ REJECTED: ${name}`);
}

console.log('Checking exploratory planner decision schema...\n');

expectValid('Test malformed email input', {
  candidateReference:
    'candidate-1',

  hypothesis:
    'The Email field may validate malformed email addresses after losing focus.',

  reasoning:
    'The page contains an email input. Entering a malformed value locally is a safe way to investigate client-side validation without submitting the form.',

  action: {
    kind: 'fill-text-field',
    target: {
      label: 'Email',
      name: 'email',
      id: 'email',
      placeholder: 'Enter your email'
    },
    value: 'not-an-email'
  },

  expectedObservation:
    'The field should accept the local value. A subsequent blur action may reveal whether client-side validation is present.'
});

expectValid('Stop exploration', {
  hypothesis:
    'No additional safe interaction is likely to produce meaningful QA evidence.',

  reasoning:
    'The remaining visible content is informational and no useful untested controls are available.',

  action: {
    kind: 'stop',
    reason: 'No additional useful safe exploratory actions remain.'
  },

  expectedObservation:
    'Exploration should end without performing another browser interaction.'
});

expectInvalid('Non-stop action without candidate reference', {
  hypothesis:
    'Test a field without associating the action with a candidate.',

  reasoning:
    'The action is otherwise schema-valid.',

  action: {
    kind: 'fill-text-field',
    target: {
      label: 'Email',
      name: 'email',
      id: 'email',
      placeholder: 'Enter your email'
    },
    value: 'not-an-email'
  },

  expectedObservation:
    'The action would modify the local field value.'
});

expectInvalid('Attempt forbidden form submission', {
  hypothesis:
    'Submitting the form may reveal server-side validation.',

  reasoning:
    'The planner wants to submit the form.',

  action: {
    kind: 'submit-form'
  },

  expectedObservation:
    'The server may return a validation response.'
});

expectInvalid('Attempt arbitrary browser click', {
  hypothesis:
    'Clicking an arbitrary element may reveal new content.',

  reasoning:
    'The planner wants direct selector-based browser control.',

  action: {
    kind: 'click',
    selector: '#submit-button'
  },

  expectedObservation:
    'Something may happen.'
});

expectInvalid('Decision with empty hypothesis', {
  hypothesis: '',

  reasoning:
    'A decision must explain what is being investigated.',

  action: {
    kind: 'scroll',
    direction: 'down',
    viewportCount: 1
  },

  expectedObservation:
    'More page content may become visible.'
});

console.log('\nAll exploratory planner decision schema checks passed.');
