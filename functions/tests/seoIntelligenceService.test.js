'use strict';

/**
 * seoIntelligenceService.test.js
 *
 * Uses jest.resetModules() in beforeEach to clear the lazy-init _genAI singleton
 * between tests, so GoogleGenerativeAI mock implementations take effect cleanly.
 */

let enrichLeadsWithSEO;
let getBacklinksSummary;
let getBacklinksReferringDomains;
let MockGoogleGenerativeAI;

// ── Module reset (clears _genAI singleton each test) ─────────────────────────

beforeEach(() => {
    jest.resetModules();

    jest.mock('../services/dataForSEOClient', () => ({
        getBacklinksSummary:          jest.fn(),
        getBacklinksReferringDomains: jest.fn()
    }));

    jest.mock('@google/generative-ai', () => ({
        GoogleGenerativeAI: jest.fn()
    }));

    ({ getBacklinksSummary, getBacklinksReferringDomains } = require('../services/dataForSEOClient'));
    ({ GoogleGenerativeAI: MockGoogleGenerativeAI } = require('@google/generative-ai'));
    ({ enrichLeadsWithSEO } = require('../services/seoIntelligenceService'));

    // Default DataForSEO: moderate authority
    getBacklinksSummary.mockResolvedValue(makeSummary(25));
    getBacklinksReferringDomains.mockResolvedValue(makeReferringDomains(5));

    // Default Gemini: returns a valid narrative
    setupGeminiMock('Default test narrative.');
});

// ── Mock factories ────────────────────────────────────────────────────────────

function makeSummary(rank = 25, overrides = {}) {
    return {
        rank,
        backlinks:                 1000,
        referringDomains:          80,
        referringDomainsNofollow:  10,
        brokenBacklinks:           5,
        referringIps:              60,
        referringSubnets:          40,
        ...overrides
    };
}

function makeReferringDomains(count = 5) {
    return Array.from({ length: count }, (_, i) => ({
        domain:    `ref${i + 1}.com`,
        rank:      50 - i * 5,
        backlinks: 100 - i * 10,
        firstSeen: '2023-01-01',
        lastSeen:  '2024-01-01'
    }));
}

function makeLead(overrides = {}) {
    return {
        name:       'Test Business',
        websiteUrl: 'https://www.example.com',
        ...overrides
    };
}

function setupGeminiMock(narrativeText = 'Test narrative.') {
    const mockGenerateContent = jest.fn().mockResolvedValue({
        response: { text: () => `{ "narrative": "${narrativeText}" }` }
    });
    const mockGetGenerativeModel = jest.fn().mockReturnValue({ generateContent: mockGenerateContent });
    MockGoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel }));
    return { mockGenerateContent, mockGetGenerativeModel };
}

// ── enrichLeadsWithSEO — guard clauses ────────────────────────────────────────

describe('enrichLeadsWithSEO — input guards', () => {
    test('returns null for empty leads array', async () => {
        const result = await enrichLeadsWithSEO([], { industry: 'Dental', city: 'Nashville' });
        expect(result).toBeNull();
    });

    test('returns null for null leads', async () => {
        const result = await enrichLeadsWithSEO(null, {});
        expect(result).toBeNull();
    });

    test('returns null for undefined leads', async () => {
        const result = await enrichLeadsWithSEO(undefined, {});
        expect(result).toBeNull();
    });
});

// ── enrichLeadsWithSEO — top-5 cap ───────────────────────────────────────────

describe('enrichLeadsWithSEO — top-5 cap', () => {
    test('only processes first 5 leads when more are provided', async () => {
        const leads = Array.from({ length: 8 }, (_, i) =>
            makeLead({ name: `Business ${i + 1}`, websiteUrl: `https://biz${i + 1}.com` })
        );

        const result = await enrichLeadsWithSEO(leads, {});

        expect(result).not.toBeNull();
        expect(result.enrichedLeads).toHaveLength(5);
        expect(getBacklinksSummary).toHaveBeenCalledTimes(5);
    });

    test('processes exactly 5 leads when exactly 5 provided', async () => {
        const leads = Array.from({ length: 5 }, (_, i) =>
            makeLead({ name: `Business ${i + 1}`, websiteUrl: `https://biz${i + 1}.com` })
        );

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.enrichedLeads).toHaveLength(5);
    });
});

// ── enrichLeadsWithSEO — domain extraction ────────────────────────────────────

