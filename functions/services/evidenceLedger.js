'use strict';

/**
 * evidenceLedger.js — Story S3: the evidence gate and the Evidence Ledger.
 *
 * The gate is absolute (Gate 1 Hard Rule 1): a question whose dependencies do not resolve produces a
 * WITHHELD ledger entry with a plain reason, never a hedged sentence. The Evidence Ledger is the
 * report-output record of every tracked question and the state of its evidence, mirroring the mockup's
 * chip system:
 *   - computed : derived from the businesses this run pulled (always states its n)
 *   - external : an external source, always linkable
 *   - curated  : sub-industry pack knowledge, labeled curated, carries the pack version
 *   - merchant : locked until the prospect supplies a number (dollarized impact)
 *   - withheld : data did not resolve this run; the section is not rendered
 *
 * The ledger is deterministic over the already-assembled reportData. It renders only what the report
 * actually contains: demand-driver and segment (curated) rows arrive with PR-E when those sections
 * render, so the ledger never claims a curated section that does not yet exist.
 */

const { MIN_N } = require('./evidencePainPoints');

const STATE = Object.freeze({
    COMPUTED: 'computed',
    EXTERNAL: 'external',
    CURATED: 'curated',
    MERCHANT: 'merchant',
    WITHHELD: 'withheld'
});

// Extended withhold-cause vocabulary (PR-D). `resolver_error` (a thrown resolver) is set by gate() itself;
// the rest are supplied by the caller via `withholdCause` when a resolver legitimately returns no detail.
const WITHHOLD_CAUSE = Object.freeze({
    NO_DATA: 'no_data',
    RESOLVER_ERROR: 'resolver_error',
    BLS_SUPPRESSED: 'bls_suppressed',
    STALE_PERIOD: 'stale_period',
    NO_COUNTY_FIPS: 'no_county_fips',
    NO_NAICS: 'no_naics',
    LOW_CONFIDENCE_NAICS: 'low_confidence_naics',
    SOURCE_ERROR: 'source_error'
});

/**
 * The gate primitive. `resolve()` returns a truthy detail object to admit the question at `state`, or
 * null/undefined to withhold it with `withheldReason`. resolve() throwing is treated as withheld, so a
 * single malformed section can never crash the ledger.
 *
 * B1: a resolver that THROWS is logged with its id and the error message, and the withheld entry
 * carries an internal `withholdCause: 'resolver_error'` (vs `'no_data'` for a legitimate absence). The
 * customer-facing `reason` string is identical in both cases — a data-source outage must be visible in
 * the logs and in the internal cause, never softened in the copy the merchant reads.
 *
 * `withholdCause` (optional): the cause stamped on a legitimate (non-throwing) withhold. Defaults to
 * 'no_data' for backward compatibility; PR-D callers pass the specific cause (bls_suppressed, stale_period,
 * no_county_fips, no_naics, low_confidence_naics, source_error). A THROW always overrides to 'resolver_error'.
 *
 * @returns {{id, label, state, detail?, provenance?, n?, reason?, withholdCause?}}
 */
function gate({ id, label, state, resolve, withheldReason, withholdCause }) {
    let detail = null;
    let threw = false;
    try {
        detail = typeof resolve === 'function' ? resolve() : resolve;
    } catch (e) {
        threw = true;
        console.warn(`[EvidenceLedger] resolver "${id}" threw; withholding as resolver_error: ${e && e.message ? e.message : e}`);
    }
    if (!detail) {
        return {
            id, label,
            state: STATE.WITHHELD,
            reason: withheldReason || 'Data did not resolve this run.',
            withholdCause: threw ? WITHHOLD_CAUSE.RESOLVER_ERROR : (withholdCause || WITHHOLD_CAUSE.NO_DATA)
        };
    }
    return Object.assign({ id, label, state }, detail);
}

// Template detail line for a resolved structural-growth metric (no model prose). Per-metric effective
// NAICS level is stamped so the ledger never implies all three metrics describe the identical scope.
function sgDetail(metricKey, m) {
    const lvl = m.effectiveNaics ? ` at NAICS ${m.effectiveNaics}` : '';
    if (metricKey === 'yoy') {
        const sign = m.value > 0 ? '+' : '';
        return `${sign}${m.value}% over the year (annual-average${lvl})`;
    }
    if (metricKey === 'establishments') {
        return `${m.value} establishments${lvl}`;
    }
    return `${m.value} jobs${lvl}`;
}

