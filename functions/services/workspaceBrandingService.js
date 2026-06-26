'use strict';

/**
 * workspaceBrandingService.js — Append-only branding version history for workspaces.
 *
 * Each workspace branding edit creates an IMMUTABLE version doc in
 * `workspaceBrandingVersions/{versionId}`. The latest version is always
 * discoverable via a descending query on `version` field.
 *
 * All writes go through Admin SDK (firestore.rules: write: false).
 *
 * Consumers:
 *   - Workspace branding update route (creates version + audit)
 *   - pitchGenerator.js (reads latest version to stamp brandingVersionId)
 *   - brandResolver.js (reads owner branding, NOT this — branding source is still agencyBrandOverrides)
 */

const admin = require('firebase-admin');

const COLLECTION = 'workspaceBrandingVersions';

/**
 * Create a new immutable branding version snapshot.
 *
 * @param {string} workspaceId
 * @param {object} brandSnapshot - Resolved brand fields to freeze
 * @param {string} changedByUid - UID of the user making the change
 * @param {string|null} [changeNote] - Optional note (e.g. "Updated logo")
 * @returns {Promise<{id: string, version: number}>}
 */
async function createBrandingVersion(workspaceId, brandSnapshot, changedByUid, changeNote = null) {
    const db = admin.firestore();

    // Determine next version number
    const latestSnap = await db.collection(COLLECTION)
        .where('workspaceId', '==', workspaceId)
        .orderBy('version', 'desc')
        .limit(1)
        .get();

    const nextVersion = latestSnap.empty ? 1 : (latestSnap.docs[0].data().version + 1);

    const versionDoc = {
        workspaceId,
        version: nextVersion,
        brand: brandSnapshot,
        changedByUid,
        changeNote: changeNote || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await db.collection(COLLECTION).add(versionDoc);

    return { id: ref.id, version: nextVersion };
}

/**
 * Get the latest branding version for a workspace.
 *
 * @param {string} workspaceId
 * @returns {Promise<object|null>} Version doc data + id, or null if no versions
 */
async function getLatestBrandingVersion(workspaceId) {
    const db = admin.firestore();
    const snap = await db.collection(COLLECTION)
        .where('workspaceId', '==', workspaceId)
        .orderBy('version', 'desc')
        .limit(1)
        .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
}

/**
 * Get a specific branding version by document ID.
 *
 * @param {string} versionId
 * @returns {Promise<object|null>}
 */
async function getBrandingVersion(versionId) {
    const db = admin.firestore();
    const doc = await db.collection(COLLECTION).doc(versionId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

/**
 * List branding versions for a workspace (newest first).
 *
 * @param {string} workspaceId
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
async function listBrandingVersions(workspaceId, limit = 20) {
    const db = admin.firestore();
    const snap = await db.collection(COLLECTION)
        .where('workspaceId', '==', workspaceId)
        .orderBy('version', 'desc')
        .limit(limit)
        .get();

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
    createBrandingVersion,
    getLatestBrandingVersion,
    getBrandingVersion,
    listBrandingVersions,
};
