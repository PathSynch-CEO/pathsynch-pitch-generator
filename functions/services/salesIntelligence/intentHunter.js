/**
 * Intent Hunter
 *
 * Tracks and scores buying intent signals from prospects.
 * Aggregates signals across multiple touchpoints to identify
 * hot leads ready for sales engagement.
 *
 * Data sources:
 * - Website visitor tracking
 * - Email engagement
 * - Content downloads
 * - Demo requests
 * - Chat interactions
 */

const admin = require('firebase-admin');
const { INTENT_CATEGORIES, INTENT_WEIGHTS } = require('./signalTypes');

const db = admin.firestore();

/**
 * Intent score thresholds
 */
const INTENT_THRESHOLDS = {
    HOT: 150,      // Ready for immediate outreach
    WARM: 75,      // Showing significant interest
    ENGAGED: 30,   // Some engagement, nurture
    COLD: 0,       // Minimal engagement
};

/**
 * Time decay factors (signals lose value over time)
 */
const TIME_DECAY = {
    DAYS_1: 1.0,    // Full value within 1 day
    DAYS_7: 0.8,    // 80% value within 1 week
    DAYS_14: 0.6,   // 60% value within 2 weeks
    DAYS_30: 0.4,   // 40% value within 1 month
    DAYS_60: 0.2,   // 20% value within 2 months
    OLDER: 0.1,     // 10% value for older signals
};

/**
 * Record an intent signal for a prospect
 *
 * @param {string} userId - Seller's user ID
 * @param {object} signal - Signal data
 * @returns {object} Updated intent score
 */
async function recordSignal(userId, signal) {
    const {
        prospectId,
        prospectEmail,
        prospectCompany,
        signalType,
        signalData = {},
        source = 'unknown',
        timestamp = new Date(),
    } = signal;

    if (!userId || !signalType) {
        throw new Error('userId and signalType are required');
    }

    // Validate signal type
    if (!Object.values(INTENT_CATEGORIES).includes(signalType)) {
        console.warn(`[IntentHunter] Unknown signal type: ${signalType}`);
    }

    try {
        // Create or find prospect record
        const prospectRef = await getOrCreateProspect(userId, {
            prospectId,
            email: prospectEmail,
            company: prospectCompany,
        });

        // Record the signal
        const signalRef = db.collection('intentSignals').doc();
        await signalRef.set({
            id: signalRef.id,
            userId,
            prospectId: prospectRef.id,
            signalType,
            signalData,
            source,
            weight: INTENT_WEIGHTS[signalType] || 10,
            timestamp: admin.firestore.Timestamp.fromDate(
                timestamp instanceof Date ? timestamp : new Date(timestamp)
            ),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update prospect's intent score
        const newScore = await recalculateIntentScore(userId, prospectRef.id);

        console.log(`[IntentHunter] Recorded ${signalType} signal for prospect ${prospectRef.id}, new score: ${newScore.score}`);

        return {
            signalId: signalRef.id,
            prospectId: prospectRef.id,
            intentScore: newScore,
        };

    } catch (error) {
        console.error('[IntentHunter] Failed to record signal:', error.message);
        throw error;
    }
}

/**
 * Get or create a prospect record
 */
async function getOrCreateProspect(userId, prospectData) {
    const { prospectId, email, company } = prospectData;

    // If prospectId provided, use it directly
    if (prospectId) {
        const existingRef = db.collection('intentProspects').doc(prospectId);
        const existing = await existingRef.get();
        if (existing.exists) {
            return existingRef;
        }
    }

    // Try to find by email
    if (email) {
        const emailQuery = await db.collection('intentProspects')
            .where('userId', '==', userId)
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (!emailQuery.empty) {
            return emailQuery.docs[0].ref;
        }
    }

    // Create new prospect
    const newRef = db.collection('intentProspects').doc();
    await newRef.set({
        id: newRef.id,
        userId,
        email: email?.toLowerCase() || null,
        company: company || null,
        intentScore: 0,
        intentLevel: 'cold',
        signalCount: 0,
        firstSeen: admin.firestore.FieldValue.serverTimestamp(),
        lastActivity: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return newRef;
}

/**
 * Recalculate intent score for a prospect
 * Applies time decay to older signals
 */
async function recalculateIntentScore(userId, prospectId) {
    const now = new Date();

    // Get all signals for this prospect
    const signalsSnapshot = await db.collection('intentSignals')
        .where('userId', '==', userId)
        .where('prospectId', '==', prospectId)
        .orderBy('timestamp', 'desc')
        .limit(100) // Cap at last 100 signals
        .get();

    let totalScore = 0;
    let signalCount = 0;
    const signalBreakdown = {};

    for (const doc of signalsSnapshot.docs) {
        const signal = doc.data();
        const signalDate = signal.timestamp?.toDate() || new Date();
        const daysSince = Math.floor((now - signalDate) / (1000 * 60 * 60 * 24));

        // Apply time decay
        let decayFactor = TIME_DECAY.OLDER;
        if (daysSince <= 1) decayFactor = TIME_DECAY.DAYS_1;
        else if (daysSince <= 7) decayFactor = TIME_DECAY.DAYS_7;
        else if (daysSince <= 14) decayFactor = TIME_DECAY.DAYS_14;
        else if (daysSince <= 30) decayFactor = TIME_DECAY.DAYS_30;
        else if (daysSince <= 60) decayFactor = TIME_DECAY.DAYS_60;

        const adjustedWeight = (signal.weight || 10) * decayFactor;
        totalScore += adjustedWeight;
        signalCount++;

        // Track breakdown by signal type
        if (!signalBreakdown[signal.signalType]) {
            signalBreakdown[signal.signalType] = { count: 0, score: 0 };
        }
        signalBreakdown[signal.signalType].count++;
        signalBreakdown[signal.signalType].score += adjustedWeight;
    }

    // Determine intent level
    let intentLevel = 'cold';
    if (totalScore >= INTENT_THRESHOLDS.HOT) intentLevel = 'hot';
    else if (totalScore >= INTENT_THRESHOLDS.WARM) intentLevel = 'warm';
    else if (totalScore >= INTENT_THRESHOLDS.ENGAGED) intentLevel = 'engaged';

    // Update prospect record
    const prospectRef = db.collection('intentProspects').doc(prospectId);
    await prospectRef.update({
        intentScore: Math.round(totalScore),
        intentLevel,
        signalCount,
        signalBreakdown,
        lastActivity: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
        score: Math.round(totalScore),
        level: intentLevel,
        signalCount,
        breakdown: signalBreakdown,
    };
}

/**
 * Get hot prospects for a user
 */
async function getHotProspects(userId, options = {}) {
    const { limit = 20, minScore = INTENT_THRESHOLDS.WARM } = options;

    try {
        const snapshot = await db.collection('intentProspects')
            .where('userId', '==', userId)
            .where('intentScore', '>=', minScore)
            .orderBy('intentScore', 'desc')
            .limit(limit)
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            lastActivity: doc.data().lastActivity?.toDate() || null,
        }));

    } catch (error) {
        console.error('[IntentHunter] Failed to get hot prospects:', error.message);
        return [];
    }
}

/**
 * Get intent timeline for a prospect
 */
async function getProspectTimeline(userId, prospectId, options = {}) {
    const { limit = 50 } = options;

    try {
        const signalsSnapshot = await db.collection('intentSignals')
            .where('userId', '==', userId)
            .where('prospectId', '==', prospectId)
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const signals = signalsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate() || null,
        }));

        // Get prospect details
        const prospectDoc = await db.collection('intentProspects').doc(prospectId).get();
        const prospect = prospectDoc.exists ? prospectDoc.data() : null;

        return {
            prospect,
            signals,
            timeline: signals.map(s => ({
                date: s.timestamp,
                type: s.signalType,
                description: getSignalDescription(s.signalType, s.signalData),
                score: s.weight,
            })),
        };

    } catch (error) {
        console.error('[IntentHunter] Failed to get prospect timeline:', error.message);
        return null;
    }
}

