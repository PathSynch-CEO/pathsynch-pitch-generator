'use strict';

/**
 * seoIntelligenceService.js — SEO Intelligence Layer (Phase 1 + Phase 2 + Phase 3)
 *
 * Phase 1: DataForSEO Backlinks data per lead (domain authority, referring domains).
 * Phase 2: SpyFu keyword rankings, organic traffic estimates, and PPC intelligence.
 * Phase 3: AI Citation Tracking — per-prospect Gemini queries to check whether the
 *           business is mentioned in AI-generated local search responses.
 *
 * Slot: runs after Visibility Enrichment, before Firestore save.
 * Pattern: non-blocking (Promise.allSettled), graceful failure, additive only.
 *
 * SpyFu data is optional — if SPYFU_API_KEY is absent or the API call fails,
 * the DataForSEO backlinks data is still returned unchanged.
 *
 * AI Citations are optional — if Gemini calls fail, seoHealth returns with
 * Phase 1 + Phase 2 data unchanged.
 */

const { getBacklinksSummary, getBacklinksReferringDomains } = require('./dataForSEOClient');
const { getDomainStats, getTopOrganicKeywords, getTopPaidKeywords } = require('./spyFuClient');
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

// ── SpyFu per-lead enrichment (Phase 2) ──────────────────────────────────────

/**
 * Enrich a single domain with SpyFu keyword + PPC intelligence.
 * Returns the spyfu object or null on total failure.
 * Never throws.
 */
async function enrichOneLeadSpyfu(domain) {
    if (!domain) return null;

    const [statsResult, organicResult, paidResult] = await Promise.allSettled([
        getDomainStats(domain),
        getTopOrganicKeywords(domain, 10),
        getTopPaidKeywords(domain, 5)
    ]);

    const stats   = statsResult.status   === 'fulfilled' ? statsResult.value   : null;
    const organic = organicResult.status === 'fulfilled' ? organicResult.value  : null;
    const paid    = paidResult.status    === 'fulfilled' ? paidResult.value     : null;

    if (!stats && !organic && !paid) return null;

    const monthlyBudget = stats?.monthlyBudget ?? 0;

    return {
        strength:             stats?.strength              ?? null,
        organicKeywords:      stats?.totalOrganicResults   ?? null,
        monthlyOrganicClicks: stats?.monthlyOrganicClicks  ?? null,
        monthlyOrganicValue:  stats?.monthlyOrganicValue   ?? null,
        monthlyPaidClicks:    stats?.monthlyPaidClicks     ?? null,
        monthlyBudget,
        topOrganicKeywords: (organic || []).slice(0, 10).map(k => ({
            keyword:      k.keyword,
            rank:         k.rankNumber,
            searchVolume: k.searchVolume,
            cpc:          k.costPerClick
        })),
        topPaidKeywords: (paid || []).slice(0, 5).map(k => ({
            keyword:      k.keyword,
            position:     k.adPosition,
            searchVolume: k.searchVolume,
            cpc:          k.costPerClick
        })),
        ppcActive: monthlyBudget > 0
    };
}

// ── AI Citation Tracking (Phase 3) ───────────────────────────────────────────

/**
 * Build 5 local-intent search queries tailored to the prospect's industry and city.
 * Query templates branch on industry keyword matching with a generic fallback.
 */
