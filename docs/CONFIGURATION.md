# CheckQuest Configuration

This document is the configuration reference for the current repository. Start
with the [README](../README.md) for installation and normal CLI usage. See
[CheckQuest Architecture](ARCHITECTURE.md) for execution flow, programmatic
events, errors, findings, credentials, and safety boundaries.

Configuration is currently source-level and experimental. It is not a
versioned public configuration-file format or SDK stability promise.

## Configuration model

A CLI run is configured in four steps:

1. parse zero or one positional target plus optional runtime controls;
2. resolve the target to a `SiteConfig`;
3. apply any supplied budget overrides; and
4. adapt the invoking environment's Gemini credential into explicit per-run
   execution context before calling `runSite`.

The target can be a registered site ID or a complete HTTP/HTTPS URL. Registered
profiles are authored in the repository. A URL supplied at runtime creates a
temporary conservative profile; CheckQuest does not persist it.

Credentials are deliberately separate from `SiteConfig`. A site profile
describes exploration policy; a Gemini API key belongs only to the current
execution.

The authoritative implementations are the
[CLI option parser](../agent/config/agent-run-options.ts), the
[site registry](../agent/sites/index.ts),
[`SiteConfig`](../agent/config/site-config.ts), and the
[CLI credential adapter](../agent/cli/resolve-run-site-credentials.ts).

## Choosing a target

The CLI accepts zero or one positional target:

```text
npm run agent:run -- [configured-site-id-or-url] [options]
```

`agent:run` and `agent:explore` are aliases. When the target is omitted,
CheckQuest selects `aidoc`.

### Configured site

A configured site is a reusable `SiteConfig` registered in the source tree.
The repository currently contains one registered ID:

| Site ID | Start URL | Allowed hostnames | Default budgets |
|---|---|---|---|
| `aidoc` | `https://www.aidoc.com/` | `aidoc.com`, `www.aidoc.com` | 5 pages, 6 navigation decisions, 3 investigation steps/page |

Run the default or explicit configured target with:

```bash
npm run agent:run
npm run agent:run -- aidoc
```

This registration expresses only the current start URL, hostname policy,
budgets, and form policy. It does not contain a Gemini credential and does not
guarantee that every page or control on the site is supported.

### Arbitrary URL

Supply a complete URL beginning with `http://` or `https://`:

```bash
npm run agent:explore -- https://www.example.com/
```

CheckQuest parses and normalizes the URL, derives a run-local profile, and
allows only the exact supplied hostname. For example,
`https://www.example.com/` allows `www.example.com`; it does not automatically
allow `example.com`, sibling subdomains, or external hosts.

The runtime profile defaults to:

| Setting | Value |
|---|---:|
| Pages | 3 |
| Navigation decisions | 4 |
| Investigation steps per page | 3 |
| Form submission | Disabled |

An arbitrary URL is not persisted or added to the configured-site registry.
It also does not imply compatibility with every website, custom control,
authentication flow, or client-side behavior.

## Runtime controls

Options can follow either target form:

| CLI option | `SiteConfig` field | Meaning | Allowed CLI values |
|---|---|---|---|
| `--pages` | `maxPages` | Maximum number of distinct pages inspected, including the start page | Integer 1–20 |
| `--navigation-steps` | `maxAgentSteps` | Maximum site-level navigation decisions | Integer 1–50 |
| `--steps-per-page` | `maxExploratoryStepsPerPage` | Maximum autonomous investigation actions for each inspected page | Integer 0–10 |

Analysis, diagnostics, deterministic evaluation, and candidate generation
still run when `--steps-per-page 0` is selected. Zero disables autonomous
candidate investigation on the page.

Example:

```bash
npm run agent:explore -- https://www.example.com/ --pages 5 --navigation-steps 7 --steps-per-page 3
```

Disable autonomous investigation:

```bash
npm run agent:explore -- https://www.example.com/ --steps-per-page 0
```

Increase only the page budget:

```bash
npm run agent:run -- aidoc --pages 10
```

Page and navigation budgets are distinct. When `--navigation-steps` is
explicit, CheckQuest preserves it even when it is lower or higher than the
page budget. When it is omitted, the effective navigation budget is the
greater of the profile default and the effective page budget. Consequently,
`aidoc --pages 10` uses 10 navigation decisions, while a runtime URL with
`--pages 2` retains its default of 4.

These are ceilings, not promised work counts. A run can finish earlier when no
eligible navigation or investigation remains.

## `SiteConfig` reference

The current [`SiteConfig`](../agent/config/site-config.ts) fields are:

| Field | Meaning |
|---|---|
| `id` | Registered profile identifier |
| `name` | Human-readable profile name |
| `startUrl` | Initial HTTP/HTTPS page; always inspected as page 1 |
| `allowedHosts` | Exact hostnames permitted for start and subsequent navigation |
| `maxPages` | Run-level inspected-page ceiling |
| `maxAgentSteps` | Run-level navigation-decision ceiling |
| `maxExploratoryStepsPerPage` | Per-page autonomous investigation ceiling |
| `allowFormSubmission` | Explicit form-submission policy flag |

