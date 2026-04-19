/**
 * alertService.js — Sprint 4 Trigger Engine (Stage 1)
 *
 * Writes threshold alert documents to notifications/{userId}/alerts/{alertId}.
 * Stage 1 is human-confirms-everything: no auto-push to Attio or Instantly.
 * Sends email via SendGrid when available.
 *
 * Alert schema:
 *   alertId, userId, accountKey, domain, companyName, threshold, accountScore,
 *   scoreExplanation, highIntentPages, lastVisit, status, createdAt, assets
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

// Alert threshold definitions
const THRESHOLD_CONFIG = {
    warming: {
        label: 'Warming',
        minScore: 75,
        emailSubject: (companyName) => `Account warming up — ${companyName}`,
        assets: { pitchReady: false, briefReady: false, marketIntelReady: false }
    },
    hot: {
        label: 'Hot',
        minScore: 150,
        emailSubject: (companyName) => `Hot account — ${companyName} needs your attention`,
        assets: { pitchReady: false, briefReady: false, marketIntelReady: true }
    },
    outreach_now: {
        label: 'Outreach Now',
        minScore: 200,
        emailSubject: (companyName) => `Outreach Now — ${companyName} is ready`,
        assets: { pitchReady: true, briefReady: true, marketIntelReady: true }
    }
};

// Suppression TTL: 30 days in milliseconds
const SUPPRESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Determine threshold label from score and page data.
 * outreach_now can also trigger on pricing page in 2+ sessions.
 */
function classifyThreshold(score, highIntentPages = []) {
    const pricingPageHits = highIntentPages.filter(p =>
        (p.tag || '').toLowerCase().includes('pricing') ||
        (p.url || '').toLowerCase().includes('pricing')
    );
    if (score >= 200 || pricingPageHits.length >= 2) return 'outreach_now';
    if (score >= 150) return 'hot';
    if (score >= 75) return 'warming';
    return null;
}

/**
 * Check if an alert for this account is currently suppressed (within 30 days).
 */
async function checkSuppression(userId, accountKey) {
    const suppRef = db
        .collection('notifications').doc(userId)
        .collection('suppressions').doc(accountKey);
    const doc = await suppRef.get();
    if (!doc.exists) return false;
    const data = doc.data();
    const suppressedAt = data.suppressedAt?.toDate?.() || new Date(data.suppressedAt);
    return (Date.now() - suppressedAt.getTime()) < SUPPRESSION_TTL_MS;
}

/**
 * Write a 30-day suppression record for this account.
 */
async function writeSuppression(userId, accountKey) {
    const suppRef = db
        .collection('notifications').doc(userId)
        .collection('suppressions').doc(accountKey);
    await suppRef.set({
        accountKey,
        suppressedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + SUPPRESSION_TTL_MS)
    });
}

/**
 * Create an alert document in notifications/{userId}/alerts/{alertId}.
 * Sends email if SendGrid is configured.
 */
async function createAlert(userId, {
    accountKey,
    domain,
    companyName,
    threshold,
    accountScore,
    scoreExplanation,
    highIntentPages = [],
    lastVisit
}) {
    const config = THRESHOLD_CONFIG[threshold];
    if (!config) throw new Error(`Unknown threshold: ${threshold}`);

    const alertId = crypto.randomUUID();
    const alertRef = db
        .collection('notifications').doc(userId)
        .collection('alerts').doc(alertId);

    const alertDoc = {
        alertId,
        userId,
        accountKey,
        domain: domain || '',
        companyName: companyName || domain || 'Unknown Company',
        threshold,
        accountScore: accountScore || 0,
        scoreExplanation: scoreExplanation || '',
        highIntentPages: highIntentPages || [],
        lastVisit: lastVisit || admin.firestore.FieldValue.serverTimestamp(),
        status: 'unread',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        assets: { ...config.assets }
    };

    await alertRef.set(alertDoc);
    console.log(`[AlertService] Created ${threshold} alert ${alertId} for user ${userId} — ${companyName}`);

    // Send email via SendGrid (best-effort)
    if (process.env.SENDGRID_API_KEY) {
        try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);

            // Fetch user email
            const userDoc = await db.collection('users').doc(userId).get();
            const userEmail = userDoc.exists ? userDoc.data()?.profile?.email || userDoc.data()?.email : null;

            if (userEmail) {
                await sgMail.send({
                    to: userEmail,
                    from: 'alerts@synchintro.ai',
                    subject: config.emailSubject(alertDoc.companyName),
                    text: [
                        `${config.label} Alert: ${alertDoc.companyName}`,
                        '',
                        `Score: ${alertDoc.accountScore}`,
                        `Domain: ${alertDoc.domain}`,
                        '',
                        alertDoc.scoreExplanation,
                        '',
                        'View in SynchIntro: https://app.synchintro.ai/#visitors'
                    ].join('\n')
                });
                console.log(`[AlertService] Email sent to ${userEmail} for alert ${alertId}`);
            }
        } catch (emailErr) {
            // Email failure must never block alert creation
            console.warn('[AlertService] Email send failed (non-critical):', emailErr.message);
        }
    }

    return { alertId, ...alertDoc };
}

/**
 * Process a single pubSubThresholdLog entry.
 * Returns true if alert was created, false if skipped.
 */
async function processThresholdEntry(entry) {
    const { userId, accountKey, domain, companyName, accountScore, scoreExplanation,
            highIntentPages, lastVisit, threshold: entryThreshold } = entry;

    if (!userId || !accountKey) {
        console.warn('[AlertService] Skipping entry with missing userId or accountKey', entry);
        return false;
    }

    // Determine threshold (use entry value or classify from score)
    const threshold = entryThreshold || classifyThreshold(accountScore, highIntentPages);
    if (!threshold) {
        console.log(`[AlertService] Score ${accountScore} does not meet any threshold, skipping`);
        return false;
    }

    // Check 30-day suppression
    const suppressed = await checkSuppression(userId, accountKey);
    if (suppressed) {
        console.log(`[AlertService] Account ${accountKey} is suppressed for user ${userId}, skipping`);
        return false;
    }

    await createAlert(userId, {
        accountKey,
        domain,
        companyName,
        threshold,
        accountScore,
        scoreExplanation,
        highIntentPages,
        lastVisit
    });

    return true;
}

/**
 * processThresholdQueue — reads all unprocessed pubSubThresholdLog entries
 * and creates alert documents. Called by the scheduled function every 5 minutes.
 */
async function processThresholdQueue() {
    const snapshot = await db.collection('pubSubThresholdLog')
        .where('processed', '==', false)
        .limit(100)
        .get();

    if (snapshot.empty) {
        console.log('[AlertService] No unprocessed threshold entries found');
        return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
        const entry = { id: doc.id, ...doc.data() };

        // Skip suppressed entries
        if (entry.suppressed === true) {
            await doc.ref.update({ processed: true });
            skipped++;
            continue;
        }

        try {
            const created = await processThresholdEntry(entry);
            await doc.ref.update({
                processed: true,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            if (created) processed++;
            else skipped++;
        } catch (err) {
            console.error(`[AlertService] Failed to process entry ${doc.id}:`, err.message);
            // Don't mark as processed — will retry next run
        }
    }

    console.log(`[AlertService] Queue run complete: ${processed} alerts created, ${skipped} skipped`);
    return { processed, skipped };
}

module.exports = {
    createAlert,
    classifyThreshold,
    checkSuppression,
    writeSuppression,
    processThresholdEntry,
    processThresholdQueue
};
