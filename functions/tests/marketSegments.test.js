'use strict';

/**
 * Workstream 5 — Market Segments (Aug-19 design review, screen 03 Q4).
 *
 * Contract under test:
 *  - DEFINITIONS are curated (question pack); ASSIGNMENT is computed from this run's live signals.
 *  - A pack without `segments` yields null: the byte-identical path.
 *  - Assignment is ordered, first-match-wins, and FAILS CLOSED — a stated predicate whose signal
 *    was never measured does not match, so no business is assigned on absent evidence.
 *  - Unassigned businesses are counted and reported (honest denominator), never silently dropped.
 *  - The population and median are the canonical shared ones, so a market cannot print two
 *    different denominators.
 */

const {
    buildMarketSegments, attachLeadSegments, matchesSegment, priceTierOf, categoryOf, hasWebsiteOf
} = require('../services/marketSegments');
const { resolveQuestionPack } = require('../services/questionPacks');
const { canonicalReviewMedian } = require('../services/evidencePainPoints');

const RETAIL_PACK = resolveQuestionPack(null, 'retail');

const biz = (name, over) => Object.assign({ name, reviewCount: 50 }, over || {});
const report = (leads, competitors) => ({ data: { leads: leads || [], competitors: competitors || [] } });

describe('pack wiring', () => {
    test('the retail pack carries the three reviewed segment definitions, in order', () => {
        expect(RETAIL_PACK).toBeTruthy();
        expect(RETAIL_PACK.segments.map(s => s.id))
            .toEqual(['destination_boutique', 'niche_specialist', 'neighborhood_staple']);
        expect(RETAIL_PACK.segments.every(s => typeof s.paysFor === 'string' && s.paysFor.length > 0)).toBe(true);
    });

    test('a pack WITHOUT segments yields null — the byte-identical path', () => {
        const junk = resolveQuestionPack('junk_removal', 'home_services');
        expect(junk).toBeTruthy();
        expect(junk.segments).toBeUndefined();
        expect(buildMarketSegments(report([biz('A'), biz('B'), biz('C')]), junk)).toBeNull();
        expect(buildMarketSegments(report([biz('A'), biz('B'), biz('C')]), null)).toBeNull();
        expect(buildMarketSegments(report([biz('A')]), { segments: [] })).toBeNull();
    });
});

describe('assignment over live signals', () => {
    // median of [10, 50, 50, 200, 400] = 50 (lower-middle, canonical formula)
    const population = [
        biz('Alpha Boutique', { reviewCount: 400, website: 'https://a.example' }),  // >= median + site → destination
        biz('Bravo Shop', { reviewCount: 200, website: 'https://b.example' }),      // >= median + site → destination
        biz('Charlie Niche', { reviewCount: 10, website: 'https://c.example' }),    // < median + site  → niche
        biz('Delta Corner', { reviewCount: 50 }),                                   // no site          → staple
        biz('Echo Corner', { reviewCount: 50 })                                     // no site          → staple
    ];
    const r = report(population.slice(0, 2), population.slice(2));

    test('counts and total reconcile with the canonical population and median', () => {
        const sec = buildMarketSegments(r, RETAIL_PACK);
        expect(canonicalReviewMedian(r.data.leads, r.data.competitors)).toBe(50);
        expect(sec.n).toBe(5);
        expect(sec.assignedCount + sec.unassignedCount).toBe(sec.n);
        const byId = Object.fromEntries(sec.segments.map(s => [s.id, s.count]));
        expect(byId).toEqual({ destination_boutique: 2, niche_specialist: 1, neighborhood_staple: 2 });
        expect(sec.packVersion).toBe(RETAIL_PACK.version);
    });

    test('definition order is preserved in the output (render order is the pack author\'s)', () => {
        const sec = buildMarketSegments(r, RETAIL_PACK);
        expect(sec.segments.map(s => s.id))
            .toEqual(['destination_boutique', 'niche_specialist', 'neighborhood_staple']);
    });

    test('ordered first-match-wins: an earlier segment claims a business both could match', () => {
        const defs = { version: 'x', segments: [
            { id: 'first', label: 'First', when: { hasWebsite: true } },
            { id: 'second', label: 'Second', when: { hasWebsite: true } }
        ] };
        const sec = buildMarketSegments(
            report([biz('A', { website: 'x' }), biz('B', { website: 'x' }), biz('C', { website: 'x' })]), defs);
        expect(sec.segments.find(s => s.id === 'first').count).toBe(3);
        expect(sec.segments.find(s => s.id === 'second').count).toBe(0);
    });
});

