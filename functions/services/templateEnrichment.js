/**
 * Template-Driven Enrichment Pipeline
 *
 * Reads template.dataRequirements.enrichmentSources and runs all required
 * enrichment calls in parallel via Promise.all.
 *
 * Enrichment sources for Review Audit One-Pager:
 *   googlePlaces    — rating, reviewCount, website, address          (0 credits)
 *   dataForSEO_reviews — reviewSnippets, complaintPatterns, ...     (85 credits)
 *   serper_owner    — decisionMaker name + title                     (5 credits)
 *   gemini_analysis — topComplaintPattern, urgencyHook, projectedOutcomes (0 credits, in-memory)
 *
 * Design rules:
 *   - ALL enrichment calls fail gracefully (never block report generation)
 *   - Total enrichment must complete in under 3 seconds (parallel execution)
 *   - Credit check BEFORE starting enrichment; deduct AFTER success
 *   - If owner lookup fails, return null for decisionMaker
 *   - If DataForSEO fails, degrade to Google Places data only
 */

const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Existing services
const { getGoogleReviews } = require('./dataForSEOClient');
const { enrichDecisionMaker } = require('./decisionMakerEnricher');
const { findCompanyLocation } = require('./googlePlaces');
const { checkAndDeductCredits, refundCredits } = require('../api/billing');

const ENRICHMENT_TIMEOUT_MS = 3000;

/**
 * Wrap a promise with a timeout — resolves to null on timeout rather than hanging
 */
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => {
            console.warn(`[TemplateEnrichment] ${label} timed out after ${ms}ms`);
            resolve(null);
        }, ms))
    ]);
}

/**
 * Safe wrapper that catches errors and returns null
 */
async function safeCall(fn, label) {
    try {
        return await fn();
    } catch (err) {
        console.warn(`[TemplateEnrichment] ${label} failed:`, err.message);
        return null;
    }
}

/**
 * Google Places enrichment (0 credits)
 * Provides: rating, reviewCount, website, address
 */
async function enrichGooglePlaces(prospectData) {
    const { businessName, city, state, website } = prospectData;
    if (!businessName || !city) return null;

    return safeCall(async () => {
        // findCompanyLocation uses Places API text search to locate the business
        const location = await findCompanyLocation(businessName, website || null);
        if (!location || !location.success) return null;
        return {
            rating: prospectData.rating || null,
            reviewCount: prospectData.reviewCount || null,
            website: website || null,
            address: location.address || prospectData.address || null,
            placeId: location.placeId || null,
            city: location.city || null,
            state: location.state || null
        };
    }, 'googlePlaces');
}

/**
 * DataForSEO reviews enrichment (85 credits)
 * Provides: reviewSnippets, complaintPatterns, positivePatterns, ownerResponseCount
 */
async function enrichDataForSEOReviews(prospectData) {
    const { businessName, city, state } = prospectData;
    if (!businessName || !city) return null;

    return safeCall(async () => {
        const reviewData = await getGoogleReviews(businessName, `${city}${state ? ', ' + state : ''}`, 50);
        if (!reviewData || !reviewData.reviews || reviewData.reviews.length === 0) return null;

        const reviews = reviewData.reviews;

        // Separate positive (4-5★) and negative (1-3★) reviews
        // Note: 3-star included in negative — they contain complaint signals despite neutral rating
        const positiveReviews = reviews.filter(r => r.rating >= 4);
        const negativeReviews = reviews.filter(r => r.rating <= 3);

        // Count owner responses on negative reviews
        const ownerResponseCount = negativeReviews.filter(r => r.ownerResponse).length;

        // Build snippets arrays
        const reviewSnippets = reviews
            .filter(r => r.text && r.text.trim().length > 20)
            .slice(0, 20)
            .map(r => ({
                text: r.text.trim(),
                rating: r.rating,
                date: r.date,
                author: r.authorName
            }));

        const positiveSnippets = positiveReviews
            .filter(r => r.text && r.text.trim().length > 20)
            .slice(0, 10)
            .map(r => r.text.trim());

        const negativeSnippets = negativeReviews
            .filter(r => r.text && r.text.trim().length > 20)
            .slice(0, 10)
            .map(r => r.text.trim());

        return {
            reviewSnippets,
            positiveSnippets,
            negativeSnippets,
            // Aliased for buildAndExecuteTemplatePrompt compatibility
            positiveReviews: positiveSnippets,
            negativeReviews: negativeSnippets,
            ownerResponseCount,
            totalFetched: reviews.length,
            positiveCount: positiveReviews.length,
            negativeCount: negativeReviews.length,
            rating: reviewData.rating || null,
            reviewCount: reviewData.reviewCount || null
        };
    }, 'dataForSEO_reviews');
}

