import {
  exploratoryQaFindingSchema,
  type TechnicalFailedRequestIdentity
} from '../analysis/exploratory-qa-schema';
import { isCrossOriginDnsFailureIdentity } from '../analysis/technical-observation-reconciliation';
import { deriveLogicalFindingVerification } from './derive-verification-state';
import type { FindingEvidence, UnifiedFinding } from './finding-model';

const CORRELATED_DNS_HOST_THRESHOLD = 3;

const CORRELATED_DNS_TITLE = 'Correlated cross-origin DNS resolution failures observed';

const OBSERVER_ENVIRONMENT_CAUSES =
  'local DNS policy, filtering, privacy tooling, proxy configuration, or another observer-environment condition';

interface CrossOriginDnsFinding {
  finding: UnifiedFinding;
  identity: TechnicalFailedRequestIdentity;
  hostname: string;
}

function getCrossOriginDnsIdentity(finding: UnifiedFinding): TechnicalFailedRequestIdentity | null {
  if (finding.category !== 'technical') {
    return null;
  }

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);
      const identity = parsed.success ? parsed.data.technicalIdentity : null;

      if (
        identity !== null &&
        identity !== undefined &&
        identity.kind === 'failed-request' &&
        isCrossOriginDnsFailureIdentity(identity)
      ) {
        return identity;
      }
    }
  }

  return null;
}

function createPatternEvidence(finding: UnifiedFinding, hostnameCount: number): FindingEvidence {
  const firstOccurrence = finding.occurrences[0]!;

  return {
    evidenceReference: `evidence-${firstOccurrence.occurrenceReference}-dns-pattern`,
    source: 'browser',
    kind: 'browser-observation',
    relation: 'inconclusive',
    verificationCapable: false,
    summary: `Several distinct cross-origin hosts (${hostnameCount}) failed DNS resolution in the observed browser environment. The correlated pattern may originate from ${OBSERVER_ENVIRONMENT_CAUSES}, so it cannot be attributed to the inspected site without separate evidence.`
  };
}

function createCorrelatedDnsFinding(
  qualifying: readonly CrossOriginDnsFinding[],
  hostnames: readonly string[]
): UnifiedFinding {
  const firstFinding = qualifying[0]!.finding;
  const occurrences = qualifying.flatMap(item =>
    item.finding.occurrences.map(occurrence => ({
      ...occurrence,
      evidence: [...occurrence.evidence],
      screenshotReferences: [...occurrence.screenshotReferences]
    }))
  );
  const patternEvidence = createPatternEvidence(firstFinding, hostnames.length);

  occurrences[0] = {
    ...occurrences[0]!,
    evidence: [patternEvidence, ...occurrences[0]!.evidence]
  };

  return {
    findingReference: firstFinding.findingReference,
    fingerprint: `technical|cross-origin-dns-environment-pattern|${hostnames.join(',')}`,
    category: 'technical',
    severity: 'low',
    title: CORRELATED_DNS_TITLE,
    description: patternEvidence.summary,
    suggestedCheck:
      'Compare the exact failures from an independently configured network environment before attributing cause or impact.',
    occurrences,
    verification: deriveLogicalFindingVerification(occurrences)
  };
}

export function applyRunTechnicalObservationPolicy(
  findings: readonly UnifiedFinding[]
): UnifiedFinding[] {
  const qualifying = findings.flatMap(finding => {
    const identity = getCrossOriginDnsIdentity(finding);

    if (identity === null) {
      return [];
    }

    return [
      {
        finding,
        identity,
        hostname: new URL(identity.resourceUrl).hostname.toLowerCase()
      }
    ];
  });
  const hostnames = Array.from(new Set(qualifying.map(item => item.hostname))).sort();

  if (hostnames.length < CORRELATED_DNS_HOST_THRESHOLD) {
    return [...findings];
  }

  const qualifyingFindings = new Set(qualifying.map(item => item.finding));
  const aggregate = createCorrelatedDnsFinding(qualifying, hostnames);
  const result: UnifiedFinding[] = [];
  let aggregateInserted = false;

  for (const finding of findings) {
    if (!qualifyingFindings.has(finding)) {
      result.push(finding);
      continue;
    }

    if (!aggregateInserted) {
      result.push(aggregate);
      aggregateInserted = true;
    }
  }

  return result;
}
