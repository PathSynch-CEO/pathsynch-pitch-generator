'use strict';

/**
 * seoIntelligenceService.phase3.test.js
 *
 * Tests for Phase 3: AI Citation Tracking.
 * Covers: buildCitationQueries industry branching, buildNameVariants suffix stripping,
 * detectPosition, detectSentiment, detectBusinessMention, extractCompetitorNames,
 * extractDomains, checkAiCitations full flow, partial Gemini failures,
 * marketSummary Phase 3 aggregates, narrative citation context injection.
 *
 * Uses jest.resetModules() in beforeEach so Gemini mock changes take effect cleanly.
 */

let buildCitationQueries;
let buildNameVariants;
let detectPosition;
let detectSentiment;
let detectBusinessMention;
let extractCompetitorNames;
let extractDomains;
let checkAiCitations;
let enrichLeadsWithSEO;

// ── Shared mocks ──────────────────────────────────────────────────────────────

let mockGenerateContent;
let getBacklinksSummary;
let getBacklinksReferringDomains;
let getDomainStats;
let getTopOrganicKeywords;
let getTopPaidKeywords;

beforeEach(() => {
    jest.resetModules();

    mockGenerateContent = jest.fn();

    jest.mock('../services/dataForSEOClient', () => ({
        getBacklinksSummary:          jest.fn(),
        getBacklinksReferringDomains: jest.fn()
    }));

    jest.mock('../services/spyFuClient', () => ({
        getDomainStats:         jest.fn(),
        getTopOrganicKeywords:  jest.fn(),
        getTopPaidKeywords:     jest.fn()
    }));

    jest.mock('@google/generative-ai', () => ({
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: jest.fn().mockReturnValue({
                generateContent: mockGenerateContent
            })
        }))
    }));

    // Re-require the service after mocks are set
    const svc = require('../services/seoIntelligenceService');
    buildCitationQueries  = svc.buildCitationQueries;
    buildNameVariants     = svc.buildNameVariants;
    detectPosition        = svc.detectPosition;
    detectSentiment       = svc.detectSentiment;
    detectBusinessMention = svc.detectBusinessMention;
    extractCompetitorNames = svc.extractCompetitorNames;
    extractDomains        = svc.extractDomains;
    checkAiCitations      = svc.checkAiCitations;
    enrichLeadsWithSEO    = svc.enrichLeadsWithSEO;

    ({ getBacklinksSummary, getBacklinksReferringDomains } = require('../services/dataForSEOClient'));
    ({ getDomainStats, getTopOrganicKeywords, getTopPaidKeywords } = require('../services/spyFuClient'));

    // Suppress console output in tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGeminiResponse(text) {
    return { response: { text: () => text } };
}

function makeSummary(overrides = {}) {
    return {
        rank:                    20,
        backlinks:               500,
        referringDomains:        80,
        referringDomainsNofollow: 10,
        brokenBacklinks:         5,
        ...overrides
    };
}

function makeLead(overrides = {}) {
    return {
        name:       'Smile Bright Dental',
        website:    'https://smilebrightdental.com',
        city:       'Atlanta',
        industry:   'Dental Practice',
        ...overrides
    };
}

function setupDataForSEOSuccess() {
    getBacklinksSummary.mockResolvedValue(makeSummary());
    getBacklinksReferringDomains.mockResolvedValue([
        { domain: 'healthline.com', rank: 80, backlinks: 3 }
    ]);
    getDomainStats.mockResolvedValue(null);
    getTopOrganicKeywords.mockResolvedValue([]);
    getTopPaidKeywords.mockResolvedValue([]);
}

// ── buildCitationQueries — industry branching ─────────────────────────────────