function buildCitationQueries(businessName, city, industry) {
    const ind = (industry || '').toLowerCase();

    let templates;

    if (/dental|dentist|orthodont|endodont|periodon/.test(ind)) {
        templates = [
            `best dentist in ${city}`,
            `dentist near me ${city}`,
            `top rated dental office ${city}`,
            `cosmetic dentist ${city}`,
            `emergency dental care ${city}`
        ];
    } else if (/hvac|air condition|heating|cooling|furnace/.test(ind)) {
        templates = [
            `best HVAC company in ${city}`,
            `AC repair near me ${city}`,
            `heating and cooling ${city}`,
            `HVAC installation ${city}`,
            `emergency AC repair ${city}`
        ];
    } else if (/auto|car|vehicle|mechanic|tire|collision/.test(ind)) {
        templates = [
            `best auto repair shop in ${city}`,
            `mechanic near me ${city}`,
            `car repair ${city}`,
            `top rated auto shop ${city}`,
            `oil change and auto service ${city}`
        ];
    } else if (/salon|barber|beauty|hair|nail|spa/.test(ind)) {
        templates = [
            `best hair salon in ${city}`,
            `top rated salon near me ${city}`,
            `beauty salon ${city}`,
            `haircut near me ${city}`,
            `best nail salon ${city}`
        ];
    } else if (/restaurant|food|dining|bistro|cafe|pizza|sushi/.test(ind)) {
        templates = [
            `best restaurant in ${city}`,
            `top rated dining near me ${city}`,
            `good places to eat ${city}`,
            `restaurant recommendations ${city}`,
            `highly rated local restaurant ${city}`
        ];
    } else if (/plumb|electri|roof|landscap|pest|clean|handyman|contractor/.test(ind)) {
        const service = /plumb/.test(ind) ? 'plumber'
            : /electri/.test(ind) ? 'electrician'
            : /roof/.test(ind) ? 'roofing company'
            : /landscap/.test(ind) ? 'landscaping company'
            : /pest/.test(ind) ? 'pest control'
            : /clean/.test(ind) ? 'cleaning service'
            : 'home service contractor';
        templates = [
            `best ${service} in ${city}`,
            `${service} near me ${city}`,
            `top rated ${service} ${city}`,
            `reliable ${service} ${city}`,
            `affordable ${service} ${city}`
        ];
    } else {
        // Generic local business fallback
        const industryWord = (industry || 'local business').split(/\s+/)[0].toLowerCase();
        templates = [
            `best ${industryWord} in ${city}`,
            `top rated ${industryWord} near me ${city}`,
            `recommended ${industryWord} ${city}`,
            `highly rated ${industryWord} ${city}`,
            `${industryWord} ${city} reviews`
        ];
    }

    return templates.slice(0, 5);
}

/**
 * Build name variants for fuzzy matching.
 * Returns an array of lowercase strings to check against response text.
 * All variants are at least 4 characters to avoid false positives.
 */
function buildNameVariants(businessName) {
    if (!businessName) return [];
    const lower = businessName.toLowerCase().trim();
    const variants = new Set([lower]);

    // Strip common business-type suffixes for a shorter match
    const suffixes = [
        ' dental care', ' dental office', ' dental center', ' dental group',
        ' dentistry', ' dental',
        ' auto repair', ' auto care', ' auto service', ' automotive',
        ' air conditioning', ' heating & cooling', ' heating and cooling', ' hvac',
        ' hair salon', ' beauty salon', ' hair studio',
        ' plumbing', ' electric', ' electrical', ' roofing',
        ' and associates', ' & associates',
        ' llc', ' inc', ' corp', ' co\\.', ' group', ' team',
        ' center', ' centre', ' clinic', ' studio', ' spa'
    ];

    let shortName = lower;
    for (const suffix of suffixes) {
        const re = new RegExp(suffix.replace('.', '\\.') + '$');
        if (re.test(shortName)) {
            shortName = shortName.replace(re, '').trim();
            break;
        }
    }
    if (shortName !== lower && shortName.length >= 4) {
        variants.add(shortName);
    }

    // First two words (if they form a distinct name)
    const words = lower.split(/\s+/);
    if (words.length >= 3) {
        const firstTwo = words.slice(0, 2).join(' ');
        if (firstTwo.length >= 6 && firstTwo !== shortName) {
            variants.add(firstTwo);
        }
    }

    return [...variants];
}

/**
 * Find the numbered position of the business mention in the response text.
 * Walks the text line by line looking for numbered list patterns.
 * Returns the position number (1-based) or 1 as fallback when mentioned.
 */