describe('enrichLeadsWithSEO — website URL field fallbacks', () => {
    test('reads website from lead.websiteUrl', async () => {
        await enrichLeadsWithSEO([{ name: 'Test', websiteUrl: 'https://example.com' }], {});
        expect(getBacklinksSummary).toHaveBeenCalledWith('example.com');
    });

    test('reads website from lead.website', async () => {
        await enrichLeadsWithSEO([{ name: 'Test', website: 'https://example.com' }], {});
        expect(getBacklinksSummary).toHaveBeenCalledWith('example.com');
    });

    test('reads website from lead.site', async () => {
        await enrichLeadsWithSEO([{ name: 'Test', site: 'https://example.com' }], {});
        expect(getBacklinksSummary).toHaveBeenCalledWith('example.com');
    });

    test('strips www prefix from domain', async () => {
        await enrichLeadsWithSEO([makeLead({ websiteUrl: 'https://www.example.com/path' })], {});
        expect(getBacklinksSummary).toHaveBeenCalledWith('example.com');
    });

    test('handles URL without protocol', async () => {
        await enrichLeadsWithSEO([makeLead({ websiteUrl: 'example.com' })], {});
        expect(getBacklinksSummary).toHaveBeenCalledWith('example.com');
    });

    test('returns null overall for single lead with no website (all leads unenrichable)', async () => {
        getBacklinksSummary.mockResolvedValue(makeSummary(30)); // would succeed if called
        const result = await enrichLeadsWithSEO([{ name: 'No Website Lead' }], {});
        // All leads unenrichable → service returns null
        expect(result).toBeNull();
        expect(getBacklinksSummary).not.toHaveBeenCalled();
    });

    test('lead with no website gets seoHealth null when mixed with enrichable leads', async () => {
        const leads = [
            makeLead({ websiteUrl: 'https://hasSite.com' }),
            { name: 'No Website' }
        ];
        const result = await enrichLeadsWithSEO(leads, {});
        expect(result).not.toBeNull();
        expect(result.enrichedLeads[1].seoHealth).toBeNull();
    });

    test('returns null for single lead with empty website string', async () => {
        const result = await enrichLeadsWithSEO([{ name: 'Empty', websiteUrl: '' }], {});
        expect(result).toBeNull();
    });
});

// ── enrichLeadsWithSEO — all leads fail ──────────────────────────────────────

describe('enrichLeadsWithSEO — all leads fail', () => {
    test('returns null when no leads have website URLs', async () => {
        const result = await enrichLeadsWithSEO([{ name: 'A' }, { name: 'B' }], {});
        expect(result).toBeNull();
    });

    test('returns null when DataForSEO returns null for all leads', async () => {
        getBacklinksSummary.mockResolvedValue(null);
        getBacklinksReferringDomains.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead(), makeLead({ websiteUrl: 'https://other.com' })], {});
        expect(result).toBeNull();
    });
});

// ── enrichLeadsWithSEO — Promise.allSettled resilience ───────────────────────

