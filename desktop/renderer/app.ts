import {
  desktopRunBudgetLimits,
  desktopRunDefaults,
  normalizeDesktopTargetUrl,
  validateDesktopStartRunInput,
  type DesktopRunFieldErrors,
  type DesktopRunFieldName,
  type DesktopStartRunInput
} from '../start-run-contract';
import type { CheckQuestDesktopApi } from '../ipc-contract';
import {
  createCancellingUiState,
  createStartRejectedUiState,
  getDesktopUiReadinessMessage,
  getDesktopRunButtonPresentation,
  initialDesktopUiState,
  reduceDesktopUiState,
  type DesktopUiState
} from '../ui-state';
import { submitDesktopRun } from './submit-run';
import { createElapsedStatusText } from './elapsed-time';
import { isDesktopRunLocallyEligible } from './form-eligibility';
import { reduceDesktopBudgetProgress, type DesktopBudgetProgress } from './budget-progress';
import { getDesktopCredentialPresentation } from './credential-presentation';
import {
  getBudgetStepperAvailability,
  stepBudgetValue,
  type BudgetStepperLimits
} from './budget-stepper';
import { calculateFloatingPosition } from './floating-position';

declare global {
  interface Window {
    checkQuestDesktop: CheckQuestDesktopApi;
  }
}

function requireElement<ElementType extends Element>(
  selector: string,
  constructor: {
    new (): ElementType;
  }
): ElementType {
  const element = document.querySelector(selector);

  if (!(element instanceof constructor)) {
    throw new Error(`Required desktop element is missing: ${selector}`);
  }

  return element;
}

const form = requireElement('#run-form', HTMLFormElement);
const targetInput = requireElement('#target-url', HTMLInputElement);
const pageBudgetInput = requireElement('#page-budget', HTMLInputElement);
const navigationBudgetInput = requireElement('#navigation-budget', HTMLInputElement);
const investigationBudgetInput = requireElement('#investigation-budget', HTMLInputElement);
const apiKeyInput = requireElement('#gemini-api-key', HTMLInputElement);
const apiKeyHelp = requireElement('#gemini-api-key-help', HTMLElement);
const apiKeySessionState = requireElement('#gemini-api-key-session-state', HTMLElement);
const apiKeyRequirement = requireElement('#gemini-requirement', HTMLElement);
const targetError = requireElement('#target-url-error', HTMLElement);
const pageBudgetError = requireElement('#page-budget-error', HTMLElement);
const navigationBudgetError = requireElement('#navigation-budget-error', HTMLElement);
const investigationBudgetError = requireElement('#investigation-budget-error', HTMLElement);
const apiKeyError = requireElement('#gemini-api-key-error', HTMLElement);
const resetDefaultsButton = requireElement('#reset-defaults', HTMLButtonElement);
const runButton = requireElement('#run-button', HTMLButtonElement);
const runButtonLabel = requireElement('#run-button-label', HTMLElement);
const runButtonSpinner = requireElement('.button-spinner', HTMLElement);
const cancelButton = requireElement('#cancel-button', HTMLButtonElement);
const statusPanel = requireElement('#run-status', HTMLElement);
const statusLabel = requireElement('#status-label', HTMLElement);
const statusDetail = requireElement('#status-detail', HTMLElement);
const statusElapsed = requireElement('#status-elapsed', HTMLElement);
const statusReadiness = requireElement('#status-readiness', HTMLElement);
const statusCounters = requireElement('#status-counters', HTMLElement);
const statusPages = requireElement('#status-pages', HTMLElement);
const statusNavigation = requireElement('#status-navigation', HTMLElement);
const pageBudgetRange = requireElement('#page-budget-range', HTMLElement);
const navigationBudgetRange = requireElement('#navigation-budget-range', HTMLElement);
const investigationBudgetRange = requireElement('#investigation-budget-range', HTMLElement);
const runEligibilityHint = requireElement('#run-eligibility-hint', HTMLElement);
const vocabularyButton = requireElement('#vocabulary-button', HTMLButtonElement);
const vocabularyPopover = requireElement('#vocabulary-popover', HTMLElement);