function countPopulation(reportData) {
    const d = (reportData && reportData.data) || {};
    const leads = Array.isArray(d.leads) ? d.leads.length : 0;
    const competitors = Array.isArray(d.competitors) ? d.competitors.length : 0;
    return { leads, competitors, total: leads + competitors };
}

/**
 * Build the Evidence Ledger.
 *
 * @param {object} reportData - full report object (read-only)
 * @param {object} ctx        - resolved companions: { pack, weaknessThemes, evidencePainPoints }
 * @returns {{entries:Array, packVersion:string|null, computedCount:number, withheldCount:number}}
 */
function buildEvidenceLedger(reportData, ctx) {
    const c = ctx || {};
    const pop = countPopulation(reportData);
    const weakness = c.weaknessThemes || null;
    const pain = c.evidencePainPoints || null;
    const pack = c.pack || null;
    const entries = [];

    // Competitive landscape — the analyzed set itself.
    entries.push(gate({
        id: 'competitive_landscape', label: 'Competitive landscape', state: STATE.COMPUTED,
        withheldReason: 'No businesses were identified in this market.',
        resolve: () => pop.total > 0
            ? { detail: `${pop.total} businesses analyzed`, provenance: `Computed from ${pop.total} businesses`, n: pop.total }
            : null
    }));

    // Cost of pain (S2 evidence pain points).
    entries.push(gate({
        id: 'cost_of_pain', label: 'Cost of the pain', state: STATE.COMPUTED,
        withheldReason: `Fewer than ${MIN_N} businesses analyzed; no measured pain point is trustworthy.`,
        resolve: () => {
            if (!pain || pop.total < MIN_N) return null;
            const fired = Array.isArray(pain.items) ? pain.items.length : 0;
            return fired > 0
                ? { detail: `${fired} measured pain point${fired === 1 ? '' : 's'}`, provenance: `Computed from ${pain.computedCount || pop.total} businesses`, n: pain.computedCount || pop.total }
                : { detail: 'No pain threshold crossed', provenance: `Computed from ${pain.computedCount || pop.total} businesses`, n: pain.computedCount || pop.total };
        }
    }));

    // Competitive weaknesses (S3 Addition 1 — the gate's first consumer).
    entries.push(gate({
        id: 'competitive_weaknesses', label: 'Competitive weaknesses', state: STATE.COMPUTED,
        withheldReason: weakness && Array.isArray(weakness.withheld) && weakness.withheld.length
            ? weakness.withheld[0].reason
            : 'No weakness metric resolved for the analyzed businesses.',
        resolve: () => {
            if (!weakness) return null;
            const fired = Array.isArray(weakness.items) ? weakness.items.length : 0;
            if (fired > 0) {
                return { detail: `${fired} weakness${fired === 1 ? '' : 'es'}`, provenance: `Computed from ${weakness.n} businesses`, n: weakness.n };
            }
            // Some metric resolved but nothing crossed threshold — still computed (measured), not withheld.
            const anyMeasured = weakness.n >= MIN_N;
            return anyMeasured
                ? { detail: 'No weakness threshold crossed', provenance: `Computed from ${weakness.n} businesses`, n: weakness.n }
                : null;
        }
    }));

    // Digital authority (SEO Landscape aggregate).
    entries.push(gate({
        id: 'digital_authority', label: 'Digital authority (SEO)', state: STATE.COMPUTED,
        withheldReason: 'SEO Landscape did not resolve a market score this run.',
        resolve: () => {
            const seo = reportData && reportData.data && reportData.data.seoLandscape;
            const score = seo && (seo.avgSEOScore || seo.marketAvgScore);
            return score && score > 0
                ? { detail: `Market SEO ${Math.round(score)}/100`, provenance: 'Computed from the SEO Landscape aggregate' }
                : null;
        }
    }));

    // AI visibility — directional (per the AI-Visibility Trust Rules).
    entries.push(gate({
        id: 'ai_visibility', label: 'AI visibility', state: STATE.COMPUTED,
        withheldReason: 'AI-answer sampling did not resolve a mention rate this run.',
        resolve: () => {
            const avi = reportData && reportData.aiVisibilityIntelligence;
            const seoSummary = reportData && reportData.seoIntelligence && reportData.seoIntelligence.marketSummary;
            const rate = (avi && avi.mentionRate != null) ? avi.mentionRate
                : (seoSummary && seoSummary.avgMentionRate != null) ? seoSummary.avgMentionRate
                : null;
            if (rate == null) return null;
            const pct = rate <= 1 ? Math.round(rate * 100) : Math.round(rate);
            return { detail: `${pct}% mention rate (directional)`, provenance: 'Computed from the sampled AI answers' };
        }
    }));

    // Structural growth (PR-D) — BLS QCEW county employment, Home Services only. Three METRIC-level
    // sibling entries (employment / YoY / establishments), each gated independently so the section can
    // show an independently-supported figure while withholding an unsupportable one WITH CAUSE. `external`
    // state: an external, linkable source. Emitted only when the section was computed for this report.
    const sg = c.structuralGrowth;
    if (sg && sg.metrics) {
        const sgEntry = (metricKey, id, label) => {
            const m = sg.metrics[metricKey] || null;
            return gate({
                id, label, state: STATE.EXTERNAL,
                withheldReason: (m && m.reason) || 'County employment data did not resolve this run.',
                withholdCause: (m && m.withholdCause) || WITHHOLD_CAUSE.NO_DATA,
                resolve: () => (m && m.state === 'external' && m.value != null)
                    ? { detail: sgDetail(metricKey, m), provenance: m.provenance, effectiveNaics: m.effectiveNaics }
                    : null
            });
        };
        entries.push(sgEntry('employment', 'structural_growth_employment', 'Industry employment (county)'));
        entries.push(sgEntry('yoy', 'structural_growth_yoy', 'Employment YoY (annual-average)'));
        entries.push(sgEntry('establishments', 'structural_growth_establishments', 'Establishments (county)'));
    }

    // Curated packs (demand drivers, segments) — authored in PR-E. Emit ONLY when the pack actually
    // carries the content, so PR-C never claims a curated section that does not render.
    if (pack && Array.isArray(pack.demandDrivers) && pack.demandDrivers.length > 0) {
        entries.push({ id: 'demand_drivers', label: 'Demand drivers', state: STATE.CURATED,
            detail: `${pack.label || 'sub-industry'} pack`, provenance: `${pack.version || 'pack'} (curated)` });
    }
    if (pack && Array.isArray(pack.segments) && pack.segments.length > 0) {
        entries.push({ id: 'segments', label: 'Segments', state: STATE.CURATED,
            detail: `${pack.label || 'sub-industry'} pack`, provenance: `${pack.version || 'pack'} (curated)` });
    }

    // Review velocity — withheld by default (D3): only the top-5 leads are enriched and only 5 review
    // timestamps persist per business, so no depth guard makes a trend trustworthy yet.
    entries.push({ id: 'review_velocity', label: 'Review velocity trend', state: STATE.WITHHELD,
        reason: 'Insufficient review-timestamp depth at this radius. Widen the radius to include it.' });

    // Unit economics — locked, not withheld-for-lack-of-data: the report never estimates merchant
    // revenue (Gate 1 non-goal). Dollarized impact requires merchant-supplied inputs.
    entries.push({ id: 'unit_economics', label: 'Dollarized impact', state: STATE.MERCHANT,
        reason: 'Requires the merchant average ticket and close rate. Collected in the pre-call form, never estimated here.' });

    const withheldCount = entries.filter(e => e.state === STATE.WITHHELD).length;
    const computedCount = entries.filter(e => e.state === STATE.COMPUTED).length;

    return {
        entries,
        packVersion: (pack && pack.version) || null,
        computedCount,
        withheldCount
    };
}

module.exports = { STATE, WITHHOLD_CAUSE, gate, buildEvidenceLedger };
