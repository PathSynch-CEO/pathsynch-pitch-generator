# Changelog — July 7, 2026

Session close-out. Themes: resolved the multi-day Gemini "Generate Brief" outage, took SynchGov live in production for the first time, and staged a cross-repo enterprise-entitlement fix (PRs open, awaiting Williams). Docs updated: `functions/CLAUDE.md`, `synchintro-app/CLAUDE.md`, `functions/SYSTEM_BIBLE.md`, `SynchIntro_Master_Implementation_Prompt.md`, this changelog.

---

## fix: Gemini API key root cause + native-key fix (RESOLVED, deployed, verified)

**Symptom:** SynchGov "Generate Brief" returned `API_KEY_INVALID` (400, `generativelanguage.googleapis.com`, model `gemini-2.5-flash`) despite three key replacements and forced redeploys.

### Root cause (two compounding faults)
1. `functions/.env` **line 19 `GEMINI_API_KEY`** held a **foreign key** belonging to project **`pathconnect-442522`** ("API key 11", uid `f6ced1e7…`, unrestricted) — present since early setup. It passed a direct curl test because an API key authenticates to *its own* project (and `pathconnect-442522` has the Generative Language API enabled), but it was the wrong key for this app. It finally died when Google's **`AQ.`-format key migration** rotated the console keys.
2. **Line 36 `GEMINI_API_KEY_SYNCHINTRO_SERVER` was a decoy** — no code path reads that variable. Three replacement keys had been pasted there in error, so the real `GEMINI_API_KEY` (line 19) never received a live key.

### Diagnosis (read-only, no secret values printed)
- SHA-256 + first4/last4/len fingerprinting proved `.env` line 19 == the deployed value **byte-for-byte** across all 14 Cloud Run services.
- The deployed value matched **none** of the 6 active keys in `pathsynch-pitch-creation`.
- `gcloud services api-keys lookup <keyString>` resolved the string to its owner: project `pathconnect-442522`.
- `gcloud` on the Windows box required `CLOUDSDK_PYTHON` pointed at the SDK's bundled python (Store Python stub breaks it).

### Fix
- Created a fresh **native** key in `pathsynch-pitch-creation`, **restricted to `generativelanguage.googleapis.com`** — uid **`cb0a6579-099d-47ae-ac5a-59c75368cec4`** (fingerprint `AIza…RQAo`).
- Placed on **line 19 `GEMINI_API_KEY`**; **commented out line 36** decoy.
- Verified: direct `generateContent` on `gemini-2.5-flash` → **HTTP 200**. Deployed and confirmed live.

### Canonical facts recorded (CLAUDE.md + SYSTEM_BIBLE invariants #10–#11)
- All Gemini calls read `process.env.GEMINI_API_KEY` via `@google/generative-ai` SDK, `?key=` auth, `v1beta`. No Secret Manager binding; `GOOGLE_AI_API_KEY` / `GEMINI_API_KEY_SYNCHINTRO_SERVER` are not read.
- The key must be native to `pathsynch-pitch-creation`.
- Failure behavior: **Market Intel degrades silently** (template fallbacks); **SynchGov briefs throw**; Gov scoring is rule-based for 5 of 6 dimensions, Gemini only refines the 30-pt solution-match.

---

## feat: SynchGov went LIVE (first production run ever)

- **PathSynch Labs profile created in production** — profile ID `71cBEyoTik0g2I77OUZV`.
- **First live SAM.gov sync: 25 opportunities.**
- **Full pipeline verified end-to-end:** sync → normalize → Pass 1 scoring → USAspending Pass 2 (triggered at score **≥45**) → AI briefs. Gemini semantic re-score confirmed correcting rule-based **42–47** down to **Poor Fit**.
- **New env deployed:** `SAM_GOV_API_KEY` (line 128), `GOVCAPTURE_SCHEDULER_SECRET` (line 121).
- ⏰ **`SAM_GOV_API_KEY` expires ~Oct 3, 2026 — renewal reminder needed.**

---

## fix: enterprise entitlement mapping (PRs OPEN — awaiting Williams)