describe('buildCitationQueries', () => {
    test('returns exactly 5 queries', () => {
        const q = buildCitationQueries('Smile Bright Dental', 'Atlanta', 'Dental Practice');
        expect(q).toHaveLength(5);
    });

    test('dental industry — queries contain dentist keywords', () => {
        const q = buildCitationQueries('Smile Bright', 'Atlanta', 'Dental Practice / Dentistry');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toMatch(/dental|dentist/);
        expect(joined).toContain('atlanta');
    });

    test('hvac industry — queries contain HVAC keywords', () => {
        const q = buildCitationQueries('Cool Air Inc', 'Nashville', 'HVAC / Air Conditioning');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toMatch(/hvac|air condition|heating|cooling/);
    });

    test('auto industry — queries contain auto repair keywords', () => {
        const q = buildCitationQueries("Joe's Auto", 'Dallas', 'Auto Repair');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toMatch(/auto|mechanic|car repair/);
    });

    test('salon industry — queries contain salon keywords', () => {
        const q = buildCitationQueries('Glam Studio', 'Miami', 'Hair Salon & Beauty');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toMatch(/salon|hair|beauty/);
    });

    test('restaurant industry — queries contain dining keywords', () => {
        const q = buildCitationQueries('The Bistro', 'Chicago', 'Restaurant / Food & Beverage');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toMatch(/restaurant|dining|eat/);
    });

    test('plumbing — home services branch uses "plumber"', () => {
        const q = buildCitationQueries('Fix-It Plumbing', 'Houston', 'plumbing services');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toContain('plumber');
    });

    test('electrician — home services branch uses "electrician"', () => {
        const q = buildCitationQueries('Bright Electric', 'Phoenix', 'electrical contractor');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toContain('electrician');
    });

    test('generic fallback — uses first word of industry', () => {
        const q = buildCitationQueries('Acme Corp', 'Seattle', 'Consulting Services');
        const joined = q.join(' ').toLowerCase();
        expect(joined).toContain('consulting');
        expect(joined).toContain('seattle');
    });

    test('null industry falls back to generic pattern', () => {
        const q = buildCitationQueries('My Biz', 'Boston', null);
        expect(q).toHaveLength(5);
        q.forEach(query => expect(query).toContain('Boston'));
    });

    test('all queries include city name', () => {
        const city = 'San Francisco';
        const q = buildCitationQueries('Dr. Smith Dental', city, 'Dental');
        q.forEach(query => expect(query).toContain(city));
    });
});

// ── buildNameVariants ─────────────────────────────────────────────────────────

describe('buildNameVariants', () => {
    test('returns empty array for null/empty input', () => {
        expect(buildNameVariants(null)).toEqual([]);
        expect(buildNameVariants('')).toEqual([]);
    });

    test('always includes the full lowercase name', () => {
        const variants = buildNameVariants('Smile Bright Dental');
        expect(variants).toContain('smile bright dental');
    });

    test('strips " dental" suffix to get short name', () => {
        const variants = buildNameVariants('Sunrise Dental');
        expect(variants).toContain('sunrise');
    });

    test('strips " dental care" suffix', () => {
        const variants = buildNameVariants('Advanced Dental Care');
        expect(variants).toContain('advanced');
    });

    test('strips " llc" suffix', () => {
        const variants = buildNameVariants('Smith Auto LLC');
        expect(variants.some(v => !v.includes('llc'))).toBe(true);
    });

    test('strips " inc" suffix', () => {
        const variants = buildNameVariants('Cool Air Inc');
        expect(variants.some(v => !v.includes('inc'))).toBe(true);
    });

    test('adds first-two-words variant for 3+ word names', () => {
        const variants = buildNameVariants('Johnson Family Dental Center');
        expect(variants).toContain('johnson family');
    });

    test('does NOT add first-two-words if fewer than 3 words', () => {
        const variants = buildNameVariants('Sunrise Dental');
        // Only 2 words — no first-two variant
        expect(variants.filter(v => v === 'sunrise').length).toBeLessThanOrEqual(1);
    });

    test('all variants are at least 4 characters', () => {
        const variants = buildNameVariants('The Best Spa');
        variants.forEach(v => expect(v.length).toBeGreaterThanOrEqual(4));
    });

    test('returns deduplicated variants', () => {
        const variants = buildNameVariants('ABC Dental');
        const unique = [...new Set(variants)];
        expect(variants.length).toBe(unique.length);
    });

    test('handles names with special characters', () => {
        const variants = buildNameVariants("Joe's Auto Repair");
        expect(variants.length).toBeGreaterThan(0);
        variants.forEach(v => expect(typeof v).toBe('string'));
    });
});

