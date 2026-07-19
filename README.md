# Web QA Agent

An experimental AI-assisted web QA agent built with **TypeScript, Playwright, and Gemini** for safe website exploration, evidence collection, exploratory QA reasoning, and structured issue reporting.

The project explores a simple idea:

> **AI can reason creatively about what might be wrong, while browser execution, permissions, and safety boundaries remain deterministic.**

Rather than relying only on predefined automated test cases, the agent is being designed to independently inspect websites, identify potentially meaningful QA concerns, gather supporting evidence, and present reviewable findings.

---

## What It Does

The agent currently supports:

- Opening configured public websites using Playwright.
- Restricting navigation to explicitly approved domains.
- Discovering safe internal navigation links.
- Using Gemini to choose representative pages to inspect.
- Tracking visited URLs to avoid repeatedly revisiting the same page.
- Performing bounded multi-page exploration.
- Extracting structured page content including:
  - page title
  - headings
  - visible body text
  - links
  - buttons
  - select controls
  - select options
- Collecting browser diagnostics:
  - console errors
  - failed network requests
- Classifying failed requests as:
  - actionable
  - needs review
  - expected diagnostic noise
- Running deterministic page-health checks.
- Using Gemini for broader evidence-grounded exploratory QA analysis.
- Producing structured candidate findings containing:
  - category
  - severity
  - confidence
  - evidence
  - reasoning
  - suggested verification step
- Generating machine-readable evidence targets for supported UI elements.
- Capturing full-page screenshots when needed.
- Capturing focused evidence for supported UI findings.
- Generating both JSON and human-readable Markdown reports.

The project is intended to evolve into a reusable constrained autonomous exploratory testing agent rather than a collection of site-specific automated tests.

---

## Example: A Real Issue Found by the Agent

During a controlled exploratory run against the Aidoc public website, the agent inspected the **Solutions** page.

The agent:

1. Loaded the page with Playwright.
2. Extracted visible content and structured form controls.
3. Inspected the available options inside the `Country` dropdown.
4. Detected that the same dropdown contained both:

   - `Ecuador`
   - `Equador`

5. Gemini identified `Equador` as a likely additional misspelled country option.
6. The finding was returned with:

   - **Category:** Content
   - **Severity:** Low
   - **Confidence:** High

7. Gemini also returned a machine-readable evidence target identifying the exact dropdown and option.
8. Playwright located the control, verified that `Equador` existed, selected it locally without submitting the form, and captured focused screenshot evidence.

The resulting finding was essentially:

> **Possible misspelling in country list**
>
> The Country dropdown contains both `Ecuador` and `Equador`. The presence of `Equador` alongside the correctly spelled `Ecuador` suggests a likely typographical or data-quality issue.

This demonstrates the intended workflow:

```text
Explore
   ↓
Observe
   ↓
Extract structured evidence
   ↓
Reason about possible QA issues
   ↓
Return a machine-readable evidence target
   ↓
Verify the target with Playwright
   ↓
Capture focused evidence
   ↓
Generate a reviewable candidate finding
```

The important distinction is that Gemini did not directly control the browser.

The AI identified the likely issue and described where the evidence could be found. Playwright then deterministically verified and interacted with the approved target.

---

## Architecture

The project separates generic agent infrastructure from site-specific configuration.

```text
agent/
├── ai/
│   └── Gemini request handling, retries, and timeouts
│
├── analysis/
│   ├── deterministic page evaluation
│   ├── diagnostic classification
│   ├── exploratory QA schemas
│   ├── evidence-grounded prompt construction
│   └── Gemini exploratory QA analysis
│
├── browser/
│   ├── navigation inspection
│   ├── safe page visits
│   ├── browser diagnostic collection
│   ├── structured page-content extraction
│   ├── full-page screenshot capture
│   └── targeted UI evidence capture
│
├── config/
│   ├── AI configuration
│   └── generic site configuration types
│
├── decisions/
│   └── AI-assisted navigation decisions
│
├── exploration/
│   └── visited-page tracking and URL normalization
│
├── reporting/
│   ├── report models
│   ├── JSON reports
│   └── Markdown reports
│
└── sites/
    ├── site registry
    └── individual site configurations
```

