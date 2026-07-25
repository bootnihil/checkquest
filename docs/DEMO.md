# CheckQuest Guided Demo

This walkthrough proves that a fresh CheckQuest installation can complete a
small model-backed run and produce readable artifacts. It is intentionally a
setup demo, not a showcase of every CheckQuest capability and not a promise
that the target will contain a defect.

Start with the main [README](../README.md) if CheckQuest is not installed yet.
For the exact supported CLI and report compatibility rules, see
[Public contracts](PUBLIC-CONTRACTS.md).

## What this demo exercises

The demo uses:

- one page;
- one navigation-decision ceiling;
- zero autonomous investigation actions;
- the normal Gemini-backed page analysis path;
- normal JSON and Markdown report persistence.

Setting `--steps-per-page 0` disables autonomous candidate investigation. It
does not disable page inspection, deterministic checks, diagnostics, passive
security observations, or Gemini-based page analysis.

## 1. Confirm the prerequisites

From the repository root:

```bash
node --version
npm --version
```

The supported source release requires Node.js 22.13.0+ and npm 10+.

If Chromium has not been installed for this checkout:

```bash
npm run setup:browser
```

On Linux systems that also need Playwright system packages:

```bash
npm run setup:browser:with-deps
```

## 2. Supply a Gemini key for this shell

PowerShell:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
```

Windows cmd:

```bat
set GEMINI_API_KEY=replace-with-your-key
```

POSIX shell:

```sh
export GEMINI_API_KEY="replace-with-your-key"
```

CheckQuest uses the key for the current run. It does not persist the key or
include it in reports, events, diagnostics, or public errors.

## 3. Run the minimal demo

```bash
npm start -- https://www.example.com/ --pages 1 --navigation-steps 1 --steps-per-page 0
```

`example.com` is an IANA-reserved documentation domain, which makes it useful
for a small illustrative command. Its HTTP service is best-effort and should
not be treated as a production dependency. If it is unavailable, use another
HTTP/HTTPS target that you are authorized to test.

This demo deliberately avoids autonomous browser investigation. It therefore
proves installation, browser launch, target inspection, Gemini analysis, and
report delivery without trying to exercise the full guarded action vocabulary.

## 4. Confirm successful delivery

A successful CLI run exits with code `0` and writes beneath:

```text
agent-results/<run-id>/
```

The main artifacts are:

```text
report.json
report.md
evidence/
```

The existence of a file alone is not the CLI success signal. Automation should
use exit code `0`, because report persistence is not transactional and a late
write failure can leave an artifact behind while the process correctly exits
with code `1`.

## 5. Read the report like a tester

Open `report.md` first for the human-readable view. Then inspect `report.json`
when you want the complete machine-readable record.

For this setup demo, verify only that:

1. the run completed rather than failing with a configuration, browser, or
   model error;
2. the inspected page and run budgets are represented correctly;
3. the JSON report declares `reportSchemaVersion: "3"`;
4. JSON and Markdown reports were both written; and
5. no Gemini API key appears in either report.

Do **not** require a particular finding count. The target content and the
model's evidence-grounded observations can change, and a healthy page may
produce no functional finding.

## 6. Move to a real bounded exploratory run

Once the setup demo succeeds, use a site you own or are authorized to test and
allow a small investigation budget, for example:

```bash
npm start -- https://your-authorized-site.example/ --pages 3 --navigation-steps 4 --steps-per-page 2
```

Replace the placeholder with the real authorized target. Runtime URL profiles
are scoped to the exact supplied hostname and are not persisted.

A larger budget does not make CheckQuest exhaustive. It remains a bounded,
representative exploratory pass, and supported browser investigation remains
restricted by deterministic safety policy.

## What this demo does not prove

A successful demo does not prove that:

- every website or custom control is supported;
- a site is defect-free;
- browser interaction can never have side effects;
- active vulnerability scanning is performed;
- Markdown layout is a stable machine interface; or
- the current source API is a published SDK.

Those boundaries are intentional. CheckQuest's current value is to spend a
small inspection budget intelligently and return evidence without pretending
that bounded automation is equivalent to exhaustive QA.
