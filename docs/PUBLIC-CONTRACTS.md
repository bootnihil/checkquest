# CheckQuest Public Contracts

This document defines the externally dependable behavior of the current
source-distributed CheckQuest CLI and JSON report.

CheckQuest is still an initial-development project. This document deliberately
does not turn every internal TypeScript type into a public API.

## Release status and versioning

The current public source-release line is `0.1.x`.

CheckQuest uses Semantic Versioning for the project/package version, with these
project-specific expectations while the major version remains zero:

- patch releases (`0.1.x`) preserve the supported CLI/configuration behavior
  and schema-version compatibility rules defined here;
- a new minor release may add functionality and may intentionally revise an
  initial-development public contract;
- incompatible JSON report changes also require a new
  `reportSchemaVersion`, independently of the package version;
- version `1.0.0` is reserved for a future point where CheckQuest deliberately
  declares a stable product-level public API.

The package version and `reportSchemaVersion` solve different problems. The
package version identifies a CheckQuest source release. The report schema
version tells report consumers whether the JSON contract is compatible.

## Supported distribution

The supported distribution for the current release line is a fresh clone of the
repository installed with the committed lockfile:

```bash
npm ci
npm run setup:browser
```

npm publication, a standalone executable, desktop packaging, a hosted service,
and a published SDK are not part of this contract.

## Supported CLI entry point

The preferred public CLI invocation is:

```bash
npm start -- [target] [options]
```

The existing `agent:run` and `agent:explore` npm scripts are compatibility
aliases for the same CLI entry point.

When the target is omitted, the current configured `aidoc` profile is used.

A target may be either:

- a registered site ID; or
- one complete `http://` or `https://` URL.

