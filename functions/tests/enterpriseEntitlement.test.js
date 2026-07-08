'use strict';

/**
 * Enterprise entitlement mapping — regression tests.
 *
 * Bug: several plan-tier checks omitted the `enterprise` plan, so enterprise
 * users were silently demoted to a lower tier. The most visible symptom was
 * Market Intel returning the STARTER response (opportunity score, demographics,
 * trends, and AI recommendations stripped behind an "Upgrade to Growth" prompt)
 * even though enterprise ranks >= scale.
 *
 * These tests lock in: enterprise === scale-level access.
 */

// Match repo convention — market.js pulls in firebase-admin via its service graph.
jest.mock('firebase-admin');
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const market = require('../api/market');
const claude = require('../config/claude');

// Minimal report payload. Premium fields (opportunityScore, aiRecommendations)
// live on reportData.data — the starter tier strips them; scale keeps them.
function mockReportData() {
    return {
        location: { city: 'Austin', state: 'TX' },
        industry: { display: 'Dental Practice' },
        salesIntelligence: { topPainPoints: [] },
        companySize: 'small',
        executiveSummary: 'summary',
        data: {
            competitors: [{ name: 'Competitor A' }],
            competitorCount: 1,
            demographics: { population: 100000, medianIncome: 65000 },
            growthRate: 4.2, // "Business Trends"
            opportunityScore: { score: 82, label: 'Strong' },
            aiRecommendations: [{ rank: 1, action: 'Target low-review practices' }],
            leads: [],
            leadCount: 0,
            newsSignals: []
        }
    };
}

describe('resolveResponseTier — plan → response tier', () => {
    test('enterprise maps to scale (the top / full-response tier)', () => {
        expect(market.resolveResponseTier('enterprise')).toBe('scale');
    });

    test('scale, growth, starter map to themselves', () => {
        expect(market.resolveResponseTier('scale')).toBe('scale');
        expect(market.resolveResponseTier('growth')).toBe('growth');
        expect(market.resolveResponseTier('starter')).toBe('starter');
    });

    test('unknown / missing plans fail closed to starter', () => {
        expect(market.resolveResponseTier('free')).toBe('starter');
        expect(market.resolveResponseTier(undefined)).toBe('starter');
        expect(market.resolveResponseTier(null)).toBe('starter');
    });
});

describe('Market Intel — enterprise receives the full scale-tier response', () => {
    test('enterprise report includes opportunity score, demographics, trends, AI recs and NO upgradePrompt', () => {
        const tier = market.resolveResponseTier('enterprise');
        const res = market.buildTieredResponse(tier, 'report-ent-1', mockReportData());

        expect(res.tier).toBe('scale');
        expect(res.upgradePrompt).toBeUndefined();

        // The four sections the starter tier used to gate behind "Upgrade to Growth"
        expect(res.data.opportunityScore).toEqual({ score: 82, label: 'Strong' });
        expect(res.data.demographics).toEqual({ population: 100000, medianIncome: 65000 });
        expect(res.data.growthRate).toBe(4.2);
        expect(res.data.aiRecommendations).toEqual([{ rank: 1, action: 'Target low-review practices' }]);

        // Full-tier feature flags present
        expect(res.features).toEqual({ pdfExport: true, pitchIntegration: true });
    });

    test('regression: starter still gets upgradePrompt with premium fields stripped', () => {
        const res = market.buildTieredResponse(market.resolveResponseTier('starter'), 'report-str-1', mockReportData());
        expect(res.upgradePrompt).toBeDefined();
        expect(res.upgradePrompt.cta).toBe('Upgrade to Growth');
        expect(res.data.opportunityScore).toBeUndefined();
        expect(res.data.aiRecommendations).toBeUndefined();
        // Basic data still present
        expect(res.data.demographics).toEqual({ population: 100000, medianIncome: 65000 });
    });
});

describe('Formatter / narrative access — enterprise ranks >= scale', () => {
    test('every formatter (including scale-only deck/proposal) is available to enterprise', () => {
        for (const type of ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'deck', 'proposal']) {
            expect(claude.isFormatterAvailable(type, 'enterprise')).toBe(true);
        }
    });

    test('enterprise gets the full formatter list and unlimited narrative limits', () => {
        expect(claude.getAvailableFormatters('enterprise')).toEqual(
            expect.arrayContaining(['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'deck', 'proposal'])
        );
        expect(claude.canGenerateNarrative('enterprise', 100000)).toBe(true); // unlimited
        expect(claude.canBatchFormat('enterprise', 7)).toBe(true);
        expect(claude.canRegenerate('enterprise', 100000)).toBe(true);
    });
});
