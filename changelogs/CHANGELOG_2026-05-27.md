# Changelog — May 27, 2026

**Sprint:** white-label-branding-phase2
**Status:** Deployed to production

---

## White-Label Branding Phase 2 — Self-Serve Settings UI

### What Was Built

Full self-serve branding settings UI for agency partners, wired to Firebase Storage (logo) and Firestore (`agencyBrandOverrides`). Plan-gated — Growth gets text fields, Scale gets logo + color picker.

### `functions/services/brandResolver.js` — 3 changes

1. **`useCustomBranding: true`** added to `PATHSYNCH_DEFAULT_BRAND` — field always present on every resolved brand object.
2. **Early return when toggle is off** — `overrides.useCustomBranding === false` short-circuits to PathSynch defaults with `useCustomBranding: false`; user's saved config preserved in Firestore, not applied.
3. **`useCustomBranding` on all resolved paths** — every code path that returns a brand object now includes the field.

### `synchintro-app/js/api.js` — 2 new methods

| Method | Description |
|--------|-------------|
| `uploadBrandLogo(file, uid)` | Validates PNG/JPG ≤1 MB; uploads to `agency-branding/{uid}/logo.{ext}`; returns `{ downloadUrl, storagePath, mimeType }` |
| `saveBrandOverride(fields)` | Allowlist-filtered Firestore `set({ merge: true })` to `agencyBrandOverrides/{uid}`; never writes entitlement fields |

### `synchintro-app/js/pages/settings.js` — Full Branding UI

- `renderBrandingCard()` — plan-gated card (Growth+: text fields; Scale+: logo + color picker); live preview panel; save button
- `initBrandingSection()` — wires toggle, file input, color picker↔hex sync, text→preview live updates
- `_updateBrandPreview()` — toggle-aware live preview (PathSynch defaults when off)
- `_handleLogoUpload()` — uploads via `API.uploadBrandLogo()`, stores pending logo fields
- `removeBrandLogo()` — writes null logo fields, clears preview
- `saveBrandSettings()` — calls `API.saveBrandOverride()`, renders status feedback
- `_esc(str)` — HTML escape helper
- ~90 lines of `.brand-*` CSS added to `addStyles()`

### `synchintro-app/firestore.rules` — 2 new rules

- `agencyBrandOverrides/{userId}` — owner read + create + update; delete blocked
- `agencyEntitlements/{userId}` — owner read only; write blocked

---

## Bug Fixes

### Bug 1 — Plan Tier Defaulting to Starter

**Root cause:** `_defaultEntitlements(userDoc)` only checked nested `subscription.plan/tier`; top-level `userDoc.plan` was ignored.

**Fix:** Fallback order now: `userDoc.plan` → `userDoc.tier` → `userDoc.subscription.plan` → `userDoc.subscription.tier`.

**`effectiveTier` logic added:** Compares entitlements doc tier vs subscription tier via `TIER_RANK = { starter:0, growth:1, scale:2, enterprise:3 }`; uses whichever is higher. A seeded `starter` entitlements doc no longer blocks a paying Scale user. `users/{uid}` added to parallel Firestore fetch in `resolveBrand()`.

### Bug 2 — Save Fails with Firestore Permissions Error

**Root cause:** No `agencyBrandOverrides` Firestore security rule existed; client writes were rejected.

**Fix:** New rule added to `firestore.rules` (see above).

---

## Plan Gating Summary

| Feature | Minimum tier |
|---------|-------------|
| Use custom branding toggle | All tiers |
| Company name, contact details, website | Growth |
| Logo upload | Scale |
| Accent color picker | Scale |

---

## Commits

| Repo | Commits |
|------|---------|
| `pathsynch-pitch-generator` | `beb8746`, `82ce8ba`, `2cd0ce9` |
| `synchintro-app` | `fd9a73a`, `5c64504`, `b4050d3` |

---

## Key Learnings

1. **`users/{uid}.plan` is authoritative** — top-level plan field, not nested under `subscription`. Always check top-level first.
2. **`effectiveTier` pattern** — when a seed script creates entitlements with `starter`, live subscription tier must win. Always take the higher of the two using `TIER_RANK`.
3. **Client writes to `agencyBrandOverrides` require a Firestore rule** — `allow create, update` must be explicit; no default permits writes.
4. **`useCustomBranding: false` preserves the saved config** — early return from `resolveBrand()` uses defaults, not a wipe of the Firestore doc. Re-enabling the toggle restores without re-entry.
5. **Entitlement fields must never reach `agencyBrandOverrides`** — `planTier`, `mode`, `canUseCustomLogo`, `canUseCustomColors` are server-managed. The `saveBrandOverride()` allowlist enforces this.
