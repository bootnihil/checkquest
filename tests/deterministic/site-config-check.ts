import assert from 'node:assert/strict';

import type { Page } from '@playwright/test';

import { visitApprovedLink } from '../../agent/browser/visit-approved-link';
import { getSiteConfig } from '../../agent/sites';

function expectError(callback: () => unknown, expectedMessagePart: string): void {
  assert.throws(
    callback,
    error => error instanceof Error && error.message.includes(expectedMessagePart)
  );
}

function createRedirectedPage(finalUrl: string): Page {
  let currentUrl = 'about:blank';

  return {
    goto: async () => {
      currentUrl = finalUrl;
      return null;
    },
    url: () => currentUrl,
    on: () => undefined,
    off: () => undefined,
    route: async () => undefined,
    unroute: async () => undefined,
    evaluateHandle: async () => ({
      evaluate: async () => true,
      dispose: async () => undefined
    }),
    locator: () => ({
      allTextContents: async () => []
    }),
    title: async () => 'Redirected page'
  } as unknown as Page;
}

async function assertRedirectAllowed(
  requestedUrl: string,
  finalUrl: string,
  allowedHosts: string[]
): Promise<void> {
  const observation = await visitApprovedLink(
    createRedirectedPage(finalUrl),
    {
      text: 'Synthetic redirect',
      url: requestedUrl
    },
    allowedHosts
  );

  assert.equal(observation.finalUrl, finalUrl);
}

async function main(): Promise<void> {
  const configuredSite = getSiteConfig('aidoc');

  assert.equal(configuredSite.id, 'aidoc');

  assert.deepEqual(configuredSite.allowedHosts, ['aidoc.com', 'www.aidoc.com']);

  const httpSite = getSiteConfig('http://Example.com:8080/path?mode=full#section');

  assert.equal(httpSite.startUrl, 'http://example.com:8080/path?mode=full#section');

  assert.equal(httpSite.id, 'runtime-example.com');

  assert.deepEqual(httpSite.allowedHosts, ['example.com', 'www.example.com']);

  assert.equal(httpSite.allowedHosts.includes('foo.example.com'), false);

  assert.equal(httpSite.allowedHosts.includes('unrelated.example'), false);

  const wwwSite = getSiteConfig('https://www.example.com/');

  assert.deepEqual(wwwSite.allowedHosts, ['www.example.com', 'example.com']);

  await assertRedirectAllowed(
    'https://example.com/start',
    'https://www.example.com/final',
    httpSite.allowedHosts
  );

  await assertRedirectAllowed(
    'https://www.example.com/start',
    'https://example.com/final',
    wwwSite.allowedHosts
  );

  for (const finalUrl of ['https://foo.example.com/final', 'https://unrelated.example/final']) {
    await assert.rejects(
      visitApprovedLink(
        createRedirectedPage(finalUrl),
        {
          text: 'Synthetic redirect',
          url: 'https://example.com/start'
        },
        httpSite.allowedHosts
      ),
      /Navigation redirected to disallowed host/
    );
  }

  const httpsSite = getSiteConfig('https://sub.example.com/');

  assert.deepEqual(httpsSite.allowedHosts, ['sub.example.com', 'www.sub.example.com']);

  assert.equal(httpsSite.allowedHosts.includes('example.com'), false);

  assert.equal(configuredSite.allowedHosts.includes('support.aidoc.com'), false);

  await assert.rejects(
    visitApprovedLink(
      createRedirectedPage('https://support.aidoc.com/final'),
      {
        text: 'Synthetic redirect',
        url: configuredSite.startUrl
      },
      configuredSite.allowedHosts
    ),
    /Navigation redirected to disallowed host/
  );

  const credentialedSite = getSiteConfig(
    'https://synthetic-user:synthetic-password@Secure.Example.com/private'
  );

  assert.equal(
    credentialedSite.startUrl,
    'https://synthetic-user:synthetic-password@secure.example.com/private'
  );

  assert.deepEqual(credentialedSite.allowedHosts, ['secure.example.com', 'www.secure.example.com']);

  expectError(() => getSiteConfig('https://['), 'Invalid exploration URL');

  /*
   * URL-mode detection is currently intentionally literal and
   * case-sensitive. Protect that existing behavior without turning
   * CQ-019 into a URL-policy redesign.
   */
  expectError(() => getSiteConfig('HTTPS://example.com/'), 'Unknown site');

  /*
   * Unsupported protocols currently fail at the configured-site
   * lookup boundary. The wording is imperfect but not a host-safety
   * defect, so this check records the existing public behavior.
   */
  expectError(() => getSiteConfig('ftp://example.com/'), 'Unknown site');

  console.log('Runtime site configuration and URL boundary checks passed.');
}

main().catch((error: unknown) => {
  console.error('Runtime site configuration and URL boundary check failed.', error);
  process.exitCode = 1;
});