Enterprise plan fell through to **starter/free** in 4+ places:
- `js/pages/market.js:843` ternary
- tier gates at lines `1151` / `1181` / `1273`
- `claude.js` `NARRATIVE_LIMITS` + `FORMATTER_PLAN_ACCESS` arrays
- frontend `settings.js` `isFree` (`price === 0` check — enterprise custom pricing reads as 0)

**Branches:** backend **PR #44** (`pathsynch-pitch-generator`, `fix/enterprise-entitlement-mapping`); frontend **PR #24** (`synchintro-app`, `fix/settings-enterprise-not-free`). **1702 tests passing.**

⚠️ **Production may be running the unmerged fix branch** — both repos' working trees are on the fix branches. `main` lags production until #44 / #24 merge.

---

## Also shipped / confirmed this window (July 6–7)

- **PR #43** — prompt-scaffolding leak fix. Verified live (clean reports).
- **PR #23** — P0 share-leak reconciliation (`synchintro-app`).
- **Firebase browser key** API restrictions fixed — added Token Service + Firebase Installations. **Auth 403 resolved.**

---

## Deploy gotchas codified (SYSTEM_BIBLE invariants #10–#11)

| Gotcha | Fix |
|--------|-----|
| 2nd-gen functions deploy **skips on `.env`-only changes** | `firebase deploy --only functions --force`, or touch a code file |
| `User code failed to load / Timeout after 10000` | set `FUNCTIONS_DISCOVERY_TIMEOUT=120` and retry |
| **CI (GitHub Actions) deploys without `.env`** — can wipe env vars | keep env-carrying deploys **local** until Secret Manager migration |
| `gcloud` broken on Windows box (Store Python stub) | set `CLOUDSDK_PYTHON` → SDK's bundled python |

---

# Evening Session (July 7, 2026)

Read-only recon → two build tracks (SynchGov UX, Market Intel quality) → a Secret Manager migration plan → local `main` reconciliation. No merges, deploys, or pushes to `main`. Backend test baseline confirmed **green at 1,695** before changes (6 above the June-29 expectation of 1,689 — extra tests added on `main` since).

## fix: SynchGov UX batch — **PR #26** (`synchintro-app`, `fix/synchgov-ux-batch-0707`, off clean `origin/main`)

Six fixes, each root-caused with a file:line citation:

| # | Issue | Fix | Citation |
|---|-------|-----|----------|
| a | Scored-zero looked like unscored | Added `isScored` (has `fit` + numeric score) → distinct "Unscored" chip vs numeric bar; low-score text darkened | `synchgovOpportunities.js:585,606` |
| b | Detail tab indicator wouldn't move | `setDetailTab` re-rendered only the body; now toggles `sg-dtab--active` across `[data-tab]` buttons | `synchgovOpportunities.js:417,695` |
| c | Checklist tab rendered nothing | Now surfaces the profile's active compliance questions (unevaluated) when no brief exists | `synchgovOpportunities.js:1023` |
| d | "Unnamed Profile" / raw ID `71cBEyoTik0g2I77OUZV` | Dropdowns read `p.name`/`p.agencyName` but the field is `profileName`; now prefer `profileName` | `synchgovOpportunities.js:484`, `synchgovSettings.js:72` |
| e | Business Description didn't persist | Save writes `filters.description` (persisted — `filters` is whitelisted in `schemas.js:41`; top-level `description` is not); load read `p.description`. Now reads `filters.description` back, mirroring `companyWebsite` | `synchgovProfiles.js:198` |
| f | Chip inputs Enter-only | Added `_onTagPaste`/`_addTagsBatch` (comma/newline paste-split, NAICS-validated, deduped) + comma-commit + Enter-to-commit tooltip | `synchgovProfiles.js:748,785,857` |

All 6 **fixed** (none skipped). `node --check` passes on all 3 files. The Playwright e2e suite (auth/onboarding/pitch) has **no SynchGov coverage** and needs a live Firebase session — not run; verified by code review.

## fix: Market Intel report quality — **PR #46** (`pathsynch-pitch-generator`, `fix/market-intel-report-quality-0707`, off `origin/main`)

