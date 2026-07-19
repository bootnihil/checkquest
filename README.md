# Web QA Agent

An experimental AI-assisted QA agent for safely exploring public websites, collecting browser evidence, identifying candidate issues, and generating structured QA reports.

The project combines **Playwright** for deterministic browser interaction with **Gemini** for evidence-grounded exploratory QA reasoning.

The core design principle is simple:

> **AI may reason creatively about what could be wrong. Browser execution and safety boundaries remain deterministic.**

---

## What It Does

The agent can currently:

- Open a configured public website with Playwright.
- Restrict navigation to explicitly approved domains.
- Discover safe internal navigation links.
- Use Gemini to choose representative pages to inspect.
- Track visited URLs and avoid repeatedly revisiting the same page.
- Perform bounded multi-page exploration.
- Collect page observations such as:
  - HTTP status
  - page title
  - headings
  - visible body text
  - links
  - buttons
  - select controls and their options
- Collect browser diagnostics:
  - console errors
  - failed network requests
- Classify failed requests as:
  - actionable
  - needs review
  - expected diagnostic noise
- Run deterministic page-health checks.
- Use Gemini for broader evidence-grounded exploratory QA analysis.
- Produce structured candidate findings with:
  - category
  - severity
  - confidence
  - evidence
  - reasoning
  - suggested verification step
- Capture screenshots when something requires investigation.
- Capture targeted evidence for supported UI elements.
- Generate both JSON and human-readable Markdown reports.

The project is designed to evolve toward a reusable autonomous exploratory testing agent rather than a collection of site-specific automated test cases.

---

## Example: A Real Issue Found by the Agent

During a controlled exploratory run against the Aidoc public website, the agent inspected the **Solutions** page.

The agent:

1. Extracted the page's visible content and form controls.
2. Inspected the structured options of the `Country` dropdown.
3. Detected that the same dropdown contained both:

   - `Ecuador`
   - `Equador`

4. Gemini identified `Equador` as a likely additional misspelled country option.
5. The finding was returned as:

   - **Category:** Content
   - **Severity:** Low
   - **Confidence:** High

6. The AI also returned a machine-readable evidence target identifying the exact dropdown and option.
7. Playwright located the control, verified that `Equador` existed, selected it locally without submitting the form, and captured focused screenshot evidence.

The resulting finding was essentially:

> **Possible misspelling in country list**
>
> The Country dropdown contains both `Ecuador` and `Equador`. The presence of `Equador` alongside the correctly spelled `Ecuador` suggests a likely typographical or data-quality issue.

This is an example of the intended workflow:

```text
Explore
   ↓
Observe
   ↓
Extract structured evidence
   ↓
Reason about possible QA issues
   ↓
Validate the evidence target
   ↓
Capture focused evidence
   ↓
Report a reviewable candidate finding
```

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

The intention is that additional ordinary public websites can be added without rewriting the agent engine.

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
- Potentially destructive actions are not available to the AI.

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
Trigger client validation ✓

Submit contact form       ✗
Create account            ✗
Make purchase             ✗
Delete or modify data     ✗
Trigger destructive API   ✗
```

### AI reasoning

Gemini is used for tasks where rigid rules are less useful, such as:

- choosing which representative page to inspect;
- identifying suspicious or inconsistent content;
- detecting likely typos or placeholder content;
- reasoning about structured form controls;
- producing candidate QA findings;
- suggesting appropriate follow-up verification.

AI findings are treated as **candidate issues**, not automatically confirmed defects.

Every finding must be grounded in supplied evidence.

Returning zero findings is explicitly considered a valid result.

---

## Evidence Model

The agent keeps different evidence types separate.

### Rule-based findings

Deterministic checks currently include issues such as:

- HTTP 4xx or 5xx responses;
- empty page titles;
- missing primary headings;
- obvious error-page indicators.

### Browser diagnostics

The agent collects:

- browser console errors;
- failed network requests.

Known telemetry and tracking noise can be classified separately rather than appearing as user-facing defects.

For example:

```text
Cloudflare RUM telemetry      → ignored noise
DoubleClick tracking          → ignored noise
YouTube telemetry             → ignored noise
Failed main JavaScript bundle → actionable
Unknown failed image          → needs review
```

Raw evidence is preserved even when classified as noise.

### Exploratory QA findings

Gemini receives a compact evidence package rather than raw HTML.

This can include:

- page metadata;
- headings;
- visible body text;
- links;
- buttons;
- structured select controls;
- relevant browser diagnostics;
- existing rule-based findings.

The model must return validated structured JSON.

Example:

```json
{
  "category": "content",
  "severity": "low",
  "confidence": "high",
  "title": "Possible misspelling in country list",
  "evidence": "The Country dropdown contains both Ecuador and Equador.",
  "reasoning": "Equador appears to be an additional misspelled option.",
  "suggestedCheck": "Verify the intended country list and correct or remove the misspelled entry."
}
```

---

## Targeted Evidence

The agent can associate certain AI findings with machine-readable evidence targets.

The first implemented target type is:

```text
select-option
```

For example:

```json
{
  "kind": "select-option",
  "controlLabel": "Country",
  "controlName": "country",
  "controlId": "country",
  "optionText": "Equador"
}
```

Playwright can then:

1. locate the exact select control;
2. verify that the option exists;
3. select the option locally;
4. scroll the control into view;
5. capture a focused screenshot.

This produces much more useful evidence than an arbitrary full-page screenshot.

Additional target types are planned.

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
- agent navigation decisions;
- HTTP/page observations;
- browser diagnostics;
- diagnostic classifications;
- deterministic findings;
- AI exploratory QA candidate findings;
- severity and confidence;
- supporting evidence;
- suggested verification steps;
- screenshot paths.

The JSON report preserves the same information in a machine-readable format.

---

## Current Exploration Flow

The main multi-page agent currently follows approximately this flow:

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
Capture evidence when required
        ↓
Discover additional links
        ↓
Continue until bounded exploration limit
        ↓
Generate JSON + Markdown reports
```

