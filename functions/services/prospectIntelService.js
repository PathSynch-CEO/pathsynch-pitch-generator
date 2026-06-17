/**
 * Prospect Intel Service — M1-2: Enrichment Pipeline
 *
 * Exports:
 *   calculateFitScore(agentData, csvData, icpProfile)  → { fitScore, fitLabel, signalHits, disqualified, disqualifyReason }
 *   classifyRecommendedProduct(agentData, productFocus) → string
 *   buildSourceAttribution(value, source, confidence)  → { value, source, confidence, updatedAt, failureReason }
 *   callResearchAgent(businessName, city, state)        → agentResult JSON
 *   processOneProspect(batchId, prospectId)             → void (reads+writes Firestore)
 *   deductProspectCredits(userId, count, batchId)       → void (non-blocking)
 *   enqueueProspectTask(batchId, prospectId)            → Cloud Tasks task resource
 *
 * Architecture:
 *   POST /prospect-intel/batch creates batch + prospect subdocs, then the batch doc
 *   creation triggers exports.onProspectBatchCreated (Firestore trigger in index.js)
 *   which calls enqueueProspectTask() for each prospect.
 *   Each task calls exports.processProspectTask (separate Cloud Function) which
 *   calls processOneProspect() to enrich a single prospect.
 */

const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
const { lookupProspectPlace } = require('./googlePlaces');
const { findIndustry, findSubIndustry } = require('../config/industryTaxonomy');
const { getReportProfile } = require('../config/reportProfiles');
const { detectTechStack } = require('./tools/techStackDetector');
const { gradeGBP } = require('./tools/gbpGrader');
const { getPlacesLookup, setPlacesLookup } = require('./enrichmentCache');
const { matchProspectToReport } = require('./marketContextResolver');

const AGENT_BASE_URL = process.env.PROSPECT_AGENT_URL
    || 'https://prospect-research-218613212853.us-central1.run.app';

const GCP_PROJECT  = process.env.PATHSYNCH_GCP_PROJECT || 'pathconnect-442522';
const GCP_LOCATION = 'us-central1';
const TASKS_QUEUE  = 'prospect-enrichment';

// Set at deploy time — processProspectTask is a separate Cloud Function export
const TASK_HANDLER_URL = process.env.PROSPECT_TASK_HANDLER_URL
    || `https://${GCP_LOCATION}-pathsynch-pitch-creation.cloudfunctions.net/processProspectTask`;

// ── Fit Score ──────────────────────────────────────────────────────────────────

/**
 * Calculate Fit Score (0–100) against an ICP profile.
 *
 * Buying signal keys match the DEFAULT_ICP_PROFILES structure in prospectIntel.js:
 *   low_rating | low_reviews | incomplete_gbp | outdated_website |
 *   no_review_response | owner_title | industry_match
 *
 * @param {object} agentData   — agent enrichment response
 * @param {object} csvData     — mapped CSV fields (contactTitle, city, state, etc.)
 * @param {object} icpProfile  — Firestore icpProfiles doc data (or null for defaults)
 * @returns {{ fitScore, fitLabel, signalHits, disqualified, disqualifyReason }}
 */
function calculateFitScore(agentData, csvData, icpProfile, marketContext) {
    const signals = Array.isArray(icpProfile?.buyingSignals) && icpProfile.buyingSignals.length
        ? icpProfile.buyingSignals
        : _defaultBuyingSignals();

    const disqualifySignals = Array.isArray(icpProfile?.disqualificationSignals) && icpProfile.disqualificationSignals.length
        ? icpProfile.disqualificationSignals
        : _defaultDisqualifications();

    // Check disqualification first — overrides score entirely
    const disqualifyReason = _checkDisqualification(agentData, disqualifySignals);
    if (disqualifyReason) {
        return { fitScore: 0, fitLabel: 'Disqualified', signalHits: [], disqualified: true, disqualifyReason };
    }

    const rating  = parseFloat(agentData.googleRating) || 0;
    const reviews = parseInt(agentData.totalReviews)    || 0;
    const hasWebsite = !!(agentData.websiteUrl && agentData.websiteUrl !== 'None' && agentData.websiteUrl !== '');
    const hasGBP     = rating > 0;

    const signalHits = [];
    let score = 0;

    function hit(key, matched, labelFn) {
        if (!matched) return;
        const sig = signals.find(s => s.key === key);
        const weight = sig ? (sig.weight || 0) : 0;
        if (weight > 0) {
            signalHits.push({ key, label: labelFn(), weight });
            score += weight;
        }
    }

    // PR #23A — OR-conditions when marketContext exists (additive-only)
    const mc = marketContext || null;
    const mcAvgRating  = mc ? parseFloat(mc.marketAvgRating) : NaN;
    const mcAvgReviews = mc ? parseInt(mc.marketAvgReviews) : NaN;

    const lowRatingStatic  = rating > 0 && rating < 4.3;
    const lowRatingMarket  = mc && !isNaN(mcAvgRating) && rating > 0 && rating < mcAvgRating;
    hit('low_rating',         lowRatingStatic || lowRatingMarket,
        () => `Rating ${rating}★ (${lowRatingStatic ? 'below 4.3' : ''}${lowRatingStatic && lowRatingMarket ? ' + ' : ''}${lowRatingMarket ? `below market avg ${mcAvgRating}` : ''})`);

    const lowReviewsStatic = reviews >= 0 && reviews < 50;
    const lowReviewsMarket = mc && !isNaN(mcAvgReviews) && reviews < 0.5 * mcAvgReviews;
    hit('low_reviews',        lowReviewsStatic || lowReviewsMarket,
        () => `Only ${reviews} reviews (${lowReviewsStatic ? 'below 50' : ''}${lowReviewsStatic && lowReviewsMarket ? ' + ' : ''}${lowReviewsMarket ? `below 50% of market avg ${mcAvgReviews}` : ''})`);
    hit('incomplete_gbp',     !hasGBP || !(agentData.address?.city || agentData.address),
        () => 'Incomplete Google Business Profile');
    hit('outdated_website',   !hasWebsite,
        () => 'No website detected');
    hit('no_review_response', reviews < 20 && (rating === 0 || rating < 4.0),
        () => 'No review response strategy visible');

    // Owner/decision-maker title
    const rawTitle   = (csvData.contactTitle || '').toLowerCase();
    const targets    = (icpProfile?.targetTitles || ['Owner','Manager','Director','Principal','Partner','Operator'])
        .map(t => t.toLowerCase());
    const titleMatch = rawTitle.length > 0 && targets.some(t => rawTitle.includes(t));
    hit('owner_title', titleMatch,
        () => `Decision maker: ${csvData.contactTitle}`);

    // Industry match
    const prospectIndustry = (agentData.industry || '').toLowerCase();
    const targetIndustries = icpProfile?.industries || ['all'];
    const industryMatch = targetIndustries.includes('all')
        || targetIndustries.some(ind => prospectIndustry.includes(ind.toLowerCase()));
    hit('industry_match', industryMatch,
        () => `Industry: ${agentData.industry || 'SMB'}`);

    // ── Tech Stack signals (PR #19) ──────────────────────────────────────
    // Only scored when techStack data is present (null-excluded from denominator)
    const ts = agentData.techStack;
    if (ts && ts.fetchStatus === 'ok') {
        hit('no_reputation_tool',
            Array.isArray(ts.reputationTools) && ts.reputationTools.length === 0,
            () => 'No reputation management tool detected');

        hit('displaceable_form_tool',
            Array.isArray(ts.formBuilders) && ts.formBuilders.some(f => f.type === 'cost' || f.type === 'workflow'),
            () => `Displaceable form tool: ${(ts.formBuilders || []).filter(f => f.type === 'cost' || f.type === 'workflow').map(f => f.name).join(', ')}`);

        hit('analytics_upsell',
            Array.isArray(ts.analytics) && ts.analytics.some(a => /Facebook Pixel|CallRail/i.test(a.name)),
            () => `Analytics upsell: ${(ts.analytics || []).filter(a => /Facebook Pixel|CallRail/i.test(a.name)).map(a => a.name).join(', ')}`);
    }

    // ── Market context signal (PR #23A) ──────────────────────────────────
    // Null-excluded when no marketContext
    if (mc && !isNaN(mcAvgReviews) && mcAvgReviews > 0) {
        hit('presence_gap',
            reviews <= 0.35 * mcAvgReviews,
            () => `Presence gap: ${reviews} reviews ≤ 35% of market avg ${mcAvgReviews}`);
    }

    const fitScore = Math.min(100, score);
    const fitLabel = fitScore >= 70 ? 'Strong Fit'
        : fitScore >= 50 ? 'Good Fit'
        : fitScore >= 30 ? 'Moderate Fit'
        : 'Low Fit';

    return { fitScore, fitLabel, signalHits, disqualified: false, disqualifyReason: null };
}

