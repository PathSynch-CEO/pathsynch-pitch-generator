# SynchIntro Audit — Phase 8 Findings (Documentation & Onboarding)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, static / offline (locked policy). Report artifact — no audited code modified.

---

## Verdict

Documentation is **good where it exists** — a structured backend README, a current 3,800-line `CLAUDE.md`, and adequately-commented complex logic. Gaps: the canonical `SYSTEM_BIBLE.md` is ~7 weeks stale, the frontend has no README, and setup docs lag the real env/deploy surface.

**Phase 8 finding tally:** P0: 0 · P1: 0 · **P2: 1** · **P3: 2**

---

## What's documented well

- **Backend `README.md`** (249 lines): structured and usable — Features, Tech Stack, Project Structure, Quick Start (Prerequisites, Installation, env setup, Development), Deployment. Good human onboarding entry point.
- **`functions/CLAUDE.md`** (3,814 lines): **current** — latest session dated **July 7, 2026** (Gemini key fix, SynchGov go-live, entitlement fix, Secret Manager plan). Dense operational memory; the single best source of tribal knowledge.
- **`SYSTEM_BIBLE.md` hygiene**: root file is a 1-line pointer to the canonical `functions/SYSTEM_BIBLE.md` (correct, per May 15 consolidation).
- **Inline comments on complex logic** — adequate: `brandResolver.js` 24%, `planGate.js` 14%, `govScoringEngine.js` 15%. `brandResolver` in particular documents the tenant-isolation/entitlement reasoning well (why workspace context reads server-only docs, why client overrides aren't trusted).

## Findings

### [F-801 / P2] `SYSTEM_BIBLE.md` is ~7 weeks stale
- **Location**: `functions/SYSTEM_BIBLE.md` (886 lines).
- **Description**: Latest dated content is **May 26, 2026** (today: July 14). It predates major changes: **SynchGov going live** (July 7), the **enterprise-entitlement fix** (PR #44), the **Gemini native-key root-cause fix** (July 7), the **Secret Manager migration plan**, and the current rules-authority reality. `CLAUDE.md` captures these, but the "system bible" — the doc meant to be the canonical architecture/law reference — lags by ~7 weeks.
- **Impact**: The nominal source of truth diverges from reality; onboarding readers get a stale architecture picture. Minor stale technical specifics also exist (e.g. `CLAUDE.md`'s note that `gemini-2.5-flash-lite` is used in `config/gemini.js` is outdated — the fallback is `gemini-2.5-flash`; and the old `prospectResearchAgent` "gemini-2.0-flash" note is superseded by `gemini-3-flash-preview`).
- **Remediation**: refresh `SYSTEM_BIBLE.md` to cover SynchGov, entitlement resolution, the Gemini-key invariant, and Secret Manager direction; reconcile stale model-string notes.
- **Effort**: Medium.

### [F-802 / P3] Frontend `synchintro-app` has no README
- **Location**: `synchintro-app/` — has `CLAUDE.md` (2,215 lines) but **no `README.md`**.
- **Description**: A new human developer has no conventional onboarding doc for the frontend — only the AI-agent-oriented `CLAUDE.md`. No documented local-serve/test/deploy steps in a README.
- **Impact**: Onboarding friction; the vanilla-JS + Firebase-Hosting + Playwright setup (non-obvious — it's not a React/Vite app) is undocumented for humans.
- **Remediation**: add a short frontend `README.md` (stack, local serve via `npx serve`, Playwright test invocation, hosting deploy discipline — **always `--only hosting`**, per F-101).
- **Effort**: Quick.

### [F-803 / P3] Setup docs lag the real env/deploy surface
- **Location**: backend `README.md` env-setup + Deployment sections.
- **Description**: The README `.env` template shows ~20 vars vs the **132** actually read (ties to F-401), and Deployment documents bare `firebase deploy` / `firebase deploy --only functions` without the **`--only hosting` discipline** (F-101 hazard from the frontend repo) or the **`FUNCTIONS_DISCOVERY_TIMEOUT=120`** Windows workaround (F-704).
- **Impact**: A new operator following the README could run a bare `firebase deploy` (clobbering rules) or a functions deploy that fails/wipes env; the env template won't stand up a working environment.
- **Remediation**: regenerate the env template from `.env.example` (once F-401 is fixed); document the canonical deploy procedure incl. the `--only` discipline and the Windows timeout var.
- **Effort**: Quick.

---

## Positive controls confirmed
- Backend README is comprehensive and structured.
- `CLAUDE.md` current to July 7 (both repos maintain one).
- Root `SYSTEM_BIBLE.md` correctly points to the canonical functions copy.
- Complex business logic (brand resolution, plan gating, gov scoring) carries adequate inline comments.

## Open items carried to the action plan
- **[F-801 / P2]** Refresh stale `SYSTEM_BIBLE.md`; reconcile stale model-string notes.
- **[F-802 / P3]** Add a frontend README.
- **[F-803 / P3]** Bring README env/deploy docs in line with reality.

*End of Phase 8 findings.*
