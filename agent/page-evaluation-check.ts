import { evaluatePageObservation } from './analysis/evaluate-page';
import type { VisitedPageObservation } from './browser/visit-approved-link';

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

console.log('Healthy page findings:');
console.log(JSON.stringify(evaluatePageObservation(healthyPage), null, 2));

console.log('\nBroken page findings:');
console.log(JSON.stringify(evaluatePageObservation(brokenPage), null, 2));
