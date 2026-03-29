/**
 * Market Intelligence API Handlers
 *
 * Generates market reports with competitor analysis and demographics
 * Enhanced with NAICS taxonomy, city-level Census data, and opportunity scoring
 */

const admin = require('firebase-admin');
const { getUserPlan, getUserUsage } = require('../middleware/planGate');
const { getPlanLimits, hasFeature, PLANS } = require('../config/stripe');
const googlePlaces = require('../services/googlePlaces');
const coresignal = require('../services/coresignal');
const coresignalConfig = require('../config/coresignal');
const census = require('../services/census');
const naics = require('../config/naics');
const { getIndustryIntelligence } = require('../config/industryIntelligence');
const geography = require('../services/geography');
const cbp = require('../services/cbp');
const marketMetrics = require('../services/marketMetrics');
const googleTrends = require('../services/googleTrends');

// City normalization helper — handles "Atlanta, GA", "123 Main St, Atlanta, GA 30301"
function extractCity(input) {
    if (!input) return null;
    const parts = input.split(',');
    for (const part of parts) {
        const cleaned = part.trim();
        if (/^\d/.test(cleaned)) continue;
        if (cleaned.length <= 3) continue;
        if (/\d/.test(cleaned)) continue;
        return cleaned.toLowerCase().trim();
    }
    return input.toLowerCase().trim();
}
const secEdgar = require('../services/secEdgar');
const uspto = require('../services/uspto');
const serperClient = require('../services/serperClient');

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const db = admin.firestore();

/**
 * Calculate market benchmarks from competitor data
 */
function calculateMarketBenchmarks(competitors) {
    const rated = competitors.filter(c => c.rating);
    if (!rated.length) return null;

    const ratings = rated.map(c => c.rating);
    const avgRating = (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(2);

    const sorted = [...ratings].sort((a, b) => b - a);
    const topQuartile = sorted.slice(0, Math.ceil(sorted.length * 0.25));
    const topQuartileAvg = (topQuartile.reduce((s, r) => s + r, 0) / topQuartile.length).toFixed(1);

    const reviews = competitors.map(c => c.reviewCount || c.reviews || 0);
    const avgReviews = Math.round(reviews.reduce((s, r) => s + r, 0) / reviews.length);
    const totalReviews = reviews.reduce((s, r) => s + r, 0);

    const aboveAvg = rated.filter(c => c.rating > parseFloat(avgRating)).length;

    const leader = competitors.reduce((best, c) =>
        (c.rating || 0) > (best.rating || 0) ? c : best
    , competitors[0]);

    return {
        avgRating,
        topQuartileAvg,
        avgReviews,
        totalReviews,
        aboveAvg,
        belowAvg: rated.length - aboveAvg,
        marketLeader: leader?.name,
        marketLeaderRating: leader?.rating,
        totalCompetitors: competitors.length
    };
}

/**
 * Generate AI executive summary using Gemini
 */
async function generateAIExecutiveSummary(city, industry, competitors, leads, news) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const topCompetitors = competitors.slice(0, 5)
            .map(c => `${c.name} (${c.rating}\u2605, ${c.reviewCount || c.reviews || 0} reviews)`)
            .join(', ');

        const avgRating = competitors.length
            ? (competitors.reduce((sum, c) => sum + (c.rating || 0), 0) / competitors.length).toFixed(1)
            : 'N/A';

        const highOppCount = leads.filter(l => l.opportunityScore > 70).length;

        const prompt = `You are a business intelligence analyst. Write a 3-paragraph executive summary of the ${industry} market in ${city}.

Data:
- ${competitors.length} competitors analyzed
- Average rating: ${avgRating}\u2605
- Top businesses: ${topCompetitors}
- High opportunity leads: ${highOppCount} of ${leads.length}
- Recent news themes: ${news.slice(0, 3).map(n => n.title).join('; ')}

Write:
Paragraph 1: Market overview \u2014 size, competition level, average quality
Paragraph 2: Key opportunities \u2014 where gaps exist, which businesses are underperforming
Paragraph 3: Strategic recommendation \u2014 what a sales rep should prioritize in this market

Tone: Professional, data-driven, actionable.
Length: 150-200 words total.
Do not use bullet points. Prose only.`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.warn('[MarketIntel] AI Summary failed:', e.message);
        return null;
    }
}

/**
 * Generate AI competitor analysis using Gemini
 */
async function generateCompetitorAnalysis(city, industry, competitors, benchmarks) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const topFive = competitors.slice(0, 5)
            .map(c => `${c.name}: ${c.rating}\u2605, ${c.reviewCount || c.reviews || 0} reviews`)
            .join('; ');

        const prompt = `You are a competitive intelligence analyst. Write exactly 2 paragraphs analyzing the ${industry} market in ${city}.

Market data:
- ${competitors.length} competitors analyzed
- Market average rating: ${benchmarks.avgRating}\u2605
- Top quartile average: ${benchmarks.topQuartileAvg}\u2605
- Market leader: ${benchmarks.marketLeader} at ${benchmarks.marketLeaderRating}\u2605
- Average reviews per business: ${benchmarks.avgReviews}
- Top 5 businesses: ${topFive}

Paragraph 1: Compare competitors on product offerings, customer engagement (review volume and rating), and market position. Identify the top performers and what distinguishes them.

Paragraph 2: Identify the biggest market opportunity \u2014 where are the gaps? Which segment is underserved? What should a business do to capture market share?

Rules:
- Be specific with the data, name actual businesses
- Keep to exactly 2 paragraphs, 80-100 words each
- Professional and actionable tone
- No bullet points`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.warn('[MarketIntel] Competitor Analysis failed:', e.message);
        return null;
    }
}

/**
 * Generate SWOT analysis using Gemini
 */
async function generateSWOT(city, industry, competitors, benchmarks, leads, trends) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const top10 = competitors.slice(0, 10)
            .map(c => `${c.name}: ${c.rating || 'N/A'}\u2605, ${c.reviewCount || 0} reviews`)
            .join('; ');

        const highOpp = leads.filter(l => l.opportunityScore > 70).length;

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a strategic business analyst. Generate a SWOT analysis for the ${industry} market in ${city} based on competitive data.

