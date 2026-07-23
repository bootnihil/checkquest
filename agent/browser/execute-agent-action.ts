import type { Locator, Page } from '@playwright/test';

import type {
  AgentAction,
  FormControlTarget
} from '../actions/agent-action-schema';
import {
  executeGuardedDisclosureAction,
  type DisclosureActionEvidence,
  type DisclosureSafetyEvent
} from './execute-guarded-disclosure-action';
import {
  executeGuardedTabAction,
  type TabActionEvidence
} from './execute-guarded-tab-action';

export interface ExecutedAgentActionResult {
  kind: AgentAction['kind'];
  status: 'executed' | 'stopped' | 'unsafe';
  detail: string;
  safetyEvents?: DisclosureSafetyEvent[];
  hardBreach?: boolean;
  disclosureEvidence?:
    DisclosureActionEvidence | null;
  tabEvidence?:
    TabActionEvidence | null;
}

/**
 * Resolves a form-control target without accepting arbitrary CSS selectors
 * from the AI.
 *
 * Resolution order:
 * 1. Exact id
 * 2. Exact name
 * 3. Exact accessible label
 * 4. Exact placeholder
 *
 * Ambiguous matches are rejected rather than guessed.
 */
async function resolveFormControl(
  page: Page,
  target: FormControlTarget
): Promise<Locator> {
  if (target.id !== null) {
    const match = await findUniqueControlByAttribute(page, 'id', target.id);

    if (match !== null) {
      await assertFormControlIdentityConsistency(
        match,
        target
      );
      return match;
    }
  }

  if (target.name !== null) {
    const match = await findUniqueControlByAttribute(page, 'name', target.name);

    if (match !== null) {
      await assertFormControlIdentityConsistency(
        match,
        target
      );
      return match;
    }
  }

  if (target.label !== null) {
    const match = await findUniqueLocator(
      page.getByLabel(target.label, { exact: true }),
      `label "${target.label}"`
    );

    if (match !== null) {
      await assertSupportedFormControl(match);
      await assertFormControlIdentityConsistency(
        match,
        target
      );
      return match;
    }
  }

  if (target.placeholder !== null) {
    const match = await findUniqueLocator(
      page.getByPlaceholder(target.placeholder, { exact: true }),
      `placeholder "${target.placeholder}"`
    );

    if (match !== null) {
      await assertSupportedFormControl(match);
      await assertFormControlIdentityConsistency(
        match,
        target
      );
      return match;
    }
  }

  throw new Error(
    `Unable to locate form control. Target: ${JSON.stringify(target)}`
  );
}

