'use strict';

/**
 * seoIntelligenceService.phase2.test.js
 *
 * Tests for SpyFu keyword + PPC intelligence (Phase 2).
 * Covers: seoHealth.spyfu shape, partial SpyFu failures, DataForSEO gating,
 * field mapping (rankNumber→rank, adPosition→position, costPerClick→cpc),
 * ppcActive flag, topOrganicKeywords/topPaidKeywords caps,
 * marketSummary Phase 2 aggregates (ppcActiveCount, avgSpyfuStrength),
 * and Gemini narrative SpyFu context injection.
 *
 * Uses jest.resetModules() in beforeEach to clear lazy-init singletons.
 */

let enrichLeadsWithSEO;
let getBacklinksSummary;
let getBacklinksReferringDomains;
let getDomainStats;
let getTopOrganicKeywords;
let getTopPaidKeywords;
let MockGoogleGenerativeAI;

// ── Module reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.resetModules();

    jest.mock('../services/dataForSEOClient', () => ({
        getBacklinksSummary:          jest.fn(),
        getBacklinksReferringDomains: jest.fn()
    }));

    jest.mock('../services/spyFuClient', () => ({
        getDomainStats:        jest.fn(),
        getTopOrganicKeywords: jest.fn(),
        getTopPaidKeywords:    jest.fn()
    }));

    jest.mock('@google/generative-ai', () => ({
        GoogleGenerativeAI: jest.fn()
    }));

    ({ getBacklinksSummary, getBacklinksReferringDomains } = require('../services/dataForSEOClient'));
    ({ getDomainStats, getTopOrganicKeywords, getTopPaidKeywords } = require('../services/spyFuClient'));
    ({ GoogleGenerativeAI: MockGoogleGenerativeAI } = require('@google/generative-ai'));
    ({ enrichLeadsWithSEO } = require('../services/seoIntelligenceService'));

    // Default DataForSEO: moderate authority, passes DataForSEO gate
    getBacklinksSummary.mockResolvedValue(makeSummary(25));
    getBacklinksReferringDomains.mockResolvedValue([]);

    // Default SpyFu: valid stats + keywords
    getDomainStats.mockResolvedValue(makeSpyfuStats());
    getTopOrganicKeywords.mockResolvedValue(makeOrganicKeywords(3));
    getTopPaidKeywords.mockResolvedValue(makePaidKeywords(2));

    // Default Gemini: valid narrative
    setupGeminiMock('Default Phase 2 narrative.');
});

// ── Factories ─────────────────────────────────────────────────────────────────

function makeSummary(rank = 25, overrides = {}) {
    return {
        rank,
        backlinks:                1000,
        referringDomains:         80,
        referringDomainsNofollow: 10,
        brokenBacklinks:          5,
        ...overrides
    };
}

function makeLead(overrides = {}) {
    return { name: 'Test Business', websiteUrl: 'https://www.example.com', ...overrides };
}

function makeSpyfuStats(overrides = {}) {
    return {
        strength:             65,
        averageOrganicRank:   8,
        totalOrganicResults:  2400,
        monthlyOrganicClicks: 18000,
        monthlyOrganicValue:  22500,
        monthlyPaidClicks:    3000,
        monthlyBudget:        4800,
        totalAdsPurchased:    120,
        ...overrides
    };
}

function makeOrganicKeywords(count = 3) {
    return Array.from({ length: count }, (_, i) => ({
        keyword:      `organic kw ${i + 1}`,
        rankNumber:   i + 1,
        searchVolume: 5000 - i * 500,
        costPerClick: 8.50 - i * 0.5,
        rankChange:   i
    }));
}

function makePaidKeywords(count = 2) {
    return Array.from({ length: count }, (_, i) => ({
        keyword:      `paid kw ${i + 1}`,
        adPosition:   i + 1,
        searchVolume: 8100 - i * 1000,
        costPerClick: 22.50 - i * 2,
        monthlyClicks: 650 - i * 100
    }));
}

function setupGeminiMock(narrativeText = 'Test narrative.') {
    const mockGenerateContent = jest.fn().mockResolvedValue({
        response: { text: () => `{ "narrative": "${narrativeText}" }` }
    });
    const mockGetGenerativeModel = jest.fn().mockReturnValue({ generateContent: mockGenerateContent });
    MockGoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel }));
    return { mockGenerateContent, mockGetGenerativeModel };
}

// ── seoHealth.spyfu shape ─────────────────────────────────────────────────────

