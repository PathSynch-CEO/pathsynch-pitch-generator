/**
 * Opportunity Brief Service
 *
 * Orchestrates data collection, dual-model Gemini pipeline, and report assembly
 * for the SynchIntro Opportunity Brief — a full business case report for a
 * merchant prospect, branded in the merchant's colors.
 *
 * Gemini pipeline:
 *   Structured sections: gemini-2.5-flash (thinkingBudget:0) — JSON output
 *   Narrative sections:  gemini-3-flash-preview (with thinking) — human prose
 */

'use strict';

const https = require('https');
const http = require('http');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY);

// Industry-specific revenue benchmarks for the revenue model
const INDUSTRY_BENCHMARKS = {
    restaurant: { avgTicket: 35, repeatRate: 0.45, conversionRate: 0.08, visitRate: 0.35, serviceRadius: 2, revenueType: 'blended_new_repeat' },
    home_services: { avgTicket: 4500, repeatRate: 0.25, conversionRate: 0.15, visitRate: 0.7, serviceRadius: 20, revenueType: 'first_order' },
    healthcare: { avgTicket: 850, repeatRate: 0.6, conversionRate: 0.12, visitRate: 0.6, serviceRadius: 10, revenueType: 'customer_lifetime_value' },
    auto_repair: { avgTicket: 550, repeatRate: 0.4, conversionRate: 0.10, visitRate: 0.5, serviceRadius: 5, revenueType: 'blended_new_repeat' },
    professional_services: { avgTicket: 1200, repeatRate: 0.5, conversionRate: 0.08, visitRate: 0.4, serviceRadius: 15, revenueType: 'customer_lifetime_value' },
    dental: { avgTicket: 950, repeatRate: 0.7, conversionRate: 0.10, visitRate: 0.55, serviceRadius: 8, revenueType: 'customer_lifetime_value' },
    default: { avgTicket: 200, repeatRate: 0.35, conversionRate: 0.08, visitRate: 0.4, serviceRadius: 5, revenueType: 'blended_new_repeat' },
};

// Industry-specific brand color palettes (dark-themed for report design)
const INDUSTRY_BRAND_PALETTES = {
    restaurant: { primary: '#1a0805', secondary: '#2d1208', accent: '#b91c1c', light: '#f97316', dark: '#0d0402' },
    home_services: { primary: '#051a0a', secondary: '#0d2e17', accent: '#166534', light: '#65a30d', dark: '#030d05' },
    healthcare: { primary: '#051515', secondary: '#0d2828', accent: '#0f766e', light: '#0891b2', dark: '#030c0c' },
    auto_repair: { primary: '#0a0d1a', secondary: '#141b30', accent: '#1e40af', light: '#f97316', dark: '#050810' },
    professional_services: { primary: '#0a0a12', secondary: '#131320', accent: '#1e1b4b', light: '#b45309', dark: '#050509' },
    dental: { primary: '#050d1a', secondary: '#0a1a32', accent: '#1d4ed8', light: '#0ea5e9', dark: '#030812' },
    default: { primary: '#1a1a2e', secondary: '#16213e', accent: '#0f3460', light: '#e94560', dark: '#0a0a0a' },
};

// Vertical-specific narrative rules injected into prompt
const VERTICAL_NARRATIVE_RULES = {
    restaurant: 'Emphasize review velocity, response rate, GBP posts. Revenue model uses avg ticket + repeat rate.',
    home_services: 'Emphasize search visibility (100% digital discovery). Use service area (10-25mi) not trade area (2mi). Revenue uses job value ($3K–$15K).',
    healthcare: 'Add compliance sensitivity note re: review solicitation. Emphasize response tone. Revenue uses patient lifetime value.',
    auto_repair: 'Emphasize trust signals ("honest", "fair pricing"). Revenue uses avg repair order ($350–$800). Competitor radius 5mi.',
    professional_services: 'De-emphasize review volume, emphasize review quality. Revenue uses client lifetime value + referral multiplier.',
    dental: 'Emphasize new patient acquisition cost vs LTV. Revenue uses avg new patient value ($800–$1,200 first year).',
    default: 'Use industry-appropriate benchmarks for local businesses.',
};

