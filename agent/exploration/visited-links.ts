import type { NavigationLink } from '../browser/inspect-navigation';

export interface NavigationUrlState {
  attemptedUrls: Set<string>;
  inspectedFinalUrls: Set<string>;
  requestedToFinalAliases: Map<string, string>;
}

export interface NavigationResolution {
  requestedUrl: string;
  finalUrl: string;
  isRedirectAlias: boolean;
  finalUrlAlreadyInspected: boolean;
}

export function normalizeUrlForComparison(
  rawUrl: string
): string {
  const url = new URL(rawUrl);

  url.hash = '';

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

export function createNavigationUrlState():
  NavigationUrlState {
  return {
    attemptedUrls:
      new Set(),

    inspectedFinalUrls:
      new Set(),

    requestedToFinalAliases:
      new Map()
  };
}

export function markNavigationUrlAttempted(
  state: NavigationUrlState,
  rawUrl: string
): void {
  state
    .attemptedUrls
    .add(
      normalizeUrlForComparison(
        rawUrl
      )
    );
}

export function hasNavigationUrlBeenAttempted(
  state: NavigationUrlState,
  rawUrl: string
): boolean {
  return state
    .attemptedUrls
    .has(
      normalizeUrlForComparison(
        rawUrl
      )
    );
}

export function markFinalUrlInspected(
  state: NavigationUrlState,
  rawUrl: string
): void {
  state
    .inspectedFinalUrls
    .add(
      normalizeUrlForComparison(
        rawUrl
      )
    );
}

export function hasFinalUrlBeenInspected(
  state: NavigationUrlState,
  rawUrl: string
): boolean {
  return state
    .inspectedFinalUrls
    .has(
      normalizeUrlForComparison(
        rawUrl
      )
    );
}

export function recordNavigationResolution(
  state: NavigationUrlState,
  requestedRawUrl: string,
  finalRawUrl: string
): NavigationResolution {
  const requestedUrl =
    normalizeUrlForComparison(
      requestedRawUrl
    );

  const finalUrl =
    normalizeUrlForComparison(
      finalRawUrl
    );

  const isRedirectAlias =
    requestedUrl !==
    finalUrl;

  if (
    isRedirectAlias
  ) {
    state
      .requestedToFinalAliases
      .set(
        requestedUrl,
        finalUrl
      );
  }

  return {
    requestedUrl,
    finalUrl,
    isRedirectAlias,
    finalUrlAlreadyInspected:
      state
        .inspectedFinalUrls
        .has(
          finalUrl
        )
  };
}

export function isNavigationUrlEligible(
  state: NavigationUrlState,
  rawUrl: string
): boolean {
  const normalizedUrl =
    normalizeUrlForComparison(
      rawUrl
    );

  return (
    !state
      .attemptedUrls
      .has(
        normalizedUrl
      ) &&
    !state
      .inspectedFinalUrls
      .has(
        normalizedUrl
      )
  );
}

export function getEligibleNavigationLinks(
  links: NavigationLink[],
  state: NavigationUrlState
): NavigationLink[] {
  return links.filter(
    link =>
      isNavigationUrlEligible(
        state,
        link.url
      )
  );
}

export function markUrlVisited(
  visitedUrls: Set<string>,
  rawUrl: string
): void {
  visitedUrls.add(
    normalizeUrlForComparison(rawUrl)
  );
}

export function hasVisitedUrl(
  visitedUrls: Set<string>,
  rawUrl: string
): boolean {
  return visitedUrls.has(
    normalizeUrlForComparison(rawUrl)
  );
}

export function getUnvisitedLinks(
  links: NavigationLink[],
  visitedUrls: Set<string>
): NavigationLink[] {
  return links.filter(
    (link) => !hasVisitedUrl(visitedUrls, link.url)
  );
}
