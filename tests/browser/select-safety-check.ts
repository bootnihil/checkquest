import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { chromium, type Page } from '@playwright/test';

import { executeAgentAction } from '../../agent/browser/execute-agent-action';
import { captureFindingPresentationEvidence } from '../../agent/browser/capture-finding-presentation-evidence';
import { preparePageForGuardedInteractions } from '../../agent/browser/guarded-interaction-safety-boundary';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import { runSite } from '../../agent/run/run-site';
import type { RunEvent } from '../../agent/run/run-event';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

const target = {
  kind: 'select-option' as const,
  controlLabel: 'Country',
  controlName: 'country',
  controlId: 'country',
  optionText: 'Equador'
};
const action = {
  kind: 'select-option' as const,
  target: { label: 'Country', name: 'country', id: 'country', placeholder: null },
  optionText: 'Equador'
};

function injectBoundaryFailure(
  page: Page,
  phase: 'setup' | 'teardown' | 'install' | 'restore',
  boundaryNumber = 1
): Error {
  const failure = new Error(`Injected ${phase} containment failure`);
  const originalRoute = page.route.bind(page);
  const originalUnroute = page.unroute.bind(page);
  const originalEvaluate = page.evaluate.bind(page);
  let routes = 0;
  let unroutes = 0;
  let guardEvaluations = 0;
  page.route = async (...args) => {
    if (++routes === boundaryNumber && phase === 'setup') {
      throw failure;
    }
    return originalRoute(...args);
  };
  page.unroute = async (...args) => {
    await originalUnroute(...args);
    if (++unroutes === boundaryNumber && phase === 'teardown') {
      throw failure;
    }
  };
  page.evaluate = (async (...args: Parameters<Page['evaluate']>) => {
    const source = String(args[0]);
    const matches =
      phase === 'install'
        ? source.includes('const originalFetch')
        : phase === 'restore' && source.includes('store.restore()');
    if (matches && ++guardEvaluations === boundaryNumber) {
      throw failure;
    }
    return originalEvaluate(...args);
  }) as Page['evaluate'];
  return failure;
}

