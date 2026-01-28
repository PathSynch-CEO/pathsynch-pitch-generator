/**
 * Plan-Based Feature Gating Middleware
 *
 * Middleware functions to restrict access based on subscription plan
 */

const admin = require('firebase-admin');
const { getPlanLimits, hasFeature, isWithinLimits } = require('../config/stripe');

const db = admin.firestore();

/**
 * Get user's current plan from Firestore
 */
async function getUserPlan(userId) {
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return 'starter';
        }

        const userData = userDoc.data();

        // Handle both string and object plan formats
        if (typeof userData.plan === 'string') {
            return userData.plan;
        } else if (userData.plan && typeof userData.plan === 'object') {
            return userData.plan.tier || 'starter';
        }

        return 'starter';
    } catch (error) {
        console.error('Error getting user plan:', error);
        return 'starter';
    }
}

/**
 * Get user's current usage for the month
 */
async function getUserUsage(userId) {
    try {
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        const usageDoc = await db.collection('usage').doc(usageId).get();

        if (!usageDoc.exists) {
            return {
                pitchesGenerated: 0,
                bulkUploadsThisMonth: 0,
                marketReportsThisMonth: 0
            };
        }

        return usageDoc.data();
    } catch (error) {
        console.error('Error getting user usage:', error);
        return {
            pitchesGenerated: 0,
            bulkUploadsThisMonth: 0,
            marketReportsThisMonth: 0
        };
    }
}

/**
 * Middleware to require a specific feature
 * Usage: requireFeature('pptExport')
 */
function requireFeature(featureName) {
    return async (req, res, next) => {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to access this feature'
            });
        }

        const plan = await getUserPlan(userId);

        if (!hasFeature(plan, featureName)) {
            const upgradeMessage = getUpgradeMessage(featureName);
            return res.status(403).json({
                success: false,
                error: 'Feature not available',
                message: upgradeMessage,
                currentPlan: plan,
                requiredFeature: featureName
            });
        }

        req.userPlan = plan;
        next();
    };
}

/**
 * Middleware to check usage limits
 * Usage: checkUsageLimit('pitches')
 */
function checkUsageLimit(usageType) {
    return async (req, res, next) => {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const plan = await getUserPlan(userId);
        const usage = await getUserUsage(userId);
        const limits = getPlanLimits(plan);

        let currentUsage = 0;
        let limitValue = 0;
        let limitName = '';

        switch (usageType) {
            case 'pitches':
                currentUsage = usage.pitchesGenerated || 0;
                limitValue = limits.pitchesPerMonth;
                limitName = 'pitches this month';
                break;
            case 'bulkUpload':
                // For bulk upload, we check the row count in the request
                currentUsage = req.body?.rowCount || 0;
                limitValue = limits.bulkUploadRows;
                limitName = 'rows per bulk upload';
                break;
            case 'marketReports':
                currentUsage = usage.marketReportsThisMonth || 0;
                limitValue = limits.marketReportsPerMonth;
                limitName = 'market reports this month';
                break;
        }

        // -1 means unlimited
        if (limitValue !== -1 && currentUsage >= limitValue) {
            return res.status(429).json({
                success: false,
                error: 'Usage limit reached',
                message: `You've reached your limit of ${limitValue} ${limitName}. Please upgrade your plan for more.`,
                currentPlan: plan,
                usage: {
                    current: currentUsage,
                    limit: limitValue
                }
            });
        }

        req.userPlan = plan;
        req.userUsage = usage;
        req.planLimits = limits;
        next();
    };
}

/**
 * Middleware to require minimum plan tier
 * Usage: requirePlan('growth')
 */
function requirePlan(minimumPlan) {
    const planHierarchy = ['starter', 'growth', 'scale'];

    return async (req, res, next) => {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const userPlan = await getUserPlan(userId);
        const userPlanIndex = planHierarchy.indexOf(userPlan);
        const requiredPlanIndex = planHierarchy.indexOf(minimumPlan);

        if (userPlanIndex < requiredPlanIndex) {
            return res.status(403).json({
                success: false,
                error: 'Plan upgrade required',
                message: `This feature requires the ${minimumPlan.charAt(0).toUpperCase() + minimumPlan.slice(1)} plan or higher.`,
                currentPlan: userPlan,
                requiredPlan: minimumPlan
            });
        }

        req.userPlan = userPlan;
        next();
    };
}

/**
 * Get upgrade message for a feature
 */
function getUpgradeMessage(featureName) {
    const messages = {
        pptExport: 'PowerPoint export is available on the Scale plan. Upgrade to download presentations.',
        whiteLabel: 'White-label branding is available on Growth and Scale plans.',
        bulkUpload: 'Bulk CSV upload is available on Growth and Scale plans.',
        marketReports: 'Market intelligence reports are available on Growth and Scale plans.',
        // Narrative pipeline messages
        aiNarratives: 'AI narrative generation is available on all plans. Please upgrade for more narratives.',
        emailSequence: 'Email sequence formatter is available on Growth and Scale plans.',
        linkedin: 'LinkedIn messages formatter is available on Growth and Scale plans.',
        executiveSummary: 'Executive summary formatter is available on Growth and Scale plans.',
        deck: 'Presentation deck formatter is available on the Scale plan.',
        proposal: 'Business proposal formatter is available on the Scale plan.',
        batchFormat: 'Batch formatting is available on Growth (up to 3) and Scale (unlimited) plans.'
    };

    return messages[featureName] || 'This feature requires a plan upgrade.';
}

/**
 * Middleware to check if a specific formatter is available
 * Usage: requireFormatter('email_sequence')
 */
function requireFormatter(formatterType) {
    return async (req, res, next) => {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const plan = await getUserPlan(userId);
        const limits = getPlanLimits(plan);

        // Check if formatter is in plan's allowed formatters
        const allowedFormatters = limits.formatters || ['sales_pitch', 'one_pager'];
        if (!allowedFormatters.includes(formatterType)) {
            return res.status(403).json({
                success: false,
                error: 'Formatter not available',
                message: getUpgradeMessage(formatterType),
                currentPlan: plan,
                requiredFormatter: formatterType
            });
        }

        req.userPlan = plan;
        next();
    };
}

/**
 * Check narrative usage limit
 */
function checkNarrativeLimit() {
    return async (req, res, next) => {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const plan = await getUserPlan(userId);
        const usage = await getUserUsage(userId);
        const limits = getPlanLimits(plan);

        const narrativesGenerated = usage.narrativesGenerated || 0;
        const narrativeLimit = limits.narrativesPerMonth || 5;

        // -1 means unlimited
        if (narrativeLimit !== -1 && narrativesGenerated >= narrativeLimit) {
            return res.status(429).json({
                success: false,
                error: 'Narrative limit reached',
                message: `You've reached your limit of ${narrativeLimit} narratives this month. Please upgrade your plan for more.`,
                currentPlan: plan,
                usage: {
                    current: narrativesGenerated,
                    limit: narrativeLimit
                }
            });
        }

        req.userPlan = plan;
        req.userUsage = usage;
        req.planLimits = limits;
        next();
    };
}

module.exports = {
    getUserPlan,
    getUserUsage,
    requireFeature,
    checkUsageLimit,
    requirePlan,
    getUpgradeMessage,
    requireFormatter,
    checkNarrativeLimit
};
