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

// ====================================
// Style Definitions & Tier Gating
// ====================================

/**
 * L2 (One-Pager) Style Definitions
 * Each style produces different visual output from the same enriched data
 */
const L2_STYLES = {
    standard: {
        name: 'Standard',
        description: 'Clean professional one-pager',
        minTier: 'free'
    },
    visual_summary: {
        name: 'Visual Summary',
        description: 'Infographic-style with icons and color blocks',
        minTier: 'free'
    },
    battlecard: {
        name: 'Competitive Battlecard',
        description: 'Side-by-side comparison grid',
        minTier: 'growth'
    },
    roi_snapshot: {
        name: 'ROI Snapshot',
        description: 'Data-heavy with charts and metrics',
        minTier: 'growth'
    },
    executive_brief: {
        name: 'Executive Brief',
        description: 'Minimal, boardroom-ready',
        minTier: 'growth'
    }
};

/**
 * L3 (Slide Deck) Style Definitions
 */
const L3_STYLES = {
    standard: {
        name: 'Standard',
        description: 'Professional slide deck',
        minTier: 'free'
    },
    modern_minimal: {
        name: 'Modern Minimal',
        description: 'Clean with lots of whitespace',
        minTier: 'free'
    },
    data_analyst: {
        name: 'Data Analyst',
        description: 'Chart-heavy, metrics-focused',
        minTier: 'growth'
    },
    executive_boardroom: {
        name: 'Executive Boardroom',
        description: 'Conservative, authority-driven',
        minTier: 'growth'
    },
    bold_creative: {
        name: 'Bold Creative',
        description: 'Startup/pitch competition energy',
        minTier: 'growth'
    }
};

/**
 * Tier hierarchy for comparison (lowest to highest)
 */
const TIER_HIERARCHY = ['free', 'starter', 'growth', 'scale', 'enterprise'];

/**
 * Check if user's tier meets minimum required tier
 * @param {string} userTier - User's current plan tier
 * @param {string} requiredTier - Minimum required tier
 * @returns {boolean} True if user has access
 */
function tierMeetsMinimum(userTier, requiredTier) {
    const userIndex = TIER_HIERARCHY.indexOf((userTier || 'free').toLowerCase());
    const requiredIndex = TIER_HIERARCHY.indexOf((requiredTier || 'free').toLowerCase());
    return userIndex >= requiredIndex;
}

/**
 * Validate style selection for a pitch level
 * @param {number} level - Pitch level (2 or 3)
 * @param {string} style - Requested style
 * @param {string} userTier - User's current plan tier
 * @returns {string} Validated style (defaults to 'standard' if invalid)
 * @throws {Error} If style is valid but user's tier is insufficient
 */
function validateStyle(level, style, userTier = 'free') {
    // No style or standard → use standard
    if (!style || style === 'standard') {
        return 'standard';
    }

    // Get valid styles for this level
    const validStyles = level === 2 ? L2_STYLES : L3_STYLES;

    // Check if style exists
    if (!validStyles[style]) {
        throw new Error(`Invalid style "${style}" for Level ${level}. Valid styles: ${Object.keys(validStyles).join(', ')}`);
    }

    // Check tier gating
    const requiredTier = validStyles[style].minTier;
    if (!tierMeetsMinimum(userTier, requiredTier)) {
        throw new Error(`Style "${style}" requires ${requiredTier} plan or higher. Current plan: ${userTier}. Upgrade in settings.`);
    }

    return style;
}

/**
 * Validate Custom Sales Library access (Scale and Enterprise only)
 * @param {string} userTier - User's current plan tier
 * @returns {boolean} True if user has access
 * @throws {Error} If user's tier is insufficient
 */
function validateCustomLibraryAccess(userTier) {
    if (!tierMeetsMinimum(userTier, 'scale')) {
        throw new Error('Custom Sales Library requires Scale or Enterprise plan.');
    }
    return true;
}

/**
 * Get available styles for a user based on their tier
 * @param {number} level - Pitch level (2 or 3)
 * @param {string} userTier - User's current plan tier
 * @returns {Object} Styles with availability flags
 */
function getAvailableStyles(level, userTier = 'free') {
    const styles = level === 2 ? L2_STYLES : L3_STYLES;
    const result = {};

    for (const [key, style] of Object.entries(styles)) {
        result[key] = {
            ...style,
            available: tierMeetsMinimum(userTier, style.minTier),
            locked: !tierMeetsMinimum(userTier, style.minTier)
        };
    }

    return result;
}

// ====================================
// Pitch Limits
// ====================================

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

    // Use the user's stored monthly counter if available (faster, no index needed)
    // Check if the counter is from this month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (userData.pitchCountMonth === currentMonth && typeof userData.pitchesThisMonth === 'number') {
        // Counter is current, use it
        const used = userData.pitchesThisMonth;
        return {
            allowed: used < limit,
            used,
            limit,
            tier
        };
    }

    // Counter not current or not available - count pitches this month
    // Use try-catch in case index doesn't exist yet
    try {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const pitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', userId)
            .where('createdAt', '>=', startOfMonth)
            .get();

        const used = pitchesSnapshot.size;

        // Update user's monthly counter for future requests
        await db.collection('users').doc(userId).update({
            pitchesThisMonth: used,
            pitchCountMonth: currentMonth
        }).catch(() => {}); // Ignore update errors

        return {
            allowed: used < limit,
            used,
            limit,
            tier
        };
    } catch (indexError) {
        // Index not ready - fall back to total pitch count or allow the request
        console.warn('Pitch limit index not ready, using fallback:', indexError.message);

        // Count all user's pitches (simpler query, no index needed)
        const allPitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', userId)
            .get();

        // Estimate monthly usage as fraction of total (conservative)
        const totalPitches = allPitchesSnapshot.size;
        const estimatedMonthly = Math.min(totalPitches, limit - 1); // Allow at least 1

        return {
            allowed: estimatedMonthly < limit,
            used: estimatedMonthly,
            limit,
            tier
        };
    }
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
    // Style definitions
    L2_STYLES,
    L3_STYLES,
    TIER_HIERARCHY,

    // Style validation functions
    tierMeetsMinimum,
    validateStyle,
    validateCustomLibraryAccess,
    getAvailableStyles,

    // Pitch limits
    PITCH_LIMITS,
    checkPitchLimit,
    incrementPitchCount
};
