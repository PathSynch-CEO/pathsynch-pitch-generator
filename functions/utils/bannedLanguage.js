'use strict';

/**
 * bannedLanguage.js — hedging-phrase guard for generated market-report copy (Story S3 seed).
 *
 * The evidence gate forbids speculative prose: a claim either derives from resolved data or it
 * is withheld. Hedging phrases ("it is highly probable that...") are the exact language the old
 * free-form report used to smuggle unsourced conclusions past the reader. This is the shared
 * banned-language list plus helpers to detect and strip it, used by the report sanitizer at
 * runtime and asserted in tests.
 *
 * Extend HEDGING_PHRASES as new hedges are found. Keep every entry lowercase.
 */

const HEDGING_PHRASES = [
    'highly probable',
    'reasonable to infer',
    'likely that',
    "it's probable",
    'it is probable'
];

// Return the banned phrases present in `text` (lowercased, deduped, order-stable).
function findHedgingViolations(text) {
    if (typeof text !== 'string' || !text) return [];
    const lower = text.toLowerCase();
    const hits = [];
    for (const phrase of HEDGING_PHRASES) {
        if (lower.indexOf(phrase) !== -1 && hits.indexOf(phrase) === -1) hits.push(phrase);
    }
    return hits;
}

// Remove whole sentences that contain a hedging phrase. Fail-closed: dropping the sentence is
// safer than surgically editing a hedge into a false assertion. Returns { value, stripped }.
function stripHedgingSentences(text) {
    if (typeof text !== 'string' || !text || findHedgingViolations(text).length === 0) {
        return { value: text, stripped: false };
    }
    // Split on sentence boundaries, keeping the delimiter with each sentence.
    const parts = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
    let stripped = false;
    const kept = parts.filter(seg => {
        if (findHedgingViolations(seg).length > 0) { stripped = true; return false; }
        return true;
    });
    const value = kept.join('').replace(/\s{2,}/g, ' ').trim();
    return { value, stripped };
}

module.exports = { HEDGING_PHRASES, findHedgingViolations, stripHedgingSentences };
