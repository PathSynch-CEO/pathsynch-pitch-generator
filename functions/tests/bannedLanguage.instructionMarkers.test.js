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

    // ── Same bar as stripHedgingSentences: WHOLE line/sentence removal, never a partial fragment ──
    describe('whole-unit removal (no mid-sentence partial strip)', () => {
        // Build the set of every whitespace-delimited word that appears ONLY inside a marker phrase,
        // to assert no shard of an instruction phrase survives anywhere in the output.
        const MARKER_SHARDS = ['precision', 'filter', 'prioritize', "user's", 'silently', 'sub-type'];
        function assertNoMarkerShardSurvives(value) {
            const lower = String(value).toLowerCase();
            MARKER_SHARDS.forEach(shard => expect(lower).not.toContain(shard));
            // And of course no full marker phrase.
            expect(findInstructionMarkers(value)).toEqual([]);
        }

        test('a marker inline among sibling sentences on ONE line: the marker SENTENCE is removed whole, siblings kept', () => {
            const input = 'Alpha dominates the field. PRECISION FILTER: The user is targeting X. Beta trails behind.';
            const { value, stripped } = stripInstructionMarkerLines(input);
            expect(stripped).toBe(true);
            // Legit sibling sentences on the same line survive INTACT — not truncated fragments.
            expect(value).toContain('Alpha dominates the field.');
            expect(value).toContain('Beta trails behind.');
            // The entire marker-bearing sentence is gone — no partial "PRECISION"/"The user" shard.
            assertNoMarkerShardSurvives(value);
            // No fragment of the dropped sentence (e.g. "targeting X") stitched onto a neighbor.
            expect(value).not.toContain('targeting X');
        });

        test('newline-wrapped injection: a legit sentence SPLIT across the block rejoins intact', () => {
            const { value } = stripInstructionMarkerLines(PRODUCTION_LEAK);
            // "1-800-GOT-JUNK? Atlanta Westside dominates Atlanta Home Services" + " with 26793 reviews."
            // were split by the injected lines; after removal they read as one clean sentence.
            expect(value).toContain('dominates Atlanta Home Services with 26793 reviews');
            assertNoMarkerShardSurvives(value);
        });

        test('output never contains a partial marker phrase — full findInstructionMarkers sweep is empty', () => {
            const inputs = [
                PRODUCTION_LEAK,
                'Lead line. Prioritize businesses matching this sub-type. Trailing line.',
                "One. User's approach preference: buyer rep. Three.",
                'apply silently now. Real sentence.'
            ];
            inputs.forEach(inp => {
                const { value } = stripInstructionMarkerLines(inp);
                expect(findInstructionMarkers(value)).toEqual([]);
            });
        });

        test('a line that is ONLY a marker (no terminator) is removed whole, not left as a fragment', () => {
            const input = 'Real opening line.\nPrioritize businesses matching this sub-type\nReal closing line.';
            const { value } = stripInstructionMarkerLines(input);
            expect(value).toBe('Real opening line. Real closing line.');
        });
    });
});
