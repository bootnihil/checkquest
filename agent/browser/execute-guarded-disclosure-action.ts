import type {
  Download,
  Page,
  Route
} from '@playwright/test';

import type {
  AgentAction
} from '../actions/agent-action-schema';

import {
  addUrlSafetyEvents,
  clickLikeDisabledContexts,
  clickLikeDisabledPages,
  collectAndRestoreBrowserGuard,
  disableClickLikeInteractions,
  installBrowserGuard,
  mutationMethods,
  preparedPages,
  quietPeriodTimeoutMs,
  readBrowserGuardEvents,
  waitForNetworkQuiet,
  type GuardedInteractionSafetyEvent
} from './guarded-interaction-safety-boundary';

export interface DisclosureStateSnapshot {
  expanded: boolean;
  controlledRegionVisible: boolean;
}

export interface DisclosureActionEvidence {
  before: DisclosureStateSnapshot;
  after: DisclosureStateSnapshot | null;
  rollback: DisclosureStateSnapshot | null;
  desiredState: 'expanded' | 'collapsed';
  stateTransitionObserved: boolean;
  controlledRegionChangedConsistently: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
}

export interface GuardedDisclosureActionResult {
  status: 'executed' | 'unsafe';
  detail: string;
  safetyEvents: GuardedInteractionSafetyEvent[];
  hardBreach: boolean;
  evidence: DisclosureActionEvidence | null;
}

const actionTimeoutMs = 2_000;
const stateSettleTimeoutMs = 1_000;

