import type {
  PassivePageSecuritySnapshot,
  PassiveSecurityCategory,
  PassiveSecurityConfidence,
  PassiveSecurityEvidence,
  PassiveSecurityOccurrence,
  PassiveSecurityPosture,
  PassiveSecurityScope,
  PassiveSecuritySeverity,
  SelectedSecurityHeaderName
} from './passive-security-model';

export interface PassiveSecurityObservationDraft {
  fingerprint: string;
  code: string;
  category: PassiveSecurityCategory;
  posture: PassiveSecurityPosture;
  severity: PassiveSecuritySeverity;
  confidence: PassiveSecurityConfidence;
  source: 'deterministic-passive';
  scope: PassiveSecurityScope;
  subject: string;
  title: string;
  description: string;
  remediation: string | null;
  occurrence: PassiveSecurityOccurrence;
}

function getHeaderValues(
  snapshot: PassivePageSecuritySnapshot,
  headerName: SelectedSecurityHeaderName
): string[] {
  return snapshot.headers[headerName] ?? [];
}

function createEvidence(input: {
  kind: PassiveSecurityEvidence['kind'];
  subject: string;
  summary: string;
  headerName?: SelectedSecurityHeaderName;
  headerValues?: string[];
}): PassiveSecurityEvidence {
  return {
    kind: input.kind,
    subject: input.subject,
    summary: input.summary,
    ...(input.headerName === undefined
      ? {}
      : {
          headerName: input.headerName
        }),
    ...(input.headerValues === undefined
      ? {}
      : {
          headerValues: [...input.headerValues]
        })
  };
}

function createDraft(
  snapshot: PassivePageSecuritySnapshot,
  input: {
    code: string;
    category: PassiveSecurityCategory;
    posture: PassiveSecurityPosture;
    severity: PassiveSecuritySeverity;
    confidence: PassiveSecurityConfidence;
    subject: string;
    title: string;
    description: string;
    remediation: string | null;
    evidence: PassiveSecurityEvidence[];
  }
): PassiveSecurityObservationDraft {
  const scope: PassiveSecurityScope = {
    type: 'origin',
    key: snapshot.origin
  };

  return {
    fingerprint: [scope.key, input.code, input.subject].join('|'),
    code: input.code,
    category: input.category,
    posture: input.posture,
    severity: input.severity,
    confidence: input.confidence,
    source: 'deterministic-passive',
    scope,
    subject: input.subject,
    title: input.title,
    description: input.description,
    remediation: input.remediation,
    occurrence: {
      pageUrl: snapshot.finalUrl,
      pageTitle: snapshot.pageTitle,
      responseUrl: snapshot.responseUrl,
      evidence: input.evidence
    }
  };
}

type HstsAssessment = 'enforcing' | 'not-enforcing';

function assessHstsValue(value: string): HstsAssessment {
  const maxAgeDirectives = value
    .split(';')
    .map(directive => directive.trim())
    .filter(directive => /^max-age(?:\s*=|$)/i.test(directive));

  if (maxAgeDirectives.length !== 1) {
    return 'not-enforcing';
  }

  const match = /^max-age\s*=\s*(\d+)$/i.exec(maxAgeDirectives[0]);

  if (match === null) {
    return 'not-enforcing';
  }

  try {
    return BigInt(match[1]) > 0n ? 'enforcing' : 'not-enforcing';
  } catch {
    return 'not-enforcing';
  }
}

function hasValidFrameAncestorsDirective(cspValues: readonly string[]): boolean {
  return cspValues.some(policy => {
    const tokens =
      policy
        .split(';')
        .map(directive => directive.trim().split(/\s+/))
        .find(directiveTokens => directiveTokens[0]?.toLowerCase() === 'frame-ancestors') ?? null;

    if (tokens === null || tokens.length < 2) {
      return false;
    }

    const sources = tokens.slice(1);

    if (
      sources.some(
        source =>
          source.length === 0 ||
          source.includes(',') ||
          (source.startsWith("'") &&
            source.toLowerCase() !== "'none'" &&
            source.toLowerCase() !== "'self'")
      )
    ) {
      return false;
    }

    const noneCount = sources.filter(source => source.toLowerCase() === "'none'").length;

    return noneCount === 0 || (noneCount === 1 && sources.length === 1);
  });
}

