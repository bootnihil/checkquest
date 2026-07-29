import {
  createHash
} from 'node:crypto';

import type {
  ConsoleErrorObservation,
  FailedRequestObservation
} from '../browser/collect-page-diagnostics';
import type {
  ClassifiedDiagnostics,
  ClassifiedFailedRequest
} from './classify-diagnostics';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding,
  TechnicalCorsIdentity,
  TechnicalFailedRequestIdentity,
  TechnicalObservationIdentity
} from './exploratory-qa-schema';

export interface ReferencedTechnicalRequestGroup {
  reference: string;
  identity:
    TechnicalFailedRequestIdentity;
  requests:
    ClassifiedFailedRequest[];
}

export interface ReferencedTechnicalRequests {
  groups:
    ReferencedTechnicalRequestGroup[];
  referenceByRequest:
    Map<
      FailedRequestObservation,
      string
  >;
}

export interface ReferencedTechnicalCorsGroup {
  reference: string;
  identity:
    TechnicalCorsIdentity;
  consoleErrors:
    ConsoleErrorObservation[];
}

export interface ReferencedTechnicalCorsDiagnostics {
  groups:
    ReferencedTechnicalCorsGroup[];
  referenceByConsoleError:
    Map<
      ConsoleErrorObservation,
      string
    >;
}

function createTechnicalIdentity(
  request:
    FailedRequestObservation,
  pageUrl:
    string
): TechnicalFailedRequestIdentity | null {
  const failureText =
    request.failureText
      .trim();
  const method =
    request.method
      .trim()
      .toUpperCase();
  const resourceType =
    request.resourceType
      .trim()
      .toLowerCase();

  if (
    failureText.length ===
      0 ||
    method.length ===
      0 ||
    resourceType.length ===
      0
  ) {
    return null;
  }

  let resourceUrl:
    URL;
  let inspectedPageUrl:
    URL;

  try {
    resourceUrl =
      new URL(
        request.url
      );
    inspectedPageUrl =
      new URL(
        pageUrl
      );
  } catch {
    return null;
  }

  if (
    (
      resourceUrl.protocol !==
        'http:' &&
      resourceUrl.protocol !==
        'https:'
    ) ||
    (
      inspectedPageUrl.protocol !==
        'http:' &&
      inspectedPageUrl.protocol !==
        'https:'
    )
  ) {
    return null;
  }

  resourceUrl.hash =
    '';

  return {
    kind:
      'failed-request',
    failureText,
    method,
    resourceType,
    resourceUrl:
      resourceUrl.href,
    originRelation:
      resourceUrl.origin ===
        inspectedPageUrl.origin
        ? 'same-origin'
        : 'cross-origin'
  };
}

function identityKey(
  identity:
    TechnicalObservationIdentity
): string {
  return JSON.stringify(
    identity
  );
}

function parseHttpUrl(
  value:
    string
): URL | null {
  try {
    const parsed =
      new URL(
        value
      );

    if (
      parsed.protocol !==
        'http:' &&
      parsed.protocol !==
        'https:'
    ) {
      return null;
    }

    parsed.hash =
      '';

    return parsed;
  } catch {
    return null;
  }
}

