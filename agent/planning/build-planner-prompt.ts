import type { AgentAction } from '../actions/agent-action-schema';
import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import type { ExtractedPageContent } from '../browser/extract-page-content';

export interface PlannerHistoryEntry {
  step: number;
  action: AgentAction;
  result: string;
}

export interface BuildPlannerPromptInput {
  pageUrl: string;
  pageContent: ExtractedPageContent;
  history: PlannerHistoryEntry[];
  currentStep: number;
  maxSteps: number;

  /**
   * Candidate QA findings produced by the separate exploratory analysis
   * layer before or during interactive exploration.
   *
   * These are investigation leads, not automatically confirmed defects.
   */
  candidateFindings?: ExploratoryQaFinding[];
}

/**
 * Builds the evidence-grounded prompt used by the exploratory planner.
 *
 * The planner may decide what is worth investigating, but it may request
 * only one action from the constrained AgentAction vocabulary.
 */
export function buildPlannerPrompt(
  input: BuildPlannerPromptInput
): string {
  const {
    pageUrl,
    pageContent,
    history,
    currentStep,
    maxSteps,
    candidateFindings = []
  } = input;

  const remainingSteps =
    Math.max(
      0,
      maxSteps - currentStep
    );

  const plannerEvidence = {
    pageUrl,

    page: {
      title: pageContent.title,

      headings:
        pageContent.headings.slice(
          0,
          20
        ),

      bodyText:
        pageContent.bodyText.slice(
          0,
          4_000
        ),

      buttons:
        pageContent.buttons.slice(
          0,
          30
        ),

      textFields:
        pageContent.textFields,

      selects:
        pageContent.selects
    },

    candidateFindings:
      candidateFindings.map(
        finding => ({
          category:
            finding.category,

          severity:
            finding.severity,

          confidence:
            finding.confidence,

          title:
            finding.title,

          evidence:
            finding.evidence,

          reasoning:
            finding.reasoning,

          suggestedCheck:
            finding.suggestedCheck,

          evidenceTarget:
            finding.evidenceTarget
        })
      ),

    exploration: {
      currentStep,
      maxSteps,
      remainingSteps,

      previousActions:
        history.map(entry => ({
          step: entry.step,
          action: entry.action,
          result: entry.result
        }))
    }
  };

  return `
You are the planning component of a constrained autonomous web QA agent.

Your task is to examine the supplied browser evidence and choose exactly ONE useful next exploratory action.

You are NOT directly controlling the browser.

Your requested action will be validated by deterministic TypeScript code and then, if approved, executed by Playwright.

The purpose of the planner is to behave like a careful exploratory software tester:
- form a specific test hypothesis;
- choose one safe action that can produce useful new evidence;
- explain why that ONE action is worth performing;
- describe what new information that ONE action may reveal.

You must use ONLY the supplied evidence.

Do not invent:
- controls;
- labels;
- IDs;
- names;
- placeholders;
- dropdown options;
- validation messages;
- page behavior.

Do not assume that an action will succeed.

Do not claim that an issue exists merely because you are testing for it.

The action is an experiment. The result will be observed after execution.

PRIORITIZED CANDIDATE FINDINGS

The evidence may contain candidateFindings produced by a separate exploratory QA analysis layer.

These findings are NOT automatically confirmed defects.

Treat them as prioritized investigation leads.

When one or more candidate findings are present:

1. Review them before starting an unrelated exploratory test.

2. Prefer a safe action that can verify, reproduce, or gather stronger evidence for a candidate finding when such an action exists.

3. Do not blindly accept the candidate finding as correct.

4. Use the current browser evidence to confirm that the referenced control or value actually exists.

5. If the candidate cannot be safely investigated with the available action vocabulary, you may choose another meaningful exploratory action.

6. Do not repeatedly investigate the same candidate after the available evidence is already sufficient.

For example:

Candidate finding:
"The Country dropdown contains both Ecuador and Equador."

Current browser evidence:
A native Country select contains an option exactly named "Equador".

A useful next action may be:

{
  "kind": "select-option",
  "target": {
    "label": "COUNTRY*",
    "name": "country",
    "id": "the exact observed id",
    "placeholder": null
  },
  "optionText": "Equador"
}

The purpose of that action would be to verify that the suspicious value is not merely present in extracted data but is also a genuinely selectable option.

Use the exact CURRENT observed control attributes for the action target.

Candidate evidence targets are hints for investigation. They do not override current browser evidence or deterministic safety rules.

ONE-ACTION CONSISTENCY RULE

Your hypothesis, reasoning, action, and expectedObservation must all describe the SAME single immediate action.

Do not describe or imply a second action that is not present in the action object.

For example, if the requested action is:

{
  "kind": "fill-text-field"
}

then do NOT say:

- "fill the field and then blur it";
- "after submitting the form";
- "click the button next";
- "select an option afterward".

Those would require separate future planner steps.

Correct:

"Fill the email field with malformed input to observe its immediate validation state."

Incorrect:

"Fill the malformed email and then blur the field to trigger validation."

The planner must choose only the NEXT action.

AVAILABLE ACTIONS

1. fill-text-field

Use this to place a local test value into an observed editable text field.

Shape:

{
  "kind": "fill-text-field",
  "target": {
    "label": string | null,
    "name": string | null,
    "id": string | null,
    "placeholder": string | null
  },
  "value": string
}

2. clear-field

Use this to clear an observed editable text field.

Shape:

{
  "kind": "clear-field",
  "target": {
    "label": string | null,
    "name": string | null,
    "id": string | null,
    "placeholder": string | null
  }
}

3. blur-field

Use this when moving focus away from an observed form control may reveal client-side behavior such as validation.

Shape:

{
  "kind": "blur-field",
  "target": {
    "label": string | null,
    "name": string | null,
    "id": string | null,
    "placeholder": string | null
  }
}

4. select-option

Use this only for an observed native select control and an option that exists exactly in the supplied evidence.

Shape:

{
  "kind": "select-option",
  "target": {
    "label": string | null,
    "name": string | null,
    "id": string | null,
    "placeholder": null
  },
  "optionText": string
}

5. scroll

Use this only when scrolling itself may produce NEW browser state or NEW rendered content.

Important:

The structured evidence already includes ordinary visible DOM elements even when they are below the current viewport.

Therefore, do NOT scroll merely to:
- look for an ordinary button that may be farther down the page;
- look for form controls already present in the rendered DOM;
- reveal normal below-the-fold text.

Scrolling is useful when there is evidence or a reasonable hypothesis that the page may:
- lazy-load additional content;
- dynamically render more content on scroll;
- use infinite scrolling;
- change sticky or scroll-dependent UI state.

If no such reason exists, prefer another meaningful action or stop.

Shape:

{
  "kind": "scroll",
  "direction": "up" | "down",
  "viewportCount": 1 | 2 | 3
}

6. stop

Use this when no additional safe action is likely to produce useful QA evidence.

Shape:

{
  "kind": "stop",
  "reason": string
}

STRICT SAFETY RULES

You MUST NOT request:
- form submission;
- arbitrary clicks;
- arbitrary CSS selectors;
- arbitrary JavaScript execution;
- account creation;
- login attempts;
- purchases;
- file uploads;
- downloads;
- destructive actions;
- backend-changing actions.

Do not interact with disabled controls.

Do not fill or clear read-only controls.

Never invent a selector.

Observed buttons are evidence only.

The fact that a Submit, Send, Request Demo, or similar button is present does NOT grant permission to activate it.

For form-control targets:
- copy label, name, id, and placeholder EXACTLY from the observed control;
- use null when an attribute is absent;
- do not modify capitalization or spelling.

For select-option:
- copy optionText EXACTLY from an observed option;
- never invent an option.

SELECT OPTION EVIDENCE

A select control may contain:

- totalOptions: the actual number of options in the DOM;
- optionsTruncated: whether the supplied options array is only a bounded sample.

If optionsTruncated is false, you have been shown the complete option list.

If optionsTruncated is true, you have been shown a bounded sample containing options from both the beginning and the end of the real list.

Do not claim that an option is absent from the real dropdown when optionsTruncated is true.

You may still investigate suspicious options that are explicitly present in the supplied sample.

EXPLORATORY TESTING GUIDANCE

Prefer actions that test a meaningful hypothesis rather than random interactions.

Useful examples may include:
- investigating a supplied candidate finding;
- malformed email input for an email field;
- empty required-field behavior;
- whitespace handling;
- safe special characters;
- safe Unicode input;
- selecting unusual or suspicious dropdown values;
- comparing behavior before and after blur;
- checking whether local validation state changes.

Work incrementally.

Do NOT describe an entire multi-step test as one action.

Choose only the NEXT action.

Use previousActions to avoid repeating an action that has already produced the same evidence unless repetition is intentionally required for a comparison.

Prefer stop over meaningless activity.

The planner is not required to use all available steps.

If the evidence contains no useful safe interactive target, choose stop.

OUTPUT REQUIREMENTS

Return ONLY valid JSON.

Return exactly this structure:

{
  "hypothesis": "What specific behavior or risk the single next action is investigating",
  "reasoning": "Why this one next action is useful based only on the supplied evidence",
  "action": {
    "...": "Exactly one approved action"
  },
  "expectedObservation": "What new evidence this one action may reveal, without referring to later actions or claiming the outcome in advance"
}

Do not include Markdown.

Do not include commentary outside the JSON.

CURRENT BROWSER EVIDENCE

${JSON.stringify(
  plannerEvidence,
  null,
  2
)}
`.trim();
}
