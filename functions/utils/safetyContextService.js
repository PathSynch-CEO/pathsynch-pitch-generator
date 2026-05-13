'use strict';

/**
 * Safety & Local Operating Context Service
 *
 * Fetches ZIP-level and state-level safety data from two providers:
 *   1. Zyla Labs Crime Data by ZipCode (ZIP-level granularity)
 *   2. FBI Crime Data Explorer API (authoritative state-level UCR data)
 *
 * Data is used ONLY for local operating context — foot traffic patterns,
 * customer comfort, after-hours operations, staffing, and trust signals.
 * It is NEVER used to score, rank, or exclude prospects.
 *
 * Feature flag: ENABLE_CRIME_DATA_ENRICHMENT=true (default: disabled)
 * Cache TTL: 90 days (crime stats change slowly)
 *
 * Compliance: FCRA / ECOA do not apply to B2B sales intelligence,
 * but the data must NOT be used for lending, housing, employment,
 * insurance, or eligibility decisions. Mandatory disclaimer on every render.
 */

const admin = require('firebase-admin');

const CACHE_COLLECTION = 'safetyContextCache';
const RAW_COLLECTION   = 'safetyContextRaw';
const CACHE_TTL_MS     = 90 * 24 * 60 * 60 * 1000; // 90 days

// Zyla Labs direct endpoint (Crime Data by ZipCode API)
// Set ZYLA_CRIME_API_URL in .env if the endpoint path changes.
const ZYLA_API_URL  = process.env.ZYLA_CRIME_API_URL || 'https://zylalabs.com/api/1236/crime+data+by+zipcode+api/1091/get+crime+data+by+zipcode';
const ZYLA_API_KEY  = process.env.ZYLA_API_KEY || '';

// FBI Crime Data Explorer (free — api.data.gov key)
const FBI_API_URL   = 'https://api.usa.gov/crime/fbi/cde';
const FBI_API_KEY   = process.env.FBI_CRIME_API_KEY || '';

/**
 * Main entry point — returns normalized safety context or null.
 *
 * @param {Object} location  - { zipCode, state } (state = 2-letter abbr)
 * @param {string} category  - Business category (unused by APIs, kept for future filtering)
 * @returns {Promise<Object|null>}
 */
async function getSafetyContext(location, category) {
    // Feature flag — flip ENABLE_CRIME_DATA_ENRICHMENT=false to disable without redeploy
    if (process.env.ENABLE_CRIME_DATA_ENRICHMENT !== 'true') {
        return null;
    }

    const zipCode = (location.zipCode || '').replace(/\D/g, '').slice(0, 5);
    const state   = (location.state || '').toUpperCase().trim();

    if (!zipCode || zipCode.length < 5) {
        console.warn('[SafetyContext] No valid ZIP code — skipping');
        return null;
    }

    // Cache check
    const cached = await checkCache(zipCode);
    if (cached) {
        console.log(`[SafetyContext] Cache hit for ZIP ${zipCode}`);
        return cached;
    }

    // Parallel fetch from both providers
    const [zylaResult, fbiResult] = await Promise.allSettled([
        fetchZylaData(zipCode),
        fetchFBIData(state)
    ]);

    const zylaData = zylaResult.status === 'fulfilled' ? zylaResult.value : null;
    const fbiData  = fbiResult.status  === 'fulfilled' ? fbiResult.value  : null;

    // Log provider outcomes
    const zylaStatus = zylaData
        ? 'success'
        : (ZYLA_API_KEY ? 'failed' : 'missing_key');
    const fbiStatus  = fbiData
        ? 'success'
        : (FBI_API_KEY  ? 'failed' : 'missing_key');

    console.log(`[SafetyContext] ZIP=${zipCode} Zyla=${zylaStatus} FBI=${fbiStatus}`);

    // Cache raw responses for debugging
    const db = admin.firestore();
    if (zylaData) {
        db.collection(RAW_COLLECTION)
            .doc(`${zipCode}_zyla`)
            .set({ zipCode, raw: zylaData, fetchedAt: admin.firestore.FieldValue.serverTimestamp() })
            .catch(e => console.warn('[SafetyContext] Raw Zyla cache write failed:', e.message));
    }
    if (fbiData) {
        db.collection(RAW_COLLECTION)
            .doc(`${zipCode}_fbi`)
            .set({ state, raw: fbiData, fetchedAt: admin.firestore.FieldValue.serverTimestamp() })
            .catch(e => console.warn('[SafetyContext] Raw FBI cache write failed:', e.message));
    }

    // If both providers failed, return null (hide card)
    if (!zylaData && !fbiData) {
        console.warn('[SafetyContext] Both providers failed — hiding card');
        return null;
    }

    // Normalize into a consistent shape
    const normalized = normalizeData(zipCode, state, zylaData, fbiData, zylaStatus, fbiStatus);
    if (!normalized) return null;

    // Write to 90-day cache
    await writeCache(zipCode, normalized);

    return normalized;
}

// ─── Zyla Labs Fetch ───────────────────────────────────────────────────────