For an arbitrary URL, CheckQuest creates a run-local profile allowing the supplied
hostname and its exact `www` counterpart. It does not grant arbitrary subdomain
access. The runtime profile is not persisted. See [Host policy](CONFIGURATION.md#host-policy).

## Supported CLI options

The supported CLI options are:

| Option | Meaning | Accepted values |
|---|---|---:|
| `--pages` | Maximum distinct pages inspected, including the start page | 1–20 |
| `--navigation-steps` | Maximum site-level navigation decisions | 1–50 |
| `--steps-per-page` | Maximum investigation planner decisions per page | 0–10 |

These are ceilings, not guaranteed work counts. Investigation decisions can stop
or reject an action; they do not guarantee an executed interaction.

Unknown options, duplicate options, missing values, invalid values, extra
positional targets, and unresolved targets are configuration failures.

The exact wording of a public error message may improve over time. Callers
should depend on successful versus failed process status rather than parse
human-readable error prose.

## Supported environment configuration

The CLI supports:

- `GEMINI_API_KEY` as the user-owned credential for normal Gemini-backed runs;
- `GEMINI_MODEL` as an optional model-name override.

`GEMINI_API_KEY` is adapted by the CLI into the explicit per-run credential
accepted by the reusable core. CheckQuest does not persist it and does not
include it in reports, events, prompts, diagnostics, or public errors.

`GOOGLE_API_KEY` is not an implicit fallback.

The fact that `GEMINI_MODEL` can override the selected model is supported. A
particular default model name is not a compatibility promise and may change
without a package-major or report-schema change.

CheckQuest does not automatically load `.env` files.

`CHECKQUEST_DEBUG=1` enables developer-only redacted failure diagnostics. It is
not a stable machine-output protocol and does not relax credential privacy. See
[Configuration errors](CONFIGURATION.md#configuration-errors).

## CLI success and failure

The CLI process contract is:

| Exit code | Meaning |
|---|---|
| `0` | Exploration completed and both JSON and Markdown reports were persisted successfully |
| `1` | Configuration, exploration, cleanup, cancellation, or report delivery failed |

A caller automating CheckQuest should use the process exit code as the success
signal.

Report persistence is intentionally not transactional. The CLI currently writes
`report.json` before `report.md`. A late persistence failure can therefore
leave an artifact on disk while the process exits with code `1`. The existence
of a report file alone must not be interpreted as successful CLI completion.

Expected operational failures are presented through bounded CheckQuest error
codes such as `CONFIGURATION`, `BROWSER`, `NAVIGATION`, `MODEL`,
`MODEL_RESPONSE`, `CANCELLED`, `REPORTING`, and `CLEANUP`. Human-readable message wording
and bounded context are presentation details, not a machine protocol.

Failed exploration does not return or persist a successful partial report
contract.

## Output location

A successful CLI run writes beneath:

```text
agent-results/<run-id>/
```

with these user-facing artifacts:

```text
report.json
report.md
evidence/
```

`report.json` is the machine-readable report.

`report.md` is a human-readable projection.

`evidence/` contains screenshot evidence when capture policy produces it.

The `<run-id>` value is an opaque run identifier. Consumers may use it as a
directory/report identity but should not parse its current timestamp-like
format as a stable data contract.

Evidence filenames and Markdown layout are presentation details and are not
stable machine interfaces.

## JSON report compatibility

The authoritative machine-readable compatibility signal is `reportSchemaVersion`.
New runs emit **`"4"`**. Historical **`"3"`** reports remain supported without
migration. The package is still `0.1.0`; package and report versions are independent.

Schema v4 adds report-owned `humanNarratives` with a state and an `exploratory`
collection keyed by `findingReference`. Each entry contains `plainTitle`,
`plainCondition`, `impactStatement`, and `whatToCheck`. Successful new reports
have `state: "complete"` and all required narratives. Missing, invalid, duplicate,
or unassociated required narratives fail report construction or rendering;
required generation failure must not silently produce successful incomplete output.
A pending builder result is not a successfully delivered report.

Narratives do not redefine finding identity, severity, evidence, or verification.
Schema-v4 Markdown rendering consumes persisted narratives without regenerating
them through Gemini. Historical v3 rendering does not require v4 narratives;
existing v3 files are not rewritten or silently upgraded.

For schema version `3`, CheckQuest follows these rules:

- existing JSON fields are not removed or renamed;
- the JSON type of an existing field is not changed;
- the documented meaning of an existing field is not materially redefined;
- additive fields may be introduced;
- collection ordering should not be treated as an identity mechanism unless a
  field explicitly defines such identity;
- canonical finding identity comes from finding/reference fields, not array
  position;
- `findings` is the authoritative run-level functional finding collection;
- `siteWideExploratoryFindings` remains a compatibility projection rather than
  a second finding authority;
- `passiveSecurity` remains separate from functional finding verification;
- the fail-fast/no-successful-partial-report behavior remains part of the
  schema-v3 delivery contract.

These shared collection, identity, and delivery semantics also apply to v4.

A change that removes, renames, changes the JSON type of, or materially changes
the meaning of an existing field requires a new `reportSchemaVersion`. The
existing schema-v3 contract is not redefined by the introduction of v4.

Adding a field that old consumers can safely ignore does not by itself require
a new schema version.

Consumers should reject or explicitly handle report schema versions they do not
support rather than assume a newer version is compatible.

## Markdown report compatibility

The Markdown report is intended for people, not parsers.

Its headings, prose, table layout, ordering, labels, and explanatory wording may
change without a `reportSchemaVersion` increment as long as the underlying JSON
contract and finding semantics remain compatible.

Automation should consume `report.json`, not scrape `report.md`.

## Finding semantics that remain authoritative

For both supported report versions:

- `findings` is the canonical functional finding collection;
- occurrences are associated through explicit identities and evidence rather
  than array position;
- verification is evidence-capability-aware;
- a mechanically successful browser action does not automatically verify a
  broader semantic assertion;
- verified-known suppression depends on canonical verification, not merely raw
  action success;
- passive-security observations are observational and remain separate from
  functional findings.

The `target|select-option|country|equador` regression sentinel continues to
represent this distinction: mechanical select success may be verified while the
semantic typo assertion remains inconclusive without verification-capable
semantic evidence.

## Source-level reusable API

`startCheckQuest(...)`, `runSite(...)`, `SiteConfig`, `RunEvent`, `CheckQuestError`, and the current
TypeScript report types provide a deliberate reusable source boundary.

They are not currently a published, separately versioned SDK.

Internal module paths, dependency-injection seams, TypeScript type layout, and
source imports are therefore not covered by the package-version compatibility
promise in this document.

A future published SDK must define its own explicit public export surface before
it is treated as a Semantic Versioning public API.

## Explicit non-contracts

The current release does not promise:

- exhaustive crawling or proof that a tested site is defect-free;
- universal compatibility with arbitrary websites or controls;
- zero possible browser side effects;
- a stable default Gemini model name;
- a stable Markdown layout;
- a parseable run-ID timestamp format;
- stable evidence filenames;
- a published npm package;
- a standalone executable;
- a usable desktop GUI, packaged desktop distribution, or a hosted web UI;
- a hosted service;
- a stable published SDK.

The CLI is the currently available run interface. Electron components and
source-level IPC exist as internal development work; there is no usable desktop
GUI yet, and G2 is not complete or accepted. These internals are not a separately
versioned public API. See [desktop development status](../README.md#desktop-gui-in-development).

These exclusions do not weaken the existing deterministic safety, bounded
exploration, BYOK privacy, finding-integrity, or the semantics of either supported report version.
