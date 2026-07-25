# CheckQuest Roadmap

**Roadmap version:** 1.12

**Frozen on:** 2026-07-23  
**Current stage:** Stage 8F — Production-readiness review

## How this roadmap is used

This is the canonical execution order for CheckQuest.

New ideas, defects, refactors, tooling changes, and product ideas do **not** automatically change the roadmap. They are recorded in `BACKLOG.md` first.

The roadmap order changes only when we explicitly decide that:

1. a newly discovered issue is a true blocker for the current stage; or
2. the roadmap itself should be revised deliberately.

Otherwise:

> Finish the current stage → test it → commit it → move to the next stage.

### Work classification

- **BLOCKER** — prevents the current stage from functioning correctly. Fix immediately.
- **DEFECT** — implemented behavior is wrong. Fix during the current stage if required for completion; otherwise backlog it.
- **BACKLOG** — improvement, feature, refactor, tooling change, architectural idea, or future product work. Record it and keep going.

---

# Stage 1 — Candidate-driven investigation

**Completed:** 2026-07-23

## Goal

Autonomous investigation actions must directly gather evidence for an actual candidate finding.

CheckQuest should not interact with a page merely because an element is available or interesting.

## Completion criteria

- Investigation actions are tied to candidate findings.
- Each investigation action has a clear evidence-gathering purpose.
- Irrelevant exploration does not consume the investigation budget.
- Existing behavior and regression tests still pass.

---

# Stage 2 — Page-type diversity and run-level novelty

**Completed:** 2026-07-23

## Goal

Avoid spending limited page budgets on near-identical pages or templates.

Examples include repeatedly inspecting similar blog posts, article pages, or other pages that provide little new functional coverage.

## Completion criteria

- Novelty is tracked across the entire run.
- Page/template similarity influences exploration decisions.
- Unexplored page types and application areas are preferred.
- Limited page budgets result in broader meaningful coverage.

---

# Stage 3 — Known-finding context

**Completed:** 2026-07-23

## Goal

Later analysis in the same run should know what has already been discovered.

Gemini should prioritize new defects instead of repeatedly rediscovering the same issue, while still being able to strengthen an existing finding with useful additional evidence.

## Completion criteria

- Findings discovered earlier in the run are available to later analysis.
- Duplicate rediscovery is substantially reduced.
- Candidate generation prioritizes new issues.
- Existing findings can still be strengthened when new evidence adds value.

---

# Stage 4 — Broaden the safe action vocabulary

**Completed:** 2026-07-23

## Goal

Give CheckQuest more ways to investigate a website without violating the production-safe, non-destructive operating model.

Stage 4 delivered two explicit candidate-driven interaction types:

- guarded informational disclosure state investigation;
- guarded conventional ARIA tab selection and panel investigation.

Both actions require exact structured evidence targets and deterministic candidate/action identity matching. Browser execution runs inside a fail-closed containment boundary with zero-new-request enforcement, navigation/form/popup/download/realtime/service-worker protection, deterministic transition evidence, and mandatory verified rollback.

Successful guarded investigations can produce explicit deterministic verification outcomes and participate in run-local known-finding suppression.

Stage 4 did **not** introduce generic click capability, planner-controlled selectors or JavaScript, or support for menus, dialogs, filters, dropdown widgets, arbitrary navigation, or other interaction types.

## Completion criteria

- New actions are typed and validated.
- Action safety constraints are explicit.
- The expanded vocabulary remains production-safe.
- The smarter investigation behavior from Stages 1–3 governs when those actions are used.

---

# Stage 5 — Finding unification and static verification

**Completed:** 2026-07-24

Stages 5.1–5.3 provide the unified finding/evidence model, conservative
rule/model reconciliation, run-level occurrence aggregation, explicit derived
verification, Stage 3 compatibility projection, and canonical JSON/Markdown
reporting.

Final acceptance included the external Playwright regression suite passing 3/3
and the five-page Aidoc run `2026-07-24T07-02-21-200Z`. Canonical JSON and
Markdown agreed across all findings and occurrences. The acceptance run
validated the assertion-specific verification boundary: raw interaction
evidence showed that the `Equador` option was selectable, while the semantic
typo finding correctly remained inconclusive without a trusted explicit
assessment. Later known occurrences were recognized without incorrectly
triggering verified-finding suppression.

## Goal

Combine browser observations, Gemini reasoning, evidence, and deterministic/static checks into one coherent finding model.

CheckQuest should distinguish between something it suspects and something it has actually demonstrated.

Stage 4 established target-specific deterministic outcomes for guarded disclosure and tab investigations. Stage 5 builds on that foundation by unifying model-generated findings, browser observations, deterministic interaction evidence, and future static checks in one coherent finding representation.

