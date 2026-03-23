/**
 * Migration: Set status: 'Draft' on all pitch documents missing or having legacy status values.
 *
 * Run: node scripts/migrate-pitch-status.js
 *
 * Targets:
 * - pitches with status: 'ready' → 'Draft'
 * - pitches with no status field → 'Draft'
 * - pitches with lowercase 'draft' → 'Draft'
 *
 * Does NOT touch pitches already having valid pipeline statuses: Draft, Sent, Viewed, Replied
 */

const admin = require('firebase-admin');

// Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS or default project)
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();
const VALID_STATUSES = ['Draft', 'Sent', 'Viewed', 'Replied'];
const BATCH_SIZE = 500;

async function migrate() {
    console.log('Starting pitch status migration...');

    const pitchesRef = db.collection('pitches');
    let lastDoc = null;
    let totalProcessed = 0;
    let totalUpdated = 0;

    while (true) {
        let query = pitchesRef.orderBy('__name__').limit(BATCH_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const currentStatus = data.status;

            // Skip if already a valid pipeline status
            if (VALID_STATUSES.includes(currentStatus)) {
                continue;
            }

            // Migrate: ready, draft (lowercase), missing, or any other value → Draft
            batch.update(doc.ref, {
                status: 'Draft',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            batchCount++;
        }

        if (batchCount > 0) {
            await batch.commit();
            totalUpdated += batchCount;
        }

        totalProcessed += snapshot.docs.length;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        console.log(`Processed ${totalProcessed} docs, updated ${totalUpdated}...`);
    }

    console.log(`Migration complete. ${totalProcessed} total docs, ${totalUpdated} updated to Draft.`);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
