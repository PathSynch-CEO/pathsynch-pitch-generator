/**
 * backup-stuck-batches.js — Full export of the 7 stuck Apr-2026 prospectIntel batches.
 *
 * READ-ONLY. Captures reversible state before any terminal-status write.
 * The 7 batch IDs are HARDCODED below — never sourced from a query.
 *
 * Output:
 *   ./backups/stuck-batches-<ISO timestamp>.json   (written to cwd = functions/)
 *   NOTE: ':' and '.' in the ISO timestamp are replaced with '-' (invalid in Windows filenames).
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backup-stuck-batches.js
 *
 * Do NOT commit the output file (contains customer batch data).
 */

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// HARDCODED — the 7 stuck batches (all Charles Berry, Apr 24 2026). Never from a query.
const STUCK_BATCH_IDS = [
    '4UynprL9UNQqtIbf8x5T',
    'KDp2TfX098sa7JFPrcSp',
    'Qrvc2Fwn7gOFIvZxmnAW',
    'XW3TJFNu5o3VVJYOUuGu',
    'c50qkvxRHhzOI0LLQ2i8',
    'ocQnIJifARvd4BqdN2xn',
    'xga1GkC7mnStaIpPjvkF',
];

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

// Convert Firestore Timestamps to ISO strings so the JSON is human-readable + restorable.
function serialize(_key, value) {
    if (value && typeof value === 'object' && typeof value._seconds === 'number') {
        return { __timestamp__: new Date(value._seconds * 1000).toISOString() };
    }
    return value;
}

async function main() {
    const backup = { exportedAt: new Date().toISOString(), batches: {} };
    let present = 0;

    for (const id of STUCK_BATCH_IDS) {
        const snap = await db.collection('prospectIntel').doc(id).get();
        backup.batches[id] = {
            exists: snap.exists,
            data: snap.exists ? snap.data() : null,
        };
        if (snap.exists) {
            present += 1;
            console.log(`  ${id} — status=${snap.data().status} total=${snap.data().totalProspects} completed=${snap.data().completedCount}`);
        } else {
            console.log(`  ${id} — MISSING`);
        }
    }

    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(backupsDir, `stuck-batches-${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(backup, serialize, 2));

    const bytes = fs.statSync(outPath).size;
    console.log(`\nBacked up ${present}/${STUCK_BATCH_IDS.length} present docs → ${outPath} (${bytes} bytes)`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error('Backup failed:', err.message);
    process.exit(1);
});
