export type RouteValueClass =
  | 'neutral'
  | 'weak-low-value'
  | 'strong-low-value';

export type RouteValueReason =
  | 'path-pagination'
  | 'query-pagination'
  | 'administrative-document-segment'
  | 'content-route-segment';

export interface RouteValueAssessment {
  valueClass: RouteValueClass;
  reasons: RouteValueReason[];
}

const administrativeDocumentSegments =
  new Set([
    'privacy-policy',
    'terms-of-use',
    'terms-of-service',
    'terms-and-conditions',
    'cookie-policy'
  ]);

const contentRouteSegments =
  new Set([
    'blog',
    'blogs',
    'news',
    'article',
    'articles',
    'webinar',
    'webinars',
    'event',
    'events',
    'tag',
    'tags',
    'category',
    'categories',
    'archive',
    'archives'
  ]);

const paginationQueryKeys =
  new Set([
    'page',
    'paged',
    'pagenumber'
  ]);

function normalizeToken(
  token: string
): string {
  let decodedToken =
    token;

  try {
    decodedToken =
      decodeURIComponent(
        token
      );
  } catch {
    /*
     * Keep the URL parser's encoded representation when a path segment
     * cannot be decoded independently.
     */
  }

  return decodedToken
    .normalize('NFKC')
    .toLocaleLowerCase(
      'en-US'
    );
}

function getNormalizedPathSegments(
  url: URL
): string[] {
  return url.pathname
    .split('/')
    .filter(
      segment =>
        segment.length >
        0
    )
    .map(
      normalizeToken
    );
}

function isPaginationNumber(
  value: string
): boolean {
  if (
    !/^\d+$/.test(
      value
    )
  ) {
    return false;
  }

  const pageNumber =
    Number(
      value
    );

  return (
    Number.isSafeInteger(
      pageNumber
    ) &&
    pageNumber >
      1
  );
}

function hasPathPagination(
  segments: readonly string[]
): boolean {
  return segments.some(
    (
      segment,
      index
    ) =>
      segment ===
        'page' &&
      index <
        segments.length -
          1 &&
      isPaginationNumber(
        segments[
          index +
            1
        ]
      )
  );
}

function hasQueryPagination(
  url: URL
): boolean {
  for (
    const [
      rawKey,
      rawValue
    ] of
      url.searchParams
  ) {
    if (
      paginationQueryKeys.has(
        normalizeToken(
          rawKey
        )
      ) &&
      isPaginationNumber(
        rawValue
          .normalize('NFKC')
      )
    ) {
      return true;
    }
  }

  return false;
}

export function assessRouteValue(
  rawUrl: string
): RouteValueAssessment {
  const url =
    new URL(
      rawUrl
    );

  const segments =
    getNormalizedPathSegments(
      url
    );

  const reasons:
    RouteValueReason[] =
      [];

  if (
    hasPathPagination(
      segments
    )
  ) {
    reasons.push(
      'path-pagination'
    );
  }

  if (
    hasQueryPagination(
      url
    )
  ) {
    reasons.push(
      'query-pagination'
    );
  }

  if (
    segments.some(
      segment =>
        administrativeDocumentSegments
          .has(
            segment
          )
    )
  ) {
    reasons.push(
      'administrative-document-segment'
    );
  }

  if (
    segments.some(
      segment =>
        contentRouteSegments.has(
          segment
        )
    )
  ) {
    reasons.push(
      'content-route-segment'
    );
  }

  const hasStrongReason =
    reasons.some(
      reason =>
        reason !==
        'content-route-segment'
    );

  return {
    valueClass:
      hasStrongReason
        ? 'strong-low-value'
        : reasons.includes(
              'content-route-segment'
            )
          ? 'weak-low-value'
          : 'neutral',
    reasons
  };
}
