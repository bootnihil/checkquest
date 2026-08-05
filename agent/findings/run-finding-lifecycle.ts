import { createKnownFindingState, type KnownFindingState } from '../investigation/known-findings';
import type { UnifiedFinding } from './finding-model';
import { applyRunTechnicalObservationPolicy } from './technical-observation-policy';
import {
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  getUnifiedFindingVerificationState,
  type UnifiedFindingRegistry
} from './unified-finding-registry';

/*
 * KF and UR remain separate authorities with different responsibilities.
 * KF owns run-local known-finding context, recurrence, and suppression policy.
 * UR owns canonical occurrences, evidence, verification, and report-visible findings.
 * KF projects verification from UR through the same direct canonical fingerprint.
 */
export interface RunFindingLifecycleState {
  readonly unifiedFindingRegistry: UnifiedFindingRegistry;

  readonly knownFindingState: KnownFindingState;
}

export function createRunFindingLifecycle(): RunFindingLifecycleState {
  const unifiedFindingRegistry = createUnifiedFindingRegistry();

  const knownFindingState = createKnownFindingState(fingerprint =>
    getUnifiedFindingVerificationState(unifiedFindingRegistry, fingerprint)
  );

  return {
    unifiedFindingRegistry,
    knownFindingState
  };
}

export function getRunFindings(state: RunFindingLifecycleState): UnifiedFinding[] {
  return applyRunTechnicalObservationPolicy(getUnifiedFindings(state.unifiedFindingRegistry));
}
