# Changelog — April 25, 2026: Prospect Research Agent Quality Improvements

## Root Cause Summary

A 48-prospect test batch revealed five systemic enrichment failures:
1. Ratings missing even when GBP exists (agent gave up on name mismatches)
2. Industry always blank (step not marked mandatory, agent skipped it)
3. Websites missing even when domain was in the CSV (backend never passed it to agent)
4. "No service data" for most prospects (no fallback when website scrape fails)
5. Wrong business matched (no city validation)

Additionally, the agent was using `gemini-2.5-flash` — the SIMPLE TASKS model. For a
multi-step agentic reasoning task, `gemini-3-flash-preview` is required per model rules.

---

## FILE 1 — `PathSynch_Agents/prospect-research/agent.py`

### Change A — Model Upgrade
- **Before:** `model="gemini-2.5-flash"` — SIMPLE TASKS model (email, SVG, Q&A)
- **After:** `model="gemini-3-flash-preview"` — PRIMARY model for fast tasks and simple agents
- **Why:** The agent does multi-step reasoning across 3 searches + web scrape. `gemini-2.5-flash`
  is too limited; `gemini-3-flash-preview` is the correct model per CLAUDE.md model hierarchy.

### Change B — Seed Data (Step 0, new)
- Added new Step 0 to the instruction: check the input JSON for optional `website` and `phone`
- If `website` is provided, the agent skips Step 3 search entirely and goes directly to
  Step 4 scraping — eliminating a redundant Google search and improving accuracy
- If `phone` is provided, it's used as the confirmed phone number
- City/state from input are noted for validation in Step 1

### Change C — Fuzzy Name Matching (Step 2, strengthened)
- Added explicit `FUZZY NAME MATCHING (CRITICAL)` block to Step 2
- Previous instruction noted ratings might appear in snippets but didn't address the common
  case where Google shows a slightly different business name (e.g. "Alliance Air Comfort" →
  "Alliance Air Solutions" on Google Maps)
- Agent now explicitly told: accept rating/reviews from closely-named business in the same
  city and industry category; use the Google-found name as `prospectBusiness`; do NOT skip
  a rating just because the input name and Google name differ slightly

### Change D — Services from Snippets Fallback (Step 4, new CASE B)
- Step 4 now has two cases:
  - **Case A** (website found): call `url_context` and scrape (existing behavior, unchanged)
  - **Case B** (no website): do NOT call `url_context`; instead extract 1-3 inferred services
    from GBP category tags, knowledge panel descriptions, and review snippets already
    retrieved in Steps 1-2. Explicit instruction: "NEVER leave topProducts as empty array
    if you can reasonably infer services from the business type."
- This directly fixes "No service data enriched yet" for businesses without a website

### Change E — Mandatory Industry Classification (Step 5, enforced)
- Added `(MANDATORY — ALWAYS DO THIS)` to step heading
- Added: "This step is REQUIRED even if no other data was found. Use the business name
  alone if necessary."
- Added industry-to-category guidance table:
  - HVAC/plumbing/electrical/roofing → Home Services
  - Dentist/orthodontist → Dental
  - Doctor/clinic/chiro/PT → Medical/Health
  - Auto repair/body/tires → Automotive
  - Hair salon/barbershop/nail/spa → Beauty/Salon
- GBP category from search snippets noted as authoritative source

### Change F — Business Validation (Step 1, added)
- Added VALIDATION note: if address city found does NOT match input city, agent sets
  `confidence: 'low'` to flag that the wrong business may have been matched

### Change G — Expanded Response Schema
- Added new fields to the JSON output schema:
  - `decisionMaker` — owner/manager name from website About/Team page (null if not found)
  - `socialProfiles` — `{ facebook, yelp, instagram }` object (null values if not found)
  - `buyingSignals` — array of observed signals (e.g. "Low review count", "No website detected")
- Added `### BUYING SIGNALS` section instructing agent which signals to include