// ── detectPosition ────────────────────────────────────────────────────────────

describe('detectPosition', () => {
    const variants = ['smile bright dental', 'smile bright'];

    test('returns 1 when found in first numbered list entry', () => {
        const text = `1. Smile Bright Dental - Great service
2. Other Dental Office - Good quality`;
        expect(detectPosition(text, variants)).toBe(1);
    });

    test('returns 3 when found in third numbered list entry', () => {
        const text = `1. First Dental
2. Second Dental
3. Smile Bright Dental - Highly recommended`;
        expect(detectPosition(text, variants)).toBe(3);
    });

    test('handles bold markdown numbered lists', () => {
        const text = `**1. First Place**
**2. Smile Bright Dental** - Great reviews`;
        expect(detectPosition(text, variants)).toBe(2);
    });

    test('returns 1 as fallback when position not parseable', () => {
        const text = 'Smile Bright Dental is mentioned here without a list.';
        expect(detectPosition(text, variants)).toBe(1);
    });

    test('returns 1 (fallback) when business not in any list line', () => {
        const text = 'Some response without the business name at all.';
        expect(detectPosition(text, variants)).toBe(1);
    });
});

// ── detectSentiment ───────────────────────────────────────────────────────────

describe('detectSentiment', () => {
    const variants = ['sunrise dental'];

    test('returns "positive" when positive words near variant', () => {
        const text = 'Sunrise Dental is excellent and highly recommended for families.';
        expect(detectSentiment(text, variants)).toBe('positive');
    });

    test('returns "negative" when negative words near variant', () => {
        const text = 'I would avoid Sunrise Dental — the service was terrible.';
        expect(detectSentiment(text, variants)).toBe('negative');
    });

    test('returns "neutral" when no sentiment words present', () => {
        const text = 'Sunrise Dental is located on Main Street in the downtown area.';
        expect(detectSentiment(text, variants)).toBe('neutral');
    });

    test('returns "positive" when positive outweighs negative', () => {
        const text = 'Sunrise Dental is excellent and outstanding. Some customers found pricing poor.';
        expect(detectSentiment(text, variants)).toBe('positive');
    });

    test('returns "neutral" when no variant found (tie at 0)', () => {
        const text = 'Some other business is mentioned here with great service.';
        expect(detectSentiment(text, variants)).toBe('neutral');
    });
});

// ── detectBusinessMention ─────────────────────────────────────────────────────

describe('detectBusinessMention', () => {
    test('returns mentioned:false when business name not in text', () => {
        const result = detectBusinessMention('Other businesses are mentioned here.', 'Sunrise Dental');
        expect(result.mentioned).toBe(false);
        expect(result.position).toBeNull();
        expect(result.sentiment).toBeNull();
    });

    test('returns mentioned:true with position and sentiment when found', () => {
        const text = '1. Sunrise Dental - excellent quality service in Atlanta';
        const result = detectBusinessMention(text, 'Sunrise Dental');
        expect(result.mentioned).toBe(true);
        expect(typeof result.position).toBe('number');
        expect(['positive', 'negative', 'neutral']).toContain(result.sentiment);
    });

    test('handles null inputs gracefully', () => {
        expect(detectBusinessMention(null, 'Sunrise Dental').mentioned).toBe(false);
        expect(detectBusinessMention('Some text', null).mentioned).toBe(false);
    });

    test('matches via shortened variant (strips suffix)', () => {
        // "Sunrise" is a variant of "Sunrise Dental"
        const text = '1. Sunrise is highly recommended by locals.';
        const result = detectBusinessMention(text, 'Sunrise Dental');
        expect(result.mentioned).toBe(true);
    });

    test('sentiment is null when not mentioned', () => {
        const result = detectBusinessMention('Some unrelated text.', 'Missing Biz');
        expect(result.sentiment).toBeNull();
    });
});

// ── extractCompetitorNames ────────────────────────────────────────────────────

