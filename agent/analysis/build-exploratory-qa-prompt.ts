import type { ClassifiedDiagnostics } from './classify-diagnostics';
import type { PageFinding } from './evaluate-page';
import type { ExtractedPageContent } from '../browser/extract-page-content';
import type { VisitedPageObservation } from '../browser/visit-approved-link';
import type {
  KnownFindingPromptContext
} from '../investigation/known-findings';
import {
  createReferencedTechnicalCorsDiagnostics,
  createReferencedTechnicalRequests
} from './technical-observation-reconciliation';

export interface ExploratoryQaPromptInput {
  observation: VisitedPageObservation;
  content: ExtractedPageContent;
  classifiedDiagnostics: ClassifiedDiagnostics;
  ruleBasedFindings: PageFinding[];
  knownFindings?:
    KnownFindingPromptContext[];
}

export function buildExploratoryQaPrompt(
  input: ExploratoryQaPromptInput
): string {
  const {
    observation,
    content,
    classifiedDiagnostics,
    ruleBasedFindings,
    knownFindings = []
  } = input;

  const relevantFailedRequests =
    classifiedDiagnostics.failedRequests.filter(
      (item) =>
        item.disposition !== 'ignored-noise'
    );
  const referencedTechnicalRequests =
    createReferencedTechnicalRequests(
      classifiedDiagnostics,
      observation.finalUrl
    );
  const referencedTechnicalCors =
    createReferencedTechnicalCorsDiagnostics(
      classifiedDiagnostics,
      observation.finalUrl
    );

  const evidence = {
    page: {
      requestedUrl: observation.requestedUrl,
      finalUrl: observation.finalUrl,
      httpStatus: observation.httpStatus,
      title: observation.title
    },

    content: {
      title: content.title,
      headings: content.headings,
      bodyText: content.bodyText,
      links: content.links,
      buttons: content.buttons,

      /*
       * Select controls are supplied separately so
       * relationships between options are preserved.
       */
      selects: content.selects,

      /*
       * Informational disclosures retain their deterministic ARIA,
       * safety, ownership, and controlled-region relationships.
       */
      disclosures:
        content.disclosures,

      /*
       * Conventional tabs retain exact control, tablist, and panel
       * identity plus their strict action eligibility.
       */
      tabs:
        content.tabs
    },

    browserDiagnostics: {
      consoleErrors:
        classifiedDiagnostics.consoleErrors.map(
          consoleError => ({
            technicalObservationReference:
              referencedTechnicalCors
                .referenceByConsoleError
                .get(
                  consoleError
                ) ??
              null,
            ...consoleError
          })
        ),

      failedRequests:
        relevantFailedRequests.map(
          item => ({
            technicalObservationReference:
              referencedTechnicalRequests
                .referenceByRequest
                .get(
                  item.request
                ) ??
              null,
            ...item
          })
        )
    },

    ruleBasedFindings,

    /*
     * This is a compact run-local projection only.
     * Fingerprints, occurrence histories, screenshots, and
     * previous planner transcripts remain internal.
     */
    knownFindings
  };

  return `
You are performing exploratory software QA review of a public commercial website.

Your job is to identify plausible user-facing QA issues using ONLY the evidence provided below.

IMPORTANT RULES:

1. Every finding must be grounded in specific supplied evidence.

2. Do not invent missing behavior, visual defects, broken interactions, factual inaccuracies, deployment context, environment information, or release status.

3. Do not describe the page or issue as being on:
   - production
   - a production environment
   - a live site
   - a released site
   - a customer-facing deployment
   unless the supplied evidence explicitly establishes that fact.

4. When the evidence establishes only that text or behavior was observed on the inspected page, describe only what was observed.

GOOD:
"Placeholder content detected in visible page text."

NOT SUPPORTED:
"Placeholder content present on the production site."

5. Separate observation from inference.

The evidence field must describe what was directly observed.

The reasoning field may explain why the observation could represent a QA concern, but must not introduce unsupported facts.

6. When analyzing form controls such as select dropdowns, inspect the structured control data carefully.

Do not claim that one option replaces another when both options are present.

For example, when the same dropdown contains both:
- "Ecuador"
- "Equador"

the evidence supports saying that both entries are present and that "Equador" appears to be an additional misspelled option.

It does NOT support saying that "Ecuador" was replaced by "Equador".

7. When reporting a problem involving a form control, identify the control using its supplied label, name, or id whenever available.

8. The supplied knownFindings describe issues already observed earlier in this run.

- Prioritize genuinely new issues.
- Do not emit an already-known issue merely because it appears again.
- Continue reporting a genuinely distinct issue even when its wording resembles a known finding.
- When the current page supplies materially useful additional evidence for a known finding, you may report that evidence and set "knownFindingReference" to the exact supplied known-N reference.
- For a genuinely new finding, set "knownFindingReference" to null.
- A knownFindingReference is only an advisory relationship hint. Deterministic runtime matching will validate it.

Materially useful additional evidence includes a new affected page, direct structured-target evidence, or evidence that could strengthen or challenge the prior verification outcome.

8A. Every finding MUST include a "relatedRuleCode" field.

- Set relatedRuleCode to the exact code of one supplied ruleBasedFindings item only when the model observation repeats that same narrow targetless assertion on this page.
- When relatedRuleCode is non-null, copy that rule finding's title and evidence exactly and set evidenceTarget, presentationTarget, structuredIdentity, and accessibilityDefectBasis to null. Runtime requires this exact assertion identity.
- Otherwise set relatedRuleCode to null.
- Do not infer a relationship from similar wording alone.
- relatedRuleCode is advisory. It does not make model evidence deterministic or verification-capable.
- Never invent a rule code that is not present in the supplied ruleBasedFindings.

9. Every finding MUST include an "evidenceTarget" field.

Use evidenceTarget only when the supplied structured evidence identifies a UI element precisely enough for automated evidence capture.

Supported machine-readable evidence targets are:

{
  "kind": "select-option",
  "controlLabel": "Visible label or null",
  "controlName": "HTML name attribute or null",
  "controlId": "HTML id attribute or null",
  "optionText": "Exact option text"
}

For a select-option target:

- Copy controlLabel, controlName, and controlId from the supplied structured select evidence.
- Do not invent values that are not supplied.
- Use null when a particular identifier is unavailable.
- optionText must exactly match the relevant option text in the supplied evidence.
- Use this target only when the finding concerns a specific option inside a specific select control.

For an eligible informational disclosure:

{
  "kind": "disclosure-state",
  "controlId": "Exact observed control id",
  "accessibleName": "Exact observed accessible name",
  "controlledRegionId": "Exact observed aria-controls region id",
  "desiredState": "expanded" | "collapsed"
}

For a disclosure-state target:

- Use it only when the supplied structured disclosure has eligibleForDisclosureAction=true.
- Copy controlId, accessibleName, and ariaControls exactly.
- Set controlledRegionId to the exact single ariaControls value.
- Use the smallest state change that can investigate the candidate.
- Do not use this target for a generic button, link, menu, dialog, tab, form control, filter, or ineligible disclosure.
- Do not claim the interaction failed before deterministic investigation has run.

For an eligible conventional tab:

{
  "kind": "tab-state",
  "controlId": "Exact observed tab control id",
  "accessibleName": "Exact observed accessible name",
  "tabListId": "Exact observed role=tablist id",
  "controlledPanelId": "Exact observed aria-controls panel id",
  "desiredState": "selected"
}

For a tab-state target:

- Use it only when the supplied structured tab has eligibleForTabAction=true.
- Copy controlId, accessibleName, tabListId, and ariaControls exactly.
- Set controlledPanelId to the exact single ariaControls value.
- desiredState must be "selected".
- Use it only to investigate the content revealed by one exact conventional tab.
- Do not use this target for links, navigation, menus, accordions, generic buttons, forms, or ineligible tabs.
- Do not claim the interaction failed before deterministic investigation has run.

Example:

If the evidence contains a Country select with both "Ecuador" and "Equador", a valid evidence target for the misspelled option is:

{
  "kind": "select-option",
  "controlLabel": "Country",
  "controlName": "country",
  "controlId": "country",
  "optionText": "Equador"
}

When the finding cannot be tied to a currently supported machine-readable UI target, return:

"evidenceTarget": null

Do NOT force an evidence target when the evidence does not support one.

9A. Every finding MUST include a "presentationTarget" field.

This target is used only to create focused human-facing screenshot evidence.
It never changes finding verification and it is never executed as an action.

Use a presentation target only when the finding concerns exact text supplied in
one of these structured collections:

- content.headings
- content.links
- content.buttons

Supported shape:

{
  "kind": "visible-text",
  "elementKind": "heading" | "link" | "button",
  "text": "Exact supplied visible text"
}

Copy text exactly. Do not create a target from an inferred label, a partial
substring, flattened bodyText, a URL, or text that is not present in the
matching structured collection.

Use the same exact target for repeated instances of the same supplied heading,
link, or button text. The presentation layer will deterministically group and
cap focused images.

When no exact supported visible-text target exists, return:

"presentationTarget": null

Do not force or guess a presentation target.

9B. Every finding MUST include a "structuredIdentity" field.

This field provides stable, non-actionable identity for an issue directly
observed in an accessibility name on one supplied tab or disclosure control.
It is not an action and does not make a finding verified.

Supported shape:

{
  "mechanism": "unresolved-token" | "unexpected-value" | "duplicate-value" | "missing-value" | "state-mismatch" | "accessibility-semantics" | "other",
  "observedValue": "Exact supplied accessibleName",
  "source": "accessible-name",
  "subject": {
    "kind": "semantic-control",
    "controlType": "tab" | "disclosure",
    "controlId": "Exact supplied controlId",
    "componentId": "Exact tabListId or ariaControls, or null",
    "locator": null
  }
}

- Copy observedValue and controlId exactly from content.tabs or
  content.disclosures.
- For a tab, copy tabListId into componentId when present.
- For a disclosure, copy ariaControls into componentId when present.
- Set locator to null; no selector is supplied to the reasoning layer.
- Use the narrowest mechanism that describes the observed defect.
- Generated title, evidence, reasoning, and suggestedCheck prose are never
  finding identity.
- Do not use this field for visible text, flattened body text, a generic
  component, or a control without an exact non-empty controlId.
- Otherwise return "structuredIdentity": null.

9B.1. Every finding MUST include an "accessibilityDefectBasis" field.

For every accessibility finding, this field must explain the concrete defect
basis, not merely repeat a neutral accessibility property.

Supported shape:

{
  "expectation": "The specific accessibility expectation relevant to this control",
  "conflict": "How the supplied observations concretely conflict with that expectation",
  "supportingEvidence": [
    {
      "controlType": "tab" | "disclosure",
      "controlId": "Exact supplied controlId",
      "property": "visible-text" | "accessible-name" | "aria-expanded" | "aria-selected" | "aria-controls" | "controlled-content-exists" | "controlled-content-visible",
      "value": "Exact supplied value, boolean, or null"
    }
  ]
}

- Copy every supporting-evidence fact exactly from one supplied tab or
  disclosure.
- A neutral property is not a defect basis by itself. An accessible name such
  as "Product", role=button, aria-expanded=false, an element id, or an
  accessibility-tree entry does not establish a problem.
- The supplied facts must demonstrate a concrete omission, invalid
  relationship, or conflicting condition. Examples include a required name or
  state being absent, visible text materially disagreeing with the accessible
  name, or exposed state disagreeing with controlled-content visibility.
- Generic references to WCAG, WAI-ARIA, assistive technology, screen readers,
  labeling, or semantics do not supply a defect basis.
- Model confidence does not supply a defect basis.
- Do not invent an expected value or a conflicting observation.
- If the evidence supplies only a neutral property and no concrete conflict,
  do not return an accessibility finding.
- For every non-accessibility finding, return
  "accessibilityDefectBasis": null.

9C. Every finding MUST include a "technicalEvidenceReferences" field.

This field links a technical finding to exact deterministic browser evidence
supplied in browserDiagnostics.

For a technical finding about one or more failed requests or a referenced CORS
console diagnostic:

- Set technicalEvidenceReferences to the exact non-null
  technicalObservationReference values for every deterministic diagnostic
  group described by that finding.
- Copy references exactly; never invent or modify one.
- Include only references actually described by the finding.
- Different diagnostic mechanisms, origins, or resources may have different
  references even when they share a generated title.
- Runtime validates the references and may normalize a heterogeneous bundle
  into separate homogeneous technical observations.
- A reference provides identity only; it does not make the finding verified.

For console-only technical findings without an exact supplied
technicalObservationReference, other unreferenced diagnostics, and every
non-technical finding, return:

"technicalEvidenceReferences": null

10. It is completely acceptable and preferred to return zero findings when the evidence does not support an issue.

11. Treat findings as candidate QA issues requiring appropriate verification, not automatically as confirmed defects.

12. Do not flag normal marketing language merely because it is subjective or promotional.

13. Do not report grammar or wording preferences unless there is a clear typo, malformed text, contradiction, placeholder content, or objectively confusing wording.

14. Do not claim that a link or button is broken unless the supplied evidence supports that conclusion.

15. Browser diagnostic entries already classified as ignored noise have been excluded and must not be inferred as issues.

16. Do not claim visual layout problems. No screenshot or visual evidence is being provided in this analysis.

17. Prefer a small number of strong, evidence-grounded findings over speculative observations.

18. Confidence should reflect the strength of the supplied evidence:
   - high: the evidence directly demonstrates the concern
   - medium: the evidence strongly suggests the concern but verification is still needed
   - low: the concern is plausible but requires significant further verification

19. Severity should reflect likely user impact, not how interesting the issue seems.

Allowed finding categories:
- content
- navigation
- interaction
- visual
- accessibility
- consistency
- technical
- other

Allowed severities:
- high
- medium
- low

Allowed confidence values:
- high
- medium
- low

Return ONLY valid JSON with this exact structure:

{
  "findings": [
    {
      "knownFindingReference": null,
      "relatedRuleCode": null,
      "category": "content",
      "severity": "low",
      "confidence": "high",
      "title": "Concise finding title",
      "evidence": "Specific directly observed evidence from the supplied data",
      "reasoning": "Why the observed evidence may represent a QA issue, without adding unsupported facts",
      "suggestedCheck": "A concrete follow-up verification step",
      "evidenceTarget": {
        "kind": "select-option",
        "controlLabel": "Country",
        "controlName": "country",
        "controlId": "country",
        "optionText": "Equador"
      },
      "presentationTarget": null,
      "structuredIdentity": null,
      "accessibilityDefectBasis": null,
      "technicalEvidenceReferences": null
    }
  ],
  "summary": "Concise summary of the exploratory QA review"
}

For a finding with no supported machine-readable target, use:

{
  "knownFindingReference": null,
  "relatedRuleCode": null,
  "category": "content",
  "severity": "low",
  "confidence": "high",
  "title": "Concise finding title",
  "evidence": "Specific directly observed evidence",
  "reasoning": "Why it may represent a QA issue",
  "suggestedCheck": "A concrete verification step",
  "evidenceTarget": null,
  "presentationTarget": null,
  "structuredIdentity": null,
  "accessibilityDefectBasis": null,
  "technicalEvidenceReferences": null
}

When there are no evidence-grounded candidate issues, return:

{
  "findings": [],
  "summary": "No evidence-grounded exploratory QA issues were identified."
}

PAGE EVIDENCE:

${JSON.stringify(evidence, null, 2)}
`.trim();
}
