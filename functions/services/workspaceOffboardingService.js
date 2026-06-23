'use strict';

/**
 * workspaceOffboardingService.js — Two-stage workspace member offboarding.
 *
 * Stage 1: initiateOffboarding()
 *   - Atomic transaction: mark member OFFBOARDING, persist job doc, audit-start
 *   - Selects successor (explicit or defaults to workspace owner)
 *   - Revokes access immediately (status != 'active' → resolver blocks)
 *
 * Stage 2: processOffboardingBatch()
 *   - Bounded batch: reassign assigneeUid on pitches/reports
 *   - NEVER touches createdByUid or createdByDisplayName (immutable attribution)
 *   - Sets formerMemberAt timestamp on reassigned documents
 *
 * Stage 3: completeOffboarding()
 *   - Mark REMOVED + removedAt, remove from memberIds, decrement memberCount
 *   - Sync teams mirror, audit-complete
 *
 * The offboarding job document at offboardingJobs/{jobId} tracks state:
 *   status: 'processing' | 'completed' | 'failed'
 *   pitchesReassigned, reportsReassigned, errors[]
 */

const admin = require('firebase-admin');
const { getMembership, getWorkspaceById } = require('./workspaceService');
const { logAction } = require('./workspaceAuditService');

const OFFBOARDING_BATCH_SIZE = 100;

/**
 * Stage 1: Initiate offboarding for a workspace member.
 *
 * @param {string} workspaceId
 * @param {string} targetUid   - UID of the member being offboarded
 * @param {string} actorUid    - UID of the admin/manager performing the action
 * @param {object} [options]
 * @param {string} [options.successorUid] - UID to reassign assets to (defaults to workspace owner)
 * @returns {Promise<{jobId: string}>}
 * @throws {Error} if target is workspace owner, not active, or actor lacks permission
 */