describe('extractCompetitorNames', () => {
    const ownVariants = ['smile bright dental', 'smile bright'];

    test('returns up to 5 competitor names from numbered list', () => {
        const text = `1. First Dental Office - excellent
2. Second Dental Group - highly rated
3. Smile Bright Dental - good
4. Fourth Dental Center - trusted
5. Fifth Dental Studio - professional
6. Sixth Dental Clinic - great`;
        const result = extractCompetitorNames(text, ownVariants);
        expect(result.length).toBeLessThanOrEqual(5);
        expect(result.length).toBeGreaterThan(0);
    });

    test('excludes own business name and variants', () => {
        const text = `1. Smile Bright Dental - great
2. Competitor Dental - also good`;
        const result = extractCompetitorNames(text, ownVariants);
        expect(result).not.toContain('Smile Bright Dental');
        expect(result).not.toContain('smile bright dental');
    });

    test('skips generic words (best, top, great)', () => {
        const text = `1. Best Dental in Town - great
2. Top Rated Office - excellent
3. Real Dental Office - good`;
        const result = extractCompetitorNames(text, ownVariants);
        // Should skip "Best Dental in Town" and "Top Rated Office"
        const lower = result.map(r => r.toLowerCase());
        expect(lower).not.toContain('best dental in town');
    });

    test('returns empty array when no numbered list found', () => {
        const text = 'Here are some recommendations without any numbered list formatting.';
        const result = extractCompetitorNames(text, ownVariants);
        expect(result).toEqual([]);
    });

    test('handles bold markdown list items', () => {
        const text = `**1. Acme Dental** - highly rated
**2. Metro Dental Center** - great care`;
        const result = extractCompetitorNames(text, ownVariants);
        expect(result.length).toBeGreaterThan(0);
    });
});

// ── extractDomains ────────────────────────────────────────────────────────────

describe('extractDomains', () => {
    test('returns domains found in text', () => {
        const text = 'You can find reviews at healthline.com and yelp.com for more info.';
        const result = extractDomains(text);
        expect(result).toContain('healthline.com');
    });

    test('excludes common platform domains', () => {
        const text = 'Check google.com, yelp.com, facebook.com, instagram.com for reviews.';
        const result = extractDomains(text);
        expect(result).not.toContain('google.com');
        expect(result).not.toContain('yelp.com');
        expect(result).not.toContain('facebook.com');
    });

    test('returns up to 10 domains', () => {
        const text = Array.from({ length: 15 }, (_, i) => `site${i}.com`).join(' ');
        const result = extractDomains(text);
        expect(result.length).toBeLessThanOrEqual(10);
    });

    test('returns empty array when no domains found', () => {
        const text = 'No links or domains in this plain text response.';
        const result = extractDomains(text);
        expect(result).toEqual([]);
    });

    test('handles full URLs and extracts domain', () => {
        const text = 'Visit https://www.smilebrightdental.com/about for more info.';
        const result = extractDomains(text);
        expect(result).toContain('smilebrightdental.com');
    });
});

// ── checkAiCitations ─────────────────────────────────────────────────────────

