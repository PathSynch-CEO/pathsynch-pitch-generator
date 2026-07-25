# Gate 2 Review — F-703: Frontend Playwright smoke gate

**Work Item 3, F-703.** Built and tested — PR NOT opened, nothing merged. Branch: `fix/f703-playwright-smoke-ci` (off `synchintro-app` `main`). Gate 1: `strategy-review-f703.md`.

---

## What changed (frontend `synchintro-app`)

- **`tests/e2e/smoke.spec.js`** — new, CI-safe. Loads the served app at `/` and asserts: title is SynchIntro; `#auth-container` becomes visible (proves the app JS booted and Firebase resolved to logged-out); `#main-app` + `#onboarding-container` hidden; sign-in/sign-up tabs render; no uncaught page errors on boot. No sign-up, no Firestore writes, no emulator.
- **`.github/workflows/ci.yml`** — replaced the `Tests` step (`echo "TODO"`) in the `test` job with: `npx playwright install --with-deps chromium`, then `npx playwright test tests/e2e/smoke.spec.js --project=chromium` (env `BASE_URL=http://localhost:3000`). The hosting `deploy` job already `needs: [test]`, so **hosting is now gated on the smoke passing**.

**No change to `playwright.config.js`** — it already has a `webServer` block that auto-starts `npx serve -l 3000` and waits for it (`reuseExistingServer: !CI`), so the CI job doesn't manage the server itself.

## Scope / deferral (stated honestly)

Only the smoke spec runs in CI. The existing `auth` / `onboarding` / `pitch` E2E specs — which sign up real users and write Firestore — are **not** run here; wiring them reliably needs the Firebase Auth + Firestore emulators + app emulator-mode wiring + seeded fixtures, a separate follow-up. Those spec files are untouched and remain in the repo.

## Verification

- **Smoke spec passes locally via the exact CI approach:** `BASE_URL=http://localhost:3000 npx playwright test tests/e2e/smoke.spec.js --project=chromium` → **1 passed (21s)**. Playwright's `webServer` started `serve`, Chromium booted the app against normal web config, the logged-out auth UI rendered, zero page errors.
- Asserts on **stable landmarks** (`#auth-container`, `[data-tab=...]`, title) drawn from the app's own existing `auth.spec.js`, not brittle text.
- `ci.yml` YAML parses; `test` job steps = checkout → node → npm ci → npm audit → install chromium → smoke; `deploy` still `needs: [test]`.
- Diff scoped to `.github/workflows/ci.yml` + `tests/e2e/smoke.spec.js` (2 untracked docs in the tree are unrelated, not staged).
- **Honest caveat:** I can't execute the GitHub Actions workflow itself locally — but the smoke spec + `serve` are proven green here, and the CI wiring is the standard Playwright pattern. If the hosted run needs a tweak (e.g., browser-install timing), it's a follow-up commit with no production risk.

## Safety confirmations

- **Nothing deployed. No production reads/writes, no credentials, no product code changed.** Frontend CI + one test file only.
- The hosting `deploy` job (`--only hosting`, on `FIREBASE_TOKEN`) is **untouched** — its deprecated-auth concern is F-702's, tracked separately.
- No self-merge.

## Rollback
Revert the `test` job change (restores `echo "TODO"`) and delete `smoke.spec.js`. Nothing deployed; no data/credential.

## Merge routing
Frontend CI/infra → **Williams** (or Charles as infra). I do not merge.

---

**STOP — awaiting your go-ahead to open the PR** (`synchintro-app`, to Williams). On approval: commit → push → PR. I won't merge.
