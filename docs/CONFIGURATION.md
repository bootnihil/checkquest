# CheckQuest configuration

Use the [README](../README.md) for installation and first-run commands.
This reference covers current inputs; [Public contracts](PUBLIC-CONTRACTS.md)
defines compatibility. Profiles and TypeScript APIs are source-level interfaces,
not a published configuration-file format or SDK.

## CLI targets and budgets

```text
npm start -- [configured-site-id-or-url] [options]
```

`agent:run` and `agent:explore` invoke the same entry point. Supply at most one
target: a complete `http://` / `https://` URL or a registered profile ID.
Omitting it selects `aidoc`. The CLI requires a complete HTTP(S) URL; it does
not add a scheme to bare domains.

| Target | Start URL | Allowed hostnames | Default pages / navigation / investigation |
|---|---|---|---|
| Raw URL | Supplied URL, normalized by `URL` | Supplied hostname and exact `www` counterpart | 3 / 4 / 3 |
| `aidoc` | `https://www.aidoc.com/` | `aidoc.com`, `www.aidoc.com` | 5 / 6 / 3 |

Runtime profiles are temporary and are not added to the registry.

| CLI option | Meaning | Range |
|---|---|---:|
| `--pages` | Inspected-page ceiling, including page 1 | 1-20 |
| `--navigation-steps` | Run-level navigation-decision ceiling | 1-50 |
| `--steps-per-page` | Per-page investigation planner-decision ceiling | 0-10 |

An explicit navigation budget is preserved independently of the page budget.
When omitted, it becomes `max(profile.maxAgentSteps, effectivePageBudget)`.
Thus `aidoc --pages 10` gets 10 navigation decisions; a raw URL with `--pages 2`
retains 4. Decisions can stop or reject actions, so budgets do not guarantee
that many executed interactions or inspected pages.

```sh
npm start -- https://www.example.com/ --pages 5 --navigation-steps 7 --steps-per-page 3
npm start -- https://www.example.com/ --steps-per-page 0
```

Zero investigation steps leave analysis, diagnostics, deterministic checks,
and passive security enabled. This is not an offline or Gemini-free mode.

## Desktop development reference

The CLI is the currently available run interface. There is no usable desktop
GUI yet; G2 is in development, not complete or accepted. The Electron sources
below are internal components, not a supported user workflow.

The input-validation code accepts HTTP(S) URLs, bare dotted hostnames, localhost,
and explicit IP addresses. It normalizes bare website hostnames to HTTPS and
local/IP targets to HTTP, rejects URL userinfo, and accepts URL targets rather
than profile IDs. Its defaults are 3 pages, 4 navigation decisions, and 3
investigation steps/page. Its investigation range is 1-10, compared with the
CLI's 0-10. The internal form has no model selector.

The controller contains a credential preflight using an authenticated,
non-generative Gemini model-list GET (10-second timeout, one SDK attempt).
Its session store retains an accepted key in main-process memory until
replacement or application exit. Submission code clears request copies and the
renderer entry; this is not secure memory erasure or persistent key storage.

The target-preflight code makes a separate headless Chromium visit with a
15-second navigation timeout. Canonical redirects permit the exact hostname/
`www` pair with the same protocol/effective port, or an HTTP-to-HTTPS upgrade
with the allowed port relationship. Other destinations are rejected. This
separate visit is outside the exploration page budget and does not establish
that every page will be reachable.

These describe code-level contracts, not a completed desktop product. The
`desktop:start` and `desktop:build` scripts are development tooling, not an
available GUI installation or usage path. See
[input validation](../desktop/start-run-contract.ts),
[controller](../desktop/run-controller.ts), and
[canonical-target policy](../desktop/preflight-target-reachability.ts).

## Host policy

[`allowedHosts`](../agent/config/site-config.ts) contains exact hostnames,
not origins. Protocol and port are not independently constrained by that list.
The start hostname, eligible navigation targets, final redirect hostname, and
post-investigation hostname must be allowed. Subdomains are not inherited.

Raw-URL profiles add only one peer: `example.com` pairs with `www.example.com`;
`app.example.com` pairs with `www.app.example.com`, not the apex domain. A
source-authored profile must explicitly list each intended hostname.

