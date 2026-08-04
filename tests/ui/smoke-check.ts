import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { _electron as electron } from '@playwright/test';

import type { CheckQuestDesktopApi, DesktopRunEvent } from '../../desktop/contracts';
import { desktopIpcChannels } from '../../desktop/contracts';

interface RendererGlobal {
  process?: unknown;
  require?: unknown;
  checkQuestDesktop?: CheckQuestDesktopApi;
}

async function main(): Promise<void> {
  const electronApplication = await electron.launch({
    args: [resolve('.desktop-dist', 'main.cjs')]
  });

  try {
    const window = await electronApplication.firstWindow();

    await window.waitForLoadState('domcontentloaded');
    await window.locator('#run-form').waitFor();

    const emitRunEvent = (event: DesktopRunEvent) =>
      electronApplication.evaluate(
        ({ BrowserWindow }, payload) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send(payload.channel, payload.event);
        },
        {
          channel: desktopIpcChannels.runEvent,
          event
        }
      );

    const nativeWindowState = await electronApplication.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];

      return {
        maximized: window?.isMaximized() ?? true,
        bounds: window?.getBounds() ?? null,
        minimumSize: window?.getMinimumSize() ?? null,
        workArea: screen.getPrimaryDisplay().workAreaSize
      };
    });

    assert.equal(nativeWindowState.maximized, false);
    assert.ok(nativeWindowState.bounds !== null);
    assert.equal(
      nativeWindowState.bounds.width <= nativeWindowState.workArea.width &&
        nativeWindowState.bounds.height <= nativeWindowState.workArea.height,
      true
    );
    assert.equal(
      nativeWindowState.bounds.width >= 796 && nativeWindowState.bounds.width <= 808,
      true,
      JSON.stringify(nativeWindowState)
    );
    assert.deepEqual(nativeWindowState.minimumSize, [720, 560]);
    assert.equal(
      (await stat(resolve('.desktop-dist', 'renderer', 'checkquest-icon.png'))).size > 0,
      true
    );

    assert.deepEqual(
      await window.evaluate(() => {
        const api = (globalThis as RendererGlobal).checkQuestDesktop;

        return {
          processType: typeof (globalThis as RendererGlobal).process,
          requireType: typeof (globalThis as RendererGlobal).require,
          apiMethods: api === undefined ? [] : Object.keys(api).sort()
        };
      }),
      {
        processType: 'undefined',
        requireType: 'undefined',
        apiMethods: ['cancelRun', 'getSessionCredentialStatus', 'onRunEvent', 'startRun']
      }
    );

    assert.deepEqual(
      await window.evaluate(() => {
        const productBar = document.querySelector('.product-bar');
        const rail = document.querySelector('.navigation-rail');
        const workspace = document.querySelector('.workspace');
        const status = document.querySelector('#run-status');

        return {
          productBar: productBar !== null,
          rail: rail !== null,
          workspace: workspace !== null,
          workspaceFits: workspace !== null && workspace.scrollHeight <= workspace.clientHeight,
          status: status !== null,
          statusInsideForm: status?.closest('form') !== null,
          statusHeight: status?.getBoundingClientRect().height ?? 0,
          statusBottom: status?.getBoundingClientRect().bottom ?? 0,
          viewportBottom: globalThis.innerHeight,
          horizontalOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          bodyOverflow: getComputedStyle(document.body).overflow
        };
      }),
      {
        productBar: true,
        rail: true,
        workspace: true,
        workspaceFits: true,
        status: true,
        statusInsideForm: false,
        statusHeight: 42,
        statusBottom: await window.evaluate(() => globalThis.innerHeight),
        viewportBottom: await window.evaluate(() => globalThis.innerHeight),
        horizontalOverflow: false,
        bodyOverflow: 'hidden'
      }
    );

    assert.equal(await window.locator('[data-destination-button]').count(), 4);
    assert.equal(await window.locator('.wip-badge').count(), 3);
    assert.equal(
      await window.locator('[data-destination-button="run"]').getAttribute('aria-current'),
      'page'
    );
    assert.equal(await window.locator('#destination-run').isVisible(), true);

    assert.equal(await window.locator('#run-configuration-title').innerText(), 'Run Configuration');
    assert.deepEqual(await window.locator('.settings-section h2').allInnerTexts(), [
      'TARGET',
      'EXPLORATION BUDGETS',
      'AI CONFIGURATION'
    ]);
    assert.equal(
      await window
        .getByText('Steps per page', {
          exact: true
        })
        .count(),
      0
    );
    assert.deepEqual(await window.locator('.budget-copy > p').allInnerTexts(), [
      'Maximum pages CheckQuest may inspect during this run.',
      'Maximum moves to another approved page while exploring.',
      'Maximum bounded evidence-gathering interactions per page.'
    ]);
    assert.equal(
      await window.locator('.info-help, .help-wrap, .field-tooltip, [role="tooltip"]').count(),
      0
    );

    const placeholders = [
      {
        name: 'explore',
        text: 'Run history and previous CheckQuest runs will live here.'
      },
      {
        name: 'reports',
        text: 'Findings, evidence, and saved CheckQuest reports will live here.'
      },
      {
        name: 'settings',
        text: 'Persistent local CheckQuest preferences will live here.'
      }
    ] as const;

    await window.locator('#target-url').fill('preserved.example');

    for (const destination of placeholders) {
      await window.locator(`[data-destination-button="${destination.name}"]`).click();
      assert.equal(await window.locator(`#destination-${destination.name}`).isVisible(), true);
      assert.equal(
        await window
          .locator(`#destination-${destination.name}`)
          .getByText(destination.text, {
            exact: true
          })
          .count(),
        1
      );
      assert.equal(
        await window
          .locator(
            `#destination-${destination.name} input, #destination-${destination.name} button`
          )
          .count(),
        0
      );
    }

    await window.locator('[data-destination-button="run"]').click();
    assert.equal(await window.locator('#target-url').inputValue(), 'preserved.example');

    assert.equal(await window.locator('#vocabulary-button').count(), 1);
    const layoutBeforeVocabulary = await window.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight
    }));
    await window.locator('#vocabulary-button').click();
    assert.equal(await window.locator('#vocabulary-popover').isVisible(), true);
    assert.deepEqual(await window.locator('#vocabulary-popover h2').allInnerTexts(), [
      'Page',
      'Navigation',
      'Investigation step',
      'Finding'
    ]);
    assert.equal(
      await window.locator('#vocabulary-popover').evaluate(element => {
        const bounds = element.getBoundingClientRect();

        return (
          getComputedStyle(element).position === 'fixed' &&
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= globalThis.innerWidth &&
          bounds.bottom <= globalThis.innerHeight
        );
      }),
      true
    );
    assert.deepEqual(
      await window.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight
      })),
      layoutBeforeVocabulary
    );
    await window.keyboard.press('Escape');
    assert.equal(await window.locator('#vocabulary-popover').isHidden(), true);
    assert.equal(await window.evaluate(() => document.activeElement?.id), 'vocabulary-button');
    await window.locator('#vocabulary-button').click();
    await window.locator('#target-url').click();
    assert.equal(await window.locator('#vocabulary-popover').isHidden(), true);

    assert.deepEqual(
      await Promise.all([
        window.locator('#page-budget').inputValue(),
        window.locator('#navigation-budget').inputValue(),
        window.locator('#investigation-budget').inputValue()
      ]),
      ['3', '4', '3']
    );
    assert.deepEqual(
      await Promise.all([
        window.locator('#page-budget-range').innerText(),
        window.locator('#navigation-budget-range').innerText(),
        window.locator('#investigation-budget-range').innerText()
      ]),
      ['1–20', '1–50', '1–10']
    );
    assert.equal(await window.locator('.number-stepper').count(), 3);
    assert.equal(await window.locator('.stepper-button').count(), 6);

    await window.locator('#page-budget').fill('9');
    await window.locator('#navigation-budget').fill('10');
    await window.locator('#investigation-budget').fill('8');
    await window.locator('#gemini-api-key').fill('ephemeral-smoke-key');
    await window.locator('#reset-defaults').click();
    assert.deepEqual(
      await Promise.all([
        window.locator('#page-budget').inputValue(),
        window.locator('#navigation-budget').inputValue(),
        window.locator('#investigation-budget').inputValue(),
        window.locator('#target-url').inputValue(),
        window.locator('#gemini-api-key').inputValue()
      ]),
      ['3', '4', '3', 'preserved.example', 'ephemeral-smoke-key']
    );

    const pageBudget = window.locator('#page-budget');
    await pageBudget.fill('1');
    assert.equal(await window.locator('#page-budget-decrement').isDisabled(), true);
    await pageBudget.fill('20');
    assert.equal(await window.locator('#page-budget-increment').isDisabled(), true);
    await pageBudget.fill('5');
    await pageBudget.press('ArrowUp');
    assert.equal(await pageBudget.inputValue(), '6');
    await window.locator('#reset-defaults').click();

    assert.equal(await window.locator('#gemini-api-key').getAttribute('type'), 'password');
    assert.equal(
      await window.locator('#gemini-api-key-help').innerText(),
      'Kept only until you close CheckQuest'
    );
    assert.equal(await window.locator('#run-button').isEnabled(), true);
    assert.equal(await window.locator('#cancel-button').isDisabled(), true);

    const smokeEventCommon = {
      timestamp: '2026-07-28T12:00:00.000Z',
      runId: 'desktop-shell-smoke',
      message: 'Synthetic smoke event.'
    } as const;

    await emitRunEvent({
      ...smokeEventCommon,
      type: 'target-preflight-started'
    });
    await window.waitForFunction(
      () => document.querySelector('#run-button-label')?.textContent === 'Checking…'
    );
    assert.equal(await window.locator('#run-form').getAttribute('data-locked'), 'true');
    assert.equal(
      await window.locator('#run-eligibility-hint').innerText(),
      'Configuration is locked for the active run.'
    );
    for (const selector of [
      '#target-url',
      '#page-budget',
      '#navigation-budget',
      '#investigation-budget',
      '#gemini-api-key',
      '#reset-defaults'
    ]) {
      assert.equal(await window.locator(selector).isDisabled(), true);
    }
    assert.equal(await window.locator('#cancel-button').isEnabled(), true);

    await window.locator('[data-destination-button="reports"]').click();
    assert.equal(await window.locator('#destination-reports').isVisible(), true);
    assert.equal(await window.locator('#status-label').innerText(), 'Checking website…');
    await window.locator('[data-destination-button="run"]').click();
    assert.equal(await window.locator('#run-form').getAttribute('data-locked'), 'true');

    await emitRunEvent({
      ...smokeEventCommon,
      type: 'run-started',
      pageBudget: 3,
      navigationBudget: 4
    });
    await emitRunEvent({
      ...smokeEventCommon,
      type: 'navigation-started',
      navigationStep: 1,
      navigationBudget: 4,
      pageNumber: 2
    });
    await emitRunEvent({
      ...smokeEventCommon,
      type: 'inspection-started',
      pageNumber: 2
    });
    assert.deepEqual(
      await Promise.all([
        window.locator('#status-pages').innerText(),
        window.locator('#status-navigation').innerText(),
        window.locator('#status-label').innerText()
      ]),
      ['2 of 3', '1 of 4', 'Inspecting page 2']
    );
    assert.equal((await window.locator('#run-status').innerText()).includes('%'), false);
    assert.equal(
      await window
        .locator('#run-status')
        .evaluate(element => element.getBoundingClientRect().height),
      42
    );

    assert.deepEqual(
      await window.evaluate(() => {
        (document.querySelector('#cancel-button') as HTMLButtonElement).click();

        return {
          label: document.querySelector('#status-label')?.textContent,
          cancelDisabled: (document.querySelector('#cancel-button') as HTMLButtonElement).disabled
        };
      }),
      {
        label: 'Cancelling…',
        cancelDisabled: true
      }
    );
    await emitRunEvent({
      ...smokeEventCommon,
      type: 'run-failed',
      code: 'CANCELLED'
    });
    assert.equal(await window.locator('#status-label').innerText(), 'Cancelled');
    assert.equal(await window.locator('#target-url').isEnabled(), true);

    const initialUrl = window.url();
    await window.evaluate(() => {
      const link = document.createElement('a');

      link.href = 'https://example.com/';
      document.body.append(link);
      link.click();
    });
    await window.waitForTimeout(200);
    assert.equal(window.url(), initialUrl);

    await electronApplication.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(720, 560);
    });
    await window.waitForTimeout(100);
    assert.deepEqual(
      await window.evaluate(() => ({
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        statusHeight: document.querySelector('#run-status')?.getBoundingClientRect().height ?? 0,
        navigationVisible:
          (document.querySelector('.navigation-rail') as HTMLElement).getBoundingClientRect()
            .width > 0,
        runButtonVisible:
          (document.querySelector('#run-button') as HTMLElement).getBoundingClientRect().width > 0
      })),
      {
        horizontalOverflow: false,
        statusHeight: 42,
        navigationVisible: true,
        runButtonVisible: true
      }
    );

    console.log('Electron desktop smoke check passed.');
  } finally {
    await electronApplication.close();
  }
}

void main();
