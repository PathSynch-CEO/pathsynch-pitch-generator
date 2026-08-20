'use strict';

/**
 * PR-C2 review — fail-open overall cap for best-effort enrichment.
 * The report must never stall or fail because a nice-to-have name lookup hung or threw.
 */

const { raceTimeout } = require('../utils/raceTimeout');

describe('raceTimeout — fail-open', () => {
    test('a promise that NEVER resolves → resolves to fallback within the cap (report proceeds)', async () => {
        const never = new Promise(() => {}); // never settles
        const start = Date.now();
        const v = await raceTimeout(never, 60, 'FALLBACK');
        expect(v).toBe('FALLBACK');
        expect(Date.now() - start).toBeLessThan(1000);
    });

    test('a rejecting promise → resolves to fallback, never throws', async () => {
        const boom = Promise.reject(new Error('serper down'));
        await expect(raceTimeout(boom, 60, null)).resolves.toBeNull();
    });

    test('a fast promise wins before the cap and its value passes through', async () => {
        const fast = Promise.resolve('DONE');
        await expect(raceTimeout(fast, 1000, null)).resolves.toBe('DONE');
    });

    test('default fallback is null', async () => {
        await expect(raceTimeout(new Promise(() => {}), 30)).resolves.toBeNull();
    });

    test('side effects of the wrapped promise still apply if it settles first', async () => {
        const box = { hit: false };
        const p = (async () => { box.hit = true; return 'x'; })();
        await raceTimeout(p, 1000, null);
        expect(box.hit).toBe(true);
    });
});
