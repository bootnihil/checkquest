import assert from 'node:assert/strict';

import {
  assessRouteValue,
  type RouteValueClass,
  type RouteValueReason
} from './exploration/route-value';

function assertAssessment(
  pathOrUrl: string,
  valueClass: RouteValueClass,
  reasons:
    RouteValueReason[] = []
): void {
  const rawUrl =
    new URL(
      pathOrUrl,
      'https://example.com/'
    ).toString();

  assert.deepEqual(
    assessRouteValue(
      rawUrl
    ),
    {
      valueClass,
      reasons
    },
    rawUrl
  );
}

assertAssessment(
  '/platform/',
  'neutral'
);

for (
  const path of
    [
      '/privacy-policy/',
      '/company/terms-of-service/',
      '/cookie-policy/',
      '/COMPANY/PRIVACY-POLICY/',
      '/company/privacy%2Dpolicy/'
    ]
) {
  assertAssessment(
    path,
    'strong-low-value',
    [
      'administrative-document-segment'
    ]
  );
}

for (
  const path of
    [
      '/blog/',
      '/learn/webinars/',
      '/about/news/',
      '/articles/example/'
    ]
) {
  assertAssessment(
    path,
    'weak-low-value',
    [
      'content-route-segment'
    ]
  );
}

for (
  const path of
    [
      '/blogging-tools/',
      '/event-driven-platform/',
      '/category-manager/',
      '/privacy-policy-manager/',
      '/resourceful/',
      '/pressures/',
      '/privacy-tools/',
      '/legality/',
      '/cookie-management/',
      '/terms-engine/',
      '/resource/',
      '/resources/',
      '/faq/',
      '/faqs/',
      '/press/',
      '/privacy/',
      '/terms/',
      '/legal/',
      '/cookie/',
      '/careers/',
      '/search/',
      '/library/',
      '/learn/',
      '/insight/',
      '/insights/',
      '/strategy/'
    ]
) {
  assertAssessment(
    path,
    'neutral'
  );
}

for (
  const path of
    [
      '/produkte/',
      '/actualites/',
      '/recursos/',
      '/イベント/'
    ]
) {
  assertAssessment(
    path,
    'neutral'
  );
}

assertAssessment(
  '/products/?mode=compare',
  'neutral'
);

for (
  const path of
    [
      '/products/?page=2',
      '/products/?paged=4',
      '/products/?pageNumber=3'
    ]
) {
  assertAssessment(
    path,
    'strong-low-value',
    [
      'query-pagination'
    ]
  );
}

assertAssessment(
  '/products/?page=1',
  'neutral'
);

assertAssessment(
  '/products/page/1/',
  'neutral'
);

assertAssessment(
  '/products/?productId=2',
  'neutral'
);

assertAssessment(
  '/blog/page/2/',
  'strong-low-value',
  [
    'path-pagination',
    'content-route-segment'
  ]
);

assertAssessment(
  '/articles/?page=1',
  'weak-low-value',
  [
    'content-route-segment'
  ]
);

assertAssessment(
  '/PAGE/03/',
  'strong-low-value',
  [
    'path-pagination'
  ]
);

console.log(
  'All Stage 6.2 route-value checks passed.'
);