The policy is not network isolation. Redirects are checked at their final URL;
ordinary loads can contact other hosts for resources and execute site scripts.
See [Browser safety](ARCHITECTURE.md#browser-safety).

## Gemini BYOK

The CLI adapts `GEMINI_API_KEY` from its process environment into explicit
per-run credentials. There is no implicit `GOOGLE_API_KEY` fallback or automatic
`.env` loader. Core `runSite(...)` does not read a process-global API key.

PowerShell:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
$env:GEMINI_MODEL = "your-model"
```

Windows cmd:

```bat
set GEMINI_API_KEY=replace-with-your-key
set GEMINI_MODEL=your-model
```

POSIX shell:

```sh
export GEMINI_API_KEY="replace-with-your-key"
export GEMINI_MODEL="your-model"
```

`GEMINI_MODEL` is optional. The current default is **`gemini-3.5-flash-lite`**,
not a stable model-name promise. Programmatic callers can pass `model` per run;
`aiConfig` also reads `GEMINI_MODEL` at module load, so an inherited environment
override can affect internal desktop defaults even though the development form
has no selector.
Gemini is the only production provider.

Keys are execution context, never `SiteConfig`. CheckQuest must not persist
or expose them through prompts, reports, events, diagnostics, or public errors.
The application boundary redacts the supplied key from serialized outputs.
Page observations are sent to Gemini; the absence of a key in reports does not
make target content private from the provider.

Core credential preflight checks that a required key is non-blank before
launching Chromium; it is distinct from the remote authentication preflight
in the internal desktop controller.
A missing required key fails with `MODEL`, phase `gemini-credential-resolution`.
Fully injected reachable analysis/planner/navigation paths can run without a
key; applicable report-narrative generation also needs injection to remain
Gemini-free. See [Architecture](ARCHITECTURE.md#programmatic-runsite-api).

## Programmatic configuration

The application boundary resolves targets, validates budgets, runs exploration,
and persists reports:

```ts
import { startCheckQuest } from '../agent/application/start-checkquest';

const run = startCheckQuest({
  target: 'https://www.example.com/',
  budgets: { pages: 3, navigationSteps: 4, investigationStepsPerPage: 1 },
  credentials: { geminiApiKey: userGeminiApiKey },
  model: optionalModelOverride,
  onEvent
});

const result = await run.result;
```

The import is relative to a hypothetical caller one directory below the
repository root; adapt it to the caller's location. `result` contains the
report and absolute artifact paths. Call `run.cancel()` while active to cancel.
Names such as `userGeminiApiKey` and `onEvent` are caller-supplied values.

Lower-level `runSite(...)` accepts a `SiteConfig` and returns an in-memory
report; it leaves report-file persistence to the caller, although evidence
capture can write screenshots during execution.

## `SiteConfig` reference

| Field | Meaning |
|---|---|
| `id`, `name` | Profile identity and display name |
| `startUrl` | Initial HTTP(S) URL, inspected as page 1 |
| `allowedHosts` | Non-empty list containing the start hostname |
| `maxPages` | Inspected-page ceiling, at least 1 |
| `maxAgentSteps` | Navigation-decision ceiling, at least 0 |
| `maxExploratoryStepsPerPage` | Investigation planner-decision ceiling, at least 0 |
| `allowFormSubmission` | Boolean policy flag; current profiles use `false` |

Reusable validation requires safe whole-number budgets but does not impose all
CLI or internal desktop-validation upper bounds. An optional run ID must be filesystem-safe and
1-128 characters; `startedAt` must be a valid `Date`. See
[input validation](../agent/run/validate-run-site-input.ts).

To add a profile, create an `agent/sites/` module matching `SiteConfig` and
register it in [the site registry](../agent/sites/index.ts). Follow the existing
[`aidoc` profile](../agent/sites/aidoc.ts). Keep `allowFormSubmission: false`;
setting it to true does not implement arbitrary form submission or expand the
action vocabulary. No current action grants generic submit authority.

## Configuration errors

Unknown/duplicate options, missing or invalid values, extra positional targets,
and unknown profiles fail as `CONFIGURATION`. CLI runtime URLs are recognized
by their lowercase HTTP(S) prefix; other strings normally resolve as profile
IDs. Reusable validation independently rejects non-HTTP(S) start URLs.
Missing Gemini credentials are `MODEL`, not `CONFIGURATION`.

Public errors are bounded; do not parse their prose as a machine interface.
For developer diagnostics only, `CHECKQUEST_DEBUG=1` prints a bounded, redacted
error chain and can write `agent-results/<run-id>/developer-diagnostic.txt` on
application failure. Diagnostics may include response excerpts and stack paths;
treat them as sensitive. They do not create a partial-report success contract.

If Chromium cannot launch, run `npm run setup:browser` (or the Linux
`setup:browser:with-deps` variant). Model failures can reflect credentials,
quota, provider availability, model selection, transport, or deadlines.
Report-write failures require a writable `agent-results/` directory under the
working directory. See [Failure behavior](ARCHITECTURE.md#failure-behavior).
