# CheckQuest roadmap v2 - Public landing and local product shell

**Current stage:** G2 - Local GUI MVP. In development; not complete or accepted.
**Available interface:** CLI. No usable desktop GUI yet.
**Started:** 2026-07-26. [Roadmap v1](ROADMAP.md) is complete.
**Working backlog:** [BACKLOG.md](BACKLOG.md).

## Goal and constraints

Make the existing engine discoverable and usable without requiring end users
to understand Git, npm, or CLI workflows. This is a product-shell roadmap,
not permission to expand browser authority or QA intelligence.

Keep the core presentation-agnostic and deployment-agnostic. Reuse the shared
application, event, error, report, and narrow model-collaborator boundaries.
Gemini is BYOK; keys remain ephemeral and must not enter public outputs.
The static landing page is not hosted execution. Prefer a thin local product
before SaaS, and let external evidence determine work after G7.

Finding identity, verification, evidence, safety, and compatibility contracts
remain authoritative. Current schema evolution is documented in
[Public contracts](PUBLIC-CONTRACTS.md), not redefined for GUI convenience.

## G0 - Public landing and brand presence

**Completed:** 2026-07-26.

Delivered the responsive static GitHub Pages front door with honest product
scope, branding, repository/documentation links, and desktop/mobile acceptance.
No accounts, backend, billing, cloud browsers, or hosted scans were introduced.
Product visuals must reflect real behavior.

## G1 - GUI/core boundary

**Completed:** 2026-07-26.

Delivered `startCheckQuest(...)`: target/budgets, transient credentials, optional
per-run model, ordered events, categorized errors, cancellation, persisted
reports, and absolute artifact paths. The CLI delegates through it; internal
Electron controller code is wired to the same boundary. G1 completion does not
establish a usable desktop interface.
Cancellation preserves mandatory rollback and cleanup; cleanup cannot replace
an earlier failure. Application outputs redact the key and remove nested causes.

Historical acceptance passed the then-current 29 deterministic and seven local
browser checks, direct application-browser integration, and external regression
3/3 once network access was available. Those counts are historical, not the
current test inventory. Active writes remain cooperative; partial/transactional
report delivery and packaged storage locations were not G1 requirements.

## G2 - Local GUI MVP

**Status:** In development; no usable desktop interface yet. G2 is not complete
or accepted.

G2 aims to provide target/budget/key entry, Run, Cancel, and basic progress/status.
Electron main/preload/renderer components, validation, preflights, session-key
handling, and application wiring exist as internal development work. They do not
yet amount to a usable GUI. The internal form has no model selector; the
application/CLI model seam remains.
No accounts, database, cloud execution, or SaaS features belong to this stage.

Earlier G2 development and report-review work exposed report-trust issues,
addressed through validated
structured finding identity, conservative verification, focused evidence,
shared GUI/report summary accounting, and run-scoped item navigation. Generic
page screenshots do not establish finding evidence. Repeated findings without
trustworthy shared identity remain separate. This work did not start G4's
in-app viewer or authorize further report editorial work.

The human-report readability gate passed live validation on 2026-08-12, with
41 deterministic checks reported passing. Severity-policy follow-up remains
**deferred / not warranted with current signals** and requires explicit
reauthorization. Do not reopen either gate without a material regression.

### Implementation and acceptance are separate