async function fetchZylaData(zipCode) {
    if (!ZYLA_API_KEY) {
        console.warn('[SafetyContext] ZYLA_API_KEY not set — skipping Zyla');
        return null;
    }

    try {
        const url = `${ZYLA_API_URL}?zipCode=${encodeURIComponent(zipCode)}`;
        const res = await Promise.race([
            fetch(url, {
                method:  'GET',
                headers: {
                    'Authorization': `Bearer ${ZYLA_API_KEY}`,
                    'Content-Type':  'application/json'
                }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
        ]);

        if (!res.ok) {
            console.warn(`[SafetyContext] Zyla returned ${res.status} for ZIP ${zipCode}`);
            return null;
        }

        const body = await res.json();
        return body;
    } catch (err) {
        console.warn('[SafetyContext] Zyla fetch failed (non-blocking):', err.message);
        return null;
    }
}

// ─── FBI Crime Data Explorer Fetch ────────────────────────────────────────

async function fetchFBIData(stateAbbr) {
    if (!FBI_API_KEY) {
        console.warn('[SafetyContext] FBI_CRIME_API_KEY not set — skipping FBI');
        return null;
    }
    if (!stateAbbr || stateAbbr.length !== 2) {
        console.warn('[SafetyContext] Invalid state abbr for FBI fetch:', stateAbbr);
        return null;
    }

    // UCR data: most recent complete year available (FBI publishes 1-2yr lag)
    const currentYear = new Date().getFullYear();
    const since       = currentYear - 3;
    const until       = currentYear - 1;

    try {
        const url = `${FBI_API_URL}/offenses/state/abbr/${stateAbbr.toLowerCase()}/${since}/${until}?API_KEY=${encodeURIComponent(FBI_API_KEY)}`;
        const res = await Promise.race([
            fetch(url, { method: 'GET' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
        ]);

        if (!res.ok) {
            console.warn(`[SafetyContext] FBI API returned ${res.status} for state ${stateAbbr}`);
            return null;
        }

        const body = await res.json();
        return body;
    } catch (err) {
        console.warn('[SafetyContext] FBI fetch failed (non-blocking):', err.message);
        return null;
    }
}

// ─── Normalization ─────────────────────────────────────────────────────────

function normalizeData(zipCode, state, zylaData, fbiData, zylaStatus, fbiStatus) {
    // Determine which providers succeeded
    const hasZyla = !!zylaData;
    const hasFBI  = !!fbiData;

    if (!hasZyla && !hasFBI) return null;

    const status = (hasZyla && hasFBI) ? 'complete'
                 : (hasZyla || hasFBI)  ? 'partial'
                 :                        'unavailable';

    if (status === 'unavailable') return null;

    // Confidence is calculated server-side, not by Gemini
    const confidence = (hasZyla && hasFBI) ? 'high'
                     : (hasZyla || hasFBI)  ? 'medium'
                     :                        'low';

    // Extract Zyla fields (shape may vary — handle defensively)
    let zipLevel = null;
    if (zylaData) {
        // Zyla response is typically { zipCode, totalCrimeRate, violentCrimeRate,
        // propertyCrimeRate, safetyIndex, grade, ... }
        // Field names vary between Zyla API versions — use defensive extraction
        const z = zylaData.data || zylaData;
        zipLevel = {
            safetyIndex:        z.safetyIndex         || z.safety_index    || null,
            grade:              z.grade               || null,
            totalCrimeRate:     z.totalCrimeRate       || z.total_crime_rate || null,
            violentCrimeRate:   z.violentCrimeRate     || z.violent_crime_rate || null,
            propertyCrimeRate:  z.propertyCrimeRate    || z.property_crime_rate || null,
            nationalComparison: z.nationalComparison   || z.national_comparison || null,
            stateComparison:    z.stateComparison      || z.state_comparison   || null,
            county:             z.county               || null
        };
    }

    // Extract FBI fields (UCR state-level data)
    // FBI CDE response structure: { pagination, results: [{ data_year, offense, state_abbr, count }] }
    let stateLevel = null;
    if (fbiData) {
        const results = fbiData.results || fbiData.data || [];
        // Summarize by offense type for the most recent year available
        const grouped = {};
        for (const r of (Array.isArray(results) ? results : [])) {
            const yr = r.data_year || r.year;
            if (!grouped[yr]) grouped[yr] = {};
            const offense = (r.offense || r.offenseType || '').toLowerCase();
            grouped[yr][offense] = (grouped[yr][offense] || 0) + (parseInt(r.count) || 0);
        }
        const years = Object.keys(grouped).sort((a, b) => Number(b) - Number(a));
        if (years.length > 0) {
            stateLevel = {
                year:    years[0],
                state:   stateAbbr,
                summary: grouped[years[0]]
            };
        }
    }

    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

    return {
        status,
        confidence,
        zipCode,
        state,
        county:    zipLevel?.county || null,
        providers: {
            zyla: { status: zylaStatus,  dataAvailable: hasZyla },
            fbi:  { status: fbiStatus,   dataAvailable: hasFBI  }
        },
        zipLevel,
        stateLevel,
        narratives:  null,  // filled by safetyContextNarrative.js
        expiresAt:   admin.firestore.Timestamp.fromDate(expiresAt)
    };
}

// ─── Cache Helpers ─────────────────────────────────────────────────────────

async function checkCache(zipCode) {
    try {
        const db  = admin.firestore();
        const doc = await db.collection(CACHE_COLLECTION).doc(zipCode).get();
        if (!doc.exists) return null;

        const data = doc.data();

        // Check TTL
        const expiry = data.expiresAt?.toDate?.();
        if (expiry && expiry < new Date()) {
            console.log(`[SafetyContext] Cache expired for ZIP ${zipCode}`);
            return null;
        }

        return data.safetyContext || null;
    } catch (err) {
        console.warn('[SafetyContext] Cache read failed (non-blocking):', err.message);
        return null;
    }
}

async function writeCache(zipCode, safetyContext) {
    try {
        const db = admin.firestore();
        await db.collection(CACHE_COLLECTION).doc(zipCode).set({
            safetyContext,
            zipCode,
            cachedAt:  admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: safetyContext.expiresAt
        });
    } catch (err) {
        console.warn('[SafetyContext] Cache write failed (non-blocking):', err.message);
    }
}

module.exports = { getSafetyContext };
