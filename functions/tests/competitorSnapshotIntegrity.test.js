'use strict';

/**
 * Competitor snapshot integrity — pins the 2026-08-23 Atlanta retail defect where the
 * "Top Competitors (10)" table rendered 8 identical HomeGoods rows (4.5 / 719 / 12.0%) while
 * the stated market leader was absent from its own table.
 *
 * Mechanism, confirmed against production PDFs from two independent discovery runs:
 *   1. Multi-query discovery returns the same business once per query. deduplicateCompetitors()
 *      existed but ran AFTER reportData.data.competitors was snapshotted from the raw array.
 *   2. Gate 1 finalization then matched every duplicate row by normalized name to the SAME
 *      reconciled record and stamped all of them with identical rating/reviews/shareOfVoice.
 *   3. The snapshot sliced the raw array to 20 in ARRIVAL order, so duplicates crowded the top
 *      and could push the true leader below the slice entirely.
 *
 * The fix: dedupe at assembly (before any snapshot), order the snapshot by review volume, and
 * re-sort the persisted rows after finalization stamps the reconciled numbers. The source-shape
 * guards below pin the ORDERING of those operations in api/market.js, because that ordering —
 * not the functions themselves — was the bug.
 */

const fs = require('fs');
const path = require('path');
const {
    deduplicateCompetitors, orderCompetitorsForSnapshot, normalizeBusinessName
} = require('../api/market');

const biz = (name, reviewCount, rating) => ({ name, reviewCount, rating });

describe('deduplicateCompetitors', () => {
    test('the production shape: one business repeated per discovery query collapses to one row', () => {
        const raw = [
            ...Array.from({ length: 8 }, () => biz('HomeGoods', 719, 4.5)),
            biz('Floor & Decor', 1315, 4.4),
            biz('Home decor secret', 0, null)
        ];
        const deduped = deduplicateCompetitors(raw);
        expect(deduped).toHaveLength(3);
        expect(deduped.filter(c => c.name === 'HomeGoods')).toHaveLength(1);
    });

    test('keeps the higher-review record when duplicates disagree', () => {
        const deduped = deduplicateCompetitors([biz('HomeGoods', 12, 4.0), biz('HomeGoods', 719, 4.5)]);
        expect(deduped).toHaveLength(1);
        expect(deduped[0].reviewCount).toBe(719);
    });

    test('dedup key is the normalized name (punctuation/case-insensitive)', () => {
        const deduped = deduplicateCompetitors([biz('T.J. Maxx & HomeGoods', 1358, 4.3), biz('tj maxx homegoods', 100, 4.0)]);
        expect(deduped).toHaveLength(1);
        expect(normalizeBusinessName('T.J. Maxx & HomeGoods')).toBe(normalizeBusinessName('tj maxx homegoods'));
    });
});

describe('orderCompetitorsForSnapshot', () => {
    test('the market leader is row 1, never row 9: review volume descends', () => {
        const arrivalOrder = [
            biz('HomeGoods', 719, 4.5),
            biz('Home decor secret', 0, null),
            biz('Floor & Decor', 1315, 4.4),
            biz('T.J. Maxx & HomeGoods', 1358, 4.3)
        ];
        const ordered = orderCompetitorsForSnapshot(arrivalOrder);
        expect(ordered.map(c => c.name)).toEqual([
            'T.J. Maxx & HomeGoods', 'Floor & Decor', 'HomeGoods', 'Home decor secret'
        ]);
    });

    test('ties on volume break by rating, then by name for determinism', () => {
        const ordered = orderCompetitorsForSnapshot([
            biz('Zeta Decor', 100, 4.0), biz('Alpha Decor', 100, 4.8), biz('Beta Decor', 100, 4.0)
        ]);
        expect(ordered.map(c => c.name)).toEqual(['Alpha Decor', 'Beta Decor', 'Zeta Decor']);
    });

    test('reads reviewCount (discovery shape) and reviews (persisted shape) alike', () => {
        const ordered = orderCompetitorsForSnapshot([
            { name: 'Persisted Shape', reviews: 500, rating: 4.0 },
            { name: 'Discovery Shape', reviewCount: 900, rating: 4.0 }
        ]);
        expect(ordered[0].name).toBe('Discovery Shape');
    });

    test('does not mutate its input (the local competitors array feeds SOV downstream)', () => {
        const input = [biz('B', 1, 4), biz('A', 2, 4)];
        orderCompetitorsForSnapshot(input);
        expect(input.map(c => c.name)).toEqual(['B', 'A']);
    });
});

describe('source-shape guards: the ORDERING of dedup/sort/snapshot is the fix', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'market.js'), 'utf8');

    test('competitors are deduped AT ASSEMBLY, before any snapshot exists', () => {
        expect(src).toMatch(/let competitors = deduplicateCompetitors\(competitorResult\.competitors \|\| \[\]\)/);
    });

    test('the persisted snapshot is ordered by review volume before the top-20 slice', () => {
        expect(src).toMatch(/competitors: orderCompetitorsForSnapshot\(competitors\)\.slice\(0, 20\)\.map/);
    });

    test('finalization re-sorts the persisted rows on the reconciled numbers it just stamped', () => {
        expect(src).toMatch(/reportData\.data\.competitors = orderCompetitorsForSnapshot\(reportData\.data\.competitors\)/);
    });

    test('the raw (pre-dedup) array is never snapshotted anywhere', () => {
        // The bug was `competitors.slice(0, 20)` on the raw array. Any bare slice of the
        // competitors variable into a persisted shape without the ordering wrapper is a
        // regression. This guard caught a second instance while the fix was being written:
        // the Library auto-save built its own top-10 from the same raw slice.
        expect(src).not.toMatch(/competitors: competitors\.slice\(/);
    });
});