/**
 * Haversine distance between two lat/lng points — returns string like "1.4 mi"
 */
function haversineDistanceMi(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1) + ' mi';
}

/**
 * Estimate velocity label from total review count (assumes ~30-month-old business)
 */
function estimateVelocityLabel(totalReviews) {
    if (!totalReviews || totalReviews < 5) return 'low';
    const monthly = totalReviews / 30;
    if (monthly >= 10) return 'high';
    if (monthly >= 5) return 'growing';
    if (monthly >= 2) return 'steady';
    return 'low';
}

/**
 * Fetch competitors from Google Places Text Search API.
 * Used when no Market Intel report is linked or verifiedCompetitors is empty.
 */
async function fetchCompetitorsFromGooglePlaces(prospectAddress, industry, prospectName) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey || !prospectAddress) return [];

    try {
        const query = encodeURIComponent(`${industry} near ${prospectAddress}`);
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

        const data = await new Promise((resolve, reject) => {
            const req = https.get(url, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error('Places API timeout')); });
        });

        if (!data.results || data.results.length === 0) return [];

        // Use first result as reference point for distance calculations
        const refLat = data.results[0].geometry?.location?.lat;
        const refLng = data.results[0].geometry?.location?.lng;
        const hasRef = refLat !== undefined && refLng !== undefined;
        const prospectNameLower = (prospectName || '').toLowerCase();

        return data.results.slice(0, 7).map(place => {
            const placeLat = place.geometry?.location?.lat;
            const placeLng = place.geometry?.location?.lng;
            const nameSnippet = prospectNameLower.substring(0, Math.min(7, prospectNameLower.length));
            const isYou = nameSnippet.length > 3 && place.name.toLowerCase().includes(nameSnippet);

            const distance = (hasRef && placeLat !== undefined && !isYou)
                ? haversineDistanceMi(refLat, refLng, placeLat, placeLng)
                : null;

            const rawType = place.types
                ? place.types.filter(t => !['point_of_interest', 'establishment', 'food'].includes(t))[0]
                : null;
            const category = rawType ? rawType.replace(/_/g, ' ') : (industry || '');

            return {
                name: place.name,
                score: parseFloat((place.rating || 0).toFixed(1)),
                reviews: place.user_ratings_total || 0,
                velocity: estimateVelocityLabel(place.user_ratings_total),
                distance,
                category,
                categoryMatch: true,
                isYou,
            };
        });
    } catch (err) {
        console.warn('[OpportunityBrief] Google Places competitor fetch failed (non-blocking):', err.message);
        return [];
    }
}

/**
 * Extract brand colors from a website's HTML/CSS using Gemini.
 * Falls back to industry-specific palette on any failure.
 */