interface DestinationBinding {
  name: string;
  button: HTMLButtonElement;
  panel: HTMLElement;
}

const destinationBindings: readonly DestinationBinding[] = Array.from(
  document.querySelectorAll('[data-destination-button]')
).map(button => {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Desktop navigation button is invalid.');
  }

  const name = button.dataset.destinationButton;
  const panel = document.querySelector(`[data-destination-panel="${name ?? ''}"]`);

  if (name === undefined || !(panel instanceof HTMLElement)) {
    throw new Error('Desktop navigation binding is incomplete.');
  }

  return {
    name,
    button,
    panel
  };
});

interface BudgetStepperBinding {
  input: HTMLInputElement;
  decrement: HTMLButtonElement;
  increment: HTMLButtonElement;
  limits: BudgetStepperLimits;
}

const budgetStepperBindings: readonly BudgetStepperBinding[] = [
  {
    input: pageBudgetInput,
    decrement: requireElement('#page-budget-decrement', HTMLButtonElement),
    increment: requireElement('#page-budget-increment', HTMLButtonElement),
    limits: desktopRunBudgetLimits.pages
  },
  {
    input: navigationBudgetInput,
    decrement: requireElement('#navigation-budget-decrement', HTMLButtonElement),
    increment: requireElement('#navigation-budget-increment', HTMLButtonElement),
    limits: desktopRunBudgetLimits.navigationSteps
  },
  {
    input: investigationBudgetInput,
    decrement: requireElement('#investigation-budget-decrement', HTMLButtonElement),
    increment: requireElement('#investigation-budget-increment', HTMLButtonElement),
    limits: desktopRunBudgetLimits.investigationStepsPerPage
  }
];
const formFields = [
  targetInput,
  pageBudgetInput,
  navigationBudgetInput,
  investigationBudgetInput,
  apiKeyInput
] as const;
const fieldBindings: ReadonlyArray<{
  name: DesktopRunFieldName;
  input: HTMLInputElement;
  error: HTMLElement;
}> = [
  {
    name: 'targetUrl',
    input: targetInput,
    error: targetError
  },
  {
    name: 'pageBudget',
    input: pageBudgetInput,
    error: pageBudgetError
  },
  {
    name: 'navigationBudget',
    input: navigationBudgetInput,
    error: navigationBudgetError
  },
  {
    name: 'investigationStepsPerPage',
    input: investigationBudgetInput,
    error: investigationBudgetError
  },
  {
    name: 'geminiApiKey',
    input: apiKeyInput,
    error: apiKeyError
  }
];

let uiState: DesktopUiState = {
  ...initialDesktopUiState
};
let fieldErrors: DesktopRunFieldErrors = {};
let sessionCredentialAvailable = false;
let runStartedAt: number | undefined;
let cancellationStartedAt: number | undefined;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
let budgetProgress: DesktopBudgetProgress | null = null;

function positionFloatingElement(
  anchor: HTMLElement,
  overlay: HTMLElement,
  horizontal: 'center' | 'end'
): void {
  const position = calculateFloatingPosition(
    anchor.getBoundingClientRect(),
    overlay.getBoundingClientRect(),
    {
      width: globalThis.innerWidth,
      height: globalThis.innerHeight
    },
    {
      horizontal
    }
  );
  const rootBounds = document.documentElement.getBoundingClientRect();

  overlay.style.left = `${position.left - rootBounds.left}px`;
  overlay.style.top = `${position.top - rootBounds.top}px`;
  overlay.style.setProperty('--arrow-left', `${position.arrowLeft}px`);
  overlay.dataset.placement = position.placement;
}

function closeVocabulary(restoreFocus = false): void {
  if (vocabularyPopover.hidden) {
    return;
  }

  vocabularyPopover.hidden = true;
  vocabularyButton.setAttribute('aria-expanded', 'false');

  if (restoreFocus) {
    vocabularyButton.focus();
  }
}

