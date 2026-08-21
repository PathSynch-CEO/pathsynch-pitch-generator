'use strict';

/**
 * industryEconomicsService.js — BLS QCEW structural-growth data (PR-D).
 *
 * Source: BLS QCEW open ANNUAL-AVERAGE area CSV, https://data.bls.gov/cew/data/api/{year}/a/area/{FIPS5}.csv
 * (free, no key). The `/a/` file is annual-average data, so every "YoY" here is annual-average
 * over-the-year (annual avg Y vs annual avg Y-1), carried on the row as `oty_annual_avg_*_pct_chg`.
 *
 * This module is the county+NAICS fetch/parse/select layer. Policy (which sub-industries may render,
 * county resolution, ledger shaping) lives in services/structuralGrowth.js.
 *
 * Design rules enforced here (Gate 1 decisions):
 *  - NAICS aggregation WALK 6→4→3 (services widening), one step at a time, each widening disclosed in the
 *    metric provenance. County-total-private is NOT a permitted landing — beyond 3-digit we withhold.
 *  - Suppression (disclosure_code 'N') or an absent/blank cell WIDENS one step; `bls_suppressed` is emitted
 *    only when the observation is still not disclosed through the final permitted 3-digit level (and at least
 *    one attempted level was explicitly suppressed); a pure absence at every level is `no_data`.
 *  - API / transport / parse errors NEVER widen and NEVER masquerade as absence — they terminate the whole
 *    section as `source_error`.
 *  - Freshness gate applies to the LATEST observation year only: accept year Y iff Y >= currentYear-2, else
 *    `stale_period`. A passing Y stamps comparisonYear = Y-1 (used only for the YoY label; the YoY value is
 *    the row's own pre-computed OTY, like-for-like at that row's level by construction).
 *  - True-zero is preserved as an observation (no parseInt||0 + >0 collapse); only absence withholds.
 *
 * Cache: Firestore `industryEconomicsCache/{fips5}_{naics}` — 90-day TTL. Only 'ok'/'stale_period'/
 * 'bls_suppressed'/'no_data' outcomes are cached; transient `source_error` is never cached.
 */

const admin = require('firebase-admin');
const { parse } = require('csv-parse/sync');

const CACHE_COLLECTION = 'industryEconomicsCache';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Minimal NAICS-level label map for the widened (4/3-digit) levels the Home Services families walk into.
// The 6-digit label is supplied by the taxonomy; these fill the disclosed widening steps.
const NAICS_LEVEL_LABELS = {
    '2382': 'Building Equipment Contractors', '238': 'Specialty Trade Contractors',
    '2361': 'Residential Building Construction', '236': 'Construction of Buildings',
    '5617': 'Services to Buildings and Dwellings', '561': 'Administrative and Support Services',
    '5621': 'Waste Collection', '562': 'Waste Management and Remediation Services',
    '4842': 'Specialized Freight Trucking', '484': 'Truck Transportation'
};

function levelLabel(code, sixDigitLabel) {
    if (NAICS_LEVEL_LABELS[code]) return NAICS_LEVEL_LABELS[code];
    if (sixDigitLabel) return sixDigitLabel;
    return `NAICS ${code}`;
}

// Build the sanctioned widening walk for a taxonomy NAICS code: 6→4→3 (or 4→3, or 3). No county-total.
function buildWalk(code, sixDigitLabel) {
    const c = String(code || '').replace(/[^0-9]/g, '');
    const levels = [];
    if (c.length >= 6) { levels.push(c.slice(0, 6)); levels.push(c.slice(0, 4)); levels.push(c.slice(0, 3)); }
    else if (c.length >= 4) { levels.push(c.slice(0, 4)); levels.push(c.slice(0, 3)); }
    else if (c.length >= 3) { levels.push(c.slice(0, 3)); }
    // de-dup consecutive equal (e.g. 3-digit-only input)
    const seen = new Set();
    return levels.filter(x => (x && !seen.has(x) && seen.add(x)))
        .map(x => ({ code: x, label: levelLabel(x, x === c ? sixDigitLabel : null) }));
}