Reusable [`runSite` input validation](../agent/run/validate-run-site-input.ts)
requires a valid HTTP/HTTPS start URL, a non-empty allowed-host list containing
the start hostname, safe whole-number budgets, and a Boolean form policy.
`maxPages` must be at least 1; the two step budgets can be 0 for programmatic
configuration. The CLI applies its narrower ranges shown above.

Gemini credentials are intentionally absent from `SiteConfig`. They are
per-run execution context supplied separately to `runSite(...)`.

## Adding a configured site

Adding a reusable profile is a source change, not a CLI registration command.
Create a small module such as `agent/sites/example.ts`:

```ts
import type {
  SiteConfig
} from '../config/site-config';

export const exampleSite = {
  id:
    'example',

  name:
    'Example website',

  startUrl:
    'https://www.example.com/',

  allowedHosts: [
    'www.example.com'
  ],

  maxPages:
    3,

  maxAgentSteps:
    4,

  maxExploratoryStepsPerPage:
    2,

  allowFormSubmission:
    false
} satisfies SiteConfig;
```

Then import it in the [site registry](../agent/sites/index.ts) and add it to
the existing `sites` object:

```ts
import {
  exampleSite
} from './example';

const sites: Record<string, SiteConfig> = {
  [aidocSite.id]:
    aidocSite,

  [exampleSite.id]:
    exampleSite
};
```

Choose a unique ID, include every hostname that navigation is intentionally
allowed to reach, and keep all budgets bounded. Keep
`allowFormSubmission: false` unless a future explicit interaction policy and
safety review create a concrete reason to change it. Adding a profile does not
broaden the implemented browser action vocabulary and does not store a Gemini
credential.

## Host policy

Host checks use exact URL hostnames:

- the configured start URL hostname must appear in `allowedHosts`;
- discovered navigation links are restricted to those hostnames;
- a requested navigation target outside the list is rejected;
- a redirect whose final hostname is outside the list is rejected; and
- post-investigation page state is checked against the same list.

This is a hostname allowlist, not an origin allowlist: protocol and port are
not separately represented in `allowedHosts`. Subdomains are not inherited.
If both `example.com` and `www.example.com` are intended, both must be listed.
Runtime URL profiles contain only the exact hostname parsed from the supplied
URL.

The allowlist bounds where CheckQuest navigates; it is not a general network
isolation or formal no-side-effect guarantee. Ordinary page loading can still
load resources and execute target-site JavaScript.

## Form-submission policy

`SiteConfig` contains `allowFormSubmission`, and the current `aidoc` and
runtime-URL profiles set it to `false`.

The current planner and browser action vocabulary does not provide generic
form-submit authority. Supported form-control actions are narrowly targeted
local fill, clear, blur, and native-option selection operations; observed
submit buttons do not grant permission to activate them.

The presence of the configuration field must not be interpreted as a promise
that arbitrary form submission is implemented or safe. Ordinary supported
form-control events can still trigger website JavaScript, so
“production-safe” remains an engineering goal rather than a guarantee of zero
possible side effects.

## Gemini BYOK

Normal model-backed CLI exploration reads one user-owned credential from the
invoking process environment:

```text
GEMINI_API_KEY
```

The CLI resolves that environment value and passes it into `runSite(...)` as
an explicit per-run credential. The reusable execution core does not silently
read `process.env.GEMINI_API_KEY` and does not mutate process-global
credential state.

`GOOGLE_API_KEY` is not accepted as an implicit fallback. The repository has
no automatic `.env` loader. CheckQuest does not persist the key or include it
in reports, run events, prompts, diagnostics, reusable site configuration, or
public error messages. Do not commit credentials to the repository.

When a default Gemini-backed analysis, planner, or navigation path can be
reached, `runSite(...)` requires a non-blank explicit per-run Gemini key before
Chromium launches. Missing or blank credentials fail as a non-retryable
`MODEL` error with phase `gemini-credential-resolution`.

Programmatic callers can supply a transient credential directly:

```ts
const run = startCheckQuest({
  target: exampleSite.startUrl,
  credentials: {
    geminiApiKey: userGeminiApiKey
  },
  model: optionalModelOverride
});

const result = await run.result;
```

Because the credential belongs to a single invocation rather than global
process state, separate desktop or hosted runs can supply different user keys
without changing `process.env`.

Mandatory browser-free and local Chromium repository gates do not require
Gemini. A programmatic `runSite(...)` execution whose reachable page-analysis,
planner, and navigation-choice collaborators are fully injected also requires
no Gemini key.