function createCorsIdentity(
  consoleError:
    ConsoleErrorObservation,
  failedRequests:
    ClassifiedFailedRequest[],
  pageUrl:
    string
): TechnicalCorsIdentity | null {
  const match =
    /^Access to (XMLHttpRequest|fetch) at '([^'\r\n]+)' from origin '([^'\r\n]+)' has been blocked by CORS policy:\s*(.+)$/u
      .exec(
        consoleError.text
      );

  if (
    match ===
      null
  ) {
    return null;
  }

  const requestKind =
    match[1];
  const resourceUrl =
    parseHttpUrl(
      match[2] ??
      ''
    );
  const requestingOriginUrl =
    parseHttpUrl(
      match[3] ??
      ''
    );
  const inspectedPageUrl =
    parseHttpUrl(
      pageUrl
    );
  const consoleSourceUrl =
    consoleError.sourceUrl ===
      null
      ? null
      : parseHttpUrl(
          consoleError.sourceUrl
        );
  const mechanism =
    (
      match[4] ??
      ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (
    resourceUrl ===
      null ||
    requestingOriginUrl ===
      null ||
    inspectedPageUrl ===
      null ||
    consoleSourceUrl ===
      null ||
    mechanism.length ===
      0 ||
    requestingOriginUrl.origin !==
      inspectedPageUrl.origin ||
    consoleSourceUrl.origin !==
      inspectedPageUrl.origin ||
    resourceUrl.origin ===
      requestingOriginUrl.origin
  ) {
    return null;
  }

  const resourceType =
    requestKind ===
      'XMLHttpRequest'
      ? 'xhr'
      : 'fetch';
  const matchingRequests =
    failedRequests.filter(
      item => {
        const failedUrl =
          parseHttpUrl(
            item.request.url
          );

        return (
          failedUrl !==
            null &&
          failedUrl.href ===
            resourceUrl.href &&
          item.request
            .resourceType
            .trim()
            .toLowerCase() ===
            resourceType &&
          item.request
            .failureText
            .trim() ===
            'net::ERR_FAILED'
        );
      }
    );

  if (
    matchingRequests.length !==
      1
  ) {
    return null;
  }

  const method =
    matchingRequests[0]
      ?.request
      .method
      .trim()
      .toUpperCase() ??
    '';

  if (
    method.length ===
      0
  ) {
    return null;
  }

  return {
    kind:
      'cors',
    mechanism,
    method,
    resourceType,
    resourceUrl:
      resourceUrl.href,
    requestingOrigin:
      requestingOriginUrl.origin,
    originRelation:
      'cross-origin'
  };
}

export function createReferencedTechnicalCorsDiagnostics(
  diagnostics:
    ClassifiedDiagnostics,
  pageUrl:
    string
): ReferencedTechnicalCorsDiagnostics {
  const groupsByIdentity =
    new Map<
      string,
      ReferencedTechnicalCorsGroup
    >();
  const referenceByConsoleError =
    new Map<
      ConsoleErrorObservation,
      string
    >();

  for (
    const consoleError of
      diagnostics.consoleErrors
  ) {
    const identity =
      createCorsIdentity(
        consoleError,
        diagnostics.failedRequests,
        pageUrl
      );

    if (
      identity ===
        null
    ) {
      continue;
    }

    const key =
      identityKey(
        identity
      );
    let group =
      groupsByIdentity.get(
        key
      );

    if (
      group ===
        undefined
    ) {
      group = {
        reference:
          `technical-cors-${groupsByIdentity.size + 1}`,
        identity,
        consoleErrors: []
      };
      groupsByIdentity.set(
        key,
        group
      );
    }

    group.consoleErrors.push(
      consoleError
    );
    referenceByConsoleError.set(
      consoleError,
      group.reference
    );
  }

  return {
    groups:
      Array.from(
        groupsByIdentity
          .values()
      ),
    referenceByConsoleError
  };
}

export function createReferencedTechnicalRequests(
  diagnostics:
    ClassifiedDiagnostics,
  pageUrl:
    string
): ReferencedTechnicalRequests {
  const groupsByIdentity =
    new Map<
      string,
      ReferencedTechnicalRequestGroup
    >();
  const referenceByRequest =
    new Map<
      FailedRequestObservation,
      string
    >();

  for (
    const item of
      diagnostics.failedRequests
  ) {
    if (
      item.disposition !==
      'actionable'
    ) {
      continue;
    }

    const identity =
      createTechnicalIdentity(
        item.request,
        pageUrl
      );

    if (
      identity ===
      null
    ) {
      continue;
    }

    const key =
      identityKey(
        identity
      );
    let group =
      groupsByIdentity.get(
        key
      );

    if (
      group ===
      undefined
    ) {
      group = {
        reference:
          `technical-request-${groupsByIdentity.size + 1}`,
        identity,
        requests: []
      };
      groupsByIdentity.set(
        key,
        group
      );
    }

    group.requests.push(
      item
    );
    referenceByRequest.set(
      item.request,
      group.reference
    );
  }

  return {
    groups:
      Array.from(
        groupsByIdentity
          .values()
      ),
    referenceByRequest
  };
}

function createTechnicalEvidenceSummary(
  identity:
    TechnicalFailedRequestIdentity
): string {
  return (
    `The ${identity.resourceType} request ` +
    `"${identity.resourceUrl}" failed with ` +
    `"${identity.failureText}".`
  );
}

function clearUntrustedTechnicalIdentity(
  finding:
    ExploratoryQaFinding
): ExploratoryQaFinding {
  return {
    ...finding,
    technicalEvidenceReferences:
      null,
    technicalIdentity:
      null
  };
}

export function normalizeTechnicalObservations(
  analysis:
    ExploratoryQaAnalysis,
  diagnostics:
    ClassifiedDiagnostics,
  pageUrl:
    string
): ExploratoryQaAnalysis {
  const referenced =
    createReferencedTechnicalRequests(
      diagnostics,
      pageUrl
    );
  const referencedCors =
    createReferencedTechnicalCorsDiagnostics(
      diagnostics,
      pageUrl
    );
  const groupByReference =
    new Map(
      [
        ...referenced.groups,
        ...referencedCors.groups
      ].map(
        group => [
          group.reference,
          group
        ] as const
      )
    );
  const findings:
    ExploratoryQaFinding[] =
      [];

  for (
    const originalFinding of
      analysis.findings
  ) {
    const finding =
      clearUntrustedTechnicalIdentity(
        originalFinding
      );
    const references =
      originalFinding
        .technicalEvidenceReferences;

    if (
      finding.category !==
        'technical' ||
      references ===
        undefined ||
      references ===
        null ||
      references.length ===
        0
    ) {
      findings.push(
        finding
      );
      continue;
    }

    const uniqueReferences =
      Array.from(
        new Set(
          references
        )
      );
    const groups =
      uniqueReferences.map(
        reference =>
          groupByReference.get(
            reference
          )
      );

    if (
      uniqueReferences.length !==
        references.length ||
      groups.some(
        group =>
          group ===
          undefined
      )
    ) {
      findings.push(
        finding
      );
      continue;
    }

    for (
      const group of
        groups
    ) {
      if (
        group ===
        undefined
      ) {
        continue;
      }

      findings.push({
        ...finding,
        evidence:
          group.identity.kind ===
            'failed-request'
            ? createTechnicalEvidenceSummary(
                group.identity
              )
            : finding.evidence,
        evidenceTarget:
          null,
        presentationTarget:
          null,
        structuredIdentity:
          null,
        technicalEvidenceReferences: [
          group.reference
        ],
        technicalIdentity:
          group.identity
      });
    }
  }

  return {
    ...analysis,
    findings
  };
}

export function createTechnicalObservationFingerprint(
  identity:
    TechnicalObservationIdentity
): string {
  const resourceUrl =
    new URL(
      identity.resourceUrl
    );
  const resourceDigest =
    createHash(
      'sha256'
    )
      .update(
        identity.resourceUrl
      )
      .digest(
        'hex'
      )
      .slice(
        0,
        16
      );

  if (
    identity.kind ===
      'failed-request'
  ) {
    return [
      'technical',
      identity.kind,
      identity.failureText
        .toLowerCase(),
      identity.method
        .toLowerCase(),
      identity.resourceType,
      identity.originRelation,
      resourceUrl.hostname
        .toLowerCase(),
      resourceDigest
    ].join(
      '|'
    );
  }

  return [
    'technical',
    identity.kind,
    identity.mechanism
      .toLowerCase(),
    identity.method
      .toLowerCase(),
    identity.resourceType,
    identity.originRelation,
    identity.requestingOrigin
      .toLowerCase(),
    resourceUrl.hostname
      .toLowerCase(),
    resourceDigest
  ].join(
    '|'
  );
}
