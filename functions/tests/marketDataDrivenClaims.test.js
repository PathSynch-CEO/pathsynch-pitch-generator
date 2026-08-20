'use strict';

/**
 * Workstream B — Market Intel report "derive from data, never assert" fixes (B1–B8).
 * Fixture: the 2026-07-30 Junk Removal & Hauling / Atlanta GA report (9-lead set).
 */

const fx = require('./fixtures/atlantaJunkReport');

// ── B1: executive summary review-range claim ──────────────────────────────────
// Force the Gemini path to fail so the deterministic fallback runs, and assert it states the
// ACTUAL review range (9–1700) and never the invented "fewer than 100".
jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: () => ({ generateContent: jest.fn().mockRejectedValue(new Error('mock gemini down')) }),
    })),
}));

describe('B1 — executive summary derives the review range from data', () => {
    const { generateAIExecutiveSummary } = require('../services/narrativeGenerator');

    test('fallback states the real min–max range, not "fewer than 100"', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, fx.qualifiedLeads, [], fx.benchmarks
        );
        expect(summary).toContain('9');
        expect(summary).toContain('1700');
        expect(summary.toLowerCase()).not.toContain('fewer than 100');
        expect(summary.toLowerCase()).not.toContain('under 100');
    });

    // N3: the deterministic fallback was the OTHER market-intel surface citing the mean over review
    // counts ("Nx the market average of <avgReviews>") — and inconsistently, since the multiplier is
    // leaderReviews / median. It now cites the market MEDIAN, matching the primary Gemini path.
    test('fallback cites the market MEDIAN over review counts, never "market average"', async () => {
        const bench = { ...fx.benchmarks, medianReviews: 734 };
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, fx.qualifiedLeads, [], bench
        );
        expect(summary).toContain('market median of 734');
        expect(summary.toLowerCase()).not.toContain('market average');
    });
});

// ── B2 / B3: per-lead intel signal volume descriptor + SEO tier ───────────────
describe('B2/B3 — generateIntelSignal', () => {
    const { generateIntelSignal } = require('../services/opportunityScorer');
    const DENOM = fx.JUNK_REMOVAL_DENOMINATOR; // 800

    test('B2: a 1700-review lead is NOT "low review volume" against the denominator', () => {
        const lead = { name: 'Peach State Junk Removal', reviewCount: 1700, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks, { reviewDenominator: DENOM, seoTier: 'strong' });
        expect(sig).toContain('established review presence');
        expect(sig).not.toContain('low review volume');
    });

    test('B2: a 904-review lead (>= denominator) reads as established presence', () => {
        const lead = { name: 'Metro Hauling Group', reviewCount: 904, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks, { reviewDenominator: DENOM });
        expect(sig.toLowerCase()).toContain('established review presence');
    });

    test('B2: a 9-review lead genuinely reads as low review volume', () => {
        const lead = { name: 'Peachtree Junk Squad', reviewCount: 9, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks, { reviewDenominator: DENOM });
        expect(sig.toLowerCase()).toContain('low review volume');
    });

    test('B3: no fabricated "moderate" SEO tier when no landscape tier is supplied', () => {
        const lead = { name: 'Buckhead Debris Pros', reviewCount: 120, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks, { reviewDenominator: DENOM });
        expect(sig).not.toContain('SEO tier');
    });

    test('B3: the landscape-derived tier is stated verbatim when supplied', () => {
        const lead = { name: 'Buckhead Debris Pros', reviewCount: 594, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks, { reviewDenominator: DENOM, seoTier: 'strong' });
        expect(sig).toContain('SEO tier: strong');
    });

    test('backward compatible: no options → uses market avg and asserts no SEO tier', () => {
        const lead = { name: 'X', reviewCount: 50, rating: 4.6 };
        const sig = generateIntelSignal(lead, fx.benchmarks);
        expect(sig.toLowerCase()).toContain('low review volume'); // 50 < avg 2431
        expect(sig).not.toContain('SEO tier');
    });
});

// ── B4: safety ZIP must match BOTH city and state ─────────────────────────────
describe('B4 — pickZipForCityState', () => {
    const { pickZipForCityState } = require('../api/market');

    test('prefers the Atlanta ZIP over an in-state Dallas GA ZIP', () => {
        const addrs = [
            '45 Elm St, Dallas, GA 30157',       // wrong city, right state — must be skipped
            '123 Peachtree St, Atlanta, GA 30303',
        ];
        expect(pickZipForCityState(addrs, 'Atlanta', 'GA')).toBe('30303');
    });

    test('skips the wrong-city ZIP even when it appears first and returns "" if no city match', () => {
        const addrs = ['45 Elm St, Dallas, GA 30157'];
        expect(pickZipForCityState(addrs, 'Atlanta', 'GA')).toBe('');
    });

    test('matches on the full state name too', () => {
        expect(pickZipForCityState(['1 Peachtree, Atlanta, Georgia 30305'], 'Atlanta', 'GA')).toBe('30305');
    });
});