The goal is to keep the agent engine generic.

A website is represented primarily through configuration rather than hardcoded test logic.

For example:

```typescript
{
  id: 'aidoc',
  name: 'Aidoc commercial website',
  startUrl: 'https://www.aidoc.com/',
  allowedHosts: [
    'aidoc.com',
    'www.aidoc.com'
  ],
  maxPages: 5,
  maxAgentSteps: 6,
  allowFormSubmission: false
}
```

The intention is that additional ordinary public websites can be added without rewriting the core agent.

---

## Technology Stack

The project currently uses:

- **TypeScript**
- **Node.js**
- **Playwright**
- **Gemini API**
- **Zod**
- **GitHub Actions**

TypeScript is used throughout the agent architecture for typed site configuration, browser observations, diagnostic evidence, AI response schemas, report models, and machine-readable evidence targets.

Playwright handles deterministic browser execution.

Gemini is used for reasoning tasks where rigid predefined rules are less useful.

Zod validates AI-generated structured responses before they are accepted by the agent.

---

## Deterministic Safety vs AI Reasoning

The project deliberately separates two responsibilities.

### Deterministic safety controls

Code decides what the agent is allowed to do.

Current boundaries include:

- Only explicitly approved hosts may be visited.
- Arbitrary AI-generated URLs are not accepted.
- Exploration is bounded by page and step limits.
- Previously visited URLs are tracked.
- Form submission is disabled.
- Potentially destructive actions are not exposed to the AI.

Examples of intended safe actions:

```text
Open page                 ✓
Follow approved link      ✓
Scroll                    ✓
Open accordion            ✓
Switch tabs               ✓
Open dropdown             ✓
Select a local option     ✓
Fill a field locally      ✓
Clear a field             ✓
Trigger client validation ✓

Submit contact form       ✗
Create account            ✗
Make purchase             ✗
Delete or modify data     ✗
Trigger destructive API   ✗
```

### AI reasoning

Gemini is used for tasks such as:

- choosing representative pages to inspect;
- identifying suspicious or inconsistent content;
- detecting likely typos or placeholder content;
- reasoning about structured form controls;
- producing candidate QA findings;
- suggesting follow-up verification;
- identifying machine-readable evidence targets.

AI findings are treated as **candidate issues**, not automatically confirmed defects.

Every finding must be grounded in supplied evidence.

Returning zero findings is explicitly considered a valid result.

---

## Current Exploration Flow

The current multi-page agent approximately follows this process:

```text
Open configured site
        ↓
Collect safe navigation candidates
        ↓
Gemini chooses a representative target
        ↓
Visit approved page
        ↓
Collect browser diagnostics
        ↓
Run deterministic checks
        ↓
Extract structured page content
        ↓
Gemini performs exploratory QA analysis
        ↓
Validate structured AI response
        ↓
Capture evidence when required
        ↓
Discover additional safe links
        ↓
Continue until exploration limit
        ↓
Generate JSON + Markdown reports
```

The current exploration loop is primarily **observe-and-analyze**.

The next major phase is adding a planner/action loop so the agent can safely interact with page elements, observe resulting behavior, and decide what to test next.

---

## Evidence-Grounded Exploratory QA

Gemini receives a compact structured evidence package rather than raw HTML.

Depending on the page, this may include:

- requested URL;
- final URL;
- HTTP status;
- page title;
- headings;
- visible body text;
- links;
- buttons;
- select controls;
- select options;
- relevant browser diagnostics;
- deterministic findings.

Known diagnostic noise is filtered out before the exploratory AI analysis.

For example, requests involving:

```text
Cloudflare RUM telemetry
DoubleClick tracking
YouTube telemetry
```

can be preserved in raw evidence while being excluded from the AI's QA reasoning context.

The exploratory model is explicitly instructed to:

- use only supplied evidence;
- avoid unsupported assumptions;
- avoid inventing visual issues without visual evidence;
- distinguish observation from inference;
- avoid claiming broken behavior without evidence;
- prefer zero findings over speculative findings;
- treat results as candidate QA issues rather than confirmed defects.

