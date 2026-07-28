import assert from 'node:assert/strict';
import {
  access
} from 'node:fs/promises';

import {
  chromium
} from '@playwright/test';

import {
  captureFindingPresentationEvidence
} from './browser/capture-finding-presentation-evidence';

async function main(): Promise<void> {
  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage({
        viewport: {
          width:
            900,
          height:
            400
        }
      });

    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Focused evidence fixture</title>
          <style>
            body { margin: 0; font: 16px system-ui; }
            .nearby { padding: 20px; }
            .spacer { height: 520px; }
            .target { margin: 0; padding: 12px; }
          </style>
        </head>
        <body>
          <h1 class="target">Single exact target</h1>
          <label for="country">Country</label>
          <select id="country" name="country">
            <option value="ecuador">Ecuador</option>
            <option value="equador">Equador</option>
          </select>
          <div class="nearby">
            <button>Repeated nearby target</button>
            <button>Repeated nearby target</button>
          </div>
          <div class="spacer"></div>
          <h2 class="target">Separated target</h2>
          <div class="spacer"></div>
          <h2 class="target">Separated target</h2>
          <div class="spacer"></div>
          <h2 class="target">Separated target</h2>
          <div class="spacer"></div>
          <h2 class="target">Separated target</h2>
          <div class="spacer"></div>
          <h2 class="target">Separated target</h2>
          <div class="spacer"></div>
          <button>Failure target</button>
        </body>
      </html>
    `);

    const runId =
      'focused-evidence-browser-check';
    const single =
      await captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            1,
          target: {
            kind:
              'visible-text',
            elementKind:
              'heading',
            text:
              'Single exact target'
          }
        }
      );

    assert.equal(
      single.totalTargetCount,
      1
    );
    assert.equal(
      single.screenshotPaths
        .length,
      1
    );

    const nearby =
      await captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            2,
          target: {
            kind:
              'visible-text',
            elementKind:
              'button',
            text:
              'Repeated nearby target'
          }
        }
      );

    assert.equal(
      nearby.totalTargetCount,
      2
    );
    assert.equal(
      nearby.screenshotPaths
        .length,
      1,
      'Nearby targets should share one focused image.'
    );

    const separated =
      await captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            3,
          target: {
            kind:
              'visible-text',
            elementKind:
              'heading',
            text:
              'Separated target'
          }
        }
      );

    assert.equal(
      separated.totalTargetCount,
      5
    );
    assert.equal(
      separated.screenshotPaths
        .length,
      3,
      'Separated targets should be capped at three images.'
    );
    assert.equal(
      separated.shownTargetCount,
      3
    );

    for (
      const filePath of
        [
          ...single
            .screenshotPaths,
          ...nearby
            .screenshotPaths,
          ...separated
            .screenshotPaths
        ]
    ) {
      await access(
        filePath
      );
    }

    assert.equal(
      await page.locator(
        '[data-checkquest-presentation-evidence]'
      ).count(),
      0,
      'Annotations must be removed after successful capture.'
    );

    const selectTarget = {
      kind:
        'select-option' as const,
      controlLabel:
        'Country',
      controlName:
        'country',
      controlId:
        'country',
      optionText:
        'Equador'
    };
    const withheldReplay =
      await captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            4,
          target:
            selectTarget
        }
      );

    assert.equal(
      withheldReplay
        .screenshotPaths
        .length,
      0,
      'A transient select state is not replayed unless that exact action was already observed.'
    );

    const replayed =
      await captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            5,
          target:
            selectTarget,
          allowObservedStateReplay:
            true
        }
      );

    assert.equal(
      replayed.replay
        ?.action,
      'select-option'
    );
    assert.equal(
      replayed.replay
        ?.restored,
      true,
      'An allowed benign replay records that its original state was restored.'
    );
    assert.equal(
      await page.locator(
        '#country'
      ).inputValue(),
      'ecuador',
      'Evidence replay must restore the original local selection.'
    );

    await page.evaluate(
      () =>
        window.scrollTo(
          0,
          240
        )
    );
    const originalScrollY =
      await page.evaluate(
        () =>
          window.scrollY
      );

    await assert.rejects(
      captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber:
            1,
          candidateNumber:
            6,
          target: {
            kind:
              'visible-text',
            elementKind:
              'button',
            text:
              'Failure target'
          }
        },
        {
          captureScreenshot:
            async () => {
              throw new Error(
                'Forced screenshot failure.'
              );
            }
        }
      ),
      /Forced screenshot failure/
    );
    assert.equal(
      await page.locator(
        '[data-checkquest-presentation-evidence]'
      ).count(),
      0,
      'Annotations must be removed after failed capture.'
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.scrollY
      ),
      originalScrollY,
      'The original scroll position must be restored.'
    );

    console.log(
      'Focused evidence browser check passed.'
    );
  } finally {
    await browser.close();
  }
}

void main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Focused evidence browser check failed:',
      error
    );
    process.exitCode =
      1;
  }
);
