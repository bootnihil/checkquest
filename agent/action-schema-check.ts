import { agentActionSchema } from './actions/agent-action-schema';

function expectValid(name: string, input: unknown): void {
  const result = agentActionSchema.safeParse(input);

  if (!result.success) {
    throw new Error(
      `${name}: expected action to be valid, but validation failed:\n${result.error}`
    );
  }

  console.log(`✓ VALID: ${name}`);
  console.log(result.data);
}

function expectInvalid(name: string, input: unknown): void {
  const result = agentActionSchema.safeParse(input);

  if (result.success) {
    throw new Error(
      `${name}: expected action to be rejected, but validation succeeded.`
    );
  }

  console.log(`✓ REJECTED: ${name}`);
}

console.log('Checking exploratory agent action schema...\n');

expectValid('Fill an email field', {
  kind: 'fill-text-field',
  target: {
    label: 'Email',
    name: 'email',
    id: null,
    placeholder: 'Enter your email'
  },
  value: 'not-an-email'
});

expectValid('Select a country option', {
  kind: 'select-option',
  target: {
    label: 'Country',
    name: 'country',
    id: 'country',
    placeholder: null
  },
  optionText: 'Ecuador'
});

expectValid('Expand an informational disclosure', {
  kind: 'set-disclosure-state',
  target: {
    controlId: 'faq-control',
    accessibleName:
      'What does CheckQuest test?',
    controlledRegionId:
      'faq-answer'
  },
  desiredState: 'expanded'
});

expectValid('Scroll down two viewports', {
  kind: 'scroll',
  direction: 'down',
  viewportCount: 2
});

expectValid('Stop exploration', {
  kind: 'stop',
  reason: 'No additional safe exploratory actions are useful on this page.'
});

expectInvalid('Forbidden arbitrary action', {
  kind: 'submit-form'
});

expectInvalid('Form control with no identifying attributes', {
  kind: 'fill-text-field',
  target: {
    label: null,
    name: null,
    id: null,
    placeholder: null
  },
  value: 'test'
});

expectInvalid('Excessive scrolling', {
  kind: 'scroll',
  direction: 'down',
  viewportCount: 100
});

expectInvalid('Arbitrary CSS selector injected as target', {
  kind: 'clear-field',
  target: {
    selector: '#dangerous-button'
  }
});

expectInvalid('Disclosure target missing stable identity', {
  kind: 'set-disclosure-state',
  target: {
    accessibleName:
      'Question',
    controlledRegionId:
      'answer'
  },
  desiredState:
    'expanded'
});

console.log('\nAll agent action schema checks passed.');
