/**
 * Feedback Service
 *
 * Handles user feedback collection, storage, and aggregation
 * with model/variant tracking for A/B test analysis.
 */

const admin = require('firebase-admin');
const { isFeatureEnabled } = require('../config/gemini');
const abTestingService = require('./abTestingService');

const db = admin.firestore();

/**
 * Feedback type enum
 */
const FeedbackType = {
    NARRATIVE: 'narrative',
    FORMATTED_ASSET: 'formatted_asset',
    GENERAL: 'general'
};

/**
 * Feedback category enum
 */
const FeedbackCategory = {
    QUALITY: 'quality',
    RELEVANCE: 'relevance',
    ACCURACY: 'accuracy',
    TONE: 'tone',
    LENGTH: 'length',
    FORMATTING: 'formatting',
    OTHER: 'other'
};

/**
 * Issue type enum
 */
const IssueType = {
    FACTUALLY_INCORRECT: 'factually_incorrect',
    OFF_TOPIC: 'off_topic',
    TOO_GENERIC: 'too_generic',
    TOO_LONG: 'too_long',
    TOO_SHORT: 'too_short',
    POOR_GRAMMAR: 'poor_grammar',
    WRONG_TONE: 'wrong_tone',
    MISSING_INFO: 'missing_info',
    OTHER: 'other'
};

/**
 * Submit feedback for a pitch/narrative
 * @param {Object} feedbackData - Feedback data
 * @returns {Promise<Object>} Created feedback document
 */
