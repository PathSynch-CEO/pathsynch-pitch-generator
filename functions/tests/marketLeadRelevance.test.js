/**
 * fix/market-intel-lead-relevance
 *
 * Regression coverage for two defects observed in the live 2026-08-03 Atlanta
 * "Junk Removal & Hauling" Market Intel report:
 *
 *   Defect 1 (lead contamination): 6 of 10 "qualified leads" were CLEANING companies.
 *     The review-count/rating ICP filter admits adjacent verticals that share the parent
 *     industry footprint. Fix: sub-industry business-TYPE gate (filterLeadsByBusinessType +
 *     taxonomy `includedBusinessTypes`).
 *
 *   Defect 2 (off-topic news attaches): an unrelated "special-education complaints" story
 *     surfaced on a lead. Fix: filterRelevantNews now fails CLOSED (no off-topic fallback)
 *     and generic business-suffix tokens ("services", …) are stopwords so they cannot
 *     produce a false business-name match.
 *
 * These tests FAIL against pre-fix source: filterLeadsByBusinessType does not exist,
 * filterRelevantNews returned the off-topic top-5, and "services" matched an off-topic story.
 */

const {
    filterLeadsByBusinessType,
    filterRelevantNews,
    matchSignalToLead
} = require('../api/market');
const { findSubIndustry } = require('../config/industryTaxonomy');
const { scoreLeads } = require('../services/opportunityScorer');

// ── The exact Atlanta candidate set: 6 cleaning companies + 4 genuine junk-removal leads ──
// Each carries the Google Places `category` string Serper returns for that business type.
const CLEANING_LEADS = [
    { name: 'Quick Clean ATL',                              category: 'House cleaning service',      rating: 4.9, reviewCount: 120 },
    { name: "Cinderfella's ATL",                            category: 'Cleaning service',            rating: 4.8, reviewCount: 90 },
    { name: 'Live Oak Commercial Cleaning',                 category: 'Commercial cleaning service', rating: 4.7, reviewCount: 60 },
    { name: 'All Purpose Helpers',                          category: 'House cleaning service',      rating: 4.6, reviewCount: 45 },
    { name: "Keep'N it Tidy",                               category: 'House cleaning service',      rating: 5.0, reviewCount: 30 },
    { name: "Atlanta's Best Home And Commercial Cleaning",  category: 'Commercial cleaning service', rating: 4.5, reviewCount: 75 }
];

const JUNK_LEADS = [
    { name: 'College Hunks Hauling Junk',   category: 'Junk removal service',        rating: 4.6, reviewCount: 210 },
    { name: '1-800-GOT-JUNK Atlanta',       category: 'Junk removal service',        rating: 4.4, reviewCount: 160 },
    { name: 'Junk King Atlanta',            category: 'Garbage collection service',  rating: 4.3, reviewCount: 130 },
    { name: 'Stand Up Guys Junk Removal',   category: 'Debris removal service',      rating: 4.5, reviewCount: 95 }
];

const CANDIDATE_SET = [...CLEANING_LEADS, ...JUNK_LEADS];

