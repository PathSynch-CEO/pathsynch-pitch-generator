# Gate 1 Strategy Review — F-703: Wire a headless Playwright smoke gate into frontend CI

**Work Item 3, F-703 (unblocked — no secrets needed).** Gate 1 STOP: strategy only, no branch cut, nothing edited. On approval I build (frontend repo), then STOP at Gate 2 before the PR → Williams.

---

## Context — why this change

`synchintro-app`'s CI `test` job has its Tests step stubbed as `echo "TODO - add CI-compatible test suite"`, and the hosting `deploy` job `needs: [test]`. So **hosting ships gated only by `npm audit`** — no functional check at all. A Playwright suite exists (`tests/e2e/*.spec.js`) but isn't wired in.

## What I found (grounds the scope)

The 3 existing specs — `auth.spec.js`, `onboarding.spec.js`, `pitch.spec.js` — are **full Firebase-auth E2E flows**: they sign up real users, complete the onboarding wizard, and create pitches (writing Auth + Firestore). Running them in CI would require standing up the Auth **and** Firestore emulators, wiring the app to emulator mode (`?emulator=true`), and likely seeded data — and they're explicitly flaky-prone (`playwright.config.js` sets `retries: 2` on CI "for network flakiness"). That is a large, flaky undertaking — **not** this PR.

## Recommended scope — a smoke gate now, full E2E deferred

**This PR:** convert the `echo "TODO"` into a real **headless smoke gate** that needs no Firebase auth/emulator:
- Add `tests/e2e/smoke.spec.js` — CI-safe checks against the served static site: `/` loads, the auth/login UI renders, no fatal page/console errors. No sign-up, no Firestore writes.
- Rework the frontend CI `test` job to actually run it: `npm ci` → `npm audit` → `npx playwright install --with-deps chromium` → start `npx serve -l 3000` in the background → `BASE_URL=http://localhost:3000 npx playwright test smoke.spec.js --project=chromium`.
- The hosting `deploy` job already `needs: [test]`, so this **gates the hosting deploy** — F-703's stated goal.

**Explicitly deferred to a follow-up (out of scope here, stated honestly):** the auth / onboarding / pitch E2E specs. Wiring those reliably needs Auth+Firestore emulator orchestration + app emulator wiring + seeded fixtures, and flaky-suite hardening. I will NOT run them in CI in this PR (the CI command targets `smoke.spec.js` only; the other specs stay in the repo, unrun by CI for now).

**Why this is the right cut:** it moves the frontend from "no functional gate" to "a real gate that catches gross breakage" in one safe, low-flake step — genuine momentum — without pretending to deliver full E2E coverage it can't reliably provide yet.

---

## Gate 1 required answers

| Question | Answer |
|---|---|
| **Secrets needed?** | **None.** The smoke test loads the public login page using the public Firebase *web* config (read-only init); it never authenticates or writes. No GitHub Secret to provision. |
| **Flaky risk?** | Low. Smoke = static page load + DOM assertions, no auth/network writes. The flaky specs (auth/onboarding/pitch) are the ones being *deferred*, not run. `serve` is deterministic. |
| **CI cost?** | One `npx playwright install chromium` (cached by setup-node's npm cache + Playwright's browser cache) + a few-second smoke run. |
| **What gates the deploy?** | The existing `deploy: needs: [test]` — by making `test` actually run the smoke suite, hosting deploys only if smoke passes. |

## Blast radius
- Frontend-only: one new spec file + the `test` job in `synchintro-app/.github/workflows/ci.yml`. No product code, no deploy, no secrets.
- The frontend `deploy` job (hosting, `--only hosting`, on `FIREBASE_TOKEN`) is **not touched** here — its auth deprecation is F-702's job, tracked separately.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Smoke spec asserts on a selector that differs in prod build | I'll validate the spec **locally** against `npx serve` before the PR, asserting on stable landmarks (auth container / a known element), not brittle text. |
| `serve` not ready when Playwright starts | Add a readiness wait (Playwright `webServer` config or a wait-on step) so the run doesn't race the server. |
| Playwright browser install slow/flaky in CI | `--with-deps chromium` only (one browser); cached. Non-secret, revertible. |
| CI can't be fully exercised locally | I'll prove the *smoke spec + serve* green locally; the CI wiring is standard. If the GH run needs a tweak, it's a follow-up commit — never a prod risk. |

## Rollback
Revert the `test` job change (restores `echo "TODO"`) and delete `smoke.spec.js`. Nothing deployed; no data/credential.

## Build plan (after approval)
1. Branch `fix/f703-playwright-smoke-ci` off `synchintro-app` `main`.
2. Add `tests/e2e/smoke.spec.js` (CI-safe smoke assertions).
3. Rework the `test` job in `synchintro-app/.github/workflows/ci.yml` (install browsers + serve + run smoke).
4. Prove locally: `npx serve -l 3000` + `npx playwright test smoke.spec.js` green; confirm existing specs untouched; YAML parses; diff scoped.
5. Gate 2 (`prd-review-f703.md`), then STOP → PR to Williams.

## Merge routing
Frontend CI/infra → **Williams** (or Charles as infra). I do not merge.
