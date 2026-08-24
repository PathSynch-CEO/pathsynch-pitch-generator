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

// ─── Cache contract (PR #98) ──────────────────────────────────────────────────
// The cache stores SEMANTIC BLS facts only (dataYear + per-metric value/effectiveNaics/state/withholdCause).
// ALL presentation (county label, provenance sentence, source URL, widening wording) is rebuilt by current
// code AFTER the cache read, so a formatter change is never masked by a cached string. Old finished-result
// docs (pre-#98) lack `cacheContractVersion` and are rejected as cache MISSES (self-healing; no manual purge).
//   v3: adds `wage` (annual_avg_wkly_wage, with same-level otyPct) and `lq` (lq_annual_avg_emplvl)
//       metric semantics. v2 docs lack them and are rejected as misses (self-healing re-fetch).
const CACHE_CONTRACT_VERSION = 3;

// Publication-window-aware freshness (ratified Gate 2). QCEW annual dataYear Y: preliminary with the Q4-Y
// release (~June Y+1), finalized/revised with the Q1-(Y+1) release (~Sep Y+1). An entry must never re-acquire
// a normal 90-day TTL for a re-landed older/preliminary observation inside a publication window.
const QCEW_NORMAL_TTL_DAYS = 90;
const QCEW_RELEASE_RETRY_TTL_DAYS = 14; // K1′: bounded in-window re-check (~2×/month), no live probe
const DAY_MS = 24 * 60 * 60 * 1000;