function hasValidXFrameOptions(values: readonly string[]): boolean {
  return values.some(value => {
    const normalized = value.trim().toUpperCase();

    return normalized === 'DENY' || normalized === 'SAMEORIGIN';
  });
}

function hasEnforcingNosniff(values: readonly string[]): boolean {
  return values.some(value => value.trim().toLowerCase() === 'nosniff');
}

export function evaluatePassiveSecurity(
  snapshot: PassivePageSecuritySnapshot
): PassiveSecurityObservationDraft[] {
  const drafts: PassiveSecurityObservationDraft[] = [];

  if (snapshot.finalScheme === 'http:') {
    drafts.push(
      createDraft(snapshot, {
        code: 'PS_HTTP_DOCUMENT',
        category: 'transport',
        posture: 'misconfiguration',
        severity: 'medium',
        confidence: 'high',
        subject: 'main-document-transport',
        title: 'Main document was delivered over HTTP',
        description:
          'The final inspected main-document URL used unencrypted HTTP transport. This is a configuration observation and does not by itself demonstrate exploitability.',
        remediation:
          'Serve the main document over HTTPS and redirect normal HTTP navigation as appropriate.',
        evidence: [
          createEvidence({
            kind: 'transport',
            subject: 'main-document-transport',
            summary: `Final inspected URL used HTTP: ${snapshot.finalUrl}.`
          })
        ]
      })
    );
  }

  if (!snapshot.responseReceived) {
    return drafts;
  }

  const hstsValues = getHeaderValues(snapshot, 'strict-transport-security');

  if (snapshot.finalScheme === 'https:') {
    if (hstsValues.length === 0) {
      drafts.push(
        createDraft(snapshot, {
          code: 'PS_HSTS_NOT_OBSERVED',
          category: 'transport',
          posture: 'defense-in-depth-gap',
          severity: 'low',
          confidence: 'medium',
          subject: 'strict-transport-security',
          title: 'HSTS response header was not observed',
          description:
            'An enforcing Strict-Transport-Security header was not observed on this HTTPS response. This response-level absence does not prove that the browser lacks an inherited or preloaded HSTS policy.',
          remediation:
            'Consider returning an enforcing Strict-Transport-Security header from HTTPS responses after confirming that HTTPS is supported consistently.',
          evidence: [
            createEvidence({
              kind: 'response-header',
              subject: 'strict-transport-security',
              summary:
                'The HTTPS main-document response did not contain a Strict-Transport-Security header.',
              headerName: 'strict-transport-security',
              headerValues: []
            })
          ]
        })
      );
    } else if (!hstsValues.some(value => assessHstsValue(value) === 'enforcing')) {
      drafts.push(
        createDraft(snapshot, {
          code: 'PS_HSTS_NOT_ENFORCING',
          category: 'transport',
          posture: 'misconfiguration',
          severity: 'low',
          confidence: 'high',
          subject: 'strict-transport-security',
          title: 'Observed HSTS response header was not enforcing',
          description:
            'The HTTPS response included Strict-Transport-Security, but no observed value contained exactly one valid positive max-age directive. CheckQuest did not grade the positive duration, includeSubDomains, or preload.',
          remediation:
            'Return a syntactically valid Strict-Transport-Security header with a positive max-age after confirming the intended deployment policy.',
          evidence: [
            createEvidence({
              kind: 'response-header',
              subject: 'strict-transport-security',
              summary:
                'The observed Strict-Transport-Security value lacked a valid positive max-age directive.',
              headerName: 'strict-transport-security',
              headerValues: hstsValues
            })
          ]
        })
      );
    }
  }

  const cspValues = getHeaderValues(snapshot, 'content-security-policy');

  if (cspValues.length === 0) {
    const reportOnlyValues = getHeaderValues(snapshot, 'content-security-policy-report-only');

    drafts.push(
      createDraft(snapshot, {
        code: 'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED',
        category: 'response-policy',
        posture: 'defense-in-depth-gap',
        severity: 'low',
        confidence: 'high',
        subject: 'content-security-policy',
        title: 'Enforcing CSP response header was not observed',
        description:
          'An enforcing Content-Security-Policy response header was not observed. A report-only policy, when present, does not enforce restrictions. CheckQuest did not grade CSP directives or source lists.',
        remediation:
          'Consider deploying an enforcing Content-Security-Policy response header appropriate to the application.',
        evidence: [
          createEvidence({
            kind: 'response-header',
            subject: 'content-security-policy',
            summary:
              reportOnlyValues.length > 0
                ? 'No enforcing Content-Security-Policy response header was observed; a report-only header was present.'
                : 'No enforcing Content-Security-Policy response header was observed.',
            headerName: 'content-security-policy',
            headerValues: []
          })
        ]
      })
    );
  }

  const nosniffValues = getHeaderValues(snapshot, 'x-content-type-options');

  if (!hasEnforcingNosniff(nosniffValues)) {
    drafts.push(
      createDraft(snapshot, {
        code: 'PS_NOSNIFF_NOT_ENFORCING',
        category: 'response-policy',
        posture: 'defense-in-depth-gap',
        severity: 'low',
        confidence: 'high',
        subject: 'x-content-type-options',
        title: 'X-Content-Type-Options nosniff was not enforcing',
        description:
          'The main-document response did not contain an X-Content-Type-Options value that normalized exactly to nosniff. This is a response-policy observation and does not imply an XSS vulnerability.',
        remediation:
          'Consider returning X-Content-Type-Options: nosniff with correctly configured response content types.',
        evidence: [
          createEvidence({
            kind: 'response-header',
            subject: 'x-content-type-options',
            summary:
              nosniffValues.length === 0
                ? 'The X-Content-Type-Options response header was absent.'
                : 'The observed X-Content-Type-Options value did not normalize exactly to nosniff.',
            headerName: 'x-content-type-options',
            headerValues: nosniffValues
          })
        ]
      })
    );
  }

  const xfoValues = getHeaderValues(snapshot, 'x-frame-options');

  if (!hasValidFrameAncestorsDirective(cspValues) && !hasValidXFrameOptions(xfoValues)) {
    drafts.push(
      createDraft(snapshot, {
        code: 'PS_FRAME_POLICY_NOT_OBSERVED',
        category: 'frame-protection',
        posture: 'informational',
        severity: 'info',
        confidence: 'high',
        subject: 'frame-embedding-policy',
        title: 'Frame-embedding restriction was not observed',
        description:
          'Neither an enforcing CSP frame-ancestors directive nor X-Frame-Options DENY or SAMEORIGIN was observed. Embedding may be intentional; this is not a clickjacking vulnerability finding.',
        remediation:
          'Confirm whether cross-origin embedding is intended and configure frame-ancestors or a valid X-Frame-Options policy when restriction is appropriate.',
        evidence: [
          createEvidence({
            kind: 'response-header',
            subject: 'frame-embedding-policy',
            summary:
              'No enforcing CSP frame-ancestors directive or valid DENY/SAMEORIGIN X-Frame-Options value was observed.',
            headerName: 'x-frame-options',
            headerValues: xfoValues
          })
        ]
      })
    );
  }

  for (const headerName of ['server', 'x-powered-by'] as const) {
    const values = getHeaderValues(snapshot, headerName);

    if (values.length === 0) {
      continue;
    }

    drafts.push(
      createDraft(snapshot, {
        code: 'PS_TECHNOLOGY_DISCLOSURE',
        category: 'technology-disclosure',
        posture: 'informational',
        severity: 'info',
        confidence: 'high',
        subject: headerName,
        title: `${headerName === 'server' ? 'Server' : 'X-Powered-By'} response header was observed`,
        description: `The ${headerName === 'server' ? 'Server' : 'X-Powered-By'} response header disclosed technology information. This is inventory information and is not a defect by itself.`,
        remediation: null,
        evidence: [
          createEvidence({
            kind: 'response-header',
            subject: headerName,
            summary: `The ${headerName} response header was present.`,
            headerName,
            headerValues: values
          })
        ]
      })
    );
  }

  return drafts;
}
