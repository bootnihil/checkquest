import assert from 'node:assert/strict';
import {
  createServer
} from 'node:http';

import {
  chromium
} from '@playwright/test';

import {
  extractPageContent
} from './browser/extract-page-content';
import {
  visitApprovedLink
} from './browser/visit-approved-link';

import {
  createPageNoveltyState,
  predictPageIdentity,
  registerInspectedPageNovelty
} from './exploration/page-novelty';

import {
  createNavigationUrlState,
  markFinalUrlInspected,
  markNavigationUrlAttempted,
  recordNavigationResolution
} from './exploration/visited-links';

async function main():
  Promise<void> {
  const server =
    createServer(
      (
        request,
        response
      ) => {
        const requestUrl =
          new URL(
            request.url ??
              '/',
            'http://127.0.0.1'
          );

        if (
          requestUrl.pathname ===
            '/alias-a' ||
          requestUrl.pathname ===
            '/alias-b'
        ) {
          response.writeHead(
            302,
            {
              location:
                '/target'
            }
          );
          response.end();
          return;
        }

        if (
          requestUrl.pathname ===
          '/requested-area/alias'
        ) {
          response.writeHead(
            302,
            {
              location:
                '/actual-area/page'
            }
          );
          response.end();
          return;
        }

        response.writeHead(
          200,
          {
            'content-type':
              'text/html; charset=utf-8'
          }
        );

        response.end(
          `<!doctype html>
<html>
  <head>
    <title>${requestUrl.pathname}</title>
  </head>
  <body>
    <h1>${requestUrl.pathname}</h1>
    <nav>
      <a href="/alias-a">Alias A</a>
      <a href="/alias-b">Alias B</a>
      <a href="/requested-area/alias">New final alias</a>
    </nav>
  </body>
</html>`
        );
      }
    );

  await new Promise<void>(
    (
      resolve,
      reject
    ) => {
      server.once(
        'error',
        reject
      );

      server.listen(
        0,
        '127.0.0.1',
        () =>
          resolve()
      );
    }
  );

  const address =
    server.address();

  if (
    address ===
      null ||
    typeof address ===
      'string'
  ) {
    throw new Error(
      'Local navigation fixture did not expose a TCP port.'
    );
  }

  const origin =
    `http://127.0.0.1:${address.port}`;

  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage();

    await page.goto(
      `${origin}/`,
      {
        waitUntil:
          'domcontentloaded'
      }
    );

    const urlState =
      createNavigationUrlState();

    const noveltyState =
      createPageNoveltyState();

    markNavigationUrlAttempted(
      urlState,
      `${origin}/`
    );

    recordNavigationResolution(
      urlState,
      `${origin}/`,
      page.url()
    );

    markFinalUrlInspected(
      urlState,
      page.url()
    );

    const aliasA = {
      text:
        'Alias A',
      url:
        `${origin}/alias-a`
    };

    markNavigationUrlAttempted(
      urlState,
      aliasA.url
    );

    const firstObservation =
      await visitApprovedLink(
        page,
        aliasA,
        [
          '127.0.0.1'
        ]
      );

    const firstResolution =
      recordNavigationResolution(
        urlState,
        aliasA.url,
        firstObservation.finalUrl
      );

    assert.equal(
      firstResolution
        .finalUrlAlreadyInspected,
      false
    );

    registerInspectedPageNovelty(
      noveltyState,
      predictPageIdentity(
        firstObservation.finalUrl
      ),
      await extractPageContent(
        page
      )
    );

    markFinalUrlInspected(
      urlState,
      firstObservation.finalUrl
    );

    const aliasB = {
      text:
        'Alias B',
      url:
        `${origin}/alias-b`
    };

    markNavigationUrlAttempted(
      urlState,
      aliasB.url
    );

    const secondObservation =
      await visitApprovedLink(
        page,
        aliasB,
        [
          '127.0.0.1'
        ]
      );

    const secondResolution =
      recordNavigationResolution(
        urlState,
        aliasB.url,
        secondObservation.finalUrl
      );

    assert.equal(
      secondResolution
        .finalUrlAlreadyInspected,
      true
    );
    assert.equal(
      noveltyState
        .areaVisitCounts
        .get(
          'target'
        ),
      1
    );
    assert.equal(
      Array.from(
        noveltyState
          .observedTemplateVisitCounts
          .values()
      ).reduce(
        (
          total,
          count
        ) =>
          total +
          count,
        0
      ),
      1
    );

    const newFinalAlias = {
      text:
        'New final alias',
      url:
        `${origin}/requested-area/alias`
    };

    markNavigationUrlAttempted(
      urlState,
      newFinalAlias.url
    );

    const newFinalObservation =
      await visitApprovedLink(
        page,
        newFinalAlias,
        [
          '127.0.0.1'
        ]
      );

    const newFinalResolution =
      recordNavigationResolution(
        urlState,
        newFinalAlias.url,
        newFinalObservation
          .finalUrl
      );

    assert.equal(
      newFinalResolution
        .finalUrlAlreadyInspected,
      false
    );

    registerInspectedPageNovelty(
      noveltyState,
      predictPageIdentity(
        newFinalObservation
          .finalUrl
      ),
      await extractPageContent(
        page
      )
    );

    markFinalUrlInspected(
      urlState,
      newFinalObservation
        .finalUrl
    );

    assert.equal(
      noveltyState
        .areaVisitCounts
        .get(
          'actual-area'
        ),
      1
    );
    assert.equal(
      noveltyState
        .areaVisitCounts
        .has(
          'requested-area'
        ),
      false
    );

    console.log(
      'Stage 6.1 local redirect-alias browser acceptance passed.'
    );
    console.log(
      JSON.stringify(
        {
          origin,
          aliases:
            Array.from(
              urlState
                .requestedToFinalAliases
                .entries()
            ),
          inspectedFinalUrls:
            Array.from(
              urlState
                .inspectedFinalUrls
                .values()
            ),
          areaVisitCounts:
            Object.fromEntries(
              noveltyState
                .areaVisitCounts
            )
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();

    await new Promise<void>(
      (
        resolve,
        reject
      ) => {
        server.close(
          error => {
            if (
              error
            ) {
              reject(
                error
              );
              return;
            }

            resolve();
          }
        );
      }
    );
  }
}

main().catch(
  error => {
    console.error(
      'Stage 6.1 local redirect-alias browser acceptance failed.'
    );
    console.error(
      error
    );
    process.exitCode =
      1;
  }
);
