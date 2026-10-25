import assert from 'node:assert/strict';
import { getEventListeners, type EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { chromium } from '@playwright/test';

import { collectPageDiagnostics } from '../../agent/browser/collect-page-diagnostics';
import { preparePageForGuardedInteractions } from '../../agent/browser/guarded-interaction-safety-boundary';
import { visitApprovedLinkWithPassiveSecurity } from '../../agent/browser/visit-approved-link';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import { getSecondaryCleanupError } from '../../agent/errors/required-cleanup';
import { createNavigationFrontier } from '../../agent/exploration/navigation-policy';
import { createPageNoveltyState } from '../../agent/exploration/page-novelty';
import { createNavigationUrlState } from '../../agent/exploration/visited-links';
import {
  createRunFindingLifecycle,
  getRunFindings
} from '../../agent/findings/run-finding-lifecycle';
import { inspectPage } from '../../agent/inspection/inspect-page';
import { createPassiveSecurityRegistry } from '../../agent/security/passive-security-registry';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

async function main(): Promise<void> {
  const fixturePage = (name: string): string => `<!doctype html><title>Document ${name}</title>
    <link rel="icon" href="data:,"><h1>Document ${name}</h1><h2>Shared target</h2>
    <label for="country">Country</label><select id="country" name="country">
    <option>Original</option><option>Equador</option></select>
    <script>document.getElementById('country').addEventListener('change', () => window.recordChange());</script>`;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.headers.host ?? '');
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/a' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixturePage(request.url ?? '/'));
  });
  const port = await listenOnBrowserSafeLoopbackPort(server, 'Inspection document identity');
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const failures: unknown[] = [];
  try {
    for (const phase of ['route-setup', 'observation']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        const failure = new Error(`Injected ${phase} failure`);
        const emitter = page as unknown as EventEmitter;
        const listenersBefore = ['request', 'domcontentloaded'].map(event =>
          getEventListeners(emitter, event)
        );
        if (phase === 'route-setup') {
          const route = page.route.bind(page);
          page.route = async (...args) => {
            await route(...args);
            throw failure;
          };
        } else {
          page.title = async () => {
            throw failure;
          };
        }
        await assert.rejects(
          visitApprovedLinkWithPassiveSecurity(page, { text: 'Fixture', url: `${origin}/a` }, [
            '127.0.0.1'
          ]),
          error => error === failure
        );
        assert.deepEqual(
          ['request', 'domcontentloaded'].map(event => getEventListeners(emitter, event)),
          listenersBefore
        );
        await page.goto(`${origin}/released`);
        console.log(`PASS: ${phase} releases document containment`);
      } catch (error) {
        failures.push(error);
        console.error(`FAIL: ${phase}`, error);
      } finally {
        await context.close();
      }
    }
    for (const mode of [
      'settle',
      'analysis',
      'out-of-scope',
      'reload',
      'blank',
      'planner',
      'evidence',
      'redirect',
      'hash',
      'history',
      'cancel',
      'cancel-cleanup'
    ]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        const navigateDocument = async (url: string): Promise<void> => {
          const loaded = page.waitForEvent('domcontentloaded');
          await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
          await loaded;
        };
        await preparePageForGuardedInteractions(page);
        const diagnostics = collectPageDiagnostics(page);
        const abort = new AbortController();
        const emitter = page as unknown as EventEmitter;
        const listenersBefore = ['request', 'domcontentloaded'].map(event =>
          getEventListeners(emitter, event)
        );
        let preservedRouteHits = 0;
        await page.route('**/released', async route => {
          preservedRouteHits++;
          await route.fulfill({ body: 'Existing route' });
        });
        const visit = await visitApprovedLinkWithPassiveSecurity(
          page,
          { text: 'Fixture', url: `${origin}/${mode === 'redirect' ? 'redirect' : 'a'}` },
          ['127.0.0.1'],
          abort.signal
        );
        const findingLifecycle = createRunFindingLifecycle();
        const passiveSecurityRegistry = createPassiveSecurityRegistry();
        const navigationUrlState = createNavigationUrlState();
        const pageNoveltyState = createPageNoveltyState();
        const cleanupFailure = new Error('Injected document cleanup failure');
        if (mode === 'cancel-cleanup') {
          const unroute = page.unroute.bind(page);
          page.unroute = async (...args) => {
            await unroute(...args);
            throw cleanupFailure;
          };
        }
        let analysisCalls = 0;
        let screenshotCalls = 0;
        let actionChanges = 0;
        await page.exposeFunction('recordChange', () => {
          actionChanges++;
        });
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async options => {
          screenshotCalls++;
          if (mode === 'evidence') {
            await navigateDocument(`${origin}/b`);
          }
          return screenshot(options);
        };
        const analysisPairs: string[] = [];
        if (mode === 'settle') {
          await page.evaluate(() => {
            setTimeout(() => {
              location.href = '/b';
            }, 100);
          });
        }
        const result = await inspectPage({
          page,
          runId: `inspection-document-check-${mode}`,
          pageIndex: 0,
          site: {
            id: 'local',
            name: 'Identity fixture',
            startUrl: `${origin}/a`,
            allowedHosts: ['127.0.0.1'],
            maxPages: 1,
            maxAgentSteps: 0,
            maxExploratoryStepsPerPage: mode === 'planner' ? 1 : 0,
            allowFormSubmission: false
          },
          currentPage: {
            ...visit,
            selection: { type: 'start-url', url: `${origin}/a` },
            traversalDepth: 0
          },
          diagnosticsCollector: diagnostics,
          navigationFrontier: createNavigationFrontier(),
          navigationUrlState,
          pageNoveltyState,
          passiveSecurityRegistry,
          findingLifecycle,
          dependencies: {
            signal: abort.signal,
            planNextAction: async input => {
              await navigateDocument(
                `data:text/html,${encodeURIComponent(fixturePage('/planner-b'))}`
              );
              return {
                candidateReference: input.investigableCandidates[0]!.reference,
                hypothesis: 'Fixture selection',
                reasoning: 'Exact fixture target',
                action: {
                  kind: 'select-option',
                  target: { id: 'country', name: 'country', label: 'Country', placeholder: null },
                  optionText: 'Equador'
                },
                expectedObservation: 'Option selected'
              };
            },
            analyzePageForQa: async input => {
              analysisCalls++;
              analysisPairs.push(
                `${input.observation.finalUrl} -> ${input.content.headings.join(', ')}`
              );
              if (mode === 'analysis' || mode === 'out-of-scope' || mode === 'reload') {
                const destination =
                  mode === 'out-of-scope'
                    ? `http://localhost:${port}/b`
                    : `${origin}/${mode === 'reload' ? 'a' : 'b'}`;
                await navigateDocument(destination);
              }
              if (mode === 'hash' || mode === 'history') {
                await page.evaluate(mode => {
                  if (mode === 'hash') {
                    location.hash = 'section';
                  } else {
                    history.pushState({}, '', '/spa');
                  }
                }, mode);
              }
              if (mode === 'blank') {
                await navigateDocument('about:blank');
              }
              if (mode.startsWith('cancel')) {
                abort.abort();
              }
              return {
                summary: 'Fixture analysis',
                findings: [
                  {
                    category: 'content',
                    severity: 'low',
                    confidence: 'high',
                    title: 'Fixture finding',
                    evidence: 'Fixture content',
                    reasoning: 'Fixture assertion',
                    suggestedCheck: 'Inspect fixture',
                    evidenceTarget: {
                      kind: 'select-option',
                      controlLabel: 'Country',
                      controlName: 'country',
                      controlId: 'country',
                      optionText: 'Equador'
                    },
                    presentationTarget: {
                      kind: 'visible-text',
                      elementKind: 'heading',
                      text: 'Shared target'
                    }
                  }
                ]
              };
            }
          }
        }).then(
          value => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error })
        );
        const succeeds = ['redirect', 'hash', 'history'].includes(mode);
        console.log(
          `${mode}: ${JSON.stringify(analysisPairs)}, committed=${getRunFindings(findingLifecycle).length}`
        );
        if (succeeds) {
          assert.ok(result.value, String(result.error));
          assert.equal(result.value.pageResult.observation.finalUrl, `${origin}/a`);
          assert.equal(getRunFindings(findingLifecycle).length, 1);
          assert.equal(result.value.pageResult.presentationEvidence?.length, 1);
        } else {
          assert.ok(result.error instanceof CheckQuestError, 'Invalidated inspection must fail.');
          assert.equal(result.error.code, mode.startsWith('cancel') ? 'CANCELLED' : 'BROWSER');
          if (mode === 'cancel-cleanup') {
            const secondary = getSecondaryCleanupError(result.error);
            assert.ok(secondary?.cause instanceof CheckQuestError);
            assert.equal(secondary.cause.cause, cleanupFailure);
          }
          assert.equal(getRunFindings(findingLifecycle).length, 0);
          assert.equal(passiveSecurityRegistry.pageSnapshots.length, 0);
          assert.equal(navigationUrlState.inspectedFinalUrls.size, 0);
          assert.equal(pageNoveltyState.areaVisitCounts.size, 0);
          assert.equal(actionChanges, 0, 'No action may execute on a replacement document.');
          assert.equal(
            requests.some(host => host.startsWith('localhost:')),
            false,
            'Out-of-scope navigation must not reach the server.'
          );
          if (mode !== 'evidence') {
            assert.equal(screenshotCalls, 0);
          }
          if (mode === 'settle') {
            assert.equal(analysisCalls, 0);
          }
        }
        assert.deepEqual(
          ['request', 'domcontentloaded'].map(event => getEventListeners(emitter, event)),
          listenersBefore
        );
        await page.goto(`${origin}/released`);
        assert.equal(
          preservedRouteHits,
          1,
          'Owned routes must be released and existing routes retained.'
        );
        diagnostics.dispose();
        console.log(`PASS: ${mode}`);
      } catch (error) {
        failures.push(error);
        console.error(`FAIL: ${mode}`, error);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
  assert.equal(failures.length, 0, 'Inspection document regressions failed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