function openVocabulary(): void {
  vocabularyPopover.hidden = false;
  vocabularyButton.setAttribute('aria-expanded', 'true');
  positionFloatingElement(vocabularyButton, vocabularyPopover, 'end');
  vocabularyPopover.focus({
    preventScroll: true
  });
}

function repositionOpenFloatingElements(): void {
  if (!vocabularyPopover.hidden) {
    positionFloatingElement(vocabularyButton, vocabularyPopover, 'end');
  }
}

function showDestination(name: string): void {
  closeVocabulary();

  for (const binding of destinationBindings) {
    const active = binding.name === name;

    binding.panel.hidden = !active;

    if (active) {
      binding.button.setAttribute('aria-current', 'page');
    } else {
      binding.button.removeAttribute('aria-current');
    }
  }
}

function renderBudgetProgress(): void {
  const visible = uiState.runActive && budgetProgress !== null;

  statusCounters.hidden = !visible;

  if (budgetProgress === null) {
    return;
  }

  statusPages.textContent = `${budgetProgress.pageNumber} of ${budgetProgress.pageBudget}`;
  statusNavigation.textContent = `${budgetProgress.navigationUsed} of ${budgetProgress.navigationBudget}`;
}

function renderElapsedStatus(): void {
  const text = createElapsedStatusText(
    uiState.phase,
    runStartedAt,
    cancellationStartedAt,
    Date.now()
  );

  statusElapsed.textContent = text ?? '';
  statusElapsed.hidden = text === null;
}

function renderStatusDetail(): void {
  const visible = uiState.phase === 'completed';

  statusDetail.textContent = uiState.detail;
  statusDetail.title = uiState.detail;
  statusDetail.hidden = !visible;
  statusPanel.title = uiState.phase === 'failed' ? uiState.detail : '';
}

function synchronizeElapsedTimer(): void {
  if (uiState.runActive) {
    if (elapsedTimer === undefined) {
      elapsedTimer = setInterval(renderElapsedStatus, 1_000);
    }
  } else if (elapsedTimer !== undefined) {
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }

  renderElapsedStatus();
}

function renderCredentialStatus(): void {
  const presentation = getDesktopCredentialPresentation(sessionCredentialAvailable);

  apiKeyInput.required = presentation.inputRequired;
  apiKeyHelp.textContent = presentation.helpText;
  apiKeyInput.placeholder = presentation.placeholderText;
  apiKeyInput.classList.toggle('session-credential-ready', presentation.available);
  apiKeySessionState.textContent = presentation.accessibleStateText;
  apiKeyRequirement.hidden = !presentation.requirementVisible;
}

function renderBudgetSteppers(): void {
  for (const binding of budgetStepperBindings) {
    const availability = getBudgetStepperAvailability(
      binding.input.value,
      binding.limits,
      uiState.runActive
    );

    binding.decrement.disabled = availability.decrementDisabled;
    binding.increment.disabled = availability.incrementDisabled;
  }
}

async function refreshCredentialStatus(): Promise<void> {
  const status = await window.checkQuestDesktop.getSessionCredentialStatus();

  sessionCredentialAvailable = status.available;
  renderCredentialStatus();
  renderUiState();
}

