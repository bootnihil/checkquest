import assert from 'node:assert/strict';
import {
  createServer,
  type Server,
  type ServerResponse
} from 'node:http';

import type {
  AnalyzePageForQaInput
} from './analysis/analyze-page-for-qa';
import type {
  SiteConfig
} from './config/site-config';
import type {
  NavigationBudgetContext
} from './exploration/navigation-policy';
import {
  runSite,
  type RunSiteDependencies
} from './run/run-site';
import type {
  RunEvent
} from './run/run-event';
import {
  listenOnBrowserSafeLoopbackPort
} from './testing/listen-on-browser-safe-loopback-port';

interface ReceivedRequest {
  method: string;
  path: string;
  hostname: string;
}

interface NavigationChoiceCall {
  candidateUrls: string[];
  budget:
    NavigationBudgetContext;
}

interface RunCollaborators {
  dependencies:
    RunSiteDependencies;
  analysisUrls:
    string[];
  analysisHeadings:
    string[][];
  navigationCalls:
    NavigationChoiceCall[];
}

const allowedHost =
  '127.0.0.1';

function fixturePage(
  title: string,
  body: string
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <link rel="icon" href="data:,">
  </head>
  <body>${body}</body>
</html>`;
}

function writePage(
  response:
    ServerResponse,
  title: string,
  body: string
): void {
  response.writeHead(
    200,
    {
      'content-type':
        'text/html; charset=utf-8',
      'content-security-policy':
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      'x-content-type-options':
        'nosniff'
    }
  );
  response.end(
    fixturePage(
      title,
      body
    )
  );
}

function createFixtureServer(
  receivedRequests:
    ReceivedRequest[]
): Server {
  return createServer(
    (
      request,
      response
    ) => {
      const requestUrl =
        new URL(
          request.url ??
            '/',
          `http://${allowedHost}`
        );

      receivedRequests.push({
        method:
          request.method ??
          '',
        path:
          requestUrl.pathname,
        hostname:
          requestUrl.hostname
      });

      switch (
        requestUrl.pathname
      ) {
        case '/budget-one':
          writePage(
            response,
            'Page budget',
            '<h1>Page budget</h1><a href="/budget-one/second">Second page</a>'
          );
          return;

        case '/budget-one/second':
          writePage(
            response,
            'Unexpected second page',
            '<h1>Unexpected second page</h1>'
          );
          return;

        case '/zero-budget':
          writePage(
            response,
            'Zero navigation budget',
            '<h1>Zero navigation budget</h1><a href="/zero-budget/second">Second page</a>'
          );
          return;

        case '/zero-budget/second':
          writePage(
            response,
            'Unexpected zero-budget page',
            '<h1>Unexpected zero-budget page</h1>'
          );
          return;

        case '/success/start':
          writePage(
            response,
            'Successful start',
            '<h1>Successful start</h1><a href="/success/second">Second page</a>'
          );
          return;

        case '/success/second':
          writePage(
            response,
            'Successful second page',
            '<h1>Successful second page</h1>'
          );
          return;

        case '/redirect/start':
          writePage(
            response,
            'Redirect aliases',
            [
              '<h1>Redirect aliases</h1>',
              '<a href="/redirect/alias-a">Alias A</a>',
              '<a href="/redirect/alias-b">Alias B</a>'
            ].join('')
          );
          return;

        case '/redirect/alias-a':
        case '/redirect/alias-b':
          response.writeHead(
            302,
            {
              location:
                '/redirect/shared'
            }
          );
          response.end();
          return;

        case '/redirect/shared':
          writePage(
            response,
            'Shared destination',
            '<h1>Shared destination</h1>'
          );
          return;

        case '/no-candidates':
          writePage(
            response,
            'No candidates',
            '<p>This page deliberately has no primary heading or link.</p>'
          );
          return;

        case '/failure/start':
          writePage(
            response,
            'Injected analysis failure',
            '<h1>Injected analysis failure</h1><a href="/failure/second">Must not be visited</a>'
          );
          return;

        case '/failure/second':
          writePage(
            response,
            'Unexpected failure continuation',
            '<h1>Unexpected failure continuation</h1>'
          );
          return;

        case '/cleanup-success':
          writePage(
            response,
            'Cleanup successor',
            '<h1>Cleanup successor</h1>'
          );
          return;

        default:
          response.writeHead(
            404,
            {
              'content-type':
                'text/plain; charset=utf-8'
            }
          );
          response.end(
            'not found'
          );
      }
    }
  );
}

