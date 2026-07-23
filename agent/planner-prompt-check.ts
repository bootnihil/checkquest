import {
  buildPlannerPrompt
} from './planning/build-planner-prompt';

function main(): void {
  const prompt =
    buildPlannerPrompt({
      pageUrl:
        'https://example.com/contact',

      currentStep:
        2,

      maxSteps:
        6,

      history: [
        {
          step:
            1,

          action: {
            kind:
              'select-option',

            target: {
              label:
                'Country',

              name:
                'country',

              id:
                'country',

              placeholder:
                null
            },

            optionText:
              'Equador'
          },

          candidateReference:
            'candidate-1',

          result:
            'Selected option "Equador" from the approved Country select.'
        }
      ],

      investigableCandidates: [
        {
          reference:
            'candidate-1',

          finding: {
          category:
            'content',

          severity:
            'low',

          confidence:
            'high',

          title:
            'Possible typo in country selection list',

          evidence:
            'The Country select contains both Ecuador and Equador.',

          reasoning:
            'Equador appears to be a misspelling of Ecuador and both values are present in the same country list.',

          suggestedCheck:
            'Verify whether Equador is a genuinely selectable option.',

          evidenceTarget: {
            kind:
              'select-option',

            controlLabel:
              'Country',

            controlName:
              'country',

            controlId:
              'country',

            optionText:
              'Equador'
          }
          }
        }
      ],

      pageContent: {
        title:
          'Contact Us',

        headings: [
          'Contact Us',
          'Request a Demo'
        ],

        bodyText:
          'Request a Demo Work Email Country Please Select Ecuador Egypt Zimbabwe Equador',

        links:
          [],

        buttons: [
          'Submit'
        ],

        textFields: [
          {
            tagName:
              'input',

            inputType:
              'email',

            label:
              'Work Email',

            name:
              'email',

            id:
              'email',

            placeholder:
              'Enter your work email',

            required:
              true,

            disabled:
              false,

            readOnly:
              false,

            value:
              '',

            valid:
              false,

            validationMessage:
              'Please fill out this field.',

            ariaInvalid:
              null
          }
        ],

        selects: [
          {
            label:
              'Country',

            name:
              'country',

            id:
              'country',

            required:
              true,

            disabled:
              false,

            totalOptions:
              260,

            optionsTruncated:
              true,

            options: [
              {
                text:
                  'Please Select',

                value:
                  '',

                selected:
                  true
              },

              {
                text:
                  'Ecuador',

                value:
                  'Ecuador',

                selected:
                  false
              },

              {
                text:
                  'Egypt',

                value:
                  'Egypt',

                selected:
                  false
              },

              {
                text:
                  'Zimbabwe',

                value:
                  'Zimbabwe',

                selected:
                  false
              },

              {
                text:
                  'Equador',

                value:
                  'Equador',

                selected:
                  false
              }
            ]
          }
        ],

        disclosures: []
      }
    });

  console.log(
    'Generated exploratory planner prompt:\n'
  );

  console.log(
    prompt
  );

  /*
   * These checks intentionally focus on capabilities,
   * safety boundaries, and planner policy rather than
   * asserting large blocks of exact prose.
   */
  const requiredFragments = [
    /*
     * Supported action vocabulary.
     */
    'fill-text-field',
    'clear-field',
    'blur-field',
    'select-option',
    'set-disclosure-state',
    'scroll',
    'stop',

    /*
     * Observed page evidence.
     */
    'Work Email',
    'Enter your work email',
    '"inputType": "email"',
    '"required": true',
    '"totalOptions": 260',
    '"optionsTruncated": true',
    'Ecuador',
    'Equador',
    'Submit',

    /*
     * Candidate finding evidence.
     */
    'Possible typo in country selection list',
    'Verify whether Equador is a genuinely selectable option.',
    '"kind": "select-option"',
    '"kind": "set-disclosure-state"',

    /*
     * Candidate-priority policy.
     */
    'CANDIDATE FINDING PRIORITY',
    'Perform ONE safe action that directly investigates a candidate finding.',
    'DO NOT begin an unrelated exploratory test while investigable candidates are present.',
    'DO NOT substitute an unrelated permitted action merely because the action you actually want is prohibited.',

    /*
     * One-action consistency.
     */
    'ONE-ACTION CONSISTENCY RULE',
    'Your hypothesis, reasoning, action, and expectedObservation must all describe the SAME single immediate action.',
    'Do NOT replace the prohibited click with scroll.',

    /*
     * Scroll restrictions.
     */
    'Use this ONLY when scrolling itself is the experiment.',
    'The supplied structured page evidence already includes ordinary rendered DOM content even when it is below the current viewport.',
    'as a substitute for a prohibited click',

    /*
     * Safety boundaries.
     */
    'STRICT SAFETY RULES',
    'You MUST NOT request:',
    'form submission',
    'arbitrary clicks',
    'arbitrary JavaScript execution',
    'Observed buttons are evidence only.',

    /*
     * Good stopping behavior.
     */
    'Stopping early is GOOD behavior.',
    'Prefer stop over meaningless activity.',
    'Choose only the NEXT action.',

    /*
     * Final self-check.
     */
    'FINAL DECISION CHECK',
    'If candidate findings exist, is this action directly investigating one of them?',
    'If candidate findings exist but no permitted action can meaningfully investigate them, did you choose stop?'
  ];

  for (
    const fragment of
      requiredFragments
  ) {
    if (
      !prompt.includes(
        fragment
      )
    ) {
      throw new Error(
        `Planner prompt is missing expected policy or evidence: ${fragment}`
      );
    }
  }

  /*
   * Dangerous actions must never be exposed as
   * available planner actions.
   */
  const forbiddenActionShapes = [
    '"kind": "submit-form"',
    '"kind": "click"',
    '"kind": "execute-javascript"',
    '"kind": "upload-file"',
    '"kind": "download-file"'
  ];

  for (
    const forbiddenAction of
      forbiddenActionShapes
  ) {
    if (
      prompt.includes(
        forbiddenAction
      )
    ) {
      throw new Error(
        `Planner prompt must not expose forbidden action: ${forbiddenAction}`
      );
    }
  }

  if (
    prompt.includes(
      'a second planner step may choose "Ecuador"'
    )
  ) {
    throw new Error(
      'Planner prompt must not recommend a comparison option outside the candidate evidence target.'
    );
  }

  console.log(
    '\nAll exploratory planner prompt checks passed.'
  );
}

try {
  main();
} catch (
  error: unknown
) {
  console.error(
    '\nExploratory planner prompt check failed.'
  );

  if (
    error instanceof Error
  ) {
    console.error(
      error.message
    );
  } else {
    console.error(
      error
    );
  }

  process.exitCode =
    1;
}
