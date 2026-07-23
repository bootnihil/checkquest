import type {
  BrowserContext,
  Download,
  Page,
  Request,
  Route
} from '@playwright/test';

import type {
  AgentAction
} from '../actions/agent-action-schema';

export type DisclosureSafetyEventKind =
  | 'unsafe-environment'
  | 'network-request'
  | 'mutation-request'
  | 'form-submission'
  | 'navigation'
  | 'popup'
  | 'download'
  | 'origin-change'
  | 'url-change'
  | 'realtime-channel';

export interface DisclosureSafetyEvent {
  kind: DisclosureSafetyEventKind;
  severity: 'ordinary' | 'hard-breach';
  detail: string;
  method?: string;
  url?: string;
}

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
  safetyEvents: DisclosureSafetyEvent[];
  hardBreach: boolean;
  evidence: DisclosureActionEvidence | null;
}

interface PreparedPageState {
  realtimeChannelAttempted: boolean;
  realtimeChannelUrl: string | null;
  activeRequests: Set<Request>;
  lastNetworkActivityAt: number;
}

interface BrowserGuardEvent {
  kind:
    | 'form-submission'
    | 'network-request'
    | 'mutation-request'
    | 'popup'
    | 'navigation'
    | 'realtime-channel';
  method?: string;
  url?: string;
  detail: string;
}

interface BrowserGuardStore {
  events: BrowserGuardEvent[];
  restore: () => void;
}

type GuardedWindow = Window & {
  __checkQuestDisclosureGuard?: BrowserGuardStore;
};

const preparedPages =
  new WeakMap<Page, PreparedPageState>();

const clickLikeDisabledPages =
  new WeakMap<Page, string>();

const clickLikeDisabledContexts =
  new WeakSet<BrowserContext>();

const mutationMethods =
  new Set([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'CONNECT',
    'TRACE'
  ]);

const quietPeriodTimeoutMs = 1_500;
const requiredQuietPeriodMs = 250;
const actionTimeoutMs = 2_000;
const stateSettleTimeoutMs = 1_000;

/**
 * Must be called before the first navigation on pages that may perform
 * click-like autonomous interactions.
 *
 * New WebSocket handshakes are blocked for the lifetime of the page. If a
 * page attempts one, click-like interaction is disabled because an existing
 * realtime channel cannot be confidently isolated during a later action.
 */
export async function preparePageForGuardedInteractions(
  page: Page
): Promise<void> {
  if (preparedPages.has(page)) {
    return;
  }

  const state: PreparedPageState = {
    realtimeChannelAttempted: false,
    realtimeChannelUrl: null,
    activeRequests:
      new Set<Request>(),
    lastNetworkActivityAt:
      Date.now()
  };

  preparedPages.set(
    page,
    state
  );

  page.on(
    'request',
    request => {
      state.activeRequests.add(
        request
      );
      state.lastNetworkActivityAt =
        Date.now();
    }
  );

  const completeRequest =
    (
      request: Request
    ): void => {
      state.activeRequests.delete(
        request
      );
      state.lastNetworkActivityAt =
        Date.now();
    };

  page.on(
    'requestfinished',
    completeRequest
  );
  page.on(
    'requestfailed',
    completeRequest
  );

  page.on(
    'websocket',
    socket => {
      state.realtimeChannelAttempted =
        true;
      state.realtimeChannelUrl =
        socket.url();
    }
  );

  await page.routeWebSocket(
    /.*/,
    async route => {
      state.realtimeChannelAttempted =
        true;
      state.realtimeChannelUrl =
        route.url();

      await route.close({
        code: 1008,
        reason:
          'CheckQuest blocks realtime channels before guarded interactions.'
      });
    }
  );
}

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
    DisclosureSafetyEvent[] = [];
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