function detectPosition(text, variants) {
    const lines = text.split('\n');
    let currentPosition = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        const lineLower = trimmed.toLowerCase();

        // Detect numbered list entry: "1.", "1)", "**1.**", "#1", "1:" patterns
        const numMatch = trimmed.match(/^(?:\*\*)?(\d+)[.):\s]/);
        if (numMatch) {
            currentPosition = parseInt(numMatch[1], 10);
        }

        // Check if this line mentions our business
        if (variants.some(v => lineLower.includes(v))) {
            return currentPosition > 0 ? currentPosition : 1;
        }
    }

    return 1; // Mentioned but position not parseable from list structure
}

/**
 * Detect sentiment toward the business based on surrounding context words.
 * Scans ~100 chars before and after each variant occurrence.
 */
function detectSentiment(text, variants) {
    const lower = text.toLowerCase();
    let context = '';

    for (const variant of variants) {
        const idx = lower.indexOf(variant);
        if (idx !== -1) {
            const start = Math.max(0, idx - 100);
            const end   = Math.min(lower.length, idx + variant.length + 100);
            context += ' ' + lower.slice(start, end);
        }
    }

    const positiveWords = [
        'excellent', 'highly recommend', 'outstanding', 'exceptional',
        'top-rated', 'top rated', 'best', 'trusted', 'professional',
        'quality', 'wonderful', 'great', 'highly regarded', 'well-reviewed'
    ];
    const negativeWords = [
        'avoid', 'poor', 'bad', 'terrible', 'worst', 'disappointing',
        'unprofessional', 'overpriced', 'rude', 'low quality'
    ];

    const posScore = positiveWords.filter(w => context.includes(w)).length;
    const negScore = negativeWords.filter(w => context.includes(w)).length;

    if (posScore > negScore) return 'positive';
    if (negScore > posScore) return 'negative';
    return 'neutral';
}

/**
 * Detect whether the business is mentioned in the response text.
 * Uses deterministic substring matching — no LLM call.
 */
function detectBusinessMention(text, businessName) {
    if (!text || !businessName) return { mentioned: false, position: null, sentiment: null };

    const lower   = text.toLowerCase();
    const variants = buildNameVariants(businessName);

    const mentioned = variants.some(v => lower.includes(v));
    if (!mentioned) return { mentioned: false, position: null, sentiment: null };

    const position  = detectPosition(text, variants);
    const sentiment = detectSentiment(text, variants);

    return { mentioned, position, sentiment };
}

/**
 * Extract other business names that appear in numbered list entries.
 * Uses regex to find list items and exclude our own business variants.
 * Returns up to 5 unique competitor names.
 */
function extractCompetitorNames(text, variants) {
    const competitors = new Set();
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        // Match numbered list lines: "1. Business Name" / "**2. Business Name**" / "1) Name"
        const match = trimmed.match(/^(?:\*\*)?(?:\d+)[.):\s]+(?:\*\*)?([^*\n(:]+)/);
        if (!match) continue;

        const candidate = match[1].trim().replace(/\*+$/, '').trim();
        const candidateLower = candidate.toLowerCase();

        // Skip if it's our business or too short/long
        if (candidate.length < 3 || candidate.length > 70) continue;
        if (variants.some(v => candidateLower.includes(v) || v.includes(candidateLower))) continue;
        // Skip generic words that aren't business names
        if (/^(best|top|great|good|the|a |an |note:|also|tip:)/i.test(candidate)) continue;

        competitors.add(candidate);
        if (competitors.size >= 5) break;
    }

    return [...competitors];
}

/**
 * Extract domain names referenced in the response text.
 * Skips common non-business platforms.
 */
function extractDomains(text) {
    const skipDomains = new Set([
        'google.com', 'yelp.com', 'facebook.com', 'instagram.com',
        'twitter.com', 'x.com', 'linkedin.com', 'maps.google.com',
        'apple.com', 'bbb.org'
    ]);

    const domainPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:\/[^\s)]*)?/g;
    const domains = new Set();
    let match;

    while ((match = domainPattern.exec(text)) !== null) {
        const domain = match[1].toLowerCase();
        if (!skipDomains.has(domain) && domain.length > 4) {
            domains.add(domain);
        }
        if (domains.size >= 10) break;
    }

    return [...domains];
}

