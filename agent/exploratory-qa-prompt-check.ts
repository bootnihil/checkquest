import { buildExploratoryQaPrompt } from './analysis/build-exploratory-qa-prompt';

const prompt =
  buildExploratoryQaPrompt({
    observation: {
      requestedUrl:
        'https://example.com/product',

      finalUrl:
        'https://example.com/product',

      title:
        'Example Product',

      httpStatus: 200,

      headings: [
        'Example Product',
        'Built for Modern Teams'
      ]
    },

    content: {
      title:
        'Example Product',

      headings: [
        'Example Product',
        'Built for Modern Teams'
      ],

      bodyText:
        'Example Product Built for Modern Teams Lorem ipsum dolor sit amet. Learn more about our platform.',

      links: [
        {
          text:
            'Learn more',

          url:
            'https://example.com/platform'
        }
      ],

      buttons: [
        'Request a Demo'
      ],

      textFields: [],

      selects: []
    },

    classifiedDiagnostics: {
      consoleErrors: [],

      failedRequests: [
        {
          request: {
            url:
              'https://example.com/cdn-cgi/rum?',

            method:
              'POST',

            resourceType:
              'ping',

            failureText:
              'net::ERR_ABORTED'
          },

          disposition:
            'ignored-noise',

          reason:
            'Known telemetry, analytics, advertising, or embedded-media tracking request.'
        }
      ]
    },

    ruleBasedFindings: []
  });

console.log(prompt);
