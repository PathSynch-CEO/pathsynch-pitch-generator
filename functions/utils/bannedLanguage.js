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

/**
 * Instruction / prompt-context markers that must NEVER reach customer-facing report copy.
 *
 * These are fragments of INTERNAL steering text — precision-targeting context and prompt
 * scaffolding — that leaked into the zero-lead executive summary when a steering string was
 * fused into the industry label and then interpolated verbatim (2026-08-20 Atlanta Junk Removal
 * report: "...dominates Atlanta Home Services PRECISION FILTER: The user is specifically targeting
 * \"Residential Cleanouts\" businesses ... Prioritize businesses matching this sub-type...").
 *
 * The root cause is fixed upstream (the label is no longer fused with steering text). This list
 * plus the stripper below are DEFENSE IN DEPTH: if any generator or future caller ever echoes the
 * steering text again, it must not reach a reader. Keep every entry lowercase. Extend as new
 * leak shapes are found.
 */
const INSTRUCTION_MARKERS = [
    'precision filter',
    'the user is',                    // "The user is specifically targeting ..."
    'prioritize businesses',
    "user's approach preference",
    'industry-specific instructions',
    'apply silently',
    'do not include these sections'
];

// Return the instruction markers present in `text` (lowercased, deduped, order-stable).
function findInstructionMarkers(text) {
    if (typeof text !== 'string' || !text) return [];
    const lower = text.toLowerCase();
    const hits = [];
    for (const marker of INSTRUCTION_MARKERS) {
        if (lower.indexOf(marker) !== -1 && hits.indexOf(marker) === -1) hits.push(marker);
    }
    return hits;
}

// Remove every WHOLE line-or-sentence carrying an instruction marker, preserving surrounding
// legitimate text. This holds the SAME bar as stripHedgingSentences: removal is at line/sentence
// granularity — a marker-bearing unit is dropped in full and never surgically edited, so no partial
// fragment of the injected steering (e.g. a dangling "The user" or "PRECISION") can survive.
//
// Two granularities, applied per line so BOTH real leak shapes are handled without over-stripping:
//   • The production leak is newline-wrapped (the fused precision block sits on its own lines), so a
//     legit sentence SPLIT across the injection rejoins intact once the marker lines are removed.
//   • A marker sitting inline among sibling sentences on ONE line is removed at sentence granularity,
//     so the legit siblings on that line are preserved.
// Since no marker phrase contains a sentence terminator (.!?), the sentence pass can never leave a
// marker behind: any segment carrying one is dropped whole. Whitespace is collapsed in the result.
// Fail-closed. Returns { value, stripped }.
function stripInstructionMarkerLines(text) {
    if (typeof text !== 'string' || !text || findInstructionMarkers(text).length === 0) {
        return { value: text, stripped: false };
    }
    let stripped = false;
    const cleanedLines = text.split(/\r?\n/).map(line => {
        if (findInstructionMarkers(line).length === 0) return line;
        stripped = true;
        // Drop whole sentences within this line that carry a marker; keep the legit siblings.
        const segments = line.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [line];
        return segments.filter(seg => findInstructionMarkers(seg).length === 0).join('');
    });
    const value = cleanedLines.join(' ').replace(/\s{2,}/g, ' ').trim();
    return { value, stripped };
}

module.exports = {
    HEDGING_PHRASES,
    findHedgingViolations,
    stripHedgingSentences,
    INSTRUCTION_MARKERS,
    findInstructionMarkers,
    stripInstructionMarkerLines
};
