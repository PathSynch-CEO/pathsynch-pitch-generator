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
const ZYLA_API_URL  = process.env.ZYLA_CRIME_API_URL || 'https://zylalabs.com/api/824/crime+data+by+zipcode+api/583/get+crime+rates+by+zip';
const ZYLA_API_KEY  = process.env.ZYLA_API_KEY || '';

// FBI Crime Data Explorer (free — api.data.gov key)
const FBI_API_URL   = 'https://api.usa.gov/crime/fbi/sapi';
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
    console.log('[SafetyContext][DIAG] getSafetyContext called. flag=' + process.env.ENABLE_CRIME_DATA_ENRICHMENT + ' zip=' + (location.zipCode || 'none') + ' ZYLA_KEY=' + (ZYLA_API_KEY ? 'set' : 'missing') + ' FBI_KEY=' + (FBI_API_KEY ? 'set' : 'missing'));
    if (process.env.ENABLE_CRIME_DATA_ENRICHMENT !== 'true') {
        console.log('[SafetyContext] ENABLE_CRIME_DATA_ENRICHMENT is not true — skipping safety data fetch');
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
        const url = `${ZYLA_API_URL}?zip=${encodeURIComponent(zipCode)}`;
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

    // UCR data: fixed range with known-good data availability
    const since = 2019;
    const until = 2022;

    try {
        const url = `${FBI_API_URL}/api/estimates/states/${stateAbbr.toUpperCase()}/${since}/${until}?api_key=${encodeURIComponent(FBI_API_KEY)}`;
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

    // Extract Zyla fields — actual response shape:
    // { Overall: { "Overall Crime Grade", "Violent Crime Grade", "Property Crime Grade", "Other Crime Grade" },
    //   "Crime BreakDown": [ { "Violent Crime Rates": {...} }, { "Property Crime Rates": {...} } ],
    //   "Crime Rates Nearby": [...] }
    let zipLevel = null;
    if (zylaData) {
        const overall   = zylaData.Overall || {};
        const breakdown = zylaData['Crime BreakDown'] || [];
        const violent   = breakdown[0]?.['Violent Crime Rates'] || {};
        const property  = breakdown[1]?.['Property Crime Rates'] || {};
        zipLevel = {
            grade:              overall['Overall Crime Grade']   || null,
            violentGrade:       overall['Violent Crime Grade']   || null,
            propertyGrade:      overall['Property Crime Grade']  || null,
            otherGrade:         overall['Other Crime Grade']     || null,
            violentCrimeRate:   violent.Assault                  || null,
            propertyCrimeRate:  property.Theft                   || null,
            totalViolent:       breakdown[0]?.['0']?.['Total Violent Crime']   || null,
            totalProperty:      breakdown[1]?.['0']?.['Total Property Crime']  || null,
            nearby:             zylaData['Crime Rates Nearby']   || [],
            county:             null
        };
    }

    // Extract FBI fields (SAPI estimates endpoint)
    // Response shape: [{ state_abbr, year, population, violent_crime, property_crime, ... }]
    let stateLevel = null;
    if (fbiData) {
        // Estimates endpoint returns an array of year objects
        const results = Array.isArray(fbiData) ? fbiData : (fbiData.results || fbiData.data || []);
        if (results.length > 0) {
            // Sort by year descending, take most recent
            const sorted = results.sort((a, b) => (b.year || 0) - (a.year || 0));
            const latest = sorted[0];
            stateLevel = {
                year:               latest.year,
                state:              state,
                population:         latest.population         || null,
                violentCrime:       latest.violent_crime      || null,
                propertyCrime:      latest.property_crime     || null,
                homicide:           latest.homicide           || null,
                robbery:            latest.robbery            || null,
                aggravatedAssault:  latest.aggravated_assault || null,
                burglary:           latest.burglary           || null,
                larceny:            latest.larceny            || null,
                motorVehicleTheft:  latest.motor_vehicle_theft || null
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