async function submitFeedback(feedbackData) {
    // Check if feedback is enabled
    if (!isFeatureEnabled('enableFeedback')) {
        return { feedbackId: null, message: 'Feedback collection is disabled' };
    }

    const {
        userId,
        pitchId,
        narrativeId,
        assetType,
        rating, // 1-5 stars
        feedbackType = FeedbackType.NARRATIVE,
        category,
        comment,
        issues = [],
        modelUsed,
        abTestVariant
    } = feedbackData;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
    }

    const feedbackId = `fb_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;

    const feedbackDoc = {
        feedbackId,
        userId,
        pitchId: pitchId || null,
        narrativeId: narrativeId || null,
        assetType: assetType || null,
        rating,
        feedbackType,
        category: category || FeedbackCategory.QUALITY,
        comment: comment || '',
        issues: issues.filter(i => Object.values(IssueType).includes(i)),
        modelUsed: modelUsed || 'unknown',
        abTestVariant: abTestVariant || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('feedback').doc(feedbackId).set(feedbackDoc);

    // Update aggregates
    await updateFeedbackAggregates(feedbackDoc);

    // Record event for A/B test if applicable
    if (abTestVariant && abTestVariant.testId) {
        await abTestingService.recordEvent(
            abTestVariant.testId,
            abTestVariant.variantId,
            userId,
            abTestingService.EventType.FEEDBACK,
            { rating }
        );
    }

    return { feedbackId, ...feedbackDoc };
}

/**
 * Get feedback by ID
 */
async function getFeedback(feedbackId) {
    const doc = await db.collection('feedback').doc(feedbackId).get();
    if (!doc.exists) {
        return null;
    }
    return { feedbackId: doc.id, ...doc.data() };
}

/**
 * Get user's feedback history
 */
async function getUserFeedback(userId, options = {}) {
    const { limit = 20, offset = 0, feedbackType } = options;

    let query = db.collection('feedback')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

    if (feedbackType) {
        query = query.where('feedbackType', '==', feedbackType);
    }

    query = query.limit(limit + 1);

    if (offset > 0) {
        const offsetDocs = await db.collection('feedback')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(offset)
            .get();

        if (!offsetDocs.empty) {
            const lastDoc = offsetDocs.docs[offsetDocs.docs.length - 1];
            query = query.startAfter(lastDoc);
        }
    }

    const snapshot = await query.get();
    const feedback = [];
    let hasMore = false;

    snapshot.docs.forEach((doc, index) => {
        if (index < limit) {
            feedback.push({ feedbackId: doc.id, ...doc.data() });
        } else {
            hasMore = true;
        }
    });

    return { feedback, hasMore };
}

/**
 * Get feedback for a specific pitch/narrative
 */
async function getPitchFeedback(pitchId) {
    const snapshot = await db.collection('feedback')
        .where('pitchId', '==', pitchId)
        .orderBy('createdAt', 'desc')
        .get();

    return snapshot.docs.map(doc => ({ feedbackId: doc.id, ...doc.data() }));
}

/**
 * Get feedback for a specific narrative
 */
async function getNarrativeFeedback(narrativeId) {
    const snapshot = await db.collection('feedback')
        .where('narrativeId', '==', narrativeId)
        .orderBy('createdAt', 'desc')
        .get();

    return snapshot.docs.map(doc => ({ feedbackId: doc.id, ...doc.data() }));
}

/**
 * Update feedback aggregates
 */
async function updateFeedbackAggregates(feedback) {
    const period = getPeriod();
    const aggregateId = `agg_${period}`;

    const updates = {
        period,
        totalFeedback: admin.firestore.FieldValue.increment(1),
        totalRating: admin.firestore.FieldValue.increment(feedback.rating),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update by model
    if (feedback.modelUsed) {
        updates[`byModel.${sanitizeKey(feedback.modelUsed)}.count`] = admin.firestore.FieldValue.increment(1);
        updates[`byModel.${sanitizeKey(feedback.modelUsed)}.totalRating`] = admin.firestore.FieldValue.increment(feedback.rating);
    }

    // Update by feedback type
    updates[`byType.${feedback.feedbackType}.count`] = admin.firestore.FieldValue.increment(1);
    updates[`byType.${feedback.feedbackType}.totalRating`] = admin.firestore.FieldValue.increment(feedback.rating);

    // Update by category
    if (feedback.category) {
        updates[`byCategory.${feedback.category}.count`] = admin.firestore.FieldValue.increment(1);
        updates[`byCategory.${feedback.category}.totalRating`] = admin.firestore.FieldValue.increment(feedback.rating);
    }

    // Update rating distribution
    updates[`ratingDistribution.${feedback.rating}`] = admin.firestore.FieldValue.increment(1);

    // Update issue counts
    for (const issue of feedback.issues) {
        updates[`issueCount.${issue}`] = admin.firestore.FieldValue.increment(1);
    }

    await db.collection('feedbackAggregates').doc(aggregateId).set(updates, { merge: true });
}

/**
 * Get feedback aggregates for a period
 */
async function getAggregates(period = null) {
    if (!period) {
        period = getPeriod();
    }

    const aggregateId = `agg_${period}`;
    const doc = await db.collection('feedbackAggregates').doc(aggregateId).get();

    if (!doc.exists) {
        return {
            period,
            totalFeedback: 0,
            averageRating: 0,
            byModel: {},
            byType: {},
            byCategory: {},
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            issueCount: {}
        };
    }

    const data = doc.data();
    const averageRating = data.totalFeedback > 0
        ? (data.totalRating / data.totalFeedback).toFixed(2)
        : 0;

    // Calculate averages for sub-categories
    const byModel = {};
    for (const [model, stats] of Object.entries(data.byModel || {})) {
        byModel[model] = {
            count: stats.count,
            averageRating: stats.count > 0 ? (stats.totalRating / stats.count).toFixed(2) : 0
        };
    }

    const byType = {};
    for (const [type, stats] of Object.entries(data.byType || {})) {
        byType[type] = {
            count: stats.count,
            averageRating: stats.count > 0 ? (stats.totalRating / stats.count).toFixed(2) : 0
        };
    }

    const byCategory = {};
    for (const [category, stats] of Object.entries(data.byCategory || {})) {
        byCategory[category] = {
            count: stats.count,
            averageRating: stats.count > 0 ? (stats.totalRating / stats.count).toFixed(2) : 0
        };
    }

    return {
        period,
        totalFeedback: data.totalFeedback || 0,
        averageRating,
        byModel,
        byType,
        byCategory,
        ratingDistribution: data.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        issueCount: data.issueCount || {}
    };
}

/**
 * Compare feedback between two models
 */
async function compareModels(modelA, modelB, period = null) {
    const aggregates = await getAggregates(period);

    const statsA = aggregates.byModel[sanitizeKey(modelA)] || { count: 0, averageRating: 0 };
    const statsB = aggregates.byModel[sanitizeKey(modelB)] || { count: 0, averageRating: 0 };

    const ratingDiff = parseFloat(statsA.averageRating) - parseFloat(statsB.averageRating);

    return {
        period: aggregates.period,
        modelA: {
            model: modelA,
            ...statsA
        },
        modelB: {
            model: modelB,
            ...statsB
        },
        comparison: {
            ratingDifference: ratingDiff.toFixed(2),
            winner: ratingDiff > 0.1 ? modelA : ratingDiff < -0.1 ? modelB : 'tie',
            sampleSizeAdequate: statsA.count >= 30 && statsB.count >= 30
        }
    };
}

/**
 * Get trending issues
 */
async function getTrendingIssues(limit = 10) {
    const aggregates = await getAggregates();
    const issueCount = aggregates.issueCount || {};

    const sorted = Object.entries(issueCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

    return sorted.map(([issue, count]) => ({
        issue,
        count,
        percentage: aggregates.totalFeedback > 0
            ? (count / aggregates.totalFeedback * 100).toFixed(1)
            : 0
    }));
}

/**
 * Check if feedback score is declining (for rollback trigger)
 */
async function checkFeedbackHealth() {
    const currentPeriod = getPeriod();
    const previousPeriod = getPreviousPeriod();

    const [currentAgg, previousAgg] = await Promise.all([
        getAggregates(currentPeriod),
        getAggregates(previousPeriod)
    ]);

    const currentRating = parseFloat(currentAgg.averageRating);
    const previousRating = parseFloat(previousAgg.averageRating);

    const decline = previousRating > 0
        ? ((previousRating - currentRating) / previousRating * 100)
        : 0;

    return {
        currentPeriod,
        previousPeriod,
        currentRating,
        previousRating,
        declinePercent: decline.toFixed(2),
        isHealthy: decline < 20, // Less than 20% decline
        sampleSize: {
            current: currentAgg.totalFeedback,
            previous: previousAgg.totalFeedback
        }
    };
}

/**
 * Helper: Get current period string (YYYY-MM)
 */
function getPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Helper: Get previous period string
 */
function getPreviousPeriod() {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Helper: Sanitize key for Firestore field names
 */
function sanitizeKey(key) {
    return String(key).replace(/[.$/\[\]#]/g, '_');
}

module.exports = {
    FeedbackType,
    FeedbackCategory,
    IssueType,
    submitFeedback,
    getFeedback,
    getUserFeedback,
    getPitchFeedback,
    getNarrativeFeedback,
    getAggregates,
    compareModels,
    getTrendingIssues,
    checkFeedbackHealth
};
