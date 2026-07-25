/**
 * clear-stuck-batches.js — Mark stuck Apr-2026 prospectIntel batches terminal.
 *
 * Frees active-batch slots WITHOUT a delete route. Does NOT delete docs, does NOT
 * touch the prospects subcollection, does NOT modify any credit/balance field.
 *
 * The batch IDs are HARDCODED whitelists below. CLI args only SELECT from those
 * sets — an ID not in a whitelist is rejected. IDs are never sourced from a query.
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/clear-stuck-batches.js --ids=KDp2TfX098sa7JFPrcSp
 *   node scripts/clear-stuck-batches.js --ids=id1,id2,...        # clear several processing docs
 *   node scripts/clear-stuck-batches.js --normalize-doc1         # normalize 4Uynpr... schema
 *   add --dry-run to print the payload without writing.
 */

'use strict';

const admin = require('firebase-admin');

// ── HARDCODED whitelists — never from a query ──────────────────────────────────
const PROCESSING_IDS = [
    'KDp2TfX098sa7JFPrcSp',
    'Qrvc2Fwn7gOFIvZxmnAW',
    'XW3TJFNu5o3VVJYOUuGu',
    'c50qkvxRHhzOI0LLQ2i8',
    'ocQnIJifARvd4BqdN2xn',
    'xga1GkC7mnStaIpPjvkF',
];
const DOC1_ID = '4UynprL9UNQqtIbf8x5T';
const OWNER_UID = 'dehiyRBCXcUUM72O211S27lfXbl1';

const CLEARED_BY      = 'manual_ops_charles_2026_07_10';
const FAILURE_REASON  = 'orphaned_worker_never_started_apr2026';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// ── args ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const normalizeDoc1 = args.includes('--normalize-doc1');
const idsArg = (args.find(a => a.startsWith('--ids=')) || '').replace('--ids=', '');
const requestedIds = idsArg ? idsArg.split(',').map(s => s.trim()).filter(Boolean) : [];

function clearPayload() {
    return {
        status:        'failed',
        failureReason: FAILURE_REASON,
        clearedAt:     FV.serverTimestamp(),
        clearedBy:     CLEARED_BY,
    };
}

async function activeCount() {
    const snap = await db.collection('prospectIntel')
        .where('userId', '==', OWNER_UID)
        .where('status', 'in', ['queued', 'processing'])
        .get();
    return snap.size;
}

async function main() {
    if (!requestedIds.length && !normalizeDoc1) {
        console.error('Nothing to do. Pass --ids=<id[,id...]> and/or --normalize-doc1.');
        process.exit(2);
    }

    // Validate every requested id against the hardcoded processing whitelist.
    for (const id of requestedIds) {
        if (!PROCESSING_IDS.includes(id)) {
            console.error(`REJECTED: ${id} is not in the hardcoded processing whitelist.`);
            process.exit(2);
        }
    }

    console.log(`Active count (before): ${await activeCount()}`);

    // ── Clear processing docs ──
    for (const id of requestedIds) {
        const payload = clearPayload();
        console.log(`\n${dryRun ? '[DRY-RUN] would write' : 'WRITE'} → prospectIntel/${id}`);
        console.log(JSON.stringify({
            status: payload.status,
            failureReason: payload.failureReason,
            clearedAt: 'FieldValue.serverTimestamp()',
            clearedBy: payload.clearedBy,
        }, null, 2));
        if (!dryRun) {
            await db.collection('prospectIntel').doc(id).update(payload);
            const after = (await db.collection('prospectIntel').doc(id).get()).data().status;
            console.log(`  applied — status is now: ${after}`);
        }
    }

    // ── Normalize doc 1 ──
    if (normalizeDoc1) {
        const payload = {
            status:          'failed',
            failureReason:   FAILURE_REASON,
            clearedAt:       FV.serverTimestamp(),
            clearedBy:       CLEARED_BY,
            terminatedAt:    FV.delete(),
            terminationNote: FV.delete(),
        };
        console.log(`\n${dryRun ? '[DRY-RUN] would write' : 'WRITE'} → prospectIntel/${DOC1_ID} (normalize)`);
        console.log(JSON.stringify({
            status: payload.status,
            failureReason: payload.failureReason,
            clearedAt: 'FieldValue.serverTimestamp()',
            clearedBy: payload.clearedBy,
            terminatedAt: 'FieldValue.delete()',
            terminationNote: 'FieldValue.delete()',
        }, null, 2));
        if (!dryRun) {
            await db.collection('prospectIntel').doc(DOC1_ID).update(payload);
            console.log('  applied — doc1 normalized.');
        }
    }

    console.log(`\nActive count (after): ${await activeCount()}`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error('clear failed:', err.message);
    process.exit(1);
});
