# Web QA Agent

An experimental **AI-powered exploratory web testing agent** built with **TypeScript, Playwright, and Gemini**.

Instead of following only predefined test cases, the agent can inspect a website, form its own testing hypotheses, perform controlled browser interactions, observe what happens, and decide what to test next.

> **AI decides what is worth investigating. Deterministic code controls what the browser is actually allowed to do.**

---

## Why This Project?

Traditional test automation is excellent at checking known expectations:

```text
Given X
When Y
Then Z
```

But exploratory testing asks a different question:

> **What might be wrong here that nobody explicitly wrote a test for?**

This project explores whether an AI agent can help answer that question safely.

The goal is not to give an LLM unrestricted control over a browser.

Instead:

```text
Observe
   ↓
Form a QA hypothesis
   ↓
Request one approved action
   ↓
Validate it
   ↓
Execute with Playwright
   ↓
Observe what actually happened
   ↓
Reason again
```

---

## What Can It Do Today?

The agent can already:

- explore approved public websites;
- navigate within configured domains;
- inspect page content and form controls;
- collect console and network diagnostics;
- reason about potential QA issues using Gemini;
- generate structured candidate findings;
- capture screenshot evidence;
- interact safely with supported UI controls;
- test text-field and browser validation behavior;
- select native dropdown options;
- maintain history between exploratory steps;
- run a bounded autonomous **observe → plan → act → observe** loop.

Every AI-requested browser action must pass a strict Zod schema and a deterministic TypeScript executor before Playwright performs it.

- No arbitrary selectors.
- No arbitrary JavaScript.
- No form submission.
- No destructive actions.

---

## A Real Issue It Found

During a controlled run against the Aidoc public website, the agent inspected a Country dropdown and noticed that it contained both:

```text
Ecuador
Equador
```

Gemini identified `Equador` as a likely misspelled duplicate.

The agent then returned a machine-readable evidence target, and Playwright independently:

1. located the correct dropdown;
2. verified that `Equador` actually existed;
3. selected it locally without submitting anything;
4. captured focused screenshot evidence.

This is the kind of workflow the project is aiming for:

```text
AI notices something suspicious
        ↓
Structured evidence identifies where
        ↓
Playwright independently verifies it
        ↓
Evidence is captured for review
```

---

## Autonomous Exploration

The first bounded autonomous planner loop is now working.

In a controlled test, the agent independently decided to:

```text
Test malformed email
        ↓
Observe invalid browser state
        ↓
Blur the field
        ↓
Observe again
        ↓
Try a valid email
        ↓
Observe validation recovery
        ↓
Move on to another form control
```

Those steps were **not predefined as a test case**.

Gemini chose each next action based on the browser state produced by the previous one.

The loop is always bounded by deterministic safety rules and a hard maximum number of steps.

---

## Safety by Design

The AI does not directly control Playwright.

The current architecture looks roughly like this:

```text
Gemini planner
      ↓
Structured action request
      ↓
Zod validation
      ↓
Deterministic TypeScript executor
      ↓
Playwright
      ↓
Browser
```

Currently approved actions include:

```text
fill text field
clear text field
blur field
select native dropdown option
bounded scroll
stop exploration
```

Unsupported or ambiguous actions are rejected rather than guessed.

---

## Tech Stack

- **TypeScript**
- **Playwright**
- **Gemini API**
- **Zod**
- **Node.js**
- **GitHub Actions**

The project is designed so the core agent remains generic while individual websites are primarily represented through configuration.

---

## Try It

Clone the repository:

```bash
git clone https://github.com/bootnihil/web-qa-agent.git
cd web-qa-agent
```

Install dependencies:

```bash
npm ci
npx playwright install chromium
```

Configure a Gemini API key:

```cmd
setx GEMINI_API_KEY "your-api-key"
```

Run the deterministic Playwright tests:

```bash
npm test
```

Run the existing site agent:

```bash
npm run agent:run -- aidoc
```

The repository also contains focused development checks for the individual agent capabilities.

---

## Where It Is Now

The project has evolved from:

```text
Playwright automation
        ↓
AI-assisted website inspection
        ↓
Evidence-grounded QA reasoning
        ↓
Safe AI-requested browser actions
        ↓
Bounded autonomous exploratory loop
```

### Next

The next major milestone is running the autonomous planner/action loop against a carefully constrained real public webpage.

From there, the focus will move toward:

- richer safe browser interactions;
- systematic boundary and validation testing;
- better autonomous stopping decisions;
- integrating autonomous exploration into multi-page runs;
- richer evidence and reports;
- scheduled monitoring;
- comparing findings across runs.

---

## The Idea

This project is ultimately an experiment in combining:

```text
Deterministic automation
        +
AI reasoning
        +
Exploratory testing
        +
Strict safety boundaries
```

The goal is an agent that can independently look at a website and ask:

> **“What would a curious QA engineer test next?”**

Then safely go find out.

---

**Status:** Experimental / Active Development