const NUM = (s) => {
    const raw = (s == null ? '' : String(s)).trim();
    if (raw === '') return null;              // absent/blank — NOT zero
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
};

// The exact BLS QCEW annual county source URL for a (year, area FIPS). This is the URL the service
// actually requests; it is propagated into provenance so an 'external' ledger entry is linkable.
function buildSourceUrl(year, fips5) {
    return `https://data.bls.gov/cew/data/api/${year}/a/area/${fips5}.csv`;
}

/**
 * Fetch the latest available QCEW annual area CSV, newest-first, applying the freshness gate to the
 * latest year that returns data. Returns one of:
 *   { text, dataYear }              — usable CSV for a fresh year
 *   { error:'stale_period' }        — newest available year is older than currentYear-2
 *   { error:'source_error', detail} — transport/HTTP(non-404)/empty-body error (terminates; no widening)
 */
async function fetchLatestAnnualArea(fips5, now) {
    const cy = (now || new Date()).getFullYear();
    const probes = [cy - 1, cy - 2, cy - 3, cy - 4];
    for (const year of probes) {
        const url = buildSourceUrl(year, fips5);
        let res;
        try {
            res = await Promise.race([
                fetch(url, { headers: { 'Accept': 'text/csv', 'User-Agent': 'SynchIntro-MarketIntel/1.0' } }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))
            ]);
        } catch (e) {
            return { error: 'source_error', detail: `transport:${e && e.message ? e.message : 'error'}` };
        }
        if (!res.ok) {
            if (res.status === 404) continue;           // year not published yet — probe older (availability, not error)
            return { error: 'source_error', detail: `http_${res.status}` };
        }
        let text;
        try { text = await res.text(); }
        catch (e) { return { error: 'source_error', detail: 'body_read' }; }
        if (!text || text.length < 100) return { error: 'source_error', detail: 'empty_body' };

        // Freshness applies to the LATEST year that returned data. A year-fallback observation therefore
        // carries the fallback year's URL (this loop only sets `url` for the year that actually returned).
        if (year < cy - 2) return { error: 'stale_period', latestYear: year };
        return { text, dataYear: year, sourceUrl: url };
    }
    // Nothing usable returned across the probe window — treat as source unavailability, not "no growth".
    return { error: 'source_error', detail: 'no_area_file' };
}

// Parse the CSV (RFC-4180 via csv-parse: handles embedded commas and escaped quotes) and index
// private-ownership (own_code 5) rows by industry_code. Throws on a malformed/incomplete header so the
// caller can classify it as source_error (a broken response must not read as data absence).
function indexPrivateRowsByIndustry(csvText) {
    let records;
    try {
        records = parse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true });
    } catch (e) {
        throw new Error(`csv_parse:${e && e.message ? e.message : 'error'}`);
    }
    if (!records.length) throw new Error('csv_empty');
    const need = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs', 'oty_annual_avg_emplvl_pct_chg'];
    for (const col of need) {
        if (!(col in records[0])) throw new Error(`missing_column:${col}`);
    }
    const byIndustry = new Map();
    for (const r of records) {
        if (String(r.own_code).trim() !== '5') continue;          // private ownership only
        byIndustry.set(String(r.industry_code).trim(), r);
    }
    return byIndustry;
}

