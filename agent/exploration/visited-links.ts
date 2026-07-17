import type { NavigationLink } from '../browser/inspect-navigation';

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