function _defaultBuyingSignals() {
    return [
        { key: 'low_rating',             weight: 25 },
        { key: 'low_reviews',            weight: 20 },
        { key: 'incomplete_gbp',         weight: 15 },
        { key: 'outdated_website',       weight: 15 },
        { key: 'no_review_response',     weight: 15 },
        { key: 'owner_title',            weight: 10 },
        { key: 'industry_match',         weight: 10 },
        // PR #19 — tech stack signals
        { key: 'no_reputation_tool',     weight: 10 },
        { key: 'displaceable_form_tool', weight: 8  },
        { key: 'analytics_upsell',       weight: 5  },
        // PR #23A — market context signal
        { key: 'presence_gap',           weight: 6  },
    ];
}

function _defaultDisqualifications() {
    return [
        { key: 'too_large' },
        { key: 'high_rating' },
    ];
}

function _checkDisqualification(agentData, disqualifySignals) {
    const rating  = parseFloat(agentData.googleRating) || 0;
    const reviews = parseInt(agentData.totalReviews)   || 0;

    for (const sig of disqualifySignals) {
        if (sig.key === 'high_rating' && rating >= 4.8 && reviews >= 500) {
            return `${rating}★ with ${reviews} reviews — established reputation, low PathSynch fit`;
        }
        if (sig.key === 'too_large' && reviews > 200) {
            return `${reviews} Google reviews — may not need PathSynch solutions`;
        }
        if (sig.key === 'franchise_corp') {
            const name = (agentData.prospectBusiness || '').toLowerCase();
            const franchisePatterns = ['franchise','corporate office','corporate hq','holdings'];
            if (franchisePatterns.some(p => name.includes(p))) {
                return 'Franchise corporate account — not SMB target';
            }
        }
    }
    return null;
}

// ── Recommended Product ────────────────────────────────────────────────────────

/**
 * Classify recommended PathSynch product based on enrichment signals.
 *
 * @param {object} agentData    — agent result
 * @param {string} productFocus — 'auto' | 'pathconnect' | 'localsynch' | etc.
 */
function classifyRecommendedProduct(agentData, productFocus) {
    if (productFocus && productFocus !== 'auto') {
        const map = {
            pathconnect:   'PathConnect',
            localsynch:    'LocalSynch',
            referralsynch: 'ReferralSynch',
            pathmanager:   'PathManager',
            fullsuite:     'Full PathSynch Suite',
        };
        return map[productFocus] || 'PathConnect + PathManager';
    }

    const rating  = parseFloat(agentData.googleRating) || 0;
    const reviews = parseInt(agentData.totalReviews)   || 0;
    const hasWebsite = !!(agentData.websiteUrl && agentData.websiteUrl !== 'None' && agentData.websiteUrl !== '');
    const hasGBP     = rating > 0;

    // Rating or review gap → review capture + dashboard
    if ((rating > 0 && rating < 4.3) || reviews < 50) {
        return 'PathConnect + PathManager';
    }
    // Missing digital presence → GBP optimization
    if (!hasGBP || !hasWebsite) {
        return 'LocalSynch';
    }
    // Strong reputation but no engagement tools → referral
    if (rating >= 4.5 && reviews >= 100) {
        return 'ReferralSynch';
    }
    return 'Full PathSynch Suite';
}

// ── Source Attribution ─────────────────────────────────────────────────────────

/**
 * Wrap an enriched field value in the standard provenance schema.
 */