async function extractBrandColorsFromWebsite(websiteUrl, industryVertical) {
    const fallback = INDUSTRY_BRAND_PALETTES[industryVertical] || INDUSTRY_BRAND_PALETTES.default;
    if (!websiteUrl) return fallback;

    try {
        const rawUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
        const transport = rawUrl.startsWith('https') ? https : http;

        const html = await new Promise((resolve, reject) => {
            const req = transport.get(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SynchIntro/1.0)' } }, (res) => {
                if (res.statusCode >= 400) { resolve(''); return; }
                // Skip redirects to avoid complexity
                if (res.statusCode >= 300) { resolve(''); return; }
                let body = '';
                res.on('data', chunk => { if (body.length < 60000) body += chunk; });
                res.on('end', () => resolve(body));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('Website fetch timeout')); });
        });

        if (!html || html.length < 200) return fallback;

        const hexMatches = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
        if (hexMatches.length < 3) return fallback;

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 0 },
            },
        });

        const uniqueHex = [...new Set(hexMatches)].slice(0, 30).join(', ');
        const prompt = `You are a brand designer. Given these hex colors extracted from a business website: ${uniqueHex}

Classify them into a DARK-themed brand palette suitable for a report with a dark background.

Return ONLY valid JSON:
{
  "primary": "<darkest background hex — luminance < 15%>",
  "secondary": "<second-darkest surface hex>",
  "accent": "<primary brand signature color hex>",
  "light": "<brightest highlight / CTA color hex>",
  "dark": "<near-black hex>"
}

Rules: primary must be very dark. If no suitable dark colors exist, darken the brand color and return defaults for primary/secondary/dark. Return ONLY JSON, no other text.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) return fallback;

        const parsed = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
        if (parsed.primary && parsed.secondary && parsed.accent && parsed.light && parsed.dark) {
            return parsed;
        }
        return fallback;
    } catch (err) {
        console.warn('[OpportunityBrief] Brand color extraction failed (non-blocking):', err.message);
        return INDUSTRY_BRAND_PALETTES[industryVertical] || INDUSTRY_BRAND_PALETTES.default;
    }
}

/**
 * Generate a unique share token
 */
function generateShareToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 24; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

/**
 * Detect industry vertical for benchmarks/narrative
 */
function detectIndustryVertical(industry) {
    if (!industry) return 'default';
    const lower = industry.toLowerCase();
    if (/restaurant|food|cafe|bar|pizza|sushi|dining/.test(lower)) return 'restaurant';
    if (/home|plumb|hvac|roof|electri|landscap|paint|gutter|pest|clean/.test(lower)) return 'home_services';
    if (/health|medical|clinic|doctor|physician|urgent care|therapy/.test(lower)) return 'healthcare';
    if (/auto|car|vehicle|mechanic|tire|oil change/.test(lower)) return 'auto_repair';
    if (/law|attorney|account|consult|financial|insurance/.test(lower)) return 'professional_services';
    if (/dental|dentist|orthodon/.test(lower)) return 'dental';
    return 'default';
}

/**
 * Collect and consolidate intel data from existing reports or library items
 */
async function collectIntelData(params) {
    const { reportId, merchantId, userId, prospectName, prospectAddress, industry, vertical, market, state } = params;

    // Detect vertical early — needed for brand color palette selection
    const industryVertical = detectIndustryVertical(industry);
    const benchmarks = INDUSTRY_BENCHMARKS[industryVertical] || INDUSTRY_BENCHMARKS.default;

    let data = {
        competitor: { leads: [], topCompetitor: null, competitorScore: null, competitorReviews: null, competitorVelocity: null, verifiedCompetitors: [] },
        reviews: { score: null, count: null, velocity: null, responseRate: null, avgResponseTime: null, topPraise: null, topComplaint: null },
        gbp: { score: null, missing: [], inPlace: [] },
        market: { tradeAreaPop: null, medianIncome: null, growthRate: null, monthlySearches: null },
        referral: { currentRate: null, industryAvg: null, ltvEstimate: null },
        brandColors: params.brandColors || null, // resolved below after all data collected
        prospect: { name: prospectName, owner: null, address: prospectAddress || '', industry: industry || '', yearEstablished: null, website: params.prospectWebsite || params.websiteUrl || null },
    };

    // Pull from existing Market Intel report if reportId provided
    if (reportId) {
        try {
            const reportDoc = await db.collection('marketReports').doc(reportId).get();
            if (reportDoc.exists) {
                const reportData = reportDoc.data();
                const d = reportData.data || {};
                const leads = d.leads || [];
                const benchmarks = d.benchmarks || {};
                const demographics = d.demographicsCommunities || d.demographics || {};

                // Competitor data from top lead
                if (leads.length > 0) {
                    const topLead = leads[0];
                    data.competitor.leads = leads;
                    data.competitor.topCompetitor = topLead.name || topLead.businessName || '';
                    data.competitor.competitorScore = topLead.rating || topLead.googleRating;
                    data.competitor.competitorReviews = topLead.reviewCount || topLead.totalReviews;
                    data.competitor.competitorVelocity = topLead.velocityTrend?.classification || null;

                    // Build verified competitors list (top 5 with available data)
                    data.competitor.verifiedCompetitors = leads.slice(0, 5).map(lead => ({
                        name: lead.name || lead.businessName || 'Unknown',
                        score: parseFloat(lead.rating || lead.googleRating) || 0,
                        reviews: parseInt(lead.reviewCount || lead.totalReviews) || 0,
                        velocity: lead.velocityTrend?.classification || 'unknown',
                        distance: lead.distance || null,
                        category: lead.category || industry || '',
                        categoryMatch: true,
                        isYou: false,
                    }));
                }

                // Demographics
                if (demographics) {
                    data.market.tradeAreaPop = demographics.population || null;
                    data.market.medianIncome = demographics.medianIncome || null;
                    data.market.growthRate = demographics.growthIndicators?.[0] || null;
                }

                // Market searches from intent signals
                if (d.intentSignals?.searchMomentum) {
                    data.market.monthlySearches = d.intentSignals.searchMomentum.monthlySearchVolume || null;
                }

                // Benchmarks
                if (benchmarks) {
                    data.reviews.score = benchmarks.avgRating || null;
                    data.reviews.count = benchmarks.avgReviews || null;
                }
            }
        } catch (err) {
            console.warn('[OpportunityBrief] Failed to read market report:', err.message);
        }
    }

    // Pull from saved library items for this prospect
    try {
        const libraryQuery = await db.collection('salesDocuments')
            .where('userId', '==', userId)
            .where('metadata.prospectName', '==', prospectName)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        for (const doc of libraryQuery.docs) {
            const item = doc.data();
            const content = item.content || item.metadata || {};

            // Enrich any missing fields from library items
            if (!data.reviews.score && content.reviewScore) data.reviews.score = content.reviewScore;
            if (!data.reviews.count && content.reviewCount) data.reviews.count = content.reviewCount;
            if (!data.gbp.score && content.gbpScore) data.gbp.score = content.gbpScore;
        }
    } catch (err) {
        // Library query may fail if index missing — non-blocking
        console.warn('[OpportunityBrief] Library query failed (non-blocking):', err.message);
    }

    // Apply industry benchmarks for any still-missing fields
    if (!data.reviews.responseRate) data.reviews.responseRate = '42%';
    if (!data.reviews.avgResponseTime) data.reviews.avgResponseTime = '3.2 days';
    if (!data.reviews.topPraise) data.reviews.topPraise = 'quality of service';
    if (!data.reviews.topComplaint) data.reviews.topComplaint = 'wait times';
    if (!data.reviews.velocity) data.reviews.velocity = '3.1/month';
    if (!data.reviews.score) data.reviews.score = 4.1;
    if (!data.reviews.count) data.reviews.count = 47;
    if (!data.gbp.score) data.gbp.score = 58;
    if (!data.market.monthlySearches) data.market.monthlySearches = 1200;
    if (!data.market.tradeAreaPop) data.market.tradeAreaPop = 85000;
    if (!data.market.medianIncome) data.market.medianIncome = 62000;
    if (!data.market.growthRate) data.market.growthRate = '2.3%';

    // Google Places fallback: fetch competitors when none found from report
    if (data.competitor.verifiedCompetitors.length === 0) {
        const placesResults = await fetchCompetitorsFromGooglePlaces(prospectAddress, industry, prospectName);
        if (placesResults.length > 0) {
            // Separate "you" entry from competitors
            const youEntry = placesResults.find(c => c.isYou);
            const competitors = placesResults.filter(c => !c.isYou).slice(0, 5);
            data.competitor.verifiedCompetitors = competitors;

            const topComp = [...competitors].sort((a, b) => b.reviews - a.reviews)[0];
            if (topComp && !data.competitor.topCompetitor) {
                data.competitor.topCompetitor = topComp.name;
                data.competitor.competitorScore = topComp.score;
                data.competitor.competitorReviews = topComp.reviews;
                data.competitor.competitorVelocity = topComp.velocity;
            }

            // Use Places-confirmed score/review count for prospect if not already set
            if (youEntry && !data.reviews.score) data.reviews.score = youEntry.score;
            if (youEntry && !data.reviews.count) data.reviews.count = youEntry.reviews;
        }
    }

    // Brand color resolution: params > website extraction > industry palette
    if (!data.brandColors) {
        if (data.prospect.website) {
            data.brandColors = await extractBrandColorsFromWebsite(data.prospect.website, industryVertical);
        } else {
            data.brandColors = INDUSTRY_BRAND_PALETTES[industryVertical] || INDUSTRY_BRAND_PALETTES.default;
        }
    }

    // Store industry vertical for prompt use
    data._industryVertical = industryVertical;
    data._benchmarks = benchmarks;

    return data;
}

/**
 * Build structured sections prompt (gemini-2.5-flash)
 */
function buildStructuredPrompt(data) {
    const industryVertical = data._industryVertical || 'default';
    const competitorVelocityStr = data.competitor.competitorVelocity
        ? `${data.competitor.competitorVelocity} (competitor)`
        : 'unknown';

    return `You are a data analyst generating structured report data for a local business assessment.

