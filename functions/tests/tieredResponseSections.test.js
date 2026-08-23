'use strict';

/**
 * Regression guard: the tiered response WHITELIST must carry every section the pipeline writes.
 *
 * buildTieredResponse() constructs the freshly-generated API response from an explicit field list.
 * getReport() is different — it returns the stored doc verbatim (`{ id, ...reportData }`) — so a
 * section missing from the whitelist is stored correctly in Firestore and renders fine when the
 * report is REOPENED, but is invisible in the just-generated view. That asymmetry makes the bug
 * look like "the feature did not deploy" and cost a live debugging round on 2026-08-23
 * (marketVerdict + audienceTags were both missing).
 *
 * It had already happened once before: structuralGrowth carries a comment explaining it was
 * whitelisted for exactly this reason. This test makes a third occurrence impossible.
 *
 * Source of truth for "what sections exist" is audienceTags.SECTION_AUDIENCE, which its own
 * completeness guard already forces to stay current with api/market.js.
 */

const fs = require('fs');
const path = require('path');
const { SECTION_AUDIENCE } = require('../services/audienceTags');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'market.js'), 'utf8');

// The buildTieredResponse function body (baseResponse + every per-tier branch).
function tieredResponseBody() {
    const start = SRC.indexOf('function buildTieredResponse(');
    expect(start).toBeGreaterThan(-1);
    return SRC.slice(start);
}

// A section counts as carried if it appears EITHER as an object-literal key (`marketVerdict:`)
// OR as a conditional/unconditional property assignment (`baseResponse.seoIntelligence = ...`).
// Both forms are used in this function and both reach the client.
function carries(body, key) {
    return new RegExp('\\b' + key + '\\s*:').test(body)
        || new RegExp('\\.' + key + '\\s*=').test(body);
}

// Sections the pipeline assigns at TOP LEVEL (reportData.X = ...), which is what baseResponse must carry.
function topLevelSections() {
    const out = new Set();
    const re = /reportData\.([a-zA-Z0-9_]+)\s*=/g;
    let m;
    while ((m = re.exec(SRC)) !== null) {
        if (m[1] !== 'data' && SECTION_AUDIENCE[m[1]] !== undefined) out.add(m[1]);
    }
    return [...out];
}

describe('tiered response carries every top-level section', () => {
    test('every top-level section the pipeline writes appears in buildTieredResponse', () => {
        const body = tieredResponseBody();
        const missing = topLevelSections().filter(k => !carries(body, k));
        expect(missing).toEqual([]);
    });

    test('the sections that regressed on 2026-08-23 are explicitly covered', () => {
        const body = tieredResponseBody();
        for (const key of ['marketVerdict', 'audienceTags', 'structuralGrowth', 'evidenceLedger']) {
            expect(carries(body, key)).toBe(true);
        }
    });

    test('the STARTER tier keeps its narrow data whitelist current too', () => {
        // Growth/scale pass reportData.data wholesale; starter enumerates, so a new data.* section
        // silently disappears for starter users unless it is added there.
        const body = tieredResponseBody();
        for (const key of ['marketSegments', 'evidencePainPoints', 'weaknessThemes', 'marketDefinition']) {
            expect(carries(body, key)).toBe(true);
        }
    });

    test('guard integrity: it actually reads a non-empty section list', () => {
        // If the derivation ever silently returns [], the first test would pass vacuously.
        const sections = topLevelSections();
        expect(sections.length).toBeGreaterThanOrEqual(5);
        expect(sections).toContain('marketVerdict');
    });
});
