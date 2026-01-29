/**
 * Pitch Outcome Routes
 *
 * Handles pitch outcome tracking for Scale Tier
 * Status values: no_outcome | meeting_booked | won | lost
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// Valid outcome statuses
const VALID_STATUSES = ['no_outcome', 'meeting_booked', 'won', 'lost'];

/**
 * PUT /pitches/:pitchId/outcome
 * Update pitch outcome status
 */
router.put('/pitches/:pitchId/outcome', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;
        const { status, notes } = req.body;

        // Validate status
        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
            });
        }

        // Verify pitch exists and user owns it
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();
        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pitch not found' });
        }

        const pitchData = pitchDoc.data();
        if (pitchData.userId !== req.userId) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this pitch' });
        }

        const outcomeRef = db.collection('pitchOutcomes').doc(pitchId);
        const outcomeDoc = await outcomeRef.get();

        const now = admin.firestore.FieldValue.serverTimestamp();
        const historyEntry = {
            status,
            changedAt: new Date().toISOString(),
            changedBy: req.userId
        };

        if (outcomeDoc.exists) {
            // Update existing outcome
            const existingData = outcomeDoc.data();
            const statusHistory = existingData.statusHistory || [];
            statusHistory.push(historyEntry);

            await outcomeRef.update({
                status,
                statusHistory,
                notes: notes !== undefined ? notes : existingData.notes,
                updatedAt: now
            });
        } else {
            // Create new outcome document
            await outcomeRef.set({
                pitchId,
                status,
                statusHistory: [historyEntry],
                notes: notes || null,
                createdAt: now,
                updatedAt: now
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Outcome updated',
            data: { pitchId, status }
        });

    } catch (error) {
        return handleError(error, res, 'PUT /pitches/:pitchId/outcome');
    }
});

/**
 * GET /pitches/:pitchId/outcome
 * Get pitch outcome status
 */
router.get('/pitches/:pitchId/outcome', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;

        // Verify pitch exists and user owns it
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();
        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pitch not found' });
        }

        const pitchData = pitchDoc.data();
        if (pitchData.userId !== req.userId) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this pitch' });
        }

        const outcomeDoc = await db.collection('pitchOutcomes').doc(pitchId).get();

        if (!outcomeDoc.exists) {
            return res.status(200).json({
                success: true,
                data: {
                    pitchId,
                    status: 'no_outcome',
                    statusHistory: [],
                    notes: null
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: outcomeDoc.data()
        });

    } catch (error) {
        return handleError(error, res, 'GET /pitches/:pitchId/outcome');
    }
});

module.exports = router;