PROSPECT DATA:
- Business: ${data.prospect.name}
- Industry: ${data.prospect.industry}
- Location: ${data.prospect.address}
- Review Score: ${data.reviews.score} (${data.reviews.count} reviews)
- Review Velocity: ${data.reviews.velocity}
- Top Competitor: ${data.competitor.topCompetitor || 'N/A'} (${data.competitor.competitorScore || 'N/A'} stars, ${data.competitor.competitorReviews || 'N/A'} reviews, ${competitorVelocityStr})
- GBP Score: ${data.gbp.score}/100
- Monthly Category Searches: ${data.market.monthlySearches}
- Trade Area Population: ${data.market.tradeAreaPop}
- Median Household Income: $${data.market.medianIncome}
- Market Growth Rate: ${data.market.growthRate}
- Response Rate: ${data.reviews.responseRate}
- Avg Response Time: ${data.reviews.avgResponseTime}

COMPETITOR SET:
${JSON.stringify(data.competitor.verifiedCompetitors, null, 2)}

GBP DATA:
- Missing: ${JSON.stringify(data.gbp.missing)}
- In Place: ${JSON.stringify(data.gbp.inPlace)}

IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

Generate a JSON object with these exact fields:

{
  "executiveStats": {
    "reviewScore": <number>,
    "reviewCount": <number>,
    "gbpScore": <number>,
    "responseRate": <string>,
    "monthlySearches": <number>
  },
  "competitorBars": [
    {
      "name": <string>,
      "score": <number>,
      "reviews": <number>,
      "velocity": <string>,
      "distance": <string or null>,
      "category": <string>,
      "categoryMatch": <boolean>,
      "isYou": <boolean>
    }
  ],
  "gbpBreakdown": {
    "missing": [<string>],
    "inPlace": [<string>]
  },
  "revenueModel": {
    "monthlySearches": <number>,
    "visibilityImprovement": <string>,
    "clickConversionRate": <string>,
    "visitConversionRate": <string>,
    "avgOrderValue": <number>,
    "repeatRate": <number>,
    "conservativeMonthly": <number>,
    "expectedMonthly": <number>,
    "optimisticMonthly": <number>,
    "revenueType": <"first_order" | "blended_new_repeat" | "customer_lifetime_value">
  },
  "evidenceTable": [
    {
      "claim": <string>,
      "confidence": <"High" | "Medium" | "Low-Medium">,
      "source": <string>,
      "verified": <string>
    }
  ]
}

