import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { chromium } from '@playwright/test';

import { collectPageDiagnostics } from '../../agent/browser/collect-page-diagnostics';
import { extractPageContent } from '../../agent/browser/extract-page-content';
import { preparePageForGuardedInteractions } from '../../agent/browser/guarded-interaction-safety-boundary';
import { visitApprovedLinkWithPassiveSecurity } from '../../agent/browser/visit-approved-link';
import { createNavigationFrontier } from '../../agent/exploration/navigation-policy';
import { createPageNoveltyState } from '../../agent/exploration/page-novelty';
import { createNavigationUrlState } from '../../agent/exploration/visited-links';
import { createRunFindingLifecycle } from '../../agent/findings/run-finding-lifecycle';
import { inspectPage } from '../../agent/inspection/inspect-page';
import { createPassiveSecurityRegistry } from '../../agent/security/passive-security-registry';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

const cases = [
  { name: 'password-within-sample', ordinary: 29, password: '', suppress: true },
  { name: 'password-after-30', ordinary: 30, password: '', suppress: true },
  { name: 'ordinary-page', ordinary: 1, password: null, suppress: false },
  { name: '35-ordinary-fields', ordinary: 35, password: null, suppress: false },
  { name: 'hidden-password', ordinary: 30, password: 'hidden', suppress: false },
  {
    name: 'display-none-password',
    ordinary: 30,
    password: 'style="display:none"',
    suppress: false
  },
  {
    name: 'visibility-hidden-password',
    ordinary: 30,
    password: 'style="visibility:hidden"',
    suppress: false
  },
  {
    name: 'zero-size-password',
    ordinary: 30,
    password: 'style="width:0;height:0;padding:0;border:0"',
    suppress: false
  },
  {
    name: 'disabled-readonly-password',
    ordinary: 30,
    password: 'disabled readonly',
    suppress: true
  },
  { name: 'transparent-password', ordinary: 30, password: 'style="opacity:0"', suppress: true }
] as const;

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    const fixture = cases.find(item => request.url === `/${item.name}`);
    assert.ok(fixture, 'Only explicit local fixture paths may be requested.');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><title>Password suppression</title><link rel="icon" href="data:,">
      <button id="faq" type="button" aria-expanded="false" aria-controls="answer">FAQ</button>
      <div id="answer" hidden>Informational content</div>
      ${Array.from({ length: fixture.ordinary }, (_, index) => `<input type="text" id="field-${index}">`).join('')}
      ${fixture.password === null ? '' : `<input type="password" id="password" value="fixture-password-secret" ${fixture.password}>`}
      <script>
        window.clicks = 0;
        document.getElementById('faq').onclick = () => {
          window.clicks++;
          const control = document.getElementById('faq');
          const expanded = control.getAttribute('aria-expanded') === 'true';
          control.setAttribute('aria-expanded', String(!expanded));
          document.getElementById('answer').hidden = expanded;
        };
      </script>`);
  });
  const port = await listenOnBrowserSafeLoopbackPort(server, 'Password page safety');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const failures: unknown[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const fixture of cases) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await preparePageForGuardedInteractions(page);
        const diagnostics = collectPageDiagnostics(page);
        try {
          const url = `http://127.0.0.1:${port}/${fixture.name}`;
          const visit = await visitApprovedLinkWithPassiveSecurity(page, { text: 'Fixture', url }, [
            '127.0.0.1'
          ]);
          const content = await extractPageContent(page);
          let plannerCalls = 0;
          const result = await inspectPage({
            page,
            runId: `password-safety-${fixture.name}`,
            pageIndex: 0,
            site: {
              id: 'local',
              name: 'Password safety',
              startUrl: url,
              allowedHosts: ['127.0.0.1'],
              maxPages: 1,
              maxAgentSteps: 0,
              maxExploratoryStepsPerPage: 1,
              allowFormSubmission: false
            },
            currentPage: { ...visit, selection: { type: 'start-url', url }, traversalDepth: 0 },
            diagnosticsCollector: diagnostics,
            navigationFrontier: createNavigationFrontier(),
            navigationUrlState: createNavigationUrlState(),
            pageNoveltyState: createPageNoveltyState(),
            passiveSecurityRegistry: createPassiveSecurityRegistry(),
            findingLifecycle: createRunFindingLifecycle(),
            dependencies: {
              analyzePageForQa: async () => ({
                summary: 'Fixture candidate',
                findings: [
                  {
                    category: 'interaction',
                    severity: 'low',
                    confidence: 'high',
                    title: 'FAQ disclosure',
                    evidence: 'FAQ controls answer',
                    reasoning: 'Test the exact informational disclosure',
                    suggestedCheck: 'Expand and restore FAQ',
                    evidenceTarget: {
                      kind: 'disclosure-state',
                      controlId: 'faq',
                      accessibleName: 'FAQ',
                      controlledRegionId: 'answer',
                      desiredState: 'expanded'
                    }
                  }
                ]
              }),
              planNextAction: async input => {
                plannerCalls++;
                return {
                  candidateReference: input.investigableCandidates[0]!.reference,
                  hypothesis: 'FAQ expands',
                  reasoning: 'Exact fixture target',
                  action: {
                    kind: 'set-disclosure-state',
                    target: {
                      controlId: 'faq',
                      accessibleName: 'FAQ',
                      controlledRegionId: 'answer'
                    },
                    desiredState: 'expanded'
                  },
                  expectedObservation: 'Answer visible then restored'
                };
              }
            }
          });
          const clicks = await page.evaluate(
            () => (window as unknown as { clicks: number }).clicks
          );
          console.log(
            `${fixture.name}: fields=${content.textFields.length}, sampledPassword=${content.textFields.some(field => field.inputType === 'password')}, passwordSignal=${content.containsPasswordField}, planner=${plannerCalls}, clicks=${clicks}`
          );
          assert.equal(
            plannerCalls,
            fixture.suppress ? 0 : 1,
            'Password pages must never invoke the planner.'
          );
          assert.equal(
            clicks,
            fixture.suppress ? 0 : 2,
            'Password pages must never execute the action or rollback.'
          );
          assert.equal(result.pageResult.exploratoryInvestigation === null, fixture.suppress);
          assert.equal(content.containsPasswordField, fixture.suppress);
          assert.equal(
            content.textFields.some(field => field.inputType === 'password'),
            fixture.suppress && fixture.ordinary < 30
          );
          assert.equal(
            content.textFields.length,
            Math.min(30, fixture.ordinary + (fixture.suppress ? 1 : 0))
          );
          assert.equal(content.disclosures[0]?.eligibleForDisclosureAction, true);
          assert.equal(JSON.stringify(content).includes('fixture-password-secret'), false);
          console.log(`PASS: ${fixture.name}`);
        } finally {
          diagnostics.dispose();
        }
      } catch (error) {
        failures.push(error);
        console.error(`FAIL: ${fixture.name}`, error);
      } finally {
        await context.close();
      }
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  }
  assert.equal(failures.length, 0, 'Password-page safety regressions failed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
