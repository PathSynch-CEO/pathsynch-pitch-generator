# Changelog — April 26, 2026: Prospect Research Agent — Enrichment Quality v2

## Overview

Addresses four enrichment quality problems observed in production batches:
1. **Industry blank** (~30% of prospects) — Places types mapping + name-keyword fallback
2. **Top services missing** — editorial_summary from Place Details injected as tagline/hint
3. **Ratings missing** — Places API called proactively (before agent) as ground truth
4. **Wrong business match** — Places fuzzy-match validation rejects national chains

## Root Cause

The prior architecture relied entirely on Gemini's web search grounding. Two failure modes:
- **Obscure businesses**: Gemini couldn't find enough data → empty fields
- **Common business names**: Gemini found a national chain with the same name → wrong data

## Solution Architecture

Google Places API is now called **proactively in `main.py` before the agent runs**. If a confident match is found (fuzzy name score ≥ 0.5 or name-contained check passes), Places data is:
1. Injected into the agent's input as `placesContext` (ground truth context for Gemini)
2. Also **merged directly into the final response** by `main.py` (overwriting agent fields with verified values)

This dual approach means the rating/review accuracy doesn't depend on Gemini correctly "using" the context — `main.py` enforces it.

---

## Files Changed

| File | Change |
|------|--------|
| `PathSynch_Agents/prospect-research/main.py` | Full rewrite — Places integration, fuzzy match, industry mapping, response merge |
| `PathSynch_Agents/prospect-research/agent.py` | Instruction additions — STEP 0.5, STEP 2 skip, 2 new RULES |
| `PathSynch_Agents/prospect-research/requirements.txt` | Added `httpx` for async Places API calls |
| `functions/services/prospectIntelService.js` | `dataSource` + `businessStatus` fields; skip redundant Places fallback |

## Files NOT Changed

- `PathSynch_Agents/prospect-research/Dockerfile` — unchanged
- `functions/routes/prospectIntelRoutes.js` — unchanged
- `functions/services/googlePlaces.js` — unchanged (still used as backend fallback)
- Any other file — not touched

---

## `main.py` Changes (Full Rewrite)

### New: `fetch_places_context(business_name, city, state)`
Async function. Called before the ADK agent runs. Two API calls:
1. **Places Text Search** — `query = "{businessName} {city}, {state}"`
2. **Place Details** (if place_id found) — fields: `editorial_summary`, `website`, `formatted_phone_number`

**Fuzzy name matching (`_fuzzy_score` + `_names_overlap`):**
- Uses `difflib.SequenceMatcher` — stdlib, no new deps beyond `httpx`
- Score < 0.5 AND names don't overlap (after stripping LLC/Inc/Corp) → reject match
- Score ≥ 0.8 → `confidence: "high"` | 0.5–0.79 → `confidence: "medium"`
- Strips common suffixes (llc, inc, corp, co, ltd) before overlap test

**Returns `None` if:**
- `GOOGLE_API_KEY` not set (graceful skip)
- Text Search returns no results
- Returned name fails both fuzzy score and overlap checks
- Any HTTP error (non-blocking)

### New: `PLACES_TYPE_TO_INDUSTRY` mapping (40 types)
Maps Google Places `types[]` array → SynchIntro industry categories. Ordered specific→generic so first match wins. Generic types (`point_of_interest`, `establishment`, geocoding types, etc.) are in `IGNORED_PLACE_TYPES` and skipped.

### New: `_infer_industry_from_name(name)` (16 regex rules)
Last-resort fallback: if both Places and the agent return no industry, infer from business name keywords. Returns `"Other"` if no rule matches. Mirrors the frontend `_inferIndustryFromName()` table.

### Modified: `research()` endpoint
New flow:
```
1. Call fetch_places_context() — get verified GBP data
2. Inject placesContext into agent_input if match found
3. Run ADK agent with augmented input
4. Parse agent JSON response
5. MERGE Places data onto parsed response (overwrite rating/reviews/industry if Places has them)
6. Last-resort industry inference from business name if still null
7. Return final response
```

**Merge rules (Step 5):**
| Field | Rule |
|-------|------|
| `googleRating` | Places overwrites always (authoritative) |
| `totalReviews` | Places overwrites always (authoritative) |
| `industry` | Places fills only if agent returned null |
| `websiteUrl` | Places fills only if agent returned null/None |
| `phone` | Places fills only if agent returned null |
| `tagline` | Places `editorialSummary` fills if agent returned null |
| `businessStatus` | Always set from Places (OPERATIONAL/CLOSED_TEMPORARILY/CLOSED_PERMANENTLY) |
| `dataSource` | Set to `"mixed"` if Places was used, `"gemini_only"` otherwise |
| `placesNameMatch` | Float 0.0–1.0 fuzzy score stored for diagnostics |

**Business status warnings**: If `CLOSED_TEMPORARILY` or `CLOSED_PERMANENTLY`, appends to `buyingSignals[]`.

---

## `agent.py` Changes

### New STEP 0.5 — Google Places Verified Data
Inserted between STEP 0 (Seed Data) and STEP 1 (Address & Phone).

