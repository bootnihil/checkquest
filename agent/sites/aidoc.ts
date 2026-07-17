import type { SiteConfig } from '../config/site-config';

export const aidocSite = {
  id: 'aidoc',
  name: 'Aidoc commercial website',
  startUrl: 'https://www.aidoc.com/',
  allowedHosts: [
    'aidoc.com',
    'www.aidoc.com'
  ],
  maxPages: 5,
  maxAgentSteps: 6,
  allowFormSubmission: false
} satisfies SiteConfig;
