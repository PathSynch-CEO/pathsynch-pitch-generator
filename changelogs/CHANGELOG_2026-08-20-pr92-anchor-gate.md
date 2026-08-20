# CHANGELOG — 2026-08-20 (#92: HIM provenance gate → anchor-based)

**Branch:** `fix/him-provenance-anchor-based-pr92`. Fix-forward for the BLOCKING defect a cold read
found in merged #91 (verdict is a comment on PR #91). Scoped to findings (a) and (c).

## Finding (a) — prose corruption — CLOSED (redesign, not tune)

#91's `looksLikePerson` classified ANY Title-Case 2–3-word phrase as a person and rewrote it, and the
business branch dropped moves on generic-suffix phrases. Confirmed corruption:
`Google Business Profile → "Google the business owner"`, `Landing Page → "the business owner"`,
`Market Leader → "the business owner"`, etc.

`services/himProvenanceGate.js` is redesigned **anchor-based**; shape detection is **deleted**:
- A phrase is a PERSON only if it matches (honorific/surname/possessive-normalized) a name in the
  anchor set = **(i)** the enrichment `decisionMaker` set ∪ **(ii)** the candidate-name list the
  generators were steered with. Verified → kept; steered-but-unverified → rewritten to the business
  role; **matches nothing → never touched.**
- BUSINESSES are recognized only by known-name match (in-set leads/competitors or a news-signal
  entity). **No suffix-shape detection → no move is ever dropped.**
- `PHRASE_RE`, `looksLikePerson`, `hasBusinessToken`, `BUSINESS_TOKENS`, `NON_ENTITY_TOKENS` removed.

### Accepted, explicit coverage reduction
The generators are steered only with VERIFIED `decisionMaker` names, so in the current pipeline the
candidate set equals the verified set → the gate performs **zero rewrites/drops on real reports**. An
unverified recalled name, or an out-of-set business, now **ships**. That is a smaller failure than
corrupted customer-facing prose, and the **race fix** (real names in the prompt) is the primary
defense. The rewrite machinery remains for the day a steered-but-unverified candidate list exists.

## Finding (c) — honorific/surname matching — CLOSED

`normPerson` strips a leading honorific (`Mr/Mrs/Ms/Mx/Dr/Prof/Sir/Rev`) and a trailing possessive;
`personMatches` matches a bare surname/first token against a full name, and matches two full names
only when the **first names agree** (so `Bob Tabb` ≠ `Ryan Tabb` — same surname, different person).
`isVerifiedPerson("Mr. Tabb" | "Tabb" | "Ryan Tabb's" | "Dr. Ryan Tabb")` all resolve to backed
`Ryan Tabb`.

## Kept untouched (reviewer-confirmed sound)
`utils/raceTimeout.js`, the `extractContacts` role-term + name-grounding guards, the await-before-
generation race ordering, and the in-set/news business anchor matching (now the only business
mechanism). `market.js` gate wiring is unchanged except a comment updated to describe the new behavior.

## Tests
`tests/himProvenanceGate.test.js` rewritten:
- **FINDING (a) closed:** a battery of realistic Title-Case-dense sales copy (Google Business Profile,
  Landing Page, Market Leader, Lead Capture, First/Emergency Response, QRsynch/LocalSynch/PathConnect,
  Same Day) → **zero rewrites, zero drops**.
- **v10 verbatim guardrail:** all four real moves pass through byte-identical.
- **FINDING (c):** honorific/surname/possessive matching for each form; a backed owner mentioned as
  "Mr. Tabb" is not rewritten.
- **Anchor rewrite path:** a steered-but-unverified candidate IS rewritten; a verified name is
  protected against a same-surname unverified candidate.
- **Accepted reduction (documented):** an unverified recalled name and an out-of-set business now ship.

`raceTimeout.test.js`, `dmExtractionSanity.test.js`, `himDecisionMakerWiring.test.js` kept as-is.

Full suite: **2297 passing, 0 failing** (111 suites).