---

## Current Limitations

This project is actively being developed.

It does **not yet** perform unrestricted autonomous exploratory testing.

Current limitations include:

- The agent primarily observes pages rather than actively testing many interactive elements.
- A general planner/action loop has not yet been implemented.
- Form submissions and backend-changing actions are intentionally disabled.
- Client-side boundary testing of text fields is not yet implemented.
- Most targeted evidence types are not yet supported.
- Native browser dropdown popups are difficult to capture directly in headless mode.
- Visual AI analysis of screenshots is not yet part of the exploratory reasoning loop.
- Exploration depth is still limited compared with a human tester.
- Scheduled CI execution is not yet configured.
- Reports are not yet compared across runs.
- Findings are not yet automatically deduplicated between runs.

The current agent is best described as an **AI-assisted autonomous website inspector evolving toward a constrained exploratory tester**.

---

## Roadmap

### Safe interaction tools

Add generic Playwright tools for actions such as:

- fill field;
- clear field;
- blur field;
- open dropdown;
- select option;
- expand accordion;
- switch tab;
- open and close modal;
- hover;
- scroll;
- inspect dynamic validation.

### Planner/action loop

Allow the AI to form and execute bounded test hypotheses:

```text
Observe page
    ↓
Identify test opportunity
    ↓
Choose approved action
    ↓
Execute through Playwright
    ↓
Observe result
    ↓
Reason about result
    ↓
Continue or finish
```

Example:

```text
Observe Email field
        ↓
Hypothesis: format validation exists
        ↓
Enter invalid value
        ↓
Blur field
        ↓
Observe validation message
        ↓
Enter valid value
        ↓
Compare behavior
```

### Boundary and validation testing

Safely explore client-side rules using:

- empty values;
- minimum/maximum lengths;
- long strings;
- special characters;
- Unicode;
- leading/trailing whitespace;
- malformed email formats;
- unexpected but non-destructive input.

### Richer targeted evidence

Support targets such as:

- text fields;
- buttons;
- links;
- validation messages;
- custom dropdowns;
- modals;
- tabs;
- accordions;
- page sections.

### Deeper exploration

Improve page discovery beyond top-level navigation and allow the agent to build a richer map of the site.

### Scheduled monitoring

Run automatically through GitHub Actions or another CI environment.

Store reports and screenshots as CI artifacts.

### Historical comparison

Compare new runs with previous runs to identify:

- new findings;
- unchanged findings;
- resolved findings;
- newly failing pages.

### Smarter reporting

Separate:

```text
Confirmed objective failures
High-confidence candidate issues
Needs-human-review observations
Ignored diagnostic noise
```

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

Install the Playwright Chromium browser if needed:

```bash
npx playwright install chromium
```

Set the Gemini API key as an environment variable.

On Windows:

```cmd
setx GEMINI_API_KEY "your-api-key"
```

Open a new terminal after using `setx`.

The API key must never be committed to the repository.

---

## Running Tests

Run the standard Playwright test suite:

```bash
npm test
```

---

## Running the Agent

Run the configured Aidoc site:

```bash
npm run agent:run -- aidoc
```

The multi-page agent will remain within configured safety boundaries and exploration limits.

---

## Development Checks

The repository contains small focused diagnostic programs used while developing individual agent capabilities.

Examples include checks for:

```text
browser diagnostics
diagnostic classification
URL visit tracking
page-content extraction
Gemini connectivity
navigation decisions
page evaluation
screenshot capture
targeted screenshot evidence
exploratory QA schema validation
exploratory QA analysis
```

These checks allow individual pieces of the agent to be tested independently before being connected to the autonomous workflow.

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

The long-term goal is to keep website-specific logic minimal and make the core agent reusable across ordinary public websites.

---

## Project Philosophy

The goal of this project is not to replace deterministic automated testing with an LLM.

Traditional automated tests are excellent when expected behavior is known:

```text
Given X
When Y
Then Z
```

Exploratory testing addresses a different question:

> What might be wrong here that nobody explicitly wrote a test for?

This project explores how the two approaches can complement each other:

```text
Deterministic automation
        +
Controlled browser exploration
        +
AI-assisted reasoning
        +
Evidence requirements
        +
Strict safety boundaries
```

The intended result is an agent that can independently investigate a website, notice potentially meaningful problems, gather useful evidence, and present findings for human review — without giving an LLM unrestricted control over browser actions.

---

## Status

**Experimental / active development**

The agent already supports real browser exploration, structured evidence collection, AI-assisted QA analysis, and targeted evidence capture.

The next major development phase is a **safe planner/action loop** that will allow the agent to actively test interactive page behavior and client-side boundaries rather than only inspecting existing page state.