async function waitForNetworkQuiet(
  state: PreparedPageState
): Promise<boolean> {
  const deadline =
    Date.now() +
    quietPeriodTimeoutMs;

  while (
    Date.now() < deadline
  ) {
    if (
      state.activeRequests.size ===
        0 &&
      Date.now() -
        state.lastNetworkActivityAt >=
        requiredQuietPeriodMs
    ) {
      return true;
    }

    await new Promise<void>(
      resolve => {
        setTimeout(
          resolve,
          25
        );
      }
    );
  }

  return false;
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

async function installBrowserGuard(
  page: Page
): Promise<void> {
  await page.evaluate(`
    (() => {
      if (
        window.__checkQuestDisclosureGuard !==
        undefined
      ) {
        throw new Error(
          'A disclosure safety guard is already installed.'
        );
      }

      const events = [];
      const originalFetch = window.fetch;
      const originalXhrOpen =
        XMLHttpRequest.prototype.open;
      const originalXhrSend =
        XMLHttpRequest.prototype.send;
      const originalSendBeacon =
        navigator.sendBeacon;
      const originalFormSubmit =
        HTMLFormElement.prototype.submit;
      const originalFormRequestSubmit =
        HTMLFormElement.prototype.requestSubmit;
      const originalWindowOpen = window.open;
      const originalPushState =
        history.pushState;
      const originalReplaceState =
        history.replaceState;
      const originalWebSocketSend =
        WebSocket.prototype.send;
      const xhrMethods = new WeakMap();

      const recordRequest = (
        method,
        url
      ) => {
        const normalizedMethod =
          String(method).toUpperCase();
        const isMutation = [
          'POST',
          'PUT',
          'PATCH',
          'DELETE',
          'CONNECT',
          'TRACE'
        ].includes(normalizedMethod);

        events.push({
          kind:
            isMutation
              ? 'mutation-request'
              : 'network-request',
          method: normalizedMethod,
          url: String(url),
          detail:
            'Blocked ' +
            normalizedMethod +
            ' request to ' +
            String(url) +
            '.'
        });
      };

      window.fetch = async (
        input,
        init
      ) => {
        const request =
          input instanceof Request
            ? input
            : null;

        recordRequest(
          init?.method ??
            request?.method ??
            'GET',
          request?.url ??
            String(input)
        );

        throw new TypeError(
          'Blocked by CheckQuest disclosure safety guard.'
        );
      };

      XMLHttpRequest.prototype.open =
        function (
          method,
          url,
          ...rest
        ) {
          xhrMethods.set(
            this,
            {
              method:
                String(method),
              url:
                String(url)
            }
          );

          return Reflect.apply(
            originalXhrOpen,
            this,
            [
              method,
              url,
              ...rest
            ]
          );
        };

      XMLHttpRequest.prototype.send =
        function () {
          const request =
            xhrMethods.get(this) ?? {
              method: 'GET',
              url: ''
            };

          recordRequest(
            request.method,
            request.url
          );

          throw new DOMException(
            'Blocked by CheckQuest disclosure safety guard.',
            'NetworkError'
          );
        };

      navigator.sendBeacon = (
        url
      ) => {
        recordRequest(
          'POST',
          String(url)
        );
        return false;
      };

      const submitHandler = (
        event
      ) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        events.push({
          kind:
            'form-submission',
          detail:
            'Prevented a form submit event.'
        });
      };

      document.addEventListener(
        'submit',
        submitHandler,
        true
      );

      HTMLFormElement.prototype.submit =
        function () {
          events.push({
            kind:
              'form-submission',
            detail:
              'Prevented HTMLFormElement.submit().'
          });
        };

      HTMLFormElement.prototype.requestSubmit =
        function () {
          events.push({
            kind:
              'form-submission',
            detail:
              'Prevented HTMLFormElement.requestSubmit().'
          });
        };

      window.open = () => {
        events.push({
          kind: 'popup',
          detail:
            'Prevented window.open().'
        });
        return null;
      };

      history.pushState =
        function () {
          events.push({
            kind:
              'navigation',
            detail:
              'Prevented history.pushState().'
          });
        };

      history.replaceState =
        function () {
          events.push({
            kind:
              'navigation',
            detail:
              'Prevented history.replaceState().'
          });
        };

      WebSocket.prototype.send =
        function () {
          events.push({
            kind:
              'realtime-channel',
            detail:
              'Prevented WebSocket.send().'
          });

          throw new DOMException(
            'Blocked by CheckQuest disclosure safety guard.',
            'InvalidStateError'
          );
        };

      window.__checkQuestDisclosureGuard = {
        events,
        restore: () => {
          window.fetch =
            originalFetch;
          XMLHttpRequest.prototype.open =
            originalXhrOpen;
          XMLHttpRequest.prototype.send =
            originalXhrSend;
          navigator.sendBeacon =
            originalSendBeacon;
          HTMLFormElement.prototype.submit =
            originalFormSubmit;
          HTMLFormElement.prototype.requestSubmit =
            originalFormRequestSubmit;
          window.open =
            originalWindowOpen;
          history.pushState =
            originalPushState;
          history.replaceState =
            originalReplaceState;
          WebSocket.prototype.send =
            originalWebSocketSend;
          document.removeEventListener(
            'submit',
            submitHandler,
            true
          );
        }
      };
    })()
  `);
}

async function readBrowserGuardEvents(
  page: Page
): Promise<DisclosureSafetyEvent[]> {
  const events =
    await page.evaluate(() => {
      const store =
        (
          window as
            GuardedWindow
        )
          .__checkQuestDisclosureGuard;

      if (store === undefined) {
        return [];
      }

      return store.events.splice(
        0,
        store.events.length
      );
    });

  return events.map(
    browserGuardEventToSafetyEvent
  );
}

async function collectAndRestoreBrowserGuard(
  page: Page,
  safetyEvents:
    DisclosureSafetyEvent[]
): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  const events =
    await page.evaluate(() => {
      const guardedWindow =
        window as GuardedWindow;
      const store =
        guardedWindow
          .__checkQuestDisclosureGuard;

      if (store === undefined) {
        return [];
      }

      const remainingEvents =
        store.events.splice(
          0,
          store.events.length
        );

      store.restore();
      delete guardedWindow
        .__checkQuestDisclosureGuard;

      return remainingEvents;
    })
      .catch(
        () =>
          [] as BrowserGuardEvent[]
      );

  safetyEvents.push(
    ...events.map(
      browserGuardEventToSafetyEvent
    )
  );
}