---

## Structured AI Findings

Gemini must return validated structured JSON.

A candidate finding contains:

```json
{
  "category": "content",
  "severity": "low",
  "confidence": "high",
  "title": "Possible misspelling in country list",
  "evidence": "The Country dropdown contains both Ecuador and Equador.",
  "reasoning": "Equador appears to be an additional misspelled option.",
  "suggestedCheck": "Verify the intended country list and correct or remove the misspelled entry.",
  "evidenceTarget": {
    "kind": "select-option",
    "controlLabel": "Country",
    "controlName": "country",
    "controlId": "country",
    "optionText": "Equador"
  }
}
```

Responses are validated with Zod before being accepted.

Unsupported values, malformed objects, or unexpected structures are rejected.

---

## Machine-Readable Evidence Targets

Certain findings can contain a machine-readable `evidenceTarget`.

This allows the reasoning layer to communicate:

> I think there is an issue here, and this is the specific UI element that contains the evidence.

The first implemented evidence target is:

```text
select-option
```

Example:

```json
{
  "kind": "select-option",
  "controlLabel": "Country",
  "controlName": "country",
  "controlId": "country",
  "optionText": "Equador"
}
```

Playwright can then independently:

1. locate the exact select control;
2. verify that the option exists;
3. select the option locally;
4. scroll the control into view;
5. capture a focused screenshot.

The AI does not directly provide arbitrary selectors or execute browser commands.

The target is interpreted through deterministic browser tooling.

Additional evidence-target types are planned.

---

## Browser Diagnostics

The agent collects:

- browser console errors;
- failed network requests.

Failed network requests are classified into:

```text
actionable
needs-review
ignored-noise
```

For example:

```text
Cloudflare RUM telemetry      → ignored-noise
DoubleClick tracking          → ignored-noise
YouTube telemetry             → ignored-noise
Failed main JavaScript bundle → actionable
Unknown failed image          → needs-review
```

Raw evidence is preserved even when classified as noise.

This allows the report to remain transparent while preventing known telemetry failures from being presented as user-facing bugs.

---

## Deterministic Findings

The project still uses traditional rule-based QA checks where appropriate.

Current examples include:

- HTTP 4xx or 5xx responses;
- empty page title;
- missing primary headings;
- obvious error-page indicators.

AI analysis complements these checks rather than replacing them.

A typical report therefore separates:

```text
Rule-based findings
Exploratory AI candidate findings
Actionable browser diagnostics
Diagnostics needing review
Ignored diagnostic noise
```

---

## Screenshot Evidence

The agent currently supports two screenshot modes.

### Full-page evidence

A full-page screenshot can be captured when a page contains something requiring investigation.

### Targeted evidence

For supported machine-readable targets, Playwright captures a focused screenshot of the relevant UI control.

For the `Equador` example, the agent:

```text
identified suspicious option
        ↓
returned select-option evidence target
        ↓
located exact Country dropdown
        ↓
verified Equador exists
        ↓
selected Equador locally
        ↓
captured focused screenshot
```

This produces much more useful evidence than a generic full-page screenshot.

The current targeted screenshot shows the offending value selected in the field.

Future evidence improvements may also include structured comparison data showing related values such as:

```text
Ecuador
Equador
```

alongside the screenshot.

---

## Reports

Each run creates a directory under:

```text
agent-results/<RUN-ID>/
```

For example:

```text
agent-results/
└── 2026-07-18T17-14-26-197Z/
    ├── report.json
    ├── report.md
    └── evidence/
        └── page-01-finding-01.png
```

Generated reports are intentionally excluded from Git.

The Markdown report contains:

- run metadata;
- inspected pages;
- navigation decisions;
- HTTP/page observations;
- headings;
- browser diagnostics;
- diagnostic classifications;
- rule-based findings;
- exploratory QA candidate findings;
- severity;
- confidence;
- supporting evidence;
- reasoning;
- suggested verification steps;
- screenshot paths.

The JSON report preserves the same information in machine-readable form.

---

## Adding Another Website

Site-specific configuration lives under:

```text
agent/sites/
```

A new public website can be introduced by defining:

- a unique site ID;
- display name;
- starting URL;
- approved hosts;
- exploration limits;
- interaction permissions.

The site is then registered in the site registry.

The long-term goal is to make adding another ordinary public website close to a configuration-only task.

The project is not intended to guarantee compatibility with every website on the internet.

Sites involving complex authentication, CAPTCHAs, aggressive anti-bot systems, unusual iframe structures, or highly custom UI components may require additional adapters.

---

## Setup

### Requirements

- Node.js
- npm
- Playwright-compatible environment
- Gemini API key

Clone the repository:

```bash
git clone https://github.com/bootnihil/web-qa-agent.git
cd web-qa-agent
```

Install dependencies:

```bash
npm ci
```

Install Chromium for Playwright if needed:

```bash
npx playwright install chromium
```

Configure the Gemini API key as an environment variable.

On Windows:

```cmd
setx GEMINI_API_KEY "your-api-key"
```

Open a new terminal after using `setx`.

The API key must never be committed to the repository.

---

## Running Tests

Run the Playwright test suite:

```bash
npm test
```

The repository includes deterministic Playwright tests alongside the agent infrastructure.

---

## Running the Agent

Run the configured Aidoc site:

```bash
npm run agent:run -- aidoc
```

The agent remains within the site's configured safety boundaries and exploration limits.

---

## Development Checks

The repository also contains focused development checks used to verify individual agent capabilities independently.

These include checks for:

```text
Gemini SDK connectivity
Gemini API connectivity
safe navigation inspection
navigation decisions
approved-link visits
visited-page tracking
page evaluation
browser diagnostics
diagnostic classification
page-content extraction
exploratory QA schema validation
exploratory prompt construction
AI exploratory QA analysis
screenshot capture
screenshot-trigger behavior
targeted UI evidence capture
real-site exploratory integration
```

These small checks allow components to be validated independently before being integrated into the main autonomous workflow.

---

## GitHub Actions

The repository currently includes a deterministic Playwright CI workflow.

On pushes and pull requests to `main`, GitHub Actions:

```text
checks out the repository
        ↓
installs Node.js
        ↓
runs npm ci
        ↓
installs Playwright browsers
        ↓
runs the Playwright test suite
        ↓
uploads the Playwright report
```

A separate scheduled agent workflow is planned for autonomous exploratory runs.

That workflow will eventually:

- run on a schedule;
- use a protected `GEMINI_API_KEY` GitHub secret;
- execute configured website exploration;
- store JSON and Markdown reports;
- upload screenshot evidence as CI artifacts.

---

## Current Limitations

The project is actively being developed.

The agent does **not yet** perform unrestricted autonomous exploratory testing.

Current limitations include:

- The main agent currently focuses more on observation than active interaction.
- A general planner/action loop is not yet implemented.
- Generic text-field boundary testing is not yet implemented.
- Client-side validation exploration is not yet integrated into autonomous runs.
- Form submissions and backend-changing actions are intentionally disabled.
- Only a small number of machine-readable evidence-target types are supported.
- Targeted evidence currently supports select-option findings as the first implementation.
- Native browser dropdown popups are difficult to capture directly in headless mode.
- Visual AI analysis of screenshots is not yet part of the reasoning loop.
- Exploration depth is still more limited than that of a skilled human exploratory tester.
- Scheduled autonomous CI execution is not yet configured.
- Reports are not yet compared across runs.
- Findings are not yet automatically deduplicated between runs.
- The agent does not yet remember historical exploration state between scheduled runs.

The current agent is best described as an:

> **AI-assisted autonomous website inspector evolving toward a constrained exploratory testing agent.**

---

## Next Major Development Phase

The next major development phase is a **safe planner/action loop**.

The goal is to move from:

```text
Observe
    ↓
Analyze
    ↓
Report
```

toward:

```text
Observe
    ↓
Form test hypothesis
    ↓
Choose approved action
    ↓
Execute with Playwright
    ↓
Observe resulting behavior
    ↓
Reason about result
    ↓
Choose next test
    ↓
Continue or finish
```

