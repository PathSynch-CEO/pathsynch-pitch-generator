'use strict';

/**
 * questionPacks.js — Story S3 question-pack resolver.
 *
 * A question pack is a per-sub-industry bundle of report-generation inputs (pain thresholds today;
 * demand drivers and segment definitions in PR-E). Packs are BACKEND-ONLY code JSON in
 * config/questionPacks.json — never synced to the frontend, never shipped to the browser. Only the
 * taxonomy `id`s are the shared contract, so packs sit outside sync-taxonomy.cjs entirely.
 *
 * resolveQuestionPack mirrors resolveReviewCeilings(subIndustryConfig, verticalConfig, scoringProfile)
 * in verticalConfigs.js field-for-field: a sub-industry -> industry -> none cascade using `||` (not
 * `??`) so an empty/absent pack falls through to the next source, and an unknown id resolves to null.
 * Deterministic, unit-testable, zero runtime reads.
 *
 * A null result is a first-class outcome: it is the byte-identical path. Every sub-industry without a
 * pack must produce a report identical to one generated as if this feature did not exist, so callers
 * treat null as "use platform defaults, render no curated section."
 */

const PACKS = require('../config/questionPacks.json');

/**
 * Resolve the question pack for a (subIndustryId, industryId) pair.
 *
 * @param {string|null} subIndustryId - taxonomy sub-industry id (e.g. "general_merchandise"); may be null for custom subs
 * @param {string|null} industryId    - taxonomy industry id (e.g. "retail"); the fallback tier
 * @returns {object|null} the resolved pack, or null when neither tier has one (the byte-identical path)
 */
function resolveQuestionPack(subIndustryId, industryId) {
    const subs = (PACKS && PACKS.subIndustries) || {};
    const inds = (PACKS && PACKS.industries) || {};
    return (subIndustryId && subs[subIndustryId])
        || (industryId && inds[industryId])
        || null;
}

/**
 * Resolve the pain-threshold knobs for a pack, falling back to platform defaults for any knob the
 * pack does not set. Kept here (not in the pack file) so a pack can override one threshold without
 * having to re-declare the whole set, and so a null pack yields exactly the defaults.
 *
 * @param {object|null} pack - resolved question pack, or null
 * @param {object} defaults  - DEFAULT_PAIN_THRESHOLDS from the consumer (competitiveWeaknesses.js)
 * @returns {object} the effective thresholds
 */
function resolvePainThresholds(pack, defaults) {
    const base = defaults || {};
    const overrides = (pack && pack.painThresholds) || {};
    const out = {};
    for (const key of Object.keys(base)) {
        // `!= null` so a pack value of 0 is honored; only absent/undefined falls through to default.
        out[key] = overrides[key] != null ? overrides[key] : base[key];
    }
    return out;
}

module.exports = { resolveQuestionPack, resolvePainThresholds, PACKS };