function createSite(
  baseUrl: string,
  path: string,
  maxPages: number,
  maxAgentSteps: number
): SiteConfig {
  return {
    id:
      `integration-${path.replaceAll('/', '-')}`,
    name:
      `Integration ${path}`,
    startUrl:
      new URL(
        path,
        baseUrl
      ).toString(),
    allowedHosts: [
      allowedHost
    ],
    maxPages,
    maxAgentSteps,
    maxExploratoryStepsPerPage:
      0,
    allowFormSubmission:
      false
  };
}

function createRunCollaborators():
  RunCollaborators {
  const analysisUrls:
    string[] = [];
  const analysisHeadings:
    string[][] = [];
  const navigationCalls:
    NavigationChoiceCall[] = [];

  const analyzePageForQa:
    NonNullable<
      RunSiteDependencies[
        'analyzePageForQa'
      ]
    > =
      async (
        input:
          AnalyzePageForQaInput
      ) => {
        analysisUrls.push(
          input
            .observation
            .finalUrl
        );
        analysisHeadings.push(
          [
            ...input
              .content
              .headings
          ]
        );

        return {
          findings:
            [],
          summary:
            'Local deterministic analysis stub found no model candidates.'
        };
      };

  const chooseNavigationLink:
    NonNullable<
      RunSiteDependencies[
        'chooseNavigationLink'
      ]
    > =
      async (
        _site,
        candidates,
        budget
      ) => {
        navigationCalls.push({
          candidateUrls:
            candidates.map(
              candidate =>
                candidate
                  .link
                  .url
            ),
          budget: {
            ...budget
          }
        });

        const selected =
          candidates[0];

        assert.ok(
          selected,
          'The deterministic navigation stub requires at least one candidate.'
        );

        return {
          type:
            'link',
          link:
            selected.link,
          predictedIdentity:
            selected
              .predictedIdentity,
          policyCandidate:
            selected,
          reason:
            'Select the first policy-approved candidate for deterministic integration coverage.'
        };
      };

  return {
    dependencies: {
      analyzePageForQa,
      chooseNavigationLink
    },
    analysisUrls,
    analysisHeadings,
    navigationCalls
  };
}

function getRunRequests(
  requests:
    ReceivedRequest[],
  startIndex: number
): ReceivedRequest[] {
  return requests.slice(
    startIndex
  );
}

function assertOrdinaryLocalGets(
  requests:
    ReceivedRequest[],
  expectedPaths:
    string[]
): void {
  assert.deepEqual(
    requests.map(
      request =>
        request.path
    ),
    expectedPaths
  );

  assert.equal(
    requests.every(
      request =>
        request.method ===
          'GET' &&
        request.hostname ===
          allowedHost
    ),
    true,
    'The fixture must receive only ordinary local GET navigation traffic.'
  );
}

function assertCoreReportShape(
  report:
    Awaited<
      ReturnType<
        typeof runSite
      >
    >,
  expectedPages:
    number
): void {
  assert.equal(
    report.reportSchemaVersion,
    '3'
  );
  assert.equal(
    report.inspectedPages.length,
    expectedPages
  );
  assert.equal(
    report.summary.pagesInspected,
    expectedPages
  );
  assert.equal(
    report.summary
      .exploratoryQaFindingsCount,
    0
  );
  assert.equal(
    report.passiveSecurity
      .summary
      .originsObserved,
    1
  );

  const httpObservation =
    report.passiveSecurity
      .observations
      .find(
        observation =>
          observation.code ===
            'PS_HTTP_DOCUMENT'
      );

  assert.ok(
    httpObservation
  );
  assert.equal(
    httpObservation
      .occurrences
      .length,
    expectedPages
  );
}

