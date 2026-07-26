# SynchIntro Audit — Phase 1 Findings (Security)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY audit. This file is a report artifact — no audited code, config, or state was modified.

---

## Verdict

Security posture is **strong**, and **production is currently correct** (verified against the live ruleset — see F-101). Findings are about *governance drift* and *credential scope*, not active exposure.

**Phase 1 finding tally:** P0: 0 · P1: 1 · P2: 1 · P3: 1

| ID | Sev | Title |
|----|-----|-------|
| F-101 | P1 | Split-brain `firestore.rules` across two repos; static signals point to the wrong repo as live deployer |
| F-103 | P2 | On-disk service-account key can reach the production Firebase Rules API (scope not minimized) |
| F-102 | P3 | Retired UID present in live maintenance scripts |

---

## Verification method note (how "live" was determined)

The live Firestore ruleset was read **non-interactively** via the Firebase Rules REST API
(`GET firebaserules.googleapis.com/v1/projects/pathsynch-pitch-creation/releases` → active
`cloud.firestore` release → `GET …/rulesets/{id}`), authenticating with the on-disk service-account
key `C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json`. **No interactive login was performed;
all calls were read-only GETs.** The returned source was normalized and SHA-compared against both
repos' `firestore.rules`. That the audit *could* do this is itself recorded as finding **F-103**.

---

## 1A — Secrets

- ✅ **No hardcoded secrets** in tracked code, either repo. No `sk_live_`/`pk_live_`, no `AIza…` Gemini keys, no `-----BEGIN` private keys.
- ✅ **`functions/.env` was never committed** — `git log --all -- functions/.env` is empty. The **prior audit's P0** (tracked `.env` with a live Stripe key, reported 2026-06-08) is **REMEDIATED**. The `.env` is git-ignored (`.gitignore` lines 5–9) and untracked.
- ✅ Untracked working-tree files scanned — the only pattern "hit" is a *previous audit report* (`SYNCHINTRO_AUDIT_REPORT_2026-06-08.md`) quoting a key prefix as prose, not a real live secret.
- ℹ️ Frontend `js/config.js:8` contains the Firebase **web** `apiKey` — **public by design** (Firebase web config is not a secret). `js/firebase-config.js:9` holds a placeholder. **Not a finding.**

## 1B — Firestore Security Rules

- ✅ All `allow read: if true` occurrences are **intentional and documented**:
  - `firestore.rules:313` `platformConfig` — public pricing read (`write: if isAdmin()`).
  - `firestore.rules:371` `marketBenchmarks` — cross-product feed read, paired with `allow write: if false`.
  - `storage.rules` `logos/{userId}` and `avatars/{userId}` — public image read, owner-scoped + size/content-type-limited writes.

### CONFIRMED live ruleset (this is the correction)

An earlier draft of this report **inferred** — from commit dates — that the frontend's weaker ruleset was
"likely live." **That inference was WRONG.** Verified against production:

| Source | Lines | Collections | SHA(16) | vs LIVE |
|--------|-------|-------------|---------|---------|
| **LIVE (production)** | 776 | 64 | `5ce44d36…` | — |
| `pathsynch-pitch-generator/firestore.rules` | 776 | 64 | `5ce44d36…` | **EXACT MATCH** |
| `synchintro-app/firestore.rules` | 481 | 32 | `76e9ec7b…` | differs (stale subset) |

- **Live release:** `projects/pathsynch-pitch-creation/releases/cloud.firestore`
- **Deployed / last updated:** **2026-06-26 19:02:25 UTC**
- **Enforced in production = the BACKEND repo's `firestore.rules`, byte-for-byte.**
- Production therefore **has** the P0 onepager share-leak fix, the `agencyBrandOverrides`
  `planTier`/`featureFlags` write-guard, and all `workspace*` tenant-isolation rules. **No active exposure.**

### 🔴 [F-101 / P1] Split-brain rules + static signals point to the WRONG repo (the drift IS the finding)

- **Location**: `pathsynch-pitch-generator/firestore.rules` (LIVE), `synchintro-app/firestore.rules` (stale), both `firebase.json`.
- **The governance problem**: two repos each declare `firestore.rules` in `firebase.json`, so either can deploy rules to the same project — **last deploy wins**. The two files diverge by 300+ lines and on security posture.
- **Static signals mislead** (this is the core of the finding — do not trust them next time):
  - `firebase.json`: **both** declare `firestore.rules` → capability is ambiguous.
  - CI: backend `ci.yml:73` = `deploy --only functions`; frontend `ci.yml:58` = `deploy --only hosting`. **Neither CI deploys rules** → CI config can't identify the live deployer. (Silver lining: frontend CI being hosting-only means the *automated* path won't clobber rules.)
  - git timestamps: frontend `firestore.rules` edited **2026-07-06** (`f2e15cc`), backend **2026-06-26** (`c9ca048`). **The naive "most-recently-modified = live" heuristic points to the frontend — which is exactly wrong.** File-edit time ≠ deploy time.
  - **Lesson recorded**: for this platform, the live ruleset must be read from the Rules API (as in the Verification method note), never inferred from repo state.
