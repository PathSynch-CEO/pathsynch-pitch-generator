/**
 * merchantBehaviorSync.js — Sprint 5 Task 5-4
 *
 * Weekly service that writes behavioral aggregate events to Entity360
 * for PathConnect merchants. Enriches Merchant Memory with visitor funnel data.
 *
 * Runs every Monday at 9am UTC via scheduled Cloud Function in index.js.
 * All Entity360 calls are fire-and-forget — failure never blocks the sync.
 *
 * For each merchant in merchantConfig where entity360MerchantId is set:
 *  1. Read visitorIntelSummary/{merchantId}/accounts — compute aggregate stats
 *  2. POST BEHAVIORAL_SUMMARY event to Entity360
 *  3. If identificationRate < 10%: POST TRAFFIC_PROFILE_UPDATE event
 */

const admin = require('firebase-admin');
const { notifyBehavioralSummary } = require('./entity360Bridge');

const db = admin.firestore();

/**
 * Run the weekly behavioral sync for all merchants with entity360MerchantId set.
 * @returns {Promise<{ synced: number, skipped: number, errors: number }>}
 */
async function runWeeklyBehaviorSync() {
    console.log('[MerchantBehaviorSync] Starting weekly sync run');

    // Find all merchantConfig docs with entity360MerchantId set
    const configSnap = await db.collection('merchantConfig')
        .where('entity360MerchantId', '!=', null)
        .limit(200)
        .get();

    if (configSnap.empty) {
        console.log('[MerchantBehaviorSync] No merchants with entity360MerchantId configured');
        return { synced: 0, skipped: 0, errors: 0 };
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const configDoc of configSnap.docs) {
        const merchantId      = configDoc.id;
        const entity360MerchantId = configDoc.data()?.entity360MerchantId;

        if (!entity360MerchantId) {
            skipped++;
            continue;
        }

        try {
            const summary = await computeMerchantSummary(merchantId);

            if (summary.totalAccounts === 0) {
                console.log(`[MerchantBehaviorSync] No accounts for merchant ${merchantId}, skipping`);
                skipped++;
                continue;
            }

            // Fire BEHAVIORAL_SUMMARY (and optionally TRAFFIC_PROFILE_UPDATE)
            notifyBehavioralSummary(entity360MerchantId, summary);

            console.log(`[MerchantBehaviorSync] Synced merchant ${merchantId} → Entity360 merchant ${entity360MerchantId}`, {
                totalAccounts:       summary.totalAccounts,
                hotAccounts:         summary.hotAccounts,
                outreachNowAccounts: summary.outreachNowAccounts,
                identificationRate:  summary.identificationRate
            });

            synced++;
        } catch (err) {
            console.error(`[MerchantBehaviorSync] Failed for merchant ${merchantId}:`, err.message);
            errors++;
            // Continue to next merchant — never abort the whole run
        }
    }

    console.log(`[MerchantBehaviorSync] Complete — synced: ${synced}, skipped: ${skipped}, errors: ${errors}`);
    return { synced, skipped, errors };
}

/**
 * Compute aggregate visitor intel stats for a single merchant from this month.
 * @param {string} merchantId
 * @returns {Promise<Object>} summary stats
 */
async function computeMerchantSummary(merchantId) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const accountsSnap = await db.collection('visitorIntelSummary').doc(merchantId)
        .collection('accounts')
        .limit(500)
        .get();

    let totalAccounts    = 0;
    let hotAccounts      = 0;
    let outreachNowAccts = 0;
    let identifiedCount  = 0;
    const pageCountMap   = {};

    for (const doc of accountsSnap.docs) {
        const data = doc.data();

        // Count accounts seen this month
        const updatedAt = data.updatedAt?.toDate?.() || (data.updatedAt ? new Date(data.updatedAt) : null);
        if (!updatedAt || updatedAt < firstOfMonth) continue;

        totalAccounts++;

        // Status counts
        if (data.status === 'hot')          hotAccounts++;
        if (data.status === 'outreach_now') outreachNowAccts++;

        // Identification (confidence tier is not 'unresolved')
        if (data.identityConfidenceTier && data.identityConfidenceTier !== 'unresolved') {
            identifiedCount++;
        }

        // Aggregate high-intent pages
        if (Array.isArray(data.highIntentPages)) {
            for (const tag of data.highIntentPages) {
                const key = typeof tag === 'string' ? tag : (tag.tag || 'unknown');
                pageCountMap[key] = (pageCountMap[key] || 0) + 1;
            }
        }
    }

    // Top 5 high-intent pages by account visit count
    const topHighIntentPages = Object.entries(pageCountMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, accountCount: count }));

    const identificationRate = totalAccounts > 0
        ? Math.round((identifiedCount / totalAccounts) * 100)
        : 0;

    return {
        totalAccounts,
        hotAccounts,
        outreachNowAccounts: outreachNowAccts,
        topHighIntentPages,
        identificationRate
    };
}

module.exports = { runWeeklyBehaviorSync };
