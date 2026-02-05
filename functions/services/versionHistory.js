/**
 * Version History Service
 * Core logic for pitch version management: create, list, get, restore, cleanup.
 *
 * Uses Firestore transactions for atomic version numbering.
 * Versions are stored in the `pitchVersions` collection.
 */

const admin = require('firebase-admin');
const { calculateDiff, generateDescription, detectChangeType } = require('./diffCalculator');

const db = admin.firestore();

// Content-only fields that are safe to restore (never restore system fields)
const RESTORABLE_FIELDS = [
    'businessName', 'contactName', 'industry', 'subIndustry',
    'htmlContent', 'statedProblem', 'shared', 'level', 'pitchLevel',
    'hideBranding', 'customPrimaryColor', 'customAccentColor',
    'sellerContext'
];

// Version limits by plan tier
const VERSION_LIMITS = {
    free: 3,
    starter: 3,
    growth: 30,
    scale: 100,
    enterprise: 100
};

/**
 * Create a new version snapshot before a pitch is updated.
 * Uses a Firestore transaction for atomic version numbering.
 *
 * @param {string} pitchId - The pitch document ID
 * @param {Object} currentPitchData - Current pitch data (before update)
 * @param {string} userId - ID of the user making the change
 * @param {string} userName - Display name of the user
 * @param {Object} newData - The incoming update data (for diff calculation)
 * @param {string} [changeType] - Override change type (e.g., 'restored')
 * @returns {Object} The created version document data
 */
async function createVersion(pitchId, currentPitchData, userId, userName, newData, changeType) {
    const versionRef = db.collection('pitchVersions');

    const result = await db.runTransaction(async (transaction) => {
        // Get the current highest version number for this pitch
        const existingVersions = await transaction.get(
            versionRef
                .where('pitchId', '==', pitchId)
                .orderBy('versionNumber', 'desc')
                .limit(1)
        );

        const lastVersion = existingVersions.empty ? 0 : existingVersions.docs[0].data().versionNumber;
        const newVersionNumber = lastVersion + 1;

        // Calculate diff between current state and incoming changes
        const mergedNew = { ...currentPitchData, ...newData };
        const diff = calculateDiff(currentPitchData, mergedNew);
        const detectedType = changeType || detectChangeType(diff);
        const description = generateDescription(diff, detectedType);

        // Build the version document
        const versionData = {
            pitchId,
            versionNumber: newVersionNumber,
            snapshot: sanitizeSnapshot(currentPitchData),
            changes: {
                type: detectedType,
                userId,
                userName: userName || 'Unknown',
                description,
                diff
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: userId
        };

        const newDocRef = versionRef.doc();
        transaction.set(newDocRef, versionData);

        return { id: newDocRef.id, ...versionData };
    });

    // Conditionally cleanup old versions (only if count is high)
    scheduleCleanup(pitchId, userId).catch(err => {
        console.error('Version cleanup error (non-blocking):', err.message);
    });

    return result;
}

/**
 * List versions for a pitch, ordered by version number descending.
 *
 * @param {string} pitchId - The pitch document ID
 * @param {number} [limit=50] - Max versions to return
 * @returns {Array} Version documents (without full snapshot for performance)
 */
async function listVersions(pitchId, limit = 50) {
    const snapshot = await db.collection('pitchVersions')
        .where('pitchId', '==', pitchId)
        .orderBy('versionNumber', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            pitchId: data.pitchId,
            versionNumber: data.versionNumber,
            changes: data.changes,
            createdAt: data.createdAt,
            createdBy: data.createdBy
            // Note: snapshot is omitted for list performance
        };
    });
}

/**
 * Get a single version with full snapshot.
 *
 * @param {string} versionId - The version document ID
 * @returns {Object|null} Full version document or null
 */
async function getVersion(versionId) {
    const doc = await db.collection('pitchVersions').doc(versionId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

/**
 * Restore a pitch to a previous version.
 * Creates a new version recording the restore, then updates the pitch.
 * Uses a transaction to atomically increment version and update pitch.
 *
 * @param {string} pitchId - The pitch document ID
 * @param {string} versionId - The version to restore from
 * @param {string} userId - ID of the user performing the restore
 * @param {string} userName - Display name of the user
 * @returns {Object} Result with the new version info
 */
async function restoreVersion(pitchId, versionId, userId, userName) {
    const versionDoc = await db.collection('pitchVersions').doc(versionId).get();
    if (!versionDoc.exists) {
        throw new Error('Version not found');
    }

    const versionData = versionDoc.data();
    if (versionData.pitchId !== pitchId) {
        throw new Error('Version does not belong to this pitch');
    }

    const pitchRef = db.collection('pitches').doc(pitchId);
    const pitchDoc = await pitchRef.get();
    if (!pitchDoc.exists) {
        throw new Error('Pitch not found');
    }

    const currentPitchData = pitchDoc.data();
    const restoredSnapshot = versionData.snapshot;

    // Filter to only restorable content fields
    const restoreFields = {};
    for (const field of RESTORABLE_FIELDS) {
        if (restoredSnapshot[field] !== undefined) {
            restoreFields[field] = restoredSnapshot[field];
        }
    }

    // Create a version snapshot of the current state before restoring
    await createVersion(pitchId, currentPitchData, userId, userName, restoreFields, 'restored');

    // Apply the restore
    restoreFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await pitchRef.update(restoreFields);

    return {
        success: true,
        message: `Restored to version ${versionData.versionNumber}`,
        restoredFields: Object.keys(restoreFields).filter(k => k !== 'updatedAt')
    };
}

/**
 * Cleanup old versions beyond the plan limit.
 * Only runs if version count exceeds the limit.
 *
 * @param {string} pitchId - The pitch document ID
 * @param {string} userId - The pitch owner's user ID (for plan lookup)
 */
async function scheduleCleanup(pitchId, userId) {
    // Look up user's plan to determine version limit
    let versionLimit = VERSION_LIMITS.starter;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            let planTier;
            if (typeof userData.plan === 'string') {
                planTier = userData.plan;
            } else if (userData.plan && typeof userData.plan === 'object') {
                planTier = userData.plan.tier || 'starter';
            } else {
                planTier = 'starter';
            }
            versionLimit = VERSION_LIMITS[planTier] || VERSION_LIMITS.starter;
        }
    } catch (err) {
        console.warn('Could not fetch user plan for version cleanup:', err.message);
    }

    // Count versions for this pitch
    const countResult = await db.collection('pitchVersions')
        .where('pitchId', '==', pitchId)
        .count()
        .get();

    const totalVersions = countResult.data().count;

    if (totalVersions <= versionLimit) {
        return; // No cleanup needed
    }

    // Get the oldest versions beyond the limit
    const excessCount = totalVersions - versionLimit;
    const oldVersions = await db.collection('pitchVersions')
        .where('pitchId', '==', pitchId)
        .orderBy('versionNumber', 'asc')
        .limit(excessCount)
        .get();

    // Delete in batches
    const batch = db.batch();
    oldVersions.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    console.log(`Cleaned up ${oldVersions.size} old versions for pitch ${pitchId}`);
}

// --- Helpers ---

/**
 * Remove system/sensitive fields from a snapshot before storing.
 */
function sanitizeSnapshot(pitchData) {
    const snapshot = { ...pitchData };
    // Remove fields that should not be in the snapshot
    delete snapshot.analytics;
    delete snapshot.createdAt;
    delete snapshot.updatedAt;
    return snapshot;
}

module.exports = {
    createVersion,
    listVersions,
    getVersion,
    restoreVersion,
    VERSION_LIMITS,
    RESTORABLE_FIELDS
};
