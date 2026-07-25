import type {
  SiteConfig
} from '../config/site-config';

import {
  CheckQuestError
} from '../errors/checkquest-error';

import {
  aidocSite
} from './aidoc';

const sites:
  Record<
    string,
    SiteConfig
  > = {
    [aidocSite.id]:
      aidocSite
  };

/*
 * Conservative defaults for an ad-hoc URL supplied at runtime.
 *
 * These deliberately give the autonomous agent a relatively small
 * exploration budget until the user explicitly asks for broader or
 * deeper exploration.
 */
const runtimeSiteDefaults = {
  maxPages:
    3,

  maxAgentSteps:
    4,

  maxExploratoryStepsPerPage:
    3,

  allowFormSubmission:
    false
} as const;

function createSiteConfigurationError(
  message: string,
  cause?: unknown
): CheckQuestError {
  return new CheckQuestError(
    'CONFIGURATION',
    message,
    {
      phase:
        'site-configuration-resolution',
      cause
    }
  );
}

function isHttpUrl(
  value: string
): boolean {
  return (
    value.startsWith(
      'https://'
    ) ||
    value.startsWith(
      'http://'
    )
  );
}

function createRuntimeSiteConfig(
  rawUrl: string
): SiteConfig {
  let parsedUrl:
    URL;

  try {
    parsedUrl =
      new URL(
        rawUrl
      );
  } catch (
    error:
      unknown
  ) {
    throw createSiteConfigurationError(
      'Invalid exploration URL. Supply a complete http:// or https:// URL.',
      error
    );
  }

  if (
    parsedUrl.protocol !==
      'https:' &&
    parsedUrl.protocol !==
      'http:'
  ) {
    throw createSiteConfigurationError(
      'Unsupported exploration URL protocol. Only HTTP and HTTPS URLs may be explored.'
    );
  }

  /*
   * For raw-URL mode we intentionally allow only the exact hostname
   * supplied by the user.
   *
   * This is conservative by design:
   *
   * https://www.example.com/
   *
   * allows:
   *
   * www.example.com
   *
   * but does not automatically grant permission to explore unrelated
   * subdomains or external hosts.
   */
  const allowedHosts = [
    parsedUrl.hostname
  ];

  return {
    id:
      `runtime-${parsedUrl.hostname}`,

    name:
      `Runtime exploration: ${parsedUrl.hostname}`,

    startUrl:
      parsedUrl.toString(),

    allowedHosts,

    maxPages:
      runtimeSiteDefaults.maxPages,

    maxAgentSteps:
      runtimeSiteDefaults.maxAgentSteps,

    maxExploratoryStepsPerPage:
      runtimeSiteDefaults
        .maxExploratoryStepsPerPage,

    allowFormSubmission:
      runtimeSiteDefaults
        .allowFormSubmission
  };
}

export function getSiteConfig(
  siteIdOrUrl: string
): SiteConfig {
  if (
    isHttpUrl(
      siteIdOrUrl
    )
  ) {
    return createRuntimeSiteConfig(
      siteIdOrUrl
    );
  }

  const site =
    sites[
      siteIdOrUrl
    ];

  if (!site) {
    const availableSites =
      Object
        .keys(
          sites
        )
        .join(
          ', '
        );

    throw createSiteConfigurationError(
      `Unknown site configuration. Use a configured site (${availableSites}) or supply a complete http:// or https:// URL.`
    );
  }

  return site;
}
