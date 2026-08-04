import {
  evaluatePassiveSecurity,
  type PassiveSecurityObservationDraft
} from './evaluate-passive-security';

import {
  passiveSecurityCategories,
  passiveSecurityDisclaimer,
  type PassivePageSecuritySnapshot,
  type PassiveSecurityObservation,
  type PassiveSecurityOccurrence,
  type PassiveSecurityReport,
  type PassiveSecuritySummary
} from './passive-security-model';

interface RegisteredPassiveObservation extends Omit<PassiveSecurityObservationDraft, 'occurrence'> {
  occurrences: PassiveSecurityOccurrence[];
}

export interface PassiveSecurityRegistry {
  pageSnapshots: PassivePageSecuritySnapshot[];
  observationsByFingerprint: Map<string, RegisteredPassiveObservation>;
}

export function createPassiveSecurityRegistry(): PassiveSecurityRegistry {
  return {
    pageSnapshots: [],
    observationsByFingerprint: new Map()
  };
}

function occurrenceIdentity(occurrence: PassiveSecurityOccurrence): string {
  return JSON.stringify({
    pageUrl: occurrence.pageUrl,
    responseUrl: occurrence.responseUrl,
    evidence: occurrence.evidence
  });
}

function registerDraft(
  registry: PassiveSecurityRegistry,
  draft: PassiveSecurityObservationDraft
): void {
  const existing = registry.observationsByFingerprint.get(draft.fingerprint);

  if (existing === undefined) {
    const { occurrence, ...observation } = draft;

    registry.observationsByFingerprint.set(draft.fingerprint, {
      ...observation,
      occurrences: [occurrence]
    });

    return;
  }

  const incomingIdentity = occurrenceIdentity(draft.occurrence);

  if (
    existing.occurrences.some(occurrence => occurrenceIdentity(occurrence) === incomingIdentity)
  ) {
    return;
  }

  existing.occurrences.push(draft.occurrence);
}

export function registerPassiveSecuritySnapshot(
  registry: PassiveSecurityRegistry,
  snapshot: PassivePageSecuritySnapshot
): void {
  registry.pageSnapshots.push(snapshot);

  for (const draft of evaluatePassiveSecurity(snapshot)) {
    registerDraft(registry, draft);
  }
}

function createEmptySummary(): PassiveSecuritySummary {
  return {
    observationsCount: 0,
    bySeverity: {
      medium: 0,
      low: 0,
      info: 0
    },
    byCategory: Object.fromEntries(
      passiveSecurityCategories.map(category => [category, 0])
    ) as PassiveSecuritySummary['byCategory'],
    originsObserved: 0
  };
}

function compareOccurrences(
  left: PassiveSecurityOccurrence,
  right: PassiveSecurityOccurrence
): number {
  return (
    left.pageUrl.localeCompare(right.pageUrl) ||
    left.responseUrl.localeCompare(right.responseUrl) ||
    occurrenceIdentity(left).localeCompare(occurrenceIdentity(right))
  );
}

export function getPassiveSecurityReport(registry: PassiveSecurityRegistry): PassiveSecurityReport {
  const observations = Array.from(registry.observationsByFingerprint.values())
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
    .map(
      (observation, index): PassiveSecurityObservation => ({
        ...observation,
        observationReference: `security-observation-${index + 1}`,
        occurrences: [...observation.occurrences].sort(compareOccurrences)
      })
    );

  const summary = createEmptySummary();

  summary.observationsCount = observations.length;

  summary.originsObserved = new Set(registry.pageSnapshots.map(snapshot => snapshot.origin)).size;

  for (const observation of observations) {
    summary.bySeverity[observation.severity] += 1;

    summary.byCategory[observation.category] += 1;
  }

  return {
    mode: 'passive-observation-only',
    disclaimer: passiveSecurityDisclaimer,
    pageSnapshots: [...registry.pageSnapshots],
    observations,
    summary
  };
}

export function createEmptyPassiveSecurityReport(): PassiveSecurityReport {
  return getPassiveSecurityReport(createPassiveSecurityRegistry());
}
