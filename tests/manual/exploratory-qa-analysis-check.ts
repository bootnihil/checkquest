import { analyzePageForQa } from '../../agent/analysis/analyze-page-for-qa';
import { resolveGeminiApiKey } from '../../agent/ai/resolve-gemini-api-key';

async function main(): Promise<void> {
  const analysis = await analyzePageForQa(
    {
      observation: {
        requestedUrl: 'https://example.com/product',

        finalUrl: 'https://example.com/product',

        title: 'Example Product',

        httpStatus: 200,

        headings: ['Example Product', 'Built for Modern Teams']
      },

      content: {
        title: 'Example Product',

        headings: ['Example Product', 'Built for Modern Teams'],

        bodyText:
          'Example Product Built for Modern Teams. Lorem ipsum dolor sit amet. TODO: replace this placeholder copy before launch. Learn more about our platform.',

        links: [
          {
            text: 'Learn more',

            url: 'https://example.com/platform'
          }
        ],

        buttons: ['Request a Demo'],

        textFields: [],

        selects: [],

        disclosures: [],
        tabs: []
      },

      classifiedDiagnostics: {
        consoleErrors: [],

        failedRequests: []
      },

      ruleBasedFindings: []
    },
    {
      geminiApiKey: resolveGeminiApiKey(process.env)
    }
  );

  console.log('Exploratory QA analysis:');

  console.log(JSON.stringify(analysis, null, 2));

  console.log('\nSummary:');

  console.log(`Candidate findings: ${analysis.findings.length}`);

  for (const finding of analysis.findings) {
    console.log(`- [${finding.severity}/${finding.confidence}] ${finding.title}`);
  }
}

main().catch((error: unknown) => {
  console.error('Exploratory QA analysis check failed:', error);

  process.exitCode = 1;
});
