import { buildPlannerPrompt } from './planning/build-planner-prompt';

function main(): void {
  const prompt = buildPlannerPrompt({
    pageUrl: 'https://example.com/contact',

    currentStep: 1,
    maxSteps: 6,

    history: [
      {
        step: 1,

        action: {
          kind: 'scroll',
          direction: 'down',
          viewportCount: 1
        },

        result:
          'Scrolled down by 1 viewport and discovered dynamically loaded content.'
      }
    ],

    pageContent: {
      title: 'Contact Us',

      headings: [
        'Contact Us',
        'Request a Demo'
      ],

      bodyText:
        'Request a Demo Work Email Country Please Select Ecuador Egypt Zimbabwe Equador',

      links: [],

      buttons: [
        'Submit'
      ],

      textFields: [
        {
          tagName: 'input',
          inputType: 'email',
          label: 'Work Email',
          name: 'email',
          id: 'email',
          placeholder:
            'Enter your work email',
          required: true,
          disabled: false,
          readOnly: false,
          value: '',
          valid: false,
          validationMessage:
            'Please fill out this field.',
          ariaInvalid: null
        }
      ],

      selects: [
        {
          label: 'Country',
          name: 'country',
          id: 'country',
          required: true,
          disabled: false,

          totalOptions: 260,
          optionsTruncated: true,

          options: [
            {
              text: 'Please Select',
              value: '',
              selected: true
            },
            {
              text: 'Ecuador',
              value: 'Ecuador',
              selected: false
            },
            {
              text: 'Egypt',
              value: 'Egypt',
              selected: false
            },
            {
              text: 'Zimbabwe',
              value: 'Zimbabwe',
              selected: false
            },
            {
              text: 'Equador',
              value: 'Equador',
              selected: false
            }
          ]
        }
      ]
    }
  });

  console.log(
    'Generated exploratory planner prompt:\n'
  );

  console.log(prompt);

  const requiredFragments = [
    'fill-text-field',
    'clear-field',
    'blur-field',
    'select-option',
    'scroll',
    'stop',

    'Work Email',
    'Enter your work email',

    '"inputType": "email"',
    '"required": true',

    '"totalOptions": 260',
    '"optionsTruncated": true',

    'Ecuador',
    'Equador',

    '"kind": "scroll"',
    '"viewportCount": 1',

    'Submit',

    'You MUST NOT request:',
    'form submission',
    'arbitrary clicks',

    'ONE-ACTION CONSISTENCY RULE',

    'The structured evidence already includes ordinary visible DOM elements even when they are below the current viewport.',

    'Observed buttons are evidence only.',

    'Choose only the NEXT action.',

    'Prefer stop over meaningless activity.'
  ];

  for (
    const fragment of requiredFragments
  ) {
    if (!prompt.includes(fragment)) {
      throw new Error(
        `Planner prompt is missing expected content: ${fragment}`
      );
    }
  }

  if (
    prompt.includes(
      '"kind": "submit-form"'
    )
  ) {
    throw new Error(
      'Planner prompt must not expose submit-form as an available action.'
    );
  }

  console.log(
    '\nAll exploratory planner prompt checks passed.'
  );
}

try {
  main();
} catch (error) {
  console.error(
    '\nExploratory planner prompt check failed.'
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}
