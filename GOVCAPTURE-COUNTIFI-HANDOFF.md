# Handoff Brief — Countifi Master Proposal → SynchGov Capture

**For a FRESH Claude Code session (Fable, high effort) at `C:\Users\tdh35\pathsynch-pitch-generator`.**
**Prepared 2026-07-17 by the member-identity session (closed engagement; see memory `member-identity-fix-2026-07`).**

## The input

`C:\Users\tdh35\Downloads\Countifi Master Government Proposal 2026.docx` (~83KB) — Countifi's
REUSABLE MASTER government proposal, authored by David Hailey (Founder/CEO, david@countifi.com).
Countifi is an existing SynchIntro customer (see `scripts/setCountifiICP.js`). It is deliberately
generic: blank Submitted-to / RFP# / date fields, 16 sections (exec summary, 6-layer platform
architecture, 9-phase implementation, PM/governance, QA, security, training, support,
assumptions, compliance matrix), meant to be tailored per solicitation.

## Known defects in the document — fix in a COPY, never edit the original

1. **AI-chat artifact left in the body** (between "API Integration" and Section 3):
   "Perfect. From here onward, the proposal starts looking like a real government proposal.
   This section should be reused in nearly every solicitation with only minor customization."
   This is a pasted chatbot reply. It MUST NOT survive into any tailored output.
2. **Template meta-note at the end of the Compliance Matrix**: "This matrix should be updated
   for each solicitation to map proposal content to the specific RFP requirements." Internal
   guidance — same rule. Consider converting both into real Word comments on the cleaned copy.

## Content gaps SynchGov should flag per-solicitation (not defects in a master)

- No named past-performance projects or references (Section 12 is capability prose) — usually
  the heaviest-weighted eval factor.
- Security section names no certifications/frameworks (no NIST 800-53 / FedRAMP / CJIS / SOC 2).
- Compliance matrix is self-declared "Compliant" against generic headings.
- Blank fields: Submitted to, RFP #, Submission date. No pricing (appendix placeholder only).

## Likely intent — CONFIRM WITH CHARLES BEFORE BUILDING

David's ask is expected to be one or both of:
(a) ingest this as Countifi's MASTER PROPOSAL so SynchGov proposal generation
    (`functions/services/govcapture/govProposalService.js`) tailors it per opportunity;
(b) use it as a test corpus for the proposal evaluator
    (`govEvaluationService.js` / `govRubricAssembler.js` — the PR-C5 work).
Ask Charles which, and get the actual ask from David if it differs.

## HARD CONSTRAINTS

- **Both repos' main working trees hold uncommitted WIP on `feat/govcapture-c5-evaluator`
  (backend `pathsynch-pitch-generator` AND frontend `C:\Users\tdh35\synchintro-app`).**
  Do NOT switch branches, stash, reset, or clean those trees — another session may depend on
  them. First check `git status` / whether C5 has since merged to main. If code work is
  needed before C5 lands, build in a dedicated `git worktree` from `origin/main`
  (pattern proven this week: worktrees at `C:\Users\tdh35\wt-member-*` — may still exist, reusable).
- Read committed code via `git show main:path` / `git grep <pat> main` when trees are dirty.
- PowerShell: sequential commands only, no `&&` chaining.
- Deploys: backend `firebase deploy --only functions:api` ONLY, from a tree that has
  `functions/.env` copied in (76 vars — deploying without it wipes prod env). Verify
  "Loaded environment variables from .env" in output. Frontend hosting auto-deploys on merge
  to main. Rules deploy separately; `firestore.rules` changes need explicit care.
- Ask-first posture: propose a plan, get Charles's approval, build, STOP at PR for his merge;
  deploy only on his explicit "deploy".

## Out of scope

The member-identity/entitlement engagement (PRs #57-#60, #34-#36) is complete and deployed —
do not rework it. Its docs live in this repo root (`SELLER_PROFILE_DIAGNOSIS_2026-07-16.md`
and the strategy/prd-review files) if context is needed.

## Suggested first move

Read the docx (extract via unzip + strip XML, or pandoc if available), produce the cleaned
copy, then present Charles a short scoping proposal for (a)/(b) above and STOP for approval.
