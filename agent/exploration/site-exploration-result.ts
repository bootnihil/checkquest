/* Runtime exploration outputs produced before report assembly. */
export interface HomepageObservation {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  httpStatus: number | null;
}

export interface AgentRunOutcome {
  type: 'completed' | 'finished';
  summary: string;
}
