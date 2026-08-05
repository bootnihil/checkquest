import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { captureFindingPresentationEvidence } from '../../agent/browser/capture-finding-presentation-evidence';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 900,
        height: 400
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
          <label for="clone-country">Clone Country</label>
          <select id="clone-country" name="clone-country">
            <option value="original">Original option</option>
            <option value="changed">Changed option</option>
          </select>
          <select name="shared-control">
            <option value="shared">Shared option</option>
          </select>
          <select name="shared-control">
            <option value="shared">Shared option</option>
          </select>
          <button
            id="disclosure-id-only"
            type="button"
            aria-expanded="false"
            aria-controls="disclosure-conflict-region"
          >Different disclosure name</button>
          <button
            id="disclosure-name-only"
            type="button"
            aria-expanded="false"
            aria-controls="disclosure-conflict-region"
          >Conflicting disclosure name</button>
          <div id="disclosure-conflict-region">Conflict region</div>
          <button
            id="wrong-region-disclosure"
            type="button"
            aria-expanded="false"
            aria-controls="actual-disclosure-region"
          >Wrong region disclosure</button>
          <div id="actual-disclosure-region">Actual region</div>
          <div id="claimed-disclosure-region">Claimed region</div>
          <button
            id="exact-disclosure"
            type="button"
            aria-expanded="false"
            aria-controls="exact-disclosure-region"
          >Exact disclosure</button>
          <div id="exact-disclosure-region">Exact disclosure region</div>
          <span id="labelled-disclosure-name">Labelled disclosure name</span>
          <button
            id="label-precedence-disclosure"
            type="button"
            aria-labelledby="labelled-disclosure-name"
            aria-label="Conflicting aria label"
            aria-expanded="false"
            aria-controls="label-precedence-region"
          >Visible disclosure text</button>
          <div id="label-precedence-region">Label precedence region</div>
          <div id="exact-tab-list" role="tablist">
            <button
              id="wrong-panel-tab"
              type="button"
              role="tab"
              aria-selected="false"
              aria-controls="actual-tab-panel"
            >Wrong panel tab</button>
            <button
              id="exact-tab"
              type="button"
              role="tab"
              aria-selected="false"
              aria-controls="exact-tab-panel"
            >Exact tab</button>
          </div>
          <div id="actual-tab-panel" role="tabpanel">Actual tab panel</div>
          <div id="claimed-tab-panel" role="tabpanel">Claimed tab panel</div>
          <div id="exact-tab-panel" role="tabpanel">Exact tab panel</div>
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

    const runId = 'focused-evidence-browser-check';
    const exactHeadingText = 'How does monday CRM help my business performance?';
    const trustPage = await browser.newPage({
      viewport: {
        width: 900,
        height: 400
      }
    });

    await trustPage.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Exact presentation target fixture</title>
          <style>
            body { margin: 0; min-height: 2400px; font: 16px system-ui; }
            .before { height: 620px; }
            .sticky-region { height: 1100px; }
            .sticky-list { position: sticky; top: 80px; padding: 20px; }
            .sticky-list h2 { margin: 0 0 32px; padding: 12px; }
            .display-hidden { display: none; }
            .opacity-hidden { opacity: 0; }
          </style>
        </head>
        <body>
          <div class="before"></div>
          <section class="sticky-region">
            <div class="sticky-list">
              <h2 id="neighbor-heading">How much does monday CRM cost?</h2>
              <h2 class="exact-heading">${exactHeadingText}</h2>
              <h2 class="exact-heading">${exactHeadingText}</h2>
              <h2 class="display-hidden">${exactHeadingText}</h2>
              <div class="opacity-hidden">
                <h2>${exactHeadingText}</h2>
              </div>
            </div>
          </section>
        </body>
      </html>
    `);

    const exactHeadingCapture = await captureFindingPresentationEvidence(
      trustPage,
      {
        runId,
        pageNumber: 2,
        candidateNumber: 1,
        target: {
          kind: 'visible-text',
          elementKind: 'heading',
          text: exactHeadingText
        }
      },
      {
        captureScreenshot: async (capturePage, filePath, clip) => {
          await capturePage.evaluate(() => window.scrollBy(0, 120));
          await capturePage.evaluate(
            () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
          );

          const renderedTargets = await capturePage.evaluate(targetText => {
            const browserUtilities = {
              normalize(value: string | null): string {
                return (value ?? '').replace(/\s+/g, ' ').trim();
              }
            };

            return [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
              .filter(
                element =>
                  browserUtilities.normalize(element.textContent) === targetText &&
                  element.getAttribute('data-checkquest-presentation-evidence-highlight') === 'true'
              )
              .map(element => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return {
                  text: browserUtilities.normalize(element.textContent),
                  y: rectangle.y,
                  outlineStyle: style.outlineStyle,
                  outlineWidth: style.outlineWidth,
                  outlineColor: style.outlineColor
                };
              });
          }, exactHeadingText);

          assert.equal(
            renderedTargets.length,
            2,
            'Only the two visible exact heading targets may be highlighted.'
          );
          assert.ok(
            renderedTargets.every(
              target =>
                target.text === exactHeadingText &&
                target.outlineStyle === 'solid' &&
                target.outlineWidth === '3px' &&
                target.outlineColor === 'rgb(225, 29, 72)'
            ),
            'Every rendered highlight must remain attached to an exact target after scrolling.'
          );
          assert.deepEqual(
            await capturePage.locator('[data-checkquest-presentation-evidence]').allTextContents(),
            ['CheckQuest evidence 1', 'CheckQuest evidence 2'],
            'Displayed evidence labels must be numbered by the targets actually shown.'
          );
          assert.equal(
            await capturePage
              .locator('#neighbor-heading[data-checkquest-presentation-evidence-highlight]')
              .count(),
            0,
            'The neighboring non-target heading must not be highlighted.'
          );
          assert.equal(
            await capturePage
              .locator(
                '.display-hidden[data-checkquest-presentation-evidence-highlight], .opacity-hidden h2[data-checkquest-presentation-evidence-highlight]'
              )
              .count(),
            0,
            'Hidden exact-text duplicates must not be represented as shown.'
          );

          await capturePage.screenshot({
            path: filePath,
            clip
          });
        }
      }
    );

    assert.equal(
      exactHeadingCapture.totalTargetCount,
      2,
      'Only visible exact heading targets contribute to the total.'
    );
    assert.equal(
      exactHeadingCapture.shownTargetCount,
      2,
      'Both visible exact heading targets were actually highlighted.'
    );
    assert.equal(
      exactHeadingCapture.screenshotPaths.length,
      1,
      'Nearby exact duplicates should share one focused image.'
    );
    assert.equal(
      await trustPage
        .locator(
          '[data-checkquest-presentation-evidence], [data-checkquest-presentation-evidence-target], [data-checkquest-presentation-evidence-highlight], [data-checkquest-presentation-evidence-style]'
        )
        .count(),
      0,
      'Exact-target markers and highlight styles must be removed after capture.'
    );

    const missingExactHeading = await captureFindingPresentationEvidence(trustPage, {
      runId,
      pageNumber: 2,
      candidateNumber: 2,
      target: {
        kind: 'visible-text',
        elementKind: 'heading',
        text: 'Heading that does not exist'
      }
    });

    assert.deepEqual(
      {
        totalTargetCount: missingExactHeading.totalTargetCount,
        shownTargetCount: missingExactHeading.shownTargetCount,
        screenshotCount: missingExactHeading.screenshotPaths.length
      },
      {
        totalTargetCount: 0,
        shownTargetCount: 0,
        screenshotCount: 0
      },
      'A missing exact target must not fall back to a neighboring heading.'
    );

    const similarHeading = await captureFindingPresentationEvidence(trustPage, {
      runId,
      pageNumber: 2,
      candidateNumber: 3,
      target: {
        kind: 'visible-text',
        elementKind: 'heading',
        text: 'How does monday CRM help my business?'
      }
    });

    assert.equal(
      similarHeading.totalTargetCount,
      0,
      'Similar-but-not-identical heading text must not match.'
    );
    assert.equal(similarHeading.shownTargetCount, 0);
    assert.equal(similarHeading.screenshotPaths.length, 0);

    await trustPage.close();

    const single = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 1,
      target: {
        kind: 'visible-text',
        elementKind: 'heading',
        text: 'Single exact target'
      }
    });

    assert.equal(single.totalTargetCount, 1);
    assert.equal(single.screenshotPaths.length, 1);

    const nearby = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 2,
      target: {
        kind: 'visible-text',
        elementKind: 'button',
        text: 'Repeated nearby target'
      }
    });

    assert.equal(nearby.totalTargetCount, 2);
    assert.equal(
      nearby.screenshotPaths.length,
      1,
      'Nearby targets should share one focused image.'
    );

    const separated = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 3,
      target: {
        kind: 'visible-text',
        elementKind: 'heading',
        text: 'Separated target'
      }
    });

    assert.equal(separated.totalTargetCount, 5);
    assert.equal(
      separated.screenshotPaths.length,
      3,
      'Separated targets should be capped at three images.'
    );
    assert.equal(separated.shownTargetCount, 3);

    for (const filePath of [
      ...single.screenshotPaths,
      ...nearby.screenshotPaths,
      ...separated.screenshotPaths
    ]) {
      await access(filePath);
    }

    assert.equal(
      await page.locator('[data-checkquest-presentation-evidence]').count(),
      0,
      'Annotations must be removed after successful capture.'
    );

    const selectTarget = {
      kind: 'select-option' as const,
      controlLabel: 'Country',
      controlName: 'country',
      controlId: 'country',
      optionText: 'Equador'
    };
    const withheldReplay = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 4,
      target: selectTarget
    });

    assert.equal(
      withheldReplay.screenshotPaths.length,
      0,
      'A transient select state is not replayed unless that exact action was already observed.'
    );

    const replayed = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 5,
      target: selectTarget,
      allowObservedStateReplay: true
    });

    assert.equal(replayed.replay?.action, 'select-option');
    assert.equal(
      replayed.screenshotPaths.length,
      1,
      'An eligible observed select replay produces one bounded evidence reference.'
    );
    assert.equal(replayed.totalTargetCount, 1);
    assert.equal(replayed.shownTargetCount, 1);
    await access(replayed.screenshotPaths[0]);
    assert.equal(
      replayed.replay?.restored,
      true,
      'An allowed benign replay records that its original state was restored.'
    );
    assert.equal(
      await page.locator('#country').inputValue(),
      'ecuador',
      'Evidence replay must restore the original local selection.'
    );

    await page.evaluate(() => {
      const select = document.getElementById('clone-country') as HTMLSelectElement | null;

      select?.addEventListener('change', () => {
        if (document.querySelector('[data-restoration-clone]') !== null) {
          return;
        }

        const clone = select.cloneNode(true) as HTMLSelectElement;

        clone.id = 'clone-country-copy';
        clone.setAttribute('data-restoration-clone', 'true');
        select.after(clone);
      });
    });
    const ambiguousRestoration = await captureFindingPresentationEvidence(
      page,
      {
        runId,
        pageNumber: 1,
        candidateNumber: 13,
        target: {
          kind: 'select-option',
          controlLabel: 'Clone Country',
          controlName: 'clone-country',
          controlId: 'clone-country',
          optionText: 'Changed option'
        },
        allowObservedStateReplay: true
      },
      {
        captureScreenshot: async () => undefined
      }
    );

    assert.equal(
      ambiguousRestoration.replay?.restored,
      false,
      'Restoration must fail closed when a change listener creates multiple exactly annotated selects.'
    );
    assert.equal(
      await page.locator('#clone-country').inputValue(),
      'changed',
      'Ambiguous restoration must not report success after restoring an arbitrary annotated select.'
    );
    assert.equal(
      await page.locator('select[data-restoration-clone]').count(),
      1,
      'The regression fixture must create a second annotated restoration candidate during replay.'
    );
    assert.equal(
      await page.locator('[data-checkquest-presentation-evidence-target]').count(),
      0,
      'Replay annotations must still be cleaned up after ambiguous restoration.'
    );

    const ambiguousSelect = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 6,
      target: {
        kind: 'select-option',
        controlLabel: null,
        controlName: 'shared-control',
        controlId: null,
        optionText: 'Shared option'
      },
      allowObservedStateReplay: true
    });

    assert.equal(
      ambiguousSelect.screenshotPaths.length,
      0,
      'Multiple visible controls sharing the supplied identity must not produce presentation evidence.'
    );

    const conflictingDisclosure = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 7,
      target: {
        kind: 'disclosure-state',
        controlId: 'disclosure-id-only',
        accessibleName: 'Conflicting disclosure name',
        controlledRegionId: 'disclosure-conflict-region',
        desiredState: 'expanded'
      }
    });

    assert.equal(
      conflictingDisclosure.screenshotPaths.length,
      0,
      'A control ID match and accessible-name match on different elements must fail closed.'
    );

    const conflictingAriaLabel = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 14,
      target: {
        kind: 'disclosure-state',
        controlId: 'label-precedence-disclosure',
        accessibleName: 'Conflicting aria label',
        controlledRegionId: 'label-precedence-region',
        desiredState: 'expanded'
      }
    });

    assert.equal(
      conflictingAriaLabel.screenshotPaths.length,
      0,
      'aria-label must not override a valid aria-labelledby accessible name.'
    );

    const labelledByDisclosure = await captureFindingPresentationEvidence(
      page,
      {
        runId,
        pageNumber: 1,
        candidateNumber: 15,
        target: {
          kind: 'disclosure-state',
          controlId: 'label-precedence-disclosure',
          accessibleName: 'Labelled disclosure name',
          controlledRegionId: 'label-precedence-region',
          desiredState: 'expanded'
        }
      },
      {
        captureScreenshot: async () => undefined
      }
    );

    assert.equal(
      labelledByDisclosure.screenshotPaths.length,
      1,
      'A valid aria-labelledby name must take precedence and remain capturable.'
    );

    const wrongDisclosureRegion = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 8,
      target: {
        kind: 'disclosure-state',
        controlId: 'wrong-region-disclosure',
        accessibleName: 'Wrong region disclosure',
        controlledRegionId: 'claimed-disclosure-region',
        desiredState: 'expanded'
      }
    });

    assert.equal(
      wrongDisclosureRegion.screenshotPaths.length,
      0,
      'A disclosure matching by name and ID but not its claimed region must not produce presentation evidence.'
    );

    const wrongTabPanel = await captureFindingPresentationEvidence(page, {
      runId,
      pageNumber: 1,
      candidateNumber: 9,
      target: {
        kind: 'tab-state',
        controlId: 'wrong-panel-tab',
        accessibleName: 'Wrong panel tab',
        tabListId: 'exact-tab-list',
        controlledPanelId: 'claimed-tab-panel',
        desiredState: 'selected'
      }
    });

    assert.equal(
      wrongTabPanel.screenshotPaths.length,
      0,
      'A tab matching by name and ID but not its claimed panel must not produce presentation evidence.'
    );

    const exactDisclosure = await captureFindingPresentationEvidence(
      page,
      {
        runId,
        pageNumber: 1,
        candidateNumber: 10,
        target: {
          kind: 'disclosure-state',
          controlId: 'exact-disclosure',
          accessibleName: 'Exact disclosure',
          controlledRegionId: 'exact-disclosure-region',
          desiredState: 'expanded'
        }
      },
      {
        captureScreenshot: async () => undefined
      }
    );

    assert.equal(
      exactDisclosure.screenshotPaths.length,
      1,
      'One unique disclosure matching every supplied field and component relationship remains capturable.'
    );

    const exactTab = await captureFindingPresentationEvidence(
      page,
      {
        runId,
        pageNumber: 1,
        candidateNumber: 11,
        target: {
          kind: 'tab-state',
          controlId: 'exact-tab',
          accessibleName: 'Exact tab',
          tabListId: 'exact-tab-list',
          controlledPanelId: 'exact-tab-panel',
          desiredState: 'selected'
        }
      },
      {
        captureScreenshot: async () => undefined
      }
    );

    assert.equal(
      exactTab.screenshotPaths.length,
      1,
      'One unique tab matching every supplied field and component relationship remains capturable.'
    );

    await page.evaluate(() => window.scrollTo(0, 240));
    const originalScrollY = await page.evaluate(() => window.scrollY);

    await assert.rejects(
      captureFindingPresentationEvidence(
        page,
        {
          runId,
          pageNumber: 1,
          candidateNumber: 12,
          target: {
            kind: 'visible-text',
            elementKind: 'button',
            text: 'Failure target'
          }
        },
        {
          captureScreenshot: async () => {
            throw new Error('Forced screenshot failure.');
          }
        }
      ),
      /Forced screenshot failure/
    );
    assert.equal(
      await page.locator('[data-checkquest-presentation-evidence]').count(),
      0,
      'Annotations must be removed after failed capture.'
    );
    assert.equal(
      await page.evaluate(() => window.scrollY),
      originalScrollY,
      'The original scroll position must be restored.'
    );

    console.log('Focused evidence browser check passed.');
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Focused evidence browser check failed:', error);
  process.exitCode = 1;
});