/**
 * Get human-readable signal description
 */
function getSignalDescription(signalType, signalData = {}) {
    const descriptions = {
        [INTENT_CATEGORIES.PRICING_VIEW]: 'Viewed pricing page',
        [INTENT_CATEGORIES.DEMO_PAGE]: 'Visited demo page',
        [INTENT_CATEGORIES.DEMO_REQUEST]: 'Requested a demo',
        [INTENT_CATEGORIES.CONTACT_FORM]: 'Submitted contact form',
        [INTENT_CATEGORIES.CASE_STUDY_VIEW]: `Viewed case study${signalData.title ? `: ${signalData.title}` : ''}`,
        [INTENT_CATEGORIES.CONTENT_DOWNLOAD]: `Downloaded content${signalData.title ? `: ${signalData.title}` : ''}`,
        [INTENT_CATEGORIES.EMAIL_OPEN]: 'Opened email',
        [INTENT_CATEGORIES.EMAIL_CLICK]: 'Clicked email link',
        [INTENT_CATEGORIES.RETURN_VISIT]: 'Return visit to website',
        [INTENT_CATEGORIES.PAGE_VIEW]: `Viewed page${signalData.page ? `: ${signalData.page}` : ''}`,
        [INTENT_CATEGORIES.VIDEO_WATCH]: `Watched video${signalData.title ? `: ${signalData.title}` : ''}`,
        [INTENT_CATEGORIES.CHAT_INITIATED]: 'Started chat conversation',
    };

    return descriptions[signalType] || `${signalType} activity`;
}

/**
 * Calculate intent score summary for dashboard
 */
async function getIntentSummary(userId) {
    try {
        const prospectsSnapshot = await db.collection('intentProspects')
            .where('userId', '==', userId)
            .get();

        const summary = {
            total: 0,
            hot: 0,
            warm: 0,
            engaged: 0,
            cold: 0,
            topProspects: [],
        };

        const allProspects = [];

        for (const doc of prospectsSnapshot.docs) {
            const prospect = doc.data();
            summary.total++;
            summary[prospect.intentLevel || 'cold']++;
            allProspects.push({ id: doc.id, ...prospect });
        }

        // Get top 5 prospects
        summary.topProspects = allProspects
            .sort((a, b) => (b.intentScore || 0) - (a.intentScore || 0))
            .slice(0, 5)
            .map(p => ({
                id: p.id,
                email: p.email,
                company: p.company,
                score: p.intentScore,
                level: p.intentLevel,
            }));

        return summary;

    } catch (error) {
        console.error('[IntentHunter] Failed to get intent summary:', error.message);
        return null;
    }
}

/**
 * Bulk import signals from website analytics
 */
async function bulkImportSignals(userId, signals) {
    const results = {
        success: 0,
        failed: 0,
        errors: [],
    };

    for (const signal of signals) {
        try {
            await recordSignal(userId, signal);
            results.success++;
        } catch (error) {
            results.failed++;
            results.errors.push({ signal, error: error.message });
        }
    }

    return results;
}

module.exports = {
    INTENT_THRESHOLDS,
    recordSignal,
    recalculateIntentScore,
    getHotProspects,
    getProspectTimeline,
    getIntentSummary,
    bulkImportSignals,
    getSignalDescription,
};