The collaborator seam is described in
[Programmatic `runSite` API](ARCHITECTURE.md#programmatic-runsite-api).

## Model override

`GEMINI_MODEL` optionally overrides the model name used by the production
Gemini-backed page-analysis, planner, and navigation-choice paths:

```text
GEMINI_MODEL
```

When it is absent, the current implementation default is
`gemini-3.1-flash-lite`. That default is implementation configuration, not a
stable public API guarantee. CheckQuest does not provide model aliases,
provider selection, or configuration for non-Gemini providers.

The CLI adapts this environment value into the explicit per-run `model` input.
Programmatic callers, including a future GUI, can pass that model directly
without mutating process environment state. When no per-run model is supplied,
the existing implementation default and process-level fallback remain
available for direct low-level callers.

## Cross-platform environment examples

These examples set values for the current shell or process environment only.
Replace the placeholders locally; do not store real credentials in source
control.

PowerShell:

```powershell
$env:GEMINI_API_KEY = "your-key"
$env:GEMINI_MODEL = "your-model"
```

Windows cmd:

```bat
set GEMINI_API_KEY=your-key
set GEMINI_MODEL=your-model
```

POSIX shell:

```sh
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="your-model"
```

For CLI execution, `GEMINI_API_KEY` is read by the CLI adapter and converted
into the explicit per-run credential supplied to the reusable core.

Permanent environment configuration is operating-system-specific. CheckQuest
does not manage credential storage or shell profiles.

## Configuration errors

Known CLI target and option failures use `CheckQuestError` code
`CONFIGURATION` and are rendered as bounded, actionable public messages.

| Situation | Current behavior |
|---|---|
| Unknown option | Lists the three supported CLI options |
| Missing option value | Identifies the option requiring a value |
| Non-integer or out-of-range value | Reports the required whole-number range |
| Duplicate option | States that the option can be supplied only once |
| More than one positional target | Requests only one configured ID or URL |
| Unknown configured site | Lists the currently available configured IDs |
| Malformed `http://` or `https://` URL | Requests a complete HTTP/HTTPS URL |
| Non-HTTP(S) programmatic `startUrl` | Rejected by reusable input validation |
| Missing or blank CLI `GEMINI_API_KEY` | Non-retryable `MODEL`, not `CONFIGURATION` |
| Missing or blank required per-run Gemini credential | Non-retryable `MODEL`, not `CONFIGURATION` |

The CLI recognizes runtime URLs by their `http://` or `https://` prefix. A
target with another scheme is not a runtime URL and will normally be resolved
as an unknown configured-site ID. Programmatic `runSite` validation separately
rejects a non-HTTP(S) `SiteConfig.startUrl` as `CONFIGURATION`.

Errors retain internal causes where useful, but public formatting does not dump
causes, raw model output, or credentials.

## Programmatic configuration

Application callers can resolve an arbitrary URL or registered profile,
configure budgets, provide transient credentials and an optional model, observe
events, cancel, and receive persisted artifact paths without CLI coupling:

```ts
const run = startCheckQuest({
  target: 'https://www.example.com/',
  budgets: {
    pages: 3,
    navigationSteps: 2,
    investigationStepsPerPage: 1
  },
  credentials: {
    geminiApiKey: userGeminiApiKey
  },
  model: optionalModelOverride,
  onEvent
});

const result = await run.result;
run.cancel();
```

`result` contains the in-memory schema-v3 report and absolute report-directory,
JSON-report, and Markdown-report paths. `credentials` is per-run execution
context and is deliberately absent from results and events.

The lower-level `runSite` boundary remains available to callers that already
own a `SiteConfig` and report persistence. It performs reusable validation
independently of CLI parsing, so callers
cannot rely on TypeScript shape-checking or earlier CLI validation alone. Its
optional timestamps, run identity, event observer, model collaborators,
credential behavior, failure contract, and in-memory report are documented in
[CheckQuest Architecture](ARCHITECTURE.md#programmatic-runsite-api).

## Configuration examples

| Goal | Command |
|---|---|
| Run the default `aidoc` profile | `npm run agent:run` |
| Run `aidoc` explicitly | `npm run agent:run -- aidoc` |
| Run an arbitrary URL | `npm run agent:explore -- https://www.example.com/` |
| Raise the page budget | `npm run agent:run -- aidoc --pages 10` |
| Set independent page/navigation budgets | `npm run agent:run -- aidoc --pages 10 --navigation-steps 6` |
| Analyze without autonomous investigation | `npm run agent:explore -- https://www.example.com/ --steps-per-page 0` |

Report files from a successful CLI run are written under
`agent-results/<run-id>/`; see [What you get](../README.md#what-you-get).

## Current boundaries

- `aidoc` is the only registered reusable site profile.
- Runtime URL profiles are temporary and scoped to one exact hostname.
- CheckQuest does not automatically load `.env` files or persist credentials.
- CLI BYOK is adapted from `GEMINI_API_KEY` into an explicit per-run
  credential.
- Reusable `runSite(...)` does not depend on process-global user credentials.
- Gemini is the only production model provider currently supported.
- The CLI reads `GEMINI_MODEL` as an optional per-run model override; Gemini
  remains the only production provider.
- Configuration is code and CLI/environment input, not a standalone
  configuration-file format.
- The programmatic API is source-level, not a published versioned SDK.
- Host and action policies reduce risk but cannot guarantee universal website
  compatibility or zero side effects.
- Fresh-clone source installation is the supported Stage 10A distribution
  path. An npm-published package, standalone executable, installer, GUI, SaaS,
  and stable public configuration design remain outside this slice.
