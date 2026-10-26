# CheckQuest guided demo

Take CheckQuest from a first inspection to a report you can read. Then, if you're
ready, try a small exploration that can investigate selected clues. You don't
need to write a test script or expect a particular finding to follow along.

## Before you start

- Complete [installation](../README.md#install-from-source), including dependency
  installation and Chromium setup.
- Open a terminal in the cloned `checkquest` directory.
- Have your own Gemini API key ready. Gemini is currently the only supported AI
  provider, and usage may incur charges.
- Choose a website where automated testing is permitted: your own project, an
  approved client website, or a test environment. Review the
  [safety limits](ARCHITECTURE.md#browser-safety) before running it.

This walkthrough uses the command-line version. The
[desktop application is in development](../README.md#desktop-gui-in-development).

## 1. Configure the provider key

In the PowerShell terminal that will start CheckQuest:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
```

Replace the placeholder with your key and keep it out of source control. See
[provider configuration](CONFIGURATION.md#gemini-byok) for Windows cmd, POSIX
shells, and optional model settings. CheckQuest does not automatically load
`.env` files.

## 2. Inspect one page

Replace the URL below with your permitted target, including `http://` or `https://`:

```sh
npm start -- https://your-authorized-site.example/ --pages 1 --navigation-steps 1 --steps-per-page 0
```

This first run checks your setup and inspects the starting page without attempting
additional interactive investigation. It still loads the website, collects page
observations, and uses Gemini for analysis. It is not an offline or guaranteed
side-effect-free mode.

Wait for the run to finish. A successful run prints the paths to its JSON and
Markdown reports. If it fails, start with the
[setup help below](#setup-help-and-next-steps).

## 3. Open the readable report

Open the printed path to `report.md`, preferably in a Markdown viewer. Reports
are saved under `agent-results/<run-id>/` in the working directory. Each run has
its own directory, so use the path from the run you just completed.

As you read, look for:

- **What was inspected.** Check the reported pages rather than assuming the whole
  website was explored.
- **What deserves attention.** Read the possible problems, affected pages, and
  suggested follow-up.
- **What supports each finding.** Follow the evidence references where available.
  A suspicion or successful interaction alone is not proof of the broader claim.
- **What still needs judgment.** Inconclusive findings need human review. Separate
  security-related observations describe what was observed, not proven exploits.

Finding zero issues is a valid result. It does not prove the site is problem-free
or that a larger exploration would find nothing else.

## 4. Understand the other files

`report.json` contains structured results for your tools and workflows. Use it
for automation instead of extracting data from the readable Markdown report.

An `evidence/` directory contains focused screenshots when capture is available.
There may be no screenshots; follow the references in your report rather than
expecting a particular image or filename. Treat reports and evidence as potentially
sensitive website data before sharing them.

### Optional technical verification

These checks are useful for integrations or troubleshooting; they aren't needed
to start reading the report:

1. **Check completion.** CLI exit `0` means exploration, cleanup, and both report
   writes succeeded. Exit `1` means failure or cancellation. Files can remain
   after failure, so file existence alone is not a success signal.
2. **Check JSON compatibility.** New reports declare `reportSchemaVersion: "4"`
   and `humanNarratives.state: "complete"`, with all required exploratory
   narratives. An empty narrative collection can be valid when no applicable
   findings require one. Historical schema-v3 reports remain supported.
3. **Check scope.** Review the requested target, inspected URLs, and configured
   budgets. Redirects can change the final URL, and runs can finish before
   exhausting their limits.
4. **Check credential privacy.** The supplied API key must be absent from the
   reports. Don't paste it into a search command that records shell history or
   prints it, and don't include it in shared diagnostics.

See [CLI success and failure](PUBLIC-CONTRACTS.md#cli-success-and-failure) and
[JSON compatibility](PUBLIC-CONTRACTS.md#json-report-compatibility) for the exact
contracts.

## 5. Try a small exploration

When you're ready to allow interactive investigation, replace the placeholder
with a permitted target and run:

```sh
npm start -- https://your-authorized-site.example/ --pages 3 --navigation-steps 4 --steps-per-page 2
```

This allows up to three inspected pages, four navigation decisions across the
run, and two investigation decisions per page. CheckQuest can follow eligible
internal links and examine appropriate dropdowns, tabs, expandable sections, or
text fields when doing so may clarify a suspicious detail.

These are ceilings, not promised work counts. CheckQuest may stop early, decline
an interaction, or find nothing requiring investigation. More budget does not
guarantee more findings or stronger evidence.

A raw URL permits its hostname and exact `www` counterpart, not arbitrary
subdomains. See [Host policy](CONFIGURATION.md#host-policy) and the
[detailed safety boundaries](ARCHITECTURE.md#browser-safety) before broadening
your inspection. Open the new run's `report.md` and review its observations in
context rather than comparing finding counts alone.

## Setup help and next steps

| If you encounter... | Try this |
|---|---|
| PowerShell blocks `npm.ps1` | Use `npm.cmd` in place of `npm`, for example `npm.cmd ci`; no execution-policy change is needed |
| Chromium cannot launch | Run `npm run setup:browser`; on Linux, use `npm run setup:browser:with-deps` if system libraries are missing |
| A missing-key error | Set `GEMINI_API_KEY` in the terminal starting CheckQuest; a `.env` file alone is not loaded |
| A target/configuration error | Supply one complete HTTP(S) URL and check the [CLI reference](CONFIGURATION.md#cli-targets-and-budgets) |
| A provider error | Review the key, quota, availability, and model settings in [Configuration](CONFIGURATION.md#configuration-errors) |
| Missing report files | Use the printed path and confirm the working directory is writable; a failed run does not promise completed reports |

Use [Configuration](CONFIGURATION.md) to adjust budgets and inputs,
[Architecture](ARCHITECTURE.md#browser-safety) for safety details, and
[Public contracts](PUBLIC-CONTRACTS.md) when integrating the JSON output.