| Item | Fix / decision | Citation |
|------|----------------|----------|
| a. Top demographics boxes hardcode 5,000,000 / $55K / 65% | `getMockDemographics()` fabricates these on Census-API fallback (`census.js:328,329,339`). **Chose remove over wire** — the real data shown elsewhere is a different metric set (age/education/ZIP), so nothing to wire. Flags estimated data + nulls the fabricated display fields (`demographicsEstimated`). Internal `marketSize`/growth calc untouched. | `market.js:1146,1424` |
| b. SWOT "0 of 7 high-opportunity leads" | Magic `>70` cutoff matched no band. Replaced with `countHighOpportunityLeads()` at the Strong threshold `>=60`, matching `opportunityScorer` bands. **Test pins the corrected count** (incl. the exact 7-Strong-leads regression). | `swotGenerator.js` |
| c. "metric not tracked/available" weakness themes | Added `isMetricUnavailableTheme()` filter in `generateWeaknessThemes`. **Test added.** | `market.js:467` |

New `functions/tests/marketReportQuality.test.js` (8 tests). Full suite after: **1,703 passed / 61 suites, 0 failing** (baseline 1,695 + 8 new; zero regressions).

## chore: `synchintro-app` local `main` reconciliation (verified)

Local `main` had diverged **+4 / −2** from `origin/main` (3 empty "Merge branch 'main'" bubbles + `35e4025` getAnalytics fix; missing the P0 share-leak reconcile `f2e15cc` and `da4feec`).

- `35e4025` verified **already represented upstream** (`git cherry origin/main` → `-`; content-diff confirmed the field-projection lines present on `origin/main`) → **no PR needed**.
- `git reset --hard origin/main` → local `main` now identical to `origin/main` (at `295e587`). **P0 fix `f2e15cc` restored locally**; 3 noise merges dropped.
- Safety branch `save/getanalytics-fix` (`35e4025`) created, then **deleted (`-D`) after confirming the change is upstream**. Nothing lost.

## `.env` hygiene findings (flagged, NOT fixed)

- ⚠️ **`PM_GAUTH_CLIENT_ID` — lines 90 & 112 hold *disagreeing* values.** `dotenv` keeps the first (line 90); line 112 is dead **and** wrong. Resolve deliberately.
- `PM_GAUTH_CLIENT_SECRET` (91/113) and `VERTEX_SEARCH_DATA_STORE_ID` (12/35) are duplicated but identical (harmless).
- Line 36 (`#GEMINI_API_KEY_SYNCHINTRO_SERVER`) confirmed commented out. `SendGrid` var confirmed `GOVCAPTURE_SENDGRID_API_KEY` at `digestSender.js:136`.

## docs: Secret Manager migration plan (plan only)

`docs/SECRET_MANAGER_MIGRATION_PLAN.md` (on the PR #46 branch): migrates `GEMINI_API_KEY`, `SAM_GOV_API_KEY`, `GOVCAPTURE_SCHEDULER_SECRET`, `GOVCAPTURE_SENDGRID_API_KEY` via v2 `defineSecret` + per-function `secrets[]`; deploy sequence + rollback. **Explicitly EXCLUDES `SERPER_API_KEY`** (.env-only — binding it triggers the known deploy-conflict invariant). Companion section migrates CI off deprecated `FIREBASE_TOKEN` → `GOOGLE_APPLICATION_CREDENTIALS`.

## Follow-up list

1. **Decision pending:** none — `synchintro-app` `main` reconciled this session.
2. **Merge PR #26** (SynchGov UX) and **PR #46** (Market Intel + migration plan) after review.
3. **PR #44** merge reconciles backend `main` with production (Williams).
4. **`.env`:** resolve the conflicting `PM_GAUTH_CLIENT_ID` duplicate (lines 90/112) + the two identical dupes.
5. **SendGrid:** place the `SG.`-prefixed `GOVCAPTURE_SENDGRID_API_KEY` + redeploy, then run the gov digest send-test.
6. Execute the Secret Manager migration when scheduled; consider Workload Identity Federation (keyless CI) as a follow-up.
