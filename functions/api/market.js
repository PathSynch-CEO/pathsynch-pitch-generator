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
const { getGoogleReviews, getLocalSERPRankings, getBusinessInfo } = require('../services/dataForSEOClient');

// Extracted service modules
const { calculateSEOLandscape } = require('../services/seoLandscape');
const { generateSWOT } = require('../services/swotGenerator');
const { generateAIExecutiveSummary, generateCompetitorAnalysis, generateReferenceCompetitors } = require('../services/narrativeGenerator');
const { generateSalesIntel, generateRecommendations, generateHighImpactMoves } = require('../services/salesIntelGenerator');
const { scoreLeads, generateIntelSignal, calculateGBPCompleteness, adjustSEOScoreForPhotos, identifyMarketLeader, getDominanceLanguage, calculateVelocityTrend } = require('../services/opportunityScorer');
const { enrichDecisionMaker } = require('../services/decisionMakerEnrichment');
const { findLinkedInURL, findTimeInBusiness, classifyVelocity } = require('../services/decisionMakerEnricher');
const { enrichDemographics } = require('../services/demographicsEnricher');
const { getVerticalQuestions } = require('../services/verticalQuestions');
const { detectVertical } = require('../services/verticalConfigs');
const { extractSentiment } = require('../services/sentimentExtractor');
const { getEnterpriseVertical, listEnterpriseVerticals } = require('../services/enterpriseVerticals');
const { getOrgChart } = require('../services/theOrgClient');
const { generateIntentSignals } = require('../services/intentSignalService');
const { syncReportToAccount360 } = require('../utils/entity360Service');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { findIndustry, findSubIndustry, buildSearchQueries, TAXONOMY_VERSION } = require('../config/industryTaxonomy');
const { getScoringProfile, resolveWeights } = require('../config/scoringProfiles');
const { getReportProfile } = require('../config/reportProfiles');
const { getSafetyContext } = require('../utils/safetyContextService');
const { generateSafetyContextNarrative } = require('../utils/safetyContextNarrative');
const { getBenchmarks, getStrategicMarketThesis, getKpiScorecard, getStrategicRoadmap, getProductRecommendations, getGrowthFactors, getQualifiedLeads, getSeoLandscape, getAdjacentCompetitors, getRejectedCompetitors, getValidationMetadata } = require('../utils/reportFieldResolver');
const { enrichReport: enrichReportPublicData } = require('../services/publicDataEnrichmentService');
const { enrichVisibility } = require('../services/visibilityEnrichmentService');
const { validateCompetitors } = require('../services/competitorValidator');
const { sanitizeReport } = require('../utils/reportSanitizer');
const { buildMarketDefinition } = require('../utils/marketDefinitionBuilder');

// FIX 7: Growth signal noise filter
const GROWTH_SIGNAL_NOISE = ['population', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'january', 'february', 'march', 'best', 'fastest growing', 'census', 'estimate', 'data', 'total', 'report', 'opinion', 'brown bag'];

function filterGrowthSignals(signals) {
    return (signals || []).filter(function(s) {
        var label = ((s.label || s.name || s.community || '')).toLowerCase().trim();
        return label.length > 3 && !GROWTH_SIGNAL_NOISE.includes(label);
    });
}

/**
 * Backward-compat helper: resolves taxonomy fields on legacy reports that predate Sprint 2.
 */
function resolveTaxonomyForReport(reportData) {
    if (reportData.taxonomyVersion && reportData.industryId) return reportData;
    const industryConfig = findIndustry(reportData.industry);
    const subIndustryConfig = findSubIndustry(reportData.industry, reportData.subIndustry);
    return {
        ...reportData,
        taxonomyVersion: TAXONOMY_VERSION,
        industryId: industryConfig?.id || null,
        subIndustryId: subIndustryConfig?.id || null,
        scoringProfile: industryConfig?.scoringProfile || 'default_local_business',
        reportProfile: industryConfig?.reportProfile || 'default_local_business'
    };
}

// ICP filter: chain/franchise exclusion keywords
const CHAIN_KEYWORDS = [
    "mcdonald's", "starbucks", "subway", "burger king", "wendy's", "taco bell",
    "chick-fil-a", "dunkin'", "domino's", "pizza hut", "papa john's", "chipotle",
    "panera", "sonic", "arby's", "popeyes", "jack in the box", "five guys",
    "panda express", "jimmy john's", "wingstop", "jersey mike's", "firehouse subs",
    "h&r block", "jackson hewitt", "liberty tax", "edward jones", "state farm",
    "allstate", "geico", "progressive", "farmers insurance", "nationwide",
    "great clips", "supercuts", "sport clips", "fantastic sams",
    "anytime fitness", "planet fitness", "orangetheory", "gold's gym",
    "franchise", "franchisee", "corp", "inc.", "llc"
];

