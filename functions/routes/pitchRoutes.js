/**
 * Pitch Routes
 *
 * Handles all pitch-related endpoints (template-based generation)
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const pitchGenerator = require('../api/pitchGenerator');
const { validateBody } = require('../middleware/validation');
const { handleError, ApiError, ErrorCodes, notFound, badRequest, unauthorized, forbidden } = require('../middleware/errorHandler');
const { L2_STYLES, L3_STYLES, getAvailableStyles } = require('../api/pitch/validators');
const { requireRole, canAccessResource, scopeQueryToWorkspace } = require('../middleware/workspaceRoleGuard');

const router = createRouter();
const db = admin.firestore();

// ============================================
// HELPER FUNCTIONS
// ============================================

async function trackPitchView(pitchId, viewerId, context = {}) {
    try {
        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        const today = new Date().toISOString().split('T')[0];

        await analyticsRef.set({
            pitchId: pitchId,
            views: admin.firestore.FieldValue.increment(1),
            [`viewsByDay.${today}`]: admin.firestore.FieldValue.increment(1),
            lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await analyticsRef.collection('events').add({
            type: 'view',
            viewerId: viewerId || 'anonymous',
            context: context,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const pitchRef = db.collection('pitches').doc(pitchId);
        await pitchRef.update({
            'analytics.views': admin.firestore.FieldValue.increment(1),
            'analytics.lastViewedAt': admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});

    } catch (error) {
        console.error('Error tracking view:', error.message);
    }
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /pitch/styles
 * Get available pitch styles with tier information
 */
router.get('/pitch/styles', async (req, res) => {
    try {
        // Get user tier if authenticated
        let userTier = 'free';
        if (req.userId && req.userId !== 'anonymous') {
            const userDoc = await db.collection('users').doc(req.userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userTier = (userData.subscription?.plan || userData.tier || 'free').toLowerCase();
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                l2: getAvailableStyles(2, userTier),
                l3: getAvailableStyles(3, userTier),
                customLibrary: {
                    minTier: 'scale',
                    description: 'Upload your own sales materials for AI-personalized pitch generation',
                    available: ['scale', 'enterprise'].includes(userTier)
                },
                userTier
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /pitch/styles');
    }
});

/**
 * POST /generate-pitch
 * Generate a new pitch from business data
 */
router.post('/generate-pitch', async (req, res) => {
    try {
        // Validation is done in index.js before routing
        const result = await pitchGenerator.generatePitch(req, res);
        return result;
    } catch (error) {
        return handleError(error, res, 'POST /generate-pitch');
    }
});

/**
 * GET /pitch/:pitchId
 * Get a pitch by ID
 *
 * Workspace mode: verifies the pitch belongs to the caller's workspace
 * and that the caller's role permits access (contributor: own only).
 */
router.get('/pitch/:pitchId', async (req, res) => {
    try {
        const { pitchId } = req.params;

        if (req.workspaceId) {
            // Workspace mode — verify pitch belongs to this workspace + role allows access
            const pitchDoc = await db.collection('pitches').doc(pitchId).get();
            if (!pitchDoc.exists) throw notFound('Pitch');
            const pitchData = pitchDoc.data();

            if (pitchData.workspaceId !== req.workspaceId) {
                throw forbidden('Pitch does not belong to your workspace');
            }
            if (!canAccessResource(req, pitchData.createdByUid)) {
                throw forbidden('Contributors can only view their own pitches');
            }
        }

        // Track view
        await trackPitchView(pitchId, req.userId, {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        return await pitchGenerator.getPitch(req, res);
    } catch (error) {
        return handleError(error, res, 'GET /pitch/:pitchId');
    }
});

/**
 * GET /pitch/share/:shareId
 * Get a shared pitch by share ID
 */
router.get('/pitch/share/:shareId', async (req, res) => {
    try {
        const { shareId } = req.params;

        // Find pitch by share ID and track view
        const pitchQuery = await db.collection('pitches')
            .where('shareId', '==', shareId)
            .limit(1)
            .get();

        if (!pitchQuery.empty) {
            await trackPitchView(pitchQuery.docs[0].id, 'anonymous', {
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                referrer: req.headers['referer']
            });
        }

        return await pitchGenerator.getSharedPitch(req, res);
    } catch (error) {
        return handleError(error, res, 'GET /pitch/share/:shareId');
    }
});

/**
 * GET /pitches
 * List all pitches with pagination
 */
router.get('/pitches', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
        const industry = req.query.industry;
        const level = req.query.level ? parseInt(req.query.level) : null;

        let query;

        if (req.workspaceId) {
            // Workspace mode: scope by workspaceId + role
            // - Manager/Admin: all workspace pitches
            // - Contributor: only own pitches (createdByUid == userId)
            // Firestore equality on workspaceId naturally excludes null-workspaceId docs
            query = scopeQueryToWorkspace(
                db.collection('pitches'), req,
                { creatorField: 'createdByUid' }
            );
        } else {
            // Solo mode: legacy userId filter
            query = db.collection('pitches').where('userId', '==', userId);
        }

        // Apply filters
        if (industry) {
            query = query.where('industry', '==', industry);
        }
        if (level) {
            query = query.where('pitchLevel', '==', level);
        }

        // Get total count for pagination
        const countSnapshot = await query.count().get();
        const total = countSnapshot.data().count;

        // Apply sorting and pagination
        query = query.orderBy(sortBy, sortOrder).offset(offset).limit(limit);
        const snapshot = await query.get();

        const pitches = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                businessName: data.businessName,
                industry: data.industry,
                pitchLevel: data.pitchLevel,
                createdAt: data.createdAt,
                shareId: data.shareId,
                shared: data.shared || false,
                analytics: data.analytics || { views: 0 },
                // Workspace attribution fields (only present for workspace pitches)
                ...(req.workspaceId ? {
                    createdByUid: data.createdByUid || null,
                    createdByDisplayName: data.createdByDisplayName || null,
                } : {}),
            };
        });

        return res.status(200).json({
            success: true,
            data: pitches,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + pitches.length < total
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /pitches');
    }
});

/**
 * GET /pitch (alias for /pitches)
 */
router.get('/pitch', async (req, res) => {
    req.path = '/pitches';
    return router.handle(req, res);
});

/**
 * PUT /pitch/:pitchId
 * Update a pitch
 *
 * Workspace mode: contributor can update own pitches only; manager/admin can
 * update any workspace pitch.
 */
router.put('/pitch/:pitchId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;

        // Verify ownership / workspace access
        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            throw notFound('Pitch');
        }

        const pitchData = pitchDoc.data();

        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                throw forbidden('Pitch does not belong to your workspace');
            }
            if (!canAccessResource(req, pitchData.createdByUid)) {
                throw forbidden('Contributors can only update their own pitches');
            }
        } else if (pitchData.userId !== req.userId && pitchData.userId !== 'anonymous') {
            throw forbidden('Not authorized to update this pitch');
        }

        // Allowed fields to update
        const allowedFields = ['businessName', 'contactName', 'shared', 'industry', 'statedProblem'];
        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw badRequest('No valid fields to update');
        }

        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await pitchRef.update(updates);

        return res.status(200).json({
            success: true,
            message: 'Pitch updated',
            data: { id: pitchId, ...updates }
        });
    } catch (error) {
        return handleError(error, res, 'PUT /pitch/:pitchId');
    }
});