Market data:
- Top 10 competitors: ${top10}
- Market average rating: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader} (${benchmarks?.marketLeaderRating}\u2605)
- High opportunity leads: ${highOpp} of ${leads.length}
- New openings detected: ${trends?.newOpenings?.length || 0}
- Hiring signals: ${trends?.hiringSignals?.length || 0}

Generate a JSON object with exactly these fields:
{
  "strengths": ["market strength 1 with specific data", "market strength 2", "market strength 3"],
  "weaknesses": ["market weakness 1 specific to this market", "market weakness 2", "market weakness 3"],
  "opportunities": ["specific opportunity for PathSynch sales", "opportunity 2 with data", "opportunity 3"],
  "threats": ["market threat 1", "threat 2", "threat 3"],
  "summaryInsight": "one sentence strategic insight for a sales rep entering this market"
}

Rules:
- Be specific, reference actual data and business names where relevant
- Opportunities should be framed as sales opportunities for PathSynch
- Keep each point to 15 words max
- Output ONLY valid JSON. Start with {`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] SWOT failed:', e.message);
        return null;
    }
}

/**
 * Calculate SEO Landscape — score competitors on online presence signals
 */
function calculateSEOLandscape(competitors) {
    try {
        const scored = competitors.slice(0, 10).map(c => {
            let score = 0;
            const signals = [];

            // Rating signal (review quality)
            if (c.rating >= 4.5) { score += 25; signals.push('High rating'); }
            else if (c.rating >= 4.0) { score += 15; signals.push('Good rating'); }
            else if (c.rating) { score += 5; }

            // Review count (content velocity)
            if (c.reviewCount >= 500) { score += 25; signals.push('High review volume'); }
            else if (c.reviewCount >= 100) { score += 18; signals.push('Active reviews'); }
            else if (c.reviewCount >= 20) { score += 10; }
            else { signals.push('Low review volume'); }

            // Has website
            if (c.website) { score += 20; signals.push('Has website'); }
            else { signals.push('No website'); }

            // Has phone (GBP completeness proxy)
            if (c.phone) { score += 10; signals.push('GBP complete'); }

            // Has address
            if (c.address) score += 10;

            // Review response proxy (high rating + many reviews = likely responds)
            if (c.rating >= 4.3 && c.reviewCount >= 50) {
                score += 10;
                signals.push('Likely review responder');
            }

            const tier = score >= 70 ? 'strong' : score >= 45 ? 'moderate' : 'weak';

            return {
                name: c.name || null,
                address: c.address || null,
                rating: c.rating || null,
                reviewCount: c.reviewCount || null,
                website: c.website || null,
                phone: c.phone || null,
                seoScore: Math.min(100, score),
                tier,
                signals,
                opportunity: tier === 'weak'
                    ? 'High opportunity — weak online presence'
                    : tier === 'moderate'
                    ? 'Medium opportunity — room to improve'
                    : 'Low opportunity — strong online presence'
            };
        }).sort((a, b) => b.seoScore - a.seoScore);

        const avgSEO = Math.round(scored.reduce((s, c) => s + c.seoScore, 0) / scored.length);
        const strongCount = scored.filter(c => c.tier === 'strong').length;
        const weakCount = scored.filter(c => c.tier === 'weak').length;

        return {
            competitors: scored,
            avgSEOScore: avgSEO,
            strongCount,
            weakCount,
            marketInsight: weakCount > 5
                ? `${weakCount} of ${scored.length} competitors have weak online presence — significant PathSynch opportunity`
                : `${strongCount} strong competitors — focus on differentiating on response time and review quality`
        };
    } catch (e) {
        console.warn('[MarketIntel] SEO landscape failed:', e.message);
        return null;
    }
}

/**
 * Generate AI sales intelligence using Gemini
 */
async function generateSalesIntel(city, industry, competitors, leads, trends, benchmarks, news) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const topLeads = leads.slice(0, 3).map(l =>
            `${l.name} (${l.rating || 'N/A'}\u2605, ${l.reviewCount || 0} reviews, score: ${l.opportunityScore})`
        ).join('; ');

        const newsThemes = (news || []).slice(0, 5).map(n => n.title).join('; ');

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a sales intelligence analyst for PathSynch, a local business reputation platform. Generate sales intelligence for a rep selling PathSynch to ${industry} businesses in ${city}.

Market data:
- Market average rating: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader}
- Top opportunity leads: ${topLeads}
- Recent market news: ${newsThemes}
- New openings detected: ${trends?.newOpenings?.length || 0}

Generate a JSON object with exactly these fields:
{
  "topPainPoints": [
    "specific pain point 1 for this market",
    "specific pain point 2",
    "specific pain point 3"
  ],
  "objectionResponses": [
    {
      "objection": "they will say this",
      "response": "you say this with specific data"
    },
    {
      "objection": "second common objection",
      "response": "your data-backed response"
    }
  ],
  "entryWedge": "single best opening line for cold outreach referencing the ${benchmarks?.avgRating}\u2605 market average",
  "bestTimeToCall": "specific recommendation based on ${industry} business patterns",
  "competitorVulnerability": "name one specific competitor and their key weakness",
  "talkingPoints": [
    "data-backed talking point 1",
    "data-backed talking point 2",
    "data-backed talking point 3"
  ]
}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] Sales intel failed:', e.message);
        return null;
    }
}

/**
 * Generate AI recommendations using Gemini
 */
async function generateRecommendations(city, industry, leads, benchmarks, salesIntel, trends) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const top5 = leads.slice(0, 5).map((l, i) =>
            `${i + 1}. ${l.name}: ${l.rating || 'N/A'}\u2605, ${l.reviewCount || 0} reviews, score: ${l.opportunityScore}/100${l.ownerName ? ', Owner: ' + l.ownerName : ''}`
        ).join('\n');

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a sales strategy advisor for PathSynch. Create a prioritized action plan for a sales rep targeting ${industry} businesses in ${city}.

Top leads:
${top5}

Context:
- Market average: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader}
- Entry wedge: ${salesIntel?.entryWedge || 'not available'}
- Market trend: ${(trends?.newOpenings?.length || 0) > 2 ? 'growing' : 'stable'}

Generate a JSON object with exactly these fields:
{
  "priorityActions": [
    {
      "rank": 1,
      "action": "specific action to take",
      "businessName": "name from leads",
      "reason": "why this is #1 priority",
      "openingLine": "exact words to say or write",
      "timing": "when to reach out"
    },
    { "rank": 2, "action": "...", "businessName": "...", "reason": "...", "openingLine": "...", "timing": "..." },
    { "rank": 3, "action": "...", "businessName": "...", "reason": "...", "openingLine": "...", "timing": "..." }
  ],
  "weeklyGoal": "specific measurable goal for this market this week",
  "sequenceRecommendation": "which Instantly.ai sequence type to use for this vertical",
  "expectedOutcome": "realistic 30-day outcome with data basis",
  "quickWin": "single fastest path to a demo booking in this market"
}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] Recommendations failed:', e.message);
        return null;
    }
}

/**
 * Generate a new market intelligence report
 */
async function generateReport(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        // Check if user has market reports feature
        const plan = await getUserPlan(userId);

        if (!hasFeature(plan, 'marketReports')) {
            return res.status(403).json({
                success: false,
                error: 'Feature not available',
                message: 'Market intelligence reports are available on Growth and Scale plans.',
                currentPlan: plan
            });
        }

        // Check usage limits
        const usage = await getUserUsage(userId);
        const limits = getPlanLimits(plan);

        if (usage.marketReportsThisMonth >= limits.marketReportsPerMonth) {
            return res.status(429).json({
                success: false,
                error: 'Usage limit reached',
                message: `You've used all ${limits.marketReportsPerMonth} market reports for this month. Limit resets next month.`,
                usage: {
                    current: usage.marketReportsThisMonth,
                    limit: limits.marketReportsPerMonth
                }
            });
        }

        // Get request data
        const { city, state, zipCode, industry, subIndustry, pitchId, radius: requestedRadius, companySize = 'small' } = req.body;

        // Validate company size
        const validCompanySizes = ['small', 'medium', 'large', 'national'];
        const normalizedCompanySize = validCompanySizes.includes(companySize?.toLowerCase())
            ? companySize.toLowerCase()
            : 'small';

        // Dynamic radius scaling based on company size
        // If user explicitly provides radius, use it; otherwise scale based on company size
        const companySizeRadiusMap = {
            'small': 5000,      // 5km (~3 miles) - local businesses
            'medium': 25000,    // 25km (~15 miles) - regional businesses
            'large': 100000,    // 100km (~62 miles) - multi-location businesses
            'national': 250000  // 250km (~155 miles) - national/enterprise HQs
        };
        const radius = requestedRadius || companySizeRadiusMap[normalizedCompanySize] || 5000;

        if (!industry) {
            return res.status(400).json({
                success: false,
                error: 'Industry is required'
            });
        }

        if (!city && !state && !zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Location is required (city/state or zip code)'
            });
        }

        // Convert industry to NAICS code
        const naicsCodes = naics.getNaicsByDisplay(subIndustry || industry);
        const naicsCode = naicsCodes[0] || '722511'; // Default to restaurants
        const industryDetails = naics.getNaicsDetails(naicsCode);

        // Determine data source type for this industry
        const dataSourceType = naics.getDataSourceType(naicsCode);
        const supportsPlaces = naics.supportsCompetitorDiscovery(naicsCode);

        // Get geography (place/county/state FIPS)
        const geo = geography.getCensusGeography(city, state, zipCode);

        // Build location string for Google Places
        const locationString = zipCode
            ? zipCode
            : `${city || ''}, ${state || ''}`.trim().replace(/^,\s*|,\s*$/g, '');

        // Determine user's tier for response building
        const planDetails = PLANS[plan] || PLANS.starter;
        const tier = plan === 'scale' ? 'scale' : plan === 'growth' ? 'growth' : 'starter';
        const marketFeatures = planDetails.limits?.marketFeatures || {};

        // Get custom industry name if "Other" category
        const { customIndustryName } = req.body;
        const displayIndustryName = naicsCode === '999999' && customIndustryName
            ? customIndustryName
            : industry;

        // Parallel data fetch (existing + Serper enrichment)
        const [competitorResult, demographicResult, establishmentResult, demandSignalsResult, serperCompetitorsResult, serperNewsResult] = await Promise.allSettled([
            // Competitors: route through fetchCompetitors helper
            fetchCompetitors({
                dataSourceType,
                supportsPlaces,
                industryDetails,
                locationString,
                radius,
                naicsCode,
                city,
                state,
                industry: displayIndustryName,
                companySize: normalizedCompanySize
            }),
            // Demographics - try place level first, then county, then state
            fetchDemographicsWithFallback(geo),
            // CBP establishment data (if Growth+ tier)
            tier !== 'starter' && geo.countyFips
                ? cbp.getEstablishmentCount(naicsCode, geo.countyFips, geo.stateFips)
                : Promise.resolve(null),
            // Demand signals with company size-based seasonality
            googleTrends.getDemandSignals(naicsCode, state, city, normalizedCompanySize),
            // Serper: scored leads via Places search
            serperClient.searchCompetitors(displayIndustryName, locationString, 20),
            // Serper: industry news signals
            serperClient.searchBusinessNews('', locationString, displayIndustryName)
        ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

        const demandSignals = demandSignalsResult?.data || null;

        // Serper enrichment: scored leads + news signals
        const serperCompetitors = serperCompetitorsResult || [];
        const newsSignals = serperNewsResult || [];
        let serperLeads = serperClient.buildLeads(serperCompetitors, displayIndustryName, locationString);
        console.log(`[MarketIntel] Serper: ${serperLeads.length} leads, ${newsSignals.length} news signals`);

        // Enrich top 5 leads with owner/founder data via Serper
        const TOP_TO_ENRICH = 5;
        if (serperLeads.length > 0) {
            try {
                const enrichedResults = await Promise.allSettled(
                    serperLeads.slice(0, TOP_TO_ENRICH).map(async lead => {
                        const ownerData = await serperClient.enrichLeadOwner(lead.name, city || '');
                        return { ...lead, ...ownerData };
                    })
                );

                serperLeads = serperLeads.map((lead, i) => {
                    if (i < TOP_TO_ENRICH && enrichedResults[i]?.status === 'fulfilled') {
                        return enrichedResults[i].value;
                    }
                    return lead;
                });

                console.log('[MarketIntel] Owner enrichment done for top', TOP_TO_ENRICH, 'leads');
            } catch (ownerError) {
                console.warn('[MarketIntel] Owner enrichment failed:', ownerError.message);
            }
        }

        let competitors = competitorResult.competitors || [];
        const competitorSource = competitorResult.source || (supportsPlaces ? 'google_places' : 'manual');
        const demographics = demographicResult?.data || {};

        // For enterprise searches (large/national), enrich competitors with SEC EDGAR data
        // This adds financial data for public company competitors
        const isEnterpriseSearch = normalizedCompanySize === 'large' || normalizedCompanySize === 'national';
        let secEnrichedCount = 0;

        if (isEnterpriseSearch && competitors.length > 0 && (tier === 'growth' || tier === 'scale')) {
            try {
                competitors = await secEdgar.enrichCompetitorsWithSec(competitors, 5);
                secEnrichedCount = competitors.filter(c => c.secData).length;
                console.log(`SEC enrichment: ${secEnrichedCount} of ${competitors.length} competitors enriched`);
            } catch (secError) {
                console.warn('SEC enrichment failed:', secError.message);
                // Continue without SEC data
            }
        }

        // Enrich competitors with website data from Google Places Details API
        // This enables "Create Pitch" to auto-populate the prospect website field
        if (competitors.length > 0 && competitorSource === 'google_places') {
            try {
                competitors = await googlePlaces.enrichCompetitorsWithWebsites(competitors, 10);
                const websiteEnrichedCount = competitors.filter(c => c.website).length;
                console.log(`Website enrichment: ${websiteEnrichedCount} of ${competitors.length} competitors have websites`);
            } catch (websiteError) {
                console.warn('Website enrichment failed:', websiteError.message);
                // Continue without website data
            }
        }

        // USPTO Patent Data Enrichment (Growth+ tiers)
        // NOTE: Disabled as of Feb 2026 - PatentsView Legacy API discontinued May 2025
        // New PatentSearch API requires registration at https://search.patentsview.org
        // TODO: Register for new API and re-enable this feature
        let patentEnrichedCount = 0;
        /*
        if (competitors.length > 0 && (tier === 'growth' || tier === 'scale')) {
            try {
                competitors = await uspto.enrichCompetitorsWithPatents(competitors, 5);
                patentEnrichedCount = competitors.filter(c => c.patentData?.found).length;
                console.log(`USPTO enrichment: ${patentEnrichedCount} of ${competitors.length} competitors enriched with patent data`);
            } catch (patentError) {
                console.warn('USPTO enrichment failed:', patentError.message);
                // Continue without patent data
            }
        }
        */

        // Calculate enhanced metrics using new marketMetrics service
        const saturation = marketMetrics.calculateSaturationScore(
            competitors,
            demographics,
            naicsCode,
            radius
        );

        const marketSize = marketMetrics.calculateMarketSize(
            demographics,
            naicsCode,
            competitors
        );

        // Fetch additional data for Growth+ tiers
        let ageDistribution = null;
        let educationProfile = null;
        let commutePatterns = null;
        let establishmentTrend = null;
        let growthRate = null;
        let opportunityScore = null;
        let recommendations = null;

        if (tier === 'growth' || tier === 'scale') {
            // Fetch detailed demographics in parallel
            const [ageData, eduData, commuteData, trendData] = await Promise.all([
                census.getAgeDistribution(geo),
                census.getEducationProfile(geo),
                census.getCommutePatterns(geo),
                geo.countyFips
                    ? cbp.getEstablishmentTrend(naicsCode, geo.countyFips, geo.stateFips)
                    : Promise.resolve(null)
            ]);

            ageDistribution = ageData;
            educationProfile = eduData;
            commutePatterns = commuteData;
            establishmentTrend = trendData;

            // Calculate growth rate with CBP trend data and demand signals
            growthRate = marketMetrics.calculateGrowthRate(
                establishmentTrend,
                demandSignals, // demandSignals with company size seasonality
                demographics,
                naicsCode
            );

            // Calculate opportunity score with demand signals
            opportunityScore = marketMetrics.calculateOpportunityScore(
                saturation,
                growthRate,
                demographics,
                demandSignals, // demandSignals with company size seasonality
                competitors,
                naicsCode
            );

            // Generate recommendations
            recommendations = marketMetrics.generateRecommendations({
                demographics,
                saturation,
                opportunity: opportunityScore,
                competitors,
                ageDistribution,
                educationProfile,
                commutePatterns,
                naicsCode
            });
        } else {
            // Basic growth rate for starter tier
            growthRate = census.estimateGrowthRate(industry, demographics);
        }

        // Create report document
        const reportRef = db.collection('marketReports').doc();
        const reportData = {
            id: reportRef.id,
            userId: userId,
            pitchId: pitchId || null,
            tier: tier,
            location: {
                city: city || null,
                state: state || null,
                zipCode: zipCode || null,
                coordinates: competitorResult.coordinates || null,
                geoLevel: geo.geoLevel
            },
            industry: {
                display: displayIndustryName,
                subIndustry: subIndustry || null,
                naicsCode: naicsCode,
                naicsTitle: industryDetails?.title || displayIndustryName,
                avgTransaction: industryDetails?.avgTransaction || naics.getAvgTransaction(naicsCode),
                monthlyCustomers: industryDetails?.monthlyCustomers || naics.getMonthlyCustomers(naicsCode),
                dataSourceType: dataSourceType,
                customName: customIndustryName || null
            },
            // Sales intelligence for this industry/sub-industry
            salesIntelligence: getIndustryIntelligence(industry, subIndustry),
            companySize: {
                size: normalizedCompanySize,
                label: demandSignals?.companySize?.label || googleTrends.getCompanySizeConfig(normalizedCompanySize).label,
                marketReach: demandSignals?.companySize?.marketReach || 'local',
                planningHorizon: demandSignals?.companySize?.planningHorizon || '1-3 months'
            },
            radius: radius,
            data: {
                // Data source metadata
                dataSource: {
                    type: dataSourceType,
                    provider: competitorSource,
                    competitorDiscovery: competitorSource === 'coresignal'
                        ? 'automatic_b2b'
                        : supportsPlaces ? 'automatic' : 'manual',
                    note: competitorSource === 'coresignal'
                        ? 'Competitor data sourced from CoreSignal B2B database.'
                        : !supportsPlaces
                            ? 'This industry requires manual competitor research. Use industry reports, LinkedIn, or other sources to identify competitors.'
                            : dataSourceType === 'limited'
                                ? 'Limited competitor data available. Results may not be comprehensive.'
                                : null
                },

                // Competitors (all tiers)
                competitors: competitors.slice(0, 20).map(c => ({
                    name: c.name,
                    address: c.address,
                    rating: c.rating,
                    reviews: c.reviewCount || c.reviews,
                    location: c.location || null,
                    priceLevel: c.priceLevel || null,
                    isHeadquarters: c.isHeadquarters || false,
                    // Website: prefer Google Places data, fallback to SEC data for public companies
                    website: c.website || c.secData?.website || null,
                    ...(c.coresignalId && { coresignalId: c.coresignalId }),
                    ...(c.firmographics && { firmographics: c.firmographics }),
                    // SEC EDGAR data for public companies (Growth+ tiers, enterprise searches)
                    ...(c.secData && {
                        secData: {
                            isPublic: true,
                            ticker: c.secData.ticker || null,
                            website: c.secData.website || null,
                            revenue: c.secData.revenue || null,
                            revenueGrowth: c.secData.revenueGrowth || null,
                            netMargin: c.secData.netMargin || null,
                            employees: c.secData.employees || null,
                            latestFilingDate: c.secData.latestFilingDate || null,
                            secUrl: c.secData.secUrl || null
                        }
                    }),
                    // USPTO Patent data (Growth+ tiers)
                    ...(c.patentData?.found && {
                        patentData: {
                            totalPatents: c.patentData.totalPatents || 0,
                            recentPatentCount: c.patentData.recentPatentCount || 0,
                            firstPatentDate: c.patentData.firstPatentDate || null,
                            lastPatentDate: c.patentData.lastPatentDate || null,
                            innovationSignal: c.patentData.innovationSignal || 'low',
                            recentPatents: (c.patentData.recentPatents || []).slice(0, 3)
                        }
                    })
                })),
                competitorCount: competitors.length,
                publicCompanyCount: secEnrichedCount,
                competitorDataAvailable: (supportsPlaces || competitorSource === 'coresignal') && competitors.length > 0,

                // Basic demographics (all tiers)
                demographics: {
                    population: demographics.population || null,
                    medianIncome: demographics.medianIncome || null,
                    households: demographics.households || null,
                    homeOwnershipRate: demographics.homeOwnershipRate || null,
                    geoLevel: geo.geoLevel
                },

                // Market metrics (all tiers)
                marketSize: marketSize.totalAddressableMarket,
                marketPerBusiness: marketSize.marketPerBusiness,
                saturation: saturation.level,
                saturationScore: saturation.score,
                saturationComponents: saturation.components,
                growthRate: growthRate.annualGrowthRate || growthRate.annualGrowthRate,

                // Seasonality data (all tiers)
                seasonality: {
                    pattern: demandSignals?.seasonality?.pattern || 'stable',
                    isInPeakSeason: demandSignals?.seasonality?.isInPeakSeason || false,
                    peakMonths: demandSignals?.seasonality?.peakMonths || [],
                    impactScore: demandSignals?.seasonality?.impactScore || 50,
                    sensitivity: demandSignals?.seasonality?.sensitivity || 1.0
                },
                demandSignals: {
                    currentInterest: demandSignals?.currentInterest || 50,
                    yoyChange: demandSignals?.yoyChange || 0,
                    trendDirection: demandSignals?.trendDirection || 'stable',
                    momentumScore: demandSignals?.momentumScore || 50,
                    recommendations: demandSignals?.recommendations || null
                },

                // Growth+ tier data
                ...(tier !== 'starter' && {
                    opportunityScore: opportunityScore?.score || null,
                    opportunityLevel: opportunityScore?.level || null,
                    opportunityFactors: opportunityScore?.factors || null,
                    opportunityRationale: opportunityScore?.rationale || null,

                    ageDistribution: ageDistribution?.data?.ageGroups || null,
                    educationProfile: educationProfile?.data?.levels || null,
                    bachelorsPlusPct: educationProfile?.data?.bachelorsPlusPct || null,
                    commutePatterns: commutePatterns?.data?.modes || null,
                    walkabilityScore: commutePatterns?.data?.walkabilityScore || null,
                    wfhRate: commutePatterns?.data?.wfhRate || null,

                    establishmentCount: establishmentResult?.data?.establishmentCount || null,
                    establishmentTrend: establishmentTrend?.data?.trendLabel || null,

                    recommendations: recommendations || null,

                    growthComponents: growthRate.components || null,
                    fiveYearProjection: growthRate.fiveYearProjection || null,

                    // Public Company Intelligence (SEC EDGAR) for enterprise searches
                    ...(secEnrichedCount > 0 && {
                        publicCompanyIntelligence: buildPublicCompanyIntelligence(competitors)
                    }),

                    // Patent Intelligence (USPTO) for Growth+ tiers
                    ...(patentEnrichedCount > 0 && {
                        patentIntelligence: uspto.buildPatentIntelligence(competitors, industry)
                    })
                }),

                // Serper enrichment: scored leads + news signals
                leads: serperLeads,
                leadCount: serperLeads.length,
                newsSignals: newsSignals,
                serperEnrichment: {
                    leadSource: 'serper_places',
                    newsSource: 'serper_news',
                    enrichedAt: new Date().toISOString()
                }
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Calculate market benchmarks
        const benchmarks = calculateMarketBenchmarks(competitors);
        reportData.data.benchmarks = benchmarks;

        // Calculate SEO Landscape
        const seoLandscape = calculateSEOLandscape(competitors);
        reportData.data.seoLandscape = seoLandscape;

        // Generate AI executive summary, competitor analysis, demographics, trends, sales intel, SWOT in parallel
        const [aiSummary, aiCompetitorAnalysis, demographicsCommunities, marketTrends, salesIntelResult, swotResult] = await Promise.allSettled([
            generateAIExecutiveSummary(
                city || zipCode || '', displayIndustryName,
                competitors, serperLeads, newsSignals
            ),
            benchmarks
                ? generateCompetitorAnalysis(city || zipCode || '', displayIndustryName, competitors, benchmarks)
                : Promise.resolve(null),
            serperClient.searchFastestGrowingCommunities(city || '', state || '', displayIndustryName),
            serperClient.searchMarketTrends(city || '', state || '', displayIndustryName),
            generateSalesIntel(city || '', displayIndustryName, competitors, serperLeads, null, benchmarks, newsSignals),
            benchmarks
                ? generateSWOT(city || '', displayIndustryName, competitors, benchmarks, serperLeads, null)
                : Promise.resolve(null)
        ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

        // Generate recommendations (depends on salesIntel result)
        let aiRecommendations = null;
        try {
            aiRecommendations = await generateRecommendations(
                city || '', displayIndustryName, serperLeads,
                benchmarks, salesIntelResult, marketTrends
            );
        } catch (recErr) {
            console.warn('[MarketIntel] Recommendations generation failed:', recErr.message);
        }

        // Attach enrichment data to reportData
        reportData.data.demographicsCommunities = demographicsCommunities || null;
        reportData.data.trends = marketTrends || null;
        reportData.data.salesIntel = salesIntelResult || null;
        reportData.data.aiRecommendations = aiRecommendations || null;
        reportData.data.swotAnalysis = swotResult || null;

        // Fallback to static summary if AI fails
        reportData.executiveSummary = aiSummary || marketMetrics.generateExecutiveSummary({
            location: reportData.location,
            industry: reportData.industry,
            competitors: competitors,
            demographics: demographics,
            saturation: saturation,
            marketSize: marketSize,
            growthRate: growthRate,
            opportunityScore: opportunityScore,
            companySize: normalizedCompanySize
        });

        reportData.data.competitorAnalysis = aiCompetitorAnalysis || null;

        await reportRef.set(reportData);

        // Save custom sub-industry if provided (for future dropdown population)
        if (subIndustry) {
            await saveCustomSubIndustryInternal(userId, industry, subIndustry);
        }

        // Update usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        await db.collection('usage').doc(usageId).set({
            marketReportsThisMonth: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Auto-save enriched report to Library
        let libraryItemId = null;
        try {
            const libraryItem = {
                type: 'intel',
                subType: 'market',
                title: `${city || zipCode || ''} \u2014 ${displayIndustryName}`,
                industry: (displayIndustryName || '').toLowerCase().trim(),
                city: extractCity(city || zipCode),
                state: (state || '').toLowerCase(),
                content: JSON.stringify({
                    summary: reportData.executiveSummary || null,
                    benchmarks: benchmarks || null,
                    competitorAnalysis: aiCompetitorAnalysis || null,
                    competitors: competitors.slice(0, 10).map(c => ({
                        name: c.name || null,
                        rating: c.rating || null,
                        reviewCount: c.reviewCount || c.reviews || null,
                        address: c.address || null,
                        website: c.website || null
                    })),
                    leads: serperLeads,
                    newsSignals: newsSignals,
                    demographicsCommunities: demographicsCommunities || null,
                    trends: marketTrends || null,
                    salesIntel: salesIntelResult || null,
                    aiRecommendations: aiRecommendations || null,
                    swotAnalysis: swotResult || null,
                    seoLandscape: seoLandscape || null,
                    generatedAt: new Date().toISOString()
                }),
                reportId: reportRef.id,
                leadCount: serperLeads.length,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                refreshAvailableAt: admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                ),
                userId: userId
            };

            const libraryRef = await db
                .collection('library')
                .doc(userId)
                .collection('items')
                .add(libraryItem);

            libraryItemId = libraryRef.id;
            console.log('[MarketIntel] Auto-saved to Library for', userId, '→', libraryItemId);
        } catch (libError) {
            console.warn('[MarketIntel] Library auto-save failed:', libError.message);
            // Non-critical — don't fail the report
        }

        // Build tiered response
        const response = buildTieredResponse(tier, reportRef.id, reportData);
        response.libraryItemId = libraryItemId;

        return res.status(200).json(response);

    } catch (error) {
        console.error('Error generating market report:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate market report',
            message: error.message
        });
    }
}

/**
 * List user's market reports
 */
async function listReports(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;

        const reportsQuery = db.collection('marketReports')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .offset(offset)
            .limit(limit);

        const snapshot = await reportsQuery.get();

        const reports = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                location: data.location,
                industry: data.industry,
                saturation: data.data?.saturation,
                competitorCount: data.data?.competitorCount,
                marketSize: data.data?.marketSize,
                createdAt: data.createdAt
            };
        });

        return res.status(200).json({
            success: true,
            data: reports
        });

    } catch (error) {
        console.error('Error listing reports:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list reports'
        });
    }
}