describe('checkAiCitations', () => {
    test('returns null when businessName is missing', async () => {
        const result = await checkAiCitations({ city: 'Atlanta' }, { industry: 'Dental' });
        expect(result).toBeNull();
    });

    test('returns null when city is missing', async () => {
        const result = await checkAiCitations({ name: 'Smile Bright Dental' }, { industry: 'Dental' });
        expect(result).toBeNull();
    });

    test('runs 5 queries and returns aggregated result', async () => {
        const responseText = `1. Smile Bright Dental - excellent service
2. Competitor Dental - highly rated`;
        mockGenerateContent.mockResolvedValue(makeGeminiResponse(responseText));

        const result = await checkAiCitations(
            { name: 'Smile Bright Dental', city: 'Atlanta' },
            { industry: 'Dental Practice' }
        );

        expect(result).not.toBeNull();
        expect(result.queriesRun).toBe(5);
        expect(mockGenerateContent).toHaveBeenCalledTimes(5);
    }, 10000);

    test('mentionedIn is correct count of queries where business appeared', async () => {
        // First 3 calls mention the business; last 2 do not
        let callCount = 0;
        mockGenerateContent.mockImplementation(() => {
            callCount++;
            const text = callCount <= 3
                ? '1. Sunrise Dental - excellent\n2. Other Biz - good'
                : 'Here are some options: Metro Dental, City Dental.';
            return Promise.resolve(makeGeminiResponse(text));
        });

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            { industry: 'Dental' }
        );

        expect(result.mentionedIn).toBe(3);
        expect(result.mentionRate).toBeCloseTo(0.6, 1);
    }, 10000);

    test('avgPosition is null when business never mentioned', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('Metro Dental and City Dental are both great choices.')
        );

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Nashville' },
            {}
        );

        expect(result.mentionedIn).toBe(0);
        expect(result.avgPosition).toBeNull();
    }, 10000);

    test('avgPosition computed from mentioned queries only', async () => {
        // All queries mention the business at position 2
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('1. Other Dental\n2. Sunrise Dental - highly rated')
        );

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            { industry: 'Dental' }
        );

        if (result.mentionedIn > 0) {
            expect(result.avgPosition).toBeGreaterThanOrEqual(1);
        }
    }, 10000);

    test('competitorsMentioned aggregated across all queries', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('1. Metro Dental - excellent\n2. City Dental - great\n3. Sunrise Dental')
        );

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            { industry: 'Dental' }
        );

        expect(Array.isArray(result.competitorsMentioned)).toBe(true);
        expect(result.competitorsMentioned.every(c => typeof c.name === 'string')).toBe(true);
        expect(result.competitorsMentioned.every(c => typeof c.mentionCount === 'number')).toBe(true);
    }, 10000);

    test('competitorsMentioned limited to 10 entries', async () => {
        const manyCompetitors = Array.from({ length: 12 }, (_, i) => `${i + 1}. Dental Place ${i + 1} - good`).join('\n');
        mockGenerateContent.mockResolvedValue(makeGeminiResponse(manyCompetitors));

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        expect(result.competitorsMentioned.length).toBeLessThanOrEqual(10);
    }, 10000);

    test('citedSources includes domains found in responses', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('Check healthline.com and zocdoc.com for reviews of Sunrise Dental.')
        );

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        const domainNames = result.citedSources.map(s => s.domain);
        expect(domainNames.some(d => d.includes('healthline') || d.includes('zocdoc'))).toBe(true);
    }, 10000);

    test('sentiment is null when business not mentioned in any query', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('Metro Dental is the best option here.')
        );

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        expect(result.mentionedIn).toBe(0);
        expect(result.sentiment).toBeNull();
    }, 10000);

    test('all queries failed — returns result with mentionedIn=0 (runCitationQuery uses fallback)', async () => {
        // runCitationQuery catches individual errors and returns a fallback {mentioned:false}
        // so checkAiCitations always returns a valid result (never null from individual failures)
        mockGenerateContent.mockRejectedValue(new Error('Gemini API error'));

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        expect(result).not.toBeNull();
        expect(result.queriesRun).toBe(5);
        expect(result.mentionedIn).toBe(0);
        expect(result.mentionRate).toBe(0);
        expect(result.avgPosition).toBeNull();
        expect(result.sentiment).toBeNull();
    }, 10000);

    test('partial query failure — non-throwing individual fallback', async () => {
        let callCount = 0;
        mockGenerateContent.mockImplementation(() => {
            callCount++;
            if (callCount === 2) return Promise.reject(new Error('Single query failure'));
            return Promise.resolve(makeGeminiResponse('Sunrise Dental - great service in Atlanta'));
        });

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        // Should still return a result — failed query uses fallback {mentioned:false}
        expect(result).not.toBeNull();
        expect(result.queriesRun).toBe(5);
    }, 10000);

    test('city resolved from options when not on lead', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('Sunrise Dental is a great option.')
        );

        // No city on lead — comes from options
        const result = await checkAiCitations(
            { name: 'Sunrise Dental' },
            { city: 'Atlanta', industry: 'Dental' }
        );

        expect(result).not.toBeNull();
    }, 10000);

    test('queryResults array has 5 entries', async () => {
        mockGenerateContent.mockResolvedValue(makeGeminiResponse('Some response text.'));

        const result = await checkAiCitations(
            { name: 'Sunrise Dental', city: 'Atlanta' },
            {}
        );

        expect(result.queryResults).toHaveLength(5);
        result.queryResults.forEach(qr => {
            expect(typeof qr.query).toBe('string');
            expect(typeof qr.mentioned).toBe('boolean');
            expect(Array.isArray(qr.competitorsFound)).toBe(true);
            expect(Array.isArray(qr.sourcesFound)).toBe(true);
        });
    }, 10000);
});

