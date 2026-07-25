# SynchIntro Audit — Phase 6 Findings (Testing)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, static / offline (locked policy). The Jest run below is fully local (uses `__mocks__/firebase-admin.js`), no auth to `pathsynch-pitch-creation`, no production/emulator services started. Report artifact — no audited code modified.

---

## Verdict

Test suite is **large, current, and green** (1,710 passing, 0 failing — above the 1,702 baseline). Critical business paths are well covered. **One structural gap**: the most security-critical tests (P0 share-leak prevention + multi-tenant Gate #7 isolation) are **emulator suites excluded from CI**, so they do not gate merges — which directly compounds F-101.

**Phase 6 finding tally:** P0: 0 · P1: 0 · **P2: 1** · **P3: 2**

---

## Test count (current, measured this session)

- **Offline mock suite: `62 suites, 1,710 tests, 0 failing`** (`npx jest --testPathIgnorePatterns=emulator`, 35s). **Above the 1,702 baseline** — suite runs clean.
- **6 emulator suites NOT run** (require the Firestore emulator, not started per policy): `workspace.emulator`, `workspacePhase2.emulator`, `workspacePhase3A.emulator`, `workspacePhase3B.emulator`, `workspacePhase3C.emulator` (+ one more). Historically these pass (e.g. Phase 2 emulator 26/26, Phase 1 emulator 16/16).
- **Stale artifacts on disk**: `functions/junit.xml` is dated **2026-05-22 (872 tests)** and `functions/coverage/` is from ~May — both far behind current state. They should be regenerated in CI or git-ignored (ties to F-402 clutter).

## Test config (`functions/jest.config.js`)

- `testMatch`: `**/__tests__/**/*.test.js`, `**/*.test.js`
- `testPathIgnorePatterns`: `node_modules`, `dist`, **`\.emulator\.test\.js$`** ← excludes all emulator suites
- `coverageThreshold`: global **50%** (branches/functions/lines/statements)
- Scripts: `test = jest`, `test:coverage = jest --coverage`, `test:ci = jest --ci --coverage --reporters=default --reporters=jest-junit`
- CI (`.github/workflows/ci.yml:42`) runs **`npm test`** = plain `jest` (no `--coverage`, no emulator).

---

## Critical-path coverage (entitlements / sharing / enrichment / SynchGov scoring)

| Path | Coverage | Files |
|------|----------|-------|
| **Entitlements** | ✅ Strong | `enterpriseEntitlement.test.js`, `billing.test.js`, `prospectIntelCredits.test.js`, `workspaceService`/`workspaceResolver` (plan inheritance) |
| **Sharing (P0 area)** | ⚠️ Covered **but emulator-only** | Mock: `pitchGenerator.test.js` (`getSharedPitch`). **Security guarantee** in `workspacePhase3C.emulator.test.js` — "unauthenticated client CANNOT query pitches by shareId / shareTokenHash", "authenticated stranger CANNOT query", "Admin SDK query returns pitch server-side". **These do not run in CI** (see F-601). |
| **Enrichment / sentiment** | ✅ Strong | `seoIntelligenceService` (×3 incl. phase2/phase3), `reviewHealthAnalyzer`/`reviewHealthTask`/`reviewHealthCache`/`reviewHealthEnqueue`, `geminiLeadEnricher`, `dataEnricher`, `competitorValidator`, `outscraperClient`, `spyFuClient`, `techStackDetector`, `enrichmentCache` |
| **SynchGov scoring** | ✅ Very strong (9 suites) | `govScoringEngine`, `govUsaspending`, `govBriefs`, `govDigest`, `govOpportunityEndpoints`, `govcaptureRoutes`, `govcaptureSchemas`, `samGovAdapter`, `govManualUpload` |
| **Prompt-scaffolding sanitizer (PR #43)** | ✅ Covered | `reportSanitizer.scaffolding.test.js` |
| **Multi-tenant isolation (Gate #7)** | ⚠️ Covered **but emulator-only** | `workspacePhase2.emulator.test.js` — contributor cannot mutate owner branding, client cannot set `planTier`/`featureFlags`, cache isolation. **Not in CI.** |

---

## Findings

### [F-601 / P2] Security-critical tests are excluded from CI (emulator-gated)
- **Location**: `functions/jest.config.js:19` (`testPathIgnorePatterns` drops `*.emulator.test.js`); `.github/workflows/ci.yml:42` runs `npm test` = `jest` with no Firestore emulator.
- **Description**: The emulator suites contain the platform's most security-relevant assertions — the **P0 share-leak prevention** (`workspacePhase3C.emulator`: unauthenticated/stranger clients cannot query pitches by `shareId`/`shareTokenHash`) and the **Gate #7 multi-tenant isolation** (`workspacePhase2.emulator`: no cross-tenant branding writes, no client `planTier`/`featureFlags` escalation). Because CI never starts the emulator and the config ignores these files, they run **only when a developer manually starts the emulator locally**.
- **Impact**: A regression to `firestore.rules` — precisely the F-101 hazard (a stray deploy or a rule edit re-opening the share-leak or dropping the entitlement guard) — **would not be caught by CI**. The tests that exist to prevent exactly that are not in the merge gate.
- **Remediation**: add a CI job that boots the Firebase emulator (`firebase emulators:exec --only firestore "jest --testPathPattern=emulator"`) and gate merges on it. This is the single highest-leverage testing fix.
- **Effort**: Medium.

### [F-602 / P3] Coverage threshold not enforced in CI
- **Location**: `functions/jest.config.js:32` (50% global threshold) vs `ci.yml:42` (`npm test` = `jest`, no `--coverage`).
- **Description**: The 50% coverage floor is only enforced by `test:coverage`/`test:ci` (which pass `--coverage`). CI runs plain `jest`, so the threshold is advisory, not gating. (Also, 50% is a modest floor for a billing/entitlements platform.)
- **Remediation**: switch the CI test step to `npm run test:ci` (runs `--coverage` + junit) so the threshold gates and `junit.xml` regenerates fresh each run.
- **Effort**: Quick.

### [F-603 / P3] Known untested paths
- `POST /team/revoke-invite` has **no automated coverage** (flagged TODO in session notes, June 29).
- This audit's new reliability items have no tests because the code doesn't exist / is edge-only: **F-201** (stuck-batch reconciler — not yet built) and **F-202** (`markAllRead` >500-op overflow).
- **Remediation**: add tests alongside the corresponding fixes.
- **Effort**: Quick each.

---

## Positive controls confirmed
- 1,710 mock tests passing, 0 failing — above the 1,702 baseline; suite runs clean and fast (35s).
- Strong coverage on entitlements, enrichment, and all of SynchGov scoring.
- Security-critical share + tenant-isolation assertions **exist** (they're just emulator-gated — see F-601).
- Prompt-scaffolding sanitizer (PR #43) covered.

## Open items carried to the action plan
- **[F-601 / P2]** Add an emulator CI job so P0 share + Gate #7 tests gate merges (compounds F-101).
- **[F-602 / P3]** Make CI run `test:ci` so the coverage threshold gates and junit refreshes.
- **[F-603 / P3]** Cover `/team/revoke-invite`; add tests with the F-201/F-202 fixes.

*End of Phase 6 findings.*
