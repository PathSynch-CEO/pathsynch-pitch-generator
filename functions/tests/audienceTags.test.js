'use strict';

/**
 * Workstream 5b — audience tags (Aug-19 design review, screen 02 pin 5): "One report, two clean
 * views." Sections are tagged at generation time so every downstream surface filters from one
 * manifest.
 *
 * The safety property under test is FAIL CLOSED: an unclassified section is hidden from a merchant,
 * never shown. Showing a prospect the prospect list, or the wedge describing how to sell them, is
 * the failure this module exists to prevent.
 */

const fs = require('fs');
const path = require('path');
const {
    AUDIENCE, SECTION_AUDIENCE, NON_SECTION_KEYS, isVisibleTo, buildAudienceManifest
} = require('../services/audienceTags');

describe('fail-closed visibility', () => {
    test('an UNKNOWN section is hidden from a merchant and shown to internal', () => {
        expect(isVisibleTo('a_section_nobody_classified', 'merchant')).toBe(false);
        expect(isVisibleTo('a_section_nobody_classified', 'internal')).toBe(true);
        expect(isVisibleTo(undefined, 'merchant')).toBe(false);
    });

    test('the manifest default is internal, so any unlisted section errs toward invisible', () => {
        expect(buildAudienceManifest().defaultAudience).toBe(AUDIENCE.INTERNAL);
    });

    test('the internal view withholds nothing', () => {
        for (const id of Object.keys(SECTION_AUDIENCE)) {
            expect(isVisibleTo(id, 'internal')).toBe(true);
        }
    });
});

describe('the review\'s classification, verbatim', () => {
    test('merchant-facing HIDES sales intelligence, entry wedges and high-impact moves', () => {
        for (const id of ['salesIntel', 'highImpactMoves']) {
            expect(SECTION_AUDIENCE[id]).toBe(AUDIENCE.INTERNAL);
            expect(isVisibleTo(id, 'merchant')).toBe(false);
        }
    });

    test('the prospect list and what-to-sell-them are internal by definition', () => {
        for (const id of ['leads', 'leadCount', 'leadQualification', 'productRecommendations', 'enterpriseTargetAccounts']) {
            expect(isVisibleTo(id, 'merchant')).toBe(false);
        }
    });

    test('the four research sections of screen 03 ARE merchant-facing', () => {
        // Screen 03's frame is titled "Merchant-facing view" and contains Q1-Q4.
        for (const id of ['structuralGrowth', 'evidencePainPoints', 'marketSegments', 'demographicsEnriched']) {
            expect(isVisibleTo(id, 'merchant')).toBe(true);
        }
    });

    test('the deliberate split: computed pain points are shared, the sales wrapper is not', () => {
        // Same underlying claims; salesIntel adds the entry wedge and best-time-to-call playbook.
        expect(isVisibleTo('evidencePainPoints', 'merchant')).toBe(true);
        expect(isVisibleTo('salesIntel', 'merchant')).toBe(false);
    });

    test('the evidence ledger is merchant-facing (the report showing its own work is the point)', () => {
        expect(isVisibleTo('evidenceLedger', 'merchant')).toBe(true);
    });
});

describe('manifest shape', () => {
    const report = {
        executiveSummary: 'x', structuralGrowth: { status: 'ok' },
        data: { leads: [{ name: 'A' }], salesIntel: { topPainPoints: [] }, marketSegments: { n: 5 } }
    };

    test('lists only sections actually PRESENT, so a surface never confuses hidden with absent', () => {
        const m = buildAudienceManifest(report);
        expect(Object.keys(m.sections).sort())
            .toEqual(['executiveSummary', 'leads', 'marketSegments', 'salesIntel', 'structuralGrowth']);
        expect(m.sections.highImpactMoves).toBeUndefined();   // not built for this report
    });

    test('internalOnly is the sorted internal subset of what is present', () => {
        expect(buildAudienceManifest(report).internalOnly).toEqual(['leads', 'salesIntel']);
    });

    test('with no report, every registered section is listed (the full contract)', () => {
        const m = buildAudienceManifest();
        expect(Object.keys(m.sections).length).toBe(Object.keys(SECTION_AUDIENCE).length);
    });

    test('every registered value is a valid audience', () => {
        const valid = [AUDIENCE.BOTH, AUDIENCE.INTERNAL];
        for (const [id, a] of Object.entries(SECTION_AUDIENCE)) {
            expect(valid).toContain(a);
            expect(typeof id).toBe('string');
        }
    });
});

describe('registry completeness guard — an unclassified section FAILS THE BUILD', () => {
    // Fail-closed hiding alone would let a new section go unnoticed forever. This reads the real
    // assignments out of api/market.js so adding a section without classifying it is a loud error.
    const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'market.js'), 'utf8');
    const collect = (re) => {
        const out = new Set();
        let m;
        while ((m = re.exec(src)) !== null) out.add(m[1]);
        return out;
    };
    const dataKeys = collect(/reportData\.data\.([a-zA-Z0-9_]+)\s*=/g);
    const topKeys = collect(/reportData\.([a-zA-Z0-9_]+)\s*=/g);

    test('every reportData.data.* section is classified or explicitly non-section', () => {
        const unclassified = [...dataKeys].filter(
            k => SECTION_AUDIENCE[k] === undefined && NON_SECTION_KEYS.indexOf(k) === -1);
        expect(unclassified).toEqual([]);
    });

    test('every top-level reportData.* section is classified or explicitly non-section', () => {
        const unclassified = [...topKeys].filter(
            k => k !== 'data' && SECTION_AUDIENCE[k] === undefined && NON_SECTION_KEYS.indexOf(k) === -1);
        expect(unclassified).toEqual([]);
    });

    test('the registry has no entry for a section the report never emits (no dead rows)', () => {
        const emitted = new Set([...dataKeys, ...topKeys]);
        const dead = Object.keys(SECTION_AUDIENCE).filter(k => !emitted.has(k));
        expect(dead).toEqual([]);
    });
});
