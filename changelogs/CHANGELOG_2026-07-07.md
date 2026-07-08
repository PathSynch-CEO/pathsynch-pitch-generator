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
