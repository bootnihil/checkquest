import type {
  Locator,
  Page
} from '@playwright/test';

import type {
  AgentAction
} from '../actions/agent-action-schema';
import {
  runGuardedInteractionSafetyBoundary,
  type DisclosureSafetyEvent
} from './execute-guarded-disclosure-action';

type SelectTabAction =
  Extract<
    AgentAction,
    {
      kind: 'select-tab';
    }
  >;

export interface TabIdentity {
  controlId: string;
  accessibleName: string;
  controlledPanelId: string;
}

export interface TabStateSnapshot {
  selectedTab:
    TabIdentity;
  selectedTabSelected: boolean;
  selectedPanelVisible: boolean;
  targetTabSelected: boolean;
  targetPanelVisible: boolean;
}

export interface TabActionEvidence {
  before: TabStateSnapshot;
  after: TabStateSnapshot | null;
  rollback: TabStateSnapshot | null;
  desiredState: 'selected';
  selectedTabTransitionObserved: boolean;
  previousTabDeselected: boolean;
  targetPanelChangedConsistently: boolean;
  previousPanelChangedConsistently: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
}

export interface GuardedTabActionResult {
  status: 'executed' | 'unsafe';
  detail: string;
  safetyEvents: DisclosureSafetyEvent[];
  hardBreach: boolean;
  evidence: TabActionEvidence | null;
}

interface TabPreflight {
  target:
    TabIdentity;
  original:
    TabIdentity;
  snapshot:
    TabStateSnapshot;
}

const actionTimeoutMs =
  2_000;
const stateSettleTimeoutMs =
  1_000;

export async function executeGuardedTabAction(
  page: Page,
  action:
    SelectTabAction
): Promise<GuardedTabActionResult> {
  let evidence:
    TabActionEvidence | null =
    null;

  const boundary =
    await runGuardedInteractionSafetyBoundary(
      page,
      'tab selection',
      async context => {
        const preflight =
          await inspectTabTarget(
            page,
            action
          );
        const targetControl =
          await resolveUniqueElementById(
            page,
            action.target
              .controlId,
            'tab control'
          );
        let after:
          TabStateSnapshot | null =
          null;
        let rollback:
          TabStateSnapshot | null =
          null;
        let rollbackAttempted =
          false;
        let executionError:
          unknown = null;

        try {
          await targetControl.click({
            timeout:
              actionTimeoutMs,
            noWaitAfter:
              true
          });

          await waitForSelectedTabState(
            page,
            action,
            preflight.original
          ).catch(
            () => undefined
          );
          await page.waitForTimeout(
            50
          );

          after =
            await captureTabState(
              page,
              action,
              preflight.original
            );
        } catch (error) {
          executionError =
            error;
        }

        await context
          .collectBrowserSafetyEvents();

        const stateChanged =
          after === null ||
          !snapshotsEqual(
            preflight.snapshot,
            after
          );

        if (
          context.safetyEvents
            .length === 0 &&
          stateChanged
        ) {
          rollbackAttempted =
            true;

          try {
            const originalControl =
              await resolveUniqueElementById(
                page,
                preflight.original
                  .controlId,
                'originally selected tab'
              );

            await originalControl.click({
              timeout:
                actionTimeoutMs,
              noWaitAfter:
                true
            });

            await waitForRollbackState(
              page,
              action,
              preflight.original,
              preflight.snapshot
            ).catch(
              () => undefined
            );
            await page.waitForTimeout(
              50
            );

            rollback =
              await captureTabState(
                page,
                action,
                preflight.original
              );
          } catch (error) {
            if (
              executionError === null
            ) {
              executionError =
                error;
            }
          }

          await context
            .collectBrowserSafetyEvents();
        } else if (
          context.safetyEvents
            .length === 0
        ) {
          rollback =
            await captureTabState(
              page,
              action,
              preflight.original
            );
        }

        const targetWasOriginal =
          preflight.original
            .controlId ===
          action.target.controlId;
        const selectedTabTransitionObserved =
          after !== null &&
          !preflight.snapshot
            .targetTabSelected &&
          after.targetTabSelected;
        const previousTabDeselected =
          after !== null &&
          (
            targetWasOriginal ||
            (
              preflight.snapshot
                .selectedTabSelected &&
              !after
                .selectedTabSelected
            )
          );
        const targetPanelChangedConsistently =
          after !== null &&
          !preflight.snapshot
            .targetPanelVisible &&
          after.targetPanelVisible;
        const previousPanelChangedConsistently =
          after !== null &&
          (
            targetWasOriginal ||
            (
              preflight.snapshot
                .selectedPanelVisible &&
              !after
                .selectedPanelVisible
            )
          );
        const rollbackSucceeded =
          rollback !== null &&
          snapshotsEqual(
            preflight.snapshot,
            rollback
          ) &&
          page.url() ===
            context.originalUrl &&
          new URL(
            page.url()
          ).origin ===
            context.originalOrigin;

        evidence = {
          before:
            preflight.snapshot,
          after,
          rollback,
          desiredState:
            action.desiredState,
          selectedTabTransitionObserved,
          previousTabDeselected,
          targetPanelChangedConsistently,
          previousPanelChangedConsistently,
          rollbackAttempted,
          rollbackSucceeded
        };

        if (!rollbackSucceeded) {
          throw new Error(
            'The exact original tab and panel state was not restored.'
          );
        }

        if (
          executionError !== null
        ) {
          throw new Error(
            `The guarded tab action encountered an execution failure after restoring the original state: ${executionError instanceof Error ? executionError.message : String(executionError)}`
          );
        }

        return evidence;
      }
    );

  if (
    boundary.status ===
      'unsafe' ||
    evidence === null
  ) {
    return {
      status: 'unsafe',
      detail:
        boundary.detail,
      safetyEvents:
        boundary.safetyEvents,
      hardBreach:
        boundary.hardBreach,
      evidence
    };
  }

  return {
    status: 'executed',
    detail:
      `Selected tab "${action.target.accessibleName}", captured deterministic tab and panel evidence, and restored the exact original tab.`,
    safetyEvents: [],
    hardBreach: false,
    evidence
  };
}

