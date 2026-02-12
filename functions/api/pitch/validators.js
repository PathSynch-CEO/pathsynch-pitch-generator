/**
 * Pitch Validators Module
 *
 * Handles pitch limit checking, user quota validation, and pitch count tracking.
 * Extracted from pitchGenerator.js as part of the modular refactoring effort.
 *
 * @module pitch/validators
 */

const admin = require('firebase-admin');

// Local Firestore reference helper
function getDb() {
    return admin.firestore();
}

/**
 * Pitch limits by tier (matches frontend CONFIG.tiers)
 * -1 means unlimited
 */
const PITCH_LIMITS = {
    free: 5,
    starter: 25,
    growth: 100,
    scale: -1,
    enterprise: -1
};

/**
 * Check if user has reached their monthly pitch limit
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} { allowed: boolean, used: number, limit: number, tier: string }
 */
async function checkPitchLimit(userId) {
    const db = getDb();

    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
        return { allowed: true, used: 0, limit: 5, tier: 'free' };
    }

    const userData = userDoc.data();
    const tier = (userData.subscription?.plan || userData.subscription?.tier || userData.tier || 'free').toLowerCase();
    const limit = PITCH_LIMITS[tier] ?? PITCH_LIMITS.free;

    // Unlimited tiers
    if (limit === -1) {
        return { allowed: true, used: 0, limit: -1, tier };
    }

    // Count pitches created this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const pitchesSnapshot = await db.collection('pitches')
        .where('userId', '==', userId)
        .where('createdAt', '>=', startOfMonth)
        .get();

    const used = pitchesSnapshot.size;

    return {
        allowed: used < limit,
        used,
        limit,
        tier
    };
}

/**
 * Increment user's pitch count after successful creation
 * @param {string} userId - The user ID
 * @returns {Promise<void>}
 */
async function incrementPitchCount(userId) {
    const db = getDb();
    await db.collection('users').doc(userId).update({
        pitchesThisMonth: admin.firestore.FieldValue.increment(1),
        totalPitches: admin.firestore.FieldValue.increment(1),
        lastPitchAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

module.exports = {
    PITCH_LIMITS,
    checkPitchLimit,
    incrementPitchCount
};
