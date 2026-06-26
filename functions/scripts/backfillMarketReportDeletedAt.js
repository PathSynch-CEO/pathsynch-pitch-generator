/**
 * backfillMarketReportDeletedAt.js
 *
 * Stamps `deletedAt: null` and `deletedBy: null` on every marketReports doc
 * that does not already have a `deletedAt` field.
 *
 * GATE: updated_count must equal total_doc_count exactly.
 * If the counts do not match, the script exits non-zero and prints the
 * discrepancy. Do NOT deploy the listReports filter until this gate passes.
 *
 * This script never hard-deletes anything. It is purely additive.
 *
 * Usage (from functions/ directory):
 *
 *   # Dry run (default — shows counts, writes nothing):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backfillMarketReportDeletedAt.js
 *
 *   # Live run (actually writes):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backfillMarketReportDeletedAt.js --write
 *
 * Idempotent: re-running is safe. Docs that already have `deletedAt` (null or
 * otherwise) are skipped.
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db    = admin.firestore();
const WRITE = process.argv.includes('--write');
const BATCH_SIZE = 400; // Firestore limit is 500; keep buffer

async function main() {
    console.log('=== Backfill marketReports.deletedAt ===');
    console.log('Mode:', WRITE ? 'LIVE WRITE' : 'DRY RUN (pass --write to execute)');
    console.log('');

    // Fetch ALL marketReports — no user filter, we stamp every doc.
    // Phase 0 confirmed: zero docs have deletedAt in any form, so
    // Firestore has no "field absent" query; we must fetch all and filter in memory.
    console.log('Fetching all marketReports…');
    const snap = await db.collection('marketReports').get();
    const totalDocCount = snap.size;
    console.log('Total docs in collection:', totalDocCount);

    const toStamp   = [];
    let alreadySet  = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        // Skip docs that already have deletedAt (null counts as set)
        if ('deletedAt' in data) {
            alreadySet++;
            continue;
        }
        toStamp.push(doc.ref);
    }

    const missingCount = toStamp.length;
    console.log('Already have deletedAt:', alreadySet);
    console.log('Missing deletedAt (will stamp):', missingCount);
    console.log('');

    if (WRITE && missingCount === 0) {
        console.log('[GATE] All docs already have deletedAt. Nothing to do.');
        console.log('[GATE] updated_count (0) + already_had_field (' + alreadySet + ') = ' + totalDocCount + ' = total. PASS.');
        process.exit(0);
    }

    if (!WRITE) {
        console.log('[DRY RUN] Would stamp', missingCount, 'docs with { deletedAt: null, deletedBy: null }.');
        console.log('[DRY RUN] Re-run with --write to execute.');
        process.exit(0);
    }

    // --- LIVE WRITE path ---
    console.log('Writing in batches of', BATCH_SIZE, '…');
    let written = 0;

    for (let i = 0; i < toStamp.length; i += BATCH_SIZE) {
        const chunk = toStamp.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const ref of chunk) {
            batch.update(ref, { deletedAt: null, deletedBy: null });
        }

        await batch.commit();
        written += chunk.length;
        console.log('  Batch committed:', chunk.length, 'docs (running total:', written + ')');
    }

    console.log('');
    console.log('=== GATE CHECK ===');
    const updatedCount     = written;
    const alreadyHadField  = alreadySet;
    const gateSum          = updatedCount + alreadyHadField;

    console.log('updated_count:         ', updatedCount);
    console.log('already_had_field:     ', alreadyHadField);
    console.log('sum:                   ', gateSum);
    console.log('total_doc_count:       ', totalDocCount);

    if (gateSum === totalDocCount) {
        console.log('');
        console.log('[GATE] PASS — updated_count + already_had_field === total_doc_count');
        console.log('[GATE] Safe to deploy listReports filter (after indexes are Enabled).');
        process.exit(0);
    } else {
        console.error('');
        console.error('[GATE] FAIL — sum (' + gateSum + ') !== total (' + totalDocCount + ')');
        console.error('[GATE] Discrepancy: ' + (totalDocCount - gateSum) + ' docs unaccounted for.');
        console.error('[GATE] DO NOT deploy the listReports filter. Investigate before proceeding.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