For example:

```text
Agent observes Email field
        ↓
Hypothesis:
The field may enforce email-format validation
        ↓
Approved action:
Enter malformed email
        ↓
Blur field
        ↓
Observe validation response
        ↓
Enter valid email
        ↓
Compare behavior
        ↓
Generate finding only if evidence supports one
```

The AI will not directly execute browser commands.

Instead, it will choose from a deterministic set of approved tools such as:

```text
fill field
clear field
blur field
open dropdown
select option
expand accordion
switch tab
open modal
close modal
hover
scroll
```

This preserves the project's central safety model:

> **AI decides what is worth investigating. Deterministic code controls what actions are actually allowed.**

---

## Planned Boundary and Validation Testing

Future exploratory capabilities are intended to include safe client-side checks involving:

- empty values;
- minimum lengths;
- maximum lengths;
- unusually long input;
- special characters;
- Unicode;
- leading whitespace;
- trailing whitespace;
- malformed email formats;
- unexpected but non-destructive input.

For public websites, these tests should avoid submitting forms or triggering backend-changing actions.

More aggressive testing could be enabled only when running against explicitly approved test environments.

---

## Roadmap

### Safe interaction tools

Implement reusable Playwright tools for:

- fill field;
- clear field;
- blur field;
- inspect validation state;
- open dropdown;
- select option;
- expand accordion;
- switch tab;
- open and close modal;
- hover;
- scroll.

### Planner/action loop

Allow Gemini to:

```text
observe
→ form hypothesis
→ request approved action
→ receive new evidence
→ reason again
```

### Boundary testing

Add generic strategies for:

- strings;
- numeric fields;
- email fields;
- required fields;
- length limits;
- special characters;
- Unicode;
- whitespace.

### Richer evidence targets

Extend machine-readable evidence targets to include:

- text fields;
- validation messages;
- buttons;
- links;
- custom dropdowns;
- tabs;
- accordions;
- modals;
- page sections.

### Smarter targeted screenshots

Capture evidence that more directly demonstrates the complete finding rather than only the affected control state.

### Deeper site exploration

Improve discovery beyond top-level navigation.

Build a richer map of:

```text
pages
interactive elements
forms
states
previously tested behaviors
```

### Scheduled monitoring

Run exploratory agent jobs through GitHub Actions or another CI environment.

Store reports and screenshot evidence as artifacts.

### Historical comparison

Compare runs to identify:

```text
new findings
unchanged findings
resolved findings
newly failing pages
```

### Finding deduplication

Avoid repeatedly reporting the same known issue across runs.

### Smarter reporting

Clearly separate:

```text
Confirmed objective failures
High-confidence candidate issues
Lower-confidence observations
Diagnostics requiring review
Ignored diagnostic noise
```

---

## Project Philosophy

Traditional automated testing works extremely well when expected behavior is known:

```text
Given X
When Y
Then Z
```

Exploratory testing addresses a different question:

> **What might be wrong here that nobody explicitly wrote a test for?**

This project explores how several approaches can complement one another:

```text
Deterministic automation
        +
Controlled browser exploration
        +
AI-assisted reasoning
        +
Structured evidence
        +
Targeted verification
        +
Strict safety boundaries
```

The goal is not to replace deterministic automation with an LLM.

The goal is to build an agent that can independently investigate a website, notice potentially meaningful problems, gather useful evidence, and present findings for human review—without giving an AI model unrestricted control over browser actions.

---

## Status

**Experimental / active development**

The agent currently supports:

- bounded multi-page browser exploration;
- safe approved-domain navigation;
- structured page and form-control extraction;
- browser diagnostic collection and classification;
- deterministic page-health checks;
- evidence-grounded Gemini exploratory QA analysis;
- validated structured AI findings;
- machine-readable evidence targets;
- conditional screenshot evidence;
- targeted screenshot capture for supported UI elements;
- JSON and Markdown reporting.

The next major development phase is a safe planner/action loop that will allow the agent to form test hypotheses, interact with approved page elements, test client-side validation and boundary conditions, observe resulting behavior, and iteratively decide what to test next.