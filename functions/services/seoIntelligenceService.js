'use strict';

/**
 * seoIntelligenceService.js — SEO Intelligence Layer Phase 1
 *
 * Enriches the top qualified Market Intel leads with DataForSEO Backlinks data
 * and synthesizes a Gemini narrative for the sales rep.
 *
 * Slot: runs after Visibility Enrichment, before Firestore save.
 * Pattern: non-blocking (Promise.allSettled), graceful failure, additive only.
 */

const { getBacklinksSummary, getBacklinksReferringDomains } = require('./dataForSEOClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Lazy-init so the module can be required in tests without GEMINI_API_KEY set
let _genAI = null;
function getGenAI() {
    if (!_genAI) {
        _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return _genAI;
}

// ── Domain extraction ─────────────────────────────────────────────────────────

/**
 * Extract bare domain from a URL or return null.
 * "https://www.example.com/path" → "example.com"
 */
function extractDomain(websiteUrl) {
    if (!websiteUrl || typeof websiteUrl !== 'string') return null;
    try {
        const raw = websiteUrl.trim();
        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const host = new URL(withProtocol).hostname;
        return host.replace(/^www\./, '');
    } catch (_) {
        return null;
    }
}

// ── SEO Health Rating ─────────────────────────────────────────────────────────

/**
 * Derive a 3-tier health rating from the DataForSEO `rank` field (0-100 scale).
 * DataForSEO rank is an authority score: higher = more authoritative.
 *   strong:   rank >= 40
 *   moderate: rank >= 15
 *   weak:     rank < 15 (or null / 0)
 */
function deriveSeoHealthRating(rank) {
    if (rank == null || rank === 0) return 'weak';
    if (rank >= 40) return 'strong';
    if (rank >= 15) return 'moderate';
    return 'weak';
}

// ── Per-lead enrichment ───────────────────────────────────────────────────────

/**
 * Enrich a single lead with backlinks data.
 * Returns the seoHealth object or null on failure.
 */
async function enrichOneLead(lead) {
    const websiteUrl = lead.website || lead.websiteUrl || lead.site || null;
    const domain = extractDomain(websiteUrl);
    if (!domain) return null;

    const [summaryResult, domainsResult] = await Promise.allSettled([
        getBacklinksSummary(domain),
        getBacklinksReferringDomains(domain, 10)
    ]);

    const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
    const domains = domainsResult.status === 'fulfilled' ? domainsResult.value : null;

    if (!summary && !domains) return null;

    const rank = summary?.rank ?? null;

    return {
        domain,
        domainAuthority:            rank,
        backlinks:                  summary?.backlinks                 ?? 0,
        referringDomains:           summary?.referringDomains          ?? 0,
        referringDomainsNofollow:   summary?.referringDomainsNofollow  ?? 0,
        brokenBacklinks:            summary?.brokenBacklinks           ?? 0,
        topReferringDomains:        (domains || []).slice(0, 3).map(d => ({
            domain:    d.domain,
            rank:      d.rank,
            backlinks: d.backlinks
        })),
        seoHealthRating: deriveSeoHealthRating(rank)
    };
}

// ── Gemini narrative ──────────────────────────────────────────────────────────

/**
 * Generate a one-paragraph narrative contextualising the SEO health findings
 * for the sales rep. Uses gemini-2.5-flash (SIMPLE task, JSON output).
 *
 * Returns a plain-English paragraph string or null on failure.
 *
 * @param {Array}  enrichedLeads  - leads with seoHealth attached
 * @param {string} industry       - industry label (e.g. "Dental Practice")
 * @param {string} city           - city name
 */
async function generateSeoNarrative(enrichedLeads, industry, city) {
    const leadsWithSEO = (enrichedLeads || []).filter(l => l.seoHealth);
    if (leadsWithSEO.length === 0) return null;

    const summary = leadsWithSEO.map(l => ({
        name:              l.name || l.businessName || 'Unknown',
        domain:            l.seoHealth.domain,
        domainAuthority:   l.seoHealth.domainAuthority,
        referringDomains:  l.seoHealth.referringDomains,
        backlinks:         l.seoHealth.backlinks,
        seoHealthRating:   l.seoHealth.seoHealthRating
    }));

    const weakCount   = summary.filter(l => l.seoHealthRating === 'weak').length;
    const strongCount = summary.filter(l => l.seoHealthRating === 'strong').length;

    try {
        const model = getGenAI().getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are writing a one-paragraph sales intelligence note about the SEO backlink health of local businesses in the ${industry || 'local'} market in ${city || 'this area'}.

LEAD SEO DATA:
${JSON.stringify(summary, null, 2)}

CONTEXT:
- ${weakCount} of ${summary.length} analyzed businesses have weak domain authority (rank < 15)
- ${strongCount} of ${summary.length} have strong domain authority (rank >= 40)
- DataForSEO rank is a 0-100 authority score (higher = more authoritative)
- This data helps a PathSynch sales rep understand whether prospects have built credible online presence beyond Google Business Profile

Write a single paragraph (3-5 sentences) that:
1. States the overall SEO health pattern across the market (be specific with numbers)
2. Identifies the biggest opportunity (e.g. low authority + many referring domains = link profile not translating to authority)
3. Ends with ONE practical sales angle a rep can use in conversation

Return JSON:
{ "narrative": "Your paragraph here." }`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const text = result.response.text();
        const start = text.indexOf('{');
        const end   = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;

        const parsed = JSON.parse(text.slice(start, end + 1));
        return typeof parsed.narrative === 'string' ? parsed.narrative : null;
    } catch (e) {
        console.warn('[SEOIntelligence] Narrative generation failed:', e.message);
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enrich the top 5 Market Intel qualified leads with backlinks data.
 * Returns an `seoIntelligence` object shaped for the report, or null if no leads
 * have website URLs or DataForSEO is unavailable.
 *
 * @param {Array}  leads    - qualified leads array from reportData.data.leads
 * @param {object} options  - { industry, city }
 * @returns {object|null}
 *   {
 *     enrichedLeads: [...],   // top 5 leads, each with seoHealth attached
 *     marketSummary: {
 *       totalAnalyzed, weakCount, moderateCount, strongCount,
 *       avgDomainAuthority, avgReferringDomains
 *     },
 *     narrative: string|null,
 *     enrichedAt: string (ISO)
 *   }
 */
async function enrichLeadsWithSEO(leads, options) {
    const { industry = '', city = '' } = options || {};
    const top5 = (leads || []).slice(0, 5);
    if (top5.length === 0) return null;

    // Run per-lead enrichment in parallel; one failure never blocks others
    const results = await Promise.allSettled(
        top5.map(lead => enrichOneLead(lead))
    );

    // Attach seoHealth to the lead objects (mutate a shallow copy, not the original)
    const enrichedLeads = top5.map((lead, i) => {
        const seoHealth = results[i].status === 'fulfilled' ? results[i].value : null;
        return { ...lead, seoHealth: seoHealth || null };
    });

    const withSEO = enrichedLeads.filter(l => l.seoHealth);
    if (withSEO.length === 0) {
        console.warn('[SEOIntelligence] No leads could be enriched (no website URLs or DataForSEO unavailable)');
        return null;
    }

    // Market summary aggregates
    const authorities = withSEO
        .map(l => l.seoHealth.domainAuthority)
        .filter(v => v != null && v > 0);

    const referringCounts = withSEO
        .map(l => l.seoHealth.referringDomains)
        .filter(v => v != null);

    const marketSummary = {
        totalAnalyzed:       withSEO.length,
        weakCount:           withSEO.filter(l => l.seoHealth.seoHealthRating === 'weak').length,
        moderateCount:       withSEO.filter(l => l.seoHealth.seoHealthRating === 'moderate').length,
        strongCount:         withSEO.filter(l => l.seoHealth.seoHealthRating === 'strong').length,
        avgDomainAuthority:  authorities.length > 0
            ? Math.round(authorities.reduce((s, v) => s + v, 0) / authorities.length)
            : null,
        avgReferringDomains: referringCounts.length > 0
            ? Math.round(referringCounts.reduce((s, v) => s + v, 0) / referringCounts.length)
            : null
    };

    // Narrative (non-blocking — failure returns null, report still saves)
    const narrative = await generateSeoNarrative(enrichedLeads, industry, city);

    console.log(`[SEOIntelligence] Enriched ${withSEO.length}/${top5.length} leads — ${marketSummary.weakCount} weak, ${marketSummary.moderateCount} moderate, ${marketSummary.strongCount} strong`);

    return {
        enrichedLeads,
        marketSummary,
        narrative,
        enrichedAt: new Date().toISOString()
    };
}

module.exports = { enrichLeadsWithSEO };
