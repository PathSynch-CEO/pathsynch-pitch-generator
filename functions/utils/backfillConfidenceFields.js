/**
 * Backfill Confidence Fields
 *
 * One-time Cloud Function to add confidence schema fields to all existing
 * websiteVisitors documents that lack them.
 *
 * Run via: firebase functions:shell
 *   > backfillConfidenceFields()
 *
 * DO NOT deploy as a scheduled function.
 */

const admin = require('firebase-admin');
const { BACKFILL_DEFAULTS, isKnownISP } = require('./visitorConfidence');

const db = admin.firestore();

/**
 * Backfill all websiteVisitors documents missing identity_confidence_score.
 * Sets defaults per the confidence schema spec.
 */
async function backfillConfidenceFields() {
    console.log('[Backfill] Starting confidence field backfill...');

    const BATCH_SIZE = 500;
    let totalUpdated = 0;
    let lastDoc = null;
    let hasMore = true;

    while (hasMore) {
        let query = db.collection('websiteVisitors')
            .limit(BATCH_SIZE);

        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            hasMore = false;
            break;
        }

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();

            // Skip if already has confidence fields
            if (data.identity_confidence_score !== undefined) {
                continue;
            }

            // Use ISP-aware defaults: if companyName is a known ISP, degrade account_match_confidence
            const defaults = { ...BACKFILL_DEFAULTS };
            if (isKnownISP(data.companyName)) {
                defaults.account_match_confidence = 10;
            }

            batch.update(doc.ref, defaults);
            batchCount++;
        }

        if (batchCount > 0) {
            await batch.commit();
            totalUpdated += batchCount;
            console.log(`[Backfill] Updated ${batchCount} records (total: ${totalUpdated})`);
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        if (snapshot.docs.length < BATCH_SIZE) {
            hasMore = false;
        }
    }

    console.log(`[Backfill] Complete. ${totalUpdated} records updated.`);
    return { totalUpdated };
}

module.exports = { backfillConfidenceFields };