// Minimal NAICS-level label map for the widened (4/3-digit) levels the Home Services families walk into.
// The 6-digit label is supplied by the taxonomy; these fill the disclosed widening steps.
const NAICS_LEVEL_LABELS = {
    '2382': 'Building Equipment Contractors', '238': 'Specialty Trade Contractors',
    '2361': 'Residential Building Construction', '236': 'Construction of Buildings',
    '5617': 'Services to Buildings and Dwellings', '561': 'Administrative and Support Services',
    '5621': 'Waste Collection', '562': 'Waste Management and Remediation Services',
    '4842': 'Specialized Freight Trucking', '484': 'Truck Transportation',
    // All-verticals expansion (2026-08-22): widened levels for the newly enabled families.
    // A level not listed here renders as "NAICS {code}" — labels are conveniences, never invented.
    '8111': 'Automotive Repair and Maintenance', '811': 'Repair and Maintenance',
    '4411': 'Automobile Dealers', '441': 'Motor Vehicle and Parts Dealers',
    '4413': 'Automotive Parts, Accessories, and Tire Retailers',
    '6212': 'Offices of Dentists', '621': 'Ambulatory Health Care Services',
    '455': 'General Merchandise Retailers',
    '4581': 'Clothing and Clothing Accessories Retailers', '458': 'Clothing, Clothing Accessories, Shoe, and Jewelry Retailers',
    '4492': 'Electronics and Appliance Retailers', '449': 'Furniture, Home Furnishings, Electronics, and Appliance Retailers',
    '4594': 'Book Retailers, News Dealers, and Miscellaneous Retailers', '459': 'Sporting Goods, Hobby, Musical Instrument, Book, and Miscellaneous Retailers',
    '4491': 'Furniture and Home Furnishings Retailers',
    '4571': 'Gasoline Stations', '457': 'Gasoline Stations and Fuel Dealers',
    // NAICS backfill batch 1 (2026-08-24): widened levels for salon_beauty, food_beverage and the
    // five newly mapped health_wellness subs.
    '8121': 'Personal Care Services', '812': 'Personal and Laundry Services',
    '7225': 'Restaurants and Other Eating Places', '7224': 'Drinking Places (Alcoholic Beverages)',
    '7223': 'Special Food Services', '722': 'Food Services and Drinking Places',
    '3121': 'Beverage Manufacturing', '312': 'Beverage and Tobacco Product Manufacturing',
    '3118': 'Bakeries and Tortilla Manufacturing', '311': 'Food Manufacturing',
    '7139': 'Other Amusement and Recreation Industries', '713': 'Amusement, Gambling, and Recreation Industries',
    '6211': 'Offices of Physicians', '6213': 'Offices of Other Health Practitioners',
    // NAICS backfill batch 2 (2026-08-24): widened levels for professional_services,
    // construction_trades and hospitality_lodging.
    '5411': 'Legal Services', '541': 'Professional, Scientific, and Technical Services',
    '5416': 'Management, Scientific, and Technical Consulting Services',
    '5312': 'Offices of Real Estate Agents and Brokers', '531': 'Real Estate',
    '5242': 'Agencies, Brokerages, and Other Insurance Related Activities', '524': 'Insurance Carriers and Related Activities',
    '5239': 'Other Financial Investment Activities', '523': 'Securities, Commodity Contracts, and Other Financial Investments and Related Activities',
    '6114': 'Business Schools and Computer and Management Training', '611': 'Educational Services',
    '2362': 'Nonresidential Building Construction',
    '7211': 'Traveler Accommodation', '721': 'Accommodation',
    // Pre-existing gaps, found by generalising the widened-label guard over EVERY allowed sub
    // rather than only the current batch: roofing (238160) and sporting_outdoor (459110).
    '2381': 'Foundation, Structure, and Building Exterior Contractors',
    '4591': 'Sporting Goods, Hobby, and Musical Instrument Retailers'
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

// ─── Publication-window freshness (deterministic; no network probe) ───────────
// Latest annual dataYear the service should be able to fetch given the calendar: Jun–Dec ⇒ prior year
// (Q4 release brings preliminary annual); Jan–May ⇒ two years back.
function expectedLatestAnnualYear(now) {
    const d = now || new Date();
    return d.getUTCMonth() >= 5 ? d.getUTCFullYear() - 1 : d.getUTCFullYear() - 2; // getUTCMonth: Jun = 5
}

// Earliest window start (Jun 1 or Sep 1) strictly after `now`.
function nextWindowStartAfter(now) {
    const C = now.getUTCFullYear(), t = now.getTime();
    for (const c of [Date.UTC(C, 5, 1), Date.UTC(C, 8, 1), Date.UTC(C + 1, 5, 1)]) {
        if (c > t) return new Date(c);
    }
    return new Date(Date.UTC(C + 1, 5, 1));
}

// Compute expiry from `now` + the landed `dataYear`. NEW_YEAR window = June, REVISION window = September.
// Lagging (older year than expected) OR in-window ⇒ short retry (never a fresh 90d for a re-landed old year).
// Quiet period ⇒ 90d capped so the entry cannot survive into the next window.
function computeExpiry(now, dataYear) {
    const m = now.getUTCMonth();
    const inWindow = (m === 5) || (m === 8); // [Jun 1, Jul 1) or [Sep 1, Oct 1)
    let ttlDays;
    if (dataYear < expectedLatestAnnualYear(now) || inWindow) {
        ttlDays = QCEW_RELEASE_RETRY_TTL_DAYS;
    } else {
        const capDays = (nextWindowStartAfter(now).getTime() - now.getTime()) / DAY_MS;
        ttlDays = Math.min(QCEW_NORMAL_TTL_DAYS, Math.max(0, capDays));
    }
    return new Date(now.getTime() + ttlDays * DAY_MS);
}

// ─── Semantic cache payload + presentation rebuild ────────────────────────────
// Reduce a walk result to the minimal BLS-derived semantic fact for one metric. A missing walk result
// (metric not attempted — e.g. a semantics payload built before the metric existed) reads as withheld
// no_data, never as a crash.
function metricSemantic(r) {
    if (!r) return { state: 'withheld', withholdCause: 'no_data' };
    return r.ok
        ? { state: 'external', value: r.value, effectiveNaics: r.code }
        : { state: 'withheld', withholdCause: r.withholdCause };
}
// wage carries its own same-level OTY% (read from the SAME landed row as the wage value, so the
// comparison is like-for-like by construction — mirroring how employment yoy is same-level).
function semanticsFromWalk(dataYear, emp, yoy, est, wage, wageOtyPct, lq) {
    const wageSem = metricSemantic(wage);
    if (wageSem.state === 'external' && wageOtyPct != null) wageSem.otyPct = wageOtyPct;
    return {
        cacheContractVersion: CACHE_CONTRACT_VERSION,
        dataYear,
        metrics: {
            employment: metricSemantic(emp),
            yoy: metricSemantic(yoy),
            establishments: metricSemantic(est),
            wage: wageSem,
            lq: metricSemantic(lq)
        }
    };
}

// Rebuild the finished section result from SEMANTIC facts + fresh request args. Runs identically whether the
// semantics came from a cache hit or a fresh walk — so presentation always reflects CURRENT code. Per-metric
// effectiveNaics is honored independently (metrics may land at different levels).
function buildResult(args, sem) {
    const { fips5, county, state, naicsCode, naicsLabel } = args;
    const dataYear = sem.dataYear;
    const comparisonYear = dataYear - 1;
    const walk = buildWalk(naicsCode, naicsLabel);
    const finestCode = walk[0].code;
    // sourceUrl is RECONSTRUCTED (K4) from the landed dataYear + area FIPS — byte-identical to the fetched
    // URL because `dataYear` is the year that actually returned; never a stored/frozen string.
    const sourceUrl = buildSourceUrl(dataYear, fips5);

    const build = (m, withComparison) => {
        if (m && m.state === 'external') {
            const code = m.effectiveNaics;
            const label = levelLabel(code, code === finestCode ? naicsLabel : null);
            const widened = code !== finestCode;
            // wage: same-level OTY% rides along when the landed row disclosed it (comparison wording
            // applies exactly when the OTY value exists — never a bare "vs" sentence without a value).
            const hasOty = m.otyPct != null;
            const out = {
                state: 'external', value: m.value, effectiveNaics: code, effectiveNaicsLabel: label,
                dataYear, widened,
                provenance: provenanceFor(dataYear, county, state, code, label, widened ? finestCode : null,
                    finestCode, (withComparison || hasOty) ? comparisonYear : null, sourceUrl)
            };
            if (withComparison || hasOty) out.comparisonYear = comparisonYear;
            if (hasOty) out.otyPct = m.otyPct;
            return out;
        }
        return withheldMetric(m ? m.withholdCause : 'no_data', null, walk);
    };

    return {
        status: 'ok',
        county, state, fips5, sourceUrl,
        requestedNaics: { code: naicsCode, label: naicsLabel || null },
        dataYear, comparisonYear,
        metrics: {
            employment: build(sem.metrics.employment, false),
            yoy: build(sem.metrics.yoy, true),
            establishments: build(sem.metrics.establishments, false),
            wage: build(sem.metrics.wage, false),
            lq: build(sem.metrics.lq, false)
        }
    };
}

/**
 * Core entry point. Returns a section-shaped object with three metric results.
 * @param {object} args - { fips5, county, state, naicsCode, naicsLabel }
 * @param {object} [deps] - { now, fetchLatestAnnualArea, checkCache, writeCache } for deterministic tests
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

    // Cache is exercised in production and whenever a test injects checkCache/writeCache; otherwise an
    // injected fetch alone (deterministic fixture mode) bypasses the shared Firestore cache.
    const useCache = deps.checkCache ? true : !deps.fetchLatestAnnualArea;
    const _check = deps.checkCache || checkCache;
    const _write = deps.writeCache || writeCache;
    const cacheKey = `${fips5}_${naicsCode}`;

    // ── Cache read (SEMANTIC) — old finished-result docs are rejected as misses by the version guard;
    // presentation is rebuilt from the cached semantics by CURRENT code, so no stale string can survive.
    if (useCache) {
        const sem = await _check(cacheKey, now);
        if (sem) return buildResult(args, sem);
    }

    // ── Cache miss — fetch. A transport/parse failure is source_error and NEVER widens, reads as absence,
    // or gets cached (it early-returns before the semantic write).
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
    const walk = buildWalk(naicsCode, naicsLabel);
    const emp = pickMetric(byIndustry, walk, 'annual_avg_emplvl', naicsLabel);
    const est = pickMetric(byIndustry, walk, 'annual_avg_estabs', naicsLabel);
    // YoY value is the row's own pre-computed OTY cell — comparable at that row's level BY CONSTRUCTION.
    const yoy = pickMetric(byIndustry, walk, 'oty_annual_avg_emplvl_pct_chg', naicsLabel);
    // v3 metrics — same walk, same disclosure/widening rules. These columns are OPTIONAL in the header
    // contract: an area file without them degrades per-metric (withheld no_data), never source_error,
    // so employment/yoy/establishments still render.
    const wage = pickMetric(byIndustry, walk, 'annual_avg_wkly_wage', naicsLabel);
    // Wage OTY% is read from the SAME landed row as the wage value (like-for-like by construction).
    const wageOtyPct = wage.ok ? NUM((byIndustry.get(wage.code) || {})['oty_annual_avg_wkly_wage_pct_chg']) : null;
    // Location Quotient of annual-average employment — BLS-computed concentration vs national.
    const lq = pickMetric(byIndustry, walk, 'lq_annual_avg_emplvl', naicsLabel);

    const semantics = semanticsFromWalk(dataYear, emp, yoy, est, wage, wageOtyPct, lq);

    // ── Write SEMANTIC payload with publication-window-aware expiry (not a fixed 90d).
    if (useCache) await _write(cacheKey, semantics, computeExpiry(now, dataYear));

    // ── Build the finished result from the SAME semantics (identical shape hit-or-miss).
    return buildResult(args, semantics);
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
        metrics: { employment: { ...m }, yoy: { ...m }, establishments: { ...m }, wage: { ...m }, lq: { ...m } }
    };
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// Pure validity gate over a stored cache document. Returns the SEMANTIC payload if the doc is a current-shape,
// unexpired, in-freshness entry; else null (→ cache miss). Rejects (as a miss):
//   - old finished-result docs (no `cacheContractVersion` / wrong version) — K5 self-healing migration;
//   - expired entries (publication-window-aware `expiresAt`);
//   - the hard freshness floor: dataYear < currentYear − 2 (safety net, not the newest-year detector).
function readSemanticFromCacheDoc(data, now) {
    if (!data) return null;
    const sem = data.economics || null;
    if (!sem || sem.cacheContractVersion !== CACHE_CONTRACT_VERSION) return null;
    const nowD = now || new Date();
    const expires = data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate() : data.expiresAt;
    if (expires && new Date(expires) < nowD) return null;
    if (typeof sem.dataYear === 'number' && sem.dataYear < (nowD.getUTCFullYear() - 2)) return null;
    return sem;
}

async function checkCache(cacheKey, now) {
    try {
        const db = admin.firestore();
        const doc = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
        if (!doc.exists) return null;
        return readSemanticFromCacheDoc(doc.data(), now);
    } catch (e) {
        console.warn('[IndustryEcon] Cache read failed:', e.message);
        return null;
    }
}

async function writeCache(cacheKey, economics, expiresAt) {
    try {
        const db = admin.firestore();
        await db.collection(CACHE_COLLECTION).doc(cacheKey).set({
            economics, cacheKey,
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt || new Date(Date.now() + QCEW_NORMAL_TTL_DAYS * DAY_MS))
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
    buildSourceUrl,
    // PR #98 cache-contract + freshness (pure, deterministic)
    expectedLatestAnnualYear,
    computeExpiry,
    semanticsFromWalk,
    buildResult,
    readSemanticFromCacheDoc,
    CACHE_CONTRACT_VERSION,
    QCEW_NORMAL_TTL_DAYS,
    QCEW_RELEASE_RETRY_TTL_DAYS
};
