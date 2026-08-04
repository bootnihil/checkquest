import type { FindingSeverity } from '../analysis/evaluate-page';

export function createRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function getHighestSeverity(
  findings: readonly {
    severity: FindingSeverity;
  }[]
): FindingSeverity | 'none' {
  if (findings.some(finding => finding.severity === 'high')) {
    return 'high';
  }

  if (findings.some(finding => finding.severity === 'medium')) {
    return 'medium';
  }

  if (findings.some(finding => finding.severity === 'low')) {
    return 'low';
  }

  return 'none';
}
