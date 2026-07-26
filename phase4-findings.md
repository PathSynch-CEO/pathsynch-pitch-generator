# SynchIntro Audit — Phase 4 Findings (Code Quality)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, static / offline (locked policy). Report artifact — no audited code/config/state modified.

---

## Verdict

Strong. Gemini model discipline is clean; one actionable item — `.env.example` drift.

**Phase 4 finding tally:** P0: 0 · P1: 0 · **P2: 1** · **P3: 1**

---

## 4A — Banned Gemini models → **VERIFIED-HEALTHY**

**Real application source references exactly THREE Gemini model strings** (verbatim grep, `node_modules`/`coverage` excluded):

| Literal | Occurrences | Status |
|---------|-------------|--------|
| `gemini-2.5-flash` | 64 | Approved (SIMPLE tier) |
| `gemini-3-flash-preview` | 44 | Approved (PRIMARY) |
| `gemini-3.1-pro-preview` | 8 | Approved (ADVANCED) |

- **Zero** hits for banned strings `gemini-1.5-*`, `gemini-2.0-*`, `gemini-3-pro-preview` in either repo.
- **Correction to first-pass count**: an earlier tally listed a 4th string, `gemini-2.5-flash-lite`. That was a **false positive** — it appears **only** inside `node_modules/@firebase/ai` (the vendored Firebase AI SDK) and stale `coverage/` HTML, **not** in application source. Corrected distinct count in app code = **3**.
- **Spelling verified correct in real code** — `grep` for `preeview`/`flahs`/`gemni` returns empty. (The doubled-e "preeview" was a typo in the chat summary only, never in code or any file.)
- Model hierarchy centralized in `functions/config/gemini.js` (primary `gemini-3-flash-preview`, economy fallback `gemini-2.5-flash`).
- **Stale doc note**: `functions/CLAUDE.md` states `gemini-2.5-flash-lite` is "used in config/gemini.js fallback tier" — **outdated**; the economy fallback in `config/gemini.js` is `gemini-2.5-flash`. Doc-only drift, not a code issue.

## 4B — Gemini 3.x call hygiene → **VERIFIED-HEALTHY**

- `thinkingBudget` present in 19 files; JSON-output 3.x calls use **`indexOf('{')` extraction (18 files)** *or* **`responseSchema`/`responseMimeType` controlled generation (15 files)** — both valid leak-proof patterns.
- Agent-reasoning paths (`agentRunner.js`) intentionally leave thinking **on** (per the documented rule). No violations.

## 4C — Dead code / duplication → minor (P3)

- **Gemini-invocation sprawl**: five overlapping abstractions — `geminiClient` (2 importers), `geminiClientV2` (**1**), `modelRouter` (11), `structuredGeneration` (7), `agentRunner` (1). All live (no dead module), but consolidation-worthy; `geminiClientV2` is near-unused.
- **Untracked build clutter** in the working tree: `functions/coverage/`, `functions/backups/`, `functions/junit.xml` — should be git-ignored (`backups/` also worth confirming it holds no data dumps).
- Prior sessions already removed substantial dead code (648 lines from `index.js`, `agentLogger.js`, 3 stale route blocks) — dimension is otherwise healthy.

## 4D — Config & env → **[F-401 / P2] `.env.example` drift**

- App code reads **132** distinct env vars; `.env.example` documents **88**. ~**40 genuinely undocumented** (runtime-injected `HOME`/`APPDATA` excluded), including operationally significant ones:
  `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `TOKEN_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY`, `SPYFU_API_KEY`, `THEORG_API_KEY`, `HUBSPOT_ACCESS_TOKEN`, `STRIPE_PRICE_STARTER/GROWTH/SCALE/ENTERPRISE`, `AISYNCH_*_PRICE_ID` + `AISYNCH_DAILY_COST_CAP`, `QUICKBOOKS_*`, `SHOPIFY_*`, `GOOGLE_CLIENT_ID/SECRET`.
- **Impact**: a new environment bootstrapped from `.env.example` silently misses these. Some are optional feature-flag/enrichment stubs (Apollo/Clay/PDL return null when unset), but Stripe price IDs, AIsynch pricing, Turnstile, and the token-encryption key are load-bearing.
- **Minor**: `GOOGLE_AI_API_KEY` is a dead `||` fallback (never set, never reached).
- **Remediation**: regenerate `.env.example` from the code's `process.env.*` surface, grouped by subsystem. Effort: Quick.

## 4E — NemoClaw four rules → **VERIFIED-HEALTHY (engine out of scope)**

This repo contains only a **gated handoff**, not the NemoClaw engine. `prospectIntelService.js:884 sendProspectsToNemoClaw()` reads **approved** prospect docs, POSTs to PathManager (`pathsynch.com/api/v1/campaigns/generate`), then marks `workflowStatus:'sent_to_nemoclaw'`. The engine (Judge+Guardrail debate loop ≤3, parallel divergence, KB ground truth, no-auto-publish) lives in **PathManager**. On this side there is **no auto-publish** — prospects must be explicitly approved before send. The four rules govern the engine and are out of scope here.

---

## Findings Detail

### [F-401] `.env.example` documents 88 of 132 env vars
- **Severity**: P2 · **Category**: Code Quality / Config
- **Location**: `functions/.env.example` vs `functions/**/*.js` `process.env.*` reads
- **Impact**: fresh-environment bootstrap misses ~40 vars incl. Stripe price IDs, AIsynch pricing, Turnstile secret, token-encryption key.
- **Remediation**: regenerate `.env.example` from code; group by subsystem; drop dead `GOOGLE_AI_API_KEY` fallback.
- **Effort**: Quick

### [F-402] Gemini-client abstraction sprawl + untracked build clutter
- **Severity**: P3 · **Category**: Code Quality
- **Location**: `services/geminiClient.js`, `geminiClientV2.js`, `modelRouter.js`, `structuredGeneration.js`, `agentRunner.js`; untracked `functions/coverage/`, `functions/backups/`, `functions/junit.xml`
- **Impact**: maintenance overhead; near-unused `geminiClientV2`; build artifacts should be git-ignored.
- **Remediation**: consolidate Gemini clients behind `modelRouter`; add clutter dirs to `.gitignore`.
- **Effort**: Medium

---

## Positive controls confirmed
- Only approved Gemini models in app code (3 distinct strings); no banned models in either repo; spelling correct.
- 3.x JSON calls use `indexOf('{')` or controlled generation; `thinkingBudget:0` where JSON is expected.
- Model hierarchy centralized in `config/gemini.js`.
- NemoClaw handoff is approval-gated (no auto-publish on this side).

*End of Phase 4 findings.*