// FIX A-6: News/trend signal relevance filter
function filterRelevantNews(newsItems, industry, subIndustry, city) {
    if (!newsItems || newsItems.length === 0) return [];

    const relevanceTerms = [
        (industry || '').toLowerCase(),
        (subIndustry || '').toLowerCase(),
        (city || '').toLowerCase()
    ].filter(t => t.length > 2);

    if (relevanceTerms.length === 0) return newsItems;

    const scored = newsItems.map(item => {
        const text = ((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
        const score = relevanceTerms.filter(term => text.includes(term)).length;
        return { ...item, _relevanceScore: score };
    });

    const relevant = scored.filter(item => item._relevanceScore > 0);

    // If filter removes everything, return top 5 by original order
    if (relevant.length === 0) return newsItems.slice(0, 5);

    // Sort by relevance score descending, take top 8
    return relevant.sort((a, b) => b._relevanceScore - a._relevanceScore).slice(0, 8);
}

// Classify news signal type from title/snippet content
function classifySignalType(signal) {
    const text = `${signal.title || ''} ${signal.snippet || ''}`.toLowerCase();
    if (text.includes('award') || text.includes('ranked') || text.includes('best') || text.includes('winner')) return 'award';
    if (text.includes('opening') || text.includes('new location') || text.includes('grand opening')) return 'new_opening';
    if (text.includes('expansion') || text.includes('expanding') || text.includes('grows')) return 'expansion';
    if (text.includes('hiring') || text.includes('jobs') || text.includes('employment')) return 'hiring';
    return 'trend';
}

// Industry keywords for signal-to-lead matching — multi-word terms to avoid false positives
function getIndustryKeywords(industry) {
    const keywords = {
        'accounting': ['tax preparation', 'accounting firm', 'bookkeeping service', 'cpa firm', 'financial advisor'],
        'salon': ['hair salon', 'beauty salon', 'barber shop', 'nail salon', 'beauty industry'],
        'restaurant': ['restaurant industry', 'food service', 'dining scene', 'catering business', 'restaurant opening'],
        'food': ['food and beverage', 'restaurant opening', 'dining scene', 'food festival', 'food truck', 'culinary scene'],
        'beverage': ['food and beverage', 'craft cocktail', 'brewery opening', 'taproom', 'wine bar', 'bar scene'],
        'bar': ['bar opening', 'craft cocktail', 'nightlife industry', 'lounge opening', 'happy hour', 'brewery opening'],
        'nightclub': ['nightlife industry', 'club opening', 'entertainment venue', 'nightlife scene'],
        'brewery': ['craft brewery', 'brewery opening', 'taproom opening', 'craft beer industry'],
        'coffee': ['coffee shop opening', 'cafe opening', 'specialty coffee', 'coffee industry', 'coffee roaster'],
        'auto': ['auto repair', 'car dealership', 'auto body', 'mechanic shop', 'auto detailing'],
        'real estate': ['real estate market', 'home sales', 'property market', 'real estate agent', 'housing market'],
        'hvac': ['hvac industry', 'heating and cooling', 'air conditioning service', 'hvac contractor'],
        'legal': ['law firm', 'legal services', 'attorney general', 'legal industry', 'law practice'],
        'fitness': ['fitness industry', 'gym membership', 'personal training', 'fitness center', 'yoga studio'],
        'retail': ['retail industry', 'retail store', 'retail sales', 'boutique shop', 'retail market'],
        'cleaning': ['cleaning service', 'janitorial service', 'pressure washing', 'carpet cleaning', 'maid service'],
        'dental': ['dental practice', 'dental office', 'dental industry', 'orthodontic', 'oral health'],
        'medical': ['medical practice', 'healthcare industry', 'clinic opening', 'urgent care', 'medical office'],
        'plumb': ['plumbing service', 'plumbing industry', 'plumber shortage', 'drain cleaning', 'plumbing contractor'],
        'insurance': ['insurance agency', 'insurance market', 'insurance industry', 'independent agent', 'insurance regulation'],
        'pet': ['pet grooming', 'veterinary clinic', 'pet services', 'animal hospital', 'pet industry'],
        'home service': ['home services', 'home improvement', 'contractor industry', 'remodeling market', 'handyman service'],
        'landscap': ['landscaping industry', 'lawn care', 'landscaping company', 'lawn service', 'outdoor services'],
        'childcare': ['childcare industry', 'daycare opening', 'early childhood', 'preschool market'],
        'marketing': ['marketing agency', 'advertising industry', 'digital marketing', 'ad agency', 'marketing firm'],
        'tech': ['tech startup', 'software company', 'technology industry', 'saas market', 'tech market'],
    };
    const lower = (industry || '').toLowerCase();
    for (const [key, vals] of Object.entries(keywords)) {
        if (lower.includes(key)) return vals;
    }
    return [];
}

// Common words that appear in many business names and are too generic to confirm a match
const SIGNAL_STOPWORDS = new Set([
    'park', 'social', 'bar', 'grill', 'cafe', 'house', 'place', 'room',
    'club', 'lounge', 'kitchen', 'table', 'street', 'city', 'town',
    'east', 'west', 'north', 'south', 'central', 'grand', 'royal',
    'golden', 'blue', 'green', 'black', 'white', 'happy', 'lucky',
    'main', 'first', 'best', 'good', 'great', 'american', 'national',
    'local', 'urban', 'metro', 'downtown', 'midtown', 'uptown',
    'corner', 'market', 'plaza', 'point', 'ridge', 'grove', 'creek',
    'lake', 'hill', 'stone', 'wood', 'star', 'gold', 'silver'
]);

// Match signal to lead — requires business name or industry keyword match
function matchSignalToLead(signal, lead, industry) {
    const signalText = `${signal.title || ''} ${signal.snippet || ''}`.toLowerCase();
    const businessName = (lead.name || '').toLowerCase();

    // PRIMARY: Business name match — requires meaningful word(s) or 2+ total word overlap
    const nameWords = businessName.split(/\s+/).filter(w => w.length > 3);
    const meaningfulWords = nameWords.filter(w => !SIGNAL_STOPWORDS.has(w));
    const matchedMeaningful = meaningfulWords.filter(word => signalText.includes(word));
    const matchedAll = nameWords.filter(word => signalText.includes(word));
    // Strong match: ≥1 meaningful (non-stopword) word, OR ≥2 total words appear in signal
    if (matchedMeaningful.length >= 1 || matchedAll.length >= 2) {
        return { matched: true, type: 'business_name', bonus: 10 };
    }

    // SECONDARY: Industry keyword match (relevant trend, not business-specific)
    const industryKeywords = getIndustryKeywords(industry);
    const industryMatch = industryKeywords.some(kw => signalText.includes(kw));
    if (industryMatch) return { matched: true, type: 'industry_trend', bonus: 3 };

    // NO MATCH: Geographic match alone is NOT sufficient
    return { matched: false, bonus: 0 };
}

// Normalize business name for deduplication
function normalizeBusinessName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Deduplicate leads by normalized name, keeping higher-scoring instance
function deduplicateLeads(leads) {
    const seen = new Map();
    for (const lead of leads) {
        const key = normalizeBusinessName(lead.name);
        if (!key) continue;
        const existingScore = seen.get(key)?.opportunityScore || 0;
        const thisScore = lead.opportunityScore || 0;
        if (!seen.has(key) || thisScore > existingScore) {
            seen.set(key, lead);
        }
    }
    return Array.from(seen.values());
}

// Deduplicate competitors array by normalized name, keeping entry with more reviews
function deduplicateCompetitors(competitors) {
    const seen = new Map();
    for (const comp of competitors) {
        const key = normalizeBusinessName(comp.name);
        if (!key) continue;
        const existingReviews = parseInt(seen.get(key)?.reviewCount) || parseInt(seen.get(key)?.reviews) || 0;
        const thisReviews = parseInt(comp.reviewCount) || parseInt(comp.reviews) || 0;
        if (!seen.has(key) || thisReviews > existingReviews) {
            seen.set(key, comp);
        }
    }
    return Array.from(seen.values());
}

const db = admin.firestore();

// Helpers for benchmark aggregation
function calculateMedian(numbers) {
    if (!numbers || numbers.length === 0) return null;
    const sorted = [...numbers].filter(n => n > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateAverage(numbers) {
    if (!numbers || numbers.length === 0) return null;
    const valid = numbers.filter(n => n > 0);
    if (valid.length === 0) return null;
    return parseFloat((valid.reduce((sum, n) => sum + n, 0) / valid.length).toFixed(2));
}

/**
 * Write market benchmark to Firestore for PathManager cross-product sync
 */
async function writeMarketBenchmark(reportData, reportId, city, state, industry, subIndustry, reviewCeiling) {
    try {
        const docId = `${(industry || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${(city || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${(state || '').toLowerCase()}`;

        const data = reportData.data || {};
        const leads = data.leads || [];
        const benchmarks = data.benchmarks || {};

        const benchmarkDoc = {
            industry: industry || '',
            subIndustry: subIndustry || '',
            city: city || '',
            state: (state || '').toUpperCase(),
            generatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            benchmarks: {
                avgRating: benchmarks.avgRating || null,
                topQuartileRating: benchmarks.topQuartileAvg || null,
                avgReviewCount: benchmarks.avgReviews || null,
                totalCompetitors: benchmarks.totalCompetitors || 0,
                reviewCountCeiling: reviewCeiling || 500,
                marketLeader: benchmarks.marketLeader ? {
                    name: benchmarks.marketLeader,
                    rating: benchmarks.marketLeaderRating || null
                } : null,
                icpMedianReviews: calculateMedian(leads.map(l => parseInt(l.reviewCount || l.reviews) || 0)),
                icpAvgRating: calculateAverage(leads.map(l => parseFloat(l.rating) || 0)),
                totalMarketReviews: data.shareOfVoice?.totalMarketReviews || null,
                leaderVoiceShare: data.shareOfVoice?.leaderShare || null,
                leaderVoiceName: data.shareOfVoice?.leaderName || null,
                marketAvgSEO: data.seoLandscape?.avgSEOScore || null,
                cityPopulation: data.demographicsEnriched?.cityDemographics?.population || null,
                cityMedianIncome: data.demographicsEnriched?.cityDemographics?.medianIncome || null
            },
            reportId: reportId || null,
            reportUserId: reportData.userId || null,
            saturationLevel: data.saturation || 'medium',
            // Sprint 2: taxonomy metadata
            taxonomyVersion: reportData.taxonomyVersion || null,
            industryId: reportData.industryId || null,
            benchmarkKey: reportData.benchmarkKey || docId,
            scoringProfile: reportData.scoringProfile || 'default_local_business'
        };

        await db.collection('marketBenchmarks').doc(docId).set(benchmarkDoc, { merge: true });
        console.log(`[MarketBenchmark] Written: ${docId}`);
        return docId;
    } catch (e) {
        console.warn('[MarketBenchmark] Write failed:', e.message);
        return null;
    }
}

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

    const leader = identifyMarketLeader(competitors);
    const leaderReviews = parseInt(leader.reviewCount || leader.reviews) || 0;

    return {
        avgRating,
        topQuartileAvg,
        avgReviews,
        totalReviews,
        aboveAvg,
        belowAvg: rated.length - aboveAvg,
        marketLeader: leader?.name,
        marketLeaderRating: leader?.rating,
        marketLeaderReviews: leaderReviews,
        dominanceLanguage: getDominanceLanguage(leader, avgReviews),
        totalCompetitors: competitors.length
    };
}


// ─── KPI Scorecard helpers ───────────────────────────────────────────────────
const { safeNumber } = require('../utils/numericSafety');

function computeKpiStatus(current, benchmark) {
    const c = safeNumber(current);
    const b = safeNumber(benchmark);
    if (c <= 0 || b <= 0) return 'unknown';
    if (c >= b) return 'above';
    if (c >= b * 0.9) return 'near';
    return 'below';
}

function computeSeoKpiStatus(score) {
    const s = safeNumber(score);
    if (s <= 0) return 'unknown';
    if (s >= 80) return 'above';
    if (s >= 60) return 'near';
    return 'below';
}

// ── S2: PathSynch Product Wedge per Lead ─────────────────────────────────────
// Priority-ordered signal chain. Each condition checks the required field
// exists and is not null BEFORE evaluating — missing data never triggers
// a false signal.
const PRODUCT_WEDGE_TEMPLATES = {
    responseRate0:       { product: 'PathManager + Review AI', secondProduct: null, signal: 'no_review_responses' },
    stalledReviews:      { product: 'PathConnect + QRsynch',   secondProduct: null, signal: 'stalled_review_velocity' },
    highRatingLowVolume: { product: 'PathConnect + LocalSynch',secondProduct: null, signal: 'high_quality_low_presence' },
    weakWebsite:         { product: 'LocalSynch + Microsite',  secondProduct: null, signal: 'weak_website' },
    noMapPack:           { product: 'LocalSynch',              secondProduct: null, signal: 'no_map_pack' },
    lowAiVisibility:     { product: 'SynchIQ',                 secondProduct: null, signal: 'low_ai_visibility' },
    newsSignal:          { product: 'SynchIntro',              secondProduct: null, signal: 'news_signal' },
    default:             { product: 'PathConnect + LocalSynch',secondProduct: null, signal: 'default' }
};

const PRODUCT_WEDGE_PITCHES = {
    responseRate0:       (name) => `${name} is leaving public trust signals unanswered.`,
    stalledReviews:      (name) => `${name}'s review engine has stalled — reactivate it before competitors fill the gap.`,
    highRatingLowVolume: (name, reviewCount, marketAvgReviews) => `${name} already delivers quality (${reviewCount} reviews vs ${marketAvgReviews} market avg). We help more prospects see it.`,
    weakWebsite:         (name) => `${name}'s local presence is stronger than its website conversion path.`,
    noMapPack:           (name) => `${name} is invisible where buyers search first.`,
    lowAiVisibility:     (name) => `${name}'s competitors may become the default AI answer.`,
    newsSignal:          (name) => `This is the right moment to start outbound with ${name}.`,
    default:             (name) => `Grow ${name}'s digital presence where local buyers search.`
};

function computeProductWedge(lead, benchmarks) {
    const name = lead.name || 'This business';
    const marketAvgReviews = parseInt(benchmarks && benchmarks.avgReviews) || 100;
    const reviewCount = lead.reviewCount != null ? parseInt(lead.reviewCount) :
                        lead.reviews   != null ? parseInt(lead.reviews)    : null;
    const rating = lead.rating != null ? parseFloat(lead.rating) : null;

    // 1. Response rate === 0 (ONLY if explicitly known, not null)
    if (lead.responseRate === 0) {
        return { ...PRODUCT_WEDGE_TEMPLATES.responseRate0, pitch: PRODUCT_WEDGE_PITCHES.responseRate0(name) };
    }

    // 2. Days since last review > 90 (ONLY if explicitly known)
    if (lead.daysSinceLastReview != null && lead.daysSinceLastReview > 90) {
        return { ...PRODUCT_WEDGE_TEMPLATES.stalledReviews, pitch: PRODUCT_WEDGE_PITCHES.stalledReviews(name) };
    }

    // 3. High rating (≥4.5) + low reviews (<market avg) — rating and reviewCount always exist when present
    if (rating != null && rating >= 4.5 && reviewCount != null && reviewCount < marketAvgReviews) {
        return { ...PRODUCT_WEDGE_TEMPLATES.highRatingLowVolume, pitch: PRODUCT_WEDGE_PITCHES.highRatingLowVolume(name, reviewCount, marketAvgReviews) };
    }

    // 4. Website perf < 70 (ONLY if websiteScore is explicitly known)
    if (lead.websiteScore != null && lead.websiteScore < 70) {
        return { ...PRODUCT_WEDGE_TEMPLATES.weakWebsite, pitch: PRODUCT_WEDGE_PITCHES.weakWebsite(name) };
    }

    // 5. Map Pack appearances === 0 (ONLY if explicitly measured)
    if (lead.mapPackCount === 0) {
        return { ...PRODUCT_WEDGE_TEMPLATES.noMapPack, pitch: PRODUCT_WEDGE_PITCHES.noMapPack(name) };
    }

    // 6. AI visibility < 50% or 'not mentioned' (ONLY if known)
    if (lead.aiVisibilityRate != null && (lead.aiVisibilityRate < 50 || lead.aiVisibilityMention === 'not_mentioned_in_sample')) {
        return { ...PRODUCT_WEDGE_TEMPLATES.lowAiVisibility, pitch: PRODUCT_WEDGE_PITCHES.lowAiVisibility(name) };
    }

    // 7. News signal present (any type)
    if (lead.newsSignal) {
        return { ...PRODUCT_WEDGE_TEMPLATES.newsSignal, pitch: PRODUCT_WEDGE_PITCHES.newsSignal(name) };
    }

    // Default
    return { ...PRODUCT_WEDGE_TEMPLATES.default, pitch: PRODUCT_WEDGE_PITCHES.default(name) };
}

function computeKpiScorecard(reportData) {
    const kpis = [];
    const mb = reportData.data && reportData.data.benchmarks ? reportData.data.benchmarks : {};
    const seo = reportData.data && reportData.data.seoLandscape ? reportData.data.seoLandscape : {};
    const leads = (reportData.data && reportData.data.leads) ? reportData.data.leads : [];

    kpis.push({
        kpi: 'Average Rating',
        currentValue: mb.avgRating
            ? String(safeNumber(mb.avgRating).toFixed(2)) + '\u2605'
            : 'N/A',
        benchmark: mb.topQuartileAvg
            ? String(safeNumber(mb.topQuartileAvg).toFixed(1)) + '\u2605'
            : 'N/A',
        status: computeKpiStatus(mb.avgRating, mb.topQuartileAvg),
        target: mb.topQuartileAvg
            ? String(safeNumber(mb.topQuartileAvg).toFixed(1)) + '\u2605'
            : '4.5\u2605'
    });

    kpis.push({
        kpi: 'Share of Voice',
        currentValue: reportData.data && reportData.data.shareOfVoice && reportData.data.shareOfVoice.leaderShare != null
            ? safeNumber(reportData.data.shareOfVoice.leaderShare).toFixed(1) + '%'
            : 'N/A',
        benchmark: 'Market Leader: ' + (reportData.data && reportData.data.shareOfVoice && reportData.data.shareOfVoice.leaderShare != null
            ? safeNumber(reportData.data.shareOfVoice.leaderShare).toFixed(1) + '%'
            : 'N/A'),
        status: 'benchmark',
        target: '15%'
    });

    kpis.push({
        kpi: 'Avg Review Count',
        currentValue: mb.avgReviews
            ? String(Math.round(safeNumber(mb.avgReviews)))
            : 'N/A',
        benchmark: 'Market: ' + (mb.avgReviews
            ? String(Math.round(safeNumber(mb.avgReviews)))
            : 'N/A'),
        status: 'benchmark',
        target: mb.avgReviews
            ? String(Math.round(safeNumber(mb.avgReviews) * 1.5)) + ' reviews'
            : '30 reviews'
    });

    kpis.push({
        kpi: 'SEO / Digital Authority',
        currentValue: seo.avgSEOScore
            ? String(Math.round(safeNumber(seo.avgSEOScore))) + '/100'
            : 'N/A',
        benchmark: seo.strongCount
            ? seo.strongCount + ' strong competitors'
            : 'N/A',
        status: computeSeoKpiStatus(seo.avgSEOScore),
        target: '80/100'
    });

    kpis.push({
        kpi: 'Total Competitors',
        currentValue: mb.totalCompetitors
            ? String(safeNumber(mb.totalCompetitors))
            : 'N/A',
        benchmark: reportData.data && reportData.data.saturation ? reportData.data.saturation : 'N/A',
        status: 'info',
        target: null
    });

    kpis.push({
        kpi: 'Qualified Leads Found',
        currentValue: leads.length ? String(leads.length) : '0',
        benchmark: 'Target: 5+ per market',
        status: leads.length >= 5 ? 'above' : 'below',
        target: '5+ per market'
    });

    return kpis;
}

function mergeKpiScorecard(deterministic, geminiInterpretations) {
    return deterministic.map(kpi => {
        const interp = (geminiInterpretations || []).find(g => g.kpi === kpi.kpi);
        const geminiTarget = interp && interp.target && interp.target.trim() && interp.target !== 'See roadmap' ? interp.target : null;
        return {
            ...kpi,
            target: geminiTarget || kpi.target || null,
            whyItMatters: interp && interp.whyItMatters ? interp.whyItMatters : ''
        };
    });
}
// ─── end KPI Scorecard helpers ───────────────────────────────────────────────

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

        const creditInfo = {
            used: usage.marketReportsThisMonth || 0,
            limit: limits.marketReportsPerMonth,
            unlimited: limits.marketReportsPerMonth === -1
        };
        if (!req.body._refreshReportId && !creditInfo.unlimited && creditInfo.used >= creditInfo.limit) {
            return res.status(403).json({
                error: 'MARKET_REPORT_LIMIT_REACHED',
                message: `Monthly limit of ${creditInfo.limit} reports reached.`
            });
        }

        // Enterprise mode detection (Scale/Enterprise only)
        const isEnterpriseMode = req.body.enterpriseMode === true;
        let enterpriseVertical = null;
        if (isEnterpriseMode) {
            if (!['scale', 'enterprise'].includes(plan.toLowerCase())) {
                return res.status(403).json({ error: 'Enterprise mode requires Scale or Enterprise plan' });
            }
            enterpriseVertical = getEnterpriseVertical(req.body.enterpriseVertical);
            if (!enterpriseVertical) {
                return res.status(400).json({ error: 'Invalid enterprise vertical', available: listEnterpriseVerticals() });
            }
        }

        // Get request data
        const { city, state, zipCode, industry, subIndustry, pitchId, radius: requestedRadius, companySize = 'small', icpFilter = null, precisionQuestions = null } = req.body;

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

        // Detect vertical for industry-specific defaults
        const verticalConfig = detectVertical(industry, subIndustry, null);
        if (verticalConfig) {
            console.log(`[MarketIntel] Vertical detected: ${verticalConfig.key} (ceiling=${verticalConfig.reviewCountCeiling})`);
        }

        // Sprint 2: Resolve taxonomy, scoring profile, and report profile for this industry
        const industryConfig = findIndustry(displayIndustryName);
        const subIndustryConfig = findSubIndustry(displayIndustryName, subIndustry);
        const scoringProfile = getScoringProfile(industryConfig?.scoringProfile);
        const reportProfile = getReportProfile(industryConfig?.reportProfile);
        const taxonomyQueries = buildSearchQueries(displayIndustryName, subIndustry, city || '', state || '');
        const primaryTaxonomyQuery = taxonomyQueries[0] || null;
        console.log(`[MarketIntel] Taxonomy: industryId=${industryConfig?.id || 'none'}, scoringProfile=${industryConfig?.scoringProfile || 'default_local_business'}, reportProfile=${industryConfig?.reportProfile || 'default_local_business'}`);

        // Build taxonomy metadata for Firestore doc
        const citySlug = (city || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const stateCode = (state || '').toUpperCase().trim();
        const benchmarkKey = industryConfig
            ? `${industryConfig.id}_${subIndustryConfig?.id || 'general'}_${citySlug}_${stateCode}`
            : `${(displayIndustryName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${citySlug}_${stateCode}`;

        // Build profile context to append to AI prompts
        let profileContext = '';
        if (reportProfile.promptInjection) {
            profileContext += '\n\n=== INDUSTRY-SPECIFIC INSTRUCTIONS ===\n' + reportProfile.promptInjection + '\n';
        }
        profileContext += '\nUse "' + reportProfile.competitorLanguage + '" instead of "competitors" throughout.';
        profileContext += '\nUse "' + reportProfile.opportunityLanguage + '" instead of "opportunity gap" throughout.';
        profileContext += '\nUse "' + reportProfile.qualifiedLeadsLanguage + '" instead of "qualified leads" throughout.';
        if (reportProfile.avoidSections.length > 0) {
            profileContext += '\nDo NOT include these sections: ' + reportProfile.avoidSections.join(', ') + '.';
        }

        // Build precision context from user's question answers
        let precisionContext = '';
        if (precisionQuestions) {
            if (precisionQuestions.q1?.value) {
                precisionContext += `\nPRECISION FILTER: The user is specifically targeting "${precisionQuestions.q1.value}" businesses within the ${displayIndustryName} vertical. Prioritize businesses matching this sub-type.\n`;
            }
            if (precisionQuestions.q2?.value) {
                precisionContext += `\nUser's approach preference: ${precisionQuestions.q2.value}.\n`;
            }
        }

        // Inject enterprise vertical context into AI prompts
        if (isEnterpriseMode && enterpriseVertical) {
            precisionContext += `\nENTERPRISE VERTICAL: ${enterpriseVertical.vertical}`;
            precisionContext += `\nPrimary buyer persona: ${enterpriseVertical.primaryBuyer}`;
            precisionContext += `\nSales cycle: ${enterpriseVertical.salesCycleMonths} months`;
            precisionContext += `\nCompetitive dimensions: ${enterpriseVertical.competitiveDimensions.join('; ')}`;
            precisionContext += `\nProcurement signals to watch: ${enterpriseVertical.procurementSignals.slice(0, 3).join('; ')}`;
            if (enterpriseVertical.budgetCycle) precisionContext += `\nBudget cycle: ${enterpriseVertical.budgetCycle}`;
            precisionContext += '\n';
        }

        // Parallel data fetch (existing + Serper enrichment)
        const [competitorResult, demographicResult, establishmentResult, demandSignalsResult, serperCompetitorsResult, serperNewsResult] = await Promise.allSettled([
            // Competitors: route through fetchCompetitors helper
            // Sprint 2 hotfix: pass primaryTaxonomyQuery so Places search uses taxonomy-aware keyword
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
                companySize: normalizedCompanySize,
                taxonomyQuery: primaryTaxonomyQuery
            }),
            // Demographics - try place level first, then county, then state
            fetchDemographicsWithFallback(geo),
            // CBP establishment data (if Growth+ tier)
            tier !== 'starter' && geo.countyFips
                ? cbp.getEstablishmentCount(naicsCode, geo.countyFips, geo.stateFips)
                : Promise.resolve(null),
            // Demand signals with company size-based seasonality
            googleTrends.getDemandSignals(naicsCode, state, city, normalizedCompanySize),
            // Serper: scored leads via Places search (refine with precision sub-type if available)
            // Sprint 2: use taxonomy primary query label when available
            serperClient.searchCompetitors(
                precisionQuestions?.q1?.value
                    ? `${precisionQuestions.q1.value} ${displayIndustryName}`
                    : (subIndustryConfig?.label || displayIndustryName),
                locationString, 20
            ),
            // Serper: industry news signals
            serperClient.searchBusinessNews('', locationString, displayIndustryName, state)
        ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

        const demandSignals = demandSignalsResult?.data || null;

        // Serper enrichment: scored leads + news signals
        const serperCompetitors = serperCompetitorsResult || [];
        // Deduplicate + hard-reject news signals
        const rawNewsSignals = serperNewsResult || [];
        const seenTitles = new Set();
        const HARD_REJECT_SOURCES = [
            'indexbox', 'globenewswire', 'prnewswire', 'businesswire',
            'marketresearch', 'mordorintelligence', 'grandviewresearch',
            'alliedmarketresearch', 'vocalmedia', 'lasvegasoptic',
            'pennyhoarder', 'businessresearchinsights', 'technavio'
        ];
        const GLOBAL_PATTERNS = [
            'global market', 'market forecast', 'market analysis 20',
            'market size', 'cagr', 'compound annual', 'market research',
            'world glass', 'world drain', 'world cleaning',
            '2030', '2031', '2032', '2033', '2034', '2035'
        ];
        const OFF_TOPIC_PATTERNS = [
            'loses job after', 'background check error',
            'remote work companies', 'best companies for remote'
        ];
        const newsSignals = rawNewsSignals.filter(signal => {
            // Title dedup
            const key = (signal.title || '').toLowerCase().trim();
            if (seenTitles.has(key)) return false;
            seenTitles.add(key);
            // Hard reject: source domain
            const source = (signal.source || signal.link || '').toLowerCase();
            if (HARD_REJECT_SOURCES.some(s => source.includes(s))) return false;
            // Hard reject: global market research patterns
            const text = `${signal.title || ''} ${signal.snippet || ''}`.toLowerCase();
            if (GLOBAL_PATTERNS.some(p => text.includes(p))) return false;
            // Hard reject: off-topic patterns
            if (OFF_TOPIC_PATTERNS.some(p => text.includes(p))) return false;
            return true;
        });
        const rejected = rawNewsSignals.length - newsSignals.length;
        // FIX A-6: Apply relevance filter after hard-reject filter
        const newsSignalsPreRelevance = newsSignals.length;
        const newsSignalsFinal = filterRelevantNews(newsSignals, displayIndustryName, subIndustry, city)
            .map(s => { const { _relevanceScore, ...rest } = s; return rest; });
        const relevanceRejected = newsSignalsPreRelevance - newsSignalsFinal.length;
        let serperLeads = serperClient.buildLeads(serperCompetitors, displayIndustryName, locationString);
        console.log(`[MarketIntel] Serper: ${serperLeads.length} leads, ${newsSignalsFinal.length} news signals (${rejected} hard-rejected + ${relevanceRejected} relevance-filtered from ${rawNewsSignals.length})`);

        // Enrich top 5 leads with DataForSEO Google Reviews (parallel)
        const TOP_TO_ENRICH = 5;
        if (serperLeads.length > 0) {
            try {
                const reviewResults = await Promise.allSettled(
                    serperLeads.slice(0, TOP_TO_ENRICH).map(async lead => {
                        // Primary: DataForSEO (rich data — ownerResponse, timestamps, depth)
                        let reviewData = await getGoogleReviews(lead.name, city || '');

                        // Fallback: Google Places (up to 5 reviews — no ownerResponse)
                        if (!reviewData || !reviewData.reviews || reviewData.reviews.length === 0) {
                            try {
                                const placeResult = await googlePlaces.lookupProspectPlace(lead.name, city || '', state || '');
                                if (placeResult.success && placeResult.placeId) {
                                    const details = await googlePlaces.getPlaceDetails(placeResult.placeId);
                                    if (details.success && details.data?.reviews?.length > 0) {
                                        reviewData = {
                                            rating: details.data.rating,
                                            reviewCount: details.data.reviewCount,
                                            reviews: details.data.reviews.map(r => ({
                                                text: r.text || '',
                                                rating: r.rating || null,
                                                date: r.time ? new Date(r.time * 1000).toISOString() : null,
                                                authorName: r.author || null,
                                                ownerResponse: null
                                            }))
                                        };
                                        console.log(`[MarketIntel] Places review fallback used for: ${lead.name}`);
                                    }
                                }
                            } catch (placesErr) {
                                console.warn('[MarketIntel] Places review fallback failed:', placesErr.message);
                            }
                        }

                        if (reviewData && reviewData.reviews && reviewData.reviews.length > 0) {
                            // Calculate response rate from ownerResponse field
                            const totalReviews = reviewData.reviews.length;
                            const respondedCount = reviewData.reviews.filter(r => r.ownerResponse).length;
                            const responseRate = totalReviews > 0 ? Math.round((respondedCount / totalReviews) * 100) : null;

                            // Calculate review recency from timestamps
                            const timestamps = reviewData.reviews
                                .map(r => r.date ? new Date(r.date).getTime() : null)
                                .filter(t => t !== null && !isNaN(t));
                            const lastReviewTs = timestamps.length > 0 ? Math.max(...timestamps) : null;
                            const lastReviewDate = lastReviewTs ? new Date(lastReviewTs).toISOString() : null;
                            const daysSinceLastReview = lastReviewTs
                                ? Math.floor((Date.now() - lastReviewTs) / (1000 * 60 * 60 * 24))
                                : null;
                            const velocityStatus = daysSinceLastReview === null ? 'unknown'
                                : daysSinceLastReview < 14 ? 'healthy'
                                : daysSinceLastReview < 30 ? 'slowing'
                                : daysSinceLastReview < 90 ? 'low'
                                : 'dormant';

                            return {
                                reviewCount: reviewData.reviewCount || reviewData.reviews.length,
                                averageRating: reviewData.rating || null,
                                responseRate,
                                respondedCount,
                                lastReviewDate,
                                daysSinceLastReview,
                                velocityStatus,
                                recentReviews: reviewData.reviews.slice(0, 5).map(r => ({
                                    text: r.text || '',
                                    rating: r.rating || null,
                                    date: r.date || null,
                                    author: r.authorName || null,
                                    hasOwnerResponse: !!r.ownerResponse
                                }))
                            };
                        }
                        return null;
                    })
                );

                serperLeads = serperLeads.map((lead, i) => {
                    if (i < TOP_TO_ENRICH && reviewResults[i]?.status === 'fulfilled' && reviewResults[i].value) {
                        return { ...lead, dataForSEO: reviewResults[i].value };
                    }
                    return lead;
                });

                const enrichedCount = reviewResults.filter(r => r.status === 'fulfilled' && r.value).length;
                console.log('[MarketIntel] DataForSEO review enrichment:', enrichedCount, 'of', TOP_TO_ENRICH, 'leads');
            } catch (dfErr) {
                console.warn('[MarketIntel] DataForSEO review enrichment failed:', dfErr.message);
            }
        }

        // Enrich top 5 leads with GBP Business Info (parallel)
        if (serperLeads.length > 0) {
            try {
                const gbpResults = await Promise.allSettled(
                    serperLeads.slice(0, TOP_TO_ENRICH).map(lead =>
                        getBusinessInfo(lead.name, city || '')
                    )
                );
                serperLeads = serperLeads.map((lead, i) => {
                    if (i < TOP_TO_ENRICH && gbpResults[i]?.status === 'fulfilled' && gbpResults[i].value) {
                        const gbpInfo = gbpResults[i].value;
                        const gbpCompleteness = calculateGBPCompleteness(gbpInfo);
                        return { ...lead, gbpInfo, gbpCompleteness };
                    }
                    return lead;
                });
                const gbpCount = gbpResults.filter(r => r.status === 'fulfilled' && r.value).length;
                console.log('[MarketIntel] DataForSEO GBP enrichment:', gbpCount, 'of', TOP_TO_ENRICH, 'leads');
            } catch (gbpErr) {
                console.warn('[MarketIntel] DataForSEO GBP enrichment failed:', gbpErr.message);
            }
        }

        // Extract review sentiment for leads with DataForSEO reviews (parallel, 3s timeout each)
        if (serperLeads.length > 0) {
            try {
                const sentimentResults = await Promise.allSettled(
                    serperLeads.slice(0, TOP_TO_ENRICH).map(lead => {
                        const reviews = lead.dataForSEO?.recentReviews;
                        if (!reviews || reviews.length < 2) return Promise.resolve(null);
                        return Promise.race([
                            extractSentiment(lead.name, reviews),
                            new Promise(resolve => setTimeout(() => resolve(null), 3000))
                        ]);
                    })
                );
                serperLeads = serperLeads.map((lead, i) => {
                    if (i < TOP_TO_ENRICH && sentimentResults[i]?.status === 'fulfilled' && sentimentResults[i].value) {
                        return { ...lead, sentiment: sentimentResults[i].value };
                    }
                    return lead;
                });
                const sentimentCount = sentimentResults.filter(r => r.status === 'fulfilled' && r.value).length;
                console.log('[MarketIntel] Sentiment extraction:', sentimentCount, 'of', TOP_TO_ENRICH, 'leads');
            } catch (sentErr) {
                console.warn('[MarketIntel] Sentiment extraction failed:', sentErr.message);
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

        // --- Competitor Validation (Three-Layer: category / Gemini / geo) ---
        // Runs BEFORE benchmarks and scoring so corrupt results never enter the math.
        let adjacentCompetitors = [];
        let rejectedCompetitors = [];
        let validationMetadata = null;
        let validationNotice = null;

        try {
            const validationResult = await validateCompetitors(competitors, {
                city,
                state,
                industry: displayIndustryName,
                subIndustry: subIndustry || ''
            });

            const { direct, adjacent, rejected, validationMetadata: vmeta } = validationResult;

            adjacentCompetitors = adjacent;
            rejectedCompetitors = rejected;
            validationMetadata = vmeta;

            const mode = vmeta.validationMode;

            if (mode === 'full') {
                // Normal report — replace competitors with direct set only
                competitors = direct;
            } else if (mode === 'thin_market') {
                // Direct < 10 but direct + adjacent >= 15
                competitors = direct;
                validationNotice = `Validation produced a small direct competitor set (${direct.length} direct, ${adjacent.length} adjacent). Benchmarks reflect direct competitors only. Adjacent businesses are shown for market context.`;
                console.warn(`[CompetitorValidation] Thin market: ${direct.length} direct, ${adjacent.length} adjacent`);
            } else {
                // fallback — direct + adjacent combined < 15, use everything non-rejected
                competitors = [...direct, ...adjacent];
                adjacentCompetitors = []; // all are in competitors now
                validationNotice = `This market has limited competitors matching your sub-industry criteria. Results include adjacent businesses and should be interpreted as directional.`;
                console.warn(`[CompetitorValidation] Fallback mode: using ${competitors.length} combined competitors`);
            }

            console.log(`[CompetitorValidation] Competitors for benchmarks: ${competitors.length} (mode=${mode})`);
        } catch (validationErr) {
            // Non-blocking — if validation fails entirely, continue with all competitors
            console.error('[CompetitorValidation] Validation pipeline failed (non-blocking):', validationErr.message);
            validationMetadata = {
                validationMode: 'partial',
                geminiValidationUsed: false,
                geminiValidationStatus: 'error',
                totalFetched: competitors.length,
                directCompetitorCount: competitors.length,
                adjacentCompetitorCount: 0,
                rejectedCompetitorCount: 0,
                rejectionBreakdown: { category_type: 0, category_name: 0, gemini: 0, geo_flagged: 0 },
                minimumThresholdTriggered: false,
                validatedAt: new Date().toISOString()
            };
        }

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

        // Create report document (or reuse existing for refresh)
        const refreshId = req.body._refreshReportId;
        const reportRef = refreshId
            ? db.collection('marketReports').doc(refreshId)
            : db.collection('marketReports').doc();
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
                naicsCode: subIndustryConfig?.naicsCode || industryConfig?.naicsCode || naicsCode,
                naicsTitle: subIndustryConfig?.naicsLabel || industryConfig?.naicsLabel || industryDetails?.title || displayIndustryName,
                avgTransaction: industryDetails?.avgTransaction || naics.getAvgTransaction(naicsCode),
                monthlyCustomers: industryDetails?.monthlyCustomers || naics.getMonthlyCustomers(naicsCode),
                dataSourceType: dataSourceType,
                customName: customIndustryName || null,
                taxonomyNaicsCode: subIndustryConfig?.naicsCode || industryConfig?.naicsCode || null,
                taxonomyNaicsLabel: subIndustryConfig?.naicsLabel || industryConfig?.naicsLabel || null
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
                newsSignals: newsSignalsFinal,
                serperEnrichment: {
                    leadSource: 'serper_places',
                    newsSource: 'serper_news',
                    enrichedAt: new Date().toISOString()
                },

                // Competitor validation: adjacent and rejected arrays + metadata
                adjacentCompetitors: adjacentCompetitors.slice(0, 30).map(c => ({
                    name: c.name,
                    address: c.address || null,
                    rating: c.rating || null,
                    reviews: c.reviewCount || c.reviews || null,
                    types: c.types || [],
                    validationReason: c.validation?.reason || null
                })),
                rejectedCompetitors: rejectedCompetitors.slice(0, 50).map(c => ({
                    name: c.name,
                    types: c.types || [],
                    validationLayer: c.validation?.validationLayer || null,
                    relevance: 'invalid',
                    reason: c.validation?.reason || null,
                    confidence: c.validation?.confidence || null
                })),
                validationMetadata: validationMetadata || null,
                validationNotice: validationNotice || null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            generatedAt: admin.firestore.FieldValue.serverTimestamp(),
            refreshedAt: null,
            refreshCount: 0,
            // Sprint 2: taxonomy metadata
            taxonomyVersion: TAXONOMY_VERSION,
            industryId: industryConfig?.id || null,
            industryLabel: displayIndustryName,
            subIndustryId: subIndustryConfig?.id || null,
            subIndustryLabel: subIndustry || null,
            scoringProfile: industryConfig?.scoringProfile || 'default_local_business',
            reportProfile: industryConfig?.reportProfile || 'default_local_business',
            benchmarkKey: benchmarkKey,
            queryTemplateUsed: industryConfig?.googlePlaceQueries?.[0] || null,
            searchQueryUsed: primaryTaxonomyQuery || null
        };

        // If this is a refresh, write to the existing document instead
        const refreshReportId = req.body._refreshReportId;
        if (refreshReportId) {
            reportData.id = refreshReportId;
            reportData.refreshedAt = admin.firestore.FieldValue.serverTimestamp();
            reportData.refreshCount = admin.firestore.FieldValue.increment(1);
        }

        // Calculate market benchmarks
        const benchmarks = calculateMarketBenchmarks(competitors);
        reportData.data.benchmarks = benchmarks;

        // Calculate SEO Landscape (calculated scores)
        const seoLandscape = calculateSEOLandscape(competitors);

        // Enrich with real Google Maps SERP rankings from DataForSEO
        try {
            const serpRankings = await getLocalSERPRankings(displayIndustryName, city || '', state || '');
            if (serpRankings && serpRankings.length > 0) {
                seoLandscape.realRankings = serpRankings.map(r => ({
                    businessName: r.name,
                    position: r.rank,
                    rating: r.rating || null,
                    reviewCount: r.reviewCount || null,
                    address: r.address || null
                }));
                seoLandscape.dataSource = 'dataforseo';
                console.log('[MarketIntel] DataForSEO SERP rankings:', serpRankings.length, 'results');
            } else {
                seoLandscape.dataSource = 'calculated';
            }
        } catch (serpErr) {
            console.warn('[MarketIntel] DataForSEO SERP fetch failed:', serpErr.message);
            seoLandscape.dataSource = 'calculated';
        }

        reportData.data.seoLandscape = seoLandscape;

        // FIX 4: Website pass-through — ensure lead.website is populated from SEO Landscape or DataForSEO
        if (seoLandscape?.competitors?.length > 0) {
            serperLeads = serperLeads.map(lead => {
                if (lead.website) return lead;
                const nameKey = (lead.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const seoMatch = seoLandscape.competitors.find(c => {
                    const cKey = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return cKey && nameKey && (cKey === nameKey || cKey.includes(nameKey) || nameKey.includes(cKey));
                });
                const resolvedWebsite = seoMatch?.website || lead.dataForSEO?.website || lead.gbpInfo?.website || null;
                return resolvedWebsite ? { ...lead, website: resolvedWebsite } : lead;
            });
        }

        // FIX 1: ICP Filter — separate qualified leads from market context
        // Use vertical-specific ceiling when available; Sprint 2: fall back to scoringProfile ceiling, then 500
        const verticalCeiling = verticalConfig?.reviewCountCeiling || scoringProfile.reviewCeiling || 500;
        const reviewCeiling = icpFilter?.reviewCeiling || verticalCeiling;
        if (icpFilter) {
            // Apply vertical ceiling if user didn't set a custom one
            if (!icpFilter.reviewCeiling && verticalConfig?.reviewCountCeiling) {
                icpFilter.reviewCeiling = verticalConfig.reviewCountCeiling;
            }
            const beforeCount = serperLeads.length;
            serperLeads = serperLeads.filter(lead => {
                const rc = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
                const rating = parseFloat(lead.rating) || 0;
                // Review floor/ceiling
                if (rc < (icpFilter.reviewFloor || 5)) return false;
                if (rc > (icpFilter.reviewCeiling || verticalCeiling)) return false;
                // Rating floor
                if (rating < (icpFilter.ratingFloor || 4.0) && rating > 0) return false;
                // Chain exclusion
                if (icpFilter.excludeChains) {
                    const nameLower = (lead.name || '').toLowerCase();
                    if (CHAIN_KEYWORDS.some(kw => nameLower.includes(kw))) return false;
                }
                return true;
            });
            console.log(`[MarketIntel] ICP filter: ${beforeCount} → ${serperLeads.length} qualified leads (ceiling=${icpFilter.reviewCeiling}, floor=${icpFilter.reviewFloor})`);
        } else if (verticalConfig) {
            // Even without explicit ICP filter, apply vertical ceiling to exclude
            // businesses too large to be qualified leads (e.g. 1,100-review salons
            // when health_beauty ceiling is 250)
            const beforeCount = serperLeads.length;
            serperLeads = serperLeads.filter(lead => {
                const rc = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
                return rc <= verticalCeiling;
            });
            console.log(`[MarketIntel] Vertical ceiling filter: ${beforeCount} → ${serperLeads.length} qualified leads (ceiling=${verticalCeiling}, vertical=${verticalConfig.key})`);
        }

        // Cross-reference news signals with leads — requires business name or industry keyword match
        // Trend bonus (industry_trend) awarded to FIRST matching lead only to prevent all-lead inflation
        if (newsSignalsFinal && newsSignalsFinal.length > 0) {
            let trendBonusAwarded = false;
            serperLeads.forEach(lead => {
                let bestMatch = null;
                let bestBonus = 0;
                for (const signal of newsSignalsFinal) {
                    const result = matchSignalToLead(signal, lead, displayIndustryName);
                    if (!result.matched) continue;
                    // Business name matches always allowed; trend matches only for first lead
                    if (result.type === 'industry_trend' && trendBonusAwarded) continue;
                    if (result.bonus > bestBonus) {
                        bestMatch = signal;
                        bestBonus = result.bonus;
                    }
                }
                if (bestMatch && bestBonus > 0) {
                    const isTrend = bestBonus < 10;
                    if (isTrend) trendBonusAwarded = true;
                    lead.newsSignal = {
                        title: bestMatch.title,
                        type: isTrend ? 'trend' : classifySignalType(bestMatch),
                        daysAgo: bestMatch.daysAgo || null,
                        matchType: isTrend ? 'industry_trend' : 'business_name'
                    };
                }
            });
            const matched = serperLeads.filter(l => l.newsSignal).length;
            console.log(`[MarketIntel] News signal cross-reference: ${matched} leads matched (name or industry keyword, trend bonus awarded once)`);
        }

        // Opportunity Score v2 — 5-component formula applied to leads
        const marketAvg = { avgSEOScore: seoLandscape?.avgSEOScore || 65 };
        serperLeads = scoreLeads(serperLeads, marketAvg, reviewCeiling);

        // Deduplicate after scoring — keep higher-scoring instance
        const preDedup = serperLeads.length;
        serperLeads = deduplicateLeads(serperLeads);
        if (serperLeads.length < preDedup) {
            console.log(`[MarketIntel] Lead dedup: ${preDedup} → ${serperLeads.length} (${preDedup - serperLeads.length} duplicates removed)`);
        }
        // Also deduplicate competitors
        const preCompDedup = competitors.length;
        competitors = deduplicateCompetitors(competitors);
        if (competitors.length < preCompDedup) {
            console.log(`[MarketIntel] Competitor dedup: ${preCompDedup} → ${competitors.length}`);
        }

        // Velocity trend — compare with most recent previous report for same market
        try {
            const normalizedIndustry = (displayIndustryName || '').toLowerCase().trim();
            const normalizedCity = (city || '').toLowerCase().trim();
            if (normalizedIndustry && normalizedCity && !refreshId) {
                const prevSnap = await db.collection('marketReports')
                    .where('userId', '==', userId)
                    .where('location.city', '==', city)
                    .orderBy('createdAt', 'desc')
                    .limit(2)
                    .get();
                const prevReports = prevSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(r => (r.industry?.display || '').toLowerCase().trim() === normalizedIndustry);
                if (prevReports.length > 0) {
                    const prev = prevReports[0];
                    const prevDate = prev.createdAt?.toDate?.() || prev.createdAt;
                    const daysBetween = prevDate ? Math.floor((Date.now() - new Date(prevDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                    if (daysBetween >= 14 && prev.data?.leads?.length) {
                        const normalize = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const trendMap = calculateVelocityTrend(serperLeads, prev.data.leads, daysBetween);
                        let trendCount = 0;
                        serperLeads.forEach(lead => {
                            const key = normalize(lead.name);
                            if (trendMap.has(key)) {
                                lead.velocityTrend = trendMap.get(key);
                                trendCount++;
                            }
                        });
                        console.log(`[MarketIntel] Velocity trend: ${trendCount} leads matched from report ${daysBetween}d ago`);
                    }
                }
            }
        } catch (vtErr) {
            console.warn('[MarketIntel] Velocity trend comparison failed:', vtErr.message);
        }

        // Generate Intel Signals per lead (replaces generic pitch hooks)
        serperLeads = serperLeads.map(lead => {
            const intelSignal = generateIntelSignal(lead, benchmarks);
            return { ...lead, intelSignal, pitchHook: intelSignal };
        });

        // Calculate Share of Voice — review volume as % of total market social proof
        const allBiz = [...(competitors || []), ...(serperLeads || [])];
        const sovSeen = new Set();
        const uniqueBiz = allBiz.filter(b => {
            const key = (b.name || '').toLowerCase().trim();
            if (sovSeen.has(key)) return false;
            sovSeen.add(key);
            return true;
        });
        const totalMarketReviews = uniqueBiz.reduce((sum, b) =>
            sum + (parseInt(b.reviewCount) || parseInt(b.reviews) || 0), 0);

        (competitors || []).forEach(c => {
            const r = parseInt(c.reviewCount) || parseInt(c.reviews) || 0;
            c.shareOfVoice = totalMarketReviews > 0 ? ((r / totalMarketReviews) * 100) : 0;
        });
        serperLeads.forEach(l => {
            const r = parseInt(l.reviewCount) || parseInt(l.reviews) || 0;
            l.shareOfVoice = totalMarketReviews > 0 ? ((r / totalMarketReviews) * 100) : 0;
        });

        const sovLeader = uniqueBiz.sort((a, b) => (b.shareOfVoice || 0) - (a.shareOfVoice || 0))[0];
        reportData.data.shareOfVoice = {
            totalMarketReviews,
            businessCount: uniqueBiz.length,
            leaderShare: sovLeader?.shareOfVoice || 0,
            leaderName: sovLeader?.name || 'Unknown'
        };

        // Build positioning matrix data (includes share of voice)
        const matrixLeader = [...competitors].sort((a, b) => {
            const rd = (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
            if (rd !== 0) return rd;
            return (parseInt(b.reviewCount || b.reviews) || 0) - (parseInt(a.reviewCount || a.reviews) || 0);
        })[0];
        reportData.data.positioningMatrix = {
            competitors: (competitors || []).slice(0, 20).map(c => ({
                name: c.name, rating: parseFloat(c.rating) || 0,
                reviews: parseInt(c.reviewCount) || parseInt(c.reviews) || 0,
                shareOfVoice: c.shareOfVoice || 0
            })),
            leads: serperLeads.map(l => ({
                name: l.name, rating: parseFloat(l.rating) || 0,
                reviews: parseInt(l.reviewCount) || parseInt(l.reviews) || 0,
                score: l.opportunityScore || 0, shareOfVoice: l.shareOfVoice || 0
            })),
            marketLeader: matrixLeader ? {
                name: matrixLeader.name,
                rating: parseFloat(matrixLeader.rating) || 0,
                reviews: parseInt(matrixLeader.reviewCount) || parseInt(matrixLeader.reviews) || 0,
                shareOfVoice: matrixLeader.shareOfVoice || 0
            } : null,
            averages: { rating: parseFloat(benchmarks?.avgRating) || 0, reviews: parseInt(benchmarks?.avgReviews) || 0 },
            opportunityZone: verticalConfig ? {
                maxReviews: verticalConfig.reviewCountCeiling || 500,
                minRating: 4.0
            } : { maxReviews: 500, minRating: 4.0 }
        };

        console.log(`[MarketIntel] Share of voice: ${totalMarketReviews} total reviews, leader=${sovLeader?.name} at ${(sovLeader?.shareOfVoice || 0).toFixed(1)}%`);

        // FIX A-1: Back-fill shareOfVoice onto the already-built reportData.data.competitors array
        // (reportData.data.competitors was snapshotted before SOV was computed)
        if (reportData.data.competitors && reportData.data.competitors.length > 0) {
            reportData.data.competitors = reportData.data.competitors.map(rc => {
                const match = competitors.find(c => (c.name || '').toLowerCase().trim() === (rc.name || '').toLowerCase().trim());
                return { ...rc, shareOfVoice: match ? (match.shareOfVoice || 0) : 0 };
            });
        }

        // Update leads in reportData
        reportData.data.leads = serperLeads;
        reportData.data.leadCount = serperLeads.length;

        // AI industry context — append precision targeting if user answered questions
        // Sprint 2: also append industry-specific profile context for Gemini prompt shaping
        const aiIndustryContext = precisionContext
            ? `${displayIndustryName}${precisionContext}${profileContext}`
            : `${displayIndustryName}${profileContext}`;

        // Decision maker enrichment for qualified leads (Gemini-powered, parallel with AI block)
        // Runs in background — doesn't block the AI parallel block below
        const dmEnrichmentPromise = (async () => {
            try {
                const dmResults = await Promise.allSettled(
                    serperLeads.slice(0, 10).map(lead =>
                        Promise.race([
                            enrichDecisionMaker(lead, { city: city || '', state: state || '' }),
                            new Promise(resolve => setTimeout(() => resolve(null), 3000))
                        ])
                    )
                );
                let enrichedCount = 0;
                serperLeads.forEach((lead, i) => {
                    if (i < 10 && dmResults[i]?.status === 'fulfilled' && dmResults[i].value) {
                        lead.decisionMaker = dmResults[i].value;
                        // Also set ownerName/ownerTitle for backward compat with frontend
                        if (!lead.ownerName) {
                            lead.ownerName = dmResults[i].value.name;
                            lead.ownerTitle = dmResults[i].value.title;
                        }
                        enrichedCount++;
                    }
                });
                console.log(`[MarketIntel] Decision maker enrichment: ${enrichedCount}/${Math.min(serperLeads.length, 10)} leads`);
            } catch (e) {
                console.warn('[MarketIntel] Decision maker enrichment failed:', e.message);
            }
        })();

        // S3: Reference competitors — fetch before parallel block so narrative can distinguish groups
        let referenceCompetitors = [];
        try {
            const localNames = [
                ...(competitors || []).map(c => c.name),
                ...(serperLeads || []).map(l => l.name)
            ].filter(Boolean);
            const rawRefPlayers = await generateReferenceCompetitors(
                city || '', displayIndustryName || industry || '', subIndustry || '', localNames
            );
            // Deduplicate: drop any reference player whose normalized name matches a local result
            const localNamesNorm = new Set(localNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, '')));
            referenceCompetitors = rawRefPlayers.filter(r => {
                const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                return !localNamesNorm.has(norm) && !Array.from(localNamesNorm).some(ln => ln.includes(norm.slice(0, 6)) && norm.length > 5 && ln.length > 5);
            });
            console.log(`[MarketIntel] Reference competitors: ${referenceCompetitors.length} (${rawRefPlayers.length - referenceCompetitors.length} deduped)`);
        } catch (refErr) {
            console.warn('[MarketIntel] Reference competitors failed (non-blocking):', refErr.message);
        }

        // Generate AI executive summary, competitor analysis, demographics, trends, sales intel, SWOT in parallel
        const [aiSummary, aiCompetitorAnalysis, demographicsCommunities, marketTrends, salesIntelResult, swotResult] = await Promise.allSettled([
            generateAIExecutiveSummary(
                city || zipCode || '', aiIndustryContext,
                competitors, serperLeads, newsSignalsFinal, benchmarks
            ),
            generateCompetitorAnalysis(city || zipCode || '', aiIndustryContext, competitors, benchmarks, seoLandscape, referenceCompetitors),
            serperClient.searchFastestGrowingCommunities(city || '', state || '', displayIndustryName),
            serperClient.searchMarketTrends(city || '', state || '', displayIndustryName),
            generateSalesIntel(city || '', aiIndustryContext, competitors, serperLeads, null, benchmarks, newsSignalsFinal, verticalConfig),
            benchmarks
                ? generateSWOT(city || '', aiIndustryContext, competitors, benchmarks, serperLeads, null)
                : Promise.resolve(null)
        ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

        // Generate recommendations + high-impact moves in parallel
        let aiRecommendations = null;
        let highImpactMoves = null;
        try {
            const [recResult, movesResult] = await Promise.allSettled([
                generateRecommendations(city || '', aiIndustryContext, serperLeads, benchmarks, salesIntelResult, marketTrends),
                generateHighImpactMoves(city || '', aiIndustryContext, competitors, serperLeads, benchmarks, newsSignalsFinal, verticalConfig)
            ]);
            aiRecommendations = recResult.status === 'fulfilled' ? recResult.value : null;
            highImpactMoves = movesResult.status === 'fulfilled' ? movesResult.value : null;
        } catch (recErr) {
            console.warn('[MarketIntel] Recommendations/Moves generation failed:', recErr.message);
        }

        // Intent Signals — fail-safe, 12s timeout, does not block report generation
        let intentSignalsResult = null;
        try {
            const intentVertical = (verticalConfig && verticalConfig.key) || industry || '';
            const intentContext  = { leads: serperLeads };
            intentSignalsResult = await Promise.race([
                generateIntentSignals(intentVertical, city || '', state || '', reportRef.id, userId, intentContext),
                new Promise(resolve => setTimeout(() => resolve(null), 12000))
            ]);
            if (intentSignalsResult && intentSignalsResult.creditBlocked) {
                console.warn('[MarketIntel] Intent signals blocked by credits — omitting from report');
                intentSignalsResult = null;
            }
            if (intentSignalsResult) {
                console.log(`[MarketIntel] Intent signals: score=${intentSignalsResult.intentScore && intentSignalsResult.intentScore.score}, fromCache=${intentSignalsResult.fromCache}`);
            }
        } catch (isErr) {
            console.warn('[MarketIntel] Intent signals failed (non-blocking):', isErr.message);
        }

        // Attach enrichment data to reportData
        // FIX 7: Apply growth signal noise filter before storing
        if (demographicsCommunities && Array.isArray(demographicsCommunities.growthSignals)) {
            demographicsCommunities.growthSignals = filterGrowthSignals(demographicsCommunities.growthSignals);
        }
        reportData.data.demographicsCommunities = demographicsCommunities || null;

        // Enrich demographics with Census data + structured growth parsing
        try {
            const commData = demographicsCommunities || {};
            const demoEnriched = await enrichDemographics(
                city || '', state || '',
                commData.topCommunities || [],
                commData.growthSignals || []
            );
            reportData.data.demographicsEnriched = demoEnriched;
            if (demoEnriched.cityDemographics) {
                console.log(`[MarketIntel] Census data: pop=${demoEnriched.cityDemographics.population}, income=${demoEnriched.cityDemographics.medianIncome}`);
            }
        } catch (demoErr) {
            console.warn('[MarketIntel] Demographics enrichment failed:', demoErr.message);
            reportData.data.demographicsEnriched = null;
        }

        reportData.data.trends = marketTrends || null;
        reportData.data.salesIntel = salesIntelResult || null;
        reportData.data.aiRecommendations = aiRecommendations || null;
        reportData.data.highImpactMoves = highImpactMoves || null;
        reportData.data.swotAnalysis = swotResult || null;
        reportData.data.intentSignals = intentSignalsResult || null;

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

        // Handle new JSON structure from competitor analysis (narrative + competitorTypes)
        if (aiCompetitorAnalysis && typeof aiCompetitorAnalysis === 'object' && aiCompetitorAnalysis.narrative) {
            reportData.data.competitorAnalysis = aiCompetitorAnalysis.narrative;
            reportData.data.competitorTypes = aiCompetitorAnalysis.competitorTypes || [];
        } else {
            reportData.data.competitorAnalysis = aiCompetitorAnalysis || null;
            reportData.data.competitorTypes = [];
        }

        // S3: Store reference competitors (already deduplicated above)
        reportData.data.referenceCompetitors = referenceCompetitors.length > 0 ? referenceCompetitors : null;

        // Await decision maker enrichment before saving (was running in parallel with AI block)
        await dmEnrichmentPromise;

        // Enterprise mode: theorg.com as PRIMARY org chart source for top 10 leads
        if (isEnterpriseMode && enterpriseVertical) {
            try {
                const orgChartResults = await Promise.allSettled(
                    serperLeads.slice(0, 10).map(lead =>
                        Promise.race([
                            getOrgChart(lead.name, city || '', enterpriseVertical.theorgTitles),
                            new Promise(resolve => setTimeout(() => resolve(null), 5000))
                        ])
                    )
                );
                let orgCount = 0;
                serperLeads.forEach((lead, i) => {
                    if (i < 10 && orgChartResults[i]?.status === 'fulfilled' && orgChartResults[i].value) {
                        lead.orgChart = orgChartResults[i].value;
                        orgCount++;
                    }
                });
                console.log(`[MarketIntel] Enterprise org chart: ${orgCount}/${Math.min(serperLeads.length, 10)} leads`);
            } catch (orgErr) {
                console.warn('[MarketIntel] Enterprise org chart enrichment failed:', orgErr.message);
            }
        }

        // LinkedIn URL + Time in Business enrichment (parallel, 3s timeout each)
        try {
            const leadsWithDM = serperLeads.filter(l => l.decisionMaker?.name).slice(0, 10);
            const leadsForTime = serperLeads.slice(0, 10);

            const [liResultsArr, tibResultsArr] = await Promise.allSettled([
                // LinkedIn URLs
                leadsWithDM.length > 0
                    ? Promise.allSettled(leadsWithDM.map(lead =>
                        Promise.race([
                            findLinkedInURL(lead.decisionMaker.name, lead.name, city || ''),
                            new Promise(resolve => setTimeout(() => resolve(null), 3000))
                        ])
                    ))
                    : Promise.resolve([]),
                // Time in Business
                Promise.allSettled(leadsForTime.map(lead =>
                    Promise.race([
                        findTimeInBusiness(lead.name, city || '', state || ''),
                        new Promise(resolve => setTimeout(() => resolve(null), 3000))
                    ])
                ))
            ]);

            // Apply LinkedIn results
            const liResults = liResultsArr.status === 'fulfilled' ? liResultsArr.value : [];
            let liCount = 0;
            leadsWithDM.forEach((lead, i) => {
                if (liResults[i]?.status === 'fulfilled' && liResults[i].value) {
                    lead.linkedIn = liResults[i].value;
                    if (!lead.linkedInUrl) lead.linkedInUrl = liResults[i].value.url;
                    liCount++;
                }
            });

            // Apply Time in Business + velocity classification
            const tibResults = tibResultsArr.status === 'fulfilled' ? tibResultsArr.value : [];
            let tibCount = 0;
            leadsForTime.forEach((lead, i) => {
                if (tibResults[i]?.status === 'fulfilled' && tibResults[i].value) {
                    const tib = tibResults[i].value;
                    lead.timeInBusiness = tib;
                    const rc = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
                    lead.reviewVelocity = classifyVelocity(rc, tib.years);
                    tibCount++;
                }
            });

            console.log(`[MarketIntel] LinkedIn: ${liCount}/${leadsWithDM.length}, Time in Biz: ${tibCount}/${leadsForTime.length}`);
        } catch (liErr) {
            console.warn('[MarketIntel] LinkedIn/TimeInBiz enrichment failed:', liErr.message);
        }

        // Website traffic tier enrichment (parallel, 3s timeout each)
        try {
            const trafficLeads = serperLeads.slice(0, 10);
            const trafficResults = await Promise.allSettled(
                trafficLeads.map(lead =>
                    Promise.race([
                        serperClient.getWebsiteTrafficTier(lead),
                        new Promise(resolve => setTimeout(() => resolve({ tier: 'unknown', label: 'Unknown', signal: false }), 3000))
                    ])
                )
            );
            let trafficCount = 0;
            trafficLeads.forEach((lead, i) => {
                if (trafficResults[i]?.status === 'fulfilled' && trafficResults[i].value) {
                    lead.trafficTier = trafficResults[i].value;
                    trafficCount++;
                }
            });
            console.log(`[MarketIntel] Traffic tier: ${trafficCount}/${trafficLeads.length} leads`);
        } catch (trafficErr) {
            console.warn('[MarketIntel] Traffic tier enrichment failed:', trafficErr.message);
        }

        // S2: Product Wedge — attach to every qualified lead (never competitors/referenceCompetitors)
        try {
            serperLeads.forEach(function(lead) {
                lead.productWedge = computeProductWedge(lead, benchmarks);
            });
            console.log('[MarketIntel] Product wedge: computed for ' + serperLeads.length + ' leads');
        } catch (wedgeErr) {
            console.warn('[MarketIntel] Product wedge computation failed (non-blocking):', wedgeErr.message);
        }

        reportData.data.leads = serperLeads;

        // S1: Market Definition & Query Transparency
        try {
            reportData.data.marketDefinition = buildMarketDefinition({
                industryLabel: displayIndustryName || industry || '',
                subIndustryLabel: subIndustry || '',
                subIndustryId: subIndustryConfig?.id || '',
                city: city || '',
                state: state || '',
                taxonomyQueries: taxonomyQueries || [],
                competitors: competitors || [],
                leads: serperLeads || []
            });
            console.log(`[MarketIntel] Market definition: confidence=${reportData.data.marketDefinition.categoryConfidence}, queries=${reportData.data.marketDefinition.queries.length}`);
        } catch (mdErr) {
            console.warn('[MarketIntel] Market definition build failed (non-blocking):', mdErr.message);
        }

        // Attach enterprise context if in enterprise mode
        if (isEnterpriseMode && enterpriseVertical) {
            reportData.data.enterpriseMode = true;
            reportData.data.enterpriseVertical = {
                key: req.body.enterpriseVertical,
                label: enterpriseVertical.vertical,
                primaryBuyer: enterpriseVertical.primaryBuyer,
                salesCycle: enterpriseVertical.salesCycleMonths,
                competitiveDimensions: enterpriseVertical.competitiveDimensions,
                procurementSignals: enterpriseVertical.procurementSignals
            };
            if (req.body.enterpriseTargetAccounts) {
                reportData.data.enterpriseTargetAccounts = req.body.enterpriseTargetAccounts;
            }
        }

        // Extract 10-K/10-Q signals if filing uploaded (enterprise mode)
        if (isEnterpriseMode && req.body.filingPath && enterpriseVertical) {
            try {
                const financialSignals = await extract10KSignals(req.body.filingPath, enterpriseVertical);
                if (financialSignals) {
                    reportData.data.financialSignals = financialSignals;
                    console.log(`[MarketIntel] 10-K signals: ${financialSignals.financialSignals?.length || 0} signals, relevance ${financialSignals.keyMetrics?.relevanceScore || 0}`);
                }
            } catch (tenKErr) {
                console.warn('[MarketIntel] 10-K extraction failed:', tenKErr.message);
            }
        }

        // Safety & Local Operating Context — non-blocking, requires ZIP code
        // Resolve ZIP from competitor/lead addresses when not provided by user
        let resolvedZip = zipCode || '';
        if (!resolvedZip) {
            const stateUpper = (state || '').toUpperCase().trim();
            const cityLower = (city || '').toLowerCase().trim();
            const addrSources = [
                ...(competitors || []).map(c => c.address || ''),
                ...(serperLeads || []).map(l => l.address || l.formatted_address || l.vicinity || '')
            ];
            for (const addr of addrSources) {
                const addrUpper = addr.toUpperCase();
                // Only use ZIP if address contains the target state abbreviation (avoids wrong-state ZIPs)
                if (stateUpper && !addrUpper.includes(`, ${stateUpper}`) && !addrUpper.includes(` ${stateUpper} `)) continue;
                const m = addr.match(/\b(\d{5})(?:-\d{4})?\b/);
                if (m) { resolvedZip = m[1]; break; }
            }
        }
        // Geocoding fallback: city+state → ZIP via Google Geocoding API (Places key reused)
        if (!resolvedZip && city && state) {
            try {
                const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${state}`)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
                const geoRes = await fetch(geoUrl);
                const geoData = await geoRes.json();
                if (geoData.results?.[0]?.address_components) {
                    const zipComp = geoData.results[0].address_components.find(c => c.types.includes('postal_code'));
                    if (zipComp) {
                        resolvedZip = zipComp.long_name;
                        console.log(`[MarketIntel] ZIP resolved via geocoding: ${resolvedZip}`);
                    }
                }
            } catch (geoErr) {
                console.warn('[MarketIntel] Geocoding ZIP fallback failed:', geoErr.message);
            }
        }
        console.log(`[MarketIntel] Safety ZIP resolved: ${resolvedZip || 'none'}`);
        try {
            const safetyContext = await getSafetyContext({ zipCode: resolvedZip, state: state || '' }, displayIndustryName);
            if (safetyContext) {
                // Generate narrative from raw data (non-blocking, fail-safe)
                try {
                    const narratives = await generateSafetyContextNarrative(safetyContext, {
                        businessName: city || displayIndustryName,
                        category: displayIndustryName,
                        city: city || '',
                        state: state || ''
                    });
                    safetyContext.narratives = narratives;
                } catch (narErr) {
                    console.warn('[MarketIntel] Safety narrative generation failed (non-blocking):', narErr.message);
                    safetyContext.narratives = null;
                }
                reportData.safetyContext = safetyContext;
                console.log(`[MarketIntel] Safety context: status=${safetyContext.status}, confidence=${safetyContext.confidence}`);
            } else {
                reportData.safetyContext = null;
            }
        } catch (safetyErr) {
            console.warn('[MarketIntel] Safety context fetch failed (non-blocking):', safetyErr.message);
            reportData.safetyContext = null;
        }

        // ─── Market Intelligence Enhancement: Strategic Thesis, Roadmap, KPI Scorecard ───
        // FIX A-3: Profile-based gapLabel fallback helper
        function deriveGapLabelFromProfile(profileKey) {
            const defaults = {
                'default_local_business': 'Market Opportunity',
                'b2b_services': 'Digital Authority Gap',
                'government_public_sector': 'Citizen Engagement Gap',
                'nonprofit_association': 'Community Visibility Gap'
            };
            return defaults[profileKey] || 'Opportunity Zone';
        }

        // FIX 1: Deterministic fallback thesis when Gemini call fails or returns empty thesis
        function buildFallbackThesis(rData) {
            const mb = getBenchmarks(rData);
            const fallbackCity = rData.location && rData.location.city ? rData.location.city : (rData.city || 'this market');
            const fallbackIndustry = rData.industry && (rData.industry.display || rData.industry.name) ? (rData.industry.display || rData.industry.name) : (rData.industryLabel || rData.industry || 'this industry');
            return 'The ' + fallbackIndustry + ' market in ' + fallbackCity + ' shows ' + (mb.totalCompetitors || 'multiple') + ' established competitors, with a clear gap for a differentiated entrant focused on quality and digital authority. Market leaders hold significant review volume advantage, creating an opportunity for challengers to capture underserved segments through targeted outreach and stronger proof of value.';
        }

        // FIX A-5: Roadmap deterministic fallback helper
        function deriveRoadmapFromHighImpactMoves(highImpactMoves) {
            if (!highImpactMoves || highImpactMoves.length === 0) return [];
            return [
                {
                    phase: 1, name: 'Foundation', timeframe: 'Days 1-30',
                    focus: highImpactMoves[0]?.title || highImpactMoves[0]?.action || 'Initial outreach and discovery',
                    actions: [highImpactMoves[0]?.action || 'Contact top qualified lead'].filter(Boolean),
                    milestone: 'Discovery calls booked',
                    pathsynchProduct: 'LocalSynch'
                },
                {
                    phase: 2, name: 'Amplification', timeframe: 'Days 31-60',
                    focus: highImpactMoves[1]?.title || 'Reputation and case study amplification',
                    actions: [highImpactMoves[1]?.action || 'Audit and optimize digital presence'].filter(Boolean),
                    milestone: 'Profile optimization complete',
                    pathsynchProduct: 'PathConnect'
                },
                {
                    phase: 3, name: 'Scale', timeframe: 'Days 61-90',
                    focus: highImpactMoves[2]?.title || 'Outbound and targeted campaigns',
                    actions: [highImpactMoves[2]?.action || 'Launch targeted outreach sequence'].filter(Boolean),
                    milestone: 'Pipeline building',
                    pathsynchProduct: 'SynchIntro'
                },
                {
                    phase: 4, name: 'Authority', timeframe: 'Months 4-6',
                    focus: highImpactMoves[3]?.title || 'Category authority and thought leadership',
                    actions: [highImpactMoves[3]?.action || 'Establish category leadership position'].filter(Boolean),
                    milestone: 'Market authority established',
                    pathsynchProduct: null
                }
            ];
        }

        const reportProfileKey = industryConfig?.reportProfile || 'default_local_business';

        // FIX A-4: Always compute deterministic KPI scorecard BEFORE enhancement call
        const deterministicKpisBase = computeKpiScorecard(reportData);
        // Set as fallback immediately — enhancement call will override if it succeeds
        reportData.kpiScorecard = deterministicKpisBase;

        // FIX A-5: Always set roadmap fallback BEFORE enhancement call
        reportData.strategicRoadmap = deriveRoadmapFromHighImpactMoves(highImpactMoves);

        // FIX A-3: Always set thesis fallback BEFORE enhancement call
        // FIX 1: Use buildFallbackThesis so thesis is never blank
        reportData.strategicMarketThesis = {
            title: 'Strategic Market Thesis',
            thesis: buildFallbackThesis(reportData),
            gapLabel: deriveGapLabelFromProfile(reportProfileKey)
        };

        // Non-blocking: if this fails the report still saves without the new fields
        try {
            // Build context summary from already-computed data
            const topLeadNames = (serperLeads || []).slice(0, 5).map(l => l.name).filter(Boolean).join(', ');
            const topCompNames = (competitors || []).slice(0, 5).map(c => c.name).filter(Boolean).join(', ');
            const ctxAvgRating = benchmarks && benchmarks.avgRating ? benchmarks.avgRating : 'N/A';
            const ctxAvgReviews = benchmarks && benchmarks.avgReviews ? benchmarks.avgReviews : 'N/A';
            const ctxMarketLeader = benchmarks && benchmarks.marketLeader ? benchmarks.marketLeader : 'N/A';
            const ctxSeoScore = seoLandscape && seoLandscape.avgSEOScore ? seoLandscape.avgSEOScore : 'N/A';
            const ctxLeadCount = (serperLeads || []).length;
            const ctxSaturation = reportData.data && reportData.data.saturation ? reportData.data.saturation : 'N/A';
            const ctxHimTitles = (highImpactMoves || []).slice(0, 3).map(m => m.title).filter(Boolean).join('; ');
            const ctxProfileInjection = reportProfile && reportProfile.promptInjection ? reportProfile.promptInjection : '';

            const enhancementSystemPrompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a strategic market analyst generating three data-driven sections for a Market Intelligence Report.
${ctxProfileInjection ? '\n' + ctxProfileInjection + '\n' : ''}
ROADMAP RULES:
- Every action MUST tie back to a specific finding, business, or metric from THIS report
- Phase 1 (Days 1-30): quick wins — review capture, proof audit, profile optimization
- Phase 2 (Days 31-60): amplification — case studies, reputation building, content
- Phase 3 (Days 61-90): outbound — CRM sequences, landing pages, targeted outreach
- Phase 4 (Months 4-6): authority — category leadership, thought leadership, market position
- Include PathSynch product references (LocalSynch, PathConnect, PathManager, QRsynch) where relevant and natural
- All actions must be specific to the market data provided, not generic advice`;

            const enhancementUserPrompt = `Market: ${city || zipCode || ''}, ${state || ''} — ${displayIndustryName}
Avg Rating: ${ctxAvgRating} | Avg Reviews: ${ctxAvgReviews} | Market Leader: ${ctxMarketLeader}
SEO Avg Score: ${ctxSeoScore}/100 | Market Saturation: ${ctxSaturation}
Qualified Leads Found: ${ctxLeadCount}
Top Leads (by opportunity score): ${topLeadNames || 'none'}
Top Competitors: ${topCompNames || 'none'}
Current High-Impact Moves: ${ctxHimTitles || 'none yet'}

Generate all three sections as a single JSON object:
{
  "strategicMarketThesis": {
    "title": "Strategic Market Thesis",
    "thesis": "2-3 sentence thesis on the core market opportunity, referencing specific data from this report",
    "gapLabel": "short label (2-4 words) for the opportunity zone, e.g. 'Authority Gap' or 'Review Gap'"
  },
  "strategicRoadmap": [
    { "phase": 1, "name": "Foundation", "timeframe": "Days 1-30", "focus": "short focus statement", "actions": ["specific action tied to this report", "another specific action"], "milestone": "measurable milestone", "pathsynchProduct": "most relevant PathSynch product name" },
    { "phase": 2, "name": "Amplification", "timeframe": "Days 31-60", "focus": "short focus statement", "actions": ["specific action", "specific action"], "milestone": "measurable milestone", "pathsynchProduct": "most relevant PathSynch product name" },
    { "phase": 3, "name": "Scale", "timeframe": "Days 61-90", "focus": "short focus statement", "actions": ["specific action", "specific action"], "milestone": "measurable milestone", "pathsynchProduct": "most relevant PathSynch product name" },
    { "phase": 4, "name": "Authority", "timeframe": "Months 4-6", "focus": "short focus statement", "actions": ["specific action", "specific action"], "milestone": "measurable milestone", "pathsynchProduct": "most relevant PathSynch product name" }
  ],
  "kpiInterpretations": [
    { "kpi": "Average Rating", "target": "5.0★ (e.g. '4.9★' or '5.0★' — specific star target for this market)", "whyItMatters": "1 sentence why this KPI matters for this specific market" },
    { "kpi": "Share of Voice", "target": "e.g. '10%' or '15%' — numeric share target based on market size", "whyItMatters": "1 sentence" },
    { "kpi": "Avg Review Count", "target": "e.g. '80 reviews' or '120 reviews' — numeric 90-day target", "whyItMatters": "1 sentence" },
    { "kpi": "SEO / Digital Authority", "target": "e.g. '80/100' or '75/100' — numeric score target", "whyItMatters": "1 sentence" },
    { "kpi": "Total Competitors", "target": "e.g. 'Track all ${ctxLeadCount} identified competitors' or 'Monitor top 10'", "whyItMatters": "1 sentence" },
    { "kpi": "Qualified Leads Found", "target": "e.g. '5+ converted' or '3 signed in 90 days'", "whyItMatters": "1 sentence" }
  ]
}`;

            const enhancementModel = genAI.getGenerativeModel({
                model: 'gemini-3-flash-preview',
                generationConfig: {
                    thinkingConfig: { thinkingBudget: 0 },
                    temperature: 0.7,
                    maxOutputTokens: 2000
                }
            });

            const enhancementResult = await Promise.race([
                enhancementModel.generateContent({
                    contents: [{ role: 'user', parts: [{ text: enhancementSystemPrompt + '\n\n' + enhancementUserPrompt }] }]
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('enhancement timeout')), 15000))
            ]);

            const enhancementText = enhancementResult.response.text();
            console.log('[MarketIntel] Enhancement Gemini call starting...');
            const eStart = enhancementText.indexOf('{');
            const eEnd = enhancementText.lastIndexOf('}');
            if (eStart !== -1 && eEnd !== -1) {
                const enhancementParsed = JSON.parse(enhancementText.substring(eStart, eEnd + 1));

                console.log('[MarketIntel] Enhancement result:', JSON.stringify({
                    hasThesis: !!enhancementParsed?.strategicMarketThesis,
                    hasRoadmap: Array.isArray(enhancementParsed?.strategicRoadmap),
                    roadmapLength: enhancementParsed?.strategicRoadmap?.length || 0,
                    hasKpiInterp: Array.isArray(enhancementParsed?.kpiInterpretations)
                }));

                // FIX A-4: Merge Gemini interpretations onto already-set deterministic KPIs
                if (enhancementParsed.kpiInterpretations) {
                    reportData.kpiScorecard = mergeKpiScorecard(deterministicKpisBase, enhancementParsed.kpiInterpretations);
                }

                // FIX A-3: Store Strategic Market Thesis with profile-based gapLabel fallback
                // FIX 1: Use buildFallbackThesis if Gemini returns empty thesis
                if (enhancementParsed.strategicMarketThesis) {
                    reportData.strategicMarketThesis = {
                        title: enhancementParsed.strategicMarketThesis.title || 'Strategic Market Thesis',
                        thesis: enhancementParsed.strategicMarketThesis.thesis || buildFallbackThesis(reportData),
                        gapLabel: enhancementParsed.strategicMarketThesis.gapLabel || deriveGapLabelFromProfile(reportProfileKey)
                    };
                }

                // FIX A-5: Validate and store Strategic Roadmap (fallback already set above)
                if (Array.isArray(enhancementParsed.strategicRoadmap) && enhancementParsed.strategicRoadmap.length >= 4) {
                    const validPhases = enhancementParsed.strategicRoadmap.filter(p =>
                        p && typeof p.phase === 'number' && p.name && Array.isArray(p.actions)
                    );
                    if (validPhases.length >= 4) {
                        reportData.strategicRoadmap = validPhases;
                    }
                }

                console.log(`[MarketIntel] Enhancement: thesis="${reportData.strategicMarketThesis && reportData.strategicMarketThesis.gapLabel}", roadmap phases=${reportData.strategicRoadmap && reportData.strategicRoadmap.length}, kpis=${reportData.kpiScorecard && reportData.kpiScorecard.length}`);
            }
        } catch (enhancementErr) {
            console.warn('[MarketIntel] Enhancement call failed (non-blocking):', enhancementErr.message);
            // Deterministic fallbacks remain set — report saves with them
        }
        // ─── end Market Intelligence Enhancement ──────────────────────────────

        // ─── PUBLIC DATA ENRICHMENT (non-blocking) ───
        try {
            const enrichmentResult = await enrichReportPublicData(reportData, industryConfig, {
                city: city,
                state: state,
                subIndustry: subIndustry,
                qualifiedLeads: reportData.qualifiedLeads || (reportData.data && reportData.data.leads) || []
            });
            if (enrichmentResult) {
                if (enrichmentResult.publicSectorIntelligence) {
                    reportData.publicSectorIntelligence = enrichmentResult.publicSectorIntelligence;
                }
                if (enrichmentResult.nonprofitFinancialIntelligence) {
                    reportData.nonprofitFinancialIntelligence = enrichmentResult.nonprofitFinancialIntelligence;
                }
                console.log('[MarketIntel] Public data enrichment added:', JSON.stringify({
                    hasGovData: !!enrichmentResult.publicSectorIntelligence,
                    hasNonprofitData: !!enrichmentResult.nonprofitFinancialIntelligence,
                    nonprofitMatchCount: enrichmentResult.nonprofitFinancialIntelligence && enrichmentResult.nonprofitFinancialIntelligence.leadMatches ? enrichmentResult.nonprofitFinancialIntelligence.leadMatches.length : 0
                }));
            }
        } catch (enrichErr) {
            console.error('[MarketIntel] Public data enrichment error (non-blocking):', enrichErr.message);
        }
        // ─── end Public Data Enrichment ──────────────────────────────────────

        // ─── VISIBILITY ENRICHMENT (non-blocking, feature-flagged) ───────────
        try {
            const visibilityResult = await enrichVisibility(reportData, {
                city:           city,
                state:          state,
                industry:       industry,
                subIndustry:    subIndustry,
                industryConfig: industryConfig,
                qualifiedLeads: reportData.qualifiedLeads || (reportData.data && reportData.data.leads) || []
            });
            if (visibilityResult) {
                if (visibilityResult.mapPackIntelligence)      reportData.mapPackIntelligence      = visibilityResult.mapPackIntelligence;
                if (visibilityResult.adSpendIntelligence)      reportData.adSpendIntelligence      = visibilityResult.adSpendIntelligence;
                if (visibilityResult.websiteConversionSignals) reportData.websiteConversionSignals = visibilityResult.websiteConversionSignals;
                if (visibilityResult.aiVisibilityIntelligence) reportData.aiVisibilityIntelligence = visibilityResult.aiVisibilityIntelligence;
                console.log('[MarketIntel] Visibility enrichment added:', JSON.stringify({
                    mapPack:    !!visibilityResult.mapPackIntelligence,
                    adSpend:    !!visibilityResult.adSpendIntelligence,
                    website:    !!visibilityResult.websiteConversionSignals,
                    aiVis:      !!visibilityResult.aiVisibilityIntelligence
                }));
            }
        } catch (visErr) {
            console.error('[MarketIntel] Visibility enrichment error (non-blocking):', visErr.message);
        }
        // ─── end Visibility Enrichment ────────────────────────────────────────

        // FIX A-7: Product recommendations fallback
        const DEFAULT_PATHSYNCH_PRODUCTS = [
            { name: 'LocalSynch', fit: 'High', price: '$99/mo', why: 'GBP optimization and local presence management' },
            { name: 'PathConnect', fit: 'High', price: '$149/mo', why: 'NFC review capture with QRsynch' },
            { name: 'PathManager', fit: 'Medium', price: '$199/mo', why: 'Merchant reputation and analytics dashboard' }
        ];
        if (reportData.productRecommendations && reportData.productRecommendations.length > 0) {
            reportData.productRecommendations = reportData.productRecommendations
                .filter(p => {
                    const name = p.name || p.product;
                    return name && name !== 'undefined' && name !== 'null';
                })
                .map(p => ({
                    name: p.name || p.product || 'Unknown',
                    fit: p.fit || 'Medium',
                    price: p.price || (p.monthlyPrice ? p.monthlyPrice + '/mo' : ''),
                    why: p.reasons || p.reason || p.description || p.why || ''
                }));
        }
        if (!reportData.productRecommendations || reportData.productRecommendations.length === 0) {
            reportData.productRecommendations = DEFAULT_PATHSYNCH_PRODUCTS;
        }

        // Atomically save report + increment usage (prevents race on credit quota)
        if (!refreshId) {
            const now = new Date();
            const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const usageId = `${userId}_${period}`;
            const usageRef = db.collection('usage').doc(usageId);
            try {
                await db.runTransaction(async (tx) => {
                    const usageSnap = await tx.get(usageRef);
                    const used = usageSnap.data()?.marketReportsThisMonth || 0;
                    if (!creditInfo.unlimited && used >= creditInfo.limit) {
                        throw new Error('LIMIT_REACHED');
                    }
                    tx.set(reportRef, reportData);
                    tx.set(usageRef, {
                        marketReportsThisMonth: admin.firestore.FieldValue.increment(1),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                });
            } catch (txErr) {
                if (txErr.message === 'LIMIT_REACHED') {
                    return res.status(403).json({
                        error: 'MARKET_REPORT_LIMIT_REACHED',
                        message: `Monthly limit of ${creditInfo.limit} reports reached.`
                    });
                }
                throw txErr;
            }
        } else {
            await reportRef.set(reportData);
        }

        // Non-blocking: sync top lead to Entity360 Account360
        // Fire and forget — never blocks report generation
        if (serperLeads.length > 0) {
            const topLead = serperLeads[0];
            syncReportToAccount360({
                reportId: reportRef.id,
                generatedAt: new Date().toISOString(),
                businessName: topLead.name,
                city: city || '',
                state: state || '',
                zip: zipCode || '',
                vertical: displayIndustryName || '',
                gbpUrl: topLead.gbpUrl || topLead.website || '',
                opportunityScore: topLead.opportunityScore || null,
                opportunityScoreRationale: topLead.opportunityRationale || '',
                opportunityScoreConfidence: 0.8,
                recommendedAngle: reportData.data?.salesIntel?.entryWedge || '',
                angleConfidence: 0.75,
                angleRationale: reportData.data?.salesIntel?.entryWedge || '',
                intelSignals: (topLead.intelSignal || '').split('\n').filter(Boolean),
                marketPosition: topLead.marketPosition || '',
                shareOfVoice: topLead.shareOfVoice || null,
                competitiveGapSummary: reportData.data?.competitorAnalysis || '',
                primaryPain: reportData.data?.salesIntel?.topPainPoints?.[0] || '',
                triggerEvents: reportData.data?.trends?.demandSignals || [],
                timingWindowSummary: reportData.data?.salesIntel?.bestTimeToCall || '',
                gbpCompletenessScore: topLead.gbpCompleteness?.score || null,
                gbpRating: parseFloat(topLead.rating) || null,
                gbpReviewCount: parseInt(topLead.reviewCount || topLead.reviews) || 0,
                reviewVelocity30d: topLead.reviewVelocity30d || 0,
                unansweredReviews: topLead.unansweredReviews || 0,
                responseRate: topLead.responseRate || null,
                localPresenceGapSummary: topLead.localPresenceGap || '',
                topWeakness: topLead.topWeakness || '',
                topOpportunity: topLead.topOpportunity || '',
                competitorDelta: topLead.competitorDelta || '',
                marketName: `${city || zipCode || ''} ${displayIndustryName || ''}`.trim(),
                topCompetitors: (competitors || []).slice(0, 5).map(c => ({
                    name: c.name, gbpRating: parseFloat(c.rating) || null,
                    gbpReviewCount: parseInt(c.reviewCount || c.reviews) || 0,
                    marketPosition: c.marketPosition || ''
                })),
                avgMarketRating: benchmarks?.avgRating || null,
                avgMarketReviewCount: benchmarks?.avgReviews || 0,
                marketLeader: benchmarks?.leader?.name || '',
                demographicSummary: reportData.data?.demographicsEnriched?.summary || '',
                highImpactMoves: reportData.data?.aiRecommendations?.priorityActions || [],
                marketContextSnapshot: reportData.executiveSummary || '',
                // Sprint 3: taxonomy metadata pass-through
                taxonomyVersion: TAXONOMY_VERSION,
                industryId: industryConfig?.id || null,
                industryLabel: displayIndustryName || null,
                subIndustryId: subIndustryConfig?.id || null,
                subIndustryLabel: subIndustry || null,
                scoringProfile: industryConfig?.scoringProfile || 'default_local_business',
                reportProfile: industryConfig?.reportProfile || 'default_local_business',
                searchQueryUsed: reportData.searchQueryUsed || null,
                benchmarkKey: benchmarkKey || null,
                reportProfileLanguage: {
                    competitorLanguage: reportProfile?.competitorLanguage || 'competitors',
                    opportunityLanguage: reportProfile?.opportunityLanguage || 'opportunity gap'
                }
            }).then(result => {
                if (result) console.log(`[Entity360] Account360 ${result.action}: ${result.accountId}`);
            }).catch(() => {});
        }

        // Non-blocking: write competitor validation log for allowlist tuning (first 30 days)
        if (validationMetadata && rejectedCompetitors.length > 0 && process.env.ENABLE_COMPETITOR_VALIDATION_LOGGING === 'true') {
            db.collection('competitorValidationLogs').add({
                reportId: reportRef.id,
                userId,
                industry: displayIndustryName,
                subIndustry: subIndustry || null,
                city: city || null,
                state: state || null,
                validationMetadata,
                rejectedSample: rejectedCompetitors.slice(0, 10).map(c => ({
                    name: c.name,
                    types: c.types || [],
                    reason: c.validation?.reason || null,
                    validationLayer: c.validation?.validationLayer || null
                })),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(logErr => console.warn('[CompetitorValidation] Log write failed:', logErr.message));
        }

        // Save custom sub-industry if provided (for future dropdown population)
        if (subIndustry) {
            await saveCustomSubIndustryInternal(userId, industry, subIndustry);
        }

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
                    competitorAnalysis: reportData.data.competitorAnalysis || null,
                    competitorTypes: reportData.data.competitorTypes || [],
                    competitors: competitors.slice(0, 10).map(c => ({
                        name: c.name || null,
                        rating: c.rating || null,
                        reviewCount: c.reviewCount || c.reviews || null,
                        address: c.address || null,
                        website: c.website || null
                    })),
                    leads: serperLeads,
                    newsSignals: newsSignalsFinal,
                    demographicsCommunities: demographicsCommunities || null,
                    demographicsEnriched: reportData.data.demographicsEnriched || null,
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

        // Write benchmark to Firestore for PathManager cross-product sync
        const benchmarkId = await writeMarketBenchmark(reportData, reportRef.id, city, state, displayIndustryName, subIndustry, reviewCeiling);
        if (benchmarkId) {
            reportData.data.benchmarkId = benchmarkId;
        }

        // Sprint 2: analytics event — structured log, non-blocking
        try {
            console.log(JSON.stringify({
                event: 'market_report_generated',
                industryId: industryConfig?.id,
                industryLabel: displayIndustryName,
                subIndustryId: subIndustryConfig?.id,
                subIndustryLabel: subIndustry,
                scoringProfile: industryConfig?.scoringProfile,
                reportProfile: industryConfig?.reportProfile,
                city, state,
                reportId: reportRef.id,
                benchmarkKey,
                timestamp: new Date().toISOString()
            }));
        } catch(e) { /* never block generation */ }

        // S0: Credibility guardrails — sanitize contradictions before template rendering
        try {
            sanitizeReport(reportData, new Date());
        } catch (sanitizeErr) {
            console.warn('[MarketIntel] Report sanitizer failed (non-blocking):', sanitizeErr.message);
        }

        // Build tiered response
        const response = buildTieredResponse(tier, reportRef.id, reportData);
        response.libraryItemId = libraryItemId;
        response.creditInfo = {
            used: (creditInfo.used || 0) + 1,  // Include this report
            limit: creditInfo.limit,
            unlimited: creditInfo.unlimited
        };

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

        // Include credit info for frontend display
        let creditInfo = null;
        try {
            const { getUserPlan: gup, getUserUsage: guu } = require('../middleware/planGate');
            const userPlan = await gup(userId);
            const userUsage = await guu(userId);
            const planLimits = getPlanLimits(userPlan);
            creditInfo = {
                used: userUsage.marketReportsThisMonth || 0,
                limit: planLimits.marketReportsPerMonth,
                unlimited: planLimits.marketReportsPerMonth === -1
            };
        } catch (creditErr) {
            console.warn('[MarketIntel] Credit info fetch failed:', creditErr.message);
        }

        return res.status(200).json({
            success: true,
            data: reports,
            creditInfo
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
async function fetchCompetitors({ dataSourceType, supportsPlaces, industryDetails, locationString, radius, naicsCode, city, state, industry, companySize = 'small', taxonomyQuery = null }) {
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

    // Hotfix: prefer taxonomy-aware query over NAICS placesKeyword for Places search
    const placesKeyword = taxonomyQuery || industryDetails?.placesKeyword;

    // 'places' industries always go to Google Places
    if (dataSourceType === 'places') {
        if (placesKeyword) {
            const result = await googlePlaces.findCompetitors(locationString, placesKeyword, radius);

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
        if (dataSourceType === 'limited' && placesKeyword) {
            console.log(`CoreSignal returned no results for ${naicsCode}, falling back to Google Places`);
            const placesResult = await googlePlaces.findCompetitors(locationString, placesKeyword, radius);

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
    if (supportsPlaces && placesKeyword) {
        const result = await googlePlaces.findCompetitors(locationString, placesKeyword, radius);

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
        executiveSummary: reportData.executiveSummary || null,
        // FIX A-2: Include strategic enhancement fields in API response
        strategicMarketThesis: reportData.strategicMarketThesis || null,
        kpiScorecard: reportData.kpiScorecard || null,
        strategicRoadmap: reportData.strategicRoadmap || null,
        productRecommendations: reportData.productRecommendations || null,
        safetyContext: reportData.safetyContext || null
    };

    // Public data enrichment fields (government / nonprofit only — null for all others)
    if (reportData.publicSectorIntelligence) baseResponse.publicSectorIntelligence = reportData.publicSectorIntelligence;
    if (reportData.nonprofitFinancialIntelligence) baseResponse.nonprofitFinancialIntelligence = reportData.nonprofitFinancialIntelligence;

    // Visibility enrichment fields (feature-flagged — null when not enabled)
    baseResponse.mapPackIntelligence      = reportData.mapPackIntelligence      || null;
    baseResponse.adSpendIntelligence      = reportData.adSpendIntelligence      || null;
    baseResponse.websiteConversionSignals = reportData.websiteConversionSignals || null;
    baseResponse.aiVisibilityIntelligence = reportData.aiVisibilityIntelligence || null;

    // Competitor validation fields
    baseResponse.validationMetadata  = reportData.data?.validationMetadata  || null;
    baseResponse.validationNotice     = reportData.data?.validationNotice    || null;

    // Starter tier - basic data only
    if (tier === 'starter') {
        return {
            ...baseResponse,
            data: {
                competitors: reportData.data.competitors,
                competitorCount: reportData.data.competitorCount,
                adjacentCompetitors: reportData.data.adjacentCompetitors || [],
                demographics: reportData.data.demographics,
                marketSize: reportData.data.marketSize,
                marketPerBusiness: reportData.data.marketPerBusiness,
                saturation: reportData.data.saturation,
                saturationScore: reportData.data.saturationScore,
                growthRate: reportData.data.growthRate,
                leads: reportData.data.leads,
                leadCount: reportData.data.leadCount,
                newsSignals: reportData.data.newsSignals,
                serperEnrichment: reportData.data.serperEnrichment,
                _emptyCompetitorMessage: reportData.data._emptyCompetitorMessage || null,
                marketDefinition: reportData.data.marketDefinition || null,
                referenceCompetitors: reportData.data.referenceCompetitors || null
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

/**
 * Generate precision targeting questions for a market report
 * AI-first with fallback to hardcoded vertical templates
 */
async function generatePrecisionQuestions(req, res) {
    try {
        const { industry, subIndustry, city, state } = req.body;
        if (!industry) {
            return res.status(400).json({ success: false, error: 'Industry is required' });
        }

        // Try AI-generated questions with 3s timeout
        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
            });

            const systemPrompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are generating 2 precision targeting questions for a Market Intelligence Report.
The user is targeting small, local, independent businesses.

Generate exactly 2 questions. Return JSON only.

{
  "questions": [
    {
      "id": "q1",
      "label": "Question text — concise, under 10 words",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "default": "Option 1",
      "injection": "sub_type_filter"
    },
    {
      "id": "q2",
      "label": "Question text",
      "options": ["Option A", "Option B", "Option C"],
      "default": "Option A",
      "injection": "pitch_angle"
    }
  ]
}

RULES:
${subIndustry ? `- The user already selected Sub-Industry = "${subIndustry}". DO NOT ask about service type or business category — they already told you.
- Q1 should ask about business SIZE, MODEL, or PRACTICE AREA within "${subIndustry}"
- Q2 should ask about PITCH ANGLE, TIMING, or GEOGRAPHIC focus` : `- Q1 always narrows WHAT TYPE of business within the vertical (sub-type precision)
- Q2 always narrows the APPROACH — neighborhood focus, pitch angle, or business size`}
- Options must be mutually exclusive
- Default should be the most common target for this vertical
- Keep labels under 10 words
- 3-5 options per question
- injection for Q1 must be "${subIndustry ? 'business_size_precision' : 'sub_type_filter'}"
- injection for Q2 can be "geographic_precision", "pitch_angle", "business_size_precision", "business_model_precision", "seasonal_precision", or "market_segment"`;

            const userPrompt = `Industry: ${industry}
Sub-Industry: ${subIndustry || 'General'}
City: ${city || 'Unknown'}, ${state || ''}

Generate 2 precision targeting questions for this market.${subIndustry ? ` Remember: sub-industry "${subIndustry}" is already selected — ask what it alone cannot answer.` : ''}`;

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 3000)
            );

            const aiPromise = model.generateContent({
                contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }]
            });

            const result = await Promise.race([aiPromise, timeoutPromise]);
            const text = result.response.text();
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const parsed = JSON.parse(text.substring(start, end + 1));
                if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length === 2) {
                    return res.json({ success: true, source: 'ai', ...parsed });
                }
            }
            throw new Error('Invalid AI response');
        } catch (aiErr) {
            // Fall through to templates
            console.warn('[MarketIntel] AI questions failed, using templates:', aiErr.message);
        }

        // Fallback to hardcoded templates
        const fallback = getVerticalQuestions(industry, subIndustry);
        return res.json({ success: true, source: 'template', ...fallback });
    } catch (error) {
        console.error('[MarketIntel] generatePrecisionQuestions error:', error);
        return res.status(500).json({ success: false, error: 'Failed to generate questions' });
    }
}

/**
 * Get fallback precision questions from hardcoded templates
 */
async function getPrecisionQuestionsFallback(req, res) {
    const industry = req.query.industry || '';
    const subIndustry = req.query.subIndustry || '';
    const fallback = getVerticalQuestions(industry, subIndustry);
    return res.json({ success: true, source: 'template', ...fallback });
}

/**
 * Get benchmark for a specific industry + location
 * GET /benchmarks/:industry/:city/:state
 */
async function getBenchmark(req, res) {
    try {
        const { industry, city, state } = req.params;
        if (!industry || !city || !state) {
            return res.status(400).json({ success: false, message: 'industry, city, and state are required' });
        }

        const docId = `${industry.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${city.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${state.toLowerCase()}`;
        const doc = await db.collection('marketBenchmarks').doc(docId).get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'No benchmark found for this market' });
        }

        const data = doc.data();
        // Check expiry
        if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
            return res.status(404).json({ success: false, message: 'Benchmark expired', expired: true });
        }

        return res.status(200).json({ success: true, benchmark: data });
    } catch (error) {
        console.error('[Benchmarks] getBenchmark error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch benchmark' });
    }
}

/**
 * Search benchmarks by industry and/or state
 * GET /benchmarks/search?industry=xxx&state=xx&limit=20
 */
async function searchBenchmarks(req, res) {
    try {
        const { industry, state, limit: limitParam } = req.query;
        const resultLimit = Math.min(parseInt(limitParam) || 20, 50);

        let query = db.collection('marketBenchmarks');

        if (industry) {
            query = query.where('industry', '==', industry);
        }
        if (state) {
            query = query.where('state', '==', state.toUpperCase());
        }

        // Only return non-expired
        query = query.where('expiresAt', '>', new Date());
        query = query.orderBy('expiresAt', 'desc').limit(resultLimit);

        const snapshot = await query.get();
        const benchmarks = [];
        snapshot.forEach(doc => {
            benchmarks.push({ id: doc.id, ...doc.data() });
        });

        return res.status(200).json({ success: true, benchmarks, count: benchmarks.length });
    } catch (error) {
        console.error('[Benchmarks] searchBenchmarks error:', error);
        return res.status(500).json({ success: false, message: 'Failed to search benchmarks' });
    }
}

/**
 * Refresh an existing market report — re-run pipeline with same params, write to same doc
 */
async function refreshReport(req, res) {
    const userId = req.userId;
    const reportId = req.params.reportId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        const reportDoc = await db.collection('marketReports').doc(reportId).get();
        if (!reportDoc.exists) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        const existing = reportDoc.data();
        if (existing.userId !== userId) {
            return res.status(403).json({ success: false, error: 'Not your report' });
        }

        // Credit gate — refresh counts against monthly report quota
        const plan = await getUserPlan(userId);
        if (hasFeature(plan, 'marketReports')) {
            const usage = await getUserUsage(userId);
            const limits = getPlanLimits(plan);
            if (limits.marketReportsPerMonth !== -1 && (usage.marketReportsThisMonth || 0) >= limits.marketReportsPerMonth) {
                return res.status(403).json({
                    error: 'MARKET_REPORT_LIMIT_REACHED',
                    message: `Monthly limit of ${limits.marketReportsPerMonth} reports reached.`
                });
            }
        }

        // Build request body from existing report params
        req.body = {
            city: existing.location?.city || null,
            state: existing.location?.state || null,
            zipCode: existing.location?.zipCode || null,
            industry: existing.industry?.display || existing.industry?.name || null,
            subIndustry: existing.industry?.subIndustry || null,
            radius: existing.radius || null,
            companySize: existing.companySize?.size || 'small',
            icpFilter: existing.data?.icpFilter || null,
            precisionQuestions: existing.data?.precisionQuestions || null,
            customIndustryName: existing.industry?.customName || null,
            _refreshReportId: reportId
        };

        // Re-run the full pipeline via generateReport
        return await generateReport(req, res);
    } catch (error) {
        console.error('[Refresh] Error:', error);
        return res.status(500).json({ success: false, error: 'Refresh failed', message: error.message });
    }
}

/**
 * Match a market report for pre-call brief auto-attach
 */
async function matchReport(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        const { city, state, industry } = req.query;
        const snapshot = await db.collection('marketReports')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        if (snapshot.empty) {
            return res.json({ success: true, match: null });
        }

        let best = null;
        let bestScore = 0;

        snapshot.forEach(doc => {
            const r = { id: doc.id, ...doc.data() };
            let score = 0;

            const rCity = (r.location?.city || '').toLowerCase();
            const rState = (r.location?.state || '').toLowerCase();
            const rIndustry = (r.industry?.display || r.industry?.name || '').toLowerCase();

            if (city && rCity === city.toLowerCase()) score += 40;
            if (state && rState === state.toLowerCase()) score += 20;
            if (industry && rIndustry.includes(industry.toLowerCase())) score += 30;

            // Penalize old reports
            const createdAt = r.createdAt?.toDate?.() || r.createdAt?._seconds ? new Date(r.createdAt._seconds * 1000) : new Date(r.createdAt || 0);
            const days = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            if (days > 30) score -= 20;
            if (days > 60) score -= 30;

            if (score > bestScore) {
                bestScore = score;
                best = {
                    id: doc.id,
                    industry: r.industry?.display || r.industry?.name || null,
                    city: r.location?.city || null,
                    state: r.location?.state || null,
                    generatedAt: createdAt.toISOString(),
                    leadsCount: r.data?.leads?.length || 0,
                    competitorCount: r.data?.competitorCount || 0
                };
            }
        });

        return res.json({
            success: true,
            match: bestScore >= 50 ? best : null,
            score: bestScore
        });
    } catch (error) {
        console.error('[MatchReport] Error:', error);
        return res.status(500).json({ success: false, error: 'Match failed' });
    }
}

/**
 * Handle 10-K/10-Q filing upload to Firebase Storage
 */
async function handleFilingUpload(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (req.file.size > 50 * 1024 * 1024) return res.status(400).json({ error: 'File too large (50MB max)' });
        if (!req.file.mimetype.includes('pdf')) return res.status(400).json({ error: 'PDF only' });

        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage();
        const bucket = storage.bucket();
        const filename = `filings/${req.userId}/${Date.now()}_${req.file.originalname}`;
        const file = bucket.file(filename);
        await file.save(req.file.buffer, { contentType: 'application/pdf' });

        return res.json({ success: true, filePath: filename, size: req.file.size });
    } catch (e) {
        console.error('[Filing] Upload error:', e);
        return res.status(500).json({ error: e.message });
    }
}

/**
 * Extract financial signals from a 10-K/10-Q filing using Gemini
 * @param {string} filingPath - Firebase Storage path
 * @param {Object} verticalContext - Enterprise vertical config with financialKeywords
 * @returns {Object|null} Extracted signals or null
 */
async function extract10KSignals(filingPath, verticalContext) {
    try {
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage();
        const bucket = storage.bucket();
        const [buffer] = await bucket.file(filingPath).download();

        // Try gemini-3.1-pro-preview first (larger context), fall back to gemini-3-flash-preview
        let modelName = 'gemini-3.1-pro-preview';
        try {
            const testModel = genAI.getGenerativeModel({ model: modelName });
            await testModel.generateContent({ contents: [{ role: 'user', parts: [{ text: 'test' }] }] });
        } catch {
            console.warn('[10K] gemini-3.1-pro-preview not available, falling back to gemini-3-flash-preview');
            modelName = 'gemini-3-flash-preview';
        }

        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `You are analyzing a financial filing (10-K or 10-Q) for a potential sales prospect.
Extract ONLY information relevant to these topics: ${verticalContext.financialKeywords.join(', ')}.

IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }.
Do not include any explanation or text outside the JSON.

{
  "companyName": "string",
  "filingType": "10-K or 10-Q",
  "filingPeriod": "Q3 2025 or FY2025 etc",
  "financialSignals": [
    {
      "signal": "exact quote or close paraphrase under 30 words",
      "category": "cost_pressure | efficiency_initiative | waste_mention | compliance | growth",
      "urgency": "high | medium | low",
      "pitchAngle": "one sentence on how the seller's product addresses this specific signal"
    }
  ],
  "keyMetrics": {
    "inventoryCostMentioned": false,
    "efficiencyInitiativeMentioned": false,
    "wasteReductionTargetMentioned": false,
    "relevanceScore": 0
  }
}

Return maximum 5 most relevant signals. If no relevant signals found, return empty financialSignals array with relevanceScore 0.`;

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
                    { text: prompt }
                ]
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 2000 }
        });

        const text = result.response.text();
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}') + 1;
        if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
        const parsed = JSON.parse(text.substring(jsonStart, jsonEnd));

        if (parsed.keyMetrics?.relevanceScore < 20 && (!parsed.financialSignals || parsed.financialSignals.length === 0)) {
            return null;
        }

        return parsed;
    } catch (e) {
        console.error('[10K] Extraction error:', e);
        return null;
    }
}

/**
 * Compare 2-4 market reports side-by-side with Gemini narrative
 */
async function compareReports(req, res) {
    try {
        const { reportIds } = req.query;
        if (!reportIds) return res.status(400).json({ error: 'reportIds required (comma-separated)' });

        const ids = reportIds.split(',').map(id => id.trim()).filter(Boolean);
        if (ids.length < 2 || ids.length > 4) return res.status(400).json({ error: 'Select 2-4 reports to compare' });

        const db = admin.firestore();
        const reports = await Promise.all(ids.map(async id => {
            const doc = await db.collection('marketReports').doc(id).get();
            if (!doc.exists) return null;
            return { id: doc.id, ...doc.data() };
        }));

        const validReports = reports.filter(Boolean);
        if (validReports.length < 2) return res.status(404).json({ error: 'Could not find enough reports' });

        // Block cross-industry comparison
        const industries = [...new Set(validReports.map(r => (r.industry || r.data?.industry || '').toLowerCase()))];
        if (industries.length > 1) {
            return res.status(400).json({ error: 'Can only compare reports from the same industry', industries });
        }

        // Build comparison data
        const markets = validReports.map(r => {
            const data = r.data || r;
            const benchmarks = data.benchmarks || {};
            const leads = data.qualifiedLeads || data.leads || [];
            const scores = leads.map(l => l.opportunityScore?.total || l.opportunityScore || l.score_total || 0).filter(s => s > 0);
            const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
            const generatedAt = r.generatedAt?.toDate?.() || r.generatedAt || r.createdAt?.toDate?.() || r.createdAt;
            const daysOld = generatedAt ? Math.floor((Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;

            return {
                reportId: r.id,
                city: r.city || data.city || '',
                state: r.state || data.state || '',
                industry: r.industry || data.industry || '',
                avgRating: benchmarks.avgRating || null,
                marketLeader: benchmarks.marketLeader?.name || benchmarks.marketLeaderName || null,
                leaderReviews: benchmarks.marketLeader?.reviews || benchmarks.marketLeaderReviews || null,
                icpMedianReviews: benchmarks.icpMedianReviews || null,
                avgReviewCount: benchmarks.avgReviewCount || null,
                saturation: data.saturation || r.saturationLevel || 'unknown',
                qualifiedLeadCount: leads.length,
                avgOpportunityScore: avgScore,
                totalCompetitors: benchmarks.totalCompetitors || 0,
                shareOfVoice: data.shareOfVoice || null,
                daysOld,
                freshness: daysOld === null ? 'unknown' : daysOld <= 14 ? 'Fresh' : daysOld <= 30 ? `${daysOld}d old` : `${daysOld}d — stale`
            };
        });

        // Generate narrative comparison via Gemini
        let narrative = '';
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
            const prompt = `Compare these ${markets.length} markets for ${markets[0].industry}. Which has the highest immediate opportunity for a sales rep this week? Reference specific numbers. Max 2 sentences. End with a clear recommendation.

Markets:
${markets.map(m => `${m.city}, ${m.state}: ${m.avgRating}\u2605 avg, ${m.qualifiedLeadCount} leads, avg score ${m.avgOpportunityScore}, saturation ${m.saturation}, leader ${m.marketLeader} (${m.leaderReviews} reviews)`).join('\n')}`;

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } }
            });
            narrative = result.response.text();
        } catch (e) {
            console.warn('[Compare] Narrative generation failed:', e.message);
            const best = [...markets].sort((a, b) => b.avgOpportunityScore - a.avgOpportunityScore)[0];
            narrative = `${best.city} shows the highest immediate opportunity with an average score of ${best.avgOpportunityScore} across ${best.qualifiedLeadCount} qualified leads. Start outreach there this week.`;
        }

        return res.json({ success: true, markets, narrative, industry: markets[0].industry });
    } catch (e) {
        console.error('[Compare] Error:', e);
        return res.status(500).json({ error: e.message });
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
    saveCustomSubIndustryInternal,
    generatePrecisionQuestions,
    getPrecisionQuestionsFallback,
    getBenchmark,
    searchBenchmarks,
    refreshReport,
    matchReport,
    compareReports,
    handleFilingUpload
};