Tells the agent:
- What fields `placesContext` contains and that they're pre-verified
- To use `placesContext.rating` and `totalReviews` exactly (not re-search)
- To **SKIP Step 2** when `placesContext.rating` is non-null
- To use `placesContext.website` as the starting URL for Step 4 scraping
- To use `editorialSummary` as a hint for services extraction
- That its job is now SUPPLEMENTAL (find services, buying signals, decision maker, social)

### Modified STEP 2 — Added skip guard
```
SKIP THIS ENTIRE STEP if the input JSON contained a 'placesContext' field with
non-null 'rating' — that value is already verified. Jump directly to Step 3.
```

### Modified RULES — 2 new rules
1. "If 'placesContext' was provided in the input, NEVER override its 'rating' or 'totalReviews' values — use them exactly as given in the JSON output."
2. "If 'placesContext.industry' was non-null, use it as the industry — do not substitute a different category."
3. Enhanced wrong-business guidance: "use the name you actually found as 'prospectBusiness' but only accept data from it if it's in the same city and same industry category. Set confidence to 'medium' for name mismatches."

---

## `prospectIntelService.js` Changes

### `processOneProspect` — data source tracking

**New variables (after agent call):**
```javascript
const agentDataSource = agentResult.dataSource   || 'gemini_only'; // 'mixed' | 'gemini_only'
const businessStatus  = agentResult.businessStatus || 'UNKNOWN';
const agentUsedPlaces = agentDataSource === 'mixed';
```

**Backend Places fallback — skip rating when agent used Places:**
```javascript
// Skip rating fallback if main.py already merged Places data
const agentRatingMissing = !agentUsedPlaces && agentResult.googleRating == null;
```

This prevents a redundant second Places API call for the same business. The backend fallback still runs for website (agent might have found a website via scraping even if Places was used).

**New fields in enriched payload:**
```javascript
dataSource:     agentDataSource,   // 'mixed' | 'gemini_only'
businessStatus: businessStatus,    // 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | etc.
```

**`ratingSource` corrected:** When `agentUsedPlaces === true`, `ratingSource` is initialized to `'google_places'` instead of `'agent:gbp'`, so the source attribution on the Firestore doc is accurate.

---

## `requirements.txt` Changes

Added `httpx` — async HTTP client for Places API calls in `main.py`. Selected over `aiohttp` (simpler API) and `urllib.request` (sync, would block the FastAPI event loop).

---

## Environment Variables

No new env vars required. The Cloud Run agent already has `GOOGLE_API_KEY` set. `main.py` reads this from `os.environ.get("GOOGLE_API_KEY")` and silently skips the Places call if it's missing.

---

## Expected Impact

| Problem | Before | After |
|---------|--------|-------|
| Industry blank | ~30% of prospects | Near 0% — 3-layer fallback (Places types → agent classification → name keywords) |
| Top services empty | Many prospects (no website) | Improved — Places `editorialSummary` + GBP category types as hints |
| Ratings missing | Some prospects (Alliance Air Comfort, Mt Productions) | Resolved — Places API verified rating overwrites agent result |
| Wrong business match | Common names find national chain | Resolved — fuzzy name match rejects score < 0.5 AND no name overlap |
| `dataSource` tracking | Not tracked | `"mixed"` when Places was used, `"gemini_only"` otherwise |
| Business status | Not tracked | `OPERATIONAL` / `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY` |

---

## Performance Notes

- **Places adds ~200-400ms** per prospect (2 HTTP calls: Text Search + Place Details)
- **Saves ~1 Gemini search tool call** per prospect when Places match is found (STEP 2 skipped)
- Net latency impact: roughly neutral — one fewer Gemini search, two Places REST calls
- **When Places returns no match**: zero latency cost, agent runs exactly as before
- **Backend fallback**: still fires for website/phone gaps, but skips rating when `dataSource === 'mixed'`

---

## Deploy Steps

### Cloud Run (agent + main.py)
```bash
cd PathSynch_Agents/prospect-research
gcloud builds submit --tag gcr.io/pathconnect-442522/prospect-research .
gcloud run deploy prospect-research \
  --image gcr.io/pathconnect-442522/prospect-research \
  --platform managed \
  --region us-central1 \
  --project pathconnect-442522
```

Verify `GOOGLE_API_KEY` is set on the Cloud Run service (it should already be set):
```bash
gcloud run services describe prospect-research \
  --region us-central1 --project pathconnect-442522 \
  --format='value(spec.template.spec.containers[0].env)'
```

### Firebase Cloud Functions (prospectIntelService.js)
```bash
cd pathsynch-pitch-generator
npx firebase deploy --only functions --project pathsynch-pitch-creation
```

### Smoke Test
After deploying, test with a prospect that previously had a blank industry:
```bash
curl -X POST https://prospect-research-218613212853.us-central1.run.app/api/research \
  -H "Content-Type: application/json" \
  -d '{"businessName":"Alliance Air Comfort","city":"Atlanta","state":"GA"}'
```
Expected: `googleRating` non-null, `industry` non-null, `dataSource: "mixed"`, `businessStatus: "OPERATIONAL"`.