/**
 * Run a single local-intent query through Gemini and parse the response for
 * business mentions, competitor names, cited domains, and position.
 *
 * Returns a structured result or a safe fallback object on failure — never throws.
 */
async function runCitationQuery(query, businessName) {
    const fallback = {
        query,
        mentioned:        false,
        position:         null,
        sentiment:        null,
        competitorsFound: [],
        sourcesFound:     [],
        responseExcerpt:  null
    };

    try {
        const model = getGenAI().getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const prompt =
            `You are a helpful local search assistant. Answer this query as if a customer asked you: ` +
            `"${query}". Provide your top 3-5 recommendations with brief explanations of why you recommend each.`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const text    = result.response.text();
        const excerpt = text.slice(0, 500);

        const { mentioned, position, sentiment } = detectBusinessMention(text, businessName);
        const variants         = buildNameVariants(businessName);
        const competitorsFound = extractCompetitorNames(text, variants);
        const sourcesFound     = extractDomains(text);

        return {
            query,
            mentioned,
            position,
            sentiment: mentioned ? sentiment : null,
            competitorsFound,
            sourcesFound,
            responseExcerpt: excerpt
        };
    } catch (e) {
        console.warn('[SEOIntelligence] Citation query failed:', e.message, '|', query);
        return fallback;
    }
}

/**
 * Check AI citations for a single lead by running 5 local-intent queries through
 * Gemini and parsing each response for business mentions and competitor data.
 *
 * Queries run serially with a 200ms delay to respect Gemini rate limits.
 * Returns null if business name or city cannot be resolved.
 * Never throws.
 *
 * @param {object} lead         - lead object (name/businessName, city optional)
 * @param {object} options      - { city, industry } from market report context
 * @returns {object|null}
 */