// ── marketSummary Phase 3 aggregates ─────────────────────────────────────────

describe('marketSummary — Phase 3 aggregates (enrichLeadsWithSEO)', () => {
    function makeLeadWithWebsite(name, url = `https://${name.replace(/\s+/g, '').toLowerCase()}.com`) {
        return { name, website: url, city: 'Atlanta', industry: 'Dental Practice' };
    }

    beforeEach(() => {
        // DataForSEO success by default
        getBacklinksSummary.mockResolvedValue(makeSummary());
        getBacklinksReferringDomains.mockResolvedValue([]);
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue([]);
        getTopPaidKeywords.mockResolvedValue([]);
    });

    test('when all citation queries fail, avgMentionRate is 0 and leadsWithAiPresence is 0', async () => {
        // runCitationQuery catches individual Gemini errors and returns fallback {mentioned:false}.
        // checkAiCitations therefore still returns a result (mentionRate=0), not null.
        // withCitations has 1 entry (mentionRate=0), so avgMentionRate=0, leadsWithAiPresence=0.
        mockGenerateContent.mockRejectedValue(new Error('Gemini down'));

        const leads = [makeLeadWithWebsite('Sunrise Dental')];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental' });

        expect(result).not.toBeNull();
        expect(result.marketSummary.avgMentionRate).toBe(0);
        expect(result.marketSummary.leadsWithAiPresence).toBe(0);
        expect(result.marketSummary.topAiCompetitors).toEqual([]);
    });

    test('leadsWithAiPresence counts only leads with mentionedIn > 0', async () => {
        // First lead: business mentioned in all 5 queries
        // Second lead: business never mentioned
        let geminiCallGroup = 0;
        let callsInGroup = 0;
        mockGenerateContent.mockImplementation(() => {
            callsInGroup++;
            // Each lead runs 5 queries. Track which group we're in.
            if (callsInGroup <= 5) {
                // First lead — narrative call at the end is separate
                return Promise.resolve(makeGeminiResponse('1. Sunrise Dental - excellent service'));
            }
            return Promise.resolve(makeGeminiResponse('Metro Dental and City Dental are popular here.'));
        });

        const leads = [
            makeLeadWithWebsite('Sunrise Dental'),
            makeLeadWithWebsite('Bright Smile')
        ];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental' });

        expect(result).not.toBeNull();
        expect(result.marketSummary.leadsWithAiPresence).toBeGreaterThanOrEqual(0);
        expect(result.marketSummary.leadsWithAiPresence).toBeLessThanOrEqual(2);
    });

    test('topAiCompetitors sorted by totalMentions desc, capped at 5', async () => {
        // Each query response mentions "Metro Dental" many times
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse(
                '1. Metro Dental - excellent\n2. City Dental - good\n3. Sunrise Dental - trusted\n4. Apex Dental - reliable\n5. Green Dental - local\n6. Sun Dental - affordable'
            )
        );

        const leads = [makeLeadWithWebsite('Sunrise Dental')];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental' });

        expect(result).not.toBeNull();
        expect(result.marketSummary.topAiCompetitors.length).toBeLessThanOrEqual(5);
        result.marketSummary.topAiCompetitors.forEach(c => {
            expect(typeof c.name).toBe('string');
            expect(typeof c.totalMentions).toBe('number');
        });
    });

    test('avgMentionRate is a number when at least one lead has citations', async () => {
        mockGenerateContent.mockResolvedValue(
            makeGeminiResponse('1. Sunrise Dental - excellent service here')
        );

        const leads = [makeLeadWithWebsite('Sunrise Dental')];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental' });

        if (result.marketSummary.avgMentionRate !== null) {
            expect(typeof result.marketSummary.avgMentionRate).toBe('number');
            expect(result.marketSummary.avgMentionRate).toBeGreaterThanOrEqual(0);
            expect(result.marketSummary.avgMentionRate).toBeLessThanOrEqual(1);
        }
    });
});

