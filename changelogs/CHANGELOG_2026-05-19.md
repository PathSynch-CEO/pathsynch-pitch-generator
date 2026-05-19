# Changelog — May 19, 2026

## Deploy-only session (no new commits). Changes deployed to Firebase functions + hosting.

---

## Bug Fixes

### Fix 1 — Date Extraction Overcounting (`templateOnePager.js`)

**Root cause:** `dateLabelPattern` regex in Step 3f included `|New`, matching Google's "New" UI badge as a date timestamp. Diagnostic confirmed 1258 lines in pasted text, 203 matched date labels — actual review timestamps ~90.

**Fix:** Removed `|New` from `dateLabelPattern`.

```
Before: /^(...|yesterday|New)$/i
After:  /^(...|yesterday)$/i
```

**Impact:** 90-day review velocity targets corrected (~2× inflation eliminated). CTA line ("your next N reviews") now reflects accurate count.

**File:** `functions/api/pitch/templateOnePager.js`

---

### Fix 2 — Response Rate Missing "%" (`executiveBriefRenderer.js`)

**Root cause:** Smith's Olde Bar pitches route through `l2Style: 'executive_brief'` → `executiveBriefRenderer.js`, bypassing `renderStatCards()` in `templateOnePager.js` where the "%" fix previously landed.

**Fix:** Added guard in `renderStatStrip()`:
```javascript
if (/RESPONSE RATE/i.test(s.label) && /^\d+$/.test(String(s.num))) {
    displayNum = s.num + '%';
}
```

**Impact:** Response rate stat card displays "49%" instead of "49".

**File:** `functions/services/executiveBriefRenderer.js`

---

### Fix 3 — Methodology Footnote Missing from Executive Brief (`executiveBriefRenderer.js`)

**Root cause:** Same renderer bypass as Fix 2. Methodology footnote existed in `renderOnePagerHtml` but not in `executiveBriefRenderer.js`.

**Fix:** Added footnote in `renderSolution()` below product pills:
> "Methodology: Review targets based on trailing 90-day velocity from pasted Google review timestamps. Response rate calculated from owner reply patterns detected in review text."

Styled `7.5px / rgba(255,255,255,0.55)` for legibility on teal background.

**File:** `functions/services/executiveBriefRenderer.js`

---

## Feature Deploys

### Growth Snapshot — Frontend Card Live

`growth_snapshot` Smart mode card pushed live via hosting deploy. Card was already committed in `de9b08e` — needed hosting push.

- id: `growth_snapshot`
- Title: Generate Customer Growth Snapshot
- Credits: 145
- Sends: `l2Style: 'growth_snapshot'`
- Saves to Library

### Growth Snapshot — Backend Renderer (PR #14)

`growthSnapshotRenderer.js` backend renderer merged and deployed earlier in this session.

---

## Cleanup

- 3 temporary diagnostic `console.log` lines removed from `templateOnePager.js` before deploy:
  - `[TemplateOnePager] DIAGNOSTIC — total lines in pasted text:...`
  - `[TemplateOnePager] DIAGNOSTIC — first 20 matched labels:...`
  - `[TemplateOnePager] RENDERER — l2Style:...`

---

## Verification Checklist Applied

| Check | Result |
|-------|--------|
| `git diff --name-only` — only 2 expected files | PASS |
| `grep` — no DIAGNOSTIC/RENDERER logs remaining | PASS (grep exit 1 = no matches) |
| `node --check templateOnePager.js` | PASS |
| `node --check executiveBriefRenderer.js` | PASS |
| `grep dateLabelPattern` — `New` absent | PASS |
| `grep "RESPONSE RATE"` — guard present | PASS |
