# SynchIntro Remediation — P1 Fix Session

**For a FRESH Claude Code session (Opus 4.8, high effort) at the SynchIntro workspace root.**
**This is a FIX session — it writes code. It is NOT the read-only audit. Different rules apply.**
**Evidence: `SYNCHINTRO_AUDIT_REPORT_2026-07-14.md` and `phase1`–`phase8-findings.md` in this repo.**

---

## Session Contract (read first, obey throughout — this wins over anything later in this file)

1. **Ask-first permissions. NEVER enable bypass mode.** If bypass-permissions mode is on at session start, STOP and tell Charles to turn it off (Shift+Tab) before doing anything else. A documented prior incident saw a bypass-mode session self-merge entitlement PRs and override the review gate — that must not recur.
2. **One fix per branch**, cut from `main` (e.g. `fix/f201-stuck-batch-reconciler`). Never combine unrelated fixes on one branch. Never commit directly to `main`.
3. **HARD STOP before every merge. You do not merge. You do not self-merge.** When a fix is built and tested, prepare the PR, then STOP and hand it off. Product-code PRs are merged by **Williams** — this applies to everything here (rules, CI, entitlements, reconciler code).
4. **Two-gate review per fix.** Before building: write a **Gate 1 strategy review** (`strategy-review-f2xx.md` for that fix) — approach, blast radius, what could go wrong, rollback — then STOP for approval. After building, before the PR: a **Gate 2 review** (`prd-review-f2xx.md`) — what changed, test results, how verified — then STOP again. No fix skips a gate.
5. **Phased, pause-and-report.** ONE work item at a time, in the order below. Finish fully through the Gate 2 stop before touching the next. Do not read ahead and start item 2 while item 1 is open.
6. **Credentials/production: stop-and-surface BEFORE acting, never after.** Anything using a credential, the on-disk service-account key, or touching production (deploys, `functions:list`, Rules API) STOPS and surfaces first. No production writes at all this session — fixes land in branches and PRs; deploys happen later, after merge, separately.
7. **Windows / PowerShell**: sequential commands only, never `&&`. If a command comes back malformed, rewrite it; don't force it.
8. **Do not "fix" known-intentional items**: `STRIPE_SECRETE_KEY`, `buisnessName`, `buisnessAddress`, the dual Instantly integrations (`/instantly/*` vs `/instantly-market/*`), the `gemini-2.5-flash-lite` string inside vendored `node_modules/@firebase/ai`.
9. **New behavior ships with tests in the same PR.** Suite baseline: 1,710 green.

Confirm you understand this contract and that bypass mode is OFF, then begin Work Item 1 — and only Work Item 1.

---

## Infrastructure Constants
- Firebase project `pathsynch-pitch-creation`; GCP `pathconnect-442522`
- Backend repo `pathsynch-pitch-generator` (Cloud Functions); frontend `synchintro-app`
- Gemini (if touched): PRIMARY `gemini-3-flash-preview`, ADVANCED `gemini-3.1-pro-preview`, SIMPLE `gemini-2.5-flash`; BANNED `gemini-1.5-*`, `gemini-2.0-*`, `gemini-3-pro-preview`; 3.x calls use `thinkingBudget: 0` + `indexOf('{')` JSON extraction
- Deploy workaround: `FUNCTIONS_DISCOVERY_TIMEOUT=120` (currently Windows-local only — relevant to Work Item 3)
- Merge convention: Williams merges product code; Charles self-merges Build OS / infra / docs only

---

## Work Item 1 — F-201: Stuck-batch reconciler (FIRST)

**Why first:** the one P1 with a real production incident behind it. Users hit "Maximum 5 active batches" (429); today's only remedy is a human running the untracked `clear-stuck-batches.js` with hardcoded whitelist IDs.

**Current state (verify before changing):** cap check ~`prospectIntelRoutes.js:66-84` counts batches in `queued`/`processing` and returns 429 at 5. A batch stuck in `processing` never ages out, permanently consuming a slot. No scheduled reconciler exists.