describe('enrichLeadsWithSEO — partial failures', () => {
    test('one lead summary failure does not block other leads', async () => {
        getBacklinksSummary
            .mockResolvedValueOnce(null)          // lead 1: summary null
            .mockResolvedValue(makeSummary(30));  // lead 2+: success
        getBacklinksReferringDomains
            .mockResolvedValueOnce(null)          // lead 1: domains also null
            .mockResolvedValue(makeReferringDomains(3));

        const leads = [
            makeLead({ websiteUrl: 'https://lead1.com' }),
            makeLead({ websiteUrl: 'https://lead2.com', name: 'Lead 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});

        expect(result).not.toBeNull();
        expect(result.enrichedLeads[0].seoHealth).toBeNull();  // lead 1 failed
        expect(result.enrichedLeads[1].seoHealth).not.toBeNull(); // lead 2 succeeded
    });

    test('referring domains failure still yields seoHealth from summary', async () => {
        getBacklinksReferringDomains.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});

        expect(result.enrichedLeads[0].seoHealth).not.toBeNull();
        expect(result.enrichedLeads[0].seoHealth.topReferringDomains).toEqual([]);
    });

    test('DataForSEO rejection is caught and treated as null', async () => {
        getBacklinksSummary
            .mockRejectedValueOnce(new Error('Network timeout'))
            .mockResolvedValue(makeSummary(30));

        const leads = [
            makeLead({ websiteUrl: 'https://lead1.com' }),
            makeLead({ websiteUrl: 'https://lead2.com', name: 'Lead 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        // lead 2 succeeded → result is not null overall
        expect(result).not.toBeNull();
    });
});

// ── seoHealth shape ───────────────────────────────────────────────────────────

describe('enrichLeadsWithSEO — seoHealth shape', () => {
    test('seoHealth contains all expected fields', async () => {
        getBacklinksSummary.mockResolvedValue(makeSummary(30, {
            backlinks: 500,
            referringDomains: 60,
            referringDomainsNofollow: 8,
            brokenBacklinks: 3
        }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const seo = result.enrichedLeads[0].seoHealth;

        expect(seo).toMatchObject({
            domain:                   'example.com',
            domainAuthority:          30,
            backlinks:                500,
            referringDomains:         60,
            referringDomainsNofollow: 8,
            brokenBacklinks:          3,
            seoHealthRating:          'moderate'
        });
        expect(Array.isArray(seo.topReferringDomains)).toBe(true);
    });

    test('topReferringDomains is capped at 3 entries', async () => {
        getBacklinksReferringDomains.mockResolvedValue(makeReferringDomains(8));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.topReferringDomains).toHaveLength(3);
    });

    test('topReferringDomains contains domain, rank, backlinks only', async () => {
        getBacklinksReferringDomains.mockResolvedValue(makeReferringDomains(3));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        const top = result.enrichedLeads[0].seoHealth.topReferringDomains[0];

        expect(top).toHaveProperty('domain');
        expect(top).toHaveProperty('rank');
        expect(top).toHaveProperty('backlinks');
        expect(top).not.toHaveProperty('firstSeen');
        expect(top).not.toHaveProperty('lastSeen');
    });

    test('topReferringDomains is empty array when domains call returns null', async () => {
        getBacklinksReferringDomains.mockResolvedValue(null);

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.topReferringDomains).toEqual([]);
    });
});

// ── seoHealthRating thresholds ────────────────────────────────────────────────

describe('seoHealthRating thresholds', () => {
    async function getRating(rank) {
        getBacklinksSummary.mockResolvedValue(makeSummary(rank));
        const result = await enrichLeadsWithSEO([makeLead()], {});
        return result.enrichedLeads[0].seoHealth.seoHealthRating;
    }

    test('rank 40 → strong', async () => {
        expect(await getRating(40)).toBe('strong');
    });

    test('rank 75 → strong', async () => {
        expect(await getRating(75)).toBe('strong');
    });

    test('rank 100 → strong', async () => {
        expect(await getRating(100)).toBe('strong');
    });

    test('rank 15 → moderate', async () => {
        expect(await getRating(15)).toBe('moderate');
    });

    test('rank 25 → moderate', async () => {
        expect(await getRating(25)).toBe('moderate');
    });

    test('rank 39 → moderate', async () => {
        expect(await getRating(39)).toBe('moderate');
    });

    test('rank 14 → weak', async () => {
        expect(await getRating(14)).toBe('weak');
    });

    test('rank 1 → weak', async () => {
        expect(await getRating(1)).toBe('weak');
    });

    test('rank 0 → weak', async () => {
        expect(await getRating(0)).toBe('weak');
    });

    test('rank null → weak', async () => {
        getBacklinksSummary.mockResolvedValue({ ...makeSummary(), rank: null });
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.enrichedLeads[0].seoHealth.seoHealthRating).toBe('weak');
    });
});

// ── marketSummary aggregates ──────────────────────────────────────────────────

describe('enrichLeadsWithSEO — marketSummary', () => {
    test('correctly counts weak, moderate, strong leads', async () => {
        getBacklinksSummary
            .mockResolvedValueOnce(makeSummary(5))   // weak
            .mockResolvedValueOnce(makeSummary(20))  // moderate
            .mockResolvedValueOnce(makeSummary(50))  // strong
            .mockResolvedValueOnce(makeSummary(10))  // weak
            .mockResolvedValueOnce(makeSummary(60)); // strong

        const leads = Array.from({ length: 5 }, (_, i) =>
            makeLead({ websiteUrl: `https://biz${i}.com`, name: `Biz ${i}` })
        );

        const result = await enrichLeadsWithSEO(leads, {});

        expect(result.marketSummary.totalAnalyzed).toBe(5);
        expect(result.marketSummary.weakCount).toBe(2);
        expect(result.marketSummary.moderateCount).toBe(1);
        expect(result.marketSummary.strongCount).toBe(2);
    });

    test('computes avgDomainAuthority correctly', async () => {
        getBacklinksSummary
            .mockResolvedValueOnce(makeSummary(20))
            .mockResolvedValueOnce(makeSummary(40));

        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            makeLead({ websiteUrl: 'https://biz2.com', name: 'Biz 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.avgDomainAuthority).toBe(30);
    });

    test('avgDomainAuthority is null when all ranks are null', async () => {
        getBacklinksSummary.mockResolvedValue({ ...makeSummary(), rank: null });

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.marketSummary.avgDomainAuthority).toBeNull();
    });

    test('computes avgReferringDomains correctly', async () => {
        getBacklinksSummary
            .mockResolvedValueOnce(makeSummary(25, { referringDomains: 100 }))
            .mockResolvedValueOnce(makeSummary(25, { referringDomains: 200 }));

        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            makeLead({ websiteUrl: 'https://biz2.com', name: 'Biz 2' })
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.avgReferringDomains).toBe(150);
    });

    test('totalAnalyzed excludes leads with no website', async () => {
        const leads = [
            makeLead({ websiteUrl: 'https://biz1.com' }),
            { name: 'No Website' }
        ];

        const result = await enrichLeadsWithSEO(leads, {});
        expect(result.marketSummary.totalAnalyzed).toBe(1);
    });
});

// ── result shape ─────────────────────────────────────────────────────────────

describe('enrichLeadsWithSEO — result shape', () => {
    test('result contains enrichedLeads, marketSummary, narrative, enrichedAt', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result).toHaveProperty('enrichedLeads');
        expect(result).toHaveProperty('marketSummary');
        expect(result).toHaveProperty('narrative');
        expect(result).toHaveProperty('enrichedAt');
    });

    test('enrichedAt is a valid ISO 8601 string', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(typeof result.enrichedAt).toBe('string');
        expect(new Date(result.enrichedAt).toISOString()).toBe(result.enrichedAt);
    });

    test('enrichedLeads preserves original lead fields', async () => {
        const lead = makeLead({ customField: 'custom', opportunityScore: 85 });
        const result = await enrichLeadsWithSEO([lead], {});
        expect(result.enrichedLeads[0].customField).toBe('custom');
        expect(result.enrichedLeads[0].opportunityScore).toBe(85);
    });

    test('enrichedLeads does not mutate the original lead objects', async () => {
        const lead = makeLead();
        const originalKeys = Object.keys(lead);

        await enrichLeadsWithSEO([lead], {});

        expect(Object.keys(lead)).toEqual(originalKeys);
        expect(lead).not.toHaveProperty('seoHealth');
    });
});

