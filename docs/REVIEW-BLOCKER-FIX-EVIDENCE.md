# Independent-review blocker fixes

Scope: UTF-8 candidate decoding and pending-save edit/navigation locking only. No workflow, schema, auth, mailbox, real CRM, commit, push or deployment changes. The pre-existing loopback QA server was not reconfigured. Commands below ran from this repository; results are actual execution summaries.

## 1. Windows PowerShell 5.1 Unicode regression (RED → GREEN)

```sh
powershell -NoProfile -ExecutionPolicy Bypass -File tests/enquiry-connector-unicode.ps1
```

- RED, exit 1 with the original `Get-Content`: `UTF-8 client name was corrupted before POST. actual=ZoÃ« MuÃ±oz; expected=Zoë Muñoz`.
- GREEN after adding `-Encoding UTF8`, exit 0: `PASS: PowerShell 5.1.26100.9711 UTF-8-no-BOM name, em dash and pound preserved; 1 mocked POST + 1 mocked read-back; no network.`
- The test writes a real UTF-8-no-BOM JSON file containing `Zoë Muñoz` and `Draping — budget £1,500`, runs the actual connector, verifies the outgoing parsed JSON and verified receipt, and shadows both network cmdlets. It uses a dummy token, an `.invalid` origin and an empty isolated Hermes home, not real credentials.
- Initial harness correction: calling the connector with `&` gave mock functions the wrong `$script:` scope. Dot-sourcing corrected the harness; the RED and GREEN above were rerun with the corrected test.
- Both repository and authorised host connector copies received the same one-line fix. Actual byte comparison printed `repo/host connector byte-identical: True`.

## 2. Delayed-response real browser regression (RED → GREEN)

```sh
PLAYWRIGHT_MODULE='C:/Users/compu/AppData/Local/hermes/cache/scratch/enquiry-ui-test/node_modules/playwright/index.mjs' node --test tests/enquiries-save.browser.mjs
```

- Playwright was installed outside the repository; package.json/package-lock.json were not changed by this fix. Reproduce with Playwright available locally, or set `PLAYWRIGHT_MODULE` to its absolute `index.mjs` path. Microsoft Edge must be installed (`channel: 'msedge'`).
- Uses a fresh loopback Vite server, the actual React app, real headless Edge, and intercepted API responses held behind an explicit promise. External resource requests are blocked. No API request reaches a real CRM.
- RED before UI edits, exit 1: **0/4 passed**, each failing `all edit controls must be disabled during pending save`; all 20 inputs/selects/textarea remained enabled. An initial test-count assertion (`>20`) was corrected to `>=20` before this valid RED run.
- GREEN after the minimal disabled fieldset, neutral fieldset CSS and back-button/in-flight leave protection, exit 0: **4/4 passed** (update, creation, conflict and server failure).
- The browser checks every edit control, the last-contact action, Back and Cancel while the response is pending; attempts keyboard input and native button clicks; verifies the name/brief and URL do not change; then releases the response and verifies controls recover. Creation navigates only after success. Conflict reload-with-edits retains the unsaved Unicode name/brief while refreshing an untouched server owner; a failed save retains edits and allows retry.

## Final verification

| Command | Actual result |
| --- | --- |
| `node --test tests/enquiry-connector.test.mjs tests/enquiries-ui-logic.test.mjs` | 9 passed, 0 failed, 0 skipped; exit 0 |
| `npm test` | 54 passed, 0 failed, 0 skipped; exit 0 (includes the actual PowerShell regression on Windows) |
| `python -m unittest discover -s tests -p 'test_enquiry_intake.py' -v` | 4 tests, OK; exit 0 |
| `npm run build` | Vite 6.1.0: 1574 modules transformed; built in 2.84s; exit 0 |
| `git diff --check` | Exit 0; no whitespace errors |

Existing non-failing warnings: Node's experimental `stripTypeScriptTypes` warning and Git's LF-to-CRLF notices. No remaining blocker found within the requested scope. Browser regression is an explicit command rather than part of the default npm glob, so normal npm tests require no new browser dependency.