**Fix:** a scheduled Cloud Function (`onSchedule`) that ages stale `processing`/`queued` batches to `failed` (or the schema's terminal state) past a sensible staleness threshold, so the 5 slots self-heal.

**Gate 1 must answer:** staleness threshold (stuck vs. legitimately long-running — inspect real batch durations)? terminal state the schema expects, and any downstream readers of it? does aging-out need user notification or child-doc cleanup? schedule cadence? confirm scope is Prospect Intel batches only.

**Build:** function + unit tests (stale batch reconciled; fresh in-flight batch NOT touched; cap frees after reconciliation). Existing suite stays green. Gate 2, then STOP for PR → Williams.

---

## Work Item 2 — F-101 + F-601 bundled: unify rules ownership + gate it in CI

**Why bundled:** F-101 is the loaded gun — both repos can deploy `firestore.rules` to the same project, and the frontend's copy is the stale pre-P0-fix version (an unscoped `firebase deploy` from it re-opens the onepager share-leak, strips the `planTier`/`featureFlags` write-guard, and default-denies 39 collections including all `workspace*` tenant isolation). F-601 is the missing net — the `*.emulator.test.js` suites that would catch exactly that regression are excluded from CI (`jest.config.js:19`; CI runs plain jest). The emulator CI job is what makes the rules fix durable.

**F-101 fix:** remove the `firestore` and `storage` rules blocks from `synchintro-app/firebase.json` so the frontend repo cannot deploy rules; the backend repo becomes sole rules owner. Neutralize the stale `synchintro-app/firestore.rules` (delete, or replace contents with a pointer comment). This is a repo-config change — it deploys nothing and leaves live production rules untouched; state that explicitly in Gate 2.

**F-601 fix:** add a backend CI job — `firebase emulators:exec "jest --testPathPattern=emulator" ...` — so the P0 share-leak and Gate #7 tenant-isolation suites gate merges. Prove the suites pass under the job before calling it done.

**Gate 1 must answer:** does removing rules from `synchintro-app/firebase.json` break any legitimate frontend deploy step (frontend CI is hosting-only — confirm)? which emulator suites exist and do they pass locally today? emulator CI runtime cost — gate PRs or post-merge? rollback if the job is flaky.

**Build:** both changes on one branch; emulator suites proven green. Gate 2, STOP → rules + CI, **Williams merges**.

---

## Work Item 3 — F-701 + CI cluster (F-702 / F-703 / F-704): CI hardening (LAST)

**Why last, together:** F-701 (P1) — the backend CI deploy job is armed on every push to `main` and ships **without `functions/.env`**, which would strip all production runtime env vars (Gemini/Stripe/SAM.gov/encryption keys). F-702/703/704 are the same pipeline's other weak points and touch the same files.

**Sequence within this item — the safety stop goes first:**
1. **F-701 fast guard (first):** disable or gate the backend CI functions-deploy job — manual-approval requirement or `if: false` — so a merge cannot ship functions without `.env`, until the proper fix lands.
   - **Owner action, NOT yours:** Charles will separately confirm the last CI deploy didn't already wipe env, via `firebase functions:list` / console. Flag it in Gate 1; do not attempt it (production read).
2. **F-701 proper fix:** inject `functions/.env` from a GitHub Secret, or complete the Secret Manager migration, so CI can deploy safely. Propose in Gate 1 whether this splits into its own PR.
3. **F-702:** migrate CI auth off deprecated `FIREBASE_TOKEN` (it already 401'd on expiry, June 29) to a service account / Workload Identity Federation.
4. **F-703:** wire the existing frontend Playwright suite into CI (Tests step is currently `echo "TODO"`), gating the hosting deploy.
5. **F-704:** converge on one documented deploy path; make `FUNCTIONS_DISCOVERY_TIMEOUT=120` part of the documented/CI flow rather than Windows-local folklore; remove the redundant unsafe CI functions deploy.

**Gate 1 must answer:** which of these are one PR vs. split (the F-701 guard is urgent and small; Secret Manager/WIF is larger)? any GitHub Secret to provision before a change can merge safely? an order that never leaves the pipeline broken between merges.

**Build:** per the approved split; each PR STOPS before merge → CI changes, **Williams merges**.

---

## Not in this session (do NOT action)
- **F-103** — the on-disk service-account key with un-minimized IAM scope: credential/IAM review + rotation, its own deliberate session. Do not touch, rotate, or rescope the key here.
- **Functions↔production parity check** (`firebase functions:list`) — Charles's owner action; a production read.
- **P2/P3 backlog** (F-202, F-301, F-401, F-801, …) — real, but scoped later only if Charles says so. Do not start unprompted.
- **The SynchGov capture PRD** (`prd-synchgov-capture-01`) — feature work, separate session, sequenced AFTER this remediation lands (F-201 touches the same Prospect Intel backend).

## Definition of done
Three branches (or the Gate-1-agreed split), each built, tested, through Gate 1 and Gate 2, and **stopped at the PR handoff for Williams** — none self-merged. F-701 fast-guard landed first within Item 3. Nothing deployed to production. Bypass mode never enabled. Known-intentional items untouched. When all items are at the PR-handoff stop, summarize: branches, what each PR does, test results, and which are waiting on Williams — then stop.