async function checkAiCitations(lead, options = {}) {
    const businessName = lead.name || lead.businessName || null;
    const city         = lead.city || lead.location || options.city || null;
    const industry     = options.industry || lead.industry || lead.subIndustry || null;

    if (!businessName || !city) return null;

    try {
        const queries     = buildCitationQueries(businessName, city, industry);
        const queryResults = [];

        for (let i = 0; i < queries.length; i++) {
            const r = await runCitationQuery(queries[i], businessName);
            queryResults.push(r);
            if (i < queries.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        // ── Aggregate mention stats ───────────────────────────────────────────

        const mentioned    = queryResults.filter(r => r.mentioned);
        const mentionedIn  = mentioned.length;
        const mentionRate  = Math.round((mentionedIn / queries.length) * 100) / 100;

        const avgPosition = mentionedIn > 0
            ? Math.round(
                (mentioned.reduce((s, r) => s + (r.position || 1), 0) / mentionedIn) * 10
              ) / 10
            : null;

        // ── Aggregate competitor mentions ─────────────────────────────────────

        const competitorMap = {};
        for (const r of queryResults) {
            for (const name of r.competitorsFound) {
                if (!competitorMap[name]) competitorMap[name] = { name, mentionCount: 0 };
                competitorMap[name].mentionCount++;
            }
        }
        const competitorsMentioned = Object.values(competitorMap)
            .sort((a, b) => b.mentionCount - a.mentionCount)
            .slice(0, 10);

        // ── Aggregate cited source domains ────────────────────────────────────

        const sourceMap = {};
        for (const r of queryResults) {
            for (const domain of r.sourcesFound) {
                sourceMap[domain] = (sourceMap[domain] || 0) + 1;
            }
        }
        const citedSources = Object.entries(sourceMap)
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // ── Overall sentiment (majority-wins across mentioned queries) ─────────

        const sentiments  = mentioned.map(r => r.sentiment).filter(Boolean);
        let sentiment = null;
        if (sentiments.length > 0) {
            const pos = sentiments.filter(s => s === 'positive').length;
            const neg = sentiments.filter(s => s === 'negative').length;
            sentiment = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
        }

        return {
            queriesRun:           queries.length,
            mentionedIn,
            mentionRate,
            avgPosition,
            competitorsMentioned,
            citedSources,
            sentiment,
            queryResults
        };
    } catch (e) {
        console.warn('[SEOIntelligence] checkAiCitations failed:', e.message, businessName, city);
        return null;
    }
}

// ── Per-lead enrichment ───────────────────────────────────────────────────────

/**
 * Enrich a single lead with backlinks data (Phase 1), SpyFu data (Phase 2),
 * and AI citation intelligence (Phase 3).
 * All three data sources run in parallel via Promise.allSettled.
 * Returns the seoHealth object or null if DataForSEO (the primary gate) fails.
 *
 * @param {object} lead     - market intel lead
 * @param {object} options  - { industry, city } from report context
 */
async function enrichOneLead(lead, options = {}) {
    const websiteUrl = lead.website || lead.websiteUrl || lead.site || null;
    const domain = extractDomain(websiteUrl);
    if (!domain) return null;

    const [summaryResult, domainsResult, spyfuResult, citationsResult] = await Promise.allSettled([
        getBacklinksSummary(domain),
        getBacklinksReferringDomains(domain, 10),
        enrichOneLeadSpyfu(domain),
        checkAiCitations(lead, options)
    ]);

    const summary   = summaryResult.status   === 'fulfilled' ? summaryResult.value   : null;
    const domains   = domainsResult.status   === 'fulfilled' ? domainsResult.value   : null;
    const spyfu     = spyfuResult.status     === 'fulfilled' ? spyfuResult.value     : null;
    const citations = citationsResult.status === 'fulfilled' ? citationsResult.value : null;

    // Need at least DataForSEO data to return a meaningful result
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
        seoHealthRating: deriveSeoHealthRating(rank),
        spyfu:           spyfu      || null,
        aiCitations:     citations  || null
    };
}

// ── Gemini narrative ──────────────────────────────────────────────────────────

/**
 * Generate a one-paragraph narrative contextualising the SEO health findings
 * for the sales rep. Uses gemini-2.5-flash (SIMPLE task, JSON output).
 * Includes SpyFu data and AI citation data when available.
 *
 * Returns a plain-English paragraph string or null on failure.
 */
async function generateSeoNarrative(enrichedLeads, industry, city) {
    const leadsWithSEO = (enrichedLeads || []).filter(l => l.seoHealth);
    if (leadsWithSEO.length === 0) return null;

    const summary = leadsWithSEO.map(l => {
        const h = l.seoHealth;
        const entry = {
            name:             l.name || l.businessName || 'Unknown',
            domain:           h.domain,
            domainAuthority:  h.domainAuthority,
            referringDomains: h.referringDomains,
            backlinks:        h.backlinks,
            seoHealthRating:  h.seoHealthRating
        };
        if (h.spyfu) {
            entry.spyfuStrength        = h.spyfu.strength;
            entry.monthlyOrganicClicks = h.spyfu.monthlyOrganicClicks;
            entry.monthlyOrganicValue  = h.spyfu.monthlyOrganicValue;
            entry.monthlyPpcBudget     = h.spyfu.monthlyBudget;
            entry.ppcActive            = h.spyfu.ppcActive;
            entry.topOrganicKeyword    = h.spyfu.topOrganicKeywords?.[0]?.keyword || null;
        }
        if (h.aiCitations) {
            entry.aiMentionRate    = h.aiCitations.mentionRate;
            entry.aiMentionedIn    = h.aiCitations.mentionedIn;
            entry.aiQueriesRun     = h.aiCitations.queriesRun;
            entry.aiTopCompetitor  = h.aiCitations.competitorsMentioned?.[0]?.name || null;
        }
        return entry;
    });

    const weakCount      = summary.filter(l => l.seoHealthRating === 'weak').length;
    const strongCount    = summary.filter(l => l.seoHealthRating === 'strong').length;
    const ppcActiveCount = summary.filter(l => l.ppcActive).length;
    const hasSpyfu       = summary.some(l => l.spyfuStrength != null);

    // Phase 3: AI citation aggregates for prompt context
    const withCitations      = leadsWithSEO.filter(l => l.seoHealth?.aiCitations);
    const hasCitations       = withCitations.length > 0;
    const leadsWithPresence  = withCitations.filter(l => l.seoHealth.aiCitations.mentionedIn > 0).length;
    const avgMentionRatePct  = hasCitations
        ? Math.round(
            (withCitations.reduce((s, l) => s + (l.seoHealth.aiCitations.mentionRate || 0), 0) / withCitations.length) * 100
          )
        : null;

    // Top AI competitor across all leads
    const aiCompetitorCounts = {};
    for (const lead of withCitations) {
        for (const c of (lead.seoHealth.aiCitations.competitorsMentioned || [])) {
            aiCompetitorCounts[c.name] = (aiCompetitorCounts[c.name] || 0) + c.mentionCount;
        }
    }
    const topAiCompetitor = Object.entries(aiCompetitorCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    try {
        const model = getGenAI().getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const spyfuContext = hasSpyfu ? `
SPYFU KEYWORD & PPC DATA (where available):
- ${ppcActiveCount} of ${summary.length} businesses are actively running paid ads
- SpyFu strength score measures overall search visibility (0-100)
- Monthly organic value is an estimate of what the traffic would cost in PPC` : '';

        const citationContext = hasCitations ? `
AI CITATION INTELLIGENCE (Gemini local search queries):
- ${leadsWithPresence} of ${withCitations.length} analyzed businesses appeared in AI-generated local search responses
- Average AI mention rate: ${avgMentionRatePct}% of local-intent queries${topAiCompetitor ? `
- Most cited competitor in AI responses: ${topAiCompetitor}` : ''}
- Businesses not appearing in AI responses have an AI visibility gap — a new competitive front that traditional SEO tools don't measure` : '';

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are writing a one-paragraph sales intelligence note about the SEO and search visibility of local businesses in the ${industry || 'local'} market in ${city || 'this area'}.

LEAD SEO DATA:
${JSON.stringify(summary, null, 2)}

CONTEXT:
- ${weakCount} of ${summary.length} analyzed businesses have weak domain authority (rank < 15)
- ${strongCount} of ${summary.length} have strong domain authority (rank >= 40)
- DataForSEO rank is a 0-100 authority score (higher = more authoritative)${spyfuContext}${citationContext}
- This data helps a PathSynch sales rep understand whether prospects have built credible online presence beyond Google Business Profile

Write a single paragraph (3-5 sentences) that:
1. States the overall SEO health pattern across the market (be specific with numbers)
2. Identifies the biggest opportunity (e.g. low authority, weak organic presence, competitors running PPC, AI visibility gaps)
3. Ends with ONE practical sales angle a rep can use in conversation

Return JSON:
{ "narrative": "Your paragraph here." }`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const text  = result.response.text();
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
 * Enrich the top 5 Market Intel qualified leads with backlinks (Phase 1),
 * SpyFu keyword + PPC data (Phase 2), and AI citation intelligence (Phase 3).
 *
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
 *       avgDomainAuthority, avgReferringDomains,
 *       ppcActiveCount, avgSpyfuStrength,          ← Phase 2
 *       avgMentionRate, leadsWithAiPresence,        ← Phase 3
 *       topAiCompetitors                            ← Phase 3
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
        top5.map(lead => enrichOneLead(lead, { industry, city }))
    );

    // Attach seoHealth to the lead objects (shallow copy, never mutates original)
    const enrichedLeads = top5.map((lead, i) => {
        const seoHealth = results[i].status === 'fulfilled' ? results[i].value : null;
        return { ...lead, seoHealth: seoHealth || null };
    });

    const withSEO = enrichedLeads.filter(l => l.seoHealth);
    if (withSEO.length === 0) {
        console.warn('[SEOIntelligence] No leads could be enriched (no website URLs or DataForSEO unavailable)');
        return null;
    }

    // ── Phase 1 aggregates ────────────────────────────────────────────────────

    const authorities = withSEO
        .map(l => l.seoHealth.domainAuthority)
        .filter(v => v != null && v > 0);

    const referringCounts = withSEO
        .map(l => l.seoHealth.referringDomains)
        .filter(v => v != null);

    // ── Phase 2 aggregates ────────────────────────────────────────────────────

    const withSpyfu = withSEO.filter(l => l.seoHealth.spyfu);
    const spyfuStrengths = withSpyfu
        .map(l => l.seoHealth.spyfu.strength)
        .filter(v => v != null);

    // ── Phase 3 aggregates ────────────────────────────────────────────────────

    const withCitations = withSEO.filter(l => l.seoHealth.aiCitations);
    const mentionRates  = withCitations
        .map(l => l.seoHealth.aiCitations.mentionRate)
        .filter(v => v != null);

    // Roll up competitor mentions across all leads
    const aiCompetitorMap = {};
    for (const lead of withCitations) {
        for (const c of (lead.seoHealth.aiCitations.competitorsMentioned || [])) {
            if (!aiCompetitorMap[c.name]) {
                aiCompetitorMap[c.name] = { name: c.name, totalMentions: 0 };
            }
            aiCompetitorMap[c.name].totalMentions += c.mentionCount;
        }
    }
    const topAiCompetitors = Object.values(aiCompetitorMap)
        .sort((a, b) => b.totalMentions - a.totalMentions)
        .slice(0, 5);

    const marketSummary = {
        // Phase 1
        totalAnalyzed:       withSEO.length,
        weakCount:           withSEO.filter(l => l.seoHealth.seoHealthRating === 'weak').length,
        moderateCount:       withSEO.filter(l => l.seoHealth.seoHealthRating === 'moderate').length,
        strongCount:         withSEO.filter(l => l.seoHealth.seoHealthRating === 'strong').length,
        avgDomainAuthority:  authorities.length > 0
            ? Math.round(authorities.reduce((s, v) => s + v, 0) / authorities.length)
            : null,
        avgReferringDomains: referringCounts.length > 0
            ? Math.round(referringCounts.reduce((s, v) => s + v, 0) / referringCounts.length)
            : null,
        // Phase 2
        ppcActiveCount:   withSpyfu.filter(l => l.seoHealth.spyfu.ppcActive).length,
        avgSpyfuStrength: spyfuStrengths.length > 0
            ? Math.round(spyfuStrengths.reduce((s, v) => s + v, 0) / spyfuStrengths.length)
            : null,
        // Phase 3
        avgMentionRate: mentionRates.length > 0
            ? Math.round((mentionRates.reduce((s, v) => s + v, 0) / mentionRates.length) * 100) / 100
            : null,
        leadsWithAiPresence: withCitations.filter(l => l.seoHealth.aiCitations.mentionedIn > 0).length,
        topAiCompetitors
    };

    // Narrative (non-blocking — failure returns null, report still saves)
    const narrative = await generateSeoNarrative(enrichedLeads, industry, city);

    const spyfuEnriched    = withSpyfu.length;
    const citationEnriched = withCitations.length;
    console.log(
        `[SEOIntelligence] Enriched ${withSEO.length}/${top5.length} leads — ` +
        `${marketSummary.weakCount} weak, ${marketSummary.moderateCount} moderate, ${marketSummary.strongCount} strong` +
        (spyfuEnriched > 0    ? ` | SpyFu: ${spyfuEnriched} leads, ${marketSummary.ppcActiveCount} PPC active` : '') +
        (citationEnriched > 0 ? ` | AI citations: ${citationEnriched} leads, ${marketSummary.leadsWithAiPresence} with AI presence` : '')
    );

    return {
        enrichedLeads,
        marketSummary,
        narrative,
        enrichedAt: new Date().toISOString()
    };
}

module.exports = {
    enrichLeadsWithSEO,
    // Phase 3 helpers — exported for testing
    buildCitationQueries,
    buildNameVariants,
    detectPosition,
    detectSentiment,
    detectBusinessMention,
    extractCompetitorNames,
    extractDomains,
    checkAiCitations
};
