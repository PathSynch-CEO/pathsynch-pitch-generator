# Changelog — May 15, 2026

## Audit Workflow Fixes

**File:** `.github/workflows/weekday-health-audit.yml`

### Bug 1 — Gate was not gating

**Problem:** The "Stop if not scheduled audit window" step used `exit 0`, which exits the step — not the job. All 8 heavy steps (checkout, npm install, lint, test, syntax check, artifact upload) ran unconditionally on every scheduled trigger.

**Fix:** Deleted the stop step. Added `if: steps.gate.outputs.run_audit == 'true'` to all 8 heavy steps:
- Create workspace folders
- Checkout backend repo
- Checkout frontend repo
- Set up Node
- Write Claude Code audit prompt
- Generate audit script
- Run health audit
- Upload audit artifact

Scheduled runs outside the 6am ET window are now genuinely skipped. `workflow_dispatch` always proceeds.

### Bug 2 — `has_npm_script()` resolved wrong working directory

**Problem:** `has_npm_script()` called `require('${dir}/package.json')`. Node's `require()` with a relative path resolves from the Node process's cwd (the CI workspace root), not the shell's pwd. When `dir` was `repos/pathsynch-pitch-generator`, the require resolved correctly by coincidence, but the behavior was incorrect and fragile.

**Fix:** Changed to `JSON.parse(require('fs').readFileSync('${dir}/package.json', 'utf8'))`. `fs.readFileSync` resolves from the shell's working directory, which is always the CI workspace root where the repos were checked out.

**Commit:** `4a31853`

---

## Repo Hygiene

### Changelog Files Reorganized

Moved 18 dated changelog files from repo root into `changelogs/` directory:

```
CHANGELOG_2026-03-19.md → changelogs/
CHANGELOG_2026-03-23.md → changelogs/
... (16 more dated files)
```

Root `CHANGELOG.md` remains in place. Going forward, new dated changelogs go in `changelogs/`.

**Commit:** `19ce781`

### SYSTEM_BIBLE.md Deduplicated

Root `SYSTEM_BIBLE.md` (3,065 lines) replaced with a single-line pointer:

```
# See functions/SYSTEM_BIBLE.md — the functions copy is the canonical version since all Claude Code work happens in the functions directory.
```

`functions/SYSTEM_BIBLE.md` is the canonical version. Do not edit the root copy.

**Commit:** `768d586`

---

## Security — Dependency Updates

### pathsynch-pitch-generator (root)

`npm update jspdf protobufjs` resolved critical vulnerabilities in jsPDF and protobufjs.

`npm audit fix` resolved 6 additional vulnerabilities:

| Package | Severity | Type |
|---------|----------|------|
| `dompurify` | High | XSS |
| `flatted` | High | Prototype pollution + DoS |
| `picomatch` | High | ReDoS |
| `postcss` | High | Path traversal |
| `vite` | High | Path traversal + arbitrary file read |
| `brace-expansion` | Moderate | ReDoS |

**Remaining:** `html2pdf.js` (high — XSS) — fix requires upgrade to `0.14.0` which is semver-major. Needs PDF export regression testing before applying.

**Commits:** `a9156d9` (jspdf/protobufjs), `5dae584` (audit fix)

### synchintro-app

`package-lock.json` added to git (removed from `.gitignore`). This was blocking `npm audit` in the health audit workflow. 826 packages, 16 known vulnerabilities now visible (1 critical, 5 high, 7 moderate, 3 low). No fixes applied yet.

**Commit:** `af5496c`

---

## index.js Decomposition Sprint

### New: Decomposition Inventory

**File:** `docs/INDEX_JS_DECOMPOSITION_PLAN.md`

Full inventory of all route groups in `functions/index.js` that have extracted files in `functions/api/` or `functions/routes/` but still have inline handlers. 20 route groups catalogued:

- **12 clean-cut** — safe to extract now (all handlers delegate to extracted module, no shared mutable state)
- **3 partial** — require pre-work (Stripe webhook raw-body, logo path split, admin Stripe import)
- **2 blocked** — require extracting shared helpers first (admin core, pitch group)
- **3 dead code** — identified for deletion (see below)

Shared helpers blocking pitch group extraction:

| Helper | Defined ~Line | Used By |
|--------|--------------|---------|
| `checkAndUpdateUsage(userId)` | ~386 | `/generate-pitch` |
| `incrementUsage(userId, field)` | ~458 | `/generate-pitch` |
| `trackPitchView(pitchId, viewerId, context)` | ~494 | `GET /pitch/:id`, `GET /pitch/share/:id` |
| `extractTriggerEventContent(url)` | ~227 | `/extract-trigger-event` |
| `ensureUserExists(userId, email)` | ~320 | `/generate-pitch` |
| `getCurrentPeriod()` | ~218 | `checkAndUpdateUsage`, `/usage` handler |

Suggested targets: `services/pitchMetrics.js` (first four) + `services/userBootstrap.js` (last two).

**Commit:** `1432604`

### Dead Code Removed

Three unreachable inline handler blocks deleted. All were superseded by modular route files that intercept the same path prefixes earlier in the dispatch chain.

| Block | Line Range (pre-deletion) | Lines | Why Dead |
|-------|--------------------------|-------|---------|
| User endpoints (`GET /user`, `PUT /user/settings`) | 1412–1449 | 38 | `userRoutes.handle()` at line 598 intercepts first |
| Analytics endpoints (`POST /analytics/track`, `GET /analytics/pitch/:id`) | 1472–1534 | 63 | `analyticsRoutes.handle()` at line 626 intercepts first |
| Team management — Schema A (8 handlers: `teamMembers`/`teamInvites` collections) | 1962–2508 | 547 | `teamRoutes.handle()` at line 601 intercepts first; also used obsolete Schema A vs live Schema B |

**Total removed:** 648 lines
**index.js size:** 4,786 → 4,138 lines
**Syntax check:** `node --check` passes

Replacement modules confirmed mounted:
- `userRoutes` — line 598
- `teamRoutes` — line 601
- `analyticsRoutes` — line 626

**Commit:** `24f4292`

---

## Outstanding Items

### P0

- Add `INSTANTLY_ENCRYPTION_KEY` to `functions/.env` on EC2
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Add `NODE_ENV=production` to `functions/.env` on EC2 (CORS bypass risk without it)
- Upgrade `html2pdf.js` to `0.14.0` — test PDF export in staging before deploying

### P1

- Tighten `pitchAnalytics` Firestore rules — currently `allow read: if isAuthenticated()` (over-permissive, any auth'd user can read any pitch's analytics)
- Tighten `icpProfiles` rules — any auth'd user can create/overwrite default profiles
- Wire `SENDGRID_API_KEY` to enable team invite emails (call site is wired in `teamRoutes.js`, key not yet set)

### P2

- Extract 12 clean-cut route groups from `index.js` per `docs/INDEX_JS_DECOMPOSITION_PLAN.md`
- Move `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` to `services/pitchMetrics.js` to unblock pitch group extraction
