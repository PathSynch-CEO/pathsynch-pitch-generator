/**
 * Backfill script: add workspaceId + createdBy to existing Market Intel reports
 *
 * Adds:
 *   workspaceId  — the team owner's UID (= userId for solo users / owners)
 *   createdBy    — { userId, displayName } of the report author
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=./pathconnect-442522-ec919d9337b8.json \
 *   node scripts/backfill-workspace-fields.js
 *
 * The script is idempotent — re-running it is safe; already-backfilled docs are skipped.
 */

'use strict';

const admin = require('firebase-admin');

// ---------------------------------------------------------------------------
// Init Firebase (requires GOOGLE_APPLICATION_CREDENTIALS env var)
// ---------------------------------------------------------------------------
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

const CHARLES_UID = 'dehiyRBCXcUUM72O211S27lfXbl1';
const BATCH_SIZE  = 400; // Firestore batch-write limit is 500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a user's workspace context.
 * Returns { workspaceId, displayName }
 */
async function resolveWorkspace(userId) {
    const [ownerDoc, userDoc] = await Promise.all([
        db.collection('teams').doc(userId).get(),
        db.collection('users').doc(userId).get()
    ]);

    const displayName = userDoc.exists ? (userDoc.data().displayName || '') : '';

    if (ownerDoc.exists) {
        return { workspaceId: userId, displayName };
    }

    const snap = await db.collection('teams')
        .where('memberUids', 'array-contains', userId)
        .limit(1)
        .get();

    if (snap.empty) {
        return { workspaceId: userId, displayName };
    }

    return { workspaceId: snap.docs[0].data().ownerUid, displayName };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function backfill() {
    console.log('=== Market Intel Workspace Backfill ===');
    console.log('Fetching reports without workspaceId...\n');

    // Fetch ALL reports that are missing workspaceId.
    // Firestore doesn't support "field does not exist" queries, so we fetch
    // all reports and filter in memory.  For large datasets, paginate.
    let query      = db.collection('marketReports').orderBy('createdAt', 'asc');
    let lastDoc    = null;
    let total      = 0;
    let skipped    = 0;
    let updated    = 0;

    // Cache workspace info per userId to avoid redundant lookups
    const wsCache  = new Map();

    while (true) {
        if (lastDoc) query = query.startAfter(lastDoc);

        const snap = await query.limit(500).get();
        if (snap.empty) break;

        lastDoc = snap.docs[snap.docs.length - 1];
        total  += snap.docs.length;

        // Group docs that need backfilling by userId
        const toUpdate = snap.docs.filter(d => !d.data().workspaceId);
        if (toUpdate.length === 0) {
            skipped += snap.docs.length;
            continue;
        }

        // Resolve workspace info for each unique userId
        const userIds = [...new Set(toUpdate.map(d => d.data().userId).filter(Boolean))];
        await Promise.all(userIds.map(async uid => {
            if (!wsCache.has(uid)) {
                wsCache.set(uid, await resolveWorkspace(uid));
            }
        }));

        // Write in batches of BATCH_SIZE
        let batch     = db.batch();
        let batchCount = 0;

        for (const doc of toUpdate) {
            const data = doc.data();
            const uid  = data.userId;
            if (!uid) { skipped++; continue; }

            const ws = wsCache.get(uid);
            if (!ws) { skipped++; continue; }

            batch.update(doc.ref, {
                workspaceId: ws.workspaceId,
                createdBy:   { userId: uid, displayName: ws.displayName }
            });
            batchCount++;
            updated++;

            if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                console.log(`  Committed batch of ${batchCount} updates (total updated: ${updated})`);
                batch      = db.batch();
                batchCount = 0;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`  Committed batch of ${batchCount} updates (total updated: ${updated})`);
        }

        skipped += snap.docs.length - toUpdate.length;
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Total docs scanned : ${total}`);
    console.log(`Already backfilled : ${skipped}`);
    console.log(`Newly updated      : ${updated}`);

    if (updated === 0 && total === 0) {
        console.log('\nNo market reports found. Nothing to do.');
    }

    process.exit(0);
}

backfill().catch(err => {
    console.error('\nBackfill failed:', err);
    process.exit(1);
});
