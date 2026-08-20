'use strict';

/**
 * fix/market-intel-precision-leak-and-discovery-zeroing
 *
 * Unit coverage for the instruction-marker primitives added to bannedLanguage.js. These are the
 * defense-in-depth net for the precision-context leak observed on the live 2026-08-20 Atlanta
 * "Junk Removal & Hauling" Market Intel report, where internal steering text was interpolated
 * verbatim into the zero-lead executive summary:
 *
 *   "...dominates Atlanta Home Services
 *    PRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses
 *    within the Home Services vertical. Prioritize businesses matching this sub-type.
 *    User's approach preference: All Atlanta Metro Area.
 *     with 26793 reviews. No qualified leads were identified in this market..."
 */

const {
    INSTRUCTION_MARKERS,
    findInstructionMarkers,
    stripInstructionMarkerLines
} = require('../utils/bannedLanguage');

// Faithful reproduction of the production leak string (newline-delimited, as it reached the reader).
const PRODUCTION_LEAK =
    '1-800-GOT-JUNK? Atlanta Westside dominates Atlanta Home Services\n' +
    'PRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses ' +
    'within the Home Services vertical. Prioritize businesses matching this sub-type.\n' +
    '\n' +
    "User's approach preference: All Atlanta Metro Area.\n" +
    ' with 26793 reviews. No qualified leads were identified in this market.';

const MARKER_PHRASES = [
    'PRECISION FILTER',
    'The user is',
    'Prioritize businesses',
    "User's approach preference"
];

describe('bannedLanguage — instruction markers', () => {
    test('every declared marker is lowercase (case-insensitive matching invariant)', () => {
        INSTRUCTION_MARKERS.forEach(m => expect(m).toBe(m.toLowerCase()));
    });

    test('findInstructionMarkers detects the production leak markers (deduped, order-stable)', () => {
        const hits = findInstructionMarkers(PRODUCTION_LEAK);
        expect(hits).toContain('precision filter');
        expect(hits).toContain('the user is');
        expect(hits).toContain('prioritize businesses');
        expect(hits).toContain("user's approach preference");
        // Deduped
        expect(new Set(hits).size).toBe(hits.length);
    });

    test('findInstructionMarkers returns [] for clean copy and non-strings', () => {
        expect(findInstructionMarkers('Riverwood Dental leads the Atlanta market with 1538 reviews.')).toEqual([]);
        expect(findInstructionMarkers('')).toEqual([]);
        expect(findInstructionMarkers(null)).toEqual([]);
        expect(findInstructionMarkers(undefined)).toEqual([]);
        expect(findInstructionMarkers(42)).toEqual([]);
    });

    test('stripInstructionMarkerLines excises the injected lines and keeps real narrative', () => {
        const { value, stripped } = stripInstructionMarkerLines(PRODUCTION_LEAK);
        expect(stripped).toBe(true);
        // No marker phrase survives.
        MARKER_PHRASES.forEach(p => expect(value).not.toContain(p));
        // The legitimate narrative on adjacent lines is preserved.
        expect(value).toContain('1-800-GOT-JUNK? Atlanta Westside dominates Atlanta Home Services');
        expect(value).toContain('26793 reviews');
        expect(value).toContain('No qualified leads were identified in this market');
        // Whitespace/newlines collapsed to single spaces — no double spaces, no stray newlines.
        expect(value).not.toMatch(/\s{2,}/);
        expect(value).not.toContain('\n');
    });

    test('stripInstructionMarkerLines is a no-op on clean copy (stripped=false, value unchanged)', () => {
        const clean = 'Riverwood Dental leads the Atlanta market with 1538 reviews. 6 qualified leads identified.';
        const res = stripInstructionMarkerLines(clean);
        expect(res.stripped).toBe(false);
        expect(res.value).toBe(clean);
    });

    test('stripInstructionMarkerLines tolerates non-string input', () => {
        expect(stripInstructionMarkerLines(null)).toEqual({ value: null, stripped: false });
        expect(stripInstructionMarkerLines(undefined)).toEqual({ value: undefined, stripped: false });
    });
});