async function getConnectionCount(
  server: Server
): Promise<number> {
  return new Promise<number>(
    (
      resolve,
      reject
    ) => {
      server.getConnections(
        (
          error,
          count
        ) => {
          if (
            error
          ) {
            reject(
              error
            );
            return;
          }

          resolve(
            count
          );
        }
      );
    }
  );
}

async function waitForNoConnections(
  server: Server
): Promise<void> {
  for (
    let attempt = 0;
    attempt < 50;
    attempt +=
      1
  ) {
    if (
      await getConnectionCount(
        server
      ) ===
        0
    ) {
      return;
    }

    await new Promise<void>(
      resolve => {
        setTimeout(
          resolve,
          20
        );
      }
    );
  }

  assert.equal(
    await getConnectionCount(
      server
    ),
    0,
    'The browser connection remained open after runSite settled.'
  );
}

async function closeServer(
  server: Server
): Promise<void> {
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

async function main():
  Promise<void> {
  const receivedRequests:
    ReceivedRequest[] = [];
  const server =
    createFixtureServer(
      receivedRequests
    );

  await listenOnBrowserSafeLoopbackPort(
    server,
    'runSite/inspectPage integration fixture'
  );

  const address =
    server.address();

  assert.ok(
    address !==
      null &&
    typeof address !==
      'string'
  );

  const baseUrl =
    `http://${allowedHost}:${address.port}`;

  try {
    {
      const requestStart =
        receivedRequests.length;
      const collaborators =
        createRunCollaborators();
      const coreConsoleCalls:
        unknown[][] =
          [];
      const originalConsole = {
        log:
          console.log,
        warn:
          console.warn,
        error:
          console.error
      };
      let report:
        Awaited<
          ReturnType<
            typeof runSite
          >
        >;

      try {
        console.log =
          (
            ...values:
              unknown[]
          ) => {
            coreConsoleCalls.push(
              values
            );
          };
        console.warn =
          console.log;
        console.error =
          console.log;

        report =
          await runSite({
            site:
              createSite(
                baseUrl,
                '/budget-one',
                1,
                5
              ),
            runId:
              'stage8c3-page-budget-one',
            startedAt:
              new Date(
                '2026-07-25T00:00:00.000Z'
              ),
            dependencies:
              collaborators.dependencies
          });
      } finally {
        console.log =
          originalConsole.log;
        console.warn =
          originalConsole.warn;
        console.error =
          originalConsole.error;
      }

      assert.deepEqual(
        coreConsoleCalls,
        []
      );

      assertCoreReportShape(
        report,
        1
      );
      assert.equal(
        report.inspectedPages[0]
          ?.selection
          .type,
        'start-url'
      );
      assert.equal(
        report.outcome.summary,
        'Reached the configured page limit of 1.'
      );
      assert.equal(
        collaborators
          .analysisUrls
          .length,
        1
      );
      assert.deepEqual(
        collaborators
          .analysisHeadings,
        [
          [
            'Page budget'
          ]
        ]
      );
      assert.deepEqual(
        report.inspectedPages[0]
          ?.diagnostics,
        {
          consoleErrors:
            [],
          failedRequests:
            []
        }
      );
      assert.equal(
        report.inspectedPages[0]
          ?.pageNovelty
          .predictedIdentity
          .areaKey,
        'budget-one'
      );
      assert.equal(
        collaborators
          .navigationCalls
          .length,
        0
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/budget-one'
        ]
      );
    }

    {
      const requestStart =
        receivedRequests.length;
      const collaborators =
        createRunCollaborators();
      const report =
        await runSite({
          site:
            createSite(
              baseUrl,
              '/zero-budget',
              3,
              0
            ),
          runId:
            'stage8c3-zero-navigation-budget',
          startedAt:
            new Date(
              '2026-07-25T00:01:00.000Z'
            ),
          dependencies:
            collaborators.dependencies
        });

      assertCoreReportShape(
        report,
        1
      );
      assert.equal(
        report.outcome.summary,
        'Reached the configured navigation-step limit of 0.'
      );
      assert.equal(
        collaborators
          .analysisUrls
          .length,
        1
      );
      assert.equal(
        collaborators
          .navigationCalls
          .length,
        0
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/zero-budget'
        ]
      );
    }

    {
      const requestStart =
        receivedRequests.length;
      const collaborators =
        createRunCollaborators();
      const successEvents:
        RunEvent[] =
          [];
      const report =
        await runSite({
          site:
            createSite(
              baseUrl,
              '/success/start',
              2,
              1
            ),
          runId:
            'stage8c3-two-page-success',
          startedAt:
            new Date(
              '2026-07-25T00:02:00.000Z'
            ),
          onEvent:
            event => {
              successEvents.push(
                event
              );
            },
          dependencies:
            collaborators.dependencies
        });

      assertCoreReportShape(
        report,
        2
      );
      assert.deepEqual(
        report.inspectedPages.map(
          page =>
            page.selection.type
        ),
        [
          'start-url',
          'agent-navigation'
        ]
      );
      assert.deepEqual(
        report.inspectedPages.map(
          page =>
            new URL(
              page.observation.finalUrl
            ).pathname
        ),
        [
          '/success/start',
          '/success/second'
        ]
      );
      assert.equal(
        report.inspectedPages[1]
          ?.selection
          .navigationAudit
          ?.requestedUrl,
        `${baseUrl}/success/second`
      );
      assert.deepEqual(
        report.inspectedPages[1]
          ?.selection
          .navigationAudit
          ?.budgetAtDecision,
        {
          remainingPageSlots:
            1,
          remainingNavigationDecisionSlots:
            1,
          remainingPotentialInspections:
            1
        }
      );
      assert.equal(
        collaborators
          .analysisUrls
          .length,
        2
      );
      assert.equal(
        collaborators
          .navigationCalls
          .length,
        1
      );
      assert.deepEqual(
        successEvents.map(
          event =>
            event.type
        ),
        [
          'run-started',
          'inspection-started',
          'inspection-completed',
          'navigation-started',
          'navigation-completed',
          'inspection-started',
          'inspection-completed',
          'run-completed'
        ]
      );
      assert.deepEqual(
        successEvents
          .filter(
            event =>
              event.type ===
              'inspection-started'
          )
          .map(
            event =>
              event.pageNumber
          ),
        [
          1,
          2
        ]
      );
      assert.equal(
        successEvents.at(
          -1
        )?.type,
        'run-completed'
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/success/start',
          '/success/second'
        ]
      );
    }

    {
      const requestStart =
        receivedRequests.length;
      const collaborators =
        createRunCollaborators();
      const report =
        await runSite({
          site:
            createSite(
              baseUrl,
              '/redirect/start',
              3,
              3
            ),
          runId:
            'stage8c3-redirect-deduplication',
          startedAt:
            new Date(
              '2026-07-25T00:03:00.000Z'
            ),
          dependencies:
            collaborators.dependencies
        });

      assertCoreReportShape(
        report,
        2
      );
      assert.equal(
        report.outcome.summary,
        'No unattempted safe navigation links remained.'
      );
      assert.deepEqual(
        report.inspectedPages.map(
          page =>
            new URL(
              page.observation.finalUrl
            ).pathname
        ),
        [
          '/redirect/start',
          '/redirect/shared'
        ]
      );
      assert.equal(
        collaborators
          .analysisUrls
          .length,
        2
      );
      assert.equal(
        collaborators
          .navigationCalls
          .length,
        2
      );
      assert.deepEqual(
        collaborators
          .navigationCalls
          .map(
            call =>
              call.budget
                .remainingNavigationDecisionSlots
          ),
        [
          3,
          2
        ]
      );
      assert.equal(
        report.findings.length,
        0
      );
      assert.equal(
        new Set(
          report.inspectedPages.map(
            page =>
              page
                .pageNovelty
                .observedTemplateKey
          )
        ).size,
        2
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/redirect/start',
          '/redirect/alias-a',
          '/redirect/shared',
          '/redirect/alias-b',
          '/redirect/shared'
        ]
      );
    }

    {
      const requestStart =
        receivedRequests.length;
      const collaborators =
        createRunCollaborators();
      const report =
        await runSite({
          site:
            createSite(
              baseUrl,
              '/no-candidates',
              3,
              2
            ),
          runId:
            'stage8c3-no-candidates',
          startedAt:
            new Date(
              '2026-07-25T00:04:00.000Z'
            ),
          dependencies:
            collaborators.dependencies
        });

      assertCoreReportShape(
        report,
        1
      );
      assert.equal(
        report.outcome.summary,
        'No unattempted safe navigation links remained.'
      );
      assert.equal(
        collaborators
          .navigationCalls
          .length,
        0
      );
      assert.equal(
        report.findings.length,
        1
      );
      assert.equal(
        report.findings[0]
          ?.fingerprint,
        'rule|NO_PRIMARY_HEADINGS'
      );
      assert.equal(
        report.findings[0]
          ?.occurrences
          .length,
        1
      );
      assert.equal(
        new URL(
          report.findings[0]
            ?.occurrences[0]
            ?.pageUrl ??
            ''
        ).pathname,
        '/no-candidates'
      );
      assert.equal(
        report.summary
          .logicalFindingsCount,
        1
      );
      assert.equal(
        report.summary
          .findingOccurrencesCount,
        1
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/no-candidates'
        ]
      );
    }

    {
      const requestStart =
        receivedRequests.length;
      const failure =
        new Error(
          'Synthetic inspectPage analysis failure.'
        );
      let analysisCallCount =
        0;
      let navigationCallCount =
        0;
      const failureEvents:
        RunEvent[] =
          [];

      await assert.rejects(
        runSite({
          site:
            createSite(
              baseUrl,
              '/failure/start',
              2,
              1
            ),
          runId:
            'stage8c3-cleanup-failure',
          startedAt:
            new Date(
              '2026-07-25T00:05:00.000Z'
            ),
          onEvent:
            event => {
              failureEvents.push(
                event
              );
            },
          dependencies: {
            analyzePageForQa:
              async () => {
                analysisCallCount +=
                  1;
                throw failure;
              },
            chooseNavigationLink:
              async () => {
                navigationCallCount +=
                  1;
                throw new Error(
                  'Navigation must not run after page analysis fails.'
                );
              }
          }
        }),
        error =>
          error ===
            failure
      );

      assert.equal(
        analysisCallCount,
        1
      );
      assert.equal(
        navigationCallCount,
        0
      );
      assert.deepEqual(
        failureEvents.map(
          event =>
            event.type
        ),
        [
          'run-started',
          'inspection-started',
          'run-failed'
        ]
      );
      assert.equal(
        failureEvents.at(
          -1
        )?.type,
        'run-failed'
      );
      const finalFailureEvent =
        failureEvents.at(
          -1
        );

      if (
        finalFailureEvent?.type ===
        'run-failed'
      ) {
        assert.equal(
          finalFailureEvent.code,
          'INTERNAL'
        );
        assert.equal(
          finalFailureEvent.message,
          'An unexpected CheckQuest failure occurred.'
        );
      }
      assert.equal(
        failureEvents.some(
          event =>
            event.type ===
            'run-completed'
        ),
        false
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          requestStart
        ),
        [
          '/failure/start'
        ]
      );

      await waitForNoConnections(
        server
      );

      const successorRequestStart =
        receivedRequests.length;
      const successorCollaborators =
        createRunCollaborators();
      const successorReport =
        await runSite({
          site:
            createSite(
              baseUrl,
              '/cleanup-success',
              1,
              0
            ),
          runId:
            'stage8c3-cleanup-successor',
          startedAt:
            new Date(
              '2026-07-25T00:06:00.000Z'
            ),
          onEvent:
            () => {
              throw new Error(
                'Synthetic observer failure.'
              );
            },
          dependencies:
            successorCollaborators
              .dependencies
        });

      assertCoreReportShape(
        successorReport,
        1
      );
      assertOrdinaryLocalGets(
        getRunRequests(
          receivedRequests,
          successorRequestStart
        ),
        [
          '/cleanup-success'
        ]
      );

      await waitForNoConnections(
        server
      );
    }

    console.log(
      'Stage 8C.3 runSite/inspectPage local-browser integration checks passed.'
    );
  } finally {
    await closeServer(
      server
    );
  }
}

main().catch(
  error => {
    console.error(
      'Stage 8C.3 runSite/inspectPage local-browser integration checks failed.'
    );
    console.error(
      error
    );
    process.exitCode =
      1;
  }
);