- **Latent hazard**: `synchintro-app/firebase.json` still owns `firestore.rules` + `storage.rules`, and its copy is the **pre-P0-fix** version. A **manual, unscoped `firebase deploy`** run from that repo (CI won't do it, but a developer locally could) would in one command:
  1. **Re-open the onepager P0 share-leak** — frontend file still contains `allow read: if resource.data.shareId != null` for `onepagers` (live version removed it).
  2. **Strip the `agencyBrandOverrides` entitlement write-guard** (`planTier`/`featureFlags`).
  3. **Drop 39 collections to default-deny**, including every `workspace*` tenant-isolation rule, all `gov*` (SynchGov), `salesDocuments`, `shareEvents`, `merchantConfig`, `pitchTemplates`, `creditLedger`.
- **Also note (current state)**: 7 collections exist in the frontend file but **not** in live → **default-deny in production today**: `viewEvents, precallBriefs, landingPages, notifications, account360, agentViews, irsBmfCache`. If the frontend does direct client reads of any, they are being denied now — to be checked in Phase 5.
- **Mitigating fact**: `functions/services/brandResolver.js` reads `planTier` from server-only `agencyEntitlements` (`write:false` in both files) and the user's subscription — never from the client-writable `agencyBrandOverrides`. So even the weaker rule was only ever defense-in-depth, not a live escalation path.
- **Remediation**: remove the `firestore` and `storage` rules blocks from `synchintro-app/firebase.json` so the frontend repo **cannot** deploy rules; make the backend repo the sole rules owner (or generate both from one canonical source). Delete/symlink the stale frontend `firestore.rules` to prevent confusion. Routes through the two-gate review (touches entitlements + share).
- **Effort**: Medium (1–4h).

### Share / preview / tenant block differences (live vs stale frontend)
- **`onepagers`** — LIVE: owner-only read, public share via server endpoint. FRONTEND (stale): still has `allow read: if resource.data.shareId != null` → **public leak if deployed**.
- **`pitches`** — both server-side-share-only; equivalent (frontend adds harmless stricter create field checks).
- **`opportunityBriefs`** — LIVE: owner-scoped CRUD. FRONTEND: read + `write:if false` (stricter). Both safe.
- **`agencyBrandOverrides`** — LIVE has `planTier`/`featureFlags` write-guard; FRONTEND drops it.
- **`workspaceBranding`, `workspaceBrandingVersions`, `workspaceMembers`, `workspaces`, `workspaceAuditLog`** — exist **only** in LIVE/backend. Tenant isolation would be lost on a frontend deploy.

## 1C — Auth on Callable / HTTP Functions

- Architecture: one Express app (`exports.api`, `functions/index.js:209`) + `onSchedule` jobs + `onCall` + a few raw `onRequest` endpoints.
- ✅ Raw HTTP admin endpoints are **auth-gated**: `backfillConfidenceFields` (`index.js:3683`) and `calibrateMerchant` (`index.js:3703`) require header `x-admin-key` == `ADMIN_BOOTSTRAP_KEY`/`PROSPECT_TASK_SECRET`, else `401`.
- ✅ Plan gating funnels through `getUserPlan()` (`functions/middleware/planGate.js:23`) — documented single source of truth.

## 1D — Input Validation / Injection

- ✅ **No `eval` / `new Function`** in the request path. `execSync`/`child_process` appears only in two dev-only scripts (`functions/scripts/uploadSalesDocFirebase.js`, `functions/scripts/uploadViaRest.js`) — **P3**, not runtime-reachable.
- ℹ️ Prompt-injection surface is inherent (user-supplied data → Gemini prompts), but output returns to the **same** authenticated user — no cross-tenant vector. Acceptable **P3**.

---

## Known-Issue Checklist Results (security items)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Enrichment agent Gemini 400 / foreign key | **VERIFIED-HEALTHY (code level)** | `agents/prospectResearchAgent.js` → `services/agentRunner.js:29` reads **native `process.env.GEMINI_API_KEY`** (`.env` line 19); model `gemini-3-flash-preview`. Foreign-key hypothesis **disproven**. Live 400 not exercised. |
| 2 | Gemini key placement | **VERIFIED-HEALTHY** | `.env` line 19 native key set; line 36 `GEMINI_API_KEY_SYNCHINTRO_SERVER` commented **and referenced nowhere** (`git grep` empty). |
| 5 | P0 share-leak (PR #23) — main not lagging deployed fix | **VERIFIED-HEALTHY in production** | LIVE ruleset has the onepager public-read **removed**; share flows via server endpoint. ⚠️ Caveat: the *frontend repo's* `firestore.rules` FILE still contains the pre-fix public-read rule — latent regression (see F-101). |
| 6 | White-label isolation | **VERIFIED-HEALTHY** | LIVE ruleset enforces `agencyBrandOverrides` write-guard + server-only `workspaceBranding`/`agencyEntitlements` (`write:false`); `brandResolver` never trusts client-writable overrides. |

---

## Findings Detail

### [F-101] Split-brain firestore.rules; static signals mislead about the live deployer
- **Severity**: P1
- **Category**: Security (rules governance) / Reliability (availability)
- **Location**: `pathsynch-pitch-generator/firestore.rules` (LIVE), `synchintro-app/firestore.rules` (stale), both `firebase.json`, both `.github/workflows/ci.yml`
- **Description**: Two divergent rulesets can each deploy to the same project. Production currently enforces the correct backend ruleset (confirmed by Rules-API read, SHA-matched, deployed 2026-06-26 19:02 UTC), but static signals (both `firebase.json` declare rules; CI deploys no rules; frontend rules file edited more recently) would lead an inferrer to the **wrong** conclusion. The stale frontend file is the pre-P0-fix version.
- **Impact**: A manual unscoped `firebase deploy` from `synchintro-app` re-opens the onepager share-leak, strips the entitlement write-guard, and default-denies 39 collections incl. all tenant isolation. No exposure today.
- **Remediation**: Remove `firestore`/`storage` rules from `synchintro-app/firebase.json`; single canonical rules owner (backend); delete/symlink the stale frontend file.
- **Effort**: Medium

### [F-103] On-disk service-account key can reach the production Firebase Rules API
- **Severity**: P2
- **Category**: Security (credential scope / least privilege)
- **Location**: `C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json` (developer machine; **not** in either repo, **not** committed — verified)
- **Description**: This service-account key successfully authenticated read-only calls to the Firebase Rules REST API for project `pathsynch-pitch-creation` during this audit (scopes attempted: `firebase.readonly`, `cloud-platform`). It is referenced in plaintext in the assistant's persisted memory and lives unencrypted in the user's home directory. The fact that a broadly-scoped operational key on a dev machine can read (and, with the same broad scope, potentially deploy) production security rules indicates the key's IAM scope has **not been minimized** to least privilege.
- **Impact**: A leaked or misused copy of this key could read production Firestore data and, depending on its exact IAM roles, modify security rules or other production resources. Blast radius is the whole `pathsynch-pitch-creation` project rather than a narrow, purpose-scoped role.
- **Remediation** (⚠️ **do NOT act during this audit — review separately**): audit the key's granted IAM roles; if it holds broad roles (e.g. Owner/Editor or `firebaserules.admin`), mint a purpose-scoped replacement and rotate; consider Secret Manager / short-lived credentials instead of a long-lived key file on disk; scrub the plaintext path from persisted notes. **No rotation, deletion, or scope change was performed in this session.**
- **Effort**: Medium (requires IAM review + rotation coordination)

### [F-102] Retired UID present in live maintenance code
- **Severity**: P3
- **Category**: Code Quality / Hygiene
- **Location**: `functions/scripts/setCountifiICP.js:17` (`const USER_ID = 'vkSfmPqfNrWYo7ZzelTwPgtC8yw2'`), `functions/scripts/testPitchGeneration.js:92`, comment at `functions/api/pitch/templateOnePager.js:12`
- **Description**: Defunct UID (superseded by `IQaKauAsYnbRFmwKNQPTZj1FqsL2` per SYSTEM_BIBLE) still referenced. Brief explicitly requires flagging.
- **Impact**: Not request-path. Risk is a maintenance script writing to a dead account; no security exposure.
- **Remediation**: Update the two scripts to the canonical UID (or parameterize); refresh the stale comment.
- **Effort**: Quick

---

## Positive controls confirmed
- No secrets in tracked code (both repos); `.env` never in git history.
- Production Firestore ruleset confirmed = hardened backend version (P0 fix, entitlement guard, tenant isolation all live).
- Raw HTTP admin endpoints require `x-admin-key`.
- No banned Gemini models (`gemini-1.5-*`, `gemini-2.0-*`, `gemini-3-pro-preview`) anywhere in tracked JS.
- All Gemini key reads use `GEMINI_API_KEY` (native); no foreign-project key.
- `allow read: if true` cases all intentional and paired with `write: if false` or admin/owner writes.

*End of Phase 1 findings.*