describe('seoHealth.spyfu — shape when SpyFu succeeds', () => {
    test('seoHealth.spyfu is not null when SpyFu returns data', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu).not.toBeNull();
    });

    test('spyfu contains all expected top-level fields', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;

        expect(spyfu).toHaveProperty('strength');
        expect(spyfu).toHaveProperty('organicKeywords');
        expect(spyfu).toHaveProperty('monthlyOrganicClicks');
        expect(spyfu).toHaveProperty('monthlyOrganicValue');
        expect(spyfu).toHaveProperty('monthlyPaidClicks');
        expect(spyfu).toHaveProperty('monthlyBudget');
        expect(spyfu).toHaveProperty('topOrganicKeywords');
        expect(spyfu).toHaveProperty('topPaidKeywords');
        expect(spyfu).toHaveProperty('ppcActive');
    });

    test('spyfu maps stats fields from getDomainStats', async () => {
        getDomainStats.mockResolvedValue(makeSpyfuStats({
            strength:             72,
            totalOrganicResults:  3100,
            monthlyOrganicClicks: 21000,
            monthlyOrganicValue:  28000,
            monthlyPaidClicks:    4200,
            monthlyBudget:        6500
        }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;

        expect(spyfu.strength).toBe(72);
        expect(spyfu.organicKeywords).toBe(3100);
        expect(spyfu.monthlyOrganicClicks).toBe(21000);
        expect(spyfu.monthlyOrganicValue).toBe(28000);
        expect(spyfu.monthlyPaidClicks).toBe(4200);
        expect(spyfu.monthlyBudget).toBe(6500);
    });

    test('topOrganicKeywords maps rankNumber → rank and costPerClick → cpc', async () => {
        getTopOrganicKeywords.mockResolvedValue([
            { keyword: 'dentist near me', rankNumber: 3, searchVolume: 5400, costPerClick: 8.50, rankChange: 2 }
        ]);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const kw = result.enrichedLeads[0].seoHealth.spyfu.topOrganicKeywords[0];

        expect(kw.keyword).toBe('dentist near me');
        expect(kw.rank).toBe(3);
        expect(kw.searchVolume).toBe(5400);
        expect(kw.cpc).toBe(8.50);
        expect(kw).not.toHaveProperty('rankNumber');
        expect(kw).not.toHaveProperty('costPerClick');
        expect(kw).not.toHaveProperty('rankChange');
    });

    test('topPaidKeywords maps adPosition → position and costPerClick → cpc', async () => {
        getTopPaidKeywords.mockResolvedValue([
            { keyword: 'emergency dentist', adPosition: 1, searchVolume: 8100, costPerClick: 22.50, monthlyClicks: 650 }
        ]);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const kw = result.enrichedLeads[0].seoHealth.spyfu.topPaidKeywords[0];

        expect(kw.keyword).toBe('emergency dentist');
        expect(kw.position).toBe(1);
        expect(kw.searchVolume).toBe(8100);
        expect(kw.cpc).toBe(22.50);
        expect(kw).not.toHaveProperty('adPosition');
        expect(kw).not.toHaveProperty('costPerClick');
        expect(kw).not.toHaveProperty('monthlyClicks');
    });
});

// ── ppcActive flag ────────────────────────────────────────────────────────────

describe('seoHealth.spyfu — ppcActive flag', () => {
    test('ppcActive is true when monthlyBudget > 0', async () => {
        getDomainStats.mockResolvedValue(makeSpyfuStats({ monthlyBudget: 4800 }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.ppcActive).toBe(true);
    });

    test('ppcActive is false when monthlyBudget is 0', async () => {
        getDomainStats.mockResolvedValue(makeSpyfuStats({ monthlyBudget: 0 }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.ppcActive).toBe(false);
    });

    test('ppcActive is false when monthlyBudget is null (defaults to 0)', async () => {
        getDomainStats.mockResolvedValue(makeSpyfuStats({ monthlyBudget: null }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;
        expect(spyfu.monthlyBudget).toBe(0);
        expect(spyfu.ppcActive).toBe(false);
    });
});

// ── topOrganicKeywords / topPaidKeywords caps ─────────────────────────────────

describe('seoHealth.spyfu — keyword list caps', () => {
    test('topOrganicKeywords is capped to 10 entries', async () => {
        getTopOrganicKeywords.mockResolvedValue(makeOrganicKeywords(15));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.topOrganicKeywords).toHaveLength(10);
    });

    test('topPaidKeywords is capped to 5 entries', async () => {
        getTopPaidKeywords.mockResolvedValue(makePaidKeywords(10));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.topPaidKeywords).toHaveLength(5);
    });

    test('topOrganicKeywords is empty array when getTopOrganicKeywords returns null', async () => {
        getTopOrganicKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.topOrganicKeywords).toEqual([]);
    });

    test('topPaidKeywords is empty array when getTopPaidKeywords returns null', async () => {
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu.topPaidKeywords).toEqual([]);
    });
});

