export interface SiteConfig {
  id: string;
  name: string;
  startUrl: string;
  allowedHosts: string[];
  maxPages: number;
  maxAgentSteps: number;
  allowFormSubmission: boolean;
}