## Completion criteria

- Findings use a unified representation.
- Evidence sources can be combined without producing duplicate findings.
- Deterministic evidence can confirm or contradict model-generated observations.
- Verification state is explicit, for example:
  - Verified
  - Not Verified
  - Inconclusive
- Findings have a clear evidence trail.

---

# Stage 6 — Exploration coverage and smarter navigation

**Completed:** 2026-07-24

Stage 6.1 added traversal-depth and discovery-provenance tracking, a bounded
run-level frontier, deterministic breadth/depth and page-budget strategy,
area-level diversification above Stage 2 novelty, requested/attempted versus
inspected-final URL accounting, redirect-alias and duplicate-final suppression,
final-URL-based novelty accounting, and additive navigation auditability.

Stage 6.2 added deterministic `neutral`, `weak-low-value`, and
`strong-low-value` route classification using conservative pagination and exact
route-role signals. Weak and strong routes receive distinct priority treatment
but remain eligible, and Gemini chooses only within the deterministic best
policy band. Adaptive dead-end or observed-yield learning was not introduced.

Acceptance included the external Playwright regression suite passing 3/3 and
bounded five-page Aidoc runs `2026-07-24T09-49-24-953Z` (`/`, `/solutions/`,
`/platform/`, `/healthcare-ai/`, `/strategy/`) and
`2026-07-24T10-37-15-126Z` (`/`, `/solutions/`, `/platform/`,
`/healthcare-ai/`, `/learn/`). Stage 5 canonical finding and verification
semantics were preserved: the four-occurrence `Equador` logical finding
remained inconclusive with no verification-capable evidence despite raw
select-option investigation results. The compatibility page-number projection
defect found during Stage 6.1 acceptance was corrected and verified in the
Stage 6.2 report.

## Goal

Improve where CheckQuest goes after the investigation engine itself is mature.

## Scope

- Build on the guaranteed page-1 inspection of the configured start URL.
- Smarter selection of meaningful application areas.
- Navigation-depth and page-budget strategy.
- Avoidance of dead ends and low-value routes.
- Better prioritization of routes likely to expose new functionality.

Stage 6 establishes bounded, run-local navigation over conservatively
discovered visible navigation links using deterministic novelty and route-value
prioritization. Its completed scope does not require exhaustive or body-wide
crawling, adaptive yield learning, semantic page-value authority, or persisted
cross-run exploration history.

## Completion criteria

- Navigation decisions improve meaningful coverage.
- Page budgets are spent on functionally useful areas.
- Coverage behavior remains bounded and predictable.

---

# Stage 7 — Passive security and infrastructure posture

**Completed:** 2026-07-24

Stage 7.1 delivered a dedicated passive-security model separate from
`UnifiedFinding`, deterministic passive interpretation, capture from
already-returned Playwright main-document responses, capture-time safe-header
allowlisting and redaction, origin-level aggregation, and separate JSON and
Markdown reporting under report schema version 3. The passive layer does not
participate in Gemini analysis, planning, candidate investigation, or action
execution, and it adds no security-specific browsing or probing.

The completed deterministic rule set is:

- `PS_HTTP_DOCUMENT`
- `PS_HSTS_NOT_OBSERVED`
- `PS_HSTS_NOT_ENFORCING`
- `PS_CSP_RESPONSE_HEADER_NOT_OBSERVED`
- `PS_NOSNIFF_NOT_ENFORCING`
- `PS_FRAME_POLICY_NOT_OBSERVED`
- `PS_TECHNOLOGY_DISCLOSURE`

Local browser safety acceptance observed only the expected normal browsing
traffic: `GET /start`, its natural redirect to `GET /home`, and `GET /next`.
It introduced no HEAD, OPTIONS, TRACE, POST, PUT, PATCH, DELETE, guessed-path,
security-navigation, form-submission, or payload-injection traffic.

Bounded real-site acceptance used
`npm run agent:run -- aidoc --pages 5` in run
`2026-07-24T12-14-25-090Z`. It inspected 5/5 pages on one origin,
`https://www.aidoc.com`, without changing the Stage 6 navigation or action
budgets. The canonical passive result contained three origin-level logical
observations and 15 occurrences:

- one low-severity, high-confidence, defense-in-depth
  `PS_CSP_RESPONSE_HEADER_NOT_OBSERVED` observation with five occurrences;
- one informational, high-confidence `PS_TECHNOLOGY_DISCLOSURE` observation
  for `Server: cloudflare` with five occurrences;
- one informational, high-confidence `PS_TECHNOLOGY_DISCLOSURE` observation
  for `X-Powered-By: WP Engine` with five occurrences.