// Walk the levels for one metric cell; return the finest disclosed observation or a withheld cause.
// `allowZero` keeps a true 0 as a valid observation.
function pickMetric(byIndustry, walk, cellKey, sixDigitLabel, { allowZero = true } = {}) {
    let sawSuppressed = false;
    for (let i = 0; i < walk.length; i++) {
        const { code, label } = walk[i];
        const row = byIndustry.get(code);
        if (!row) continue;                                        // industry not present at this level
        if (String(row.disclosure_code).trim() === 'N') { sawSuppressed = true; continue; } // suppressed → widen
        const val = NUM(row[cellKey]);
        if (val == null) continue;                                 // present row but blank cell → widen
        if (val === 0 && !allowZero) continue;
        return { ok: true, value: val, code, label, widenedFrom: i > 0 ? walk[0].code : null };
    }
    return { ok: false, withholdCause: sawSuppressed ? 'bls_suppressed' : 'no_data' };
}

function provenanceFor(dataYear, county, state, code, label, widenedFrom, finestCode, comparisonYear, sourceUrl) {
    const base = `BLS QCEW annual averages, ${dataYear}, ${county}, ${state} — private ownership, NAICS ${code} ${label}`;
    const yoyBit = comparisonYear ? ` (over-the-year vs ${comparisonYear}, same NAICS level)` : '';
    const widenBit = widenedFrom
        ? ` (county data at NAICS ${finestCode} not disclosed; reported at NAICS ${code} ${label})`
        : '';
    // Linkable source — the exact BLS annual county CSV actually requested (landed year + area FIPS).
    const srcBit = sourceUrl ? `. Source: ${sourceUrl}` : '';
    return base + yoyBit + widenBit + srcBit;
}

/**
 * Core entry point. Returns a section-shaped object with three metric results.
 * @param {object} args - { fips5, county, state, naicsCode, naicsLabel }
 * @param {object} [deps] - { now } for deterministic tests
 */
async function getStructuralGrowth(args, deps = {}) {
    const { fips5, county, state, naicsCode, naicsLabel } = args || {};
    const now = deps.now || new Date();

    if (!fips5 || !/^[0-9]{5}$/.test(String(fips5))) {
        return sectionWithheld('no_county_fips', 'County FIPS could not be resolved.', args);
    }
    if (!naicsCode) {
        return sectionWithheld('no_naics', 'This sub-industry is not mapped to a NAICS employment series.', args);
    }

    // An injected fetch (deps.fetchLatestAnnualArea) means deterministic/test mode — bypass the shared cache.
    const useCache = !deps.fetchLatestAnnualArea;
    const cacheKey = `${fips5}_${naicsCode}`;
    if (useCache) {
        const cached = await checkCache(cacheKey);
        if (cached) return cached;
    }

    // Fetch — a transport/parse failure here is source_error and NEVER widens or reads as absence.
    let fetched;
    try {
        fetched = deps.fetchLatestAnnualArea
            ? await deps.fetchLatestAnnualArea(fips5, now)
            : await fetchLatestAnnualArea(fips5, now);
    } catch (e) {
        return sectionWithheld('source_error', 'Employment data source did not respond this run.', args);
    }
    if (fetched.error === 'source_error') {
        return sectionWithheld('source_error', 'Employment data source did not respond this run.', args);
    }
    if (fetched.error === 'stale_period') {
        return sectionWithheld('stale_period',
            `The latest published county employment data (${fetched.latestYear}) is older than the freshness window.`, args);
    }

    let byIndustry;
    try {
        byIndustry = indexPrivateRowsByIndustry(fetched.text);
    } catch (e) {
        // Broken/incomplete CSV — source_error, not absence.
        return sectionWithheld('source_error', 'Employment data source returned an unreadable response this run.', args);
    }

    const dataYear = fetched.dataYear;
    const comparisonYear = dataYear - 1;
    const walk = buildWalk(naicsCode, naicsLabel);
    // Prefer the URL the service actually requested (propagated from the fetch, so a year-fallback links
    // the fallback year); reconstruct from the landed year + area FIPS only if the fetch did not supply it
    // (deterministic/test mode). Either way it carries the SAME landed dataYear and area FIPS.
    const sourceUrl = fetched.sourceUrl || buildSourceUrl(dataYear, fips5);

    const emp = pickMetric(byIndustry, walk, 'annual_avg_emplvl', naicsLabel);
    const est = pickMetric(byIndustry, walk, 'annual_avg_estabs', naicsLabel);
    // YoY value is the row's own pre-computed OTY cell — comparable at that row's level BY CONSTRUCTION.
    const yoy = pickMetric(byIndustry, walk, 'oty_annual_avg_emplvl_pct_chg', naicsLabel);

    const result = {
        status: 'ok',
        county, state, fips5, sourceUrl,
        requestedNaics: { code: naicsCode, label: naicsLabel || null },
        dataYear, comparisonYear,
        metrics: {
            employment: emp.ok
                ? { state: 'external', value: emp.value, effectiveNaics: emp.code, effectiveNaicsLabel: emp.label,
                    dataYear, widened: !!emp.widenedFrom,
                    provenance: provenanceFor(dataYear, county, state, emp.code, emp.label, emp.widenedFrom, walk[0].code, null, sourceUrl) }
                : withheldMetric(emp.withholdCause, 'employment', walk),
            yoy: yoy.ok
                ? { state: 'external', value: yoy.value, effectiveNaics: yoy.code, effectiveNaicsLabel: yoy.label,
                    dataYear, comparisonYear, widened: !!yoy.widenedFrom,
                    provenance: provenanceFor(dataYear, county, state, yoy.code, yoy.label, yoy.widenedFrom, walk[0].code, comparisonYear, sourceUrl) }
                : withheldMetric(yoy.withholdCause, 'yoy', walk),
            establishments: est.ok
                ? { state: 'external', value: est.value, effectiveNaics: est.code, effectiveNaicsLabel: est.label,
                    dataYear, widened: !!est.widenedFrom,
                    provenance: provenanceFor(dataYear, county, state, est.code, est.label, est.widenedFrom, walk[0].code, null, sourceUrl) }
                : withheldMetric(est.withholdCause, 'establishments', walk)
        }
    };

    if (useCache) await writeCache(cacheKey, result);
    return result;
}