/**
 * PATCH /pitches/:pitchId/status
 * Update pitch pipeline status (Draft → Sent → Viewed → Replied)
 */
const VALID_STATUSES = ['Draft', 'Sent', 'Viewed', 'Replied'];

router.patch('/pitches/:pitchId/status', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw unauthorized();
        }

        const { pitchId } = req.params;
        const { status } = req.body;

        if (!status || !VALID_STATUSES.includes(status)) {
            throw badRequest(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
        }

        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            throw notFound('Pitch');
        }

        const pitchData = pitchDoc.data();

        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                throw forbidden('Pitch does not belong to your workspace');
            }
            if (!canAccessResource(req, pitchData.createdByUid)) {
                throw forbidden('Contributors can only update their own pitches');
            }
        } else if (pitchData.userId !== req.userId) {
            throw forbidden('Not authorized to update this pitch');
        }

        await pitchRef.update({
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            data: { id: pitchId, status }
        });
    } catch (error) {
        return handleError(error, res, 'PATCH /pitches/:pitchId/status');
    }
});

/**
 * PUT /pitches/:pitchId (alias)
 */
router.put('/pitches/:pitchId', async (req, res) => {
    req.params.pitchId = req.params.pitchId;
    return router.routes.find(r => r.pattern === '/pitch/:pitchId' && r.method === 'PUT').handlers[0](req, res);
});

/**
 * DELETE /pitch/:pitchId
 * Delete a pitch
 */
router.delete('/pitch/:pitchId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw unauthorized();
        }

        const { pitchId } = req.params;

        // Verify ownership / workspace access
        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            throw notFound('Pitch');
        }

        const pitchData = pitchDoc.data();

        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                throw forbidden('Pitch does not belong to your workspace');
            }
            // Only manager/admin can delete in workspace mode
            if (!requireRole(req, 'manager')) {
                throw forbidden('Contributors cannot delete pitches');
            }
        } else if (pitchData.userId !== req.userId && pitchData.userId !== 'anonymous') {
            throw forbidden('Not authorized to delete this pitch');
        }

        // Delete pitch document
        await pitchRef.delete();

        // Also delete associated analytics
        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        await analyticsRef.delete().catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Pitch deleted',
            data: { id: pitchId }
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /pitch/:pitchId');
    }
});

/**
 * DELETE /pitches/:pitchId (alias)
 */
router.delete('/pitches/:pitchId', async (req, res) => {
    req.params.pitchId = req.params.pitchId;
    return router.routes.find(r => r.pattern === '/pitch/:pitchId' && r.method === 'DELETE').handlers[0](req, res);
});

module.exports = router;