// ── Gemini narrative ──────────────────────────────────────────────────────────

describe('generateSeoNarrative', () => {
    test('narrative is included in result when Gemini succeeds', async () => {
        setupGeminiMock('Strong SEO market in Nashville.');

        const result = await enrichLeadsWithSEO([makeLead()], { industry: 'Dental', city: 'Nashville' });
        expect(result.narrative).toBe('Strong SEO market in Nashville.');
    });

    test('narrative is null when Gemini throws — enrichedLeads still returned', async () => {
        MockGoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: jest.fn().mockRejectedValue(new Error('Gemini unavailable'))
            })
        }));

        const result = await enrichLeadsWithSEO([makeLead()], {});

        expect(result).not.toBeNull();
        expect(result.narrative).toBeNull();
        expect(result.enrichedLeads).toHaveLength(1);
    });

    test('narrative is null when Gemini returns unparseable text', async () => {
        MockGoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: jest.fn().mockResolvedValue({
                    response: { text: () => 'not json at all' }
                })
            })
        }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.narrative).toBeNull();
    });

    test('narrative is null when Gemini JSON has no narrative field', async () => {
        MockGoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: jest.fn().mockResolvedValue({
                    response: { text: () => '{ "wrongField": "value" }' }
                })
            })
        }));

        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result.narrative).toBeNull();
    });

    test('Gemini is called with gemini-2.5-flash model', async () => {
        const { mockGetGenerativeModel } = setupGeminiMock('test');

        await enrichLeadsWithSEO([makeLead()], { industry: 'Dental', city: 'Nashville' });

        expect(mockGetGenerativeModel).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gemini-2.5-flash' })
        );
    });

    test('Gemini is called with thinkingBudget 0', async () => {
        const { mockGetGenerativeModel } = setupGeminiMock('test');

        await enrichLeadsWithSEO([makeLead()], {});

        expect(mockGetGenerativeModel).toHaveBeenCalledWith(
            expect.objectContaining({
                generationConfig: expect.objectContaining({
                    thinkingConfig: expect.objectContaining({ thinkingBudget: 0 })
                })
            })
        );
    });

    test('Gemini is not called when no leads produce seoHealth', async () => {
        getBacklinksSummary.mockResolvedValue(null);
        getBacklinksReferringDomains.mockResolvedValue(null);

        const mockGetGenerativeModel = jest.fn();
        MockGoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel }));

        const result = await enrichLeadsWithSEO([makeLead()], {});

        expect(result).toBeNull();
        expect(mockGetGenerativeModel).not.toHaveBeenCalled();
    });
});

// ── options handling ──────────────────────────────────────────────────────────

describe('enrichLeadsWithSEO — options', () => {
    test('works with no options argument', async () => {
        const result = await enrichLeadsWithSEO([makeLead()]);
        expect(result).not.toBeNull();
    });

    test('works with empty options object', async () => {
        const result = await enrichLeadsWithSEO([makeLead()], {});
        expect(result).not.toBeNull();
    });
});
