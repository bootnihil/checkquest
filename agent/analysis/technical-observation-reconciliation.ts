import { createHash } from 'node:crypto';

import type {
  ConsoleErrorObservation,
  FailedRequestObservation
} from '../browser/collect-page-diagnostics';
import type { ClassifiedDiagnostics, ClassifiedFailedRequest } from './classify-diagnostics';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding,
  TechnicalConsoleErrorIdentity,
  TechnicalCorsIdentity,
  TechnicalFailedRequestIdentity,
  TechnicalObservationIdentity
} from './exploratory-qa-schema';

export const CROSS_ORIGIN_DNS_FAILURE_TEXT = 'net::ERR_NAME_NOT_RESOLVED';

const CROSS_ORIGIN_DNS_TITLE = 'Cross-origin DNS resolution failure observed';

const OBSERVER_ENVIRONMENT_CAUSES =
  'local DNS policy, filtering, privacy tooling, proxy configuration, or another observer-environment condition';

export interface ReferencedTechnicalRequestGroup {
  reference: string;
  identity: TechnicalFailedRequestIdentity;
  requests: ClassifiedFailedRequest[];
}

export interface ReferencedTechnicalRequests {
  groups: ReferencedTechnicalRequestGroup[];
  referenceByRequest: Map<FailedRequestObservation, string>;
}

export interface ReferencedTechnicalCorsGroup {
  reference: string;
  identity: TechnicalCorsIdentity;
  consoleErrors: ConsoleErrorObservation[];
}

export interface ReferencedTechnicalCorsDiagnostics {
  groups: ReferencedTechnicalCorsGroup[];
  referenceByConsoleError: Map<ConsoleErrorObservation, string>;
}

export interface ReferencedTechnicalConsoleGroup {
  identity: TechnicalConsoleErrorIdentity;
  consoleErrors: ConsoleErrorObservation[];
}

export type TechnicalObservationDiagnostic =
  | { kind: 'console-error'; value: ConsoleErrorObservation }
  | { kind: 'failed-request'; value: FailedRequestObservation };

function createTechnicalIdentity(
  request: FailedRequestObservation,
  pageUrl: string
): TechnicalFailedRequestIdentity | null {
  const failureText = request.failureText.trim();
  const method = request.method.trim().toUpperCase();
  const resourceType = request.resourceType.trim().toLowerCase();

  if (failureText.length === 0 || method.length === 0 || resourceType.length === 0) {
    return null;
  }

  let resourceUrl: URL;
  let inspectedPageUrl: URL;

  try {
    resourceUrl = new URL(request.url);
    inspectedPageUrl = new URL(pageUrl);
  } catch {
    return null;
  }

  if (
    (resourceUrl.protocol !== 'http:' && resourceUrl.protocol !== 'https:') ||
    (inspectedPageUrl.protocol !== 'http:' && inspectedPageUrl.protocol !== 'https:')
  ) {
    return null;
  }

  resourceUrl.hash = '';

  return {
    kind: 'failed-request',
    failureText,
    method,
    resourceType,
    resourceUrl: resourceUrl.href,
    originRelation: resourceUrl.origin === inspectedPageUrl.origin ? 'same-origin' : 'cross-origin'
  };
}

export function isCrossOriginDnsFailureIdentity(identity: TechnicalObservationIdentity): boolean {
  return (
    identity.kind === 'failed-request' &&
    identity.originRelation === 'cross-origin' &&
    identity.failureText === CROSS_ORIGIN_DNS_FAILURE_TEXT
  );
}

function identityKey(identity: TechnicalObservationIdentity): string {
  return JSON.stringify(identity);
}

function normalizeDiagnosticMessage(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHttpStatus(value: string): number | null {
  const statuses = Array.from(value.matchAll(/\b([1-5]\d{2})\b/g), match => Number(match[1]));

  return statuses.length === 1 ? (statuses[0] ?? null) : null;
}

function extractExactCandidateUrl(value: string): string | null {
  const matches = value.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  if (matches.length !== 1) {
    return null;
  }

  const candidate = matches[0]?.replace(/[.,;:!?\]})]+$/g, '') ?? '';

  return parseHttpUrl(candidate) === null ? null : candidate;
}