/**
 * Get a specific market report
 */
async function getReport(req, res) {
    const userId = req.userId;
    const reportId = req.params.reportId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const reportDoc = await db.collection('marketReports').doc(reportId).get();

        if (!reportDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Report not found'
            });
        }

        const reportData = reportDoc.data();

        // Verify ownership
        if (reportData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: reportDoc.id,
                ...reportData
            }
        });

    } catch (error) {
        console.error('Error getting report:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get report'
        });
    }
}

/**
 * Fetch competitors using the appropriate data source
 *
 * Routing logic:
 *   'places' industries  -> Google Places (unchanged)
 *   'limited' industries -> CoreSignal -> Google Places fallback -> empty
 *   'manual' industries  -> CoreSignal -> empty
 *
 * For large/national company sizes:
 *   - Also searches for corporate headquarters
 *   - Merges results from regular search and HQ search
 *
 * When ENABLE_CORESIGNAL is off, behavior is identical to the existing flow.
 *
 * @param {Object} params
 * @returns {Promise<Object>} { success, competitors, totalFound, source, coordinates? }
 */
async function fetchCompetitors({ dataSourceType, supportsPlaces, industryDetails, locationString, radius, naicsCode, city, state, industry, companySize = 'small' }) {
    const isEnterpriseSearch = companySize === 'large' || companySize === 'national';

    // Helper to merge and deduplicate competitors
    const mergeCompetitors = (primary, secondary) => {
        const seen = new Set(primary.map(c => c.placeId || c.name?.toLowerCase()));
        const merged = [...primary];

        for (const comp of secondary) {
            const key = comp.placeId || comp.name?.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(comp);
            }
        }

        return merged;
    };

    // 'places' industries always go to Google Places
    if (dataSourceType === 'places') {
        if (industryDetails?.placesKeyword) {
            const result = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

            // For enterprise searches, also look for headquarters
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(hqResult.competitors, result.competitors || []);
                    return {
                        ...result,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        source: 'google_places',
                        includesHeadquarters: true
                    };
                }
            }

            return { ...result, source: 'google_places' };
        }
        return { competitors: [], coordinates: null, source: 'google_places' };
    }

    // For 'limited' and 'manual': try CoreSignal first if enabled
    if (coresignalConfig.isEnabled()) {
        const csResult = await coresignal.findCompetitors({
            naicsCode,
            city,
            state,
            industry,
            radius
        });

        if (csResult.success && csResult.competitors.length > 0) {
            // For enterprise, supplement with HQ search
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(csResult.competitors, hqResult.competitors);
                    return {
                        ...csResult,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        includesHeadquarters: true
                    };
                }
            }
            return csResult; // source is already 'coresignal'
        }

        // CoreSignal returned nothing - fall back for 'limited' industries
        if (dataSourceType === 'limited' && industryDetails?.placesKeyword) {
            console.log(`CoreSignal returned no results for ${naicsCode}, falling back to Google Places`);
            const placesResult = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

            // For enterprise, also search for HQs
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(hqResult.competitors, placesResult.competitors || []);
                    return {
                        ...placesResult,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        source: 'google_places',
                        includesHeadquarters: true
                    };
                }
            }

            return { ...placesResult, source: 'google_places' };
        }

        // 'manual' with no CoreSignal results -> try HQ search for enterprise
        if (isEnterpriseSearch) {
            const hqResult = await googlePlaces.findHeadquarters(
                industry,
                locationString,
                radius,
                industryDetails?.headquartersKeywords
            );
            if (hqResult.success && hqResult.competitors.length > 0) {
                return {
                    ...hqResult,
                    source: 'google_places_headquarters',
                    includesHeadquarters: true
                };
            }
        }

        return { competitors: [], coordinates: null, source: 'coresignal', totalFound: 0 };
    }

    // CoreSignal disabled: use existing behavior with HQ search for enterprise
    if (supportsPlaces && industryDetails?.placesKeyword) {
        const result = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

        // For enterprise, supplement with HQ search
        if (isEnterpriseSearch) {
            const hqResult = await googlePlaces.findHeadquarters(
                industry,
                locationString,
                radius,
                industryDetails?.headquartersKeywords
            );
            if (hqResult.success && hqResult.competitors.length > 0) {
                const merged = mergeCompetitors(hqResult.competitors, result.competitors || []);
                return {
                    ...result,
                    competitors: merged.slice(0, 30),
                    totalFound: merged.length,
                    source: 'google_places',
                    includesHeadquarters: true
                };
            }
        }

        return { ...result, source: 'google_places' };
    }

    // Manual industry, CoreSignal disabled -> still try HQ search for enterprise
    if (isEnterpriseSearch) {
        const hqResult = await googlePlaces.findHeadquarters(
            industry,
            locationString,
            radius,
            industryDetails?.headquartersKeywords
        );
        if (hqResult.success && hqResult.competitors.length > 0) {
            return {
                ...hqResult,
                source: 'google_places_headquarters',
                includesHeadquarters: true
            };
        }
    }

    return { competitors: [], coordinates: null, source: 'manual' };
}