export async function executeGuardedDisclosureAction(
  page: Page,
  action: Extract<
    AgentAction,
    {
      kind: 'set-disclosure-state';
    }
  >
): Promise<GuardedDisclosureActionResult> {
  const context =
    page.context();

  if (
    clickLikeDisabledContexts.has(
      context
    )
  ) {
    return unsafeResult(
      'Click-like autonomous interaction is disabled for this run after a prior hard safety breach.',
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'hard-breach',
          detail:
            'A prior hard safety breach disabled click-like actions for this browser context.'
        }
      ]
    );
  }

  if (
    clickLikeDisabledPages.has(page) &&
    clickLikeDisabledPages.get(
      page
    ) === page.url()
  ) {
    return unsafeResult(
      'Click-like autonomous interaction is disabled for this page after a prior safety failure.',
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'A prior safety failure disabled click-like actions for this page.'
        }
      ]
    );
  }

  if (
    clickLikeDisabledPages.has(page)
  ) {
    clickLikeDisabledPages.delete(
      page
    );
  }

  const preparedState =
    preparedPages.get(page);

  if (preparedState === undefined) {
    return disablePageAndReturn(
      page,
      'The page was not prepared for realtime-channel containment before navigation.',
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'Realtime-channel tracking must be installed before page navigation.'
        }
      ]
    );
  }

  if (
    preparedState
      .realtimeChannelAttempted
  ) {
    return disablePageAndReturn(
      page,
      'The page attempted to open a realtime WebSocket channel, so click-like interaction is not allowed.',
      [
        {
          kind:
            'realtime-channel',
          severity:
            'hard-breach',
          detail:
            'A WebSocket handshake was attempted before the disclosure action.',
          url:
            preparedState
              .realtimeChannelUrl ??
            undefined
        }
      ],
      true
    );
  }

  if (
    context.serviceWorkers()
      .length > 0 ||
    await page.evaluate(
      () =>
        navigator.serviceWorker
          ?.controller !== null &&
        navigator.serviceWorker
          ?.controller !==
          undefined
    )
  ) {
    return disablePageAndReturn(
      page,
      'An active service worker prevents confident containment of click-like interaction.',
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'An active service worker was detected.'
        }
      ]
    );
  }

  if (
    !await waitForNetworkQuiet(
      preparedState
    )
  ) {
    return disablePageAndReturn(
      page,
      'The page did not reach the required bounded network-quiet state.',
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            `No network-quiet period was observed within ${quietPeriodTimeoutMs} ms.`
        }
      ]
    );
  }

  let preflight:
    DisclosurePreflight;

  try {
    preflight =
      await inspectDisclosureTarget(
        page,
        action
      );
  } catch (error) {
    return disablePageAndReturn(
      page,
      error instanceof Error
        ? error.message
        : String(error),
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            error instanceof Error
              ? error.message
              : String(error)
        }
      ]
    );
  }

  if (
    preflight.rejectionReasons
      .length > 0
  ) {
    const detail =
      `Disclosure target is not eligible: ${preflight.rejectionReasons.join('; ')}.`;

    return disablePageAndReturn(
      page,
      detail,
      [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail
        }
      ]
    );
  }

  const originalUrl =
    page.url();
  const originalOrigin =
    new URL(originalUrl).origin;
  const safetyEvents:
    GuardedInteractionSafetyEvent[] = [];
  const openedPages:
    Page[] = [];

  const routeHandler =
    async (
      route: Route
    ): Promise<void> => {
      const request =
        route.request();
      const method =
        request.method()
          .toUpperCase();
      const isMutation =
        mutationMethods.has(method);
      const isTopFrameNavigation =
        request.isNavigationRequest() &&
        request.frame() ===
          page.mainFrame();

      safetyEvents.push({
        kind:
          isTopFrameNavigation
            ? 'navigation'
            : isMutation
              ? 'mutation-request'
              : 'network-request',
        severity:
          isTopFrameNavigation ||
          isMutation
            ? 'hard-breach'
            : 'ordinary',
        detail:
          isTopFrameNavigation
            ? `Blocked top-frame navigation request: ${method} ${request.url()}`
            : isMutation
              ? `Blocked mutation-capable request: ${method} ${request.url()}`
              : `Blocked outbound request: ${method} ${request.url()}`,
        method,
        url:
          request.url()
      });

      await route.abort(
        'blockedbyclient'
      );
    };

  const popupHandler =
    async (
      popup: Page
    ): Promise<void> => {
      openedPages.push(popup);
      safetyEvents.push({
        kind: 'popup',
        severity: 'hard-breach',
        detail:
          'A popup or new page was opened during the guarded action.'
      });

      await popup.close()
        .catch(() => undefined);
    };

  const contextPageHandler =
    async (
      openedPage: Page
    ): Promise<void> => {
      if (
        openedPage === page ||
        openedPages.includes(
          openedPage
        )
      ) {
        return;
      }

      openedPages.push(openedPage);
      safetyEvents.push({
        kind: 'popup',
        severity: 'hard-breach',
        detail:
          'A new browser page was created during the guarded action.'
      });

      await openedPage.close()
        .catch(() => undefined);
    };

  const downloadHandler =
    async (
      download: Download
    ): Promise<void> => {
      safetyEvents.push({
        kind: 'download',
        severity: 'hard-breach',
        detail:
          `A download was attempted: ${download.suggestedFilename()}.`
      });

      await download.cancel()
        .catch(() => undefined);
    };

  const frameNavigationHandler =
    (
      frame: Page['mainFrame'] extends
        () => infer FrameType
        ? FrameType
        : never
    ): void => {
      if (
        frame === page.mainFrame() &&
        page.url() !== originalUrl
      ) {
        safetyEvents.push({
          kind: 'navigation',
          severity: 'hard-breach',
          detail:
            `The top frame navigated from "${originalUrl}" to "${page.url()}".`,
          url:
            page.url()
        });
      }
    };

  await page.route(
    '**/*',
    routeHandler
  );

  page.on(
    'popup',
    popupHandler
  );
  page.on(
    'download',
    downloadHandler
  );
  page.on(
    'framenavigated',
    frameNavigationHandler
  );
  context.on(
    'page',
    contextPageHandler
  );

  let after:
    DisclosureStateSnapshot | null =
      null;
  let rollback:
    DisclosureStateSnapshot | null =
      null;
  let rollbackAttempted =
    false;

  try {
    await installBrowserGuard(page);

    const control =
      page.locator(
        `[id="${escapeAttributeValue(
          action.target.controlId
        )}"]`
      );

    await control.click({
      timeout:
        actionTimeoutMs,
      noWaitAfter:
        true
    });

    await waitForDisclosureState(
      page,
      action,
      action.desiredState
    ).catch(
      () => undefined
    );

    await page.waitForTimeout(50);

    after =
      await captureDisclosureState(
        page,
        action
      );

    safetyEvents.push(
      ...await readBrowserGuardEvents(
        page
      )
    );

    addUrlSafetyEvents(
      page,
      originalUrl,
      originalOrigin,
      safetyEvents
    );

    if (
      safetyEvents.length === 0 &&
      (
        after.expanded !==
          preflight.snapshot.expanded ||
        after
          .controlledRegionVisible !==
          preflight.snapshot
            .controlledRegionVisible
      )
    ) {
      rollbackAttempted =
        true;

      await control.click({
        timeout:
          actionTimeoutMs,
        noWaitAfter:
          true
      });

      await waitForDisclosureBooleanState(
        page,
        action,
        preflight.snapshot
          .expanded
      ).catch(
        () => undefined
      );

      await page.waitForTimeout(50);

      rollback =
        await captureDisclosureState(
          page,
          action
        );

      safetyEvents.push(
        ...await readBrowserGuardEvents(
          page
        )
      );

      addUrlSafetyEvents(
        page,
        originalUrl,
        originalOrigin,
        safetyEvents
      );
    } else if (
      safetyEvents.length === 0
    ) {
      rollback =
        await captureDisclosureState(
          page,
          action
        );
    }
  } catch (error) {
    safetyEvents.push({
      kind:
        'unsafe-environment',
      severity:
        'ordinary',
      detail:
        `Guarded disclosure execution failed: ${error instanceof Error ? error.message : String(error)}`
    });
  } finally {
    await collectAndRestoreBrowserGuard(
      page,
      safetyEvents
    );

    page.off(
      'popup',
      popupHandler
    );
    page.off(
      'download',
      downloadHandler
    );
    page.off(
      'framenavigated',
      frameNavigationHandler
    );
    context.off(
      'page',
      contextPageHandler
    );

    await page.unroute(
      '**/*',
      routeHandler
    );
  }

  const hardBreach =
    safetyEvents.some(
      event =>
        event.severity ===
        'hard-breach'
    );

  const desiredExpanded =
    action.desiredState ===
    'expanded';

  const stateTransitionObserved =
    after !== null &&
    after.expanded ===
      desiredExpanded &&
    after.expanded !==
      preflight.snapshot.expanded;

  const controlledRegionChangedConsistently =
    after !== null &&
    after
      .controlledRegionVisible ===
      desiredExpanded &&
    after
      .controlledRegionVisible !==
      preflight.snapshot
        .controlledRegionVisible;

  const rollbackSucceeded =
    rollback !== null &&
    rollback.expanded ===
      preflight.snapshot.expanded &&
    rollback
      .controlledRegionVisible ===
      preflight.snapshot
        .controlledRegionVisible;

  const evidence:
    DisclosureActionEvidence = {
      before:
        preflight.snapshot,
      after,
      rollback,
      desiredState:
        action.desiredState,
      stateTransitionObserved,
      controlledRegionChangedConsistently,
      rollbackAttempted,
      rollbackSucceeded
    };

  if (
    safetyEvents.length > 0 ||
    !rollbackSucceeded
  ) {
    if (!rollbackSucceeded) {
      safetyEvents.push({
        kind:
          'unsafe-environment',
        severity:
          'ordinary',
        detail:
          'The disclosure control did not return to its original state.'
      });
    }

    disableClickLikeInteractions(
      page,
      hardBreach
    );

    return {
      status: 'unsafe',
      detail:
        safetyEvents
          .map(event => event.detail)
          .join(' '),
      safetyEvents,
      hardBreach,
      evidence
    };
  }

  return {
    status: 'executed',
    detail:
      `Set disclosure "${action.target.accessibleName}" to ${action.desiredState}, captured deterministic state evidence, and restored its original state.`,
    safetyEvents,
    hardBreach: false,
    evidence
  };
}