async function assertFormControlIdentityConsistency(
  locator: Locator,
  target: FormControlTarget
): Promise<void> {
  const observed =
    await locator.evaluate(
      element => {
        let label:
          string | null = null;

        if (
          (
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLTextAreaElement ||
            element instanceof
              HTMLSelectElement
          ) &&
          element.labels !== null &&
          element.labels.length > 0
        ) {
          const labelText =
            Array.from(
              element.labels
            )
              .map(
                labelElement =>
                  (
                    labelElement.innerText ||
                    labelElement.textContent ||
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

          if (
            labelText.length > 0
          ) {
            label =
              labelText;
          }
        }

        if (label === null) {
          const ariaLabel =
            (
              element.getAttribute(
                'aria-label'
              ) ??
              ''
            )
              .replace(/\s+/g, ' ')
              .trim();

          if (
            ariaLabel.length > 0
          ) {
            label =
              ariaLabel;
          }
        }

        const rawName =
          (
            element.getAttribute(
              'name'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const rawId =
          (
            element.getAttribute(
              'id'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const rawPlaceholder =
          (
            element.getAttribute(
              'placeholder'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        return {
          label,
          name:
            rawName.length > 0
              ? rawName
              : null,
          id:
            rawId.length > 0
              ? rawId
              : null,
          placeholder:
            rawPlaceholder.length >
            0
              ? rawPlaceholder
              : null
        };
      }
    );

  const mismatch =
    [
      {
        field: 'label',
        expected:
          target.label,
        actual:
          observed.label
      },
      {
        field: 'name',
        expected:
          target.name,
        actual:
          observed.name
      },
      {
        field: 'id',
        expected:
          target.id,
        actual:
          observed.id
      },
      {
        field:
          'placeholder',
        expected:
          target.placeholder,
        actual:
          observed.placeholder
      }
    ]
      .filter(
        item =>
          item.expected !== null
      )
      .find(
        item =>
          item.expected !==
          item.actual
      );

  if (mismatch !== undefined) {
    throw new Error(
      `Conflicting form-control identity: target ${mismatch.field}=${JSON.stringify(mismatch.expected)} does not match the resolved element value ${JSON.stringify(mismatch.actual)}.`
    );
  }
}

async function findUniqueControlByAttribute(
  page: Page,
  attribute: 'id' | 'name',
  value: string
): Promise<Locator | null> {
  const controls = page.locator('input, textarea, select');

  const matchingIndices = await controls.evaluateAll(
    (elements, args) =>
      elements
        .map((element, index) =>
          element.getAttribute(args.attribute) === args.value ? index : -1
        )
        .filter(index => index >= 0),
    {
      attribute,
      value
    }
  );

  if (matchingIndices.length === 0) {
    return null;
  }

  if (matchingIndices.length > 1) {
    throw new Error(
      `Ambiguous form-control target: ${matchingIndices.length} controls have ${attribute}="${value}".`
    );
  }

  return controls.nth(matchingIndices[0]);
}

async function findUniqueLocator(
  locator: Locator,
  description: string
): Promise<Locator | null> {
  const count = await locator.count();

  if (count === 0) {
    return null;
  }

  if (count > 1) {
    throw new Error(
      `Ambiguous form-control target: ${count} controls match ${description}.`
    );
  }

  return locator;
}

async function assertSupportedFormControl(locator: Locator): Promise<void> {
  const tagName = await locator.evaluate(element =>
    element.tagName.toLowerCase()
  );

  if (!['input', 'textarea', 'select'].includes(tagName)) {
    throw new Error(
      `Unsupported form-control element: expected input, textarea, or select, but found <${tagName}>.`
    );
  }
}

async function assertTextEntryControl(locator: Locator): Promise<void> {
  const control = await locator.evaluate(element => ({
    tagName: element.tagName.toLowerCase(),
    type:
      element instanceof HTMLInputElement
        ? element.type.toLowerCase()
        : null
  }));

  if (control.tagName === 'textarea') {
    return;
  }

  if (control.tagName !== 'input') {
    throw new Error(
      `Cannot enter text into <${control.tagName}>. Only supported text-entry controls may be filled or cleared.`
    );
  }

  const allowedInputTypes = new Set([
    'text',
    'email',
    'search',
    'tel',
    'url',
    'password',
    'number'
  ]);

  if (
    control.type === null ||
    !allowedInputTypes.has(control.type)
  ) {
    throw new Error(
      `Input type "${control.type}" is not approved for text-entry actions.`
    );
  }
}

async function assertSelectControl(locator: Locator): Promise<void> {
  const tagName = await locator.evaluate(element =>
    element.tagName.toLowerCase()
  );

  if (tagName !== 'select') {
    throw new Error(
      `Cannot select an option from <${tagName}>. The current select-option action only supports native <select> controls.`
    );
  }
}

async function executeFillTextField(
  page: Page,
  action: Extract<AgentAction, { kind: 'fill-text-field' }>
): Promise<ExecutedAgentActionResult> {
  const control = await resolveFormControl(page, action.target);

  await assertTextEntryControl(control);
  await control.fill(action.value);

  return {
    kind: action.kind,
    status: 'executed',
    detail: `Filled approved text-entry control with ${action.value.length} character(s).`
  };
}

async function executeClearField(
  page: Page,
  action: Extract<AgentAction, { kind: 'clear-field' }>
): Promise<ExecutedAgentActionResult> {
  const control = await resolveFormControl(page, action.target);

  await assertTextEntryControl(control);
  await control.clear();

  return {
    kind: action.kind,
    status: 'executed',
    detail: 'Cleared approved text-entry control.'
  };
}

async function executeBlurField(
  page: Page,
  action: Extract<AgentAction, { kind: 'blur-field' }>
): Promise<ExecutedAgentActionResult> {
  const control = await resolveFormControl(page, action.target);

  await control.blur();

  return {
    kind: action.kind,
    status: 'executed',
    detail: 'Blurred approved form control.'
  };
}

async function executeSelectOption(
  page: Page,
  action: Extract<AgentAction, { kind: 'select-option' }>
): Promise<ExecutedAgentActionResult> {
  const control = await resolveFormControl(page, action.target);

  await assertSelectControl(control);

  const optionExists = await control
    .locator('option')
    .evaluateAll(
      (options, optionText) =>
        options.some(option => option.textContent?.trim() === optionText),
      action.optionText
    );

  if (!optionExists) {
    throw new Error(
      `Requested option "${action.optionText}" does not exist in the targeted select control.`
    );
  }

  await control.selectOption({
    label: action.optionText
  });

  return {
    kind: action.kind,
    status: 'executed',
    detail: `Selected option "${action.optionText}" from approved native select control.`
  };
}

async function executeScroll(
  page: Page,
  action: Extract<AgentAction, { kind: 'scroll' }>
): Promise<ExecutedAgentActionResult> {
  const multiplier = action.direction === 'down' ? 1 : -1;

  await page.evaluate(
    ({ multiplier, viewportCount }) => {
      window.scrollBy(
        0,
        window.innerHeight * viewportCount * multiplier
      );
    },
    {
      multiplier,
      viewportCount: action.viewportCount
    }
  );

  return {
    kind: action.kind,
    status: 'executed',
    detail: `Scrolled ${action.direction} by ${action.viewportCount} viewport(s).`
  };
}

/**
 * Executes one already-validated exploratory-agent action.
 *
 * This function is the deterministic boundary between AI planning and
 * browser execution. The AI chooses only from the approved AgentAction
 * vocabulary; this executor controls the actual Playwright operations.
 */
export async function executeAgentAction(
  page: Page,
  action: AgentAction
): Promise<ExecutedAgentActionResult> {
  switch (action.kind) {
    case 'fill-text-field':
      return executeFillTextField(page, action);

    case 'clear-field':
      return executeClearField(page, action);

    case 'blur-field':
      return executeBlurField(page, action);

    case 'select-option':
      return executeSelectOption(page, action);

    case 'set-disclosure-state': {
      const result =
        await executeGuardedDisclosureAction(
          page,
          action
        );

      return {
        kind:
          action.kind,
        status:
          result.status,
        detail:
          result.detail,
        safetyEvents:
          result.safetyEvents,
        hardBreach:
          result.hardBreach,
        disclosureEvidence:
          result.evidence
      };
    }

    case 'select-tab': {
      const result =
        await executeGuardedTabAction(
          page,
          action
        );

      return {
        kind:
          action.kind,
        status:
          result.status,
        detail:
          result.detail,
        safetyEvents:
          result.safetyEvents,
        hardBreach:
          result.hardBreach,
        tabEvidence:
          result.evidence
      };
    }

    case 'scroll':
      return executeScroll(page, action);

    case 'stop':
      return {
        kind: action.kind,
        status: 'stopped',
        detail: action.reason
      };
  }
}