/**
 * Fetch demographics with place -> county -> state fallback
 */
async function fetchDemographicsWithFallback(geo) {
    // Try place level first
    if (geo.placeFips) {
        const placeResult = await census.getDemographicsAtPlace(geo.placeFips, geo.stateFips);
        if (placeResult?.success) {
            return placeResult;
        }
    }

    // Try county level
    if (geo.countyFips) {
        const countyResult = await census.getDemographicsAtCounty(geo.countyFips, geo.stateFips);
        if (countyResult?.success) {
            return countyResult;
        }
    }

    // Fall back to state level
    return await census.getDemographics(geo.stateFips);
}

/**
 * Build aggregated public company intelligence summary from SEC-enriched competitors
 */
function buildPublicCompanyIntelligence(competitors) {
    const publicCompanies = competitors.filter(c => c.secData?.isPublic);

    if (publicCompanies.length === 0) {
        return null;
    }

    // Aggregate financial metrics
    const revenues = publicCompanies
        .filter(c => c.secData.revenueRaw)
        .map(c => ({ name: c.name, ticker: c.secData.ticker, value: c.secData.revenueRaw }));

    const totalMarketRevenue = revenues.reduce((sum, r) => sum + r.value, 0);

    const growthRates = publicCompanies
        .filter(c => c.secData.revenueGrowthRaw !== null && c.secData.revenueGrowthRaw !== undefined)
        .map(c => c.secData.revenueGrowthRaw);

    const avgGrowthRate = growthRates.length > 0
        ? growthRates.reduce((sum, r) => sum + r, 0) / growthRates.length
        : null;

    const margins = publicCompanies
        .filter(c => c.secData.netMargin)
        .map(c => parseFloat(c.secData.netMargin));

    const avgNetMargin = margins.length > 0
        ? margins.reduce((sum, m) => sum + m, 0) / margins.length
        : null;

    const employeeCounts = publicCompanies
        .filter(c => c.secData.employeesRaw)
        .map(c => ({ name: c.name, ticker: c.secData.ticker, employees: c.secData.employeesRaw }));

    const totalEmployees = employeeCounts.reduce((sum, e) => sum + e.employees, 0);

    // Find market leader (by revenue)
    const marketLeader = revenues.length > 0
        ? revenues.sort((a, b) => b.value - a.value)[0]
        : null;

    // Find fastest growing
    const fastestGrowing = publicCompanies
        .filter(c => c.secData.revenueGrowthRaw !== null)
        .sort((a, b) => (b.secData.revenueGrowthRaw || 0) - (a.secData.revenueGrowthRaw || 0))[0];

    return {
        publicCompanyCount: publicCompanies.length,
        summary: {
            totalMarketRevenue: totalMarketRevenue > 0 ? secEdgar.formatFinancialValue(totalMarketRevenue) : null,
            totalMarketRevenueRaw: totalMarketRevenue || null,
            averageGrowthRate: avgGrowthRate !== null ? `${avgGrowthRate > 0 ? '+' : ''}${avgGrowthRate.toFixed(1)}%` : null,
            averageNetMargin: avgNetMargin !== null ? `${avgNetMargin.toFixed(1)}%` : null,
            totalEmployees: totalEmployees > 0 ? totalEmployees.toLocaleString() : null,
            totalEmployeesRaw: totalEmployees || null
        },
        marketLeader: marketLeader ? {
            name: marketLeader.name || null,
            ticker: marketLeader.ticker || null,
            revenue: secEdgar.formatFinancialValue(marketLeader.value) || null
        } : null,
        fastestGrowing: fastestGrowing ? {
            name: fastestGrowing.name || null,
            ticker: fastestGrowing.secData?.ticker || null,
            growthRate: fastestGrowing.secData?.revenueGrowth || null
        } : null,
        companies: publicCompanies.map(c => ({
            name: c.name || null,
            ticker: c.secData?.ticker || null,
            revenue: c.secData?.revenue || null,
            revenueGrowth: c.secData?.revenueGrowth || null,
            netMargin: c.secData?.netMargin || null,
            employees: c.secData?.employees || null,
            secUrl: c.secData?.secUrl || null
        }))
    };
}

