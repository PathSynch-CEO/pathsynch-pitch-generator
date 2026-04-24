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
function calculateFitScore(agentData, csvData, icpProfile) {
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

    hit('low_rating',         rating > 0 && rating < 4.3,
        () => `Rating ${rating}★ (below 4.3)`);
    hit('low_reviews',        reviews >= 0 && reviews < 50,
        () => `Only ${reviews} Google reviews`);
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

    const fitScore = Math.min(100, score);
    const fitLabel = fitScore >= 70 ? 'Strong Fit'
        : fitScore >= 50 ? 'Good Fit'
        : fitScore >= 30 ? 'Moderate Fit'
        : 'Low Fit';

    return { fitScore, fitLabel, signalHits, disqualified: false, disqualifyReason: null };
}

function _defaultBuyingSignals() {
    return [
        { key: 'low_rating',         weight: 25 },
        { key: 'low_reviews',        weight: 20 },
        { key: 'incomplete_gbp',     weight: 15 },
        { key: 'outdated_website',   weight: 15 },
        { key: 'no_review_response', weight: 15 },
        { key: 'owner_title',        weight: 10 },
        { key: 'industry_match',     weight: 10 },
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
 * @returns {Promise<object>} — { prospectBusiness, websiteUrl, industry, subIndustry,
 *                               address, phone, googleRating, totalReviews, tagline,
 *                               topProducts, differentiators, targetCustomer, confidence }
 */
async function callResearchAgent(businessName, city, state) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(`${AGENT_BASE_URL}/api/research`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ businessName, city: city || '', state: state || '' }),
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

    // ── Call agent ───────────────────────────────────────────────────────────
    try {
        const agentResult = await callResearchAgent(
            businessName,
            prospectData.city  || '',
            prospectData.state || ''
        );

        // ── Google Places fallback ────────────────────────────────────────────
        // If the agent missed GBP data or the website, call Places API to fill gaps.
        const agentRatingMissing  = agentResult.googleRating == null;
        const agentWebsiteMissing = !agentResult.websiteUrl
            || agentResult.websiteUrl === 'None'
            || agentResult.websiteUrl === '';

        let ratingSource  = 'agent:gbp';
        let websiteSource = 'agent';

        if (agentRatingMissing || agentWebsiteMissing) {
            try {
                const placesResult = await lookupProspectPlace(
                    businessName,
                    prospectData.city  || '',
                    prospectData.state || ''
                );

                if (placesResult.success) {
                    if (agentRatingMissing && placesResult.rating != null) {
                        agentResult.googleRating = placesResult.rating;
                        agentResult.totalReviews = placesResult.totalReviews;
                        ratingSource = 'google_places';
                    }
                    if (agentWebsiteMissing && placesResult.websiteUrl) {
                        agentResult.websiteUrl = placesResult.websiteUrl;
                        websiteSource = 'google_places';
                    }
                    // Backfill phone if agent also missed it
                    if (!agentResult.phone && placesResult.phone) {
                        agentResult.phone = placesResult.phone;
                    }
                    console.log(
                        `[ProspectIntelSvc] Places fallback for "${businessName}":`,
                        `rating=${placesResult.rating ?? 'n/a'},`,
                        `website=${placesResult.websiteUrl ?? 'n/a'}`
                    );
                } else {
                    console.log(`[ProspectIntelSvc] Places fallback found nothing for "${businessName}": ${placesResult.error}`);
                }
            } catch (placesErr) {
                // Non-blocking — agent result still used as-is
                console.warn(`[ProspectIntelSvc] Places fallback error for "${businessName}":`, placesErr.message);
            }
        }

        // ── Build enriched payload ────────────────────────────────────────────
        const fitResult          = calculateFitScore(agentResult, prospectData, icpProfile);
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

            // Enrichment metadata
            enrichmentStatus:      'enriched',
            enrichmentCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            enrichmentError:       null,
        };

        await prospectRef.update(enriched);
        console.log(`[ProspectIntelSvc] ✅ ${businessName} — fitScore=${fitResult.fitScore} (${fitResult.fitLabel})`);

        // ── Increment completedCount ──────────────────────────────────────────
        await _incrementBatchProgress(batchRef, 'completedCount');

    } catch (err) {
        console.error(`[ProspectIntelSvc] ❌ Failed to enrich ${businessName} (${prospectId}):`, err.message);

        await prospectRef.update({
            enrichmentStatus:   'failed',
            enrichmentError:    err.message.substring(0, 500),
            enrichmentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            retryCount:         admin.firestore.FieldValue.increment(1),
        });

        await _incrementBatchProgress(batchRef, 'failedCount');
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
        await db.runTransaction(async (t) => {
            const fresh = await t.get(batchRef);
            if (!fresh.exists) return;
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

            if (total > 0 && done >= total && d.status !== 'completed') {
                updates.status      = 'completed';
                updates.completedAt = admin.firestore.FieldValue.serverTimestamp();
                console.log(`[ProspectIntelSvc] Batch ${batchRef.id} COMPLETE — ${completedCount} enriched, ${failedCount} failed`);
            }

            t.update(batchRef, updates);
        });
    } catch (err) {
        // Non-critical — frontend listener handles completion display
        console.warn('[ProspectIntelSvc] Batch progress update failed:', err.message);
    }
}

// ── Credit Deduction ───────────────────────────────────────────────────────────

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
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
    calculateFitScore,
    classifyRecommendedProduct,
    buildSourceAttribution,
    callResearchAgent,
    processOneProspect,
    deductProspectCredits,
    enqueueProspectTask,
};