Manual review confirmed the expected suppressions: HTTPS final documents did
not produce `PS_HTTP_DOCUMENT`; valid
`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
did not produce an HSTS observation; `X-Content-Type-Options: nosniff`
suppressed the nosniff observation; and `X-Frame-Options: DENY` suppressed the
frame-policy observation. CSP absence was described only as an enforcing
response header not being observed, without a vulnerability or exploitability
claim.

JSON and Markdown agreed on three logical passive observations, 15
occurrences, severity totals of medium 0, low 1, and info 2, and one origin.
No sensitive security data was serialized.

Stage 1–6 behavior remained intact: 5/5 pages were inspected, 4/6 navigation
decisions were used, the planner made eight decisions and executed four
investigation actions, five screenshots were captured, and six functional
logical findings retained a highest severity of medium and final unified state
of inconclusive. The canonical `Equador` behavior remained unchanged across
four occurrences on pages 2–5: select-option investigation succeeded, while
the semantic typo finding remained inconclusive because no trusted
verification-capable evidence established the semantic claim. One additional
placeholder occurrence relative to the prior run reflected normal Gemini
wording variability and did not change page selection, budgets, actions,
severity, or `Equador` semantics.

Completion verification passed:

- `npx tsc --noEmit`
- `npm run agent:passive-security-check`
- `npm run agent:passive-security-browser-check`
- `npm run agent:passive-security-report-check`
- `git diff --check`

The implementation regression had already passed the external Playwright
suite 3/3, unified finding/reconciliation/lifecycle/report checks, Stage 4A/4B
safety and browser acceptance, Stage 6 navigation
policy/route-value/redirect accounting, and run-option/budget checks. One
timing-sensitive Stage 4A network-containment assertion failed once and passed
immediately on isolated rerun; it was not a Stage 7 regression.

## Goal

Add a separate passive security/infrastructure observation layer without turning CheckQuest into a penetration-testing tool.

This layer may observe safely discoverable signals from normal browsing and configuration, but should not attempt exploitation.

## Architectural principle

Functional/UX exploration and passive security/infrastructure posture remain separate concerns that can contribute to the same final report.

## Completion criteria

- Passive checks are clearly separated from functional investigation.
- No exploitative or destructive behavior is introduced.
- Security observations carry appropriate evidence and confidence.

---

# Stage 8 — Engineering hardening

This stage intentionally incorporates the legitimate takeaways from the 2026-07-23 DevAnalyzer review without chasing arbitrary analyzer scores.

## 8A — Code organization

**Completed:** 2026-07-24

Stage 8A completed CQ-017 through three targeted responsibility extractions
without changing Stage 1–7 product behavior:

- Stage 8A.1 moved generic guarded click-like containment into a shared neutral
  browser safety boundary while leaving disclosure- and tab-specific
  eligibility, transition verification, rollback, and evidence semantics in
  their respective executors.
- Stage 8A.2 moved run-level canonical/compatibility finding choreography,
  fingerprint aliases, known-finding context, candidate mappings, occurrence
  registration, investigation outcomes, and suppression into a dedicated
  lifecycle coordinator. `KnownFindingState` and `UnifiedFindingRegistry`
  remain intentionally separate.
- Stage 8A.3 decomposed the former approximately 1,576-line
  `run-site-agent.ts` into an approximately 100-line CLI adapter, reusable
  `runSite(...)` coordinator, cohesive `inspectPage(...)` workflow, and pure
  report-model builder. The coordinator returns a structured
  `SiteAgentReport`, establishing a presentation-agnostic boundary for current
  CLI and future desktop or web callers.

TypeScript and the relevant finding, candidate, navigation, novelty,
route-value, Stage 4A/4B, passive-security, browser-acceptance, and
programmatic run-site/report-builder checks passed. `git diff --check` passed.
The timing-sensitive Stage 4A WebSocket assertion passed on isolated rerun,
consistent with its pre-refactor behavior. Gemini and Aidoc checks remained
environment-blocked by `fetch failed` and `ERR_NETWORK_ACCESS_DENIED`;
Stage 8A did not claim those checks succeeded or introduce a workaround.

Representative JSON and Markdown output remained byte-for-byte equivalent
under report schema version 3. The canonical
`target|select-option|country|equador` finding preserved its legacy boundary:
a successful raw deterministic select interaction may be `VERIFIED`, while
the semantic finding remains `INCONCLUSIVE` without semantic proof.
Occurrence aggregation, evidence, and suppression remained unchanged.

Non-blocking debt remains intentionally deferred: existing direct console
progress output belongs to CQ-020; the coordinator still uses the current
concrete Chromium/model implementations; the positional candidate/result
contract remains; some operational types remain under reporting; and
start-page navigation remains intentionally separate from approved-link
navigation. Shared finding-identity extraction was unnecessary, and no further
line-count-driven decomposition is required for CQ-017.

- Review oversized files and blurred responsibilities.
- Split components only where doing so improves maintainability or clarity.
- Preserve clean boundaries between reusable engine logic and presentation/transport layers.

## 8B — Static quality

**Completed:** 2026-07-24

Stage 8B completed CQ-018 through three bounded tooling slices without
changing Stage 1–7 runtime behavior:

- Stage 8B.1 established strict, no-emit `npm run typecheck` coverage,
  including `pages/**/*.ts` and additional zero-diagnostic compiler
  safeguards, plus a minimal TypeScript-aware `npm run lint` gate. Native
  TypeScript 7 remains authoritative for typechecking while TypeScript-ESLint
  uses its supported TypeScript 6 compatibility API.
- Stage 8B.2 added the sequential, browser-free, network-free 21-check
  `npm run test:deterministic` regression gate and the unified
  `npm run check` command. Mandatory push/pull-request CI now gates repository
  correctness independently of public Aidoc availability.
- Stage 8B.3 added repository-specific `npm run lint:md` coverage for all four
  authored Markdown files, with zero final issues and no broad documentation
  rewrite. It also added a sequential four-check loopback Chromium gate through
  `npm run test:browser:ci`, split mandatory CI into browser-free and local
  browser jobs, and removed the unused empty API Playwright project and
  `test:api` script.

Final verification passed for `npm ci`, typechecking, ESLint, Markdown lint,
all 21 deterministic checks, the unified quality gate, all four selected
browser checks, workflow YAML parsing, and `git diff --check`. The browser
aggregate passed three consecutive stability repetitions. The known
timing-sensitive grouped Stage 4A disclosure/safety check remains deliberately
outside mandatory CI and was not treated as a Stage 8B regression.

Mandatory CI has no public-site dependency, Gemini invocation, repository API
key, or CheckQuest-owned Gemini credential. The three external Aidoc tests
remain preserved in a manual-only workflow, and Gemini-dependent checks remain
outside mandatory CI under the existing BYOK architecture. Stage 8B did not
claim external Aidoc or Gemini execution succeeded.

The representative schema-v3 fixture remained unchanged: one logical
`target|select-option|country|equador` finding across three occurrences, one
raw verified deterministic interaction, canonical semantic verification
`INCONCLUSIVE`, two redundant known-finding investigations suppressed, and
unchanged JSON/Markdown agreement.

Non-blocking tooling debt remains intentionally deferred: Prettier and
repository-wide source formatting would create disproportionate churn; broad
ESLint unsafe-type families remain too noisy for the current value;
`no-console` belongs with CQ-020 observability/progress design; the
timing-sensitive grouped Stage 4A check remains outside mandatory CI; and
external Aidoc/Gemini acceptance remains deliberately non-mandatory. None of
these items blocks CQ-018 completion.

## 8C — Test depth

**Completed:** 2026-07-25

Stage 8C completed CQ-019 through three focused slices aimed at high-risk
semantic and integration blind spots. It deliberately did not use a raw
line/branch coverage percentage as an acceptance criterion, migrate to a
conventional test framework, or add coverage tooling.

Stage 8C.1 expanded deterministic run-level finding lifecycle and
candidate-reference integrity coverage across multiple new findings, mixed new
and known findings, mixed and reordered investigation outcomes, missing and
duplicate results, stale references, mismatched finding identities, legitimate
model/static aliases, verified-known suppression, occurrence/evidence
isolation, and the legacy `Equador` non-suppression boundary.

That coverage exposed a latent positional-association defect. Canonical outcome
attachment already used candidate references, but compatibility and
known-finding registration could still associate a reordered investigation
result with the wrong new logical finding. Malformed result sets could also
mutate registry state before failing. The lifecycle now validates the complete
candidate/result contract before mutation, indexes outcomes by candidate
reference, processes prepared candidate order independently of result-array
order, and rejects missing, duplicate, stale, or mismatched results
deterministically. `KnownFindingState` and `UnifiedFindingRegistry` remain
separate. The deterministic aggregate increased from 21 to 22 checks.

Stage 8C.2 deepened passive-security sanitization/privacy, JSON/Markdown
reporting, URL identity, navigation policy, novelty, runtime configuration, and
local browser-fixture coverage. It protects CSP nonces and hashes, reporting
URLs, queries/fragments, userinfo, header casing/repetition, whitespace and
size bounds, security-evidence leakage, deterministic ordering, nullable
fields, Markdown control characters, and the separation between functional
URLs and sanitized security evidence.

This coverage exposed and corrected two genuine defect groups:

- CSP redaction could consume a trailing semicolon and merge adjacent
  directives; sanitization now preserves directive terminators without
  retaining secret material.
- Dynamic report text could inject headings or break links, tables, and inline
  code through newlines, brackets, parentheses, pipes, or backticks; the
  renderer now narrowly escapes those contexts without redesigning reports.

Stage 8C.2 also added explicit URL/configuration matrices and confirmed the
existing identity policy: fragments and trailing slashes are normalized, host
casing is normalized, while path casing, query values, and query-parameter
ordering remain significant. Tracking-query removal was not introduced. The
deterministic aggregate increased from 22 to 23 checks.

Windows verification also revealed a test-infrastructure reliability issue:
an ephemeral loopback port can be Chromium-restricted and produce
`ERR_UNSAFE_PORT`. A shared test-only allocator now keeps the accepted server
bound, rejects Chromium-restricted ports, retries a bounded number of times,
and fails clearly without weakening browser security or adding a dependency.
All mandatory loopback fixtures use it.

Stage 8C.3 introduced only two optional typed model-facing collaborators,
`analyzePageForQa` and `chooseNavigationLink`, while preserving the existing
Gemini-backed production defaults and BYOK behavior. A local Gemini-free
Chromium check now exercises the real `runSite(...)` and `inspectPage(...)`
workflow through browser lifecycle, content and diagnostics, novelty,
passive-security registration, finding lifecycle, navigation/completion, and
schema-v3 report construction.

The integration scenarios cover page budget 1, navigation budget 0, successful
two-page navigation, redirect aliases sharing one final destination, no
navigable candidates, deterministic finding registration, controlled analysis
failure, resource cleanup, and a successful successor run. The deterministic
`rule|NO_PRIMARY_HEADINGS` finding reaches the canonical report with one
occurrence and no duplicate registration. Failure coverage verifies original
error propagation, no later navigation or misleading report, zero remaining
fixture connections, and isolated subsequent execution.

Candidate-driven browser coverage now explicitly protects
`max-planner-decisions-reached` and stale-reference rejection before browser
execution. The mandatory local-browser gate contains six checks: navigation
policy, Stage 4A, Stage 4B, passive security, candidate investigation, and the
`runSite`/`inspectPage` integration. Its final three stability repetitions all
passed 6/6 in approximately 69–71 seconds.

Final Stage 8C verification passed:

- `npm run typecheck`
- `npm run lint`
- `npm run lint:md`
- `npm run test:deterministic` — 23/23
- `npm run check`
- `npm run test:browser:ci` — 6/6
- three consecutive final six-check browser aggregate runs
- relevant direct lifecycle, candidate, navigation, passive-security,
  reporting, and integration checks
- `git diff --check`

External Aidoc/Gemini execution was not required and remains deliberately
non-mandatory. Schema version 3, fingerprint
`target|select-option|country|equador`, raw mechanically `VERIFIED`
interaction evidence, canonical semantic `INCONCLUSIVE` status,
known-finding suppression, occurrence/evidence association, and JSON/Markdown
agreement remained unchanged.

No separate Stage 8C.4 guarded-safety matrix was required. Existing Stage 4
coverage already exercises network, mutation, navigation, popup, download,
realtime, relevance, and rollback-failure branches, while mandatory browser
acceptance protects disclosure/tab containment and rollback. Deeper expansion
should be reconsidered when a new guarded interaction type or safety event is
introduced.

Non-blocking debt remains intentionally deferred: branch-oriented coverage
instrumentation may be useful later as a diagnostic but does not require a
percentage gate; the current `tsx`/`node:assert` check-script model remains
adequate; no Jest/Vitest migration is justified; tracking-query removal
remains parked; functional URL userinfo/query privacy needs an explicit product
policy; external Aidoc/Gemini BYOK acceptance remains non-mandatory; and
detailed retry, recovery, and partial-failure policy belongs to CQ-020.

## 8D — Error handling and observability

**Completed:** 2026-07-25

Stage 8D completed CQ-020 with one bounded `CheckQuestError` model covering
`CONFIGURATION`, `BROWSER`, `NAVIGATION`, `MODEL`, `MODEL_RESPONSE`,
`REPORTING`, `CLEANUP`, and `INTERNAL`. Safe public messages are separated
from retained internal causes. Browser launch/setup, initial and later
navigation, model requests and responses, report construction and persistence,
cleanup, and CLI configuration now have meaningful boundaries. Unknown
defects remain safely generic rather than exposing internal details.

Reusable `runSite(...)` input is validated before browser or network work
where applicable. Central validation covers numeric budgets and relevant run
invariants, including filesystem- and traversal-safe caller-supplied run IDs.
Default Gemini collaborators explicitly require `GEMINI_API_KEY`;
`GOOGLE_API_KEY` is not silently accepted. Missing credentials fail before
expensive browser work, while fully injected model collaborators remain
Gemini-free. Keys are neither logged nor persisted.

Empty, malformed, schema-invalid, and unsupported model output becomes
`MODEL_RESPONSE` without exposing raw response or parser/schema content.
Read-only Gemini requests permit at most one application-level retry, for two
total attempts, and SDK retries remain disabled. Retry classification is
limited to justified transient statuses and transport failures. Malformed
model output, browser navigation, and guarded actions are never automatically
retried.

Required cleanup operations are all attempted. Operational failures remain
primary if cleanup also fails, while cleanup-only failure becomes `CLEANUP`.
Diagnostics disposal and browser closure remain protected.

Reusable `runSite(...)` now accepts an optional
`onEvent?: (event: RunEvent) => void` observer. The small typed discriminated
union covers run lifecycle, inspection, navigation, model requests and
retries, investigation completion, and terminal success/failure. Observer
failures cannot alter the run, and event data follows bounded URL and privacy
rules without changing functional report URL semantics.

Ordinary reusable production progress no longer writes directly to the global
console. Core production console calls across
run/inspection/planning/analysis/ai were reduced from 88 to 0. CLI-specific
rendering owns terminal progress, while programmatic execution remains silent
when no observer is supplied. Known argument, configured-site, and runtime-URL
errors now produce actionable, privacy-safe `CONFIGURATION` output. Unknown
errors remain generic, and report-persistence failure remains distinguishable
from exploration failure.

Final Stage 8D verification passed:

- `npm run typecheck`
- `npm run lint`
- `npm run lint:md`
- `npm run test:deterministic` — 27/27
- `npm run check`
- `npm run test:browser:ci` — 6/6
- relevant direct error, BYOK, event, `runSite`, browser, and report checks
- `git diff --check`

The six-check browser aggregate had already demonstrated stable repeated
execution during the event slice. Mandatory acceptance required no real
Gemini or Aidoc connectivity.

Stage 8D preserved report schema version 3, canonical finding/evidence
semantics, fingerprint `target|select-option|country|equador`, the raw
mechanically `VERIFIED` Equador interaction versus canonical semantic
`INCONCLUSIVE` result, verified-known suppression, candidate-reference
integrity, guarded containment and rollback, passive-security zero-probe
behavior, JSON/Markdown report semantics, and the fail-fast/no-partial-report
contract.

Deliberate non-goals were partial/failed report schemas, navigation or guarded
action retries, malformed-response retries, cancellation architecture, logger
frameworks, event buses, Sentry/OpenTelemetry or remote telemetry, GUI/web
implementation, broad functional URL-privacy redesign, generic
resource-management infrastructure, and transactional report-file
persistence. A JSON-success/Markdown-write-failure test remains a non-blocking
future test idea rather than unfinished Stage 8D work.

## 8E — Documentation

**Completed:** 2026-07-25

Stage 8E completed CQ-021 by making the repository documentation match the
implemented system after Stages 1–8D.

`README.md` is now the factual operational entry point. It covers current
capabilities, bounded and non-exhaustive exploration, conservative
verification, the safety model, prerequisites and Chromium setup, Gemini BYOK,
configured-site and arbitrary-URL execution, runtime budgets, reports and
evidence, local verification and CI, current limitations, and canonical
roadmap/backlog links. The correction removed or replaced the obsolete
workflow badge, old CLI and testing behavior, stale navigation and start-page
statements, stale action vocabulary and passive-security status, the obsolete
fingerprint and misleading Equador semantic-verification claim, and the
duplicated README roadmap.

`docs/ARCHITECTURE.md` now documents the architectural goals, CLI/reusable-core
boundary, `runSite(...)` lifecycle, `inspectPage(...)`, bounded navigation,
run-level finding lifecycle, candidate-driven investigation, guarded
interaction safety, passive security, Gemini BYOK and retries, `RunEvent`,
`CheckQuestError`, report construction and CLI persistence, required cleanup,
deterministic and Gemini-free testing seams, and deliberate current non-goals.

`docs/CONFIGURATION.md` now documents configured profiles versus arbitrary
runtime URLs, `SiteConfig`, the current `aidoc` profile, CLI
options/ranges/defaults, page/navigation override behavior, exact-host policy,
form-submission policy, profile authoring, `GEMINI_API_KEY`, the lack of
implicit `GOOGLE_API_KEY` fallback, `GEMINI_MODEL`, cross-platform shell
examples, safe configuration failures, and the relationship to programmatic
configuration.

Final Stage 8E acceptance established that all 26 adversarial onboarding
questions are answerable from the documentation and produced a newcomer
verdict of YES. No CQ-021 blocking documentation defects remained. All 47
documentation links and anchors resolved, no local absolute development paths
or stale workflow references remained, and the documentation matched
production for `SiteConfig`, CLI options/ranges/defaults, registered site IDs,
Gemini environment behavior, architecture and safety boundaries, passive
security, schema-v3 reporting, testing/CI, and Equador semantics.

Final verification passed:

- `npm run lint:md` — 0 issues
- `npm run check`
- deterministic aggregate — 27/27
- `git diff --check`

No Aidoc or Gemini connectivity was required.

Stage 8E documentation preserves report schema version 3, fingerprint
`target|select-option|country|equador`, the raw mechanically `VERIFIED`
interaction versus canonical semantic `INCONCLUSIVE` assertion,
bounded/non-exhaustive exploration, candidate-driven investigation, guarded
disclosure/tab containment, passive-security zero-probe behavior, the
fail-fast/no-partial-report contract, explicit `GEMINI_API_KEY` BYOK, and no
implicit `GOOGLE_API_KEY` fallback.

Stage 8E deliberately did not perform later public-productization work.
Product positioning, target personas, adjacent-tool comparisons, competitive
matrices, polished demo/showcase narrative, installer/distribution design,
GUI/SaaS instructions, and public/versioned SDK promises remain deferred to
Stage 10 or later rather than unfinished CQ-021 requirements.

## 8F — Production-readiness and CI review

Perform a deliberate repository-wide readiness pass.

### Explicit non-goals

Do **not** add the following merely to satisfy an automated analyzer:

- Docker/containerization without an actual deployment need;
- a ceremonial build step without a packaging/runtime need;
- additional technologies merely to increase stack breadth.

---

# Stage 9 — Productization boundary

## Goal

Formalize the separation between the reusable CheckQuest core and the interfaces through which users may eventually consume it.

The architecture must remain presentation-agnostic and deployment-agnostic.

Potential front ends include:

- CLI;
- Windows/Desktop UI;
- Web/SaaS.

## Core boundaries to preserve

- run configuration;
- execution engine;
- progress/events;
- findings;
- evidence;
- reports;
- UI/transport separation;
- Gemini BYOK handling.

## Completion criteria

- Core execution does not depend on a specific UI.
- User-supplied Gemini credentials remain isolated from application-owned credentials and are never logged.
- Local desktop and hosted execution remain architecturally possible.

---

# Stage 10 — Release-quality CheckQuest

## Goal

Reach the point where CheckQuest can be confidently placed in front of users outside the development process.

## Scope

- polished CLI/user experience;
- installation/distribution;
- stable configuration;
- versioning;
- reliable reports;
- clean failure behavior;
- example/demo configuration;
- public repository presentation;
- final documentation;
- repeatable CI.

## Final readiness question

> Would we be comfortable putting this version in front of strangers?

---

# Stage completion protocol

A stage is not complete merely because its main code exists.

Before moving to the next stage:

1. Confirm the stage completion criteria.
2. Run the relevant automated tests.
3. Run a representative real-site CheckQuest execution where appropriate.
4. Review generated evidence/findings for regressions.
5. Update `BACKLOG.md`.
6. Update this file's **Current stage** field.
7. Commit the completed stage as a meaningful repository milestone.

---

# Roadmap change log

| Date | Version | Change |
|---|---|---|
| 2026-07-25 | 1.12 | Stage 8E completed CQ-021 with an accurate operational README, a source-linked architecture/programmatic API reference, a bounded configuration/onboarding reference, and coherent navigation among canonical documentation. Final acceptance answered all 26 adversarial onboarding questions, resolved all 47 documentation links and anchors, found no blocking defects or local absolute paths, and passed Markdown lint, the 27-check deterministic quality gate, and `git diff --check` without Aidoc or Gemini connectivity. Schema-v3, exact Equador mechanical-versus-semantic verification, bounded safety, passive zero-probe, fail-fast reporting, and explicit Gemini BYOK semantics remain documented accurately. Advanced the active Stage 8 focus to Stage 8F / CQ-022. |
| 2026-07-25 | 1.11 | Stage 8D completed CQ-020 with bounded structured errors, early reusable-input validation, explicit Gemini BYOK handling, safe model-response failures, conservative read-only retry policy, cleanup precedence, privacy-safe typed run events, reusable-core silence, CLI-owned progress, and actionable configuration failures. Final gates passed 27/27 deterministic and 6/6 browser checks; schema-v3 finding, Equador, guarded-safety, passive-security, reporting, and fail-fast semantics remained unchanged. Advanced the active Stage 8 focus to Stage 8E / CQ-021. |
| 2026-07-25 | 1.10 | Stage 8C completed CQ-019 with reference-safe finding lifecycle integrity, deeper passive-security/reporting/URL/configuration coverage, Chromium-safe loopback allocation, and real local Gemini-free `runSite`/`inspectPage` integration and cleanup coverage. Genuine positional association, CSP directive-terminator, Markdown escaping, and unsafe ephemeral-port defects were corrected. Final gates passed 23/23 deterministic and 6/6 browser checks, including three stable browser repetitions; schema-v3 Equador semantics remained unchanged and no external Aidoc/Gemini success was claimed. Advanced the active Stage 8 focus to Stage 8D / CQ-020. |
| 2026-07-24 | 1.9 | Stage 8B completed CQ-018 with strict no-emit TypeScript and typed ESLint gates, authored-document Markdown lint, a 21-check deterministic regression gate, a stable four-check loopback Chromium gate, separate mandatory browser-free/browser CI jobs, manual-only external Aidoc acceptance, and removal of the unused API Playwright project. All local quality, workflow, and schema-v3 Equador regression sentinels passed; no external Aidoc/Gemini execution was claimed. Advanced the active Stage 8 focus to Stage 8C / CQ-019. |
| 2026-07-24 | 1.8 | Stage 8A completed CQ-017 through the shared guarded-interaction safety boundary, run-level finding lifecycle coordinator, reusable site-run coordinator, extracted page-inspection workflow, thin CLI adapter, and pure report-model builder. Deterministic/local verification and exact schema-v3 report equivalence passed while external Gemini/Aidoc checks remained environment-blocked. Advanced the active Stage 8 focus to Stage 8B / CQ-018. |
| 2026-07-24 | 1.7 | Stage 7 added a separate deterministic passive security/infrastructure posture layer over normal main-document responses, with safe capture/redaction, origin aggregation, schema-v3 JSON/Markdown reporting, zero probe traffic, and successful local-browser, regression, and five-page Aidoc acceptance. Completed CQ-016 and advanced the current stage to Stage 8. |
| 2026-07-24 | 1.6 | Stage 6 completed bounded, auditable breadth/depth navigation and conservative deterministic route-value prioritization, with successful deterministic, browser, Playwright, and five-page Aidoc acceptance. Completed CQ-013 through CQ-015 and advanced the current stage to Stage 7. |
| 2026-07-24 | 1.5 | Stage 5 added the canonical unified finding lifecycle, explicit occurrence and logical verification, conservative rule/model reconciliation, traceable evidence semantics, Stage 3 compatibility projection, and authoritative schema-v2 JSON/Markdown reporting. External Playwright regression passed 3/3. The five-page Aidoc acceptance run `2026-07-24T07-02-21-200Z` passed canonical JSON/Markdown review, validated the assertion-specific verification boundary, and confirmed that the inconclusive Equador typo did not trigger verified suppression. Completed CQ-010 through CQ-012 and advanced the current stage to Stage 6. |
| 2026-07-23 | 1.4 | Stage 4 added candidate-linked guarded disclosure and conventional ARIA tab investigation with exact identities, fail-closed browser containment, deterministic transition evidence, mandatory rollback, known-finding integration, deterministic coverage, and real Chromium localhost acceptance. Real-site trials also confirmed conservative ineligibility rejection and zero-new-request fail-closed behavior. A start-page defect found during acceptance was corrected so the configured start URL is inspected through the same authoritative page-inspection path and consumes the page budget. Advanced the current stage to Stage 5. |
| 2026-07-23 | 1.3 | Stage 3 passed deterministic checks, a five-page real-site Aidoc acceptance run, report/JSON acceptance review, and the final Playwright regression suite; acceptance produced one logical Equador finding with four affected-page occurrences, one actual verification, and three redundant investigations skipped. One Playwright test initially hit a transient timeout, then passed in isolation, and the full suite subsequently passed 3/3; advanced the current stage to Stage 4. |
| 2026-07-23 | 1.2 | Stage 2 passed deterministic checks, navigation-choice integration, a five-page real-site Aidoc acceptance run, and the existing 3-test Playwright regression suite; advanced the current stage to Stage 3. |
| 2026-07-23 | 1.1 | Stage 1 passed deterministic checks, real-site acceptance, and the existing Playwright regression suite; advanced the current stage to Stage 2. |
| 2026-07-23 | 1.0 | Established the canonical 10-stage roadmap and backlog-first planning rule. |