function buildSourceAttribution(value, source, confidence) {
    return {
        value:         value !== undefined && value !== null ? value : null,
        source:        source     || 'unknown',
        confidence:    confidence || 'medium',
        updatedAt:     new Date().toISOString(),
        failureReason: null,
    };
}

// ── Research Agent Caller ──────────────────────────────────────────────────────

/**
 * Call the prospect-research Cloud Run agent.
 *
 * @param {string} businessName
 * @param {string} city
 * @param {string} state
 * @param {object} [seedData={}] — optional { website, phone } from CSV to give the agent a head-start
 * @returns {Promise<object>} — { prospectBusiness, websiteUrl, industry, subIndustry,
 *                               address, phone, googleRating, totalReviews, tagline,
 *                               topProducts, differentiators, targetCustomer,
 *                               decisionMaker, socialProfiles, buyingSignals, confidence }
 */
async function callResearchAgent(businessName, city, state, seedData = {}) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 30000);

    try {
        const payload = {
            businessName,
            city:  city  || '',
            state: state || '',
        };

        // Pass seed data so the agent can skip redundant searches
        if (seedData.website) payload.website = seedData.website;
        if (seedData.phone)   payload.phone   = seedData.phone;

        const response = await fetch(`${AGENT_BASE_URL}/api/research`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
            signal:  controller.signal
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Agent HTTP ${response.status}: ${text.substring(0, 300)}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

// ── Core Prospect Processor ────────────────────────────────────────────────────

/**
 * Enrich a single prospect:
 *   1. Read prospect doc
 *   2. Call research agent
 *   3. Merge + score against ICP
 *   4. Write enriched data back
 *   5. Update batch progress counter
 *
 * Safe to call multiple times (status check prevents re-processing).
 */
async function processOneProspect(batchId, prospectId) {
    const db = admin.firestore();

    const prospectRef = db.collection('prospectIntel').doc(batchId)
        .collection('prospects').doc(prospectId);
    const batchRef = db.collection('prospectIntel').doc(batchId);

    // ── Read prospect ──────────────────────────────────────────────────────────
    const prospectDoc = await prospectRef.get();
    if (!prospectDoc.exists) {
        console.error(`[ProspectIntelSvc] Prospect ${prospectId} not found in batch ${batchId}`);
        return;
    }

    const prospectData = prospectDoc.data();

    // Guard: already processed
    if (prospectData.enrichmentStatus !== 'pending') {
        console.log(`[ProspectIntelSvc] Prospect ${prospectId} status=${prospectData.enrichmentStatus} — skipping`);
        return;
    }

    const businessName = prospectData.companyName || '';

    // ── Mark in-progress ──────────────────────────────────────────────────────
    await prospectRef.update({
        enrichmentStatus:    'in_progress',
        enrichmentStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update batch's "currently enriching" label (best-effort)
    batchRef.update({ currentProspect: businessName }).catch(() => {});

    // ── Load ICP snapshot ────────────────────────────────────────────────────
    let icpProfile = null;
    try {
        const batchDoc = await batchRef.get();
        icpProfile = batchDoc.exists ? (batchDoc.data().icpProfileSnapshot || null) : null;
    } catch (_) { /* non-blocking */ }

    const productFocus = prospectData._productFocus || 'auto';

    // ── Build seed data from CSV fields ─────────────────────────────────────
    // Pass website (companyDomain) and phone if available in the CSV so the
    // agent can skip redundant searches and use known-good data as a starting point.
    const seedData = {};
    const rawDomain = String(prospectData.companyDomain || '').trim();
    if (rawDomain) {
        // Ensure the domain has a scheme so the agent can scrape it directly
        seedData.website = rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`;
    }
    const rawPhone = String(prospectData.phone || prospectData.contactPhone || '').trim();
    if (rawPhone) {
        seedData.phone = rawPhone;
    }

    // ── Call agent ───────────────────────────────────────────────────────────
    try {
        const agentResult = await callResearchAgent(
            businessName,
            prospectData.city  || '',
            prospectData.state || '',
            seedData
        );

        // ── Google Places fallback (cache-wrapped) ─────────────────────────────
        // If the agent missed GBP data or the website, check placesLookupCache
        // first, then call Places API on cache miss.
        const agentRatingMissing  = agentResult.googleRating == null;
        const agentWebsiteMissing = !agentResult.websiteUrl
            || agentResult.websiteUrl === 'None'
            || agentResult.websiteUrl === '';

        let ratingSource  = 'agent:gbp';
        let websiteSource = 'agent';

        if (agentRatingMissing || agentWebsiteMissing) {
            try {
                const pCity  = prospectData.city  || '';
                const pState = prospectData.state || '';

                // Cache-first
                let placesResult = await getPlacesLookup(businessName, pCity, pState);
                let fromCache = !!placesResult;

                if (!placesResult) {
                    placesResult = await lookupProspectPlace(businessName, pCity, pState);
                    // Cache the result (success or failure)
                    if (placesResult) {
                        await setPlacesLookup(businessName, pCity, pState, placesResult, !!placesResult.success).catch(() => {});
                    }
                }

                if (placesResult && placesResult.success) {
                    if (agentRatingMissing && placesResult.rating != null) {
                        agentResult.googleRating = placesResult.rating;
                        agentResult.totalReviews = placesResult.totalReviews;
                        ratingSource = 'google_places';
                    }
                    if (agentWebsiteMissing && placesResult.websiteUrl) {
                        agentResult.websiteUrl = placesResult.websiteUrl;
                        websiteSource = 'google_places';
                    }
                    if (!agentResult.phone && placesResult.phone) {
                        agentResult.phone = placesResult.phone;
                    }
                    console.log(
                        `[ProspectIntelSvc] Places fallback for "${businessName}" (${fromCache ? 'cache' : 'live'}):`,
                        `rating=${placesResult.rating ?? 'n/a'},`,
                        `website=${placesResult.websiteUrl ?? 'n/a'}`
                    );
                } else if (!fromCache) {
                    console.log(`[ProspectIntelSvc] Places fallback found nothing for "${businessName}": ${placesResult?.error || 'no result'}`);
                }
            } catch (placesErr) {
                console.warn(`[ProspectIntelSvc] Places fallback error for "${businessName}":`, placesErr.message);
            }
        }

        // ── Tech Stack Detection (PR #19) ────────────────────────────────────
        let techStackResult = null;
        try {
            const tsUrl = agentResult.websiteUrl;
            if (tsUrl && tsUrl !== 'None' && tsUrl !== '') {
                techStackResult = await detectTechStack(tsUrl);
            }
            if (techStackResult) {
                agentResult.techStack = techStackResult;
            }
        } catch (techErr) {
            console.warn(`[ProspectIntelSvc] Tech detection error for "${businessName}" (non-blocking):`, techErr.message);
        }

        // ── GBP Grading (PR #19) ─────────────────────────────────────────────
        let gbpGrade = null;
        try {
            gbpGrade = gradeGBP(agentResult);
        } catch (gbpErr) {
            console.warn(`[ProspectIntelSvc] GBP grading error for "${businessName}" (non-blocking):`, gbpErr.message);
        }

        // ── Market Context Matching (PR #23A) ─────────────────────────────────
        let marketIntelMatch  = null;
        let reviewHealthPartials = null;
        let batchMarketContext = null;

        try {
            const batchSnap = await batchRef.get();
            batchMarketContext = batchSnap.exists ? (batchSnap.data().marketContext || null) : null;

            if (batchMarketContext) {
                // Read competitor index from meta doc
                const metaDoc = await batchRef.collection('meta').doc('marketIndex').get();
                const competitorIndex = metaDoc.exists ? (metaDoc.data().competitorIndex || []) : [];

                if (competitorIndex.length > 0) {
                    const matchResult = matchProspectToReport(
                        { name: businessName, city: prospectData.city, state: prospectData.state },
                        { city: batchMarketContext.reportId ? (competitorIndex[0]?.city || '') : '', state: competitorIndex[0]?.state || '' },
                        competitorIndex
                    );

                    if (matchResult) {
                        const m = matchResult.matched;
                        marketIntelMatch = buildSourceAttribution({
                            matchedName:     m.rawName,
                            matchType:       matchResult.matchType,
                            reportId:        batchMarketContext.reportId,
                            voiceShare:      m.voiceShare,
                            seoScore:        m.seoScore,
                            seoTier:         m.seoTier,
                            opportunityScore: m.opportunityScore,
                            intelSignals:    m.intelSignals,
                        }, 'market_intel', 'medium');

                        // Pre-populate reviewHealth partials from market report
                        if (m.responseRate != null || m.lastReviewDaysAgo != null) {
                            reviewHealthPartials = buildSourceAttribution({
                                responseRate:       m.responseRate,
                                daysSinceLastReview: m.lastReviewDaysAgo,
                                velocity:           null,     // NEVER fabricated
                                reviewHealthGrade:  null,     // NEVER fabricated
                            }, 'market_intel', 'medium');
                        }
                    }
                }
            }
        } catch (mcErr) {
            console.warn(`[ProspectIntelSvc] Market context matching error for "${businessName}" (non-blocking):`, mcErr.message);
        }

        // ── Build enriched payload ────────────────────────────────────────────
        const fitResult          = calculateFitScore(agentResult, prospectData, icpProfile, batchMarketContext);
        const recommendedProduct = classifyRecommendedProduct(agentResult, productFocus);

        const enriched = {
            // Business fields (agent-sourced, with attribution)
            prospectBusiness: buildSourceAttribution(agentResult.prospectBusiness, 'agent', 'high'),
            websiteUrl:       buildSourceAttribution(agentResult.websiteUrl,       websiteSource, websiteSource === 'google_places' ? 'medium' : 'high'),
            industry:         buildSourceAttribution(agentResult.industry,         'agent', 'high'),
            subIndustry:      buildSourceAttribution(agentResult.subIndustry,      'agent', 'high'),
            address:          buildSourceAttribution(agentResult.address,          'agent', 'high'),
            phone:            buildSourceAttribution(agentResult.phone,            'agent', 'medium'),
            googleRating:     buildSourceAttribution(agentResult.googleRating,     ratingSource, ratingSource === 'google_places' ? 'medium' : 'high'),
            totalReviews:     buildSourceAttribution(agentResult.totalReviews,     ratingSource, ratingSource === 'google_places' ? 'medium' : 'high'),
            tagline:          buildSourceAttribution(agentResult.tagline,          'agent', 'medium'),
            topProducts:      buildSourceAttribution(agentResult.topProducts,      'agent', 'medium'),
            differentiators:  buildSourceAttribution(agentResult.differentiators,  'agent', 'medium'),
            targetCustomer:   buildSourceAttribution(agentResult.targetCustomer,   'agent', 'medium'),
            decisionMaker:    buildSourceAttribution(agentResult.decisionMaker,    'agent', 'medium'),
            socialProfiles:   buildSourceAttribution(agentResult.socialProfiles,   'agent', 'medium'),
            agentBuyingSignals: Array.isArray(agentResult.buyingSignals) ? agentResult.buyingSignals : [],

            // Qualification
            fitScore:          fitResult.fitScore,
            fitLabel:          fitResult.fitLabel,
            disqualified:      fitResult.disqualified,
            disqualifyReason:  fitResult.disqualifyReason || null,
            signalHits:        fitResult.signalHits,
            recommendedProduct,

            // Workflow (all new prospects need operator review)
            workflowStatus: 'needs_review',
            agentConfidence: agentResult.confidence || 'medium',

            // Data provenance — only written if agent returned these fields
            ...(agentResult.dataSource     ? { dataSource:     agentResult.dataSource }     : {}),
            ...(agentResult.businessStatus ? { businessStatus: agentResult.businessStatus } : {}),

            // Tech stack + GBP (PR #19/21)
            ...(techStackResult ? { techStack: buildSourceAttribution(techStackResult, 'tech_detection', 'high') } : {}),
            ...(gbpGrade        ? { gbpGrade:  buildSourceAttribution(gbpGrade,        'gbp_grader',     'high') } : {}),

            // Market intel match (PR #23A)
            ...(marketIntelMatch   ? { marketIntelMatch }   : {}),
            ...(reviewHealthPartials ? { reviewHealth: reviewHealthPartials } : {}),

            // Review health status — queued for Phase B selection
            reviewHealthStatus: 'not_queued',

            // Enrichment metadata
            enrichmentStatus:      'enriched',
            enrichmentCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            enrichmentError:       null,
        };

        await prospectRef.update(enriched);
        console.log(`[ProspectIntelSvc] ✅ ${businessName} — fitScore=${fitResult.fitScore} (${fitResult.fitLabel})`);

        // ── Charge credits for this successful enrichment (atomic + idempotent) ──
        // Credits are charged ONLY on success, not at batch creation.
        // See chargeProspectEnrichmentCreditOnce() for the single-transaction implementation.
        const enrichUserId = prospectData.userId;
        if (enrichUserId && enrichUserId !== 'anonymous') {
            await chargeProspectEnrichmentCreditOnce(enrichUserId, batchId, prospectId);
        }

        // ── Increment completedCount + Phase B trigger ─────────────────────────
        const progressResult = await _incrementBatchProgress(batchRef, 'completedCount');
        if (progressResult && progressResult.batchCompleted) {
            try {
                await runPhaseBSelection(batchId);
            } catch (pbErr) {
                console.warn(`[ProspectIntelSvc] Phase B selection error (non-blocking):`, pbErr.message);
            }
        }

    } catch (err) {
        console.error(`[ProspectIntelSvc] ❌ Failed to enrich ${businessName} (${prospectId}):`, err.message);

        await prospectRef.update({
            enrichmentStatus:   'failed',
            enrichmentError:    err.message.substring(0, 500),
            enrichmentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            retryCount:         admin.firestore.FieldValue.increment(1),
        });

        const failProgressResult = await _incrementBatchProgress(batchRef, 'failedCount');
        if (failProgressResult && failProgressResult.batchCompleted) {
            try {
                await runPhaseBSelection(batchId);
            } catch (pbErr) {
                console.warn(`[ProspectIntelSvc] Phase B selection error (non-blocking):`, pbErr.message);
            }
        }
    }
}

/**
 * Atomically increment completedCount or failedCount and flip batch to 'completed' when done.
 *
 * Uses a transaction so the counter increment and completion check are a single
 * atomic operation. This prevents "This operation was aborted" contention errors
 * when many Cloud Tasks update the same batch document simultaneously.
 */
async function _incrementBatchProgress(batchRef, counterField) {
    const db = admin.firestore();

    try {
        const result = await db.runTransaction(async (t) => {
            const fresh = await t.get(batchRef);
            if (!fresh.exists) return { batchCompleted: false };
            const d = fresh.data();

            // Manual increment (FieldValue.increment cannot be used inside transactions)
            const newValue        = (d[counterField] || 0) + 1;
            const completedCount  = counterField === 'completedCount' ? newValue : (d.completedCount || 0);
            const failedCount     = counterField === 'failedCount'    ? newValue : (d.failedCount    || 0);
            const done  = completedCount + failedCount;
            const total = d.totalProspects || 0;

            const updates = {
                [counterField]: newValue,
                updatedAt:      admin.firestore.FieldValue.serverTimestamp()
            };

            let justCompleted = false;
            if (total > 0 && done >= total && d.status !== 'completed') {
                updates.status      = 'completed';
                updates.completedAt = admin.firestore.FieldValue.serverTimestamp();
                justCompleted = true;
                console.log(`[ProspectIntelSvc] Batch ${batchRef.id} COMPLETE — ${completedCount} enriched, ${failedCount} failed`);
            }

            t.update(batchRef, updates);
            return { batchCompleted: justCompleted };
        });
        return result;
    } catch (err) {
        // Non-critical — frontend listener handles completion display
        console.warn('[ProspectIntelSvc] Batch progress update failed:', err.message);
        return { batchCompleted: false };
    }
}

// ── Per-Prospect Atomic Credit Charge ─────────────────────────────────────────

/**
 * Atomic, idempotent per-prospect credit charge.
 *
 * Uses a SINGLE Firestore transaction to:
 *   1. Read the deterministic ledger doc  (prospect_enrich:{prospectId})
 *   2. Read the user's credit balance
 *   3. Skip if ledger doc already exists  (idempotent)
 *   4. Skip if balance < CREDITS_PER_PROSPECT (no negative balance)
 *   5. Decrement credits AND create ledger doc in the same transaction
 *
 * @param {string} userId
 * @param {string} batchId
 * @param {string} prospectId
 * @param {object} [options]   — { creditsPerProspect }
 * @returns {{ charged: boolean, reason: string, available?: number }}
 */
async function chargeProspectEnrichmentCreditOnce(userId, batchId, prospectId, options = {}) {
    const CREDITS_PER_PROSPECT = options.creditsPerProspect || 15;
    const db = admin.firestore();

    const idempotencyKey = `prospect_enrich:${prospectId}`;
    const ledgerRef      = db.collection('creditLedger').doc(idempotencyKey);
    const userRef        = db.collection('users').doc(userId);

    try {
        const result = await db.runTransaction(async (tx) => {
            const [ledgerSnap, userSnap] = await Promise.all([
                tx.get(ledgerRef),
                tx.get(userRef),
            ]);

            // ── Idempotency: already charged ──
            if (ledgerSnap.exists) {
                return { charged: false, reason: 'already_charged' };
            }

            // ── Balance check ──
            const currentCredits = userSnap.exists
                ? (userSnap.data().credits || 0)
                : 0;

            if (currentCredits < CREDITS_PER_PROSPECT) {
                return {
                    charged:   false,
                    reason:    'insufficient_credits',
                    available: currentCredits,
                };
            }

            // ── Atomic write: decrement + ledger in same transaction ──
            tx.update(userRef, {
                credits: admin.firestore.FieldValue.increment(-CREDITS_PER_PROSPECT),
            });

            tx.set(ledgerRef, {
                userId,
                amount:             -CREDITS_PER_PROSPECT,
                reason:             'prospect_enrichment',
                service:            'prospect_intel',
                idempotencyKey,
                batchId,
                prospectId,
                creditsPerProspect: CREDITS_PER_PROSPECT,
                chargedOn:          'success',
                createdAt:          admin.firestore.FieldValue.serverTimestamp(),
            });

            return { charged: true, reason: 'charged' };
        });

        if (result.charged) {
            console.log(`[ProspectIntelSvc] Charged ${CREDITS_PER_PROSPECT} credits for prospect ${prospectId} (batch ${batchId})`);
        }

        return result;
    } catch (err) {
        console.error(`[ProspectIntelSvc] Credit transaction failed for ${prospectId}:`, err.message);
        return { charged: false, reason: 'transaction_failed' };
    }
}

// ── Legacy Batch Credit Deduction ─────────────────────────────────────────────

/**
 * Deduct 15 credits per prospect from the user's balance.
 * Writes a creditLedger entry for audit trail + idempotency.
 * Non-blocking — failures are logged but not thrown.
 *
 * @param {string} userId
 * @param {number} count      — number of prospects
 * @param {string} batchId    — used as idempotency key
 */
async function deductProspectCredits(userId, count, batchId) {
    if (!userId || userId === 'anonymous' || !count || count <= 0) return;

    const db             = admin.firestore();
    const idempotencyKey = `prospect:${batchId}`;
    const ledgerRef      = db.collection('creditLedger').doc(idempotencyKey);

    // Idempotency guard
    const existing = await ledgerRef.get().catch(() => null);
    if (existing && existing.exists) {
        console.log(`[ProspectIntel] Credit deduction already recorded for ${batchId} — skipping`);
        return;
    }

    const amount = count * 15;

    try {
        const batch = db.batch();

        batch.update(db.collection('users').doc(userId), {
            credits: admin.firestore.FieldValue.increment(-amount)
        });

        batch.set(ledgerRef, {
            userId,
            amount:              -amount,
            reason:              'prospect_enrichment',
            batchId,
            prospectCount:       count,
            creditsPerProspect:  15,
            createdAt:           admin.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        console.log(`[ProspectIntel] Deducted ${amount} credits from ${userId} for batch ${batchId} (${count} prospects × 15)`);
    } catch (err) {
        console.warn('[ProspectIntel] Credit deduction failed (non-blocking):', err.message);
    }
}

// ── Cloud Task Enqueuer ────────────────────────────────────────────────────────

/**
 * Enqueue a single prospect for enrichment via Google Cloud Tasks.
 *
 * Requires:
 *   - Cloud Tasks queue "prospect-enrichment" in us-central1 / pathconnect-442522
 *   - PROSPECT_TASK_SECRET env var set in functions/.env (shared with processProspectTask)
 *   - processProspectTask Cloud Function deployed (separate export in index.js)
 *
 * Queue creation (one-time setup):
 *   gcloud tasks queues create prospect-enrichment --location=us-central1 --project=pathconnect-442522
 */
async function enqueueProspectTask(batchId, prospectId) {
    try {
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const client   = await auth.getClient();
        const tokenRes = await client.getAccessToken();
        const token    = tokenRes.token;

        if (!token) throw new Error('Failed to get GCP access token for Cloud Tasks');

        const payload        = { batchId, prospectId };
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');

        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url:        TASK_HANDLER_URL,
                headers: {
                    'Content-Type':  'application/json',
                    'X-Task-Secret': process.env.PROSPECT_TASK_SECRET || ''
                },
                body: encodedPayload
            }
        };

        const queuePath = `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/queues/${TASKS_QUEUE}`;
        const apiUrl    = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

        const response = await fetch(apiUrl, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json'
            },
            body: JSON.stringify({ task })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Cloud Tasks enqueue failed (${response.status}): ${text.substring(0, 300)}`);
        }

        const result = await response.json();
        console.log(`[ProspectIntel] Enqueued task for ${prospectId} → ${result.name}`);
        return result;

    } catch (err) {
        // Enqueue failed — mark prospect as failed and advance the batch counter
        // so the batch can still reach "completed" rather than hanging indefinitely.
        console.error(`[ProspectIntel] ❌ Enqueue failed for prospect ${prospectId} in batch ${batchId}:`, err.message);

        const db          = admin.firestore();
        const prospectRef = db.collection('prospectIntel').doc(batchId)
            .collection('prospects').doc(prospectId);
        const batchRef    = db.collection('prospectIntel').doc(batchId);

        try {
            await prospectRef.update({
                enrichmentStatus:   'failed',
                enrichmentError:    `Enqueue failed: ${err.message.substring(0, 300)}`,
                enrichmentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
                retryCount:         admin.firestore.FieldValue.increment(1),
            });
            await _incrementBatchProgress(batchRef, 'failedCount');
        } catch (writeErr) {
            // Non-critical — log and continue fan-out
            console.warn(`[ProspectIntel] Could not write enqueue failure for ${prospectId}:`, writeErr.message);
        }
        // Do NOT re-throw — let the fan-out continue for remaining prospects
    }
}

// ── sendProspectsToNemoClaw ────────────────────────────────────────────────────
//
// Reads approved prospect docs, builds NemoClaw payload, POSTs to PathManager,
// then marks each prospect workflowStatus: 'sent_to_nemoclaw' in Firestore.
//
// Returns: { success, sentCount, nemoClawBatchId }

async function sendProspectsToNemoClaw(batchId, prospectIds, userId, options = {}) {
    const db = admin.firestore();

    // ── Read batch metadata ───────────────────────────────────────────────────
    const batchDoc  = await db.collection('prospectIntel').doc(batchId).get();
    const batchData = batchDoc.exists ? batchDoc.data() : {};
    const sourceLabel = batchData.sourceLabel || 'Prospect List';

    // ── Read prospect docs ────────────────────────────────────────────────────
    const prospectRefs = prospectIds.map(pid =>
        db.collection('prospectIntel').doc(batchId).collection('prospects').doc(pid)
    );
    const prospectDocs = await Promise.all(prospectRefs.map(ref => ref.get()));

    const nemoProspects = [];
    const validDocs     = [];

    for (const doc of prospectDocs) {
        if (!doc.exists) continue;
        const d = doc.data();

        const getVal = (field) => {
            if (!field) return null;
            if (typeof field === 'object' && 'value' in field) return field.value;
            return field;
        };

        // Contact name — deduplicate same-value first/last pattern
        const fn = String(d.contactFirstName || '').trim();
        const ln = String(d.contactLastName  || '').trim();
        let contactName;
        if (!fn && !ln)                                        contactName = null;
        else if (!ln)                                          contactName = fn;
        else if (!fn)                                          contactName = ln;
        else if (fn.toLowerCase() === ln.toLowerCase())        contactName = fn;
        else if (ln.toLowerCase().includes(fn.toLowerCase()) && fn.split(' ').length === 1) contactName = ln;
        else if (fn.toLowerCase().includes(ln.toLowerCase()) && ln.split(' ').length === 1) contactName = fn;
        else                                                   contactName = `${fn} ${ln}`;

        nemoProspects.push({
            prospectId:         doc.id,
            companyName:        d.companyName          || null,
            contactName,
            contactEmail:       d.contactEmail         || null,
            contactTitle:       d.contactTitle         || null,
            contactLinkedIn:    d.contactLinkedIn      || null,
            city:               d.city                 || null,
            state:              d.state                || null,
            website:            getVal(d.websiteUrl),
            industry:           getVal(d.industry),
            googleRating:       getVal(d.googleRating),
            totalReviews:       getVal(d.totalReviews),
            tagline:            getVal(d.tagline),
            topProducts:        getVal(d.topProducts),
            buyingSignals:      Array.isArray(d.signalHits) ? d.signalHits : [],
            fitScore:           d.fitScore           || null,
            fitLabel:           d.fitLabel           || null,
            recommendedProduct: d.recommendedProduct || null,
        });
        validDocs.push(doc);
    }

    if (!nemoProspects.length) {
        throw new Error('No valid prospects found to send to NemoClaw');
    }

    // ── Build payload ─────────────────────────────────────────────────────────
    const batchLabel = `${sourceLabel} — ${nemoProspects.length} prospect${nemoProspects.length === 1 ? '' : 's'}`;

    // Sprint 3: derive taxonomy context from batch or first prospect industry
    const batchIndustry = batchData.industry || nemoProspects[0]?.industry || null;
    const batchSubIndustry = batchData.subIndustry || null;
    let taxonomyCampaignContext = null;
    try {
        const nemoIndustryConfig = findIndustry(batchIndustry);
        const nemoSubIndustryConfig = findSubIndustry(batchIndustry, batchSubIndustry);
        const nemoReportProfile = getReportProfile(nemoIndustryConfig?.reportProfile);
        taxonomyCampaignContext = {
            industryId: nemoIndustryConfig?.id || null,
            industryLabel: batchIndustry || null,
            subIndustryId: nemoSubIndustryConfig?.id || null,
            subIndustryLabel: batchSubIndustry || null,
            scoringProfile: nemoIndustryConfig?.scoringProfile || null,
            reportProfile: nemoIndustryConfig?.reportProfile || null,
            competitorLanguage: nemoReportProfile?.competitorLanguage || 'competitors',
            opportunityLanguage: nemoReportProfile?.opportunityLanguage || 'opportunity gap',
            avoidLanguage: nemoReportProfile?.avoidSections || [],
            recommendedAngle: nemoProspects[0]?.recommendedProduct || null,
            intelSignal: null
        };
    } catch(e) {
        console.warn('[ProspectIntelService] Failed to build taxonomyCampaignContext:', e.message);
    }

    const payload = {
        batchLabel,
        campaignObjective: options.campaignObjective || null,
        userId,
        prospects:         nemoProspects,
        sourceType:        'prospect_intel',
        batchId,
        ...(taxonomyCampaignContext ? { taxonomyCampaignContext } : {})
    };

    // ── POST to NemoClaw ──────────────────────────────────────────────────────
    const NEMOCLAW_SERVICE_KEY = process.env.NEMOCLAW_SERVICE_KEY || '';
    const NEMOCLAW_URL         = 'https://pathsynch.com/api/v1/campaigns/generate';

    const response = await fetch(NEMOCLAW_URL, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Service-Key': NEMOCLAW_SERVICE_KEY,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`NemoClaw API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const result        = await response.json().catch(() => ({}));
    const nemoClawBatchId = result.batchId || result.id || null;

    // ── Update prospect statuses ──────────────────────────────────────────────
    const CHUNK = 499;
    for (let i = 0; i < validDocs.length; i += CHUNK) {
        const chunk          = validDocs.slice(i, i + CHUNK);
        const firestoreBatch = db.batch();
        for (const doc of chunk) {
            firestoreBatch.update(doc.ref, {
                workflowStatus:    'sent_to_nemoclaw',
                nemoClawSentAt:    admin.firestore.FieldValue.serverTimestamp(),
                nemoClawBatchId:   nemoClawBatchId,
                workflowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await firestoreBatch.commit();
    }

    console.log(`[ProspectIntelService] Sent ${validDocs.length} prospects to NemoClaw batch ${nemoClawBatchId}`);

    return {
        success:        true,
        sentCount:      validDocs.length,
        nemoClawBatchId,
    };
}

// ── Phase B Selection (PR #21) ───────────────────────────────────────────────

const { enqueueReviewHealthTask } = require('./reviewHealthEnqueue');

const REVIEW_HEALTH_BATCH_AUTO_MAX    = parseInt(process.env.REVIEW_HEALTH_BATCH_AUTO_MAX)    || 100;
const REVIEW_HEALTH_DAILY_MAX_PROSPECTS = parseInt(process.env.REVIEW_HEALTH_DAILY_MAX_PROSPECTS) || 500;

/**
 * Run Phase B auto-selection: pick top-N enriched prospects by fitScore desc,
 * flip reviewHealthStatus to 'queued', enqueue Cloud Tasks for review health.
 *
 * Called once when batch completes. Transaction guard prevents double-fire.
 */
async function runPhaseBSelection(batchId) {
    if (process.env.ENABLE_REVIEW_HEALTH_ENRICHMENT !== 'true' ||
        process.env.ENABLE_AUTO_REVIEW_ENRICHMENT !== 'true') {
        console.log(`[PhaseBSelection] Skipped for ${batchId} — feature flags off`);
        return;
    }

    const db       = admin.firestore();
    const batchRef = db.collection('prospectIntel').doc(batchId);

    // ── Transaction guard: single-fire ───────────────────────────────────────
    let shouldProceed = false;
    try {
        await db.runTransaction(async (t) => {
            const snap = await t.get(batchRef);
            if (!snap.exists) return;
            const d = snap.data();

            const currentStatus = d.phaseBSelectionStatus || 'not_started';
            if (currentStatus === 'running' || currentStatus === 'done') {
                shouldProceed = false;
                return;
            }

            t.update(batchRef, {
                phaseBSelectionStatus:    'running',
                phaseBSelectionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            shouldProceed = true;
        });
    } catch (err) {
        console.error(`[PhaseBSelection] Transaction guard failed for ${batchId}:`, err.message);
        return;
    }

    if (!shouldProceed) {
        console.log(`[PhaseBSelection] Skipped for ${batchId} — already running or done`);
        return;
    }

    try {
        // ── Query eligible prospects ─────────────────────────────────────────
        const prospectsSnap = await db.collection('prospectIntel').doc(batchId)
            .collection('prospects')
            .where('enrichmentStatus', '==', 'enriched')
            .where('reviewHealthStatus', '==', 'not_queued')
            .get();

        // Filter fitScore >= 70 and sort in memory (avoid composite index)
        // Market-intel reuse rule: exclude prospects with BOTH responseRate AND
        // lastReviewDaysAgo from a report ≤30 days old when flag is on
        const marketIntelReuse = process.env.MARKET_INTEL_REVIEW_REUSE === 'true';
        let phaseBReusedFromMarketIntel = 0;

        const batchDoc = await batchRef.get();
        const batchMC  = batchDoc.exists ? (batchDoc.data().marketContext || null) : null;
        const reportAgeDays = batchMC?.ageDays ?? Infinity;

        const eligible = prospectsSnap.docs
            .map(d => {
                const data = d.data();
                return { id: d.id, fitScore: data.fitScore || 0, reviewHealth: data.reviewHealth, marketIntelMatch: data.marketIntelMatch };
            })
            .filter(p => {
                if (p.fitScore < 70) return false;

                // Reuse exclusion: market-intel-sourced review partials from fresh report
                if (marketIntelReuse && p.reviewHealth?.source === 'market_intel' && reportAgeDays <= 30) {
                    const rh = p.reviewHealth?.value;
                    if (rh && rh.responseRate != null && rh.daysSinceLastReview != null) {
                        phaseBReusedFromMarketIntel++;
                        return false;
                    }
                }
                return true;
            })
            .sort((a, b) => b.fitScore - a.fitScore)
            .slice(0, REVIEW_HEALTH_BATCH_AUTO_MAX);

        if (eligible.length === 0) {
            await batchRef.update({
                phaseBSelectionStatus:      'done',
                phaseBSelectionDone:        true,
                phaseBSelectionCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
                phaseBSelectedCount:        0,
            });
            console.log(`[PhaseBSelection] Batch ${batchId}: no eligible prospects (fitScore >= 70)`);
            return;
        }

        // ── Daily cap check + atomic enqueue ─────────────────────────────────
        const today      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const counterRef = db.collection('reviewHealthDailyCounters').doc(today);

        let selectedCount         = 0;
        let phaseBCapHit          = null;

        for (const prospect of eligible) {
            // Atomic: increment daily counter + flip prospect status in one transaction
            let enqueueOk = false;
            try {
                await db.runTransaction(async (t) => {
                    const counterSnap = await t.get(counterRef);
                    const currentCount = counterSnap.exists ? (counterSnap.data().count || 0) : 0;

                    if (currentCount >= REVIEW_HEALTH_DAILY_MAX_PROSPECTS) {
                        phaseBCapHit = 'daily';
                        return; // exits transaction without writing
                    }

                    const prospectRef = db.collection('prospectIntel').doc(batchId)
                        .collection('prospects').doc(prospect.id);

                    // Re-read prospect to confirm still not_queued
                    const pSnap = await t.get(prospectRef);
                    if (!pSnap.exists || pSnap.data().reviewHealthStatus !== 'not_queued') return;

                    // Atomic: counter + status
                    if (counterSnap.exists) {
                        t.update(counterRef, { count: currentCount + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                    } else {
                        t.set(counterRef, { count: 1, date: today, createdAt: admin.firestore.FieldValue.serverTimestamp() });
                    }
                    t.update(prospectRef, {
                        reviewHealthStatus:   'queued',
                        reviewHealthQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    enqueueOk = true;
                });
            } catch (txErr) {
                console.warn(`[PhaseBSelection] Transaction failed for ${prospect.id}:`, txErr.message);
                continue;
            }

            if (phaseBCapHit) break;

            if (enqueueOk) {
                // Enqueue Cloud Task (idempotent named task)
                await enqueueReviewHealthTask(batchId, prospect.id).catch(eqErr => {
                    console.warn(`[PhaseBSelection] Enqueue failed for ${prospect.id} (non-blocking):`, eqErr.message);
                });
                selectedCount++;
            }
        }

        // ── Update batch with selection results ──────────────────────────────
        await batchRef.update({
            phaseBSelectionStatus:      'done',
            phaseBSelectionDone:        true,
            phaseBSelectionCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            phaseBSelectedCount:        selectedCount,
            ...(phaseBCapHit ? { phaseBCapHit } : {}),
            ...(phaseBReusedFromMarketIntel > 0 ? { phaseBReusedFromMarketIntel } : {}),
        });

        console.log(`[PhaseBSelection] Batch ${batchId}: selected ${selectedCount}/${eligible.length} prospects for review health (${phaseBReusedFromMarketIntel} reused from market intel)`);

    } catch (err) {
        console.error(`[PhaseBSelection] ❌ Failed for ${batchId}:`, err.message);
        await batchRef.update({
            phaseBSelectionStatus: 'failed',
            phaseBSelectionError:  err.message.substring(0, 500),
        }).catch(() => {});
    }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
    calculateFitScore,
    classifyRecommendedProduct,
    buildSourceAttribution,
    callResearchAgent,
    processOneProspect,
    chargeProspectEnrichmentCreditOnce,
    deductProspectCredits,
    enqueueProspectTask,
    sendProspectsToNemoClaw,
    runPhaseBSelection,
};