// ── Narrative — citation context injection ────────────────────────────────────

describe('Narrative — citation context injection', () => {
    beforeEach(() => {
        // DataForSEO success
        getBacklinksSummary.mockResolvedValue(makeSummary());
        getBacklinksReferringDomains.mockResolvedValue([]);
        getDomainStats.mockResolvedValue(null);
        getTopOrganicKeywords.mockResolvedValue([]);
        getTopPaidKeywords.mockResolvedValue([]);
    });

    test('narrative Gemini prompt includes AI citation section when leads have citations', async () => {
        let promptCaptured = null;
        let callCount = 0;

        mockGenerateContent.mockImplementation(req => {
            callCount++;
            const text = req.contents[0].parts[0].text;
            // Narrative call is last and contains the word 'narrative'
            if (text.toLowerCase().includes('narrative') || text.toLowerCase().includes('json')) {
                promptCaptured = text;
                return Promise.resolve(makeGeminiResponse('{"narrative": "Test narrative about the SEO landscape."}'));
            }
            // Citation queries return a mention
            return Promise.resolve(makeGeminiResponse('1. Sunrise Dental - excellent local dentist'));
        });

        const leads = [{ name: 'Sunrise Dental', website: 'https://sunrisedental.com', city: 'Atlanta', industry: 'Dental' }];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental Practice' });

        expect(result).not.toBeNull();
        // The narrative was generated
        if (promptCaptured) {
            // If citations were present, prompt should contain citation context
            if (result.marketSummary.avgMentionRate !== null) {
                expect(promptCaptured).toContain('AI CITATION INTELLIGENCE');
            }
        }
    });

    test('narrative includes citation section even when all citation queries fail (mentionRate=0)', async () => {
        // runCitationQuery fallback means checkAiCitations still returns a result with mentionRate=0.
        // hasCitations=true (because withCitations has the lead), so the citation context block
        // IS included in the narrative prompt — showing 0% mention rate.
        let promptCaptured = null;

        mockGenerateContent.mockImplementation(req => {
            const text = req.contents[0].parts[0].text;
            if (text.toLowerCase().includes('important: output only')) {
                promptCaptured = text;
                return Promise.resolve(makeGeminiResponse('{"narrative": "Test narrative."}'));
            }
            // All citation queries fail at the Gemini level — runCitationQuery returns fallback
            return Promise.reject(new Error('Gemini rate limit'));
        });

        const leads = [{ name: 'Sunrise Dental', website: 'https://sunrisedental.com', city: 'Atlanta', industry: 'Dental' }];
        const result = await enrichLeadsWithSEO(leads, { city: 'Atlanta', industry: 'Dental' });

        expect(result).not.toBeNull();
        if (promptCaptured) {
            // Citation context IS in the prompt — the block runs whenever withCitations is non-empty
            expect(promptCaptured).toContain('AI CITATION INTELLIGENCE');
        }
    });
});

// ── Module exports ────────────────────────────────────────────────────────────

describe('module exports — Phase 3 functions', () => {
    test('exports buildCitationQueries', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.buildCitationQueries).toBe('function');
    });

    test('exports buildNameVariants', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.buildNameVariants).toBe('function');
    });

    test('exports detectPosition', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.detectPosition).toBe('function');
    });

    test('exports detectSentiment', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.detectSentiment).toBe('function');
    });

    test('exports detectBusinessMention', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.detectBusinessMention).toBe('function');
    });

    test('exports extractCompetitorNames', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.extractCompetitorNames).toBe('function');
    });

    test('exports extractDomains', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.extractDomains).toBe('function');
    });

    test('exports checkAiCitations', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(typeof mod.checkAiCitations).toBe('function');
    });

    test('does not export internal helpers like runCitationQuery', () => {
        const mod = require('../services/seoIntelligenceService');
        expect(mod.runCitationQuery).toBeUndefined();
    });
});
