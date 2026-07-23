import type { Page } from '@playwright/test';

export interface PageContentLink {
  text: string;
  url: string;
}

export interface PageSelectOption {
  text: string;
  value: string;
  selected: boolean;
}

export interface PageSelectControl {
  label: string | null;
  name: string | null;
  id: string | null;
  required: boolean;
  disabled: boolean;

  /**
   * Total number of options present in the real DOM.
   */
  totalOptions: number;

  /**
   * True when the options array contains a bounded sample rather than
   * every option from the control.
   */
  optionsTruncated: boolean;

  options: PageSelectOption[];
}

export interface PageTextFieldControl {
  tagName: 'input' | 'textarea';
  inputType: string;
  label: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;

  /**
   * Current local field value.
   *
   * Password values are never exposed to the reasoning layer.
   */
  value: string | null;

  /**
   * Browser-native validation state that can be inspected without
   * submitting the form.
   */
  valid: boolean;
  validationMessage: string | null;
  ariaInvalid: string | null;
}

export interface PageDisclosureControl {
  tagName: string;
  role: string | null;
  buttonType: string | null;
  controlId: string | null;
  accessibleName: string | null;
  ariaExpanded: 'true' | 'false' | null;
  ariaControls: string | null;
  disabled: boolean;
  ariaDisabled: boolean;
  href: string | null;
  hasLinkSemantics: boolean;
  ariaHasPopup: string | null;
  formAssociated: boolean;
  formAncestor: boolean;
  hasSubmitOrResetSemantics: boolean;
  controlledRegionExists: boolean;
  controlledRegionVisible: boolean | null;
  controlledRegionHasEditableOrSubmissionControls: boolean | null;
  eligibleForDisclosureAction: boolean;
  eligibilityRejectionReasons: string[];
}

export interface PageTabControl {
  tagName: string;
  role: 'tab';
  controlId: string | null;
  accessibleName: string | null;
  tabListId: string | null;
  ariaSelected: 'true' | 'false' | null;
  ariaControls: string | null;
  disabled: boolean;
  ariaDisabled: boolean;
  href: string | null;
  hasLinkSemantics: boolean;
  ariaHasPopup: string | null;
  formAssociated: boolean;
  formAncestor: boolean;
  hasSubmitOrResetSemantics: boolean;
  controlledPanelExists: boolean;
  controlledPanelRole: string | null;
  controlledPanelVisible: boolean | null;
  controlledPanelHasEditableOrSubmissionControls: boolean | null;
  eligibleForTabAction: boolean;
  eligibilityRejectionReasons: string[];
}

export interface ExtractedPageContent {
  title: string;
  headings: string[];
  bodyText: string;
  links: PageContentLink[];
  buttons: string[];
  textFields: PageTextFieldControl[];
  selects: PageSelectControl[];
  disclosures: PageDisclosureControl[];
  tabs: PageTabControl[];
}

