import assert from 'node:assert/strict';

import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';

import type {
  SiteConfig
} from './config/site-config';

import {
  getSiteConfig
} from './sites';

function expectError(
  callback: () => unknown,
  expectedMessagePart: string
): void {
  assert.throws(
    callback,
    error =>
      error instanceof
        Error &&
      error.message.includes(
        expectedMessagePart
      )
  );
}

function main(): void {
  const configuredSite =
    getSiteConfig(
      'aidoc'
    );

  assert.equal(
    configuredSite.id,
    'aidoc'
  );

  assert.deepEqual(
    configuredSite.allowedHosts,
    [
      'aidoc.com',
      'www.aidoc.com'
    ]
  );

  const httpSite =
    getSiteConfig(
      'http://Example.com:8080/path?mode=full#section'
    );

  assert.equal(
    httpSite.startUrl,
    'http://example.com:8080/path?mode=full#section'
  );

  assert.equal(
    httpSite.id,
    'runtime-example.com'
  );

  assert.deepEqual(
    httpSite.allowedHosts,
    [
      'example.com'
    ]
  );

  const httpsSite =
    getSiteConfig(
      'https://sub.example.com/'
    );

  assert.deepEqual(
    httpsSite.allowedHosts,
    [
      'sub.example.com'
    ]
  );

  assert.equal(
    httpsSite.allowedHosts.includes(
      'example.com'
    ),
    false
  );

  const credentialedSite =
    getSiteConfig(
      'https://synthetic-user:synthetic-password@Secure.Example.com/private'
    );

  assert.equal(
    credentialedSite.startUrl,
    'https://synthetic-user:synthetic-password@secure.example.com/private'
  );

  assert.deepEqual(
    credentialedSite.allowedHosts,
    [
      'secure.example.com'
    ]
  );

  expectError(
    () =>
      getSiteConfig(
        'https://['
      ),
    'Invalid exploration URL'
  );

  /*
   * URL-mode detection is currently intentionally literal and
   * case-sensitive. Protect that existing behavior without turning
   * CQ-019 into a URL-policy redesign.
   */
  expectError(
    () =>
      getSiteConfig(
        'HTTPS://example.com/'
      ),
    'Unknown site'
  );

  /*
   * Unsupported protocols currently fail at the configured-site
   * lookup boundary. The wording is imperfect but not a host-safety
   * defect, so this check records the existing public behavior.
   */
  expectError(
    () =>
      getSiteConfig(
        'ftp://example.com/'
      ),
    'Unknown site'
  );

  const zeroNavigationBudgetSite:
    SiteConfig = {
    id:
      'core-zero-navigation-budget',
    name:
      'Core zero navigation budget',
    startUrl:
      'https://example.com/',
    allowedHosts: [
      'example.com'
    ],
    maxPages:
      0,
    maxAgentSteps:
      0,
    maxExploratoryStepsPerPage:
      0,
    allowFormSubmission:
      false
  };

  const zeroBudgetAfterOptions =
    applyAgentRunOptions(
      zeroNavigationBudgetSite,
      parseAgentRunOptions([
        zeroNavigationBudgetSite.id
      ])
    );

  assert.equal(
    zeroBudgetAfterOptions.maxAgentSteps,
    0
  );

  assert.equal(
    zeroNavigationBudgetSite.maxAgentSteps,
    0
  );

  console.log(
    'Runtime site configuration and URL boundary checks passed.'
  );
}

main();
