/**
 * backfill-workspaceid.js — Stamps workspaceId on legacy pitches and
 * marketReports owned by Charles Berry that predate workspace creation.
 *
 * What it does:
 *   1. Scans pitches where userId == CHARLES_UID and workspaceId is absent/null
 *   2. Scans marketReports where userId == CHARLES_UID and workspaceId is absent/null
 *   3. Stamps workspaceId: 'ws_bootstrap_charles' on each matching doc
 *   4. Does NOT touch docs that already have a workspaceId
 *   5. Does NOT touch any other user's docs
 *
 * Idempotent: re-running is safe — already-stamped docs are skipped.
 *
 * Usage (from functions/ directory):
 *   # Dry run (default — shows counts, writes nothing):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backfill-workspaceid.js
 *
 *   # Live run (actually writes):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backfill-workspaceid.js --write
 *
 * Rollback:
 *   Not needed — the field is additive. But if required, remove workspaceId
 *   from any doc where workspaceId == 'ws_bootstrap_charles' and the doc
 *   was updated after this script's run timestamp.
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

const CHARLES_UID    = 'dehiyRBCXcUUM72O211S27lfXbl1';
const WORKSPACE_ID   = 'ws_bootstrap_charles';
const BATCH_SIZE     = 400; // Firestore batch limit is 500
const DRY_RUN        = !process.argv.includes('--write');

async function backfillCollection(collectionName) {
    console.log(`\n--- ${collectionName} ---`);

    // Firestore has no "field does not exist" query, so we fetch all docs
    // for this user and filter in memory.
    let query   = db.collection(collectionName).where('userId', '==', CHARLES_UID);
    const snap  = await query.get();

    console.log(`  Total docs for Charles: ${snap.size}`);

    const toUpdate = [];
    let alreadySet = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.workspaceId) {
            alreadySet++;
            continue;
        }
        toUpdate.push(doc);
    }

    console.log(`  Already has workspaceId: ${alreadySet}`);
    console.log(`  Missing workspaceId (will stamp): ${toUpdate.length}`);

    if (toUpdate.length > 0 && toUpdate.length <= 10) {
        console.log('  Sample IDs:');
        for (const doc of toUpdate.slice(0, 10)) {
            const d = doc.data();
            console.log(`    ${doc.id} | businessName: ${d.businessName || d.title || '(none)'}`);
        }
    } else if (toUpdate.length > 10) {
        console.log('  First 5 IDs:');
        for (const doc of toUpdate.slice(0, 5)) {
            const d = doc.data();
            console.log(`    ${doc.id} | businessName: ${d.businessName || d.title || '(none)'}`);
        }
        console.log(`    ... and ${toUpdate.length - 5} more`);
    }

    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would stamp ${toUpdate.length} docs — no writes performed.`);
        return { total: snap.size, alreadySet, stamped: toUpdate.length };
    }

    // Write in batches
    let written = 0;
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const doc of chunk) {
            batch.update(doc.ref, { workspaceId: WORKSPACE_ID });
        }

        await batch.commit();
        written += chunk.length;
        console.log(`  Committed batch: ${chunk.length} docs (total written: ${written})`);
    }

    console.log(`  [DONE] Stamped ${written} docs with workspaceId: ${WORKSPACE_ID}`);
    return { total: snap.size, alreadySet, stamped: written };
}

async function main() {
    console.log('=== Backfill workspaceId ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --write to execute)' : 'LIVE WRITE'}`);
    console.log(`Target user: ${CHARLES_UID}`);
    console.log(`Workspace ID: ${WORKSPACE_ID}`);

    const pitchResult  = await backfillCollection('pitches');
    const reportResult = await backfillCollection('marketReports');

    console.log('\n=== Summary ===');
    console.log(`Pitches:       ${pitchResult.stamped} to stamp (${pitchResult.alreadySet} already set, ${pitchResult.total} total)`);
    console.log(`Market Reports: ${reportResult.stamped} to stamp (${reportResult.alreadySet} already set, ${reportResult.total} total)`);

    if (DRY_RUN) {
        console.log('\n[DRY RUN] No Firestore writes were made. Pass --write to execute.');
    } else {
        console.log('\n[COMPLETE] All docs stamped.');
    }

    process.exit(0);
}

main().catch(err => {
    console.error('\nBackfill failed:', err);
    process.exit(1);
});
