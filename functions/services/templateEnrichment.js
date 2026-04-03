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

        // Separate positive (4-5★) and negative (1-2★) reviews
        const positiveReviews = reviews.filter(r => r.rating >= 4);
        const negativeReviews = reviews.filter(r => r.rating <= 2);

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
        // No review data — return minimal defaults with seasonal urgency
        return {
            topComplaintPattern: 'service consistency',
            topComplaintCategory: 'SERVICE',
            complaintFrequency: 2,
            reviewVolumeAssessment: 'growing',
            urgencyHook: seasonalFallback,
            projectedOutcomes: buildDefaultOutcomes(prospectData)
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
  "projectedOutcomes": [
    { "value": "30+", "label": "NEW REVIEWS IN 90 DAYS" },
    { "value": "4.5", "label": "RATING TARGET" },
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
            complaintFrequency: parsed.complaintFrequency || 2,
            reviewVolumeAssessment: parsed.reviewVolumeAssessment || 'growing',
            urgencyHook: parsed.urgencyHook || seasonalFallback,
            projectedOutcomes: parsed.projectedOutcomes || buildDefaultOutcomes(prospectData)
        };
    }, 'gemini_analysis');
}

function buildDefaultOutcomes(prospectData) {
    return [
        { value: '30+', label: 'NEW REVIEWS IN 90 DAYS' },
        { value: '4.5', label: 'RATING TARGET' },
        { value: '100%', label: 'REVIEW RESPONSE RATE' },
        { value: '1', label: 'UNIFIED DASHBOARD' }
    ];
}

function buildDefaultAnalysis(prospectData) {
    return {
        topComplaintPattern: 'service consistency',
        topComplaintCategory: 'SERVICE',
        complaintFrequency: 2,
        reviewVolumeAssessment: 'growing',
        urgencyHook: buildSeasonalUrgencyHook(prospectData),
        projectedOutcomes: buildDefaultOutcomes(prospectData)
    };
}

/**
 * Check whether a user has sufficient credits for enrichment.
 * Returns { allowed: boolean, available: number }
 *
 * NOTE: Credits are tracked in users/{userId}.credits. If the field
 * doesn't exist we treat it as unlimited (legacy accounts pre-credit system).
 */
async function checkUserCredits(userId, requiredCredits) {
    if (!userId || userId === 'anonymous') return { allowed: true, available: Infinity };
    try {
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const data = userDoc.exists ? userDoc.data() : {};
        const credits = data.credits;
        // If credits field is absent — treat as unlimited (pre-credit-system users)
        if (credits === undefined || credits === null) return { allowed: true, available: Infinity };
        return { allowed: credits >= requiredCredits, available: credits };
    } catch (err) {
        console.warn('[TemplateEnrichment] Credit check failed (allowing):', err.message);
        return { allowed: true, available: Infinity };
    }
}

/**
 * Deduct credits from user account (non-blocking — failure does not stop generation)
 */
async function deductCredits(userId, amount, reason) {
    if (!userId || userId === 'anonymous' || !amount) return;
    try {
        const db = admin.firestore();
        await db.collection('users').doc(userId).update({
            credits: admin.firestore.FieldValue.increment(-amount),
            [`creditHistory.${Date.now()}`]: {
                amount: -amount,
                reason: reason || 'template_enrichment',
                at: admin.firestore.FieldValue.serverTimestamp()
            }
        });
        console.log(`[TemplateEnrichment] Deducted ${amount} credits from ${userId} (${reason})`);
    } catch (err) {
        console.warn('[TemplateEnrichment] Credit deduction failed (non-blocking):', err.message);
    }
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

    // Credit gate
    if (totalCreditCost > 0) {
        const { allowed, available } = await checkUserCredits(userId, totalCreditCost);
        if (!allowed) {
            console.warn(`[TemplateEnrichment] Insufficient credits: need ${totalCreditCost}, have ${available}`);
            // Return minimal enrichment — degrade gracefully
            return {
                prospect: {},
                analysis: buildDefaultAnalysis(prospectData),
                enrichmentMeta: { skippedDueToCredits: true, required: totalCreditCost, available }
            };
        }
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

    if (creditsUsed > 0) {
        // Non-blocking
        deductCredits(userId, creditsUsed, `template_enrichment:${template.templateId}`).catch(() => {});
    }

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
            reviewSnippets: reviewData.reviewSnippets || [],
            positiveSnippets: reviewData.positiveSnippets || [],
            negativeSnippets: reviewData.negativeSnippets || [],
            topComplaintPattern: analysis.topComplaintPattern,
            topComplaintCategory: analysis.topComplaintCategory,
            complaintFrequency: analysis.complaintFrequency,
            reviewVolumeAssessment: analysis.reviewVolumeAssessment,
            urgencyHook: analysis.urgencyHook,
            projectedOutcomes: analysis.projectedOutcomes
        },
        enrichmentMeta: {
            elapsed,
            creditsUsed,
            sourcesRun: taskKeys.concat(analysisResult ? ['gemini_analysis'] : []),
            googlePlacesHit: !!results.googlePlaces,
            dataForSEOHit: !!(reviewData && reviewData.reviewSnippets),
            ownerEnrichmentHit: !!(ownerData && ownerData.name),
            geminiAnalysisHit: !!analysisResult
        }
    };
}

module.exports = { runTemplateEnrichment };
