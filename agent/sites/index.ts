import type { SiteConfig } from '../config/site-config';
import { aidocSite } from './aidoc';

const sites: Record<string, SiteConfig> = {
  [aidocSite.id]: aidocSite
};

export function getSiteConfig(siteId: string): SiteConfig {
  const site = sites[siteId];

  if (!site) {
    const availableSites = Object.keys(sites).join(', ');

    throw new Error(
      `Unknown site "${siteId}". Available sites: ${availableSites}`
    );
  }

  return site;
}