For revenueModel:
- Show the full assumption chain from searches to revenue
- revenueType must be one of: "first_order", "blended_new_repeat", "customer_lifetime_value"
- Be explicit about what the revenue number represents
- Use industry-appropriate benchmarks for ${data.prospect.industry} (vertical: ${industryVertical})

For evidenceTable:
- Include every major claim in the report
- Confidence: High = directly observed data, Medium = third-party estimate, Low-Medium = modeled projection
- Source: specific data source (Google Places API, Census ACS, DataForSEO, etc.)
- Verified: date or "Modeled projection"

For competitorBars:
- Include the prospect themselves as a bar (isYou: true) so the comparison is direct
- Sort by review count descending (showing the competitive landscape)

Return ONLY valid JSON. No markdown. No backticks. No explanation.`;
}

/**
 * Build narrative sections prompt (gemini-3-flash-preview)
 */
function buildNarrativePrompt(data, structured) {
    const industryVertical = data._industryVertical || 'default';
    const verticalRule = VERTICAL_NARRATIVE_RULES[industryVertical] || VERTICAL_NARRATIVE_RULES.default;

    // Calculate gap for "what happens if you do nothing"
    const prospectVelocity = parseFloat((data.reviews.velocity || '0').replace(/[^0-9.]/g, '')) || 3;
    const topCompetitorBar = (structured.competitorBars || []).find(b => !b.isYou && b.velocity !== 'unknown');
    const competitorVelocityNum = topCompetitorBar ? parseFloat((topCompetitorBar.velocity || '0').replace(/[^0-9.]/g, '')) || 8 : 8;
    const quarterlyGap = ((competitorVelocityNum - prospectVelocity) * 3).toFixed(1);

    return `You are a business consultant writing a personalized growth assessment for a local business owner.

