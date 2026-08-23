'use strict';

/**
 * KPI Scorecard target integrity — Gemini may INTERPRET a KPI, never set its numbers.
 *
 * The 8/22 and 8/23 Atlanta retail reports showed invented Target-column copy that changed
 * between runs of the same market: "2 converted" then "3 signed in 90 days" on Qualified Leads,
 * "Monitor top 3" then "Monitor top 5" on Total Competitors, a review target drifting 100→350,
 * a star target drifting 4.6→4.7. Mechanism: mergeKpiScorecard applied
 * `geminiTarget || kpi.target`, so the enhancement model's target overwrote the data-derived
 * one — and the prompt even OFFERED example targets ("e.g. '5+ converted' or '3 signed in
 * 90 days'"), which the model echoed back verbatim.
 *
 * The fix: the prompt no longer requests a target field, and the merge no longer consumes one
 * (defense in depth — a model that emits target anyway is ignored). Targets come exclusively
 * from computeKpiScorecard's data-derived values; a null deterministic target stays null.
 */

const fs = require('fs');
const path = require('path');
const { computeKpiScorecard, mergeKpiScorecard } = require('../api/market');

const report = (over) => ({
    data: Object.assign({
        benchmarks: { avgRating: 4.46, topQuartileAvg: 4.7, medianReviews: 266, totalCompetitors: 19 },
        seoLandscape: { avgSEOScore: 70, strongCount: 8 },
        shareOfVoice: { leaderShare: 22.7, leaderName: 'T.J. Maxx & HomeGoods' },
        saturation: 'medium',
        leads: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
    }, over || {})
});

describe('computeKpiScorecard: every target is data-derived or a fixed platform constant', () => {
    const kpis = computeKpiScorecard(report());
    const row = (name) => kpis.find(k => k.kpi === name);

    test('review target is 1.5x the canonical median, not an invented number', () => {
        expect(row('Median Review Count').target).toBe('399 reviews');   // 266 * 1.5
    });

    test('rating target is the market top quartile', () => {
        expect(row('Average Rating').target).toBe('4.7★');
    });

    test('leads target is the fixed platform threshold', () => {
        expect(row('Qualified Leads Found').target).toBe('5+ per market');
    });

    test('Total Competitors has NO target: an absent target is a fact, not a blank to fill', () => {
        expect(row('Total Competitors').target).toBeNull();
    });
});

describe('mergeKpiScorecard: interpretation in, numbers never', () => {
    const deterministic = computeKpiScorecard(report());

    test('the production hallucinations are ignored; deterministic targets survive', () => {
        const merged = mergeKpiScorecard(deterministic, [
            { kpi: 'Qualified Leads Found', target: '3 signed in 90 days', whyItMatters: 'w1' },
            { kpi: 'Total Competitors', target: 'Monitor top 5', whyItMatters: 'w2' },
            { kpi: 'Avg Review Count', target: '350 reviews', whyItMatters: 'w3' },
            { kpi: 'Average Rating', target: '4.7★', whyItMatters: 'w4' }
        ]);
        const row = (name) => merged.find(k => k.kpi === name);
        expect(row('Qualified Leads Found').target).toBe('5+ per market');
        expect(row('Total Competitors').target).toBeNull();               // never "Monitor top N"
        expect(row('Median Review Count').target).toBe('399 reviews');    // never the drifted 350
        expect(JSON.stringify(merged)).not.toContain('3 signed in 90 days');
        expect(JSON.stringify(merged)).not.toContain('Monitor top');
    });

    test('whyItMatters still binds, including through the review-count rename alias', () => {
        const merged = mergeKpiScorecard(deterministic, [
            { kpi: 'Avg Review Count', whyItMatters: 'review volume drives map-pack visibility' }
        ]);
        expect(merged.find(k => k.kpi === 'Median Review Count').whyItMatters)
            .toBe('review volume drives map-pack visibility');
    });

    test('no interpretations at all leaves the deterministic scorecard intact', () => {
        const merged = mergeKpiScorecard(deterministic, null);
        expect(merged.map(k => ({ kpi: k.kpi, target: k.target })))
            .toEqual(deterministic.map(k => ({ kpi: k.kpi, target: k.target })));
    });
});

describe('source-shape guards', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'market.js'), 'utf8');

    test('the enhancement prompt no longer offers example targets to echo', () => {
        expect(src).not.toContain("3 signed in 90 days");
        expect(src).not.toContain("Monitor top 10");
        expect(src).not.toContain("5+ converted");
    });

    test('the prompt forbids a target field in kpiInterpretations', () => {
        expect(src).toContain('Do NOT include a "target" field anywhere in kpiInterpretations');
    });

    test('the merge never reads a Gemini target', () => {
        expect(src).not.toMatch(/geminiTarget/);
    });
});
