import { planNextAction } from './planning/plan-next-action';

async function main(): Promise<void> {
  console.log(
    'Asking Gemini to plan one safe exploratory QA action...\n'
  );

  const decision =
    await planNextAction({
      pageUrl:
        'https://example.com/contact',

      currentStep: 1,

      maxSteps: 6,

      history: [
        {
          step: 1,

          action: {
            kind:
              'scroll',

            direction:
              'down',

            viewportCount:
              1
          },

          result:
            'Scrolled down by 1 viewport and discovered dynamically loaded content.'
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

        links: [],

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
              5,

            optionsTruncated:
              false,

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
        ]
      }
    });

  console.log(
    'Validated Gemini planner decision:\n'
  );

  console.log(
    JSON.stringify(
      decision,
      null,
      2
    )
  );

  console.log(
    '\nDecision passed plannerDecisionSchema validation.'
  );

  console.log(
    `Requested safe action: ${decision.action.kind}`
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      '\nGemini planner decision check failed.'
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

    process.exitCode = 1;
  }
);
