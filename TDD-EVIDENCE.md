# TDD evidence

Commands were run from the repository root (Node v26.12.1). Results below are what the runs reported; counts are from the `ℹ tests/pass/fail` summary lines. Node prints an `ExperimentalWarning` for `stripTypeScriptTypes` on every run.

| Step | Command | Result |
| --- | --- | --- |
| 0. Initial slice RED | `node --test tests/enquiries.test.mjs` | Run by the parent before this work (module and migration missing). Not re-run by me. |
| 1. Initial slice GREEN | `node --test tests/enquiries.test.mjs` | 1 test, 1 pass, 0 fail, after adding `migrations/0004_enquiries.sql` and a minimal `createEnquiry`. |
| 2. Core behaviour RED | `node --test tests/enquiries-core.test.mjs` | 8 tests: 1 pass (defaults), 7 fail. `listEnquiries is not a function`, and create had no validation. |
| 2. Core GREEN | `node --test tests/enquiries-core.test.mjs tests/enquiries.test.mjs` | First attempt 8 pass, 1 fail: my own test passed `brand: undefined`, which the validator rejected. Treated `undefined` as absent. Re-run: 9 tests, 9 pass, 0 fail. |
| 3. Dedupe + updates RED | `node --test tests/enquiries-writes.test.mjs` | 17 tests: 4 pass, 13 fail (no dedupe, no `mutateEnquiry`). The 4 that passed were already true: different conversations separate, manual not deduplicated, create-audit rollback, no delete export. |
| 3. Dedupe + updates GREEN | `node --test tests/enquiries-writes.test.mjs tests/enquiries-core.test.mjs tests/enquiries.test.mjs` | 26 tests, 26 pass, 0 fail. |
| 4. Routes/auth/middleware/setup RED | `node --test tests/enquiries-routes.test.mjs` | Test file failed to load (route modules did not exist). 0 tests ran. |
| 4. Routes GREEN | `node --test tests/enquiries-routes.test.mjs` | First attempt 8 tests: 7 pass, 1 fail. The failure was a bug in my test (PATCH call missing the id argument). Fixed the test, no source change. Re-run: 8 tests, 8 pass. |
| 4. Full suite | `npm test` | 45 tests, 45 pass, 0 fail (includes the existing access, concurrency and routes tests). |
| 5. UI logic RED | `node --test tests/enquiries-ui-logic.test.mjs` | Failed to load: `src/enquiryLogic.ts` ENOENT. 0 tests ran. |
| 5. UI logic GREEN | `node --test tests/enquiries-ui-logic.test.mjs` | 7 tests, 7 pass, 0 fail. |
| 6. Two extra behaviours | `node --test tests/enquiries-core.test.mjs tests/enquiries-ui-logic.test.mjs` | 16 tests: 15 pass, 1 fail (case-insensitive owner filter). The added `buildPatch(null, …)` create-body test passed immediately; only the TypeScript type needed widening. After the fix: 16 pass, 0 fail. |
| 7. Final | `npm test` | 53 tests, 53 pass, 0 fail. |
| 7. Final | `npm run build` | Vite build succeeded (1574 modules transformed). |
| 7. Final | `node --test tests/enquiries.test.mjs` | 1 test, 1 pass. The supplied test is unchanged. |

Not covered by automated tests: the React components themselves (no browser test tooling in the repo). Only their pure logic (`src/enquiryLogic.ts`) is tested; the components were verified to compile via `npm run build` and have not been exercised in a browser. `tsc` and `wrangler pages functions build` (run in CI) were not run here.