function extractCandidateConsoleMessage(value: string): string | null {
  let candidate = normalizeDiagnosticMessage(value);

  candidate = candidate
    .replace(/^Error observed at lines?\s+[^:]+:\s*/i, '')
    .replace(/^Console error:\s*/i, '')
    .replace(/^The console reported(?: multiple errors)?:\s*/i, '')
    .replace(/\s+observed at lines?\s+[\d,\sand]+\.?$/i, '')
    .trim();

  const quoted = /^(?:['"])(.*)(?:['"])\.?$/s.exec(candidate);

  if (quoted?.[1] !== undefined) {
    candidate = quoted[1];
  }

  candidate = normalizeDiagnosticMessage(candidate);

  return candidate.length === 0 ? null : candidate;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    parsed.hash = '';

    return parsed;
  } catch {
    return null;
  }
}

function createConsoleErrorIdentity(
  consoleError: ConsoleErrorObservation,
  pageUrl: string
): TechnicalConsoleErrorIdentity | null {
  const message = normalizeDiagnosticMessage(consoleError.text);
  const sourceUrl = consoleError.sourceUrl === null ? null : parseHttpUrl(consoleError.sourceUrl);
  const inspectedPageUrl = parseHttpUrl(pageUrl);

  if (message.length === 0 || sourceUrl === null || inspectedPageUrl === null) {
    return null;
  }

  if (sourceUrl.href === inspectedPageUrl.href) {
    return {
      kind: 'console-error',
      message,
      source: 'inspected-page',
      sourceUrl: null,
      httpStatus: extractHttpStatus(message)
    };
  }

  return {
    kind: 'console-error',
    message,
    source: 'resource',
    sourceUrl: sourceUrl.href,
    httpStatus: extractHttpStatus(message)
  };
}

function createReferencedTechnicalConsoleDiagnostics(
  diagnostics: ClassifiedDiagnostics,
  pageUrl: string,
  corsDiagnostics: ReferencedTechnicalCorsDiagnostics
): ReferencedTechnicalConsoleGroup[] {
  const corsErrors = new Set(corsDiagnostics.referenceByConsoleError.keys());
  const groups = new Map<string, ReferencedTechnicalConsoleGroup>();

  for (const consoleError of diagnostics.consoleErrors) {
    if (corsErrors.has(consoleError)) {
      continue;
    }

    const identity = createConsoleErrorIdentity(consoleError, pageUrl);

    if (identity === null) {
      continue;
    }

    const key = identityKey(identity);
    const group = groups.get(key) ?? { identity, consoleErrors: [] };

    group.consoleErrors.push(consoleError);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

function hasCompatibleExistingIdentity(
  existing: TechnicalObservationIdentity | null | undefined,
  matched: TechnicalObservationIdentity
): boolean {
  return (
    existing === null || existing === undefined || identityKey(existing) === identityKey(matched)
  );
}

function matchUnreferencedConsoleDiagnostic(
  finding: ExploratoryQaFinding,
  groups: readonly ReferencedTechnicalConsoleGroup[]
): ReferencedTechnicalConsoleGroup | null {
  const urls = finding.evidence.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const extractedUrl = extractExactCandidateUrl(finding.evidence);
  const status = extractHttpStatus(finding.evidence);

  if (urls.length === 1 && extractedUrl !== null && status !== null) {
    const resourceMatches = groups.filter(
      group =>
        group.identity.source === 'resource' &&
        group.identity.sourceUrl === extractedUrl &&
        group.identity.httpStatus === status
    );

    if (
      resourceMatches.length === 1 &&
      hasCompatibleExistingIdentity(finding.technicalIdentity, resourceMatches[0]!.identity)
    ) {
      return resourceMatches[0] ?? null;
    }
  }

  if (urls.length > 0) {
    return null;
  }

  const message = extractCandidateConsoleMessage(finding.evidence);

  if (message === null) {
    return null;
  }

  const messageMatches = groups.filter(
    group =>
      group.identity.message === message &&
      group.identity.source === 'inspected-page' &&
      hasCompatibleExistingIdentity(finding.technicalIdentity, group.identity)
  );

  return messageMatches.length === 1 ? (messageMatches[0] ?? null) : null;
}

function createCorsIdentity(
  consoleError: ConsoleErrorObservation,
  failedRequests: ClassifiedFailedRequest[],
  pageUrl: string
): TechnicalCorsIdentity | null {
  const match =
    /^Access to (XMLHttpRequest|fetch) at '([^'\r\n]+)' from origin '([^'\r\n]+)' has been blocked by CORS policy:\s*(.+)$/u.exec(
      consoleError.text
    );

  if (match === null) {
    return null;
  }

  const requestKind = match[1];
  const resourceUrl = parseHttpUrl(match[2] ?? '');
  const requestingOriginUrl = parseHttpUrl(match[3] ?? '');
  const inspectedPageUrl = parseHttpUrl(pageUrl);
  const consoleSourceUrl =
    consoleError.sourceUrl === null ? null : parseHttpUrl(consoleError.sourceUrl);
  const mechanism = (match[4] ?? '').replace(/\s+/g, ' ').trim();

  if (
    resourceUrl === null ||
    requestingOriginUrl === null ||
    inspectedPageUrl === null ||
    consoleSourceUrl === null ||
    mechanism.length === 0 ||
    requestingOriginUrl.origin !== inspectedPageUrl.origin ||
    consoleSourceUrl.origin !== inspectedPageUrl.origin ||
    resourceUrl.origin === requestingOriginUrl.origin
  ) {
    return null;
  }

  const resourceType = requestKind === 'XMLHttpRequest' ? 'xhr' : 'fetch';
  const matchingRequests = failedRequests.filter(item => {
    const failedUrl = parseHttpUrl(item.request.url);

    return (
      failedUrl !== null &&
      failedUrl.href === resourceUrl.href &&
      item.request.resourceType.trim().toLowerCase() === resourceType &&
      item.request.failureText.trim() === 'net::ERR_FAILED'
    );
  });

  if (matchingRequests.length !== 1) {
    return null;
  }

  const method = matchingRequests[0]?.request.method.trim().toUpperCase() ?? '';

  if (method.length === 0) {
    return null;
  }

  return {
    kind: 'cors',
    mechanism,
    method,
    resourceType,
    resourceUrl: resourceUrl.href,
    requestingOrigin: requestingOriginUrl.origin,
    originRelation: 'cross-origin'
  };
}

export function createReferencedTechnicalCorsDiagnostics(
  diagnostics: ClassifiedDiagnostics,
  pageUrl: string
): ReferencedTechnicalCorsDiagnostics {
  const groupsByIdentity = new Map<string, ReferencedTechnicalCorsGroup>();
  const referenceByConsoleError = new Map<ConsoleErrorObservation, string>();

  for (const consoleError of diagnostics.consoleErrors) {
    const identity = createCorsIdentity(consoleError, diagnostics.failedRequests, pageUrl);

    if (identity === null) {
      continue;
    }

    const key = identityKey(identity);
    let group = groupsByIdentity.get(key);

    if (group === undefined) {
      group = {
        reference: `technical-cors-${groupsByIdentity.size + 1}`,
        identity,
        consoleErrors: []
      };
      groupsByIdentity.set(key, group);
    }

    group.consoleErrors.push(consoleError);
    referenceByConsoleError.set(consoleError, group.reference);
  }

  return {
    groups: Array.from(groupsByIdentity.values()),
    referenceByConsoleError
  };
}

export function createReferencedTechnicalRequests(
  diagnostics: ClassifiedDiagnostics,
  pageUrl: string
): ReferencedTechnicalRequests {
  const groupsByIdentity = new Map<string, ReferencedTechnicalRequestGroup>();
  const referenceByRequest = new Map<FailedRequestObservation, string>();

  for (const item of diagnostics.failedRequests) {
    if (item.disposition !== 'actionable') {
      continue;
    }

    const identity = createTechnicalIdentity(item.request, pageUrl);

    if (identity === null) {
      continue;
    }

    const key = identityKey(identity);
    let group = groupsByIdentity.get(key);

    if (group === undefined) {
      group = {
        reference: `technical-request-${groupsByIdentity.size + 1}`,
        identity,
        requests: []
      };
      groupsByIdentity.set(key, group);
    }

    group.requests.push(item);
    referenceByRequest.set(item.request, group.reference);
  }

  return {
    groups: Array.from(groupsByIdentity.values()),
    referenceByRequest
  };
}

function createTechnicalEvidenceSummary(identity: TechnicalFailedRequestIdentity): string {
  return (
    `The ${identity.resourceType} request ` +
    `"${identity.resourceUrl}" failed with ` +
    `"${identity.failureText}".`
  );
}

function applyCrossOriginDnsPolicy(
  finding: ExploratoryQaFinding,
  identity: TechnicalFailedRequestIdentity
): ExploratoryQaFinding {
  const evidence = createTechnicalEvidenceSummary(identity);

  return {
    ...finding,
    severity: 'low',
    confidence: 'medium',
    title: CROSS_ORIGIN_DNS_TITLE,
    evidence: `${evidence} The failure occurred in the observed browser environment and may reflect ${OBSERVER_ENVIRONMENT_CAUSES}; the request failure alone does not establish who caused it or whether users were affected.`,
    reasoning: `Because the failed request is cross-origin, this browser observation alone cannot distinguish a remote resource problem from ${OBSERVER_ENVIRONMENT_CAUSES}.`,
    suggestedCheck:
      'Review the exact request evidence and compare from an independently configured network environment before attributing cause or impact.'
  };
}

function clearUntrustedTechnicalIdentity(finding: ExploratoryQaFinding): ExploratoryQaFinding {
  return {
    ...finding,
    technicalEvidenceReferences: null,
    technicalIdentity: null
  };
}

export function normalizeTechnicalObservations(
  analysis: ExploratoryQaAnalysis,
  diagnostics: ClassifiedDiagnostics,
  pageUrl: string
): ExploratoryQaAnalysis {
  const referenced = createReferencedTechnicalRequests(diagnostics, pageUrl);
  const referencedCors = createReferencedTechnicalCorsDiagnostics(diagnostics, pageUrl);
  const referencedConsole = createReferencedTechnicalConsoleDiagnostics(
    diagnostics,
    pageUrl,
    referencedCors
  );
  const groupByReference = new Map(
    [...referenced.groups, ...referencedCors.groups].map(group => [group.reference, group] as const)
  );
  const findings: ExploratoryQaFinding[] = [];

  for (const originalFinding of analysis.findings) {
    const finding = clearUntrustedTechnicalIdentity(originalFinding);
    const references = originalFinding.technicalEvidenceReferences;

    if (
      finding.category !== 'technical' ||
      references === undefined ||
      references === null ||
      references.length === 0
    ) {
      const implicitMatch =
        finding.category === 'technical'
          ? matchUnreferencedConsoleDiagnostic(originalFinding, referencedConsole)
          : null;

      findings.push(
        implicitMatch === null
          ? finding
          : {
              ...finding,
              evidenceTarget: null,
              presentationTarget: null,
              structuredIdentity: null,
              technicalIdentity: implicitMatch.identity
            }
      );
      continue;
    }

    const uniqueReferences = Array.from(new Set(references));
    const groups = uniqueReferences.map(reference => groupByReference.get(reference));

    if (
      uniqueReferences.length !== references.length ||
      groups.some(group => group === undefined)
    ) {
      findings.push(finding);
      continue;
    }

    for (const group of groups) {
      if (group === undefined) {
        continue;
      }

      findings.push({
        ...(isCrossOriginDnsFailureIdentity(group.identity) &&
        group.identity.kind === 'failed-request'
          ? applyCrossOriginDnsPolicy(finding, group.identity)
          : {
              ...finding,
              evidence:
                group.identity.kind === 'failed-request'
                  ? createTechnicalEvidenceSummary(group.identity)
                  : finding.evidence
            }),
        evidenceTarget: null,
        presentationTarget: null,
        structuredIdentity: null,
        technicalEvidenceReferences: [group.reference],
        technicalIdentity: group.identity
      });
    }
  }

  return {
    ...analysis,
    findings
  };
}

export function createTechnicalObservationFingerprint(
  identity: TechnicalObservationIdentity
): string {
  if (identity.kind === 'console-error') {
    const sourceDigest =
      identity.sourceUrl === null
        ? 'inspected-page'
        : createHash('sha256').update(identity.sourceUrl).digest('hex').slice(0, 16);

    return [
      'technical',
      identity.kind,
      identity.source,
      identity.httpStatus ?? 'no-status',
      sourceDigest,
      createHash('sha256').update(identity.message).digest('hex').slice(0, 16)
    ].join('|');
  }

  const resourceUrl = new URL(identity.resourceUrl);
  const resourceDigest = createHash('sha256')
    .update(identity.resourceUrl)
    .digest('hex')
    .slice(0, 16);

  if (identity.kind === 'failed-request') {
    return [
      'technical',
      identity.kind,
      identity.failureText.toLowerCase(),
      identity.method.toLowerCase(),
      identity.resourceType,
      identity.originRelation,
      resourceUrl.hostname.toLowerCase(),
      resourceDigest
    ].join('|');
  }

  return [
    'technical',
    identity.kind,
    identity.mechanism.toLowerCase(),
    identity.method.toLowerCase(),
    identity.resourceType,
    identity.originRelation,
    identity.requestingOrigin.toLowerCase(),
    resourceUrl.hostname.toLowerCase(),
    resourceDigest
  ].join('|');
}

export function getTechnicalObservationDiagnostics(
  identity: TechnicalObservationIdentity,
  diagnostics: ClassifiedDiagnostics,
  pageUrl: string
): TechnicalObservationDiagnostic[] {
  if (identity.kind === 'failed-request') {
    return diagnostics.failedRequests
      .filter(item => {
        const candidate = createTechnicalIdentity(item.request, pageUrl);

        return candidate !== null && identityKey(candidate) === identityKey(identity);
      })
      .map(item => ({ kind: 'failed-request' as const, value: item.request }));
  }

  if (identity.kind === 'cors') {
    const referenced = createReferencedTechnicalCorsDiagnostics(diagnostics, pageUrl);
    const group = referenced.groups.find(
      item => identityKey(item.identity) === identityKey(identity)
    );

    return (group?.consoleErrors ?? []).map(value => ({ kind: 'console-error' as const, value }));
  }

  const referencedCors = createReferencedTechnicalCorsDiagnostics(diagnostics, pageUrl);
  const group = createReferencedTechnicalConsoleDiagnostics(
    diagnostics,
    pageUrl,
    referencedCors
  ).find(item => identityKey(item.identity) === identityKey(identity));

  return (group?.consoleErrors ?? []).map(value => ({ kind: 'console-error' as const, value }));
}