describe('Defect 1 — sub-industry business-type gate (lead contamination)', () => {
    const junkConfig = findSubIndustry('Home Services', 'Junk Removal & Hauling');

    test('taxonomy declares includedBusinessTypes on the junk_removal sub-industry', () => {
        // Guards against the taxonomy field being lost (e.g. an out-of-sync manifest revert).
        expect(junkConfig).toBeTruthy();
        expect(Array.isArray(junkConfig.includedBusinessTypes)).toBe(true);
        expect(junkConfig.includedBusinessTypes.length).toBeGreaterThan(0);
    });

    test('all 6 cleaning companies are excluded from a Junk Removal report', () => {
        const filtered = filterLeadsByBusinessType(CANDIDATE_SET, junkConfig);
        const names = filtered.map(l => l.name);
        for (const c of CLEANING_LEADS) {
            expect(names).not.toContain(c.name);
        }
    });

    test('all 4 genuine junk-removal leads remain', () => {
        const filtered = filterLeadsByBusinessType(CANDIDATE_SET, junkConfig);
        const names = filtered.map(l => l.name);
        for (const j of JUNK_LEADS) {
            expect(names).toContain(j.name);
        }
        expect(filtered).toHaveLength(JUNK_LEADS.length);
    });

    test('SCORING is unchanged for surviving leads — filtering only removes contaminants', () => {
        const marketAvg = { avgSEOScore: 65 };
        const denominator = junkConfig.reviewScoreDenominator; // 800
        // Score the full (contaminated) candidate set and the filtered set independently.
        const scoredAll = scoreLeads(CANDIDATE_SET.map(l => ({ ...l })), marketAvg, denominator);
        const scoredFiltered = scoreLeads(
            filterLeadsByBusinessType(CANDIDATE_SET.map(l => ({ ...l })), junkConfig),
            marketAvg,
            denominator
        );
        for (const j of JUNK_LEADS) {
            const before = scoredAll.find(l => l.name === j.name);
            const after = scoredFiltered.find(l => l.name === j.name);
            expect(after).toBeTruthy();
            // Opportunity score and full component breakdown must not move.
            expect(after.opportunityScore).toBe(before.opportunityScore);
            expect(after.opportunityFactors).toEqual(before.opportunityFactors);
        }
    });

    test('fail-open: a lead with no Places category is never dropped', () => {
        const withUnlabeled = [...JUNK_LEADS, { name: 'Unlabeled Local Hauler', rating: 4.2, reviewCount: 20 }];
        const filtered = filterLeadsByBusinessType(withUnlabeled, junkConfig);
        expect(filtered.map(l => l.name)).toContain('Unlabeled Local Hauler');
    });

    test('no-op: a sub-industry without includedBusinessTypes leaves selection unchanged', () => {
        const cleaningConfig = findSubIndustry('Home Services', 'Cleaning');
        expect(cleaningConfig.includedBusinessTypes).toBeUndefined();
        const filtered = filterLeadsByBusinessType(CANDIDATE_SET, cleaningConfig);
        expect(filtered).toHaveLength(CANDIDATE_SET.length);
    });
});

describe('Defect 2 — off-topic news no longer attaches', () => {
    const industry = 'Junk Removal & Hauling';
    const specialEd = {
        title: 'Complaints grow in Georgia over required special education services',
        snippet: ''
    };

    test('filterRelevantNews drops an entirely off-topic story (fails closed, no fallback)', () => {
        // Pre-fix this returned newsItems.slice(0, 5) — i.e. the off-topic story itself.
        const out = filterRelevantNews([specialEd], industry, industry, 'Atlanta');
        expect(out).toEqual([]);
    });

    test('filterRelevantNews keeps a genuinely topical junk-removal story', () => {
        const topical = { title: 'Junk removal demand surges across Atlanta', snippet: '' };
        const out = filterRelevantNews([topical, specialEd], industry, industry, 'Atlanta');
        expect(out.map(s => s.title)).toContain(topical.title);
        expect(out.map(s => s.title)).not.toContain(specialEd.title);
    });

    test('the special-education story is NOT attributed to an "... Services" lead', () => {
        // Pre-fix "services" (>=7 chars) was treated as a distinctive word and matched the
        // "...special education services" story → false business_name attribution.
        const lead = { name: 'All Purpose Services' };
        expect(matchSignalToLead(specialEd, lead, industry, 'Atlanta', 'GA').matched).toBe(false);
    });

    test('the special-education story is NOT attributed to any of the live cleaning leads', () => {
        for (const c of CLEANING_LEADS) {
            expect(matchSignalToLead(specialEd, c, industry, 'Atlanta', 'GA').matched).toBe(false);
        }
    });

    test('regression: a genuine business-name story still attaches', () => {
        const lead = { name: 'Peachtree Junk Squad' };
        const signal = { title: 'Peachtree Junk Squad opens a new warehouse', snippet: '' };
        const r = matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA');
        expect(r.matched).toBe(true);
        expect(r.type).toBe('business_name');
    });

    test('regression: a topical industry-trend story still attaches', () => {
        const lead = { name: 'Metro Removers' };
        const signal = { title: 'Junk removal demand surges across the metro', snippet: '' };
        const r = matchSignalToLead(signal, lead, industry, 'Atlanta', 'GA');
        expect(r.matched).toBe(true);
        expect(r.type).toBe('industry_trend');
    });
});
