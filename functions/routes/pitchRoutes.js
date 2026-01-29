/**
 * Pitch Routes
 *
 * Handles all pitch-related endpoints (template-based generation)
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const pitchGenerator = require('../api/pitchGenerator');
const { validateBody } = require('../middleware/validation');
const { handleError } = require('../middleware/errorHandler');

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
 */
router.get('/pitch/:pitchId', async (req, res) => {
    try {
        const { pitchId } = req.params;

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

        let query = db.collection('pitches').where('userId', '==', userId);

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

        const pitches = snapshot.docs.map(doc => ({
            id: doc.id,
            businessName: doc.data().businessName,
            industry: doc.data().industry,
            pitchLevel: doc.data().pitchLevel,
            createdAt: doc.data().createdAt,
            shareId: doc.data().shareId,
            shared: doc.data().shared || false,
            analytics: doc.data().analytics || { views: 0 }
        }));

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
 */
router.put('/pitch/:pitchId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;

        // Verify ownership
        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pitch not found' });
        }

        const pitchData = pitchDoc.data();
        if (pitchData.userId !== req.userId && pitchData.userId !== 'anonymous') {
            return res.status(403).json({ success: false, message: 'Not authorized to update this pitch' });
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
            return res.status(400).json({ success: false, message: 'No valid fields to update' });
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
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;

        // Verify ownership
        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pitch not found' });
        }

        const pitchData = pitchDoc.data();
        if (pitchData.userId !== req.userId && pitchData.userId !== 'anonymous') {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this pitch' });
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