/**
 * Build tier-appropriate response
 */
function buildTieredResponse(tier, reportId, reportData) {
    const baseResponse = {
        success: true,
        reportId: reportId,
        tier: tier,
        location: reportData.location,
        industry: reportData.industry,
        salesIntelligence: reportData.salesIntelligence,
        companySize: reportData.companySize,
        executiveSummary: reportData.executiveSummary || null
    };

    // Starter tier - basic data only
    if (tier === 'starter') {
        return {
            ...baseResponse,
            data: {
                competitors: reportData.data.competitors,
                competitorCount: reportData.data.competitorCount,
                demographics: reportData.data.demographics,
                marketSize: reportData.data.marketSize,
                marketPerBusiness: reportData.data.marketPerBusiness,
                saturation: reportData.data.saturation,
                saturationScore: reportData.data.saturationScore,
                growthRate: reportData.data.growthRate,
                leads: reportData.data.leads,
                leadCount: reportData.data.leadCount,
                newsSignals: reportData.data.newsSignals,
                serperEnrichment: reportData.data.serperEnrichment
            },
            upgradePrompt: {
                message: 'Unlock opportunity scores, detailed demographics, trends, and recommendations',
                features: ['Opportunity Score', 'Age & Education Demographics', 'Business Trends', 'AI Recommendations'],
                cta: 'Upgrade to Growth'
            }
        };
    }

    // Growth tier - full data except PDF export
    if (tier === 'growth') {
        return {
            ...baseResponse,
            data: reportData.data,
            upgradePrompt: {
                message: 'Unlock PDF export and pitch integration',
                features: ['PDF Report Export', 'Pitch Deck Integration'],
                cta: 'Upgrade to Scale'
            }
        };
    }

    // Scale tier - everything
    return {
        ...baseResponse,
        data: reportData.data,
        features: {
            pdfExport: true,
            pitchIntegration: true
        }
    };
}

