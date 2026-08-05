/*
 * Presentation-neutral page observation shared by browser extraction,
 * analysis, planning, exploration, investigation, and finding reconciliation.
 */
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

  /** Total number of options present in the real DOM. */
  totalOptions: number;

  /** True when options contains a bounded sample rather than every option. */
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

  /** Current local value. Password values are never exposed. */
  value: string | null;

  /** Browser-native validation state observed without submitting the form. */
  valid: boolean;
  validationMessage: string | null;
  ariaInvalid: string | null;
}

export interface PageDisclosureControl {
  tagName: string;
  role: string | null;
  buttonType: string | null;
  controlId: string | null;
  visibleText?: string | null;
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
  visibleText?: string | null;
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
