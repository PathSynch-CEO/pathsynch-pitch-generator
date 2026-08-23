'use strict';

/**
 * customSubIndustries — hygiene for the "Custom" sub-industry dropdown group.
 *
 * Pins the 2026-08-23 bug in both its causes: (1) arrayUnion + per-save timestamp appended a
 * duplicate entry on every report generation; (2) the built-in check consulted only NAICS
 * subcategory names, so taxonomy labels like "Home Goods & Decor" (which ARE the dropdown's
 * Standard group) were classified as custom in the first place.
 */

const {
    isBuiltInSubIndustry, cleanCustomSubList, cleanCustomSubMap, appendCustomSub
} = require('../services/customSubIndustries');

const entry = (v, at) => ({ value: v, label: v, createdAt: at || '2026-08-22T00:00:00.000Z' });

describe('isBuiltInSubIndustry: both Standard-group sources count', () => {
    test('a TAXONOMY label is built-in (the check the old code missed)', () => {
        expect(isBuiltInSubIndustry('Retail', 'Home Goods & Decor')).toBe(true);
    });

    test('matching is case-insensitive, as findSubIndustry resolves labels', () => {
        expect(isBuiltInSubIndustry('retail', 'home goods & decor')).toBe(true);
    });

    test('a genuinely custom sub-industry is not built-in', () => {
        expect(isBuiltInSubIndustry('Retail', 'Vintage Typewriter Repair')).toBe(false);
    });

    test('empty input is not built-in (and does not throw)', () => {
        expect(isBuiltInSubIndustry('Retail', '')).toBe(false);
        expect(isBuiltInSubIndustry('Retail', null)).toBe(false);
    });
});

describe('cleanCustomSubList: heals the polluted shape found in production', () => {
    test('four timestamp-distinct duplicates of one taxonomy label collapse to nothing', () => {
        // The exact 8/23 doc shape: same standard sub-industry, four different createdAt values.
        const polluted = [
            entry('Home Goods & Decor', '2026-08-22T01:00:00Z'),
            entry('Home Goods & Decor', '2026-08-22T02:00:00Z'),
            entry('Home Goods & Decor', '2026-08-23T15:04:00Z'),
            entry('Home Goods & Decor', '2026-08-23T15:19:00Z')
        ];
        expect(cleanCustomSubList(polluted, 'Retail')).toEqual([]);
    });

    test('duplicates of a REAL custom entry keep the earliest save only', () => {
        const dupes = [
            entry('Vintage Typewriter Repair', '2026-08-01T00:00:00Z'),
            entry('vintage typewriter repair', '2026-08-02T00:00:00Z'),
            entry('Vintage Typewriter Repair', '2026-08-03T00:00:00Z')
        ];
        const cleaned = cleanCustomSubList(dupes, 'Retail');
        expect(cleaned).toHaveLength(1);
        expect(cleaned[0].createdAt).toBe('2026-08-01T00:00:00Z');
    });

    test('malformed entries are dropped, valid custom entries survive', () => {
        const mixed = [null, {}, { createdAt: 'x' }, entry('Vintage Typewriter Repair')];
        expect(cleanCustomSubList(mixed, 'Retail')).toHaveLength(1);
    });

    test('non-array input yields an empty list, never a throw', () => {
        expect(cleanCustomSubList(null, 'Retail')).toEqual([]);
        expect(cleanCustomSubList('nope', 'Retail')).toEqual([]);
    });
});

describe('cleanCustomSubMap: whole-doc read path', () => {
    test('industries whose lists clean to empty disappear from the map', () => {
        const map = {
            'Retail': [entry('Home Goods & Decor'), entry('Home Goods & Decor', '2026-08-23T00:00:00Z')],
            'Automotive': [entry('Food Truck Fleet Service')]
        };
        const cleaned = cleanCustomSubMap(map);
        expect(cleaned['Retail']).toBeUndefined();
        expect(cleaned['Automotive']).toHaveLength(1);
    });

    test('null/empty maps come back as {}', () => {
        expect(cleanCustomSubMap(null)).toEqual({});
        expect(cleanCustomSubMap({})).toEqual({});
    });
});

describe('appendCustomSub: the write path can no longer duplicate', () => {
    const NOW = '2026-08-23T16:00:00.000Z';

    test('a built-in sub-industry is never appended', () => {
        const r = appendCustomSub([], 'Retail', 'Home Goods & Decor', NOW);
        expect(r.list).toEqual([]);
        expect(r.changed).toBe(false);
    });

    test('a new custom entry is appended once, then re-saving it is a no-op', () => {
        const first = appendCustomSub([], 'Retail', 'Vintage Typewriter Repair', NOW);
        expect(first.changed).toBe(true);
        expect(first.list).toHaveLength(1);
        // Simulate the repeat generation that used to append a duplicate per run:
        const second = appendCustomSub(first.list, 'Retail', 'Vintage Typewriter Repair', '2026-08-23T17:00:00Z');
        expect(second.changed).toBe(false);
        expect(second.list).toHaveLength(1);
        expect(second.list[0].createdAt).toBe(NOW);      // earliest save wins
    });

    test('re-save matching is case-insensitive', () => {
        const first = appendCustomSub([], 'Retail', 'Vintage Typewriter Repair', NOW);
        const second = appendCustomSub(first.list, 'Retail', 'VINTAGE TYPEWRITER REPAIR', NOW);
        expect(second.list).toHaveLength(1);
    });

    test('saving onto a polluted list heals it in the same write', () => {
        const polluted = [
            entry('Home Goods & Decor', '2026-08-22T01:00:00Z'),
            entry('Home Goods & Decor', '2026-08-22T02:00:00Z')
        ];
        const r = appendCustomSub(polluted, 'Retail', 'Vintage Typewriter Repair', NOW);
        expect(r.changed).toBe(true);
        expect(r.list).toHaveLength(1);
        expect(r.list[0].value).toBe('Vintage Typewriter Repair');
    });

    test('a built-in save onto a polluted list still reports changed so the heal is written', () => {
        const polluted = [entry('Home Goods & Decor'), entry('Home Goods & Decor', '2026-08-23T00:00:00Z')];
        const r = appendCustomSub(polluted, 'Retail', 'Home Goods & Decor', NOW);
        expect(r.list).toEqual([]);
        expect(r.changed).toBe(true);                    // 2 entries -> 0: the doc must be rewritten
    });
});