// ── seoHealth.spyfu = null when SpyFu returns nothing ────────────────────────

describe('seoHealth.spyfu — null when all SpyFu calls return null', () => {
    test('spyfu is null when all three SpyFu functions return null', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.spyfu).toBeNull();
    });

    test('seoHealth is still returned when SpyFu is null but DataForSEO succeeds', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});

        expect(result).not.toBeNull();
        expect(result.enrichedLeads[0].seoHealth).not.toBeNull();
        expect(result.enrichedLeads[0].seoHealth.domainAuthority).toBe(25);
    });
});

// ── DataForSEO still gates seoHealth ─────────────────────────────────────────

describe('DataForSEO gating — SpyFu does not override', () => {
    test('seoHealth is null when DataForSEO fails even if SpyFu succeeds', async () => {
        getBacklinksSummary.mockResolvedValue(null);
        getBacklinksReferringDomains.mockResolvedValue(null);

        // SpyFu succeeds — must not override the DataForSEO gate
        getDomainStats.mockResolvedValue(makeSpyfuStats());
        getTopOrganicKeywords.mockResolvedValue(makeOrganicKeywords(3));
        getTopPaidKeywords.mockResolvedValue(makePaidKeywords(2));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result).toBeNull();
    });
});

// ── Partial SpyFu failures ────────────────────────────────────────────────────

describe('seoHealth.spyfu — partial SpyFu call failures', () => {
    test('getDomainStats returns null → spyfu still populated from keywords', async () => {
        getDomainStats.mockResolvedValue(null);
        // organic + paid still succeed

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;

        expect(spyfu).not.toBeNull();
        expect(spyfu.strength).toBeNull();
        expect(spyfu.monthlyBudget).toBe(0);
        expect(spyfu.topOrganicKeywords).toHaveLength(3);
        expect(spyfu.topPaidKeywords).toHaveLength(2);
        expect(spyfu.ppcActive).toBe(false);
    });

    test('getTopOrganicKeywords returns null → spyfu still populated from stats + paid', async () => {
        getTopOrganicKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;

        expect(spyfu).not.toBeNull();
        expect(spyfu.strength).toBe(65);
        expect(spyfu.topOrganicKeywords).toEqual([]);
        expect(spyfu.topPaidKeywords).toHaveLength(2);
    });

    test('getTopPaidKeywords returns null → spyfu still populated from stats + organic', async () => {
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const spyfu = result.enrichedLeads[0].seoHealth.spyfu;

        expect(spyfu).not.toBeNull();
        expect(spyfu.strength).toBe(65);
        expect(spyfu.topOrganicKeywords).toHaveLength(3);
        expect(spyfu.topPaidKeywords).toEqual([]);
    });

    test('SpyFu rejection is caught and treated as null — does not throw', async () => {
        getDomainStats.mockRejectedValue(new Error('SpyFu 500'));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result).not.toBeNull();
        expect(result.enrichedLeads[0].seoHealth).not.toBeNull();
        // spyfu may be null (all three settled: one rejected, two null/data)
        // what matters is no crash
    });
});

// ── SpyFu called with correct domain ─────────────────────────────────────────

describe('SpyFu — called with correct domain', () => {
    test('getDomainStats called with bare domain (www stripped)', async () => {
        await enrichLeadsWithSEO([makeLead({ websiteUrl: 'https://www.example.com' })], {});
        expect(getDomainStats).toHaveBeenCalledWith('example.com');
    });

    test('getTopOrganicKeywords called with domain and limit 10', async () => {
        await enrichLeadsWithSEO([makeLead()], {});
        expect(getTopOrganicKeywords).toHaveBeenCalledWith('example.com', 10);
    });

    test('getTopPaidKeywords called with domain and limit 5', async () => {
        await enrichLeadsWithSEO([makeLead()], {});
        expect(getTopPaidKeywords).toHaveBeenCalledWith('example.com', 5);
    });

    test('SpyFu not called when lead has no website URL', async () => {
        // Lead with no website → enrichOneLead returns null early, SpyFu never called
        // Must have a second lead to get a non-null result
        const leads = [
            { name: 'No Website' },
            makeLead({ websiteUrl: 'https://other.com', name: 'Other' })
        ];

        await enrichLeadsWithSEO(leads, {});
        // SpyFu called once for the lead with a website, not for the no-website lead
        expect(getDomainStats).toHaveBeenCalledTimes(1);
    });
});

