'use strict';

/**
 * raceTimeout — resolve when `promise` settles OR after `ms`, whichever comes first, and NEVER
 * reject. A rejection resolves to `fallback`; a timeout resolves to `fallback`. Used to keep
 * best-effort, nice-to-have work (e.g. decision-maker enrichment) off the critical path so it can
 * never stall or fail the request that awaits it.
 *
 * Fail-open by construction: the caller always makes progress within `ms`, regardless of whether the
 * wrapped promise hangs, rejects, or is simply slow.
 *
 * @param {Promise<any>} promise
 * @param {number} ms       - overall ceiling in milliseconds
 * @param {any}    fallback - value to resolve with on timeout/rejection (default null)
 * @returns {Promise<any>}
 */
function raceTimeout(promise, ms, fallback) {
    const fb = arguments.length >= 3 ? fallback : null;
    return Promise.race([
        Promise.resolve(promise).then(v => v, () => fb),
        new Promise(resolve => setTimeout(() => resolve(fb), ms))
    ]);
}

module.exports = { raceTimeout };