/**
 * Get available industries for dropdown
 * Includes metadata about data source availability for each industry
 */
async function getIndustries(req, res) {
    try {
        const industriesWithMetadata = naics.getIndustriesForDropdown();

        return res.status(200).json({
            success: true,
            data: industriesWithMetadata
        });
    } catch (error) {
        console.error('Error getting industries:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get industries'
        });
    }
}

/**
 * Get company size options for dropdown
 */
async function getCompanySizes(req, res) {
    try {
        const sizes = googleTrends.getCompanySizeOptions();

        return res.status(200).json({
            success: true,
            data: sizes
        });
    } catch (error) {
        console.error('Error getting company sizes:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get company sizes'
        });
    }
}

/**
 * Get user's custom sub-industries
 * These are sub-industries the user has created through market reports
 */
async function getCustomSubIndustries(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const customSubIndustriesDoc = await db.collection('customSubIndustries').doc(userId).get();

        if (!customSubIndustriesDoc.exists) {
            return res.status(200).json({
                success: true,
                data: {}
            });
        }

        return res.status(200).json({
            success: true,
            data: customSubIndustriesDoc.data().industries || {}
        });
    } catch (error) {
        console.error('Error getting custom sub-industries:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get custom sub-industries'
        });
    }
}

/**
 * Save a custom sub-industry for a user
 * Called automatically when generating a market report with a new sub-industry
 */
