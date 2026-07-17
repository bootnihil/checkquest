import {
  getUnvisitedLinks,
  hasVisitedUrl,
  markUrlVisited,
  normalizeUrlForComparison
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
