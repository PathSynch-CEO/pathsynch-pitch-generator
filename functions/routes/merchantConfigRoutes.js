/**
 * Merchant Config Routes
 *
 * API endpoints for merchantConfig CRUD and top-pages aggregation.
 * Used by the Visitor Intel URL Mapping onboarding flow.
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes, badRequest, notFound } = require('../middleware/errorHandler');
const { classifyUrls } = require('../utils/urlHeuristics');
const { writeMerchantConfig } = require('../utils/generateMerchantConfig');

const router = createRouter();
const db = admin.firestore();

// Default merchantConfig document shape
const DEFAULT_CONFIG = {
    planTier: 'starter',
    learningModeActive: true,
    learningModeStartDate: null,
    trafficProfile: 'b2b',
    companyIdEnabled: true,
    urlMappings: [],
    thresholds: {
        warming: 75,
        hot: 150,
        outreachNow: 200
    },
    duplicateSuppressionHours: 4,
    modules: {}
};

/**
 * GET /merchant-config
 * Get or initialize merchantConfig for authenticated user
 */
router.get('/merchant-config', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const docRef = db.collection('merchantConfig').doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            // Return defaults (don't auto-create until they save)
            return res.status(200).json({
                success: true,
                data: {
                    merchantId: userId,
                    ...DEFAULT_CONFIG,
                    exists: false
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                merchantId: userId,
                ...doc.data(),
                exists: true
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /merchant-config');
    }
});

/**
 * POST /merchant-config
 * Create or update merchantConfig for authenticated user
 */
router.post('/merchant-config', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const {
            urlMappings,
            trafficProfile,
            thresholds,
            duplicateSuppressionHours,
            companyIdEnabled,
            modules
        } = req.body;

        const docRef = db.collection('merchantConfig').doc(userId);
        const doc = await docRef.get();

        // Get user info for snippetKey and plan tier
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const planTier = (userData?.subscription?.plan || userData?.subscription?.tier || userData?.plan || userData?.tier || 'free').toLowerCase();

        const now = FieldValue.serverTimestamp();

        if (!doc.exists) {
            // Create new merchantConfig
            const newConfig = {
                merchantId: userId,
                snippetKey: userData.snippetKey || null,
                planTier,
                learningModeActive: true,
                learningModeStartDate: now,
                trafficProfile: trafficProfile || 'b2b',
                companyIdEnabled: companyIdEnabled !== undefined ? companyIdEnabled : true,
                urlMappings: urlMappings || [],
                thresholds: thresholds || DEFAULT_CONFIG.thresholds,
                duplicateSuppressionHours: duplicateSuppressionHours || 4,
                modules: modules || {},
                createdAt: now,
                updatedAt: now
            };

            await docRef.set(newConfig);

            return res.status(201).json({
                success: true,
                data: { merchantId: userId, ...newConfig, exists: true },
                message: 'Merchant config created'
            });
        }

        // Update existing — only merge provided fields
        const updates = { updatedAt: now };
        if (urlMappings !== undefined) updates.urlMappings = urlMappings;
        if (trafficProfile !== undefined) updates.trafficProfile = trafficProfile;
        if (thresholds !== undefined) updates.thresholds = thresholds;
        if (duplicateSuppressionHours !== undefined) updates.duplicateSuppressionHours = duplicateSuppressionHours;
        if (companyIdEnabled !== undefined) updates.companyIdEnabled = companyIdEnabled;
        if (modules !== undefined) updates.modules = modules;

        // Always update planTier on save to keep it current
        updates.planTier = planTier;

        await docRef.set(updates, { merge: true });

        const updated = await docRef.get();
        return res.status(200).json({
            success: true,
            data: { merchantId: userId, ...updated.data(), exists: true },
            message: 'Merchant config updated'
        });

    } catch (error) {
        return handleError(error, res, 'POST /merchant-config');
    }
});

/**
 * GET /merchant-config/top-pages
 * Aggregate top 10 pages by visit count from websiteVisitors collection.
 * Returns pages with heuristic classifications.
 */
router.get('/merchant-config/top-pages', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        // Query all visitors for this user
        const snapshot = await db.collection('websiteVisitors')
            .where('userId', '==', userId)
            .get();

        // Aggregate page visit counts
        const pageCounts = new Map();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const pages = data.uniquePages || [];
            for (const page of pages) {
                pageCounts.set(page, (pageCounts.get(page) || 0) + 1);
            }
        });

        // Sort by visit count, take top 10
        const topPages = Array.from(pageCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([url, visits]) => ({ url, visits }));

        // Load existing merchant mappings for override
        const configDoc = await db.collection('merchantConfig').doc(userId).get();
        const existingMappings = configDoc.exists ? (configDoc.data().urlMappings || []) : [];

        // Classify URLs (merchant overrides + heuristic fallback)
        const classified = classifyUrls(
            topPages.map(p => p.url),
            existingMappings
        );

        // Merge visit counts with classifications
        const result = topPages.map((page, i) => ({
            url: page.url,
            visits: page.visits,
            tag: classified[i].tag,
            source: classified[i].source
        }));

        return res.status(200).json({
            success: true,
            data: result,
            totalVisitors: snapshot.size
        });

    } catch (error) {
        return handleError(error, res, 'GET /merchant-config/top-pages');
    }
});

/**
 * GET /merchant-config/calibration-report
 * Read the latest calibration report for the authenticated user.
 */
router.get('/merchant-config/calibration-report', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const reportRef = db.collection('merchantConfig').doc(userId)
            .collection('calibrationReport').doc('latest');
        const doc = await reportRef.get();

        if (!doc.exists) {
            return res.status(200).json({
                success: true,
                data: null,
                message: 'No calibration report yet — learning mode is still active'
            });
        }

        return res.status(200).json({
            success: true,
            data: doc.data()
        });

    } catch (error) {
        return handleError(error, res, 'GET /merchant-config/calibration-report');
    }
});

/**
 * POST /merchant-config/regenerate-snippet
 * Regenerate the hosted config JSON for the authenticated merchant.
 * Called when plan changes, snippet is regenerated, or urlMappings are updated.
 */
router.post('/merchant-config/regenerate-snippet', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const configJson = await writeMerchantConfig(userId);

        return res.status(200).json({
            success: true,
            data: {
                merchantId: userId,
                generatedAt: configJson.generatedAt,
                modules: configJson.modules
            },
            message: 'Config regenerated'
        });

    } catch (error) {
        return handleError(error, res, 'POST /merchant-config/regenerate-snippet');
    }
});

module.exports = router;