### Change H — Error Response Schema Fixed
- Error case now includes `industry`, `topProducts`, `differentiators`, `buyingSignals`
  so it never returns undefined for fields the backend reads

---

## FILE 2 — `functions/services/prospectIntelService.js`

### Change A — `callResearchAgent()` accepts seed data (4th param)
- **Before:** `async function callResearchAgent(businessName, city, state)`
- **After:** `async function callResearchAgent(businessName, city, state, seedData = {})`
- Builds `payload` object, conditionally adds `website` and `phone` from `seedData`
- Agent receives these as optional input fields (Step 0 in new instruction)

### Change B — `processOneProspect()` extracts and passes seed data
- Before calling `callResearchAgent`, extracts seed data from prospect doc:
  - `companyDomain` → `seedData.website` (prepends `https://` if no scheme present)
  - `phone` or `contactPhone` → `seedData.phone`
- Seed data passed as 4th arg to `callResearchAgent`
- This means businesses whose domain was in the original CSV now have it passed to the
  agent, enabling direct website scraping without a Google search

### Change C — New agent fields stored in enriched payload
- Added to the enriched Firestore write:
  - `decisionMaker` — `buildSourceAttribution(agentResult.decisionMaker, 'agent', 'medium')`
  - `socialProfiles` — `buildSourceAttribution(agentResult.socialProfiles, 'agent', 'medium')`
  - `agentBuyingSignals` — raw array from agent (separate from `signalHits` which is
    computed by `calculateFitScore`; these are agent-observed signals like "No GBP found")

---

## Before / After

| Issue | Before | After |
|-------|--------|-------|
| Rating missing (name mismatch) | Agent skips rating if business name differs on Google | Agent accepts rating from closely-named business in same city/category |
| Industry blank | Step 5 not marked mandatory, agent sometimes skipped it | Step 5 is MANDATORY with explicit business-name-based fallback |
| Website from CSV ignored | Backend only sent {businessName, city, state} to agent | Backend now sends {website, phone} from CSV as seed data |
| No services extracted | Empty array returned when website scrape fails | Agent extracts 1-3 services from GBP snippets as fallback |
| Wrong business matched | No city validation | Agent sets confidence:low when found city ≠ input city |
| Model too weak | gemini-2.5-flash (simple tasks model) | gemini-3-flash-preview (primary model for agents) |
| No decision maker field | Field not in schema | Agent looks for owner/manager on About page; stored in Firestore |
| No social profiles | Field not in schema | Agent captures facebook/yelp/instagram links |
| Buying signals | Only computed server-side from fitScore signals | Agent also returns observed raw signals (agentBuyingSignals) |

---

## Files Changed

| File | Changes |
|------|---------|
| `PathSynch_Agents/prospect-research/agent.py` | Model upgrade; Steps 0-6 instruction rewrite |
| `functions/services/prospectIntelService.js` | `callResearchAgent` seed data param; `processOneProspect` seed extraction; new fields in enriched payload |

## Files NOT Changed
- `functions/routes/prospectIntelRoutes.js` — no changes needed
- `functions/services/googlePlaces.js` — Places fallback already implemented, unchanged
- Frontend (`prospectIntel.js`) — no changes needed for these backend/agent fixes

## Deploy Note
- **Backend functions**: deploy with `firebase deploy --only functions`
- **Cloud Run agent**: requires Docker rebuild + push + `gcloud run deploy`:
  ```
  cd PathSynch_Agents/prospect-research
  docker build -t gcr.io/pathconnect-442522/prospect-research .
  docker push gcr.io/pathconnect-442522/prospect-research
  gcloud run deploy prospect-research --image gcr.io/pathconnect-442522/prospect-research --region us-central1 --project pathconnect-442522
  ```
  Both deploys needed for the full fix. Backend change alone improves seed data passing;
  agent change alone improves enrichment quality. Both together resolve all five issues.
