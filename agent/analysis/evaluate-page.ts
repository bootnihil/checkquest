import type { VisitedPageObservation } from '../browser/visit-approved-link';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface PageFinding {
  code: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
  url: string;
}

export function evaluatePageObservation(observation: VisitedPageObservation): PageFinding[] {
  const findings: PageFinding[] = [];

  if (observation.httpStatus === null) {
    findings.push({
      code: 'HTTP_STATUS_UNKNOWN',
      severity: 'low',
      title: 'HTTP response status could not be determined',
      evidence: 'Playwright did not receive a main-document HTTP response status.',
      url: observation.finalUrl
    });
  } else if (observation.httpStatus >= 500) {
    findings.push({
      code: 'HTTP_SERVER_ERROR',
      severity: 'high',
      title: `Page returned HTTP ${observation.httpStatus}`,
      evidence: 'The main document returned a server-error response.',
      url: observation.finalUrl
    });
  } else if (observation.httpStatus >= 400) {
    findings.push({
      code: 'HTTP_CLIENT_ERROR',
      severity: 'high',
      title: `Page returned HTTP ${observation.httpStatus}`,
      evidence: 'The selected internal page returned a client-error response.',
      url: observation.finalUrl
    });
  }

  const normalizedTitle = observation.title.trim();

  if (normalizedTitle.length === 0) {
    findings.push({
      code: 'EMPTY_PAGE_TITLE',
      severity: 'medium',
      title: 'Page has no browser title',
      evidence: 'The document title was empty after navigation completed.',
      url: observation.finalUrl
    });
  }

  if (observation.headings.length === 0) {
    findings.push({
      code: 'NO_PRIMARY_HEADINGS',
      severity: 'low',
      title: 'No H1 or H2 headings were found',
      evidence: 'The page contained no visible text collected from H1 or H2 elements.',
      url: observation.finalUrl
    });
  }

  const visibleSummary = [observation.title, ...observation.headings].join(' ').toLowerCase();

  const obviousErrorText = /\b(page not found|not found|server error|access denied)\b/;

  if (
    obviousErrorText.test(visibleSummary) &&
    !findings.some(
      finding => finding.code === 'HTTP_SERVER_ERROR' || finding.code === 'HTTP_CLIENT_ERROR'
    )
  ) {
    findings.push({
      code: 'VISIBLE_ERROR_PAGE',
      severity: 'high',
      title: 'Page appears to display an error message',
      evidence:
        'The page title or headings contained wording commonly associated with an error page.',
      url: observation.finalUrl
    });
  }

  return findings;
}
