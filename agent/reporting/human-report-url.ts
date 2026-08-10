export interface HumanReportUrlContext {
  siteOrigin: string | null;
}

export interface HumanReportUrlPresentation {
  displayText: string;
  href: string | null;
}

const maximumDisplayedPathLength = 96;
const displayedPathPrefixLength = 56;
const displayedPathSuffixLength = 32;

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function compactPath(pathname: string): string {
  if (pathname.length <= maximumDisplayedPathLength) {
    return pathname;
  }

  return `${pathname.slice(0, displayedPathPrefixLength)}…${pathname.slice(
    -displayedPathSuffixLength
  )}`;
}

/**
 * Creates presentation-only URL context from the authoritative inspected
 * start-page URL retained in report state. This value must not be used by
 * identity, occurrence, reconciliation, fingerprint, or serialization code.
 */
export function createHumanReportUrlContext(
  authoritativeInspectedStartPageUrl: string
): HumanReportUrlContext {
  return {
    siteOrigin: parseHttpUrl(authoritativeInspectedStartPageUrl)?.origin ?? null
  };
}

/**
 * Projects an authoritative URL into human-report display data. The original
 * value is retained as the href for valid HTTP(S) URLs. Queries and fragments
 * are deliberately preserved so this local formatter cannot collapse distinct
 * occurrence locations.
 */
export function createHumanReportUrlPresentation(
  authoritativeUrl: string,
  context: HumanReportUrlContext
): HumanReportUrlPresentation {
  const parsed = parseHttpUrl(authoritativeUrl);

  if (parsed === null) {
    return {
      displayText: authoritativeUrl,
      href: null
    };
  }

  const path = compactPath(parsed.pathname || '/');
  const location = `${path}${parsed.search}${parsed.hash}`;

  return {
    displayText: parsed.origin === context.siteOrigin ? location : `${parsed.host}${location}`,
    href: authoritativeUrl
  };
}