/**
 * Serper owner enrichment (5 credits)
 * Provides: decisionMaker.name, decisionMaker.title
 */
async function enrichSerperOwner(prospectData) {
    const { businessName, city, state, website } = prospectData;
    if (!businessName) return null;

    return safeCall(async () => {
        const result = await enrichDecisionMaker(businessName, city || '', state || '', website || null);
        if (!result) return null;
        return {
            name: result.name || null,
            title: result.title || null,
            source: result.source || null,
            confidence: result.confidence || null
        };
    }, 'serper_owner');
}

/**
 * Gemini in-memory analysis (0 credits — uses already-fetched review data)
 * Provides: topComplaintPattern, topComplaintCategory, complaintFrequency,
 *           reviewVolumeAssessment, urgencyHook, projectedOutcomes
 */
/**
 * Generate a generic seasonal urgency hook when no specific one is found.
 * Every business has a seasonal context — this ensures the urgencyBadge always renders.
 */
function buildSeasonalUrgencyHook(prospectData) {
    const month = new Date().getMonth(); // 0-11
    const businessName = prospectData.businessName || 'this business';
    const city = prospectData.city || 'your market';
    if (month >= 10 || month <= 1) return `Holiday season is here -- ${businessName} needs a strong reputation before foot traffic peaks in ${city}.`;
    if (month >= 2 && month <= 4) return `Spring brings new competition -- lock in your star rating before busy season in ${city}.`;
    if (month >= 5 && month <= 7) return `Summer foot traffic is ramping up in ${city} -- every unanswered review costs new customers.`;
    return `Fall brings back-to-school and event crowds to ${city} -- ${businessName} needs to address these patterns before the rush.`;
}