function withheldMetric(cause, metric, walk) {
    const finest = walk && walk[0] ? walk[0].code : '';
    const reason = cause === 'bls_suppressed'
        ? `County employment for NAICS ${finest} is withheld by BLS non-disclosure through the 3-digit level.`
        : `County employment for NAICS ${finest} was not published this run.`;
    return { state: 'withheld', withholdCause: cause, reason };
}

function sectionWithheld(cause, reason, args) {
    const a = args || {};
    const m = { state: 'withheld', withholdCause: cause, reason };
    return {
        status: 'withheld',
        county: a.county || null, state: a.state || null, fips5: a.fips5 || null,
        requestedNaics: { code: a.naicsCode || null, label: a.naicsLabel || null },
        dataYear: null, comparisonYear: null,
        metrics: { employment: { ...m }, yoy: { ...m }, establishments: { ...m } }
    };
}

// ─── Cache ───────────────────────────────────────────────────────────────────
async function checkCache(cacheKey) {
    try {
        const db = admin.firestore();
        const doc = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
        if (!doc.exists) return null;
        const data = doc.data();
        const expires = data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate() : null;
        if (expires && expires < new Date()) return null;
        return data.economics || null;
    } catch (e) {
        console.warn('[IndustryEcon] Cache read failed:', e.message);
        return null;
    }
}

async function writeCache(cacheKey, economics) {
    try {
        const db = admin.firestore();
        await db.collection(CACHE_COLLECTION).doc(cacheKey).set({
            economics, cacheKey,
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + CACHE_TTL_MS))
        });
    } catch (e) {
        console.warn('[IndustryEcon] Cache write failed:', e.message);
    }
}

module.exports = {
    getStructuralGrowth,
    // exported for unit tests (pure helpers)
    buildWalk,
    pickMetric,
    indexPrivateRowsByIndustry,
    fetchLatestAnnualArea,
    buildSourceUrl
};