export async function extractPageContent(
  page: Page
): Promise<ExtractedPageContent> {
  return page.evaluate(() => {
    /*
     * Keep browser-side logic self-contained.
     *
     * In particular, avoid declaring reusable helper functions inside
     * page.evaluate(). Some TypeScript runtime transpilers may decorate
     * those functions with Node-side helpers that do not exist in the
     * browser execution context.
     */

    const title = document.title
      .replace(/\s+/g, ' ')
      .trim();

    const headings = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h1, h2, h3'
      )
    )
      .filter(element => {
        const style =
          window.getComputedStyle(element);

        const rectangle =
          element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      })
      .map(heading =>
        heading.innerText
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(text => text.length > 0);

    const bodyText =
      (
        document.body?.innerText ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15_000);

    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[href]'
      )
    )
      .filter(element => {
        const style =
          window.getComputedStyle(element);

        const rectangle =
          element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      })
      .map(link => {
        const visibleText =
          link.innerText
            .replace(/\s+/g, ' ')
            .trim();

        const ariaLabel =
          (
            link.getAttribute(
              'aria-label'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        return {
          text:
            visibleText.length > 0
              ? visibleText
              : ariaLabel,
          url: link.href
        };
      })
      .filter(
        link =>
          link.text.length > 0 &&
          link.url.length > 0
      )
      .slice(0, 50);

    /*
     * Observe both real <button> elements and input controls that act
     * as buttons.
     *
     * These are observation-only. Their presence does NOT grant the AI
     * permission to click or submit them.
     */
    const buttons = Array.from(
      document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement
      >(
        'button, input[type="submit"], input[type="button"], input[type="reset"]'
      )
    )
      .filter(element => {
        const style =
          window.getComputedStyle(element);

        const rectangle =
          element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      })
      .map(element => {
        if (
          element instanceof
          HTMLInputElement
        ) {
          const value =
            element.value
              .replace(/\s+/g, ' ')
              .trim();

          const ariaLabel =
            (
              element.getAttribute(
                'aria-label'
              ) ?? ''
            )
              .replace(/\s+/g, ' ')
              .trim();

          return value.length > 0
            ? value
            : ariaLabel;
        }

        const visibleText =
          element.innerText
            .replace(/\s+/g, ' ')
            .trim();

        const ariaLabel =
          (
            element.getAttribute(
              'aria-label'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        return visibleText.length > 0
          ? visibleText
          : ariaLabel;
      })
      .filter(text => text.length > 0)
      .slice(0, 30);

    const approvedInputTypes = new Set([
      'text',
      'email',
      'search',
      'tel',
      'url',
      'password',
      'number'
    ]);

    const textFields = Array.from(
      document.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >('input, textarea')
    )
      .filter(element => {
        const style =
          window.getComputedStyle(element);

        const rectangle =
          element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      })
      .filter(element => {
        if (
          element instanceof
          HTMLTextAreaElement
        ) {
          return true;
        }

        return approvedInputTypes.has(
          element.type.toLowerCase()
        );
      })
      .map(element => {
        let label: string | null = null;

        if (
          element.labels !== null &&
          element.labels.length > 0
        ) {
          const labelText = Array.from(
            element.labels
          )
            .map(labelElement =>
              (
                labelElement.innerText ||
                labelElement.textContent ||
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

          if (labelText.length > 0) {
            label = labelText;
          }
        }

        if (label === null) {
          const ariaLabel =
            (
              element.getAttribute(
                'aria-label'
              ) ?? ''
            )
              .replace(/\s+/g, ' ')
              .trim();

          if (ariaLabel.length > 0) {
            label = ariaLabel;
          }
        }

        const name =
          (
            element.getAttribute(
              'name'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const id =
          (
            element.getAttribute(
              'id'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const placeholder =
          (
            element.getAttribute(
              'placeholder'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const validationMessage =
          element.validationMessage
            .replace(/\s+/g, ' ')
            .trim();

        const ariaInvalid =
          (
            element.getAttribute(
              'aria-invalid'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const isPassword =
          element instanceof
            HTMLInputElement &&
          element.type.toLowerCase() ===
            'password';

        return {
          tagName:
            element instanceof
            HTMLTextAreaElement
              ? ('textarea' as const)
              : ('input' as const),

          inputType:
            element instanceof
            HTMLTextAreaElement
              ? 'textarea'
              : element.type.toLowerCase(),

          label,

          name:
            name.length > 0
              ? name
              : null,

          id:
            id.length > 0
              ? id
              : null,

          placeholder:
            placeholder.length > 0
              ? placeholder
              : null,

          required: element.required,
          disabled: element.disabled,
          readOnly: element.readOnly,

          value: isPassword
            ? null
            : element.value.slice(
                0,
                500
              ),

          valid:
            element.validity.valid,

          validationMessage:
            validationMessage.length > 0
              ? validationMessage
              : null,

          ariaInvalid:
            ariaInvalid.length > 0
              ? ariaInvalid
              : null
        };
      })
      .slice(0, 30);

    const selects = Array.from(
      document.querySelectorAll<HTMLSelectElement>(
        'select'
      )
    )
      .filter(element => {
        const style =
          window.getComputedStyle(element);

        const rectangle =
          element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      })
      .map(select => {
        let label: string | null = null;

        if (
          select.labels !== null &&
          select.labels.length > 0
        ) {
          const labelText = Array.from(
            select.labels
          )
            .map(labelElement =>
              (
                labelElement.innerText ||
                labelElement.textContent ||
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

          if (labelText.length > 0) {
            label = labelText;
          }
        }

        if (label === null) {
          const ariaLabel =
            (
              select.getAttribute(
                'aria-label'
              ) ?? ''
            )
              .replace(/\s+/g, ' ')
              .trim();

          if (ariaLabel.length > 0) {
            label = ariaLabel;
          }
        }

        const name =
          (
            select.getAttribute(
              'name'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const id =
          (
            select.getAttribute(
              'id'
            ) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const allOptions =
          Array.from(
            select.options
          )
            .map(option => ({
              text:
                (
                  option.textContent ??
                  ''
                )
                  .replace(
                    /\s+/g,
                    ' '
                  )
                  .trim(),

              value:
                option.value,

              selected:
                option.selected
            }));

        /*
         * Keep normal dropdowns complete.
         *
         * For unusually large dropdowns, preserve both the beginning
         * and the end of the list. This keeps planner prompts bounded
         * while avoiding the previous bug where suspicious values
         * appended near the end of a country list were invisible.
         */
        const options =
          allOptions.length <= 250
            ? allOptions
            : [
                ...allOptions.slice(
                  0,
                  200
                ),
                ...allOptions.slice(
                  -50
                )
              ];

        return {
          label,

          name:
            name.length > 0
              ? name
              : null,

          id:
            id.length > 0
              ? id
              : null,

          required:
            select.required,

          disabled:
            select.disabled,

          totalOptions:
            allOptions.length,

          optionsTruncated:
            allOptions.length >
            options.length,

          options
        };
      })
      .slice(0, 20);

    const disclosures = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[aria-expanded][aria-controls]'
      )
    )
      .slice(0, 30)
      .map(element => {
        const tagName =
          element.tagName.toLowerCase();

        const role =
          (
            element.getAttribute('role') ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase() ||
          null;

        const rawButtonType =
          (
            element.getAttribute('type') ??
            ''
          )
            .trim()
            .toLowerCase();

        const buttonType =
          rawButtonType.length > 0
            ? rawButtonType
            : null;

        const controlId =
          (
            element.getAttribute('id') ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim() ||
          null;

        const ariaLabel =
          (
            element.getAttribute(
              'aria-label'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const labelledByIds =
          (
            element.getAttribute(
              'aria-labelledby'
            ) ??
            ''
          )
            .split(/\s+/)
            .filter(value => value.length > 0);

        const labelledByText =
          labelledByIds
            .map(id =>
              (
                document.getElementById(id)
                  ?.textContent ??
                ''
              )
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(value => value.length > 0)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        const visibleText =
          (
            element.innerText ||
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
            .trim() ||
          null;

        const rawExpanded =
          (
            element.getAttribute(
              'aria-expanded'
            ) ??
            ''
          )
            .trim()
            .toLowerCase();

        const ariaExpanded =
          rawExpanded === 'true' ||
          rawExpanded === 'false'
            ? (
                rawExpanded as
                  'true' | 'false'
              )
            : null;

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
            .filter(value => value.length > 0);

        const ariaControls =
          controlledIds.length === 1
            ? controlledIds[0]
            : rawControls.length > 0
              ? rawControls
              : null;

        const controlledRegion =
          controlledIds.length === 1
            ? document.getElementById(
                controlledIds[0]
              )
            : null;

        const controlledRegionVisible =
          controlledRegion === null
            ? null
            : (() => {
                const style =
                  window.getComputedStyle(
                    controlledRegion
                  );

                const rectangle =
                  controlledRegion
                    .getBoundingClientRect();

                return (
                  !controlledRegion.hidden &&
                  controlledRegion.getAttribute(
                    'aria-hidden'
                  ) !== 'true' &&
                  style.display !== 'none' &&
                  style.visibility !==
                    'hidden' &&
                  rectangle.width > 0 &&
                  rectangle.height > 0
                );
              })();

        const controlledRegionHasEditableOrSubmissionControls =
          controlledRegion === null
            ? null
            : controlledRegion.querySelector(
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
              ) !== null;

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

        const closestLink =
          element.closest<HTMLAnchorElement>(
            'a[href]'
          );

        const href =
          (
            element.getAttribute('href') ??
            closestLink?.getAttribute(
              'href'
            ) ??
            ''
          )
            .trim() ||
          null;

        const hasLinkSemantics =
          tagName === 'a' ||
          role === 'link' ||
          href !== null ||
          closestLink !== null;

        const ariaHasPopup =
          element.hasAttribute(
            'aria-haspopup'
          )
            ? (
                element.getAttribute(
                  'aria-haspopup'
                ) ??
                ''
              )
                .trim()
            : null;

        const formAssociated =
          (
            element instanceof
              HTMLButtonElement ||
            element instanceof
              HTMLInputElement
          )
            ? element.form !== null
            : false;

        const formAncestor =
          element.closest('form') !==
          null;

        const hasSubmitOrResetSemantics =
          (
            element instanceof
            HTMLButtonElement
          )
            ? buttonType !== 'button'
            : (
                element instanceof
                HTMLInputElement
              )
              ? ![
                  'button'
                ].includes(
                  element.type
                    .toLowerCase()
                )
              : false;

        const isApprovedControl =
          (
            element instanceof
            HTMLButtonElement &&
            buttonType === 'button'
          ) ||
          role === 'button';

        const rejectionReasons:
          string[] = [];

        if (ariaExpanded === null) {
          rejectionReasons.push(
            'aria-expanded must be explicitly true or false'
          );
        }

        if (
          controlledIds.length !== 1 ||
          controlledRegion === null
        ) {
          rejectionReasons.push(
            'aria-controls must identify one existing same-document region'
          );
        }

        if (controlId === null) {
          rejectionReasons.push(
            'a stable control id is required'
          );
        }

        if (accessibleName === null) {
          rejectionReasons.push(
            'an accessible name is required'
          );
        }

        if (
          nativeDisabled ||
          ariaDisabled
        ) {
          rejectionReasons.push(
            'the disclosure control is disabled'
          );
        }

        if (hasLinkSemantics) {
          rejectionReasons.push(
            'link or href semantics are not permitted'
          );
        }

        if (ariaHasPopup !== null) {
          rejectionReasons.push(
            'aria-haspopup disclosures are not permitted'
          );
        }

        if (
          formAssociated ||
          formAncestor
        ) {
          rejectionReasons.push(
            'form-associated disclosures are not permitted'
          );
        }

        if (hasSubmitOrResetSemantics) {
          rejectionReasons.push(
            'submit, reset, or default-submit semantics are not permitted'
          );
        }

        if (!isApprovedControl) {
          rejectionReasons.push(
            'only explicit type=button or role=button controls are permitted'
          );
        }

        if (
          controlledRegionHasEditableOrSubmissionControls ===
          true
        ) {
          rejectionReasons.push(
            'the controlled region contains editable or submission controls'
          );
        }

        return {
          tagName,
          role,
          buttonType,
          controlId,
          accessibleName,
          ariaExpanded,
          ariaControls,
          disabled:
            nativeDisabled,
          ariaDisabled,
          href,
          hasLinkSemantics,
          ariaHasPopup,
          formAssociated,
          formAncestor,
          hasSubmitOrResetSemantics,
          controlledRegionExists:
            controlledRegion !== null,
          controlledRegionVisible,
          controlledRegionHasEditableOrSubmissionControls,
          eligibleForDisclosureAction:
            rejectionReasons.length ===
            0,
          eligibilityRejectionReasons:
            rejectionReasons
        };
      });

    const allTabElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="tab"]'
      )
    );

    const tabs = allTabElements
      .slice(0, 30)
      .map(element => {
        const tagName =
          element.tagName.toLowerCase();
        const controlId =
          (
            element.getAttribute('id') ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim() ||
          null;
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
            .filter(value => value.length > 0)
            .map(id =>
              (
                document.getElementById(id)
                  ?.textContent ??
                ''
              )
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(value => value.length > 0)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const visibleText =
          (
            element.innerText ||
            element.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const accessibleName =
          ariaLabel ||
          labelledByText ||
          visibleText ||
          (
            element.getAttribute(
              'title'
            ) ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim() ||
          null;
        const rawSelected =
          (
            element.getAttribute(
              'aria-selected'
            ) ??
            ''
          )
            .trim()
            .toLowerCase();
        const ariaSelected =
          rawSelected === 'true' ||
          rawSelected === 'false'
            ? (
                rawSelected as
                  'true' | 'false'
              )
            : null;
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
            .filter(value => value.length > 0);
        const ariaControls =
          controlledIds.length === 1
            ? controlledIds[0]
            : rawControls.length > 0
              ? rawControls
              : null;
        const controlledPanel =
          controlledIds.length === 1
            ? document.getElementById(
                controlledIds[0]
              )
            : null;
        const controlledPanelRole =
          controlledPanel === null
            ? null
            : (
                controlledPanel.getAttribute(
                  'role'
                ) ??
                ''
              )
                .trim()
                .toLowerCase() ||
              null;
        const controlledPanelVisible =
          controlledPanel === null
            ? null
            : (() => {
                const style =
                  window.getComputedStyle(
                    controlledPanel
                  );
                const rectangle =
                  controlledPanel
                    .getBoundingClientRect();

                return (
                  !controlledPanel.hidden &&
                  controlledPanel.getAttribute(
                    'aria-hidden'
                  ) !== 'true' &&
                  style.display !== 'none' &&
                  style.visibility !==
                    'hidden' &&
                  rectangle.width > 0 &&
                  rectangle.height > 0
                );
              })();
        const controlledPanelHasEditableOrSubmissionControls =
          controlledPanel === null
            ? null
            : controlledPanel.querySelector(
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
              ) !== null;
        const tabList =
          element.closest<HTMLElement>(
            '[role="tablist"]'
          );
        const tabListId =
          (
            tabList?.getAttribute('id') ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim() ||
          null;
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
        const closestLink =
          element.closest<HTMLAnchorElement>(
            'a[href]'
          );
        const href =
          (
            element.getAttribute('href') ??
            closestLink?.getAttribute(
              'href'
            ) ??
            ''
          )
            .trim() ||
          null;
        const hasLinkSemantics =
          tagName === 'a' ||
          href !== null ||
          closestLink !== null;
        const ariaHasPopup =
          element.hasAttribute(
            'aria-haspopup'
          )
            ? (
                element.getAttribute(
                  'aria-haspopup'
                ) ??
                ''
              )
                .trim()
            : null;
        const formAssociated =
          (
            element instanceof
              HTMLButtonElement ||
            element instanceof
              HTMLInputElement
          )
            ? element.form !== null
            : false;
        const formAncestor =
          element.closest('form') !==
          null;
        const rawType =
          (
            element.getAttribute('type') ??
            ''
          )
            .trim()
            .toLowerCase();
        const hasSubmitOrResetSemantics =
          element instanceof
            HTMLButtonElement
            ? rawType !== 'button'
            : element instanceof
                HTMLInputElement
              ? element.type
                  .toLowerCase() !==
                'button'
              : false;
        const sameNameTabs =
          accessibleName === null
            ? []
            : allTabElements.filter(
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
                          document.getElementById(
                            id
                          )
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
                  const candidateName =
                    candidateAriaLabel ||
                    candidateLabelledByText ||
                    (
                      candidate.innerText ||
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
                    accessibleName
                  );
                }
              );
        const tabListTabs =
          tabList === null
            ? []
            : Array.from(
                tabList.querySelectorAll<HTMLElement>(
                  '[role="tab"]'
                )
              );
        const selectedTabs =
          tabListTabs.filter(
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
        const originalSelectedTab =
          selectedTabs[0] ??
          null;
        const originalSelectedId =
          (
            originalSelectedTab
              ?.getAttribute('id') ??
            ''
          )
            .trim();
        const originalSelectedControls =
          (
            originalSelectedTab
              ?.getAttribute(
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
        const originalSelectedPanel =
          originalSelectedControls
            .length === 1
            ? document.getElementById(
                originalSelectedControls[0]
              )
            : null;
        const rejectionReasons:
          string[] = [];

        if (controlId === null) {
          rejectionReasons.push(
            'a stable control id is required'
          );
        } else if (
          document.querySelectorAll(
            `[id="${CSS.escape(
              controlId
            )}"]`
          ).length !== 1
        ) {
          rejectionReasons.push(
            'the control id is not unique'
          );
        }

        if (accessibleName === null) {
          rejectionReasons.push(
            'an accessible name is required'
          );
        } else if (
          sameNameTabs.length !== 1 ||
          sameNameTabs[0] !== element
        ) {
          rejectionReasons.push(
            'the accessible tab identity is ambiguous'
          );
        }

        if (ariaSelected === null) {
          rejectionReasons.push(
            'aria-selected must be explicitly true or false'
          );
        }

        if (
          controlledIds.length !== 1
        ) {
          rejectionReasons.push(
            'aria-controls must identify exactly one panel'
          );
        } else if (
          controlledPanel === null
        ) {
          rejectionReasons.push(
            'the controlled same-document panel does not exist'
          );
        } else if (
          document.querySelectorAll(
            `[id="${CSS.escape(
              controlledIds[0]
            )}"]`
          ).length !== 1
        ) {
          rejectionReasons.push(
            'the controlled panel id is not unique'
          );
        } else if (
          controlledPanelRole !==
          'tabpanel'
        ) {
          rejectionReasons.push(
            'the controlled element must have role=tabpanel'
          );
        }

        if (tabList === null) {
          rejectionReasons.push(
            'the tab must belong to a role=tablist'
          );
        } else if (
          tabListId === null
        ) {
          rejectionReasons.push(
            'a stable tablist id is required'
          );
        } else if (
          document.querySelectorAll(
            `[id="${CSS.escape(
              tabListId
            )}"]`
          ).length !== 1
        ) {
          rejectionReasons.push(
            'the tablist id is not unique'
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

        if (hasLinkSemantics) {
          rejectionReasons.push(
            'link or href semantics are not permitted'
          );
        }

        if (ariaHasPopup !== null) {
          rejectionReasons.push(
            'aria-haspopup tabs are not permitted'
          );
        }

        if (
          formAssociated ||
          formAncestor
        ) {
          rejectionReasons.push(
            'form-associated tabs are not permitted'
          );
        }

        if (hasSubmitOrResetSemantics) {
          rejectionReasons.push(
            'submit, reset, or default-submit semantics are not permitted'
          );
        }

        if (
          controlledPanelHasEditableOrSubmissionControls ===
          true
        ) {
          rejectionReasons.push(
            'the controlled panel contains editable or submission controls'
          );
        }

        if (
          selectedTabs.length !== 1
        ) {
          rejectionReasons.push(
            'the tablist must have exactly one explicitly selected tab'
          );
        } else if (
          originalSelectedId.length ===
            0 ||
          document.querySelectorAll(
            `[id="${CSS.escape(
              originalSelectedId
            )}"]`
          ).length !== 1 ||
          originalSelectedControls
            .length !== 1 ||
          originalSelectedPanel ===
            null ||
          document.querySelectorAll(
            `[id="${CSS.escape(
              originalSelectedControls[0]
            )}"]`
          ).length !== 1 ||
          (
            originalSelectedPanel
              .getAttribute('role') ??
            ''
          )
            .trim()
            .toLowerCase() !==
            'tabpanel'
        ) {
          rejectionReasons.push(
            'the originally selected tab lacks an exact rollback identity'
          );
        } else if (
          originalSelectedPanel
            .querySelector(
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
            'the originally selected panel contains editable or submission controls'
          );
        }

        return {
          tagName,
          role: 'tab' as const,
          controlId,
          accessibleName,
          tabListId,
          ariaSelected,
          ariaControls,
          disabled:
            nativeDisabled,
          ariaDisabled,
          href,
          hasLinkSemantics,
          ariaHasPopup,
          formAssociated,
          formAncestor,
          hasSubmitOrResetSemantics,
          controlledPanelExists:
            controlledPanel !== null,
          controlledPanelRole,
          controlledPanelVisible,
          controlledPanelHasEditableOrSubmissionControls,
          eligibleForTabAction:
            rejectionReasons.length ===
            0,
          eligibilityRejectionReasons:
            rejectionReasons
        };
      });

    return {
      title,
      headings,
      bodyText,
      links,
      buttons,
      textFields,
      selects,
      disclosures,
      tabs
    };
  });
}
