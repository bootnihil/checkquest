# CheckQuest guided demo

Use this walkthrough after [installation](../README.md#install-from-source).
It checks a small model-backed run, not detection quality or universal browser
safety. It makes Gemini requests and may incur provider charges.

## 1. Configure the CLI key

In PowerShell:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
```

See [Configuration](CONFIGURATION.md#gemini-byok) for other shells and key handling.

## 2. Run one page without investigation

```sh
npm start -- https://www.example.com/ --pages 1 --navigation-steps 1 --steps-per-page 0
```

Replace the URL with another authorized HTTP(S) target if needed. This requests
one inspected page and disables candidate investigation. Deterministic checks,
diagnostics, passive security, and Gemini analysis still run. No particular
finding count is expected.

## 3. Check delivery and evidence

A successful CLI run exits `0` and prints the report paths under
`agent-results/<run-id>/`. Check:

1. Both `report.md` and `report.json` exist.
2. JSON declares `reportSchemaVersion: "4"` and completed `humanNarratives`.
3. The inspected URL and budgets match the requested run.
4. Findings distinguish evidence from conclusions; inconclusive means review is
   still needed. Focused screenshots exist only when capture policy supports them.
5. The Gemini key is absent from the reports. Do not paste the key into a search
   command that records shell history or prints it.

Read Markdown first; JSON is the machine-readable record. File existence alone
is not a success signal: a late write failure can leave artifacts and exit `1`.
See [Public contracts](PUBLIC-CONTRACTS.md#cli-success-and-failure).

## 4. Try a small investigation budget

For a site you own or are authorized to test, replace this placeholder:

```sh
npm start -- https://your-authorized-site.example/ --pages 3 --navigation-steps 4 --steps-per-page 2
```

Raw-URL profiles allow the supplied hostname and its exact `www` counterpart,
not arbitrary subdomains. Larger budgets offer more opportunity, not exhaustive
coverage or stronger proof. Review the [safety limits](ARCHITECTURE.md#browser-safety)
before enabling investigation on a real site.

For the local GUI, follow [desktop usage](../README.md#run-the-desktop-interface).
It requires at least one investigation step per page, so it cannot reproduce
this zero-investigation setup demo exactly.
