import type { UnifiedFinding } from '../findings/finding-model';
import {
  exploratoryQaFindingSchema,
  type TechnicalObservationIdentity
} from '../analysis/exploratory-qa-schema';
import {
  createTechnicalObservationFingerprint,
  isCrossOriginDnsFailureIdentity
} from '../analysis/technical-observation-reconciliation';
import type { SiteAgentReport } from './report-types';

export interface ReconciledRunSummaryProjection {
  inspectedPageCount: number;
  confirmedFindingCount: number;
  reviewFindingCount: number;
  technicalObservationCount: number;
  securityObservationCount: number;
  primaryFindingCount: number;
}

export type HumanReportItemClassification = 'finding' | 'technical-observation';

const PRESENTATION_RESOURCE_TYPES = new Set(['font', 'image', 'media', 'stylesheet']);

const PRESENTATION_RESOURCE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'css',
  'eot',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'mp3',
  'mp4',
  'ogg',
  'ogv',
  'otf',
  'png',
  'svg',
  'ttf',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2'
]);

function assertNever(value: never): never {
  throw new Error(`Unsupported technical observation identity: ${JSON.stringify(value)}`);
}

function getRuntimeTechnicalIdentity(finding: UnifiedFinding): TechnicalObservationIdentity | null {
  if (finding.category !== 'technical') {
    return null;
  }

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);
      const technicalIdentity = parsed.success ? (parsed.data.technicalIdentity ?? null) : null;

      if (
        technicalIdentity !== null &&
        finding.fingerprint === createTechnicalObservationFingerprint(technicalIdentity)
      ) {
        return technicalIdentity;
      }
    }
  }

  return null;
}

function isPresentationResourceUrl(resourceUrl: string): boolean {
  try {
    const pathname = new URL(resourceUrl).pathname;
    const extension = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();

    return extension !== undefined && PRESENTATION_RESOURCE_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

function classifyTechnicalIdentity(
  identity: TechnicalObservationIdentity
): HumanReportItemClassification {
  switch (identity.kind) {
    case 'cors':
      return 'technical-observation';

    case 'failed-request':
      if (isCrossOriginDnsFailureIdentity(identity)) {
        return 'technical-observation';
      }

      return PRESENTATION_RESOURCE_TYPES.has(identity.resourceType.toLowerCase())
        ? 'finding'
        : 'technical-observation';

    case 'console-error':
      return identity.source === 'resource' &&
        identity.sourceUrl !== null &&
        isPresentationResourceUrl(identity.sourceUrl)
        ? 'finding'
        : 'technical-observation';

    default:
      return assertNever(identity);
  }
}

export function classifyHumanReportItem(finding: UnifiedFinding): HumanReportItemClassification {
  if (finding.category !== 'technical' || !hasRuntimeTechnicalGrounding(finding)) {
    return 'finding';
  }

  const technicalIdentity = getRuntimeTechnicalIdentity(finding);

  return technicalIdentity === null
    ? 'technical-observation'
    : classifyTechnicalIdentity(technicalIdentity);
}

export function hasRuntimeTechnicalGrounding(finding: UnifiedFinding): boolean {
  if (finding.category !== 'technical') {
    return false;
  }

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.source === 'deterministic-rule') {
        return true;
      }

      if (evidence.source === 'browser' && evidence.kind === 'browser-observation') {
        return true;
      }

      if (getRuntimeTechnicalIdentity(finding) !== null) {
        return true;
      }
    }
  }

  return false;
}

export function isPrimaryHumanFinding(finding: UnifiedFinding): boolean {
  return (
    finding.verification.state !== 'not-verified' && classifyHumanReportItem(finding) === 'finding'
  );
}

export function isHumanTechnicalObservation(finding: UnifiedFinding): boolean {
  return (
    finding.verification.state !== 'not-verified' &&
    classifyHumanReportItem(finding) === 'technical-observation'
  );
}

/**
 * The single logical-count projection shared by run events and the human
 * report. Occurrences and affected pages never inflate item counts.
 */
export function buildReconciledRunSummaryProjection(
  report: SiteAgentReport
): ReconciledRunSummaryProjection {
  const primaryFindings = report.findings.filter(isPrimaryHumanFinding);
  const technicalObservations = report.findings.filter(isHumanTechnicalObservation);

  return {
    inspectedPageCount: report.inspectedPages.length,
    confirmedFindingCount: primaryFindings.filter(
      finding => finding.verification.state === 'verified'
    ).length,
    reviewFindingCount: primaryFindings.filter(
      finding => finding.verification.state === 'inconclusive'
    ).length,
    technicalObservationCount: technicalObservations.length,
    securityObservationCount: report.passiveSecurity.observations.length,
    primaryFindingCount: primaryFindings.length
  };
}