async function initiateOffboarding(workspaceId, targetUid, actorUid, options = {}) {
    const db = admin.firestore();

    // Validate workspace exists
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    // Cannot offboard the workspace owner
    if (workspace.ownerId === targetUid) {
        throw new Error('Cannot offboard the workspace owner');
    }

    // Validate target membership
    const targetMembership = await getMembership(workspaceId, targetUid);
    if (!targetMembership || targetMembership.status !== 'active') {
        throw new Error('Target member is not active in this workspace');
    }

    // Resolve successor
    const successorUid = options.successorUid || workspace.ownerId;
    if (successorUid === targetUid) {
        throw new Error('Successor cannot be the member being offboarded');
    }

    // Verify successor is active
    const successorMembership = await getMembership(workspaceId, successorUid);
    if (!successorMembership || successorMembership.status !== 'active') {
        throw new Error('Successor is not an active workspace member');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const memberDocId = `${workspaceId}_${targetUid}`;

    // Atomic: mark OFFBOARDING + create job doc
    const jobRef = db.collection('offboardingJobs').doc();
    const memberRef = db.collection('workspaceMembers').doc(memberDocId);

    await db.runTransaction(async (tx) => {
        const memberSnap = await tx.get(memberRef);
        if (!memberSnap.exists || memberSnap.data().status !== 'active') {
            throw new Error('Member is no longer active (concurrent modification)');
        }

        tx.update(memberRef, {
            status: 'offboarding',
            updatedAt: now,
        });

        tx.set(jobRef, {
            workspaceId,
            targetUid,
            actorUid,
            successorUid,
            status: 'processing',
            pitchesReassigned: 0,
            reportsReassigned: 0,
            errors: [],
            createdAt: now,
            updatedAt: now,
        });
    });

    // Audit (fire-and-forget)
    logAction(workspaceId, actorUid, 'MEMBER_OFFBOARDED', {
        targetUid,
        details: {
            stage: 'initiated',
            jobId: jobRef.id,
            successorUid,
        },
    });

    return { jobId: jobRef.id };
}

/**
 * Stage 2: Process offboarding batch — reassign assets.
 *
 * Reassigns assigneeUid on pitches and market reports created by the target member.
 * NEVER modifies createdByUid or createdByDisplayName (immutable attribution).
 * Sets formerMemberAt timestamp on each reassigned document.
 *
 * @param {string} jobId
 * @returns {Promise<{pitchesReassigned: number, reportsReassigned: number}>}
 */
async function processOffboardingBatch(jobId) {
    const db = admin.firestore();

    const jobDoc = await db.collection('offboardingJobs').doc(jobId).get();
    if (!jobDoc.exists) throw new Error('Offboarding job not found');

    const job = jobDoc.data();
    if (job.status !== 'processing') throw new Error(`Job status is ${job.status}, expected processing`);

    const { workspaceId, targetUid, successorUid } = job;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const errors = [];
    let pitchesReassigned = 0;
    let reportsReassigned = 0;

    // Reassign pitches
    try {
        const pitchSnap = await db.collection('pitches')
            .where('workspaceId', '==', workspaceId)
            .where('createdByUid', '==', targetUid)
            .limit(OFFBOARDING_BATCH_SIZE)
            .get();

        if (!pitchSnap.empty) {
            const batch = db.batch();
            for (const doc of pitchSnap.docs) {
                batch.update(doc.ref, {
                    assigneeUid: successorUid,
                    formerMemberAt: now,
                    updatedAt: now,
                    // createdByUid and createdByDisplayName are NEVER changed
                });
            }
            await batch.commit();
            pitchesReassigned = pitchSnap.size;
        }
    } catch (err) {
        console.error('[Offboarding] Pitch reassignment failed:', err.message);
        errors.push(`pitch_reassign: ${err.message}`);
    }

    // Reassign market reports
    try {
        const reportSnap = await db.collection('marketReports')
            .where('workspaceId', '==', workspaceId)
            .where('createdByUid', '==', targetUid)
            .limit(OFFBOARDING_BATCH_SIZE)
            .get();

        if (!reportSnap.empty) {
            const batch = db.batch();
            for (const doc of reportSnap.docs) {
                batch.update(doc.ref, {
                    assigneeUid: successorUid,
                    formerMemberAt: now,
                    updatedAt: now,
                });
            }
            await batch.commit();
            reportsReassigned = reportSnap.size;
        }
    } catch (err) {
        console.error('[Offboarding] Report reassignment failed:', err.message);
        errors.push(`report_reassign: ${err.message}`);
    }

    // Reassign opportunity briefs
    try {
        const briefSnap = await db.collection('opportunityBriefs')
            .where('workspaceId', '==', workspaceId)
            .where('createdByUid', '==', targetUid)
            .limit(OFFBOARDING_BATCH_SIZE)
            .get();

        if (!briefSnap.empty) {
            const batch = db.batch();
            for (const doc of briefSnap.docs) {
                batch.update(doc.ref, {
                    assigneeUid: successorUid,
                    formerMemberAt: now,
                    updatedAt: now,
                });
            }
            await batch.commit();
        }
    } catch (err) {
        console.error('[Offboarding] Brief reassignment failed:', err.message);
        errors.push(`brief_reassign: ${err.message}`);
    }

    // Update job document
    await db.collection('offboardingJobs').doc(jobId).update({
        pitchesReassigned,
        reportsReassigned,
        errors,
        updatedAt: now,
    });

    return { pitchesReassigned, reportsReassigned };
}

/**
 * Stage 3: Complete offboarding — mark REMOVED, sync mirrors, audit-complete.
 *
 * @param {string} jobId
 * @returns {Promise<void>}
 */
async function completeOffboarding(jobId) {
    const db = admin.firestore();

    const jobDoc = await db.collection('offboardingJobs').doc(jobId).get();
    if (!jobDoc.exists) throw new Error('Offboarding job not found');

    const job = jobDoc.data();
    const { workspaceId, targetUid, actorUid, successorUid } = job;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const memberDocId = `${workspaceId}_${targetUid}`;

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const batch = db.batch();

    // Mark member as REMOVED
    batch.update(db.collection('workspaceMembers').doc(memberDocId), {
        status: 'removed',
        removedAt: now,
        updatedAt: now,
    });

    // Remove from workspace memberIds + decrement count
    batch.update(db.collection('workspaces').doc(workspaceId), {
        memberIds: admin.firestore.FieldValue.arrayRemove(targetUid),
        memberCount: admin.firestore.FieldValue.increment(-1),
        updatedAt: now,
    });

    // Sync teams mirror
    const teamsRef = db.collection('teams').doc(workspace.ownerId);
    const teamsDoc = await teamsRef.get();
    if (teamsDoc.exists) {
        batch.update(teamsRef, {
            memberUids: admin.firestore.FieldValue.arrayRemove(targetUid),
            updatedAt: now,
        });
    }

    // Mark job completed
    batch.update(db.collection('offboardingJobs').doc(jobId), {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
    });

    await batch.commit();

    // Audit (fire-and-forget)
    logAction(workspaceId, actorUid, 'MEMBER_OFFBOARDED', {
        targetUid,
        details: {
            stage: 'completed',
            jobId,
            successorUid,
            pitchesReassigned: job.pitchesReassigned || 0,
            reportsReassigned: job.reportsReassigned || 0,
        },
    });
}

module.exports = {
    initiateOffboarding,
    processOffboardingBatch,
    completeOffboarding,
};
