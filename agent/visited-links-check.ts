import assert from 'node:assert/strict';

import {
  createNavigationUrlState,
  getUnvisitedLinks,
  hasFinalUrlBeenInspected,
  hasNavigationUrlBeenAttempted,
  hasVisitedUrl,
  isNavigationUrlEligible,
  markFinalUrlInspected,
  markNavigationUrlAttempted,
  markUrlVisited,
  normalizeUrlForComparison,
  recordNavigationResolution
} from './exploration/visited-links';

const links = [
  {
    text: 'Homepage',
    url: 'https://example.com/'
  },
  {
    text: 'Solutions',
    url: 'https://example.com/solutions/'
  },
  {
    text: 'Solutions without trailing slash',
    url: 'https://example.com/solutions'
  },
  {
    text: 'About section',
    url: 'https://example.com/about/#leadership'
  }
];

const visitedUrls = new Set<string>();

markUrlVisited(
  visitedUrls,
  'https://example.com/solutions/'
);

markUrlVisited(
  visitedUrls,
  'https://example.com/about/#company'
);

console.log('Normalized examples:');
console.log(
  normalizeUrlForComparison(
    'https://example.com/solutions/'
  )
);
console.log(
  normalizeUrlForComparison(
    'https://example.com/about/#leadership'
  )
);

console.log('\nVisited checks:');
console.log(
  `Solutions visited: ${hasVisitedUrl(
    visitedUrls,
    'https://example.com/solutions'
  )}`
);
console.log(
  `About visited: ${hasVisitedUrl(
    visitedUrls,
    'https://example.com/about/#leadership'
  )}`
);
console.log(
  `Homepage visited: ${hasVisitedUrl(
    visitedUrls,
    'https://example.com/'
  )}`
);

console.log('\nUnvisited links:');
console.log(
  JSON.stringify(
    getUnvisitedLinks(links, visitedUrls),
    null,
    2
  )
);

assert.equal(
  hasVisitedUrl(
    visitedUrls,
    'https://example.com/solutions'
  ),
  true
);

assert.equal(
  getUnvisitedLinks(
    links,
    visitedUrls
  ).length,
  1
);

const navigationState =
  createNavigationUrlState();

markNavigationUrlAttempted(
  navigationState,
  'https://example.com/alias'
);

assert.equal(
  hasNavigationUrlBeenAttempted(
    navigationState,
    'https://example.com/alias/'
  ),
  true
);

assert.equal(
  isNavigationUrlEligible(
    navigationState,
    'https://example.com/alias'
  ),
  false
);

const firstResolution =
  recordNavigationResolution(
    navigationState,
    'https://example.com/alias',
    'https://example.com/target'
  );

assert.equal(
  firstResolution
    .finalUrlAlreadyInspected,
  false
);

markFinalUrlInspected(
  navigationState,
  firstResolution.finalUrl
);

assert.equal(
  hasFinalUrlBeenInspected(
    navigationState,
    'https://example.com/target/'
  ),
  true
);

const secondResolution =
  recordNavigationResolution(
    navigationState,
    'https://example.com/second-alias',
    'https://example.com/target'
  );

assert.equal(
  secondResolution
    .finalUrlAlreadyInspected,
  true
);

console.log(
  '\nAll visited-link and navigation URL state checks passed.'
);