Existing internal component work includes bare-domain normalization, masked key
entry and remote
credential preflight, session-memory key reuse, editable budgets, basic
readiness/status, and target reachability/canonicalization preflight.
Contextual missing-field guidance and native-menu cleanup remain in the G2
polish bucket. See the [desktop development reference](CONFIGURATION.md#desktop-development-reference)
for code-level contracts. These components do not constitute an available GUI,
prove visual/accessibility acceptance, or close G2. The [polish bucket](BACKLOG.md#g2-gui-configuration-polish-bucket)
retains item order and acceptance intent.

Current hardening also includes popup-first-request containment, pinned document
identity, password suppression beyond the field sample, collision-safe fallback
finding identity, owned Gemini deadlines, and the `gemini-3.5-flash-lite` default.
New report delivery uses schema v4 with persisted required exploratory narratives;
historical v3 remains supported. These are implemented behavior, not broader
claims of production readiness.

### Remaining gate

1. Confirm the ordered configuration-polish acceptance criteria, including
   measured contrast, focus, and section hierarchy; do not reimplement features
   merely because an old checklist says NOW.
2. Complete the remaining two independent representative **10/10/10**
   model-backed acceptance runs. Review reconciliation, evidence, verification,
   report references, filenames, page references, and GUI/report accounting.
   A major trust defect in Run 1 blocks Run 2 until fixed. Different legitimate
   navigation paths/counts alone are not defects; no third run for reassurance.
3. Reproduce and resolve or explicitly disposition the recorded Electron
   smoke-process crash in the normal acceptance environment.
4. Update documentation/status and explicitly decide whether G2 is accepted.

A previously reported bounded one-page Gemini 3.5 Flash-Lite acceptance success
is narrower than this gate and does not replace the two representative runs.
This documentation audit does not rerun scans or certify those historical results.

**G2 is complete when:** a usable local desktop GUI is delivered; its
configuration is understandable, safely validated, and accepted along with its
accessibility behavior; two independent representative **10/10/10** runs produce
trustworthy reconciled output and consistent accounting; the Electron smoke
failure is resolved or explicitly dispositioned; no G2-blocking desktop runtime
issue remains; and G2 is explicitly accepted. Quick/Standard/Thorough presets
are optional later work, with explicit editable budgets.
Do not begin G3 merely because an implementation checklist is exhausted.

## G3 - Live run experience

Render structured events as understandable progress. Completion requires useful
status, safe cancellation/cleanup, no secrets in UI events, and isolation of
observer/UI failures from execution. Existing basic status does not by itself
close this stage.

## G4 - Findings and report viewer

Build a dedicated completed-run interface showing severity, verification,
affected pages, evidence, and investigation outcome. Users must be able to open
JSON/Markdown reports or their folder. Capture at least one representative real
run as reusable product evidence from observation through investigation and
verification; no mocked product proof. Existing generated reports are not the
in-app viewer.

## G5 - Saved local configurations

Save reusable site/run configuration as an optional convenience. Named profiles
must not become a prerequisite for raw URLs. Keys remain ephemeral by default;
persistent secrets require proper OS-level secure storage before being offered.
Current session-memory reuse is not persistent credential storage.

## G6 - Windows packaging

Deliver install - launch - configure - run without Git, Node, npm, or manual
browser setup. Choose packaging technology here after the shell is proven.
The source `desktop:build` command is not a packaged installer.

## G7 - External usability and product acceptance

### External usability

New users must independently install, understand purpose/safety, configure a
target and BYOK key, run, understand progress/failure, interpret findings and
verification, and locate reports. Required undocumented explanations are product
friction.

### Controlled evaluation

Use a small deterministic local fixture with seeded defects, safe lookalikes,
repeated occurrences, inconclusive cases, useful candidate-linked interactions,
and interactions the agent must refuse. Record expected findings detected/missed,
obvious false positives, verification correctness, reconciliation, safety refusals,
and material run-to-run instability. This does not establish universal accuracy
or recall on arbitrary sites.

### Model dependency

Record availability, latency, rate limits, cost, provider changes, and output
variability. Gemini remains the production provider; another provider is not
required unless evidence justifies promoting that backlog item.

G7 closes when outsiders can use the core workflow with acceptable friction,
the controlled fixture has been exercised/reviewed, and dependency/repeatability
risks can inform the next product decision.

## Product validation gate

Stop after G7 and explicitly choose direction before Roadmap v3. Possible needs
include monitoring/history, authenticated exploration, regression-test generation,
additional providers, partial reports, or CI/release integrations. They are not
committed v2 requirements.

Also explicitly decide licensing/distribution from product evidence: remaining
source-visible/proprietary, open source, open core, or another model. A public
repository does not imply a license grant.

## Explicit exclusions

V2 does not authorize SaaS accounts/teams/billing/cloud workers, hosted execution
from the landing page, schedules/notifications, arbitrary action expansion, new
passive-security scope, authenticated workflows, multi-provider support,
generated tests, automatic updates, extensions, universal accuracy claims, or
incompatible report changes for GUI convenience. Record new needs in the backlog
and preserve stage order.

The purpose of Roadmap v2 is simple:

> Give CheckQuest a clear public front door, expose the CheckQuest we already
> built to humans, prove its core behavior in a bounded and honest way, then
> learn what deserves to be built next.