BUSINESS CONTEXT:
- Business: ${data.prospect.name}
- Owner: ${data.prospect.owner || 'the business owner'}
- Industry: ${data.prospect.industry}
- Location: ${data.prospect.address}
- Year Established: ${data.prospect.yearEstablished || 'N/A'}

STRUCTURED DATA (already computed — use these exact numbers):
${JSON.stringify(structured, null, 2)}

REVIEW INTELLIGENCE:
- Top customer praise theme: "${data.reviews.topPraise}"
- Top customer complaint theme: "${data.reviews.topComplaint}"
- Review velocity: ${data.reviews.velocity} vs competitor ${data.competitor.competitorVelocity || 'market average'}
- Quarterly gap: ${quarterlyGap} reviews per quarter at current velocity differential

VERTICAL-SPECIFIC RULES:
${verticalRule}

IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

Write the following narrative sections as a JSON object:

{
  "executiveSummaryP1": "<First paragraph — tell the business's story. Mention year established if known, what customers love about them (reference topPraise), and the specific gap (visibility, not quality). Reference exact data points. 3-4 sentences.>",

  "executiveSummaryP2": "<Second paragraph — quantify the opportunity. Mention the three gaps (review volume, GBP completeness, response rate). State the revenue opportunity range. Note that evidence sources are documented. 2-3 sentences.>",

  "competitorKeyFinding": "<One paragraph explaining the most important competitive insight. Use exact numbers from competitorBars. IMPORTANT: Do NOT claim Google uses review velocity as an algorithm signal. Instead say: 'Review velocity is a practical visibility and trust signal — businesses earning fresh reviews consistently tend to appear more active, credible, and conversion-ready to customers comparing local options.'>",

  "customerSentiment": "<One paragraph about what customers are saying — reference the top praise and top complaint by name. Include how many times each was mentioned (estimate from review count). Suggest operational improvement. Tag with confidence: Medium.>",

  "whatHappensIfYouDoNothing": "<One paragraph quantifying the cost of inaction. Use the quarterly gap figure (${quarterlyGap} reviews/quarter at current velocity rates). Frame as compounding disadvantage, not scare tactic. End with: 'The cost of waiting is not zero — it is the revenue you are not capturing while competitors are.'>",

  "bottomLineRecommendation": "<2-3 sentences. The gap is visibility, not quality. Closing review volume + GBP + response rate gaps will align digital presence with the in-person experience customers already have.>",

  "priorityActions": [
    "<Complete GBP profile — description, photos, Q&A, posts (score from X to 85+ target)>",
    "<Deploy automated review capture to increase velocity from X/month to 15+/month and begin narrowing the trust gap versus top competitors>",
    "<Implement same-day review response protocol (currently: X avg)>"
  ],

  "expectedOutcomes": [
    "<Monthly revenue uplift: $X–$Y>",
    "<New customers from search: +X–Y/mo>",
    "<Review velocity target: 15+ new reviews/mo>",
    "<Early visibility movement may be measurable within 30–60 days, depending on competition and profile activity>"
  ],

  "ninetyDayPlan": {
    "week1": "<Complete GBP profile optimization — business description, service menu, 10+ fresh photos, Q&A activation, hours verification.>",
    "weeks2to4": "<Deploy review capture system. Target: 15+ new reviews per month. Respond to all existing unresponded reviews.>",
    "weeks5to8": "<Launch weekly GBP posts. Begin monitoring competitor review velocity. Address top complaint operationally.>",
    "weeks9to12": "<Measure search visibility lift, review velocity trend, and new customer acquisition. Recalibrate strategy based on actual data vs. projections.>"
  }
}