function hasCause(error: unknown, expected: Error): boolean {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 6; depth++) {
    if (current === expected) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function main(): Promise<void> {
  const writes: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      writes.push(request.url ?? '');
      response.end('saved');
      return;
    }
    const mode = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('mode');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><title>Select safety</title>
      <link rel="icon" href="data:,"></head><body><h1>Select safety</h1>
      <nav><a href="/next">Next</a></nav>
      <form method="post" action="/save"><label for="country">Country</label>
      <select id="country" name="country"><option value="original">Original</option>
      <option value="equador">Equador</option></select></form>
      <script>
      const select = document.getElementById('country');
      const cachedFetch = window.fetch.bind(window);
      let changes = 0;
      select.addEventListener('change', () => {
        changes++;
        if (${JSON.stringify(mode)} === 'fetch') void fetch('/save', {method:'POST'}).catch(() => {});
        if (${JSON.stringify(mode)} === 'cached-fetch') void cachedFetch('/save', {method:'POST'}).catch(() => {});
        if (${JSON.stringify(mode)} === 'interval') setInterval(() => { void cachedFetch('/save', {method:'POST'}).catch(() => {}); }, 500);
        if (${JSON.stringify(mode)} === 'frame') requestAnimationFrame(() => { void cachedFetch('/save', {method:'POST'}).catch(() => {}); });
        if (${JSON.stringify(mode)} === 'delayed') setTimeout(() => { void cachedFetch('/save', {method:'POST'}).catch(() => {}); }, 500);
        if (${JSON.stringify(mode)} === 'restore-replace' && changes === 2 || ${JSON.stringify(mode)} === 'inspection-restore-replace' && changes === 3) {
          const clone = select.cloneNode(true); clone.value = 'equador'; select.replaceWith(clone);
        }
        if (${JSON.stringify(mode)} === 'restore-microtask' && changes === 2) queueMicrotask(() => {
          const clone = select.cloneNode(true); clone.value = 'equador'; select.replaceWith(clone);
        });
        if (${JSON.stringify(mode)} === 'restore-deferred' && changes === 2) setTimeout(() => {
          const clone = select.cloneNode(true); clone.value = 'equador'; select.replaceWith(clone);
        }, 500);
        if (${JSON.stringify(mode)} === 'form') select.form.submit();
        if (${JSON.stringify(mode)} === 'clone' || (${JSON.stringify(mode)} === 'replay-clone' && changes === 2)) {
          const clone = select.cloneNode(true); clone.id = 'copy'; select.after(clone);
        }
      });
      </script></body></html>`);
  });
  const port = await listenOnBrowserSafeLoopbackPort(server, 'Select safety');
  const baseUrl = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ headless: true });
  const failures: unknown[] = [];
  async function check(name: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL: ${name}`, error);
    }
  }
  try {
    for (const mode of ['fetch', 'cached-fetch', 'form']) {
      await check(`selection contains ${mode}`, async () => {
        const page = await browser.newPage({ serviceWorkers: 'block' });
        try {
          await preparePageForGuardedInteractions(page);
          await page.goto(`${baseUrl}?mode=${mode}`);
          const writesBefore = writes.length;
          const result = await executeAgentAction(page, action);
          await page.waitForTimeout(150);
          assert.equal(writes.length, writesBefore, 'No mutation may reach the server.');
          assert.equal(result.status, 'unsafe');
          assert.equal(result.hardBreach, true);
          assert.ok((result.safetyEvents?.length ?? 0) > 0);
        } finally {
          await page.close();
        }
      });
    }
    await check('evidence replay contains network requests', async () => {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      try {
        await preparePageForGuardedInteractions(page);
        await page.goto(`${baseUrl}?mode=fetch`);
        const writesBefore = writes.length;
        await assert.rejects(
          captureFindingPresentationEvidence(
            page,
            {
              runId: 'select-safety-check',
              pageNumber: 1,
              candidateNumber: 1,
              target,
              allowObservedStateReplay: true
            },
            { captureScreenshot: async () => undefined }
          ),
          (error: unknown) => error instanceof CheckQuestError && error.code === 'BROWSER'
        );
        assert.equal(writes.length, writesBefore);
      } finally {
        await page.close();
      }
    });
    for (const screenshotFails of [false, true]) {
      await check(
        `failed replay rollback rejects (screenshot failure: ${screenshotFails})`,
        async () => {
          const page = await browser.newPage({ serviceWorkers: 'block' });
          try {
            await preparePageForGuardedInteractions(page);
            await page.goto(`${baseUrl}?mode=clone`);
            await assert.rejects(
              captureFindingPresentationEvidence(
                page,
                {
                  runId: 'select-safety-check',
                  pageNumber: 1,
                  candidateNumber: 2,
                  target,
                  allowObservedStateReplay: true
                },
                {
                  captureScreenshot: async () => {
                    if (screenshotFails) {
                      throw new Error('Screenshot fixture failure');
                    }
                  }
                }
              ),
              (error: unknown) => error instanceof CheckQuestError && error.code === 'BROWSER'
            );
          } finally {
            await page.close();
          }
        }
      );
    }
    await check('unprepared selection fails closed', async () => {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      try {
        await page.goto(baseUrl);
        const result = await executeAgentAction(page, action);
        assert.equal(result.status, 'unsafe');
        assert.equal(await page.locator('#country').inputValue(), 'original');
      } finally {
        await page.close();
      }
    });
    await check('ordinary screenshot failure preserves rollback and original error', async () => {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      try {
        await preparePageForGuardedInteractions(page);
        await page.goto(baseUrl);
        const failure = new Error('Optional screenshot failed');
        await assert.rejects(
          captureFindingPresentationEvidence(
            page,
            {
              runId: 'select-safety-check',
              pageNumber: 1,
              candidateNumber: 3,
              target,
              allowObservedStateReplay: true
            },
            {
              captureScreenshot: async () => {
                throw failure;
              }
            }
          ),
          error => error === failure
        );
        assert.equal(await page.locator('#country').inputValue(), 'original');
      } finally {
        await page.close();
      }
    });
    for (const scheduling of ['delayed', 'interval', 'frame']) {
      for (const replay of [false, true]) {
        await check(
          `${scheduling} cached POST blocked after teardown (replay: ${replay})`,
          async () => {
            const page = await browser.newPage({ serviceWorkers: 'block' });
            try {
              await preparePageForGuardedInteractions(page);
              await page.goto(`${baseUrl}?mode=${scheduling}`);
              const before = writes.length;
              let rejected = false;
              if (replay) {
                try {
                  await captureFindingPresentationEvidence(
                    page,
                    {
                      runId: 'select-safety-check',
                      pageNumber: 1,
                      candidateNumber: 4,
                      target,
                      allowObservedStateReplay: true
                    },
                    { captureScreenshot: async () => undefined }
                  );
                } catch (error) {
                  rejected = error instanceof CheckQuestError && error.code === 'BROWSER';
                }
              } else {
                rejected = (await executeAgentAction(page, action)).status === 'unsafe';
              }
              await page.waitForTimeout(700);
              assert.equal(writes.length, before, 'A delayed POST must not escape after teardown.');
              assert.equal(
                rejected,
                true,
                'An interaction scheduling deferred work must be rejected.'
              );
            } finally {
              await page.close();
            }
          }
        );
      }
    }
    for (const phase of ['setup', 'teardown', 'install', 'restore'] as const) {
      await check(`replay ${phase} rejection remains fatal`, async () => {
        const page = await browser.newPage({ serviceWorkers: 'block' });
        try {
          await preparePageForGuardedInteractions(page);
          await page.goto(baseUrl);
          const failure = injectBoundaryFailure(page, phase);
          await assert.rejects(
            captureFindingPresentationEvidence(
              page,
              {
                runId: 'select-safety-check',
                pageNumber: 1,
                candidateNumber: 5,
                target,
                allowObservedStateReplay: true
              },
              { captureScreenshot: async () => undefined }
            ),
            (error: unknown) =>
              error instanceof CheckQuestError &&
              error.phase === 'focused-evidence-safety' &&
              hasCause(error, failure)
          );
        } finally {
          await page.close();
        }
      });
    }
    await check('cancellation keeps priority over a teardown failure', async () => {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      try {
        await preparePageForGuardedInteractions(page);
        await page.goto(baseUrl);
        const abort = new AbortController();
        const failure = new Error('Cancelled teardown failure');
        const unroute = page.unroute.bind(page);
        page.unroute = async (...args) => {
          await unroute(...args);
          abort.abort();
          throw failure;
        };
        await assert.rejects(
          captureFindingPresentationEvidence(
            page,
            {
              runId: 'select-safety-check',
              pageNumber: 1,
              candidateNumber: 7,
              target,
              allowObservedStateReplay: true,
              signal: abort.signal
            },
            { captureScreenshot: async () => undefined }
          ),
          (error: unknown) =>
            error instanceof CheckQuestError &&
            error.code === 'CANCELLED' &&
            hasCause(error, failure)
        );
        assert.equal(await page.locator('#country').inputValue(), 'original');
      } finally {
        await page.close();
      }
    });
    for (const mode of ['restore-replace', 'restore-microtask', 'restore-deferred']) {
      await check(`replacement during restoration rejects: ${mode}`, async () => {
        const page = await browser.newPage({ serviceWorkers: 'block' });
        try {
          await preparePageForGuardedInteractions(page);
          await page.goto(`${baseUrl}?mode=${mode}`);
          await assert.rejects(
            captureFindingPresentationEvidence(
              page,
              {
                runId: 'select-safety-check',
                pageNumber: 1,
                candidateNumber: 6,
                target,
                allowObservedStateReplay: true
              },
              { captureScreenshot: async () => undefined }
            ),
            (error: unknown) =>
              error instanceof CheckQuestError && error.phase === 'focused-evidence-safety'
          );
        } finally {
          await page.close();
        }
      });
    }
    for (const mode of [
      'fetch',
      'replay-clone',
      'inspection-restore-replace',
      'setup',
      'teardown',
      'install',
      'restore'
    ]) {
      await check(`inspection stops after ${mode}`, async () => {
        const events: RunEvent[] = [];
        let analysisCalls = 0;
        const originalLaunch = chromium.launch;
        if (mode === 'setup' || mode === 'teardown' || mode === 'install' || mode === 'restore') {
          chromium.launch = async options => {
            const runBrowser = await originalLaunch.call(chromium, options);
            const newPage = runBrowser.newPage.bind(runBrowser);
            runBrowser.newPage = async options => {
              const page = await newPage(options);
              injectBoundaryFailure(page, mode, 2);
              return page;
            };
            return runBrowser;
          };
        }
        try {
          await assert.rejects(
            runSite({
              runId: `select-safety-${mode}`,
              site: {
                id: 'local',
                name: 'Select safety',
                startUrl: `${baseUrl}?mode=${mode}`,
                allowedHosts: ['127.0.0.1'],
                maxPages: 2,
                maxAgentSteps: 1,
                maxExploratoryStepsPerPage: 1,
                allowFormSubmission: false
              },
              onEvent: event => {
                events.push(event);
              },
              dependencies: {
                analyzePageForQa: async () => {
                  analysisCalls++;
                  return {
                    summary: 'Select fixture',
                    findings: [
                      {
                        category: 'content',
                        severity: 'low',
                        confidence: 'high',
                        title: 'Country option typo',
                        evidence: 'Country contains Equador.',
                        reasoning: 'Possible typo.',
                        suggestedCheck: 'Check option spelling.',
                        evidenceTarget: target
                      }
                    ]
                  };
                },
                planNextAction: async input => ({
                  candidateReference: input.investigableCandidates[0]!.reference,
                  hypothesis: 'Check option',
                  reasoning: 'Exact candidate',
                  action,
                  expectedObservation: 'Option selected'
                }),
                chooseNavigationLink: async () => {
                  throw new Error('Navigation must not occur.');
                }
              }
            }),
            (error: unknown) => error instanceof CheckQuestError && error.code === 'BROWSER'
          );
        } finally {
          chromium.launch = originalLaunch;
        }
        assert.equal(analysisCalls, 1);
        assert.equal(events.filter(event => event.type === 'inspection-completed').length, 0);
        assert.equal(events.filter(event => event.type === 'run-completed').length, 0);
        assert.equal(events.filter(event => event.type === 'run-failed').length, 1);
      });
    }
    assert.equal(failures.length, 0, `${failures.length} select safety checks failed.`);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
