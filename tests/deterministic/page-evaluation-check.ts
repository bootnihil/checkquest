import assert from 'node:assert/strict';

import { evaluatePageObservation } from '../../agent/analysis/evaluate-page';
import type { VisitedPageObservation } from '../../agent/browser/visit-approved-link';

const healthyPage: VisitedPageObservation = {
  requestedUrl: 'https://example.com/solutions/',
  finalUrl: 'https://example.com/solutions/',
  title: 'Solutions | Example',
  httpStatus: 200,
  headings: ['Our Solutions', 'Discover what we offer']
};

const brokenPage: VisitedPageObservation = {
  requestedUrl: 'https://example.com/missing/',
  finalUrl: 'https://example.com/missing/',
  title: 'Page Not Found',
  httpStatus: 404,
  headings: []
};

const extensionlessImageResponse: VisitedPageObservation = {
  requestedUrl: 'https://example.com/resource',
  finalUrl: 'https://example.com/resource',
  title: '',
  httpStatus: 200,
  headings: []
};

const failedImageResponse: VisitedPageObservation = {
  ...extensionlessImageResponse,
  httpStatus: 404
};

const htmlWithoutHeadings = evaluatePageObservation(
  {
    ...healthyPage,
    headings: []
  },
  ['text/html; charset=utf-8']
);
const imageFindings = evaluatePageObservation(extensionlessImageResponse, ['image/png']);
const failedImageFindings = evaluatePageObservation(failedImageResponse, ['image/png']);

assert.deepEqual(
  htmlWithoutHeadings.map(finding => finding.code),
  ['NO_PRIMARY_HEADINGS']
);
assert.deepEqual(imageFindings, []);
assert.deepEqual(
  failedImageFindings.map(finding => finding.code),
  ['HTTP_CLIENT_ERROR']
);
assert.deepEqual(
  evaluatePageObservation(extensionlessImageResponse).map(finding => finding.code),
  ['EMPTY_PAGE_TITLE', 'NO_PRIMARY_HEADINGS']
);

console.log('Healthy page findings:');
console.log(JSON.stringify(evaluatePageObservation(healthyPage, ['text/html']), null, 2));

console.log('\nBroken page findings:');
console.log(JSON.stringify(evaluatePageObservation(brokenPage, ['text/html']), null, 2));

console.log('\nNon-HTML response findings:');
console.log(JSON.stringify(imageFindings, null, 2));

console.log('\nNon-HTML HTTP error findings:');
console.log(JSON.stringify(failedImageFindings, null, 2));

console.log('\nHTML/non-HTML page evaluation checks passed.');
