import {
  createHash
} from 'node:crypto';

import type {
  FailedRequestObservation
} from '../browser/collect-page-diagnostics';
import type {
  ClassifiedDiagnostics,
  ClassifiedFailedRequest
} from './classify-diagnostics';
import type {
  ExploratoryQaAnalysis,
  ExploratoryQaFinding,
  TechnicalFailedRequestIdentity
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
    TechnicalFailedRequestIdentity
): string {
  return JSON.stringify(
    identity
  );
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
  const groupByReference =
    new Map(
      referenced.groups.map(
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
          createTechnicalEvidenceSummary(
            group.identity
          ),
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
    TechnicalFailedRequestIdentity
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
