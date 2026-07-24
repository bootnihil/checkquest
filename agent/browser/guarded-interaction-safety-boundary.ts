import type {
  BrowserContext,
  Download,
  Page,
  Request,
  Route
} from '@playwright/test';

export type GuardedInteractionSafetyEventKind =
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

export interface GuardedInteractionSafetyEvent {
  kind: GuardedInteractionSafetyEventKind;
  severity: 'ordinary' | 'hard-breach';
  detail: string;
  method?: string;
  url?: string;
}

export interface GuardedInteractionBoundaryContext {
  safetyEvents: GuardedInteractionSafetyEvent[];
  collectBrowserSafetyEvents: () => Promise<void>;
  originalUrl: string;
  originalOrigin: string;
}

export interface GuardedInteractionBoundaryResult<T> {
  status: 'completed' | 'unsafe';
  detail: string;
  safetyEvents: GuardedInteractionSafetyEvent[];
  hardBreach: boolean;
  value: T | null;
}

export interface PreparedPageState {
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

export const preparedPages =
  new WeakMap<Page, PreparedPageState>();

export const clickLikeDisabledPages =
  new WeakMap<Page, string>();

export const clickLikeDisabledContexts =
  new WeakSet<BrowserContext>();

export const mutationMethods =
  new Set([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'CONNECT',
    'TRACE'
  ]);

export const quietPeriodTimeoutMs = 1_500;
const requiredQuietPeriodMs = 250;

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

/**
 * Shared containment boundary for exact, separately validated state-control
 * interactions. This is intentionally not an agent action and accepts no
 * planner-provided selectors, JavaScript, or arbitrary targets.
 */
export async function runGuardedInteractionSafetyBoundary<T>(
  page: Page,
  interactionName: string,
  operation: (
    context:
      GuardedInteractionBoundaryContext
  ) => Promise<T>
): Promise<
  GuardedInteractionBoundaryResult<T>
> {
  const context =
    page.context();

  if (
    clickLikeDisabledContexts.has(
      context
    )
  ) {
    return {
      status: 'unsafe',
      detail:
        'Click-like autonomous interaction is disabled for this run after a prior hard safety breach.',
      safetyEvents: [
        {
          kind:
            'unsafe-environment',
          severity:
            'hard-breach',
          detail:
            'A prior hard safety breach disabled click-like actions for this browser context.'
        }
      ],
      hardBreach: true,
      value: null
    };
  }

  if (
    clickLikeDisabledPages.has(page) &&
    clickLikeDisabledPages.get(
      page
    ) === page.url()
  ) {
    return {
      status: 'unsafe',
      detail:
        'Click-like autonomous interaction is disabled for this page after a prior safety failure.',
      safetyEvents: [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'A prior safety failure disabled click-like actions for this page.'
        }
      ],
      hardBreach: false,
      value: null
    };
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
    disableClickLikeInteractions(
      page,
      false
    );

    return {
      status: 'unsafe',
      detail:
        'The page was not prepared for realtime-channel containment before navigation.',
      safetyEvents: [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'Realtime-channel tracking must be installed before page navigation.'
        }
      ],
      hardBreach: false,
      value: null
    };
  }

  if (
    preparedState
      .realtimeChannelAttempted
  ) {
    disableClickLikeInteractions(
      page,
      true
    );

    return {
      status: 'unsafe',
      detail:
        'The page attempted to open a realtime WebSocket channel, so click-like interaction is not allowed.',
      safetyEvents: [
        {
          kind:
            'realtime-channel',
          severity:
            'hard-breach',
          detail:
            `A WebSocket handshake was attempted before the ${interactionName}.`,
          url:
            preparedState
              .realtimeChannelUrl ??
            undefined
        }
      ],
      hardBreach: true,
      value: null
    };
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
    disableClickLikeInteractions(
      page,
      false
    );

    return {
      status: 'unsafe',
      detail:
        'An active service worker prevents confident containment of click-like interaction.',
      safetyEvents: [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            'An active service worker was detected.'
        }
      ],
      hardBreach: false,
      value: null
    };
  }

  if (
    !await waitForNetworkQuiet(
      preparedState
    )
  ) {
    disableClickLikeInteractions(
      page,
      false
    );

    return {
      status: 'unsafe',
      detail:
        'The page did not reach the required bounded network-quiet state.',
      safetyEvents: [
        {
          kind:
            'unsafe-environment',
          severity:
            'ordinary',
          detail:
            `No network-quiet period was observed within ${quietPeriodTimeoutMs} ms.`
        }
      ],
      hardBreach: false,
      value: null
    };
  }

  const originalUrl =
    page.url();
  const originalOrigin =
    new URL(originalUrl).origin;
  const safetyEvents:
    GuardedInteractionSafetyEvent[] = [];
  const openedPages:
    Page[] = [];
  let value: T | null =
    null;

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

      openedPages.push(
        openedPage
      );
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
  const collectBrowserSafetyEvents =
    async (): Promise<void> => {
      /*
       * Browser protocol events for a newly constructed WebSocket can
       * arrive just after the DOM click handler returns. Give the already
       * armed route a short bounded turn before deciding rollback is safe.
       */
      await page.waitForTimeout(
        100
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
        preparedState
          .realtimeChannelAttempted &&
        !safetyEvents.some(
          event =>
            event.kind ===
            'realtime-channel'
        )
      ) {
        safetyEvents.push({
          kind:
            'realtime-channel',
          severity:
            'hard-breach',
          detail:
            `A WebSocket handshake was attempted during the ${interactionName}.`,
          url:
            preparedState
              .realtimeChannelUrl ??
            undefined
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

  try {
    await installBrowserGuard(page);
    value =
      await operation({
        safetyEvents,
        collectBrowserSafetyEvents,
        originalUrl,
        originalOrigin
      });
    await collectBrowserSafetyEvents();
  } catch (error) {
    safetyEvents.push({
      kind:
        'unsafe-environment',
      severity:
        'ordinary',
      detail:
        `Guarded ${interactionName} execution failed: ${error instanceof Error ? error.message : String(error)}`
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

  addUrlSafetyEvents(
    page,
    originalUrl,
    originalOrigin,
    safetyEvents
  );

  const hardBreach =
    safetyEvents.some(
      event =>
        event.severity ===
        'hard-breach'
    );

  if (
    safetyEvents.length > 0
  ) {
    disableClickLikeInteractions(
      page,
      hardBreach
    );
  }

  return {
    status:
      safetyEvents.length > 0
        ? 'unsafe'
        : 'completed',
    detail:
      safetyEvents.length > 0
        ? safetyEvents
            .map(
              event =>
                event.detail
            )
            .join(' ')
        : `Guarded ${interactionName} safety boundary completed without events.`,
    safetyEvents,
    hardBreach,
    value
  };
}

export async function waitForNetworkQuiet(
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

export async function installBrowserGuard(
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

export async function readBrowserGuardEvents(
  page: Page
): Promise<GuardedInteractionSafetyEvent[]> {
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

export async function collectAndRestoreBrowserGuard(
  page: Page,
  safetyEvents:
    GuardedInteractionSafetyEvent[]
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
): GuardedInteractionSafetyEvent {
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

export function addUrlSafetyEvents(
  page: Page,
  originalUrl: string,
  originalOrigin: string,
  safetyEvents:
    GuardedInteractionSafetyEvent[]
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

export function disableClickLikeInteractions(
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
