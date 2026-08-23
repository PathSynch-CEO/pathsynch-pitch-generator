'use strict';

/**
 * customSubIndustries.js — hygiene for the user's "Custom" sub-industry list.
 *
 * THE BUG THIS FIXES (found 2026-08-23): after four Atlanta retail reports, the Sub-Industry
 * dropdown showed a "Custom" group with four identical "Home Goods & Decor" entries — a
 * STANDARD taxonomy sub-industry, quadruplicated. Two independent causes:
 *
 *   1. Every save was a duplicate by construction. Entries were written with
 *      `arrayUnion({ value, label, createdAt: new Date().toISOString() })`; arrayUnion dedups
 *      on exact object equality, and the fresh timestamp made every object unique, so every
 *      report generation appended another copy.
 *   2. The built-in check consulted only `naics.getSubcategories()`. The dropdown's Standard
 *      group comes from the TAXONOMY (config/industryTaxonomy.json) — "Home Goods & Decor" is
 *      a taxonomy label, not a NAICS subcategory name — so a standard sub-industry was
 *      classified as custom in the first place.
 *
 * This module is pure (no Firestore) so both failure modes are pinned by unit tests. The
 * handlers in api/market.js use it at every touchpoint:
 *   - writes go through isBuiltInSubIndustry() + appendCustomSub() (no arrayUnion), and always
 *     store the CLEANED list, so a polluted doc heals on its next write;
 *   - reads go through cleanCustomSubMap(), so already-polluted docs render clean immediately
 *     after deploy, with no migration.
 */

const { findSubIndustry } = require('../config/industryTaxonomy');
const naics = require('../config/naics');

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * A sub-industry is built-in when EITHER source of the dropdown's Standard group knows it:
 * the canonical taxonomy (what the UI actually lists, matched case-insensitively by
 * findSubIndustry) or the NAICS subcategory names (the legacy check, kept so nothing that was
 * previously classified built-in stops being so).
 */
function isBuiltInSubIndustry(industry, subIndustry) {
    if (!subIndustry) return false;
    if (findSubIndustry(industry, subIndustry)) return true;
    const subs = naics.getSubcategories(industry) || [];
    return subs.some(sub => norm(sub.name) === norm(subIndustry));
}

/**
 * Dedupe one industry's custom list case-insensitively by value (falling back to label),
 * keeping the FIRST occurrence (the earliest save), and drop entries that are actually
 * built-in for that industry. Malformed entries (no usable name) are dropped too.
 */
function cleanCustomSubList(list, industry) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of list) {
        const key = norm(entry && (entry.value || entry.label));
        if (!key || seen.has(key)) continue;
        if (isBuiltInSubIndustry(industry, entry.value || entry.label)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

/** Clean a whole { industry: [entries] } map (the shape stored on customSubIndustries/{uid}). */
function cleanCustomSubMap(map) {
    const out = {};
    for (const industry of Object.keys(map || {})) {
        const cleaned = cleanCustomSubList(map[industry], industry);
        if (cleaned.length > 0) out[industry] = cleaned;
    }
    return out;
}

/**
 * Compute the list to store after a save request: the cleaned existing list, plus the new
 * entry only when it is genuinely new AND genuinely custom.
 *
 * @returns {{ list: Array, changed: boolean }} changed=false means the stored doc already
 *          reflects this state (nothing to write).
 */
function appendCustomSub(existingList, industry, subIndustry, nowIso) {
    const cleaned = cleanCustomSubList(existingList, industry);
    if (!subIndustry || isBuiltInSubIndustry(industry, subIndustry)) {
        return { list: cleaned, changed: cleaned.length !== (Array.isArray(existingList) ? existingList.length : 0) };
    }
    if (cleaned.some(e => norm(e.value || e.label) === norm(subIndustry))) {
        return { list: cleaned, changed: cleaned.length !== existingList.length };
    }
    return {
        list: [...cleaned, { value: subIndustry, label: subIndustry, createdAt: nowIso }],
        changed: true
    };
}

module.exports = {
    isBuiltInSubIndustry,
    cleanCustomSubList,
    cleanCustomSubMap,
    appendCustomSub
};