interface DisclosurePreflight {
  snapshot: DisclosureStateSnapshot;
  rejectionReasons: string[];
}

async function inspectDisclosureTarget(
  page: Page,
  action: Extract<
    AgentAction,
    {
      kind: 'set-disclosure-state';
    }
  >
): Promise<DisclosurePreflight> {
  const allElementsWithId =
    page.locator('[id]');

  const matchingIndexes =
    await allElementsWithId
      .evaluateAll(
        (
          elements,
          controlId
        ) =>
          elements
            .map(
              (
                element,
                index
              ) =>
                element.getAttribute(
                  'id'
                ) === controlId
                  ? index
                  : -1
            )
            .filter(
              index => index >= 0
            ),
        action.target.controlId
      );

  if (
    matchingIndexes.length !== 1
  ) {
    throw new Error(
      `Disclosure control id "${action.target.controlId}" matched ${matchingIndexes.length} elements; exactly one is required.`
    );
  }

  const control =
    allElementsWithId.nth(
      matchingIndexes[0]
    );

  const preflight =
    await control.evaluate(
    (
      element,
      target
    ) => {
      const rejectionReasons:
        string[] = [];

      const tagName =
        element.tagName.toLowerCase();
      const role =
        (
          element.getAttribute(
            'role'
          ) ??
          ''
        )
          .trim()
          .toLowerCase();
      const explicitType =
        (
          element.getAttribute(
            'type'
          ) ??
          ''
        )
          .trim()
          .toLowerCase();

      const ariaLabel =
        (
          element.getAttribute(
            'aria-label'
          ) ??
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
      const labelledByText =
        (
          element.getAttribute(
            'aria-labelledby'
          ) ??
          ''
        )
          .split(/\s+/)
          .filter(
            value =>
              value.length > 0
          )
          .map(
            id =>
              (
                document
                  .getElementById(id)
                  ?.textContent ??
                ''
              )
                .replace(
                  /\s+/g,
                  ' '
                )
                .trim()
          )
          .filter(
            value =>
              value.length > 0
          )
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      const visibleText =
        (
          (
            element as
              HTMLElement
          ).innerText ||
          element.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
      const inputValue =
        element instanceof
        HTMLInputElement
          ? element.value
              .replace(/\s+/g, ' ')
              .trim()
          : '';
      const accessibleName =
        ariaLabel ||
        labelledByText ||
        visibleText ||
        inputValue ||
        (
          element.getAttribute(
            'title'
          ) ??
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();

      if (
        accessibleName !==
        target.accessibleName
      ) {
        rejectionReasons.push(
          `accessible name is "${accessibleName}", not "${target.accessibleName}"`
        );
      }

      const rawExpanded =
        (
          element.getAttribute(
            'aria-expanded'
          ) ??
          ''
        )
          .trim()
          .toLowerCase();

      if (
        rawExpanded !== 'true' &&
        rawExpanded !== 'false'
      ) {
        rejectionReasons.push(
          'aria-expanded must be explicitly true or false'
        );
      }

      const rawControls =
        (
          element.getAttribute(
            'aria-controls'
          ) ??
          ''
        )
          .trim();
      const controlledIds =
        rawControls
          .split(/\s+/)
          .filter(
            value =>
              value.length > 0
          );

      if (
        controlledIds.length !== 1 ||
        controlledIds[0] !==
          target.controlledRegionId
      ) {
        rejectionReasons.push(
          `aria-controls does not exactly identify "${target.controlledRegionId}"`
        );
      }

      const region =
        controlledIds.length === 1
          ? document.getElementById(
              controlledIds[0]
            )
          : null;

      if (region === null) {
        rejectionReasons.push(
          'the controlled same-document region does not exist'
        );
      }

      const nativeDisabled =
        (
          element instanceof
            HTMLButtonElement ||
          element instanceof
            HTMLInputElement
        )
          ? element.disabled
          : false;
      const ariaDisabled =
        (
          element.getAttribute(
            'aria-disabled'
          ) ??
          ''
        )
          .trim()
          .toLowerCase() ===
        'true';

      if (
        nativeDisabled ||
        ariaDisabled
      ) {
        rejectionReasons.push(
          'the disclosure control is disabled'
        );
      }

      const closestLink =
        element.closest('a[href]');
      const hasLinkSemantics =
        tagName === 'a' ||
        role === 'link' ||
        element.hasAttribute(
          'href'
        ) ||
        closestLink !== null;

      if (hasLinkSemantics) {
        rejectionReasons.push(
          'link or href semantics are not permitted'
        );
      }

      if (
        element.hasAttribute(
          'aria-haspopup'
        )
      ) {
        rejectionReasons.push(
          'aria-haspopup disclosures are not permitted'
        );
      }

      const formAssociated =
        (
          element instanceof
            HTMLButtonElement ||
          element instanceof
            HTMLInputElement
        )
          ? element.form !== null
          : false;

      if (
        formAssociated ||
        element.closest('form') !==
          null
      ) {
        rejectionReasons.push(
          'form-associated disclosures are not permitted'
        );
      }

      const approvedControl =
        (
          element instanceof
            HTMLButtonElement &&
          explicitType === 'button'
        ) ||
        role === 'button';

      if (!approvedControl) {
        rejectionReasons.push(
          'only explicit type=button or role=button controls are permitted'
        );
      }

      if (
        element instanceof
          HTMLButtonElement &&
        explicitType !== 'button'
      ) {
        rejectionReasons.push(
          'submit, reset, and default-submit button semantics are not permitted'
        );
      }

      if (
        element instanceof
          HTMLInputElement &&
        element.type.toLowerCase() !==
          'button'
      ) {
        rejectionReasons.push(
          'only input type=button may act as a disclosure'
        );
      }

      if (
        region !== null &&
        region.querySelector(
          [
            'form',
            'input',
            'textarea',
            'select',
            'button[type="submit"]',
            'button[type="reset"]',
            'button:not([type])',
            '[contenteditable]:not([contenteditable="false"])'
          ].join(', ')
        ) !== null
      ) {
        rejectionReasons.push(
          'the controlled region contains editable or submission controls'
        );
      }

      const regionVisible =
        region !== null &&
        !region.hidden &&
        region.getAttribute(
          'aria-hidden'
        ) !== 'true' &&
        window.getComputedStyle(
          region
        ).display !== 'none' &&
        window.getComputedStyle(
          region
        ).visibility !==
          'hidden' &&
        region
          .getBoundingClientRect()
          .width > 0 &&
        region
          .getBoundingClientRect()
          .height > 0;

      return {
        rejectionReasons,
        snapshot: {
          expanded:
            rawExpanded === 'true',
          controlledRegionVisible:
            regionVisible
        }
      };
    },
    action.target
    );

  if (
    preflight.rejectionReasons
      .length > 0
  ) {
    return preflight;
  }

  const accessibleMatches =
    page.getByRole(
      'button',
      {
        name:
          action.target
            .accessibleName,
        exact: true
      }
    );
  const accessibleMatchCount =
    await accessibleMatches.count();

  if (
    accessibleMatchCount !== 1 ||
    await accessibleMatches
      .first()
      .getAttribute('id') !==
      action.target.controlId
  ) {
    throw new Error(
      `Disclosure accessible name "${action.target.accessibleName}" does not resolve uniquely to control id "${action.target.controlId}".`
    );
  }

  return preflight;
}

async function captureDisclosureState(
  page: Page,
  action: Extract<
    AgentAction,
    {
      kind: 'set-disclosure-state';
    }
  >
): Promise<DisclosureStateSnapshot> {
  const control =
    page.locator(
      `[id="${escapeAttributeValue(
        action.target.controlId
      )}"]`
    );

  if (
    await control.count() !== 1
  ) {
    throw new Error(
      'The disclosure control became missing or ambiguous while collecting evidence.'
    );
  }

  return control.evaluate(
    (
      element,
      controlledRegionId
    ) => {
      const region =
        document.getElementById(
          controlledRegionId
        );

      if (region === null) {
        throw new Error(
          'The controlled disclosure region disappeared while collecting evidence.'
        );
      }

      const style =
        window.getComputedStyle(
          region
        );
      const rectangle =
        region.getBoundingClientRect();

      return {
        expanded:
          element.getAttribute(
            'aria-expanded'
          ) === 'true',
        controlledRegionVisible:
          !region.hidden &&
          region.getAttribute(
            'aria-hidden'
          ) !== 'true' &&
          style.display !== 'none' &&
          style.visibility !==
            'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
      };
    },
    action.target
      .controlledRegionId
  );
}

async function waitForDisclosureState(
  page: Page,
  action: Extract<
    AgentAction,
    {
      kind: 'set-disclosure-state';
    }
  >,
  state:
    'expanded' | 'collapsed'
): Promise<void> {
  await waitForDisclosureBooleanState(
    page,
    action,
    state === 'expanded'
  );
}

async function waitForDisclosureBooleanState(
  page: Page,
  action: Extract<
    AgentAction,
    {
      kind: 'set-disclosure-state';
    }
  >,
  expanded: boolean
): Promise<void> {
  await page.waitForFunction(
    (
      input
    ) => {
      const control =
        document.getElementById(
          input.controlId
        );
      const region =
        document.getElementById(
          input.controlledRegionId
        );

      if (
        control === null ||
        region === null
      ) {
        return false;
      }

      const style =
        window.getComputedStyle(
          region
        );
      const rectangle =
        region.getBoundingClientRect();
      const regionVisible =
        !region.hidden &&
        region.getAttribute(
          'aria-hidden'
        ) !== 'true' &&
        style.display !== 'none' &&
        style.visibility !==
          'hidden' &&
        rectangle.width > 0 &&
        rectangle.height > 0;

      return (
        (
          control.getAttribute(
            'aria-expanded'
          ) === 'true'
        ) === input.expanded &&
        regionVisible ===
          input.expanded
      );
    },
    {
      controlId:
        action.target.controlId,
      controlledRegionId:
        action.target
          .controlledRegionId,
      expanded
    },
    {
      timeout:
        stateSettleTimeoutMs
    }
  );
}


function escapeAttributeValue(
  value: string
): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function disablePageAndReturn(
  page: Page,
  detail: string,
  safetyEvents:
    GuardedInteractionSafetyEvent[],
  hardBreach = false
): GuardedDisclosureActionResult {
  disableClickLikeInteractions(
    page,
    hardBreach
  );

  return unsafeResult(
    detail,
    safetyEvents
  );
}

function unsafeResult(
  detail: string,
  safetyEvents:
    GuardedInteractionSafetyEvent[]
): GuardedDisclosureActionResult {
  return {
    status: 'unsafe',
    detail,
    safetyEvents,
    hardBreach:
      safetyEvents.some(
        event =>
          event.severity ===
          'hard-breach'
      ),
    evidence: null
  };
}
