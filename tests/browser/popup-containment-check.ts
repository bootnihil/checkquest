import assert from 'node:assert/strict';
import { getEventListeners, type EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { chromium, type Page } from '@playwright/test';

import type { AgentAction } from '../../agent/actions/agent-action-schema';
import { executeAgentAction } from '../../agent/browser/execute-agent-action';
import {
  preparePageForGuardedInteractions,
  runGuardedInteractionSafetyBoundary
} from '../../agent/browser/guarded-interaction-safety-boundary';
import { getSecondaryCleanupError } from '../../agent/errors/required-cleanup';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

const actions: AgentAction[] = [
  {
    kind: 'set-disclosure-state',
    target: { controlId: 'faq', accessibleName: 'FAQ', controlledRegionId: 'answer' },
    desiredState: 'expanded'
  },
  {
    kind: 'select-tab',
    target: {
      controlId: 'details',
      accessibleName: 'Details',
      tabListId: 'tabs',
      controlledPanelId: 'details-panel'
    },
    desiredState: 'selected'
  }
];

function markup(popupUrl: string | null): string {
  return `<!doctype html><title>Popup containment</title>
    <button id="faq" type="button" aria-expanded="false" aria-controls="answer">FAQ</button>
    <div id="answer" hidden>Informational answer</div>
    <div id="tabs" role="tablist">
      <button id="overview" type="button" role="tab" aria-selected="true" aria-controls="overview-panel">Overview</button>
      <button id="details" type="button" role="tab" aria-selected="false" aria-controls="details-panel">Details</button>
    </div>
    <div id="overview-panel" role="tabpanel">Overview content</div>
    <div id="details-panel" role="tabpanel" hidden>Details content</div>
    <script>
      document.getElementById('faq').onclick = () => {
        const control = document.getElementById('faq');
        const expanded = control.getAttribute('aria-expanded') === 'true';
        control.setAttribute('aria-expanded', String(!expanded));
        document.getElementById('answer').hidden = expanded;
      };
      for (const id of ['overview', 'details']) {
        document.getElementById(id).onclick = () => {
          for (const other of ['overview', 'details']) {
            document.getElementById(other).setAttribute('aria-selected', String(other === id));
            document.getElementById(other + '-panel').hidden = other !== id;
          }
        };
      }
      for (const id of ['faq', 'details']) {
        document.getElementById(id).addEventListener('click', () => {
          if (${JSON.stringify(popupUrl)} === null) return;
          const anchor = document.createElement('a');
          anchor.href = ${JSON.stringify(popupUrl)};
          anchor.target = '_blank';
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        });
      }
    </script>`;
}

function injectFailure(page: Page, phase: string, removals: Set<string>): Error {
  const context = page.context();
  const failure = new Error(`Injected ${phase} failure`);
  const pageRoute = page.route.bind(page);
  const contextRoute = context.route.bind(context);
  const pageUnroute = page.unroute.bind(page);
  const contextUnroute = context.unroute.bind(context);
  const evaluate = page.evaluate.bind(page);
  page.route = async (...args) => {
    const registration = await pageRoute(...args);
    if (phase === 'page-setup') {
      throw failure;
    }
    return registration;
  };
  context.route = async (...args) => {
    const registration = await contextRoute(...args);
    if (phase === 'context-setup') {
      throw failure;
    }
    return registration;
  };
  page.unroute = async (...args) => {
    removals.add('page');
    if (phase === 'page-cleanup-before') {
      throw failure;
    }
    await pageUnroute(...args);
    if (phase === 'page-cleanup') {
      throw failure;
    }
  };
  context.unroute = async (...args) => {
    removals.add('context');
    if (phase === 'context-cleanup-before') {
      throw failure;
    }
    await contextUnroute(...args);
    if (phase === 'context-cleanup') {
      throw failure;
    }
  };
  page.evaluate = (async (...args: Parameters<Page['evaluate']>) => {
    const source = String(args[0]);
    if (
      (phase === 'guard-install' && source.includes('const originalFetch')) ||
      (phase === 'guard-restore' && source.includes('store.restore()'))
    ) {
      throw failure;
    }
    return evaluate(...args);
  }) as Page['evaluate'];
  return failure;
}

function hasCause(error: unknown, expected: Error): boolean {
  for (let depth = 0; error instanceof Error && depth < 8; depth++) {
    if (error === expected) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

async function main(): Promise<void> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Popup destination</title>Popup received');
  });
  const port = await listenOnBrowserSafeLoopbackPort(server, 'Popup containment');
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
    const browser = await chromium.launch({ headless: true });
    try {
      for (const action of actions) {
        await check(`${action.kind} contains the initial popup request`, async () => {
          const context = await browser.newContext({ serviceWorkers: 'block' });
          try {
            const page = await context.newPage();
            await preparePageForGuardedInteractions(page);
            const path = `/popup-${action.kind}`;
            await page.setContent(markup(`http://127.0.0.1:${port}${path}`));
            const result = await executeAgentAction(page, action);
            await page.waitForTimeout(150);
            const received = requests.filter(url => url === path).length;
            console.log(
              `${action.kind}: server received ${received} popup request(s), status=${result.status}`
            );
            assert.equal(received, 0, 'The initial popup request must never reach the server.');
            assert.equal(result.status, 'unsafe');
            assert.equal(result.hardBreach, true);
          } finally {
            await context.close();
          }
        });
        for (const phase of [
          'page-setup',
          'context-setup',
          'page-cleanup',
          'context-cleanup',
          'page-cleanup-before',
          'context-cleanup-before',
          'guard-install',
          'guard-restore'
        ]) {
          for (const openPopup of phase.includes('cleanup') || phase === 'guard-restore'
            ? [false, true]
            : [true]) {
            await check(
              `${action.kind} fails closed on ${phase} (popup: ${openPopup})`,
              async () => {
                const context = await browser.newContext({ serviceWorkers: 'block' });
                try {
                  const page = await context.newPage();
                  await preparePageForGuardedInteractions(page);
                  const path = `/popup-${action.kind}-${phase}`;
                  const requestsBefore = requests.filter(url => url === path).length;
                  await page.setContent(
                    markup(openPopup ? `http://127.0.0.1:${port}${path}` : null)
                  );
                  let pageRouteHits = 0;
                  let contextRouteHits = 0;
                  const pageListener = (): void => undefined;
                  const contextListener = (): void => undefined;
                  page.on('popup', pageListener);
                  context.on('page', contextListener);
                  const pageEmitter = page as unknown as EventEmitter;
                  const contextEmitter = context as unknown as EventEmitter;
                  const listenersBefore = [
                    getEventListeners(pageEmitter, 'popup'),
                    getEventListeners(contextEmitter, 'page')
                  ];
                  await page.route('**/*', async route => {
                    if (!route.request().url().endsWith('/unrelated-page')) {
                      await route.fallback();
                      return;
                    }
                    pageRouteHits++;
                    await route.fulfill({ body: 'Existing page route' });
                  });
                  await context.route('**/*', async route => {
                    if (!route.request().url().endsWith('/unrelated-context')) {
                      await route.fallback();
                      return;
                    }
                    contextRouteHits++;
                    await route.fulfill({ body: 'Existing context route' });
                  });
                  const removals = new Set<string>();
                  const failure = injectFailure(page, phase, removals);
                  const result = await executeAgentAction(page, action).then(
                    value => ({ value, error: undefined }),
                    (error: unknown) => ({ value: undefined, error })
                  );
                  if (phase === 'guard-install') {
                    assert.equal(result.value?.status, 'unsafe');
                  } else {
                    assert.ok(
                      hasCause(result.error, failure) ||
                        hasCause(getSecondaryCleanupError(result.error), failure),
                      'Required containment failure must reject.'
                    );
                  }
                  assert.deepEqual([...removals].sort(), ['context', 'page']);
                  assert.deepEqual(
                    [
                      getEventListeners(pageEmitter, 'popup'),
                      getEventListeners(contextEmitter, 'page')
                    ],
                    listenersBefore
                  );
                  if (!phase.endsWith('-before')) {
                    await page.goto(`http://127.0.0.1:${port}/unrelated-page`);
                    const otherPage = await context.newPage();
                    await otherPage.goto(`http://127.0.0.1:${port}/unrelated-context`);
                    assert.equal(pageRouteHits, 1);
                    assert.equal(contextRouteHits, 1);
                  }
                  assert.equal(requests.filter(url => url === path).length, requestsBefore);
                } finally {
                  await context.close();
                }
              }
            );
          }
        }
      }
      await check('operation failure cannot hide required route cleanup failure', async () => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          await preparePageForGuardedInteractions(page);
          await page.setContent(markup(null));
          const removals = new Set<string>();
          const cleanupError = injectFailure(page, 'context-cleanup', removals);
          const operationError = new Error('Injected operation failure');
          await assert.rejects(
            runGuardedInteractionSafetyBoundary(page, 'cleanup failure check', async () => {
              throw operationError;
            }),
            (error: unknown) =>
              error === operationError && hasCause(getSecondaryCleanupError(error), cleanupError)
          );
          assert.deepEqual([...removals].sort(), ['context', 'page']);
        } finally {
          await context.close();
        }
      });
      await check('unrelated existing pages and routes survive containment', async () => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          const otherPage = await context.newPage();
          await preparePageForGuardedInteractions(page);
          await page.setContent('<!doctype html><title>Prepared page</title>');
          let contextRouteHits = 0;
          let pageRouteHits = 0;
          await context.route('**/*', async route => {
            if (!route.request().url().endsWith('/existing')) {
              await route.fallback();
              return;
            }
            contextRouteHits++;
            await route.fulfill({ body: 'Existing context route' });
          });
          await page.route('**/*', async route => {
            if (!route.request().url().endsWith('/existing')) {
              await route.fallback();
              return;
            }
            pageRouteHits++;
            await route.fulfill({ body: 'Existing page route' });
          });
          const result = await runGuardedInteractionSafetyBoundary(
            page,
            'route isolation check',
            async () => {
              await otherPage.goto(`http://127.0.0.1:${port}/existing`);
            }
          );
          assert.equal(result.status, 'completed');
          await page.goto(`http://127.0.0.1:${port}/existing`);
          await otherPage.goto(`http://127.0.0.1:${port}/existing`);
          assert.equal(pageRouteHits, 1);
          assert.equal(contextRouteHits, 2);
          await page.goto(`http://127.0.0.1:${port}/released`);
          assert.ok(
            requests.includes('/released'),
            'Owned page and context routes must be released.'
          );
        } finally {
          await context.close();
        }
      });
    } finally {
      await browser.close();
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
  assert.equal(failures.length, 0, 'Popup containment regressions failed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
