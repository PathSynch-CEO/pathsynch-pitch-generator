'use strict';

/**
 * leadExclusions.js — enforce the Market Definition's excludedBusinessTypes against LEADS.
 *
 * THE BUG THIS FIXES (2026-08-23 Atlanta retail reports): the Market Definition card promised
 * "Excluded: chain retailer, big box store, online only, wholesale supplier" — but nothing in
 * the pipeline enforced that list. It was display-only. So HomeGoods (a national chain) appeared
 * as qualified lead #1 with 0 reviews, and Floor & Decor — the report's own named market leader —
 * appeared as qualified lead #3. Chains then flowed into wedges, High-Impact Moves, and the
 * verdict's lead count itself.
 *
 * FAIL CLOSED, in this module's direction: a lead is excluded ONLY on positive identification.
 * No guessing from name shape, no "looks like a chain". Three evidence sources, all deterministic:
 *
 *   1. category_match  — the lead's own category/type matches an excluded business type term.
 *   2. curated_chain   — the question pack (curated, per-vertical) names it a known chain.
 *   3. multi_location  — THIS run's discovery observed the same business name at 2+ distinct
 *                        locations inside the search radius: a multi-location operator, which is
 *                        what "chain" means operationally.
 *
 * Sources 2 and 3 are GATED on the definition actually excluding a chain-like type ("chain",
 * "big box", "franchise", "national"): enforcement exists to honor the definition's promise, so
 * a vertical whose definition does not exclude chains keeps chain leads (e.g. junk-removal
 * franchisees are legitimate prospects). Source 1 is always active when an exclusion list exists.
 *
 * The excluded set is RECORDED (name + reason + evidence) and persisted on leadQualification, so
 * the report shows its work instead of silently shrinking the lead list. Competitors are NOT
 * touched here: chains are legitimate market context — the leak was into the sales-prospect list.
 */

// Mirrors normalizeBusinessName in api/market.js (himProvenanceGate does the same). Not imported
// from there because api/market.js requires this module — keep the dependency one-directional.
function normalizeName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

const CHAIN_TYPE_TERMS = ['chain', 'big box', 'franchise', 'national'];

/** Does the definition's exclusion list name a chain-like type at all? */
function definitionExcludesChains(excludedTypes) {
    return (excludedTypes || []).some(t =>
        CHAIN_TYPE_TERMS.some(term => String(t).toLowerCase().includes(term)));
}

/**
 * Build multi-location evidence from THIS run's raw discovery records (pre-dedup competitors +
 * lead candidates). Two records under one normalized name count as distinct locations only when
 * their location signatures differ — address when present, else the record's own numbers — so
 * multi-query repeats of ONE location (identical records) never masquerade as a second location.
 *
 * @returns {Map<string, number>} normalized name → count of distinct observed locations
 */
function buildChainEvidence(rawRecords) {
    const locations = new Map();
    for (const r of rawRecords || []) {
        const key = normalizeName(r && r.name);
        if (!key) continue;
        const sig = (r.address && String(r.address).toLowerCase().trim())
            || `metrics:${parseInt(r.reviewCount) || parseInt(r.reviews) || 0}:${r.rating != null ? r.rating : ''}`;
        if (!locations.has(key)) locations.set(key, new Set());
        locations.get(key).add(sig);
    }
    const counts = new Map();
    for (const [key, sigs] of locations) counts.set(key, sigs.size);
    return counts;
}

/**
 * Classify one lead against the definition's exclusions. Returns null (keep) unless positively
 * identified; otherwise { reason, evidence }.
 *
 * @param {object} lead
 * @param {object} ctx
 *   - excludedTypes {string[]}      the Market Definition's excludedBusinessTypes
 *   - chainEvidence {Map}           from buildChainEvidence()
 *   - knownChains {string[]}        pack-curated chain names (may be empty)
 */
function classifyLeadExclusion(lead, ctx) {
    const excludedTypes = (ctx && ctx.excludedTypes) || [];
    if (excludedTypes.length === 0) return null;              // definition promises no exclusions

    // 1 ── The lead's own labeled category matches an excluded type.
    const cat = String((lead && (lead.category || lead.type)) || '').toLowerCase();
    if (cat) {
        const hit = excludedTypes.find(t => cat.includes(String(t).toLowerCase()));
        if (hit) return { reason: 'category_match', evidence: `category "${cat}" matches excluded type "${hit}"` };
    }

    if (!definitionExcludesChains(excludedTypes)) return null; // chain sources gated off

    const key = normalizeName(lead && lead.name);
    if (!key) return null;

    // 2 ── Curated: the question pack names this business a known chain.
    const chains = (ctx && ctx.knownChains) || [];
    const curated = chains.find(c => normalizeName(c) === key);
    if (curated) return { reason: 'curated_chain', evidence: `pack-curated known chain "${curated}"` };

    // 3 ── Observed: discovery saw this name at 2+ distinct locations in the radius.
    const locationCount = (ctx && ctx.chainEvidence && ctx.chainEvidence.get(key)) || 0;
    if (locationCount >= 2) {
        return { reason: 'multi_location', evidence: `${locationCount} distinct locations observed in this search radius` };
    }

    return null;
}

/**
 * Apply the definition's exclusions to a lead list.
 * @returns {{ kept: Array, excluded: Array<{name, reason, evidence}> }}
 */
function applyLeadExclusions(leads, ctx) {
    const kept = [];
    const excluded = [];
    for (const lead of leads || []) {
        const verdict = classifyLeadExclusion(lead, ctx);
        if (verdict) excluded.push({ name: lead.name || '', reason: verdict.reason, evidence: verdict.evidence });
        else kept.push(lead);
    }
    return { kept, excluded };
}

module.exports = {
    buildChainEvidence,
    classifyLeadExclusion,
    applyLeadExclusions,
    definitionExcludesChains,
    CHAIN_TYPE_TERMS
};