async function enrichGeminiAnalysis(prospectData, reviewEnrichment) {
    const seasonalFallback = buildSeasonalUrgencyHook(prospectData);

    if (!reviewEnrichment) {
        // No review data — return honest nulls, NOT fabricated defaults.
        // Downstream sections (complaintPatterns, customerLove) will be skipped
        // by templateSectionResolver when these are null/empty.
        console.log('[TemplateEnrichment] No review data available — returning null analysis (no fabrication)');
        return {
            topComplaintPattern: null,
            topComplaintCategory: null,
            complaintFrequency: 0,
            reviewVolumeAssessment: 'none',
            urgencyHook: seasonalFallback,
            complaintThemes: [],
            loveThemes: [],
            projectedOutcomes: buildDefaultOutcomes(prospectData),
            hasReviewData: false,
            reviewDataStatus: 'unavailable'
        };
    }

    return safeCall(async () => {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1024,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const negSnippets = (reviewEnrichment.negativeSnippets || []).slice(0, 8);
        const posSnippets = (reviewEnrichment.positiveSnippets || []).slice(0, 5);

        const prompt = `You are analyzing Google reviews for "${prospectData.businessName}" in ${prospectData.city || ''}.

NEGATIVE REVIEWS (${negSnippets.length}):
${negSnippets.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

POSITIVE REVIEWS (${posSnippets.length}):
${posSnippets.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

STATS: Rating ${prospectData.rating || reviewEnrichment.rating || 'unknown'}, ${reviewEnrichment.totalFetched} recent reviews analyzed.

Return JSON with these fields:
{
  "topComplaintPattern": "2-4 word description of the single most common complaint pattern",
  "topComplaintCategory": "1-2 word category in ALL CAPS (e.g., SLOW SERVICE, RUDE STAFF, WAIT TIMES)",
  "complaintFrequency": <integer, estimated complaints per month based on sample>,
  "reviewVolumeAssessment": "one of: 'strong', 'growing', 'thin', 'stagnant'",
  "urgencyHook": "1 sentence about a time-sensitive urgency for this business. MUST be non-null. Use the nearest seasonal peak, local event, holiday rush, or new competition signal. Example: 'FIFA World Cup qualifiers bring weekend crowds -- every 1-star complaint now costs you a table.' If nothing specific, reference the next seasonal traffic spike for their business type.",
  "complaintThemes": ["theme1", "theme2", "theme3"],
  "loveThemes": ["theme1", "theme2", "theme3"],
  "projectedOutcomes": [
    { "value": "30+", "label": "NEW REVIEWS IN 90 DAYS" },
    { "value": "<smart target: if current rating >= 4.8 use '4.9+', if >= 4.5 add 0.1, else '4.5'>", "label": "RATING TARGET" },
    { "value": "100%", "label": "REVIEW RESPONSE RATE" },
    { "value": "1", "label": "UNIFIED DASHBOARD" }
  ]
}

Return ONLY valid JSON. No markdown. No preamble.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        if (start === -1 || end <= start) {
            console.warn('[TemplateEnrichment] gemini_analysis: no JSON in response');
            return buildDefaultAnalysis(prospectData);
        }

        const parsed = JSON.parse(text.substring(start, end));
        return {
            topComplaintPattern: parsed.topComplaintPattern || 'service consistency',
            topComplaintCategory: parsed.topComplaintCategory || 'SERVICE',
            // ISSUE 2: abs at storage so negative values never reach display or prompts
            complaintFrequency: typeof parsed.complaintFrequency === 'number' ? Math.abs(parsed.complaintFrequency) : 2,
            reviewVolumeAssessment: parsed.reviewVolumeAssessment || 'growing',
            urgencyHook: parsed.urgencyHook || seasonalFallback,
            complaintThemes: Array.isArray(parsed.complaintThemes) ? parsed.complaintThemes : [],
            loveThemes:      Array.isArray(parsed.loveThemes)      ? parsed.loveThemes      : [],
            projectedOutcomes: parsed.projectedOutcomes || buildDefaultOutcomes(prospectData)
        };
    }, 'gemini_analysis');
}

function buildDefaultOutcomes(prospectData) {
    // ISSUE 4: smart rating target based on current rating
    const rating = parseFloat(prospectData?.rating) || null;
    let ratingTarget;
    if (!rating || rating < 4.5) {
        ratingTarget = '4.5';
    } else if (rating >= 4.8) {
        ratingTarget = '4.9+';
    } else {
        ratingTarget = (Math.round(rating * 10) / 10 + 0.1).toFixed(1);
    }
    return [
        { value: '30+', label: 'NEW REVIEWS IN 90 DAYS' },
        { value: ratingTarget, label: 'RATING TARGET' },
        { value: '100%', label: 'REVIEW RESPONSE RATE' },
        { value: '1', label: 'UNIFIED DASHBOARD' }
    ];
}

function buildDefaultAnalysis(prospectData) {
    return {
        topComplaintPattern: null,
        topComplaintCategory: null,
        complaintFrequency: 0,
        reviewVolumeAssessment: 'none',
        urgencyHook: buildSeasonalUrgencyHook(prospectData),
        complaintThemes: [],
        loveThemes: [],
        projectedOutcomes: buildDefaultOutcomes(prospectData),
        hasReviewData: false,
        reviewDataStatus: 'unavailable'
    };
}


/**
 * Main entry: Run all enrichment sources defined in template.dataRequirements.enrichmentSources
 *
 * @param {Object} template     - Full template document from Firestore
 * @param {Object} prospectData - { businessName, city, state, rating, reviewCount, website, ... }
 * @param {string} userId       - Firebase UID
 * @returns {Promise<Object>}   - Merged enrichment result
 */
async function runTemplateEnrichment(template, prospectData, userId) {
    const sources = template?.dataRequirements?.enrichmentSources || [];
    const totalCreditCost = template?.dataRequirements?.totalCreditCost?.withOwnerEnrichment || 0;

    console.log(`[TemplateEnrichment] Starting enrichment for "${prospectData.businessName}", sources: ${sources.map(s => s.source).join(', ')}`);

    // Credit gate — atomically reserve max possible credits
    let creditReserved = false;
    if (totalCreditCost > 0) {
        const reserveResult = await checkAndDeductCredits(
            userId,
            totalCreditCost,
            `template_enrichment:${template.templateId}:reserve`,
            { service: 'template_enrichment' }
        );

        if (!reserveResult.allowed) {
            const errorType = reserveResult.error === 'BILLING_TRANSACTION_FAILED'
                ? 'billingUnavailable' : 'insufficientCredits';
            console.warn(`[TemplateEnrichment] Credit gate failed (${errorType}): need ${totalCreditCost}, have ${reserveResult.available}`);
            return {
                prospect: {
                    businessName: prospectData.businessName || '',
                    city: prospectData.city || '',
                    state: prospectData.state || '',
                    rating: prospectData.rating || null,
                    reviewCount: prospectData.reviewCount || null,
                    website: prospectData.website || null,
                    address: prospectData.address || null,
                    ownerResponseCount: 0,
                    decisionMaker: null
                },
                analysis: {
                    ...buildDefaultAnalysis(prospectData),
                    gbpStatus: 'unknown',
                    reviewDataStatus: 'unavailable',
                    hasReviewData: false
                },
                enrichmentMeta: {
                    skippedDueToCredits: true,
                    required: totalCreditCost,
                    available: reserveResult.available,
                    billingError: reserveResult.error || null,
                    gbpStatus: 'unknown',
                    reviewDataStatus: 'unavailable',
                    hasReviewData: false
                }
            };
        }
        creditReserved = true;
    }

    const startMs = Date.now();

    // Build parallel enrichment tasks based on what the template requests
    const sourceNames = sources.map(s => s.source);
    const tasks = {};

    if (sourceNames.includes('googlePlaces')) {
        tasks.googlePlaces = withTimeout(
            enrichGooglePlaces(prospectData),
            ENRICHMENT_TIMEOUT_MS,
            'googlePlaces'
        );
    }

    if (sourceNames.includes('dataForSEO_reviews')) {
        tasks.dataForSEO = withTimeout(
            enrichDataForSEOReviews(prospectData),
            ENRICHMENT_TIMEOUT_MS,
            'dataForSEO_reviews'
        );
    }

    if (sourceNames.includes('serper_owner')) {
        tasks.ownerEnrichment = withTimeout(
            enrichSerperOwner(prospectData),
            ENRICHMENT_TIMEOUT_MS,
            'serper_owner'
        );
    }

    // Run all tasks in parallel
    const taskKeys = Object.keys(tasks);
    const taskResults = await Promise.all(taskKeys.map(k => tasks[k]));
    const results = {};
    taskKeys.forEach((k, i) => { results[k] = taskResults[i]; });

    // gemini_analysis runs after DataForSEO (uses its data) but still within our budget
    // because it's in-memory Gemini, not a paid API call
    let analysisResult = null;
    if (sourceNames.includes('gemini_analysis')) {
        analysisResult = await withTimeout(
            enrichGeminiAnalysis(prospectData, results.dataForSEO),
            ENRICHMENT_TIMEOUT_MS,
            'gemini_analysis'
        );
    }

    const elapsed = Date.now() - startMs;
    console.log(`[TemplateEnrichment] Completed in ${elapsed}ms`);

    // Merge results into a unified prospectData + analysis shape
    const placesData = results.googlePlaces || {};
    const reviewData = results.dataForSEO || {};
    const ownerData = results.ownerEnrichment || null;
    const analysis = analysisResult || buildDefaultAnalysis(prospectData);

    // Deduct credits for paid sources that succeeded
    let creditsUsed = 0;
    if (reviewData && reviewData.reviewSnippets) {
        creditsUsed += 85; // dataForSEO_reviews
    }
    if (ownerData && ownerData.name) {
        creditsUsed += 5; // serper_owner
    }

    // Refund unused portion of the reserved credits
    if (creditReserved && totalCreditCost > 0) {
        const refundAmount = totalCreditCost - creditsUsed;
        if (refundAmount > 0) {
            refundCredits(userId, refundAmount,
                `template_enrichment:${template.templateId}:partial_refund`,
                { service: 'template_enrichment' }
            ).catch(() => {});
        }
    }

    // Determine tri-state GBP / review status
    const hadReviewSource = sourceNames.includes('dataForSEO_reviews');
    let gbpStatus, reviewDataStatus, hasReviewData;
    if (hadReviewSource) {
        if (results.dataForSEO && (results.dataForSEO.rating || results.dataForSEO.reviewCount)) {
            gbpStatus = 'found';
            const hasSnippets = Array.isArray(results.dataForSEO.reviewSnippets) && results.dataForSEO.reviewSnippets.length > 0;
            reviewDataStatus = hasSnippets ? 'has_reviews' : 'zero_reviews';
            hasReviewData = hasSnippets;
        } else {
            gbpStatus = 'not_found';
            reviewDataStatus = 'unavailable';
            hasReviewData = false;
        }
    } else {
        gbpStatus = 'unknown';
        reviewDataStatus = 'unavailable';
        hasReviewData = false;
    }
    console.log(`[TemplateEnrichment] GBP status: ${gbpStatus}, reviewDataStatus: ${reviewDataStatus}`);

    // FIX 2: L2 stat card debug — log enriched rating/reviewCount sources before returning
    console.log('[L2 STAT DEBUG] templateEnrichment return —',
        'reviewData.rating:', reviewData.rating,
        '| placesData.rating:', placesData.rating,
        '| prospectData.rating:', prospectData.rating,
        '| reviewData.reviewCount:', reviewData.reviewCount,
        '| placesData.reviewCount:', placesData.reviewCount,
        '| prospectData.reviewCount:', prospectData.reviewCount);

    return {
        prospect: {
            businessName: prospectData.businessName,
            city: prospectData.city || '',
            state: prospectData.state || '',
            rating: reviewData.rating || placesData.rating || prospectData.rating || null,
            reviewCount: reviewData.reviewCount || placesData.reviewCount || prospectData.reviewCount || null,
            website: placesData.website || prospectData.website || null,
            address: placesData.address || prospectData.address || null,
            ownerResponseCount: reviewData.ownerResponseCount || 0,
            decisionMaker: ownerData ? { name: ownerData.name, title: ownerData.title } : null
        },
        analysis: {
            reviewSnippets:    reviewData.reviewSnippets    || [],
            positiveSnippets:  reviewData.positiveSnippets  || [],
            negativeSnippets:  reviewData.negativeSnippets  || [],
            // Aliased for buildAndExecuteTemplatePrompt compatibility
            positiveReviews:   reviewData.positiveReviews   || [],
            negativeReviews:   reviewData.negativeReviews   || [],
            topComplaintPattern:   analysis.topComplaintPattern,
            topComplaintCategory:  analysis.topComplaintCategory,
            complaintFrequency:    analysis.complaintFrequency,
            reviewVolumeAssessment: analysis.reviewVolumeAssessment,
            urgencyHook:           analysis.urgencyHook,
            complaintThemes:       analysis.complaintThemes || [],
            loveThemes:            analysis.loveThemes      || [],
            projectedOutcomes:     analysis.projectedOutcomes,
            hasReviewData,
            reviewDataStatus,
            gbpStatus
        },
        enrichmentMeta: {
            elapsed,
            creditsUsed,
            sourcesRun: taskKeys.concat(analysisResult ? ['gemini_analysis'] : []),
            googlePlacesHit: !!results.googlePlaces,
            dataForSEOHit: !!(reviewData && reviewData.reviewSnippets),
            ownerEnrichmentHit: !!(ownerData && ownerData.name),
            geminiAnalysisHit: !!analysisResult,
            gbpStatus,
            reviewDataStatus,
            hasReviewData
        }
    };
}

module.exports = { runTemplateEnrichment };