function browserGuardEventToSafetyEvent(
  event: BrowserGuardEvent
): DisclosureSafetyEvent {
  const hardBreach =
    event.kind ===
      'form-submission' ||
    event.kind ===
      'mutation-request' ||
    event.kind ===
      'navigation' ||
    event.kind ===
      'popup' ||
    event.kind ===
      'realtime-channel';

  return {
    kind:
      event.kind,
    severity:
      hardBreach
        ? 'hard-breach'
        : 'ordinary',
    detail:
      event.detail,
    method:
      event.method,
    url:
      event.url
  };
}

function addUrlSafetyEvents(
  page: Page,
  originalUrl: string,
  originalOrigin: string,
  safetyEvents:
    DisclosureSafetyEvent[]
): void {
  const currentUrl =
    page.url();

  if (
    currentUrl === originalUrl
  ) {
    return;
  }

  let currentOrigin:
    string | null = null;

  try {
    currentOrigin =
      new URL(currentUrl).origin;
  } catch {
    // An unparsable URL is treated as a hard navigation breach below.
  }

  safetyEvents.push({
    kind:
      currentOrigin !==
      originalOrigin
        ? 'origin-change'
        : 'url-change',
    severity:
      'hard-breach',
    detail:
      `The page URL changed from "${originalUrl}" to "${currentUrl}".`,
    url:
      currentUrl
  });
}

function escapeAttributeValue(
  value: string
): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function disableClickLikeInteractions(
  page: Page,
  hardBreach: boolean
): void {
  clickLikeDisabledPages.set(
    page,
    page.url()
  );

  if (hardBreach) {
    clickLikeDisabledContexts.add(
      page.context()
    );
  }
}

function disablePageAndReturn(
  page: Page,
  detail: string,
  safetyEvents:
    DisclosureSafetyEvent[],
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
    DisclosureSafetyEvent[]
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