async function saveCustomSubIndustry(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const { industry, subIndustry } = req.body;

        if (!industry || !subIndustry) {
            return res.status(400).json({
                success: false,
                error: 'Industry and subIndustry are required'
            });
        }

        // Get or create the user's custom sub-industries document
        const docRef = db.collection('customSubIndustries').doc(userId);

        // Add the new sub-industry to the appropriate industry category
        await docRef.set({
            industries: {
                [industry]: admin.firestore.FieldValue.arrayUnion({
                    value: subIndustry,
                    label: subIndustry,
                    createdAt: new Date().toISOString()
                })
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
            success: true,
            message: 'Custom sub-industry saved'
        });
    } catch (error) {
        console.error('Error saving custom sub-industry:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to save custom sub-industry'
        });
    }
}

/**
 * Internal helper to save custom sub-industry (called from generateReport)
 */
async function saveCustomSubIndustryInternal(userId, industry, subIndustry) {
    if (!userId || !industry || !subIndustry) return;

    try {
        // Check if this sub-industry already exists in the built-in list
        const builtInSubcategories = naics.getSubcategories(industry);
        const isBuiltIn = builtInSubcategories.some(
            sub => sub.name.toLowerCase() === subIndustry.toLowerCase()
        );

        if (isBuiltIn) return; // Don't save built-in sub-industries

        // Save to user's custom sub-industries
        const docRef = db.collection('customSubIndustries').doc(userId);
        await docRef.set({
            industries: {
                [industry]: admin.firestore.FieldValue.arrayUnion({
                    value: subIndustry,
                    label: subIndustry,
                    createdAt: new Date().toISOString()
                })
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Saved custom sub-industry "${subIndustry}" for industry "${industry}" for user ${userId}`);
    } catch (error) {
        console.error('Error saving custom sub-industry internally:', error);
        // Don't throw - this is a non-critical operation
    }
}

module.exports = {
    generateReport,
    listReports,
    getReport,
    getIndustries,
    getCompanySizes,
    getCustomSubIndustries,
    saveCustomSubIndustry,
    saveCustomSubIndustryInternal
};
