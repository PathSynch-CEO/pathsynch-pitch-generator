'use strict';

/**
 * Market Intel report-quality fixes (July 7, 2026 — B2 batch).
 *
 * B2b — SWOT "high opportunity leads" count logic.
 *   Regression: a market whose qualified leads are all "Strong" (opportunityScore
 *   60–69) reported "0 of N high-opportunity leads" because the old cutoff was `> 70`.
 * B2c — Weakness themes must exclude data-availability meta-comments
 *   (e.g. "response rate not tracked") that are not real market weaknesses.
 */

const { countHighOpportunityLeads, HIGH_OPPORTUNITY_MIN_SCORE } = require('../services/swotGenerator');
const { isMetricUnavailableTheme } = require('../api/market');

describe('B2b — countHighOpportunityLeads', () => {
    test('uses the Strong band (>= 60), matching the opportunity interpretation bands', () => {
        expect(HIGH_OPPORTUNITY_MIN_SCORE).toBe(60);
    });

    test('regression: 7 qualified Strong-but-sub-70 leads count as 7, not 0', () => {
        // The exact bug from the report: 7 qualified leads, all Strong (60–68).
        // Old logic (`> 70`) → 0; corrected logic (`>= 60`) → 7.
        const leads = [66, 64, 68, 60, 62, 65, 61].map(s => ({ opportunityScore: s }));
        expect(countHighOpportunityLeads(leads)).toBe(7);
        // And the old cutoff would indeed have produced 0 here.
        expect(leads.filter(l => l.opportunityScore > 70).length).toBe(0);
    });

    test('counts Priority + Strong and excludes Moderate/Monitor', () => {
        const leads = [
            { opportunityScore: 85 }, // Priority
            { opportunityScore: 60 }, // Strong (boundary)
            { opportunityScore: 59 }, // Moderate
            { opportunityScore: 40 }, // Moderate
            { opportunityScore: 12 }, // Monitor
        ];
        expect(countHighOpportunityLeads(leads)).toBe(2);
    });

    test('coerces string scores and ignores unscored / malformed leads', () => {
        const leads = [
            { opportunityScore: '70' },       // counts (coerces to 70)
            { opportunityScore: undefined },  // unscored — ignored
            { opportunityScore: null },       // ignored
            { opportunityScore: NaN },        // ignored
            {},                               // ignored
            null,                             // ignored
        ];
        expect(countHighOpportunityLeads(leads)).toBe(1);
    });

    test('non-array input is safe', () => {
        expect(countHighOpportunityLeads(null)).toBe(0);
        expect(countHighOpportunityLeads(undefined)).toBe(0);
        expect(countHighOpportunityLeads({})).toBe(0);
    });
});

describe('B2c — isMetricUnavailableTheme', () => {
    test('flags data-availability meta-comments as non-weaknesses', () => {
        const nonWeaknesses = [
            'Response rate is not tracked across the market',
            'SEO data not available for most competitors',
            'Review velocity metric not measured for these businesses',
            'Insufficient data on customer sentiment',
            'No data on home ownership in this area',
            'Website performance data is unavailable',
            'Not enough data to assess digital presence',
            'Response rate metrics are not reported',
        ];
        for (const theme of nonWeaknesses) {
            expect(isMetricUnavailableTheme(theme)).toBe(true);
        }
    });

    test('keeps real market-structure weaknesses', () => {
        const realWeaknesses = [
            '60% of businesses have fewer than 30 reviews — weak digital presence',
            'Slow review response times leave customer complaints unanswered',
            'Market leader holds 4.8 stars while the field averages 4.1',
            'Half the market has no website, signalling low digital maturity',
            'Review velocity has stalled: 55% went 90+ days without a new review',
        ];
        for (const theme of realWeaknesses) {
            expect(isMetricUnavailableTheme(theme)).toBe(false);
        }
    });

    test('handles empty / non-string input safely', () => {
        expect(isMetricUnavailableTheme('')).toBe(false);
        expect(isMetricUnavailableTheme(null)).toBe(false);
        expect(isMetricUnavailableTheme(undefined)).toBe(false);
    });
});