WRITING RULES:
- Use the prospect's actual business name: ${data.prospect.name}
- Reference exact numbers from the structured data — never round or approximate
- Do NOT make Google algorithm claims — frame review velocity as a practical trust/visibility signal
- Revenue estimates must say "estimated opportunity, not guaranteed revenue"
- Do NOT say "close the X-review gap" when the gap is thousands — instead frame as "increase velocity from X to Y and begin narrowing the trust gap"
- Visibility timeline claims must say "may be measurable within 30-60 days, depending on competition and profile activity"
- Tone: consultative, data-driven, honest. Not salesy. Not generic.
- Fill in actual numbers from structuredData for all X/Y placeholders

Return ONLY valid JSON. No markdown. No backticks.`;
}

/**
 * Generate structured sections using gemini-2.5-flash (thinkingBudget:0)
 */
async function generateStructuredSections(dataBundle) {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
        },
    });

    const prompt = buildStructuredPrompt(dataBundle);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('gemini-2.5-flash returned no JSON for structured sections');
    }
    return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
}

/**
 * Generate narrative sections using gemini-3-flash-preview (with thinking for quality)
 */
async function generateNarrativeSections(dataBundle, structuredData) {
    const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        // No thinkingBudget:0 — allow thinking for narrative quality
    });

    const prompt = buildNarrativePrompt(dataBundle, structuredData);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('gemini-3-flash-preview returned no JSON for narrative sections');
    }
    return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
}

/**
 * Assemble the full report object
 */
function assembleReport(dataBundle, structuredData, narrativeSections, params) {
    const industryVertical = dataBundle._industryVertical || 'default';
    return {
        prospectName: params.prospectName,
        prospectAddress: params.prospectAddress || '',
        prospectWebsite: params.prospectWebsite || params.websiteUrl || null,
        industry: params.industry || '',
        vertical: params.vertical || industryVertical,
        market: params.market || '',
        state: params.state || '',
        reportId: params.reportId || null,
        brandColors: dataBundle.brandColors,
        structuredData,
        narrativeSections,
        creditsUsed: 145,
        geminiModels: {
            structured: 'gemini-2.5-flash',
            narrative: 'gemini-3-flash-preview',
        },
        savedToLibrary: true,
        shareToken: generateShareToken(),
        analytics: {
            views: 0,
            uniqueViews: 0,
            pdfDownloads: 0,
            pptxDownloads: 0,
            shareLinkCopied: 0,
            ctaClicked: 0,
            lastViewedAt: null,
        },
    };
}

/**
 * Save brief to Firestore
 */
async function saveToFirestore(report, params) {
    const briefRef = db.collection('opportunityBriefs').doc();
    const briefId = briefRef.id;

    const doc = {
        id: briefId,
        userId: params.userId,
        ...report,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Sanitize: remove undefined values
    const sanitized = JSON.parse(JSON.stringify(doc, (key, val) => val === undefined ? null : val));

    await briefRef.set(sanitized);
    return { id: briefId, ...sanitized };
}

/**
 * Deduct credits from user account
 */
async function deductCredits(userId, amount, reason) {
    const userRef = db.collection('users').doc(userId);
    await userRef.update({
        credits: admin.firestore.FieldValue.increment(-amount),
    });

    // Log to credit ledger
    try {
        await db.collection('creditLedger').add({
            userId,
            amount: -amount,
            reason,
            service: 'opportunity_brief',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.warn('[OpportunityBrief] Credit ledger write failed (non-blocking):', err.message);
    }
}

// ─────────────────────────────────────────────
// Public exports
// ─────────────────────────────────────────────

/**
 * Generate a new Opportunity Brief
 *
 * @param {Object} params
 * @param {string} params.merchantId
 * @param {string} params.userId
 * @param {string} params.prospectName
 * @param {string} [params.prospectAddress]
 * @param {string} params.industry
 * @param {string} [params.vertical]
 * @param {string} [params.market]
 * @param {string} [params.state]
 * @param {string} [params.reportId]     - Linked Market Intel report ID (optional)
 * @param {Object} [params.brandColors]  - { primary, secondary, accent, light, dark }
 * @returns {Promise<Object>} Assembled report with Firestore id
 */
async function generateOpportunityBrief(params) {
    console.log(`[OpportunityBrief] Generating for ${params.prospectName} (user: ${params.userId})`);

    // 1. Collect intel data
    const dataBundle = await collectIntelData(params);

    // 2. Structured sections — gemini-2.5-flash, thinkingBudget:0
    const structuredData = await generateStructuredSections(dataBundle);
    console.log('[OpportunityBrief] Structured sections generated');

    // 3. Narrative sections — gemini-3-flash-preview, with thinking
    const narrativeSections = await generateNarrativeSections(dataBundle, structuredData);
    console.log('[OpportunityBrief] Narrative sections generated');

    // 4. Assemble report
    const report = assembleReport(dataBundle, structuredData, narrativeSections, params);

    // 5. Persist to Firestore
    const savedReport = await saveToFirestore(report, params);
    console.log(`[OpportunityBrief] Saved to Firestore: ${savedReport.id}`);

    // 6. Deduct credits
    await deductCredits(params.userId, 145, 'opportunity_brief');

    return savedReport;
}

/**
 * Force-regenerate an existing brief (deducts credits again)
 */
async function refreshOpportunityBrief(briefId, userId) {
    const doc = await db.collection('opportunityBriefs').doc(briefId).get();
    if (!doc.exists) throw new Error('Brief not found');
    if (doc.data().userId !== userId) throw new Error('Not authorized');

    const existing = doc.data();
    return generateOpportunityBrief({
        merchantId: userId,
        userId,
        prospectName: existing.prospectName,
        prospectAddress: existing.prospectAddress,
        industry: existing.industry,
        vertical: existing.vertical,
        market: existing.market,
        state: existing.state,
        reportId: existing.reportId,
        brandColors: existing.brandColors,
    });
}

/**
 * Read a brief from Firestore (owner-scoped)
 */
async function getOpportunityBrief(briefId, userId) {
    const doc = await db.collection('opportunityBriefs').doc(briefId).get();
    if (!doc.exists) return null;
    if (doc.data().userId !== userId) throw new Error('Not authorized');
    return { id: doc.id, ...doc.data() };
}

/**
 * Read a brief by shareToken (public — no auth)
 */
async function getOpportunityBriefByToken(shareToken) {
    const query = await db.collection('opportunityBriefs')
        .where('shareToken', '==', shareToken)
        .limit(1)
        .get();
    if (query.empty) return null;
    const doc = query.docs[0];
    return { id: doc.id, ...doc.data() };
}

/**
 * Track an analytics event on a brief
 */
async function trackBriefEvent(briefId, event, isAnonymous = false) {
    const briefRef = db.collection('opportunityBriefs').doc(briefId);

    const incrementFields = {};
    if (event === 'report_viewed') {
        incrementFields['analytics.views'] = admin.firestore.FieldValue.increment(1);
        if (isAnonymous) {
            incrementFields['analytics.uniqueViews'] = admin.firestore.FieldValue.increment(1);
        }
        incrementFields['analytics.lastViewedAt'] = admin.firestore.FieldValue.serverTimestamp();
    } else if (event === 'pdf_downloaded') {
        incrementFields['analytics.pdfDownloads'] = admin.firestore.FieldValue.increment(1);
    } else if (event === 'pptx_downloaded') {
        incrementFields['analytics.pptxDownloads'] = admin.firestore.FieldValue.increment(1);
    } else if (event === 'share_link_copied') {
        incrementFields['analytics.shareLinkCopied'] = admin.firestore.FieldValue.increment(1);
    } else if (event === 'cta_clicked') {
        incrementFields['analytics.ctaClicked'] = admin.firestore.FieldValue.increment(1);
    }

    if (Object.keys(incrementFields).length > 0) {
        await briefRef.update(incrementFields);
    }

    // Write to pitchAnalytics for cross-report aggregation
    try {
        await db.collection('pitchAnalytics').add({
            briefId,
            event,
            isAnonymous,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.warn('[OpportunityBrief] pitchAnalytics write failed (non-blocking):', err.message);
    }
}

module.exports = {
    generateOpportunityBrief,
    refreshOpportunityBrief,
    getOpportunityBrief,
    getOpportunityBriefByToken,
    trackBriefEvent,
};
