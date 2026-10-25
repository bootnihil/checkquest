import assert from 'node:assert/strict';

import {
  analyzePageForQa,
  type AnalyzePageForQaInput
} from '../../agent/analysis/analyze-page-for-qa';
import { CheckQuestError, formatPublicError } from '../../agent/errors/checkquest-error';

const analysisInput: AnalyzePageForQaInput = {
  observation: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    httpStatus: 200,
    headings: ['Example']
  },
  content: {
    title: 'Example',
    headings: ['Example'],
    bodyText: 'Example page body.',
    links: [],
    buttons: [],
    containsPasswordField: false,
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
};

const validResponse = JSON.stringify({
  findings: [],
  summary: 'The second response is valid.'
});

async function main(): Promise<void> {
  {
    const responses = ['', validResponse];
    let attempts = 0;

    const result = await analyzePageForQa(analysisInput, {
      geminiApiKey: 'synthetic-test-key',
      requestModelResponse: async () => {
        const response = responses[attempts];
        attempts += 1;
        return response;
      },
      wait: async () => undefined,
      random: () => 0
    });

    assert.equal(attempts, 2);
    assert.deepEqual(result, {
      findings: [],
      summary: 'The second response is valid.'
    });
  }

  {
    const privateResponseSentinel = 'PRIVATE_MODEL_RESPONSE_SENTINEL';
    const responses = [
      `${privateResponseSentinel} is malformed JSON`,
      JSON.stringify({
        findings: [],
        summary: ''
      })
    ];
    let attempts = 0;

    await assert.rejects(
      analyzePageForQa(analysisInput, {
        geminiApiKey: 'synthetic-test-key',
        requestModelResponse: async () => {
          const response = responses[attempts];
          attempts += 1;
          return response;
        },
        wait: async () => undefined,
        random: () => 0
      }),
      error =>
        error instanceof CheckQuestError &&
        error.code === 'MODEL_RESPONSE' &&
        !error.message.includes(privateResponseSentinel) &&
        !formatPublicError(error).includes(privateResponseSentinel)
    );

    assert.equal(attempts, 2);
  }

  console.log('Exploratory QA structured-response retry checks passed.');
}

main().catch((error: unknown) => {
  console.error('Exploratory QA structured-response retry check failed.', error);
  process.exitCode = 1;
});