function renderUiState(): void {
  const runButtonPresentation = getDesktopRunButtonPresentation(uiState);

  form.dataset.locked = String(uiState.runActive);
  form.setAttribute('aria-busy', String(uiState.runActive));
  statusPanel.dataset.phase = uiState.phase;
  statusLabel.textContent = uiState.label;
  renderStatusDetail();
  const readinessMessage = getDesktopUiReadinessMessage(uiState);
  statusReadiness.textContent = readinessMessage ?? '';
  statusReadiness.hidden = readinessMessage === null;
  runButton.disabled =
    uiState.runActive ||
    !isDesktopRunLocallyEligible(createRunRequest(), sessionCredentialAvailable);
  const locallyEligible = !runButton.disabled && !uiState.runActive;
  runEligibilityHint.textContent = uiState.runActive
    ? 'Configuration is locked for the active run.'
    : locallyEligible
      ? ''
      : 'Complete the required fields to run CheckQuest.';
  runButton.dataset.state = uiState.phase;
  runButtonLabel.textContent = runButtonPresentation.label;
  runButtonSpinner.hidden = !runButtonPresentation.busy;
  cancelButton.disabled = !uiState.runActive || uiState.phase === 'cancelling';
  resetDefaultsButton.disabled = uiState.runActive;

  for (const field of formFields) {
    field.disabled = uiState.runActive;
  }

  renderBudgetSteppers();
  synchronizeElapsedTimer();
  renderBudgetProgress();
}

function setUiState(state: DesktopUiState): void {
  const previousState = uiState;

  if (!previousState.runActive && state.runActive) {
    runStartedAt = Date.now();
    cancellationStartedAt = undefined;
  }

  if (previousState.phase !== 'cancelling' && state.phase === 'cancelling') {
    cancellationStartedAt = Date.now();
  }

  uiState = state;
  renderUiState();
}

function renderFieldErrors(errors: DesktopRunFieldErrors): void {
  fieldErrors = {
    ...errors
  };

  for (const binding of fieldBindings) {
    const message = fieldErrors[binding.name];

    binding.error.textContent = message ?? '';
    binding.error.hidden = message === undefined;

    if (message === undefined) {
      binding.input.removeAttribute('aria-invalid');
    } else {
      binding.input.setAttribute('aria-invalid', 'true');
    }
  }
}

function focusFirstInvalidField(): void {
  const binding = fieldBindings.find(candidate => fieldErrors[candidate.name] !== undefined);

  binding?.input.focus();
}

function createRunRequest(): DesktopStartRunInput {
  return {
    targetUrl: normalizeDesktopTargetUrl(targetInput.value),
    pageBudget: Number(pageBudgetInput.value),
    navigationBudget: Number(navigationBudgetInput.value),
    investigationStepsPerPage: Number(investigationBudgetInput.value),
    geminiApiKey: apiKeyInput.value
  };
}

vocabularyButton.addEventListener('click', () => {
  if (vocabularyPopover.hidden) {
    openVocabulary();
  } else {
    closeVocabulary(true);
  }
});

for (const binding of destinationBindings) {
  binding.button.addEventListener('click', () => {
    showDestination(binding.name);
  });
}

document.addEventListener('pointerdown', event => {
  if (
    event.target instanceof Node &&
    !vocabularyPopover.contains(event.target) &&
    !vocabularyButton.contains(event.target)
  ) {
    closeVocabulary();
  }
});

document.addEventListener('focusin', event => {
  if (
    vocabularyPopover.hidden ||
    !(event.target instanceof Node) ||
    vocabularyPopover.contains(event.target) ||
    vocabularyButton.contains(event.target)
  ) {
    return;
  }

  closeVocabulary();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') {
    return;
  }

  if (!vocabularyPopover.hidden) {
    event.preventDefault();
    closeVocabulary(true);
  }
});

globalThis.addEventListener('resize', repositionOpenFloatingElements);
globalThis.addEventListener('scroll', repositionOpenFloatingElements, true);

for (const binding of fieldBindings) {
  binding.input.addEventListener('input', () => {
    renderUiState();

    if (fieldErrors[binding.name] === undefined) {
      return;
    }

    const validation = validateDesktopStartRunInput(createRunRequest(), {
      sessionCredentialAvailable
    });

    if (validation.success || validation.fieldErrors[binding.name] === undefined) {
      renderFieldErrors({
        ...fieldErrors,
        [binding.name]: undefined
      });
    }
  });
}

