'use strict';

/**
 * marketSegments.js — Workstream 5 (Aug-19 design review, screen 03 Q4): "Segments & What Each
 * Pays For".
 *
 * Split of authority, exactly as the review specified:
 *   - Segment DEFINITIONS are curated per-vertical knowledge (question pack) — labeled curated in
 *     the Evidence Ledger, never dressed up as local research.
 *   - Segment ASSIGNMENT is computed from THIS run's live signals (review volume vs the canonical
 *     market median, website presence, price tier, Places category) — labeled computed.
 *
 * Deterministic and pack-driven: no Gemini call, no invented segments. A pack without `segments`
 * yields null — the byte-identical path (a sub-industry without segment content produces a report
 * identical to one generated as if this feature did not exist), the same contract as
 * resolveQuestionPack itself.
 *
 * Assignment is ORDERED, FIRST MATCH WINS, and FAILS CLOSED: a business is assigned to the first
 * segment whose every stated predicate holds; a predicate whose underlying signal was never
 * measured does NOT match. Businesses matching no segment are counted as `unassigned` and reported
 * as such — the honest-denominator rule this codebase applies everywhere (see the recency pain
 * point's "of N businesses with measurable review dates").
 */

const { collectPopulation, canonicalReviewMedian, reviewCountOf, MIN_N, REPORT_SCHEMA_VERSION } =
    require('./evidencePainPoints');

function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function hasWebsiteOf(b) {
    return !!(b && (b.website || b.websiteUrl));
}

// Places category/type as a lowercase string, or '' when the run never resolved one.
function categoryOf(b) {
    return String((b && (b.category || b.type)) || '').toLowerCase();
}

// Price tier as a normalized string ('$', '$$', …) or null when unmeasured. Google returns either
// a symbol string or a 0-4 integer level; both are normalized to symbols so a pack can state one form.
function priceTierOf(b) {
    if (!b) return null;
    const raw = (b.priceLevel != null) ? b.priceLevel : b.price;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const n = Math.max(0, Math.min(4, Math.round(raw)));
        return n === 0 ? null : '$'.repeat(n);
    }
    const s = String(raw).trim();
    return /^\$+$/.test(s) ? s : null;
}

/**
 * Evaluate one segment's `when` clause against one business.
 * Every predicate is optional; an absent predicate is "don't care". A STATED predicate whose
 * signal is unmeasured returns false (fail closed) — a business is never assigned on absent evidence.
 *
 * Supported predicates:
 *   reviewsAtOrAbove / reviewsBelow : number, or the string 'median' (canonical market median)
 *   hasWebsite                      : true | false
 *   priceTierIn                     : ['$', '$$']
 *   categoryAny                     : ['boutique', 'gift']  (case-insensitive substring match)
 */
function matchesSegment(business, when, ctx) {
    const w = when || {};
    const resolveThreshold = (v) => (v === 'median' ? ctx.medianReviews : (Number.isFinite(Number(v)) ? Number(v) : null));

    if (w.reviewsAtOrAbove != null) {
        const t = resolveThreshold(w.reviewsAtOrAbove);
        if (t == null || reviewCountOf(business) < t) return false;
    }
    if (w.reviewsBelow != null) {
        const t = resolveThreshold(w.reviewsBelow);
        if (t == null || reviewCountOf(business) >= t) return false;
    }
    if (w.hasWebsite != null) {
        if (hasWebsiteOf(business) !== (w.hasWebsite === true)) return false;
    }
    if (Array.isArray(w.priceTierIn) && w.priceTierIn.length > 0) {
        const tier = priceTierOf(business);
        if (tier == null || w.priceTierIn.indexOf(tier) === -1) return false;   // unmeasured → no match
    }
    if (Array.isArray(w.categoryAny) && w.categoryAny.length > 0) {
        const cat = categoryOf(business);
        if (!cat) return false;                                                 // unmeasured → no match
        const hit = w.categoryAny.some(term => cat.indexOf(String(term).toLowerCase()) !== -1);
        if (!hit) return false;
    }
    return true;
}

/**
 * Build the Market Segments section.
 *
 * @param {object} reportData - full report object (read-only)
 * @param {object|null} pack  - resolved question pack (resolveQuestionPack); null is a valid input
 * @returns {object|null} section, or null when the pack carries no segments (byte-identical path)
 *   {
 *     schemaVersion, packVersion, n, assignedCount, unassignedCount,
 *     segments:    [{ id, label, paysFor, count }],   // definition order preserved
 *     assignments: { <normalizedName>: <segmentId> }  // for per-lead inheritance
 *   }
 */
function buildMarketSegments(reportData, pack) {
    const defs = (pack && Array.isArray(pack.segments)) ? pack.segments.filter(s => s && s.id && s.label) : [];
    if (defs.length === 0) return null;                       // no curated content → no section

    const d = (reportData && reportData.data) || {};
    const population = collectPopulation(reportData);
    // Same canonical population and median every other aggregate uses, so a market can never print
    // two different denominators or two different "market median" numbers.
    if (population.length < MIN_N) return null;

    const ctx = { medianReviews: canonicalReviewMedian(d.leads, d.competitors) };

    const counts = {};
    const assignments = {};
    defs.forEach(s => { counts[s.id] = 0; });
    let unassignedCount = 0;

    for (const b of population) {
        let assigned = null;
        for (const s of defs) {                                // ordered, first match wins
            if (matchesSegment(b, s.when, ctx)) { assigned = s.id; break; }
        }
        if (assigned) {
            counts[assigned] += 1;
            const key = normalizeName(b.name);
            if (key) assignments[key] = assigned;
        } else {
            unassignedCount += 1;
        }
    }

    const assignedCount = population.length - unassignedCount;
    if (assignedCount === 0) return null;                      // nothing to show; withhold the section

    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        packVersion: (pack && pack.version) || null,
        n: population.length,
        assignedCount,
        unassignedCount,
        segments: defs.map(s => ({
            id: s.id,
            label: s.label,
            paysFor: (typeof s.paysFor === 'string' && s.paysFor) ? s.paysFor : null,
            count: counts[s.id]
        })),
        assignments
    };
}

/**
 * Stamp each qualified lead with its segment so a lead card, its pitch wedge, and its roadmap phase
 * can differ by segment (screen 03 pin 10). Mutates leads in place; a lead that matched no segment
 * is left untouched (no null-segment noise on the card).
 */
function attachLeadSegments(leads, section) {
    if (!Array.isArray(leads) || !section || !section.assignments) return 0;
    const byId = {};
    (section.segments || []).forEach(s => { byId[s.id] = s; });
    let stamped = 0;
    for (const lead of leads) {
        if (!lead) continue;
        const id = section.assignments[normalizeName(lead.name)];
        if (!id || !byId[id]) continue;
        lead.segmentId = id;
        lead.segmentLabel = byId[id].label;
        if (byId[id].paysFor) lead.segmentPaysFor = byId[id].paysFor;
        stamped += 1;
    }
    return stamped;
}

module.exports = {
    buildMarketSegments,
    attachLeadSegments,
    // exported for unit tests (pure helpers)
    matchesSegment,
    priceTierOf,
    hasWebsiteOf,
    categoryOf
};