// ── B5: growth-signal local relevance filter ──────────────────────────────────
describe('B5 — filterGrowthSignals', () => {
    const { filterGrowthSignals } = require('../api/market');

    test('keeps locally-relevant signals and drops non-local scraped text', () => {
        const signals = [
            { name: 'Buckhead', signal: 'Buckhead in Atlanta grew 12% since 2020' },
            { name: 'World Bank', signal: 'Global GDP rose 3% according to the World Bank' },
            { name: 'Sandy Springs', signal: 'Population up across Georgia suburbs' },
        ];
        const kept = filterGrowthSignals(signals, 'Atlanta', 'GA');
        const names = kept.map(s => s.name);
        expect(names).toContain('Buckhead');       // city mention
        expect(names).toContain('Sandy Springs');  // full state name "Georgia"
        expect(names).not.toContain('World Bank');
    });

    test('omits the section (empty array) when nothing is locally relevant', () => {
        const signals = [{ name: 'World Bank', signal: 'Global GDP data' }, { name: 'United States', signal: 'National average' }];
        expect(filterGrowthSignals(signals, 'Atlanta', 'GA')).toEqual([]);
    });

    test('the 2-letter abbreviation does not loosely match innocuous words', () => {
        // "organic" contains "ga" — must NOT be kept by a state match.
        const signals = [{ name: 'Growth', signal: 'organic traffic increased' }];
        expect(filterGrowthSignals(signals, 'Atlanta', 'GA')).toEqual([]);
    });
});

// ── B6: news signal requires topical relevance ────────────────────────────────
describe('B6 — matchSignalToLead', () => {
    const { matchSignalToLead } = require('../api/market');
    const industry = 'Junk Removal & Hauling';

    test('a story that only shares the city token is NOT attached', () => {
        const lead = { name: 'Atlanta Junk Luggers' };
        const signal = { title: 'Atlanta hosts a downtown convention', snippet: 'Visitors flock to Atlanta' };
        expect(matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA').matched).toBe(false);
    });

    test('a distinctive business-name overlap IS attached', () => {
        const lead = { name: 'Peachtree Junk Squad' };
        const signal = { title: 'Peachtree Junk Squad opens a new warehouse', snippet: '' };
        const r = matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA');
        expect(r.matched).toBe(true);
        expect(r.type).toBe('business_name');
    });

    test('a topical industry story is attached as an industry_trend', () => {
        const lead = { name: 'Metro Hauling Group' };
        const signal = { title: 'Junk removal demand surges across the metro', snippet: '' };
        const r = matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA');
        expect(r.matched).toBe(true);
        expect(r.type).toBe('industry_trend');
    });

    test('an unrelated non-local story with no topical relevance is NOT attached', () => {
        const lead = { name: 'Decatur Junk Kings' };
        const signal = { title: 'Stock market climbs on tech earnings', snippet: 'Investors cheer' };
        expect(matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA').matched).toBe(false);
    });
});

// ── B7: HTTPS detection from the PSI-resolved final URL ───────────────────────
describe('B7 — resolveHttps / extractSignals', () => {
    const { resolveHttps, extractSignals } = require('../services/providers/websiteSignalsProvider');

    test('http input but https finalUrl → HTTPS true (no false "No SSL")', () => {
        expect(resolveHttps('http://acme.com', { finalUrl: 'https://acme.com/' })).toBe(true);
    });

    test('http input and http finalUrl → HTTPS false', () => {
        expect(resolveHttps('http://acme.com', { finalUrl: 'http://acme.com/' })).toBe(false);
    });

    test('falls back to input scheme when no finalUrl', () => {
        expect(resolveHttps('https://acme.com', null)).toBe(true);
        expect(resolveHttps('http://acme.com', null)).toBe(false);
    });

    test('extractSignals: http-stored URL that resolves to https is NOT flagged "No SSL"', () => {
        const data = { lighthouseResult: { finalUrl: 'https://acme.com/', categories: {}, audits: {} } };
        const result = extractSignals('http://acme.com', data);
        expect(result.conversionChecks.https).toBe(true);
        expect(result.issues.some(i => /No SSL/i.test(i))).toBe(false);
        const httpsSignal = result.lighthouseAudit.signals.find(s => s.id === 'https');
        expect(httpsSignal.pass).toBe(true);
    });
});

// ── B8: AI visibility denominators are explicit (businesses vs prompts) ───────
describe('B8 — AI visibility denominator reconciliation', () => {
    const { buildAiVisibilityIntelligence, generateAiVisibilityImplication } = require('../services/providers/aiVisibilityProvider');

    test('implication names BOTH denominators (businesses and prompts)', () => {
        const text = generateAiVisibilityImplication(15, 2, 5, 3);
        expect(text).toMatch(/2 of 5 businesses/);
        expect(text).toMatch(/across 3 recommendation prompts/);
    });

    test('buildAiVisibilityIntelligence keeps prompts (3) and businesses (5) as separate bases', () => {
        const queryResults = [0, 1, 2].map(i => ({
            provider: 'gemini', model: 'gemini-3-flash-preview', query: 'best junk removal ' + i,
            mentionedBusinesses: [], totalMentioned: 0, totalChecked: 5, checkedAt: '2026-07-30',
        }));
        const leads = fx.qualifiedLeads.slice(0, 5);
        const out = buildAiVisibilityIntelligence(queryResults, leads);

        expect(out.queriesRun).toBe(3);
        expect(out.sampleNote).toContain('3 prompts checked');
        expect(out.marketSummary.totalLeadsChecked).toBe(5);
        expect(out.confidence).toBe('directional'); // trust rule preserved
        expect(out.marketSummary.pitchImplication).toMatch(/across 3 recommendation prompts/);
        expect(out.marketSummary.pitchImplication).toMatch(/5 of 5 businesses/);
    });
});
