import { classifyDiagnostics } from './analysis/classify-diagnostics';
import type { PageDiagnostics } from './browser/collect-page-diagnostics';

const diagnostics: PageDiagnostics = {
  consoleErrors: [
    {
      text: 'Synthetic JavaScript error',
      sourceUrl: 'https://example.com/app.js',
      lineNumber: 42,
      columnNumber: 10
    }
  ],
  failedRequests: [
    {
      url: 'https://example.com/cdn-cgi/rum?',
      method: 'POST',
      resourceType: 'ping',
      failureText: 'net::ERR_ABORTED'
    },
    {
      url: 'https://static.doubleclick.net/example.js',
      method: 'GET',
      resourceType: 'script',
      failureText: 'net::ERR_NAME_NOT_RESOLVED'
    },
    {
      url: 'https://example.com/assets/app.js',
      method: 'GET',
      resourceType: 'script',
      failureText: 'net::ERR_FAILED'
    },
    {
      url: 'https://example.com/images/hero.jpg',
      method: 'GET',
      resourceType: 'image',
      failureText: 'net::ERR_FAILED'
    }
  ]
};

const classified = classifyDiagnostics(
  diagnostics
);

console.log(
  'Classified diagnostics:'
);

console.log(
  JSON.stringify(
    classified,
    null,
    2
  )
);

const actionableCount =
  classified.failedRequests.filter(
    (item) =>
      item.disposition === 'actionable'
  ).length;

const ignoredNoiseCount =
  classified.failedRequests.filter(
    (item) =>
      item.disposition === 'ignored-noise'
  ).length;

const needsReviewCount =
  classified.failedRequests.filter(
    (item) =>
      item.disposition === 'needs-review'
  ).length;

console.log('\nClassification counts:');
console.log(
  `Actionable: ${actionableCount}`
);
console.log(
  `Ignored noise: ${ignoredNoiseCount}`
);
console.log(
  `Needs review: ${needsReviewCount}`
);
