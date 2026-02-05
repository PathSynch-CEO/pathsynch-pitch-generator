/**
 * Version Routes - Handler Functions
 *
 * Plain handler functions (NOT Express Router) that match the codebase's
 * if/else chain pattern in index.js.
 *
 * All endpoints verify pitch ownership before proceeding.
 */

const admin = require('firebase-admin');
const versionHistory = require('../services/versionHistory');

const db = admin.firestore();

/**
 * Verify that the requesting user owns the pitch.
 * @returns {Object|null} pitchData if authorized, null if not
 */
async function verifyPitchOwnership(pitchId, userId, res) {
    const pitchRef = db.collection('pitches').doc(pitchId);
    const pitchDoc = await pitchRef.get();

    if (!pitchDoc.exists) {
        res.status(404).json({ success: false, message: 'Pitch not found' });
        return null;
    }

    const pitchData = pitchDoc.data();
    if (pitchData.userId !== userId && pitchData.userId !== 'anonymous') {
        res.status(403).json({ success: false, message: 'Not authorized to access this pitch' });
        return null;
    }

    return pitchData;
}

/**
 * GET /pitch/:pitchId/versions
 * List all versions for a pitch.
 */
async function listVersions(req, res) {
    try {
        const { pitchId } = req.params;
        const userId = req.userId;

        const pitchData = await verifyPitchOwnership(pitchId, userId, res);
        if (!pitchData) return;

        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const versions = await versionHistory.listVersions(pitchId, limit);

        return res.status(200).json({
            success: true,
            data: versions,
            total: versions.length
        });
    } catch (error) {
        console.error('Error listing versions:', error);
        return res.status(500).json({ success: false, message: 'Failed to list versions' });
    }
}

/**
 * GET /pitch/:pitchId/versions/:versionId
 * Get a specific version with full snapshot.
 */
async function getVersion(req, res) {
    try {
        const { pitchId, versionId } = req.params;
        const userId = req.userId;

        const pitchData = await verifyPitchOwnership(pitchId, userId, res);
        if (!pitchData) return;

        const version = await versionHistory.getVersion(versionId);
        if (!version) {
            return res.status(404).json({ success: false, message: 'Version not found' });
        }

        if (version.pitchId !== pitchId) {
            return res.status(403).json({ success: false, message: 'Version does not belong to this pitch' });
        }

        return res.status(200).json({
            success: true,
            data: version
        });
    } catch (error) {
        console.error('Error getting version:', error);
        return res.status(500).json({ success: false, message: 'Failed to get version' });
    }
}

/**
 * GET /pitch/:pitchId/versions/:versionId/preview
 * Preview a version's snapshot (returns the stored pitch state).
 */
async function previewVersion(req, res) {
    try {
        const { pitchId, versionId } = req.params;
        const userId = req.userId;

        const pitchData = await verifyPitchOwnership(pitchId, userId, res);
        if (!pitchData) return;

        const version = await versionHistory.getVersion(versionId);
        if (!version) {
            return res.status(404).json({ success: false, message: 'Version not found' });
        }

        if (version.pitchId !== pitchId) {
            return res.status(403).json({ success: false, message: 'Version does not belong to this pitch' });
        }

        return res.status(200).json({
            success: true,
            data: {
                versionNumber: version.versionNumber,
                snapshot: version.snapshot,
                changes: version.changes,
                createdAt: version.createdAt
            }
        });
    } catch (error) {
        console.error('Error previewing version:', error);
        return res.status(500).json({ success: false, message: 'Failed to preview version' });
    }
}

/**
 * POST /pitch/:pitchId/versions/:versionId/restore
 * Restore a pitch to a previous version's state.
 */
async function restoreVersion(req, res) {
    try {
        const { pitchId, versionId } = req.params;
        const userId = req.userId;

        const pitchData = await verifyPitchOwnership(pitchId, userId, res);
        if (!pitchData) return;

        // Get user name for audit trail
        let userName = 'Unknown';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userName = userData.profile?.displayName || userData.displayName || userData.profile?.email || 'Unknown';
            }
        } catch (e) {
            // Non-critical
        }

        const result = await versionHistory.restoreVersion(pitchId, versionId, userId, userName);

        return res.status(200).json({
            success: true,
            message: result.message,
            data: {
                restoredFields: result.restoredFields
            }
        });
    } catch (error) {
        console.error('Error restoring version:', error);
        const statusCode = error.message === 'Version not found' || error.message === 'Pitch not found' ? 404 : 500;
        return res.status(statusCode).json({ success: false, message: error.message || 'Failed to restore version' });
    }
}

module.exports = {
    listVersions,
    getVersion,
    previewVersion,
    restoreVersion
};