describe('fails closed on unmeasured signals', () => {
    const ctx = { medianReviews: 50 };

    test('a stated price-tier predicate does NOT match a business with no price data', () => {
        expect(matchesSegment(biz('A'), { priceTierIn: ['$', '$$'] }, ctx)).toBe(false);
        expect(matchesSegment(biz('A', { priceLevel: '$$' }), { priceTierIn: ['$', '$$'] }, ctx)).toBe(true);
        expect(matchesSegment(biz('A', { priceLevel: 3 }), { priceTierIn: ['$$$'] }, ctx)).toBe(true); // 0-4 int form
    });

    test('a stated category predicate does NOT match a business with no category', () => {
        expect(matchesSegment(biz('A'), { categoryAny: ['gift'] }, ctx)).toBe(false);
        expect(matchesSegment(biz('A', { category: 'Gift Shop' }), { categoryAny: ['gift'] }, ctx)).toBe(true);
        expect(matchesSegment(biz('A', { type: 'hardware_store' }), { categoryAny: ['hardware'] }, ctx)).toBe(true);
    });

    test('an absent predicate is "don\'t care"; an empty when matches everything', () => {
        expect(matchesSegment(biz('A'), {}, ctx)).toBe(true);
        expect(matchesSegment(biz('A'), undefined, ctx)).toBe(true);
    });

    test('unmatched businesses become unassigned, never force-fit into a segment', () => {
        const defs = { version: 'x', segments: [{ id: 'only', label: 'Only', when: { categoryAny: ['gift'] } }] };
        const sec = buildMarketSegments(
            report([biz('A', { category: 'Gift Shop' }), biz('B'), biz('C'), biz('D')]), defs);
        expect(sec.assignedCount).toBe(1);
        expect(sec.unassignedCount).toBe(3);
        expect(sec.segments[0].count).toBe(1);
    });

    test('zero assignments → null (no empty section), and below MIN_N → null', () => {
        const defs = { version: 'x', segments: [{ id: 'only', label: 'Only', when: { categoryAny: ['nope'] } }] };
        expect(buildMarketSegments(report([biz('A'), biz('B'), biz('C')]), defs)).toBeNull();
        expect(buildMarketSegments(report([biz('A'), biz('B')]), RETAIL_PACK)).toBeNull();  // n=2 < MIN_N
    });
});

describe('helpers', () => {
    test('priceTierOf normalizes both the symbol and 0-4 integer forms; unmeasured → null', () => {
        expect(priceTierOf({ priceLevel: '$$' })).toBe('$$');
        expect(priceTierOf({ priceLevel: 2 })).toBe('$$');
        expect(priceTierOf({ priceLevel: 0 })).toBe(null);      // Google's "free"/unknown
        expect(priceTierOf({ priceLevel: 9 })).toBe('$$$$');    // clamped
        expect(priceTierOf({})).toBe(null);
        expect(priceTierOf({ priceLevel: 'cheap' })).toBe(null);
        expect(priceTierOf(null)).toBe(null);
    });

    test('hasWebsiteOf / categoryOf read the same fields the rest of the report uses', () => {
        expect(hasWebsiteOf({ website: 'https://x' })).toBe(true);
        expect(hasWebsiteOf({ websiteUrl: 'https://x' })).toBe(true);
        expect(hasWebsiteOf({})).toBe(false);
        expect(categoryOf({ category: 'Gift Shop' })).toBe('gift shop');
        expect(categoryOf({})).toBe('');
    });
});

describe('per-lead inheritance (screen 03 pin 10)', () => {
    test('stamps segmentId/Label/PaysFor on matching leads only', () => {
        const leads = [biz('Alpha Boutique', { reviewCount: 400, website: 'https://a' }), biz('Ghost Co')];
        const r = report(leads, [biz('C', { reviewCount: 10, website: 'https://c' }), biz('D')]);
        const sec = buildMarketSegments(r, RETAIL_PACK);
        const stamped = attachLeadSegments(leads, sec);
        expect(stamped).toBe(2);                                 // Ghost Co has no website → staple
        expect(leads[0].segmentId).toBe('destination_boutique');
        expect(leads[0].segmentLabel).toBe('Destination Boutique');
        expect(leads[0].segmentPaysFor).toContain('Discovery');
        expect(leads[1].segmentId).toBe('neighborhood_staple');
    });

    test('a lead matching no segment is left untouched (no null-segment noise)', () => {
        const defs = { version: 'x', segments: [{ id: 'only', label: 'Only', when: { categoryAny: ['gift'] } }] };
        const leads = [biz('Gifty', { category: 'Gift Shop' }), biz('Plain')];
        const sec = buildMarketSegments(report(leads, [biz('X'), biz('Y')]), defs);
        attachLeadSegments(leads, sec);
        expect(leads[0].segmentId).toBe('only');
        expect(leads[1].segmentId).toBeUndefined();
        expect('segmentLabel' in leads[1]).toBe(false);
    });

    test('null section / non-array leads are no-ops (never throws)', () => {
        expect(attachLeadSegments(null, null)).toBe(0);
        expect(attachLeadSegments([biz('A')], null)).toBe(0);
        expect(attachLeadSegments(undefined, { assignments: {}, segments: [] })).toBe(0);
    });
});

describe('evidence ledger integration', () => {
    test('a pack with segments emits the CURATED segments entry', () => {
        const { buildEvidenceLedger } = require('../services/evidenceLedger');
        const led = buildEvidenceLedger(report([biz('A')], [biz('B')]), { pack: RETAIL_PACK });
        const entry = led.entries.find(e => e.id === 'segments');
        expect(entry).toBeTruthy();
        expect(entry.state).toBe('curated');
    });

    test('a pack without segments emits no segments entry (never claims a section that did not render)', () => {
        const { buildEvidenceLedger } = require('../services/evidenceLedger');
        const junk = resolveQuestionPack('junk_removal', 'home_services');
        const led = buildEvidenceLedger(report([biz('A')], [biz('B')]), { pack: junk });
        expect(led.entries.find(e => e.id === 'segments')).toBeUndefined();
    });
});
