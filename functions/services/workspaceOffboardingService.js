'use strict';

/**
 * workspaceOffboardingService.js — Batch-safe workspace member offboarding.
 *
 * Stage 1: initiateOffboarding()
 *   - Atomic transaction: mark member OFFBOARDING, persist job doc, audit-start
 *   - Selects successor (explicit or defaults to workspace owner)
 *   - Revokes access immediately (status != 'active' → resolver blocks)
 *
 * Stage 2: processOffboardingBatch()
 *   - Bounded batch: reassign assigneeUid on pitches/reports/briefs
 *   - NEVER touches createdByUid or createdByDisplayName (immutable attribution)
 *   - Sets formerMemberAt timestamp on reassigned documents
 *   - Filters out already-processed docs (assigneeUid === successorUid)
 *   - Persists remaining counts on job doc after each batch
 *   - Re-invocation resumes safely from where it left off
 *
 * Stage 3: completeOffboarding()
 *   - REFUSES to mark REMOVED unless every collection cursor is exhausted
 *   - Independently verifies by querying live data (not trusting job counters)
 *   - Mark REMOVED + removedAt, remove from memberIds, decrement memberCount
 *   - Sync teams mirror, audit-complete
 *   - Idempotent: re-running a completed job is a no-op
 *
 * The offboarding job document at offboardingJobs/{jobId} tracks state:
 *   status: 'processing' | 'completed' | 'failed'
 *   pitchesReassigned, reportsReassigned, briefsReassigned (cumulative)
 *   remainingPitches, remainingReports, remainingBriefs (after last batch)
 *   allExhausted: boolean
 *   errors[]
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
            briefsReassigned: 0,
            remainingPitches: 0,
            remainingReports: 0,
            remainingBriefs: 0,
            allExhausted: false,
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
 * Stage 2: Process one offboarding batch — reassign assets.
 *
 * Queries ALL docs for the target member, filters to unprocessed items
 * (assigneeUid !== successorUid), processes up to OFFBOARDING_BATCH_SIZE,
 * and persists remaining counts on the job document.
 *
 * Re-invocation is safe: already-processed docs are filtered out.
 * NEVER modifies createdByUid or createdByDisplayName (immutable attribution).
 *
 * @param {string} jobId
 * @returns {Promise<{pitchesReassigned: number, reportsReassigned: number, briefsReassigned: number, remainingPitches: number, remainingReports: number, remainingBriefs: number, allExhausted: boolean}>}
 */
async function processOffboardingBatch(jobId) {
    const db = admin.firestore();

    const jobDoc = await db.collection('offboardingJobs').doc(jobId).get();
    if (!jobDoc.exists) throw new Error('Offboarding job not found');

    const job = jobDoc.data();

    // Idempotent: already completed
    if (job.status === 'completed') {
        return {
            pitchesReassigned: 0, reportsReassigned: 0, briefsReassigned: 0,
            remainingPitches: 0, remainingReports: 0, remainingBriefs: 0,
            allExhausted: true,
        };
    }

    if (job.status !== 'processing') {
        throw new Error(`Job status is ${job.status}, expected processing`);
    }

    const { workspaceId, targetUid, successorUid } = job;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const errors = [];

    /**
     * Process one collection: fetch all docs for this member, filter to
     * unprocessed, reassign up to OFFBOARDING_BATCH_SIZE, return counts.
     */
    async function processCollection(collectionName) {
        try {
            const allSnap = await db.collection(collectionName)
                .where('workspaceId', '==', workspaceId)
                .where('createdByUid', '==', targetUid)
                .get();

            // Filter to only unprocessed docs (not yet reassigned to successor)
            const unprocessed = allSnap.docs.filter(
                doc => doc.data().assigneeUid !== successorUid
            );

            const toProcess = unprocessed.slice(0, OFFBOARDING_BATCH_SIZE);

            if (toProcess.length > 0) {
                const batch = db.batch();
                for (const doc of toProcess) {
                    batch.update(doc.ref, {
                        assigneeUid: successorUid,
                        formerMemberAt: now,
                        updatedAt: now,
                        // createdByUid and createdByDisplayName are NEVER changed
                    });
                }
                await batch.commit();
            }

            return {
                reassigned: toProcess.length,
                remaining: unprocessed.length - toProcess.length,
            };
        } catch (err) {
            console.error(`[Offboarding] ${collectionName} reassignment failed:`, err.message);
            errors.push(`${collectionName}: ${err.message}`);
            return { reassigned: 0, remaining: -1 }; // -1 = error, unknown remaining
        }
    }

    const pitchResult = await processCollection('pitches');
    const reportResult = await processCollection('marketReports');
    const briefResult = await processCollection('opportunityBriefs');

    const remainingPitches = pitchResult.remaining;
    const remainingReports = reportResult.remaining;
    const remainingBriefs = briefResult.remaining;

    // allExhausted only if all remaining counts are exactly 0 (not -1 error)
    const allExhausted = remainingPitches === 0 && remainingReports === 0 && remainingBriefs === 0;

    // Persist progress on job doc (cumulative reassignment counts, absolute remaining)
    await db.collection('offboardingJobs').doc(jobId).update({
        pitchesReassigned: admin.firestore.FieldValue.increment(pitchResult.reassigned),
        reportsReassigned: admin.firestore.FieldValue.increment(reportResult.reassigned),
        briefsReassigned: admin.firestore.FieldValue.increment(briefResult.reassigned),
        remainingPitches,
        remainingReports,
        remainingBriefs,
        allExhausted,
        errors,
        updatedAt: now,
    });

    return {
        pitchesReassigned: pitchResult.reassigned,
        reportsReassigned: reportResult.reassigned,
        briefsReassigned: briefResult.reassigned,
        remainingPitches,
        remainingReports,
        remainingBriefs,
        allExhausted,
    };
}

/**
 * Stage 3: Complete offboarding — mark REMOVED, sync mirrors, audit-complete.
 *
 * REFUSES to proceed unless every collection cursor is independently verified
 * as exhausted by querying live Firestore data. Does not trust job counters.
 *
 * Idempotent: re-running a completed job is a no-op.
 *
 * @param {string} jobId
 * @returns {Promise<void>}
 */
async function completeOffboarding(jobId) {
    const db = admin.firestore();

    const jobDoc = await db.collection('offboardingJobs').doc(jobId).get();
    if (!jobDoc.exists) throw new Error('Offboarding job not found');

    const job = jobDoc.data();

    // Idempotent: already completed
    if (job.status === 'completed') return;

    const { workspaceId, targetUid, actorUid, successorUid } = job;

    // ── INDEPENDENT VERIFICATION ────────────────────────────────────────────
    // Query live data to verify ALL assets have been reassigned.
    // Does NOT trust job counters — prevents marking REMOVED with stranded assets.
    const collections = ['pitches', 'marketReports', 'opportunityBriefs'];
    for (const collectionName of collections) {
        const snap = await db.collection(collectionName)
            .where('workspaceId', '==', workspaceId)
            .where('createdByUid', '==', targetUid)
            .get();

        const unprocessed = snap.docs.filter(
            doc => doc.data().assigneeUid !== successorUid
        );

        if (unprocessed.length > 0) {
            throw new Error(
                `Cannot complete offboarding: ${unprocessed.length} ${collectionName} remain unprocessed`
            );
        }
    }

    // ── MARK REMOVED ────────────────────────────────────────────────────────
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
    OFFBOARDING_BATCH_SIZE,
};