async function inspectTabTarget(
  page: Page,
  action:
    SelectTabAction
): Promise<TabPreflight> {
  const control =
    await resolveUniqueElementById(
      page,
      action.target.controlId,
      'tab control'
    );
  const inspection =
    await control.evaluate(
      (
        element,
        target
      ) => {
        const rejectionReasons:
          string[] = [];
        const role =
          (
            element.getAttribute(
              'role'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
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
            .map(id =>
              (
                document
                  .getElementById(id)
                  ?.textContent ??
                ''
              )
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(
              value =>
                value.length > 0
            )
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const accessibleName =
          ariaLabel ||
          labelledByText ||
          (
            (
              element as
                HTMLElement
            ).innerText ||
            element.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim() ||
          (
            element.getAttribute(
              'title'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const rawSelected =
          (
            element.getAttribute(
              'aria-selected'
            ) ??
            ''
          )
            .trim()
            .toLowerCase();
        const controlledIds =
          (
            element.getAttribute(
              'aria-controls'
            ) ??
            ''
          )
            .trim()
            .split(/\s+/)
            .filter(
              value =>
                value.length > 0
            );
        const targetPanel =
          controlledIds.length === 1
            ? document.getElementById(
                controlledIds[0]
              )
            : null;
        const tabList =
          element.closest(
            '[role="tablist"]'
          );
        const tabListId =
          (
            tabList?.getAttribute(
              'id'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
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
        const linkLike =
          element.tagName
            .toLowerCase() ===
            'a' ||
          element.hasAttribute(
            'href'
          ) ||
          element.closest(
            'a[href]'
          ) !== null;
        const formAssociated =
          (
            element instanceof
              HTMLButtonElement ||
            element instanceof
              HTMLInputElement
          )
            ? element.form !== null
            : false;
        const rawType =
          (
            element.getAttribute(
              'type'
            ) ??
            ''
          )
            .trim()
            .toLowerCase();
        const submitLike =
          element instanceof
            HTMLButtonElement
            ? rawType !== 'button'
            : element instanceof
                HTMLInputElement
              ? element.type
                  .toLowerCase() !==
                'button'
              : false;

        if (role !== 'tab') {
          rejectionReasons.push(
            'the control does not have role=tab'
          );
        }

        if (
          accessibleName !==
          target.accessibleName
        ) {
          rejectionReasons.push(
            `accessible name is "${accessibleName}", not "${target.accessibleName}"`
          );
        }

        if (
          rawSelected !== 'true' &&
          rawSelected !== 'false'
        ) {
          rejectionReasons.push(
            'aria-selected must be explicitly true or false'
          );
        }

        if (
          controlledIds.length !==
            1 ||
          controlledIds[0] !==
            target.controlledPanelId
        ) {
          rejectionReasons.push(
            `aria-controls does not exactly identify "${target.controlledPanelId}"`
          );
        }

        if (
          targetPanel === null ||
          (
            targetPanel.getAttribute(
              'role'
            ) ??
            ''
          )
            .trim()
            .toLowerCase() !==
            'tabpanel'
        ) {
          rejectionReasons.push(
            'the controlled same-document element is not a role=tabpanel'
          );
        } else if (
          document.querySelectorAll(
            `[id="${CSS.escape(
              target.controlledPanelId
            )}"]`
          ).length !== 1
        ) {
          rejectionReasons.push(
            'the controlled panel id is not unique'
          );
        } else if (
          targetPanel.querySelector(
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
            'the controlled panel contains editable or submission controls'
          );
        }

        if (
          tabList === null ||
          tabListId !==
            target.tabListId ||
          document.querySelectorAll(
            `[id="${CSS.escape(
              target.tabListId
            )}"]`
          ).length !== 1
        ) {
          rejectionReasons.push(
            `the exact role=tablist identity "${target.tabListId}" was not resolved`
          );
        }

        if (
          nativeDisabled ||
          ariaDisabled
        ) {
          rejectionReasons.push(
            'the tab control is disabled'
          );
        }

        if (linkLike) {
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
            'aria-haspopup tabs are not permitted'
          );
        }

        if (
          formAssociated ||
          element.closest('form') !==
            null
        ) {
          rejectionReasons.push(
            'form-associated tabs are not permitted'
          );
        }

        if (submitLike) {
          rejectionReasons.push(
            'submit, reset, or default-submit semantics are not permitted'
          );
        }

        const tabs =
          tabList === null
            ? []
            : Array.from(
                tabList.querySelectorAll(
                  '[role="tab"]'
                )
              );
        const sameNameTabs =
          Array.from(
            document.querySelectorAll(
              '[role="tab"]'
            )
          ).filter(
            candidate => {
              const candidateAriaLabel =
                (
                  candidate.getAttribute(
                    'aria-label'
                  ) ??
                  ''
                )
                  .replace(/\s+/g, ' ')
                  .trim();
              const candidateLabelledByText =
                (
                  candidate.getAttribute(
                    'aria-labelledby'
                  ) ??
                  ''
                )
                  .split(/\s+/)
                  .filter(
                    value =>
                      value.length > 0
                  )
                  .map(id =>
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
              const candidateName =
                candidateAriaLabel ||
                candidateLabelledByText ||
                (
                  (
                    candidate as
                      HTMLElement
                  ).innerText ||
                  candidate.textContent ||
                  ''
                )
                  .replace(/\s+/g, ' ')
                  .trim() ||
                (
                  candidate.getAttribute(
                    'title'
                  ) ??
                  ''
                )
                  .replace(/\s+/g, ' ')
                  .trim();

              return (
                candidateName ===
                target.accessibleName
              );
            }
          );

        if (
          sameNameTabs.length !== 1 ||
          sameNameTabs[0] !==
            element
        ) {
          rejectionReasons.push(
            'the accessible tab identity is ambiguous'
          );
        }

        const selectedTabs =
          tabs.filter(
            candidate =>
              (
                candidate.getAttribute(
                  'aria-selected'
                ) ??
                ''
              )
                .trim()
                .toLowerCase() ===
              'true'
          );

        if (
          selectedTabs.length !== 1
        ) {
          rejectionReasons.push(
            'the tablist must have exactly one explicitly selected tab'
          );
        }

        const original =
          selectedTabs[0] ??
          null;
        const originalId =
          (
            original?.getAttribute(
              'id'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const originalAriaLabel =
          (
            original?.getAttribute(
              'aria-label'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const originalLabelledByText =
          (
            original?.getAttribute(
              'aria-labelledby'
            ) ??
            ''
          )
            .split(/\s+/)
            .filter(
              value =>
                value.length > 0
            )
            .map(id =>
              (
                document
                  .getElementById(id)
                  ?.textContent ??
                ''
              )
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(
              value =>
                value.length > 0
            )
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const originalName =
          original === null
            ? ''
            : originalAriaLabel ||
              originalLabelledByText ||
              (
                (
                  original as
                    HTMLElement
                ).innerText ||
                original.textContent ||
                ''
              )
                .replace(/\s+/g, ' ')
                .trim() ||
              (
                original.getAttribute(
                  'title'
                ) ??
                ''
              )
                .replace(/\s+/g, ' ')
                .trim();
        const originalControls =
          (
            original?.getAttribute(
              'aria-controls'
            ) ??
            ''
          )
            .trim()
            .split(/\s+/)
            .filter(
              value =>
                value.length > 0
            );
        const originalPanel =
          originalControls.length ===
            1
            ? document.getElementById(
                originalControls[0]
              )
            : null;

        if (
          original !== null &&
          (
            originalId.length === 0 ||
            document.querySelectorAll(
              `[id="${CSS.escape(
                originalId
              )}"]`
            ).length !== 1 ||
            originalName.length === 0 ||
            originalControls.length !==
              1 ||
            originalPanel === null ||
            document.querySelectorAll(
              `[id="${CSS.escape(
                originalControls[0]
              )}"]`
            ).length !== 1 ||
            (
              originalPanel.getAttribute(
                'role'
              ) ??
              ''
            )
              .trim()
              .toLowerCase() !==
              'tabpanel' ||
            originalPanel.querySelector(
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
          )
        ) {
          rejectionReasons.push(
            'the originally selected tab does not have a safe exact rollback identity'
          );
        }

        return {
          rejectionReasons,
          target: {
            controlId:
              target.controlId,
            accessibleName,
            controlledPanelId:
              target.controlledPanelId
          },
          original: {
            controlId:
              originalId,
            accessibleName:
              originalName,
            controlledPanelId:
              originalControls[0] ??
              ''
          },
          snapshot: {
            selectedTab: {
              controlId:
                originalId,
              accessibleName:
                originalName,
              controlledPanelId:
                originalControls[0] ??
                ''
            },
            selectedTabSelected:
              original?.getAttribute(
                'aria-selected'
              ) === 'true',
            selectedPanelVisible:
              originalPanel !== null &&
              !(
                originalPanel as
                  HTMLElement
              ).hidden &&
              originalPanel.getAttribute(
                'aria-hidden'
              ) !== 'true' &&
              window.getComputedStyle(
                originalPanel
              ).display !== 'none' &&
              window.getComputedStyle(
                originalPanel
              ).visibility !==
                'hidden' &&
              originalPanel
                .getBoundingClientRect()
                .width > 0 &&
              originalPanel
                .getBoundingClientRect()
                .height > 0,
            targetTabSelected:
              rawSelected === 'true',
            targetPanelVisible:
              targetPanel !== null &&
              !(
                targetPanel as
                  HTMLElement
              ).hidden &&
              targetPanel.getAttribute(
                'aria-hidden'
              ) !== 'true' &&
              window.getComputedStyle(
                targetPanel
              ).display !== 'none' &&
              window.getComputedStyle(
                targetPanel
              ).visibility !==
                'hidden' &&
              targetPanel
                .getBoundingClientRect()
                .width > 0 &&
              targetPanel
                .getBoundingClientRect()
                .height > 0
          }
        };
      },
      action.target
    );

  if (
    inspection.rejectionReasons
      .length > 0
  ) {
    throw new Error(
      `Tab target is not eligible: ${inspection.rejectionReasons.join('; ')}.`
    );
  }

  const accessibleMatches =
    page.getByRole(
      'tab',
      {
        name:
          action.target
            .accessibleName,
        exact: true
      }
    );

  if (
    await accessibleMatches.count() !==
      1 ||
    await accessibleMatches
      .first()
      .getAttribute('id') !==
      action.target.controlId
  ) {
    throw new Error(
      `Tab accessible name "${action.target.accessibleName}" does not resolve uniquely to control id "${action.target.controlId}".`
    );
  }

  return inspection;
}

async function captureTabState(
  page: Page,
  action:
    SelectTabAction,
  original:
    TabIdentity
): Promise<TabStateSnapshot> {
  return page.evaluate(
    input => {
      const originalControl =
        document.getElementById(
          input.original.controlId
        );
      const originalPanel =
        document.getElementById(
          input.original
            .controlledPanelId
        );
      const targetControl =
        document.getElementById(
          input.target.controlId
        );
      const targetPanel =
        document.getElementById(
          input.target
            .controlledPanelId
        );

      if (
        originalControl === null ||
        originalPanel === null ||
        targetControl === null ||
        targetPanel === null
      ) {
        throw new Error(
          'A tab or controlled panel disappeared while collecting evidence.'
        );
      }

      return {
        selectedTab:
          input.original,
        selectedTabSelected:
          originalControl
            .getAttribute(
              'aria-selected'
            ) === 'true',
        selectedPanelVisible:
          !(
            originalPanel as
              HTMLElement
          ).hidden &&
          originalPanel.getAttribute(
            'aria-hidden'
          ) !== 'true' &&
          window.getComputedStyle(
            originalPanel
          ).display !== 'none' &&
          window.getComputedStyle(
            originalPanel
          ).visibility !==
            'hidden' &&
          originalPanel
            .getBoundingClientRect()
            .width > 0 &&
          originalPanel
            .getBoundingClientRect()
            .height > 0,
        targetTabSelected:
          targetControl
            .getAttribute(
              'aria-selected'
            ) === 'true',
        targetPanelVisible:
          !(
            targetPanel as
              HTMLElement
          ).hidden &&
          targetPanel.getAttribute(
            'aria-hidden'
          ) !== 'true' &&
          window.getComputedStyle(
            targetPanel
          ).display !== 'none' &&
          window.getComputedStyle(
            targetPanel
          ).visibility !==
            'hidden' &&
          targetPanel
            .getBoundingClientRect()
            .width > 0 &&
          targetPanel
            .getBoundingClientRect()
            .height > 0
      };
    },
    {
      original,
      target:
        action.target
    }
  );
}

async function waitForSelectedTabState(
  page: Page,
  action:
    SelectTabAction,
  original:
    TabIdentity
): Promise<void> {
  await page.waitForFunction(
    input => {
      const target =
        document.getElementById(
          input.targetId
        );
      const targetPanel =
        document.getElementById(
          input.targetPanelId
        );
      const originalControl =
        document.getElementById(
          input.originalId
        );

      if (
        target === null ||
        targetPanel === null ||
        originalControl === null
      ) {
        return false;
      }

      const style =
        window.getComputedStyle(
          targetPanel
        );
      const rectangle =
        targetPanel
          .getBoundingClientRect();
      const targetPanelVisible =
        !targetPanel.hidden &&
        targetPanel.getAttribute(
          'aria-hidden'
        ) !== 'true' &&
        style.display !== 'none' &&
        style.visibility !==
          'hidden' &&
        rectangle.width > 0 &&
        rectangle.height > 0;

      return (
        target.getAttribute(
          'aria-selected'
        ) === 'true' &&
        targetPanelVisible &&
        (
          input.targetId ===
            input.originalId ||
          originalControl.getAttribute(
            'aria-selected'
          ) === 'false'
        )
      );
    },
    {
      targetId:
        action.target.controlId,
      targetPanelId:
        action.target
          .controlledPanelId,
      originalId:
        original.controlId
    },
    {
      timeout:
        stateSettleTimeoutMs
    }
  );
}

async function waitForRollbackState(
  page: Page,
  action:
    SelectTabAction,
  original:
    TabIdentity,
  before:
    TabStateSnapshot
): Promise<void> {
  await page.waitForFunction(
    input => {
      const originalControl =
        document.getElementById(
          input.original.controlId
        );
      const originalPanel =
        document.getElementById(
          input.original
            .controlledPanelId
        );
      const targetControl =
        document.getElementById(
          input.target.controlId
        );
      const targetPanel =
        document.getElementById(
          input.target
            .controlledPanelId
        );

      return (
        originalControl !== null &&
        originalPanel !== null &&
        targetControl !== null &&
        targetPanel !== null &&
        (
          originalControl.getAttribute(
            'aria-selected'
          ) === 'true'
        ) ===
          input.before
            .selectedTabSelected &&
        (
          !(
            originalPanel as
              HTMLElement
          ).hidden &&
          originalPanel.getAttribute(
            'aria-hidden'
          ) !== 'true' &&
          window.getComputedStyle(
            originalPanel
          ).display !== 'none' &&
          window.getComputedStyle(
            originalPanel
          ).visibility !==
            'hidden' &&
          originalPanel
            .getBoundingClientRect()
            .width > 0 &&
          originalPanel
            .getBoundingClientRect()
            .height > 0
        ) ===
          input.before
            .selectedPanelVisible &&
        (
          targetControl.getAttribute(
            'aria-selected'
          ) === 'true'
        ) ===
          input.before
            .targetTabSelected &&
        (
          !(
            targetPanel as
              HTMLElement
          ).hidden &&
          targetPanel.getAttribute(
            'aria-hidden'
          ) !== 'true' &&
          window.getComputedStyle(
            targetPanel
          ).display !== 'none' &&
          window.getComputedStyle(
            targetPanel
          ).visibility !==
            'hidden' &&
          targetPanel
            .getBoundingClientRect()
            .width > 0 &&
          targetPanel
            .getBoundingClientRect()
            .height > 0
        ) ===
          input.before
            .targetPanelVisible
      );
    },
    {
      original,
      target:
        action.target,
      before
    },
    {
      timeout:
        stateSettleTimeoutMs
    }
  );
}

async function resolveUniqueElementById(
  page: Page,
  id: string,
  description: string
): Promise<Locator> {
  const elements =
    page.locator('[id]');
  const matchingIndexes =
    await elements.evaluateAll(
      (
        candidates,
        expectedId
      ) =>
        candidates
          .map(
            (
              candidate,
              index
            ) =>
              candidate.getAttribute(
                'id'
              ) === expectedId
                ? index
                : -1
          )
          .filter(
            index =>
              index >= 0
          ),
      id
    );

  if (
    matchingIndexes.length !==
    1
  ) {
    throw new Error(
      `${description} id "${id}" matched ${matchingIndexes.length} elements; exactly one is required.`
    );
  }

  return elements.nth(
    matchingIndexes[0]
  );
}

function snapshotsEqual(
  left:
    TabStateSnapshot,
  right:
    TabStateSnapshot
): boolean {
  return (
    left.selectedTab
      .controlId ===
      right.selectedTab
        .controlId &&
    left.selectedTab
      .accessibleName ===
      right.selectedTab
        .accessibleName &&
    left.selectedTab
      .controlledPanelId ===
      right.selectedTab
        .controlledPanelId &&
    left.selectedTabSelected ===
      right.selectedTabSelected &&
    left.selectedPanelVisible ===
      right.selectedPanelVisible &&
    left.targetTabSelected ===
      right.targetTabSelected &&
    left.targetPanelVisible ===
      right.targetPanelVisible
  );
}
