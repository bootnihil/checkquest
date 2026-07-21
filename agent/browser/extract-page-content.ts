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

export interface ExtractedPageContent {
  title: string;
  headings: string[];
  bodyText: string;
  links: PageContentLink[];
  buttons: string[];
  textFields: PageTextFieldControl[];
  selects: PageSelectControl[];
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

    return {
      title,
      headings,
      bodyText,
      links,
      buttons,
      textFields,
      selects
    };
  });
}
