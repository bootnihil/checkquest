# CheckQuest Agent Instructions

## Canonical planning

- `docs/ROADMAP.md` is the canonical execution roadmap.
- `docs/BACKLOG.md` is the canonical backlog.
- Before starting implementation work, read both files.
- Work only on the current roadmap stage unless the user explicitly changes scope.
- New ideas, refactors, tooling changes, or features should normally be added to the backlog rather than implemented immediately.
- A true blocker may interrupt the current stage. A non-blocking defect or improvement should be backlogged when appropriate.
- Do not silently reorder roadmap stages.

## Development principles

- CheckQuest must remain production-safe and non-destructive when interacting with public websites.
- Keep the reusable core presentation-agnostic and deployment-agnostic.
- Do not couple core execution logic to the CLI, a future Windows UI, or a future Web/SaaS frontend.
- Preserve clear boundaries around run configuration, progress/events, findings, evidence, reporting, and execution.
- Gemini integration uses a BYOK model. Never log API keys or expose them in reports, output, source control, or diagnostics.
- Do not persist user API keys unless an explicit future requirement and design decision introduces secure persistence.

## Scope discipline

- Make the smallest coherent change needed to complete the requested work.
- Do not modify unrelated files.
- Do not implement speculative improvements merely because they are nearby.
- Do not add Docker, build steps, dependencies, frameworks, or tooling solely to satisfy an analyzer score or generic best-practice checklist.
- Preserve existing behavior unless the requested task intentionally changes it.

## Validation

- After code changes, run the relevant existing tests and checks.
- When appropriate, run a representative real-site CheckQuest execution.
- Report what was changed, what was tested, and any remaining uncertainty or failure.
- Do not claim a test passed unless it was actually run successfully.

## Git safety

- Never stage files unless explicitly asked.
- Never create a commit unless explicitly asked.
- Never push unless explicitly asked.
- Never amend, reset, rebase, force-push, or otherwise rewrite Git history unless explicitly asked.
- Do not modify unrelated untracked files.
- Always report the final Git status after implementation work.

## Documentation

- Update README or other documentation only when the change creates a meaningful project milestone or makes existing documentation inaccurate.
- Keep detailed planning information in `docs/ROADMAP.md` and `docs/BACKLOG.md`.

## Workspace hygiene - mandatory

- Keep `C:\Dev` and this project root free of ad-hoc task output. Before a task
  creates temporary files, establish `<project-root>\workdir\<task>\` and pass
  it explicitly to tools for output, working, or temporary directories.
- Put temporary scripts, screenshots, validation/review output, extracted files,
  experimental checkouts, debugging logs, and document-processing intermediates
  in `workdir/`. Never put them in sibling directories, the project root, source,
  or documentation directories.
- Keep genuine source, documentation, configuration, official tests, assets,
  operational state, and intentional product deliverables in their proper places.
- Workdir may contain valuable reference repositories, diagnostics, and retained
  experiments. Never treat it as safe to delete. Preserve active files and workflows.
- Use standard operating-system temp storage when a tool requires it. Do not
  change system-wide `TEMP` or `TMP` settings.
- Before finishing, inspect `C:\Dev` and this project root for newly created scratch
  artifacts, verify workspace ignore rules, and report unresolved exceptions.
