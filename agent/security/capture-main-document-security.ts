import type { Request, Response } from '@playwright/test';

import {
  selectedSecurityHeaderNames,
  type PassivePageSecuritySnapshot,
  type PassiveRedirectEvidence,
  type SelectedSecurityHeaderName,
  type SelectedSecurityHeaders
} from './passive-security-model';

const maximumHeaderValuesPerName = 10;

const maximumHeaderValueLength = 4_000;

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';

    return url.toString();
  } catch {
    return '[unparseable URL redacted]';
  }
}

function sanitizeRedirectLocation(location: string, responseUrl: string): string {
  try {
    return sanitizeUrl(new URL(location, responseUrl).toString());
  } catch {
    return '[unparseable redirect location redacted]';
  }
}

function sanitizeCspToken(token: string): string {
  const directiveTerminator = token.endsWith(';') ? ';' : '';

  const tokenValue =
    directiveTerminator.length > 0 ? token.slice(0, -directiveTerminator.length) : token;

  if (/^'nonce-/i.test(tokenValue)) {
    return "'nonce-[redacted]'" + directiveTerminator;
  }

  if (/^'sha(?:256|384|512)-/i.test(tokenValue)) {
    const algorithm = tokenValue.slice(1).split('-', 1)[0];

    return `'${algorithm}-[redacted]'` + directiveTerminator;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(tokenValue)) {
    return sanitizeUrl(tokenValue) + directiveTerminator;
  }

  if (tokenValue.startsWith('//')) {
    return sanitizeUrl(`https:${tokenValue}`).replace(/^https:/, '') + directiveTerminator;
  }

  if (tokenValue.includes('?') || tokenValue.includes('#')) {
    return tokenValue.split(/[?#]/, 1)[0] + '?[redacted]' + directiveTerminator;
  }

  return token;
}

export function sanitizePassiveSecurityHeaderValue(
  headerName: SelectedSecurityHeaderName,
  value: string
): string {
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();

  const sanitized =
    headerName === 'content-security-policy' || headerName === 'content-security-policy-report-only'
      ? normalized.split(/\s+/).map(sanitizeCspToken).join(' ')
      : normalized;

  return sanitized.slice(0, maximumHeaderValueLength);
}

async function captureSelectedHeaders(response: Response): Promise<SelectedSecurityHeaders> {
  const entries = await Promise.all(
    selectedSecurityHeaderNames.map(async headerName => {
      const values = await response.headerValues(headerName);

      if (values.length === 0) {
        return null;
      }

      return [
        headerName,
        values
          .slice(0, maximumHeaderValuesPerName)
          .map(value => sanitizePassiveSecurityHeaderValue(headerName, value))
      ] as const;
    })
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [SelectedSecurityHeaderName, string[]] => entry !== null
    )
  );
}

function getRedirectChain(finalRequest: Request): Request[] {
  const requests: Request[] = [];

  let current: Request | null = finalRequest;

  while (current !== null) {
    requests.unshift(current);

    current = current.redirectedFrom();
  }

  return requests;
}

async function captureRedirects(response: Response): Promise<PassiveRedirectEvidence[]> {
  const requests = getRedirectChain(response.request());

  const redirects: PassiveRedirectEvidence[] = [];

  for (const request of requests.slice(0, -1)) {
    const redirectResponse = await request.response();

    if (
      redirectResponse === null ||
      redirectResponse.status() < 300 ||
      redirectResponse.status() > 399
    ) {
      continue;
    }

    const location = await redirectResponse.headerValue('location');

    redirects.push({
      requestedUrl: sanitizeUrl(request.url()),
      responseUrl: sanitizeUrl(redirectResponse.url()),
      status: redirectResponse.status(),
      location:
        location === null ? null : sanitizeRedirectLocation(location, redirectResponse.url())
    });
  }

  return redirects;
}

export interface CaptureMainDocumentSecurityInput {
  response: Response | null;
  requestedUrl: string;
  finalUrl: string;
  pageTitle: string;
}

export async function captureMainDocumentSecurity(
  input: CaptureMainDocumentSecurityInput
): Promise<PassivePageSecuritySnapshot> {
  const finalUrl = new URL(input.finalUrl);

  if (finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') {
    throw new Error(
      `Passive main-document security capture supports only HTTP and HTTPS final URLs. Received: ${finalUrl.protocol}.`
    );
  }

  return {
    requestedUrl: sanitizeUrl(input.requestedUrl),
    finalUrl: sanitizeUrl(finalUrl.toString()),
    responseUrl:
      input.response === null
        ? sanitizeUrl(finalUrl.toString())
        : sanitizeUrl(input.response.url()),
    responseStatus: input.response?.status() ?? null,
    responseReceived: input.response !== null,
    finalScheme: finalUrl.protocol,
    origin: finalUrl.origin,
    pageTitle: input.pageTitle,
    redirects: input.response === null ? [] : await captureRedirects(input.response),
    headers: input.response === null ? {} : await captureSelectedHeaders(input.response)
  };
}
