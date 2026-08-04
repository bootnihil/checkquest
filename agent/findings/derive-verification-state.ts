import type { FindingEvidence, FindingOccurrence, FindingVerification } from './finding-model';

export function deriveOccurrenceVerification(
  evidence: readonly FindingEvidence[]
): FindingVerification {
  const verificationEvidence = evidence.filter(
    item => item.verificationCapable && item.source !== 'model'
  );

  const supportingEvidence = verificationEvidence.filter(item => item.relation === 'supports');

  const contradictingEvidence = verificationEvidence.filter(
    item => item.relation === 'contradicts'
  );

  if (supportingEvidence.length > 0 && contradictingEvidence.length > 0) {
    return {
      state: 'inconclusive',

      reason:
        'Conflicting deterministic evidence: verification-capable evidence both supports and contradicts the finding.',

      evidenceReferences: verificationEvidence.map(item => item.evidenceReference)
    };
  }

  if (supportingEvidence.length > 0) {
    return {
      state: 'verified',

      reason:
        'Verification-capable evidence supports the finding and no verification-capable evidence contradicts it.',

      evidenceReferences: supportingEvidence.map(item => item.evidenceReference)
    };
  }

  if (contradictingEvidence.length > 0) {
    return {
      state: 'not-verified',

      reason:
        'Verification-capable evidence contradicts the finding and no verification-capable evidence supports it.',

      evidenceReferences: contradictingEvidence.map(item => item.evidenceReference)
    };
  }

  return {
    state: 'inconclusive',

    reason: 'No verification-capable evidence is available for this occurrence.',

    evidenceReferences: []
  };
}

export function deriveLogicalFindingVerification(
  occurrences: readonly FindingOccurrence[]
): FindingVerification {
  const verifiedOccurrences = occurrences.filter(
    occurrence => occurrence.verification.state === 'verified'
  );

  if (verifiedOccurrences.length > 0) {
    return {
      state: 'verified',

      reason: 'At least one occurrence is verified.',

      evidenceReferences: verifiedOccurrences.flatMap(
        occurrence => occurrence.verification.evidenceReferences
      )
    };
  }

  const inconclusiveOccurrences = occurrences.filter(
    occurrence => occurrence.verification.state === 'inconclusive'
  );

  if (inconclusiveOccurrences.length > 0) {
    return {
      state: 'inconclusive',

      reason: 'No occurrence is verified and at least one occurrence is inconclusive.',

      evidenceReferences: inconclusiveOccurrences.flatMap(
        occurrence => occurrence.verification.evidenceReferences
      )
    };
  }

  if (occurrences.length > 0) {
    return {
      state: 'not-verified',

      reason: 'All evaluated occurrences are not verified.',

      evidenceReferences: occurrences.flatMap(
        occurrence => occurrence.verification.evidenceReferences
      )
    };
  }

  return {
    state: 'inconclusive',

    reason: 'No finding occurrences are available.',

    evidenceReferences: []
  };
}