for (const binding of budgetStepperBindings) {
  for (const [button, direction] of [
    [binding.decrement, -1],
    [binding.increment, 1]
  ] as const) {
    button.addEventListener('click', () => {
      if (uiState.runActive) {
        return;
      }

      binding.input.value = String(stepBudgetValue(binding.input.value, direction, binding.limits));
      binding.input.dispatchEvent(
        new Event('input', {
          bubbles: true
        })
      );
    });
  }
}

resetDefaultsButton.addEventListener('click', () => {
  pageBudgetInput.value = String(desktopRunDefaults.pageBudget);
  navigationBudgetInput.value = String(desktopRunDefaults.navigationBudget);
  investigationBudgetInput.value = String(desktopRunDefaults.investigationStepsPerPage);
  renderFieldErrors({
    ...fieldErrors,
    pageBudget: undefined,
    navigationBudget: undefined,
    investigationStepsPerPage: undefined
  });
  renderUiState();
});

form.addEventListener('submit', event => {
  event.preventDefault();

  if (uiState.runActive) {
    return;
  }

  const request = createRunRequest();
  targetInput.value = request.targetUrl;
  budgetProgress = null;

  void submitDesktopRun({
    request,
    startRun: input => window.checkQuestDesktop.startRun(input),
    onPreflightStarted: state => {
      renderFieldErrors({});
      setUiState(state);
    },
    sessionCredentialAvailable
  }).then(result => {
    switch (result.outcome) {
      case 'started':
        renderFieldErrors({});
        apiKeyInput.value = '';
        void refreshCredentialStatus();
        return;

      case 'field-errors':
        if (result.fieldErrors.geminiApiKey !== undefined && apiKeyInput.value.trim().length > 0) {
          apiKeyInput.value = '';
        }
        setUiState(result.state);
        renderFieldErrors(result.fieldErrors);
        focusFirstInvalidField();
        void refreshCredentialStatus().then(() => {
          if (sessionCredentialAvailable) {
            apiKeyInput.value = '';
            renderUiState();
          }
        });
        return;

      case 'cancelled':
      case 'failed':
        apiKeyInput.value = '';
        setUiState(result.state);
        void refreshCredentialStatus();
    }
  });
});

cancelButton.addEventListener('click', () => {
  if (!uiState.runActive) {
    return;
  }

  setUiState(createCancellingUiState(uiState));

  void window.checkQuestDesktop.cancelRun().then(reply => {
    if (!reply.requested && uiState.runActive) {
      setUiState(createStartRejectedUiState('No active CheckQuest run could be cancelled.'));
    }
  });
});

const unsubscribe = window.checkQuestDesktop.onRunEvent(event => {
  budgetProgress = reduceDesktopBudgetProgress(budgetProgress, event);
  setUiState(reduceDesktopUiState(uiState, event));
});

window.addEventListener(
  'unload',
  () => {
    unsubscribe();

    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
    }
  },
  {
    once: true
  }
);

renderUiState();
renderFieldErrors({});
renderCredentialStatus();
pageBudgetInput.min = String(desktopRunBudgetLimits.pages.minimum);
pageBudgetInput.max = String(desktopRunBudgetLimits.pages.maximum);
navigationBudgetInput.min = String(desktopRunBudgetLimits.navigationSteps.minimum);
navigationBudgetInput.max = String(desktopRunBudgetLimits.navigationSteps.maximum);
investigationBudgetInput.min = String(desktopRunBudgetLimits.investigationStepsPerPage.minimum);
investigationBudgetInput.max = String(desktopRunBudgetLimits.investigationStepsPerPage.maximum);
pageBudgetRange.textContent = `${desktopRunBudgetLimits.pages.minimum}–${desktopRunBudgetLimits.pages.maximum}`;
navigationBudgetRange.textContent = `${desktopRunBudgetLimits.navigationSteps.minimum}–${desktopRunBudgetLimits.navigationSteps.maximum}`;
investigationBudgetRange.textContent = `${desktopRunBudgetLimits.investigationStepsPerPage.minimum}–${desktopRunBudgetLimits.investigationStepsPerPage.maximum}`;
resetDefaultsButton.click();
void refreshCredentialStatus();
