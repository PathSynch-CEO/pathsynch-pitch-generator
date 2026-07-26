# SynchIntro Audit — Phase 3 Findings (Dependency Health)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY. `npm audit`/`npm outdated` run **read-only** (no `audit fix`); they touch only the public npm registry and never authenticate to `pathsynch-pitch-creation` — within the static/offline policy. Report artifact — no audited code modified.

---

## Verdict

Healthy hygiene: lockfiles committed in all three package roots, runtime Node pinned to 22. **One dependency worth acting on (`multer`)**; everything else is transitive-library or dev-tooling noise not reachable in shipped code.

**Phase 3 finding tally:** P0: 0 · P1: 0 · **P2: 1** · **P3: 2**

---

## Inventory

| Root | Lockfile | Node pin | `npm audit` result |
|------|----------|----------|--------------------|
| `functions/` (backend runtime) | ✅ committed | ✅ `"node": "22"` | 13 prod (9 moderate, **4 high**); 16 incl. dev |
| repo root (build/dist tooling) | ✅ committed | — | 7 (1 low, 2 moderate, **4 high**) |
| `synchintro-app/` (frontend) | ✅ committed | — | 18 (12 moderate, **6 high**) |

Backend runtime HIGH advisories: `@grpc/grpc-js`, `form-data`, `multer`, `protobufjs`.

---

## Findings

### [F-301 / P2] `multer` high advisory in the request path
- **Severity**: P2 · **Category**: Dependencies
- **Location**: `functions/package.json` (`multer ^2.1.1`, **direct dep**), used in `functions/index.js:1425` and `functions/routes/govcaptureRoutes.js:512`.
- **Description**: The advisory range is `1.0.0 – 2.1.1` (HIGH); the installed version sits at the vulnerable ceiling. The multer 2.x highs are **DoS via unhandled exceptions on malformed multipart uploads**. These are on **authenticated** upload endpoints (sales-doc upload + govcapture).
- **Impact**: An authenticated user could send crafted multipart data to crash/hang the upload handler. Auth-gated and DoS-only (no data breach) → P2, not P1.
- **Remediation**: bump `multer` to the patched release above 2.1.1 and re-run the upload smoke tests (sales-doc upload + govcapture).
- **Effort**: Quick–Medium.

### [F-302 / P3] Backend transitive advisories not in a reachable path
- **Severity**: P3 · **Category**: Dependencies
- **Description**: `@grpc/grpc-js`, `protobufjs`, `form-data`, and the `teeny-request → uuid` chain all arrive via `firebase-admin` / `@google-cloud/storage`. They sit on internal Google gRPC/storage transport, not on attacker-reachable surface (the `uuid` buffer bug only triggers on caller-supplied buffers, which Firebase internals don't do). Matches the prior audit's standing assessment.
- **Remediation**: track; they clear on the next `firebase-admin` bump. Do **not** force-fix (breaking changes).
- **Effort**: Quick (monitor).

### [F-303 / P3] Frontend/root HIGH advisories confined to dev tooling
- **Severity**: P3 · **Category**: Dependencies
- **Description**: The frontend has **1 runtime dep** (`@floating-ui/react`) + 3 devDeps (`@playwright/test`, `firebase-tools`, `serve`). All 6 highs (`@grpc/grpc-js`, `form-data`, `hono`, `protobufjs`, `tmp`, `ws`) are transitive via `firebase-tools`/`serve`/`playwright` — CLI/emulator/test tooling. The app ships **static vanilla JS/HTML** to Firebase Hosting; none of these reach the browser or any production runtime. Repo-root highs are the same class of build tooling (vite-family).
- **Remediation**: none urgent; keep dev tooling current on a routine cadence.
- **Effort**: Quick (routine).

---

## Carried-forward (out of `npm audit` scope)
- **`html2pdf.js` XSS (high)** — flagged in prior audits (F-018). It is **vendored** in the frontend (`js/vendor/`), not an npm dependency, so it does not surface in `npm audit`. Upgrade to `0.14.0` is semver-major and needs a PDF-export regression test first. Still open; tracked in the platform action plan, not this phase's findings.

---

## Positive controls confirmed
- Lockfiles committed in all three package roots.
- Backend runtime Node version pinned (`"node": "22"`).
- No `npm audit fix` was run; no dependency mutated.
- The only request-path-reachable HIGH is `multer` (F-301); all other highs are internal-transport or dev-only.

## Open items carried to the action plan
- **[F-301 / P2]** Upgrade `multer` past 2.1.1.
- **[F-302 / P3]** Track backend transitive advisories; clear on next `firebase-admin` bump.
- **[F-303 / P3]** Keep dev tooling current (frontend/root) — not shipped, low urgency.

*End of Phase 3 findings.*