// ── marketSummary Phase 2 aggregates ─────────────────────────────────────────

describe('marketSummary — Phase 2 aggregates', () => {
    test('marketSummary contains ppcActiveCount and avgSpyfuStrength', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.marketSummary).toHaveProperty('ppcActiveCount');
        expect(result.marketSummary).toHaveProperty('avgSpyfuStrength');
    });

    test('ppcActiveCount counts leads with ppcActive true', async () => {
        getDomainStats
            .mockResolvedValueOnce(makeSpyfuStats({ monthlyBudget: 5000 })) // PPC active
            .mockResolvedValueOnce(makeSpyfuStats({ monthlyBudget: 0 }));   // not active

        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            makeLead({ websiteUrl: 'https://biz2.com', name: 'Biz 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.ppcActiveCount).toBe(1);
    });

    test('ppcActiveCount is 0 when no SpyFu data available', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.marketSummary.ppcActiveCount).toBe(0);
    });

    test('avgSpyfuStrength averages strength values across leads', async () => {
        getDomainStats
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 40 }))
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 80 }));

        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            makeLead({ websiteUrl: 'https://biz2.com', name: 'Biz 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.avgSpyfuStrength).toBe(60);
    });

    test('avgSpyfuStrength excludes null strength values from average', async () => {
        getDomainStats
            .mockResolvedValueOnce(makeSpyfuStats({ strength: null })) // excluded
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 60 }));  // included

        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            makeLead({ websiteUrl: 'https://biz2.com', name: 'Biz 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.avgSpyfuStrength).toBe(60);
    });

    test('avgSpyfuStrength is null when all SpyFu data is null', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.marketSummary.avgSpyfuStrength).toBeNull();
    });

    test('avgSpyfuStrength is rounded integer', async () => {
        getDomainStats
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 33 }))
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 34 }))
            .mockResolvedValueOnce(makeSpyfuStats({ strength: 35 }));

        const leads = Array.from({ length: 3 }, (_, i) =>
            makeLead({ websiteUrl: `https://biz${i}.com`, name: `Biz ${i}` })
        );

        const result = await enrichLeadsWithSEO(leads, {});
        expect(Number.isInteger(result.marketSummary.avgSpyfuStrength)).toBe(true);
    });
});

// ── Narrative SpyFu context injection ────────────────────────────────────────

describe('generateSeoNarrative — SpyFu context', () => {
    test('narrative is generated when SpyFu data is available', async () => {
        setupGeminiMock('Two of five businesses run paid ads, signalling competitive PPC pressure.');

        const result = await enrichLeadsWithSEO([makeLead()], { industry: 'Dental', city: 'Nashville' });
        expect(result.narrative).toBe('Two of five businesses run paid ads, signalling competitive PPC pressure.');
    });

    test('Gemini prompt includes SpyFu section when leads have SpyFu strength', async () => {
        getDomainStats.mockResolvedValue(makeSpyfuStats({ strength: 65 }));

        const { mockGenerateContent } = setupGeminiMock('spyfu narrative');
        await enrichLeadsWithSEO([makeLead()], { industry: 'Dental', city: 'Nashville' });

        const callArgs = mockGenerateContent.mock.calls[0][0];
        const promptText = callArgs.contents[0].parts[0].text;

        expect(promptText).toContain('SPYFU KEYWORD & PPC DATA');
        expect(promptText).toContain('actively running paid ads');
        expect(promptText).toContain('SpyFu strength score');
    });

    test('Gemini prompt does NOT include SpyFu section when all SpyFu data is null', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        const { mockGenerateContent } = setupGeminiMock('no spyfu narrative');
        await enrichLeadsWithSEO([makeLead()], { industry: 'Dental', city: 'Nashville' });

        const callArgs = mockGenerateContent.mock.calls[0][0];
        const promptText = callArgs.contents[0].parts[0].text;

        expect(promptText).not.toContain('SPYFU KEYWORD & PPC DATA');
    });

    test('narrative is still returned when SpyFu null — DataForSEO data present', async () => {
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue(null);
        getTopPaidKeywords.mockResolvedValue(null);

        setupGeminiMock('Narrative without SpyFu.');
        const result = await enrichLeadsWithSEO([makeLead()], {});

        expect(result.narrative).toBe('Narrative without SpyFu.');
    });
});
