/**
 * Pitch Enricher — Parallel Prospect Enrichment Orchestrator
 *
 * Runs 3 enrichment sources in parallel before pitch generation:
 *   1. Deep Prospect Research Agent (google places, competitors, GBP score)
 *   2. News Intelligence Agent (recent news, trigger events)
 *   3. Vertex AI Search (PathSynch knowledge base grounding)
 *
 * All three run via Promise.allSettled() — if any source fails,
 * the others still return. Pitch generation is never blocked.
 *
 * Total timeout: 8 seconds. Whatever completes, gets used.
 */

const prospectResearchAgent = require('../agents/prospectResearchAgent');
const { researchNews } = require('./newsIntelligenceAgent');
const vertexSearch = require('./vertexSearch');

// Credit costs per enrichment source
const CREDIT_COSTS = {
    prospect_research: 50,
    news_intel: 25,
    kb_search: 10,
};

/**
 * Race a promise against a timeout
 * @param {Promise} promise
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise}
 */
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ]);
}

/**
 * Run all enrichment sources in parallel with graceful degradation
 *
 * @param {Object} params
 * @param {string} params.businessName - Business name (required)
 * @param {string} params.city - City
 * @param {string} params.state - State
 * @param {string} params.industry - Industry
 * @param {string} params.websiteUrl - Prospect website
 * @param {string} params.icpType - ICP type
 * @param {Object} params.existingMarketData - Already-fetched market data (not re-run)
 * @returns {Promise<Object>} Combined enrichment data
 */
async function enrichProspect(params) {
    const { businessName, city, state, industry, websiteUrl, icpType } = params;

    if (!businessName) {
        console.warn('[PitchEnricher] No businessName — skipping enrichment');
        return {
            prospectData: null,
            newsData: null,
            kbContext: null,
            enrichedAt: new Date().toISOString(),
            sourcesUsed: [],
            creditsUsed: 0,
        };
    }

    console.log(`[PitchEnricher] Starting parallel enrichment for ${businessName}`);
    const startTime = Date.now();

    const [prospectResearch, newsIntel, kbSearch] = await Promise.allSettled([
        // Source 1: Deep Prospect Research Agent
        withTimeout(
            prospectResearchAgent.research({
                businessName,
                city: city || '',
                state: state || '',
                industry: industry || '',
                icpType: icpType || '',
            }),
            8000
        ),

        // Source 2: News Intelligence Agent (already built)
        withTimeout(
            researchNews({
                companyName: businessName,
                industry: industry || '',
                location: [city, state].filter(Boolean).join(', '),
                websiteUrl: websiteUrl || '',
            }),
            8000
        ),

        // Source 3: Vertex AI Search — PathSynch knowledge base
        withTimeout(
            vertexSearch.groundedSearch(
                `${industry || ''} local business sales pitch ${icpType || ''}`.trim(),
                `Business: ${businessName}, City: ${city || 'unknown'}`
            ),
            5000
        ),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[PitchEnricher] Parallel enrichment completed in ${elapsed}ms`);

    // Extract results with graceful degradation
    const prospectData = prospectResearch.status === 'fulfilled' ? prospectResearch.value : null;
    const newsData = newsIntel.status === 'fulfilled' ? newsIntel.value : null;
    const kbContext = kbSearch.status === 'fulfilled' ? kbSearch.value : null;

    // Log failures for debugging
    if (prospectResearch.status === 'rejected') {
        console.warn('[PitchEnricher] Prospect research failed:', prospectResearch.reason?.message);
    }
    if (newsIntel.status === 'rejected') {
        console.warn('[PitchEnricher] News intel failed:', newsIntel.reason?.message);
    }
    if (kbSearch.status === 'rejected') {
        console.warn('[PitchEnricher] KB search failed:', kbSearch.reason?.message);
    }

    // Calculate which sources succeeded
    const sourcesUsed = [
        prospectData?.success ? 'prospect_research' : null,
        newsData?.success ? 'news_intel' : null,
        kbContext && kbContext.length > 0 ? 'kb_search' : null,
    ].filter(Boolean);

    // Calculate credit cost
    const creditsUsed = sourcesUsed.reduce((sum, source) => sum + (CREDIT_COSTS[source] || 0), 0);

    return {
        prospectData,
        newsData,
        kbContext,
        enrichedAt: new Date().toISOString(),
        sourcesUsed,
        creditsUsed,
        elapsed,
    };
}

/**
 * Build the PROSPECT_INTELLIGENCE prompt block from enrichment data
 *
 * @param {Object} enrichment - Output from enrichProspect()
 * @returns {string} Formatted prompt block for Claude synthesis
 */
function buildProspectIntelligenceBlock(enrichment) {
    if (!enrichment || enrichment.sourcesUsed.length === 0) {
        return '';
    }

    const parts = [];
    parts.push('--- PROSPECT INTELLIGENCE (from live research) ---');

    // Business Profile from prospect research
    const pd = enrichment.prospectData;
    if (pd?.businessProfile) {
        const bp = pd.businessProfile;
        parts.push(`Business Profile: ${bp.name || 'N/A'} — ${bp.rating || 'N/A'} stars, ${bp.reviewCount || 0} reviews, ${bp.address || 'N/A'}`);
    }

    // Competitive position
    if (pd?.competitivePosition) {
        const cp = pd.competitivePosition;
        const gapDir = cp.ratingGap > 0 ? 'ahead of' : cp.ratingGap < 0 ? 'behind' : 'equal to';
        parts.push(`Rating vs. Competitors: ${Math.abs(cp.ratingGap || 0).toFixed(1)} stars ${gapDir} avg (${cp.competitorCount || 0} competitors, avg ${cp.avgCompetitorRating?.toFixed(1) || 'N/A'})`);
    }

    // GBP Score
    if (pd?.gbpScore) {
        parts.push(`GBP Score: ${pd.gbpScore.total}/100 — Top gap: ${pd.gbpScore.topGap || 'none'}`);
    }

    // Owner intelligence
    if (pd?.ownerIntelligence) {
        const oi = pd.ownerIntelligence;
        if (oi.recentActivity) parts.push(`Recent Activity: ${oi.recentActivity}`);
        parts.push(`Trigger Event: ${oi.triggerEvent || 'none identified'}`);
    }

    // Recommended product
    if (pd?.recommendedProduct) {
        parts.push(`Recommended Lead Product: ${pd.recommendedProduct}`);
    }

    // Pitch hooks
    if (pd?.pitchHooks?.length > 0) {
        parts.push('Pitch Hooks:');
        pd.pitchHooks.slice(0, 3).forEach(hook => {
            parts.push(`- ${hook}`);
        });
    }

    // News intel
    if (enrichment.newsData?.signals?.length > 0) {
        const topSignals = enrichment.newsData.signals.slice(0, 3);
        const newsSummary = topSignals.map(s => s.headline).join('; ');
        parts.push(`News Intel: ${newsSummary}`);
    } else if (enrichment.newsData?.industryContext?.recentTrends?.length > 0) {
        parts.push(`Industry Trends: ${enrichment.newsData.industryContext.recentTrends.slice(0, 2).join('; ')}`);
    }

    // KB context
    if (enrichment.kbContext?.length > 0) {
        const topSnippet = enrichment.kbContext[0].snippet || enrichment.kbContext[0].title;
        if (topSnippet) {
            parts.push(`KB Context: ${topSnippet.substring(0, 300)}`);
        }
    }

    parts.push('--- END PROSPECT INTELLIGENCE ---');

    return parts.join('\n');
}

module.exports = {
    enrichProspect,
    buildProspectIntelligenceBlock,
    CREDIT_COSTS,
};
