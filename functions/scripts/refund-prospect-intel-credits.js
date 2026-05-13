/**
 * One-time admin script: refund 4,950 credits to hello@pathsynch.com
 * Bug: Prospect Intel batch for 330 insurance contacts burned 4,950 credits
 *      (330 × 15) at batch creation before any enrichment succeeded (0 enriched).
 *
 * Run from functions/ directory:
 *   node scripts/refund-prospect-intel-credits.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS set in environment:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="./pathconnect-442522-ec919d9337b8.json"
 */

const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'pathsynch-pitch-creation'
});

const db = admin.firestore();

const TARGET_USER_ID   = 'dehiyRBCXcUUM72O211S27lfXbl1';  // hello@pathsynch.com
const REFUND_AMOUNT    = 4950;
const REFUND_REASON    = 'bug_refund_prospect_intel_insurance_batch';
const IDEMPOTENCY_KEY  = 'bug_refund:prospect_intel_insurance_2026_04_28';

async function run() {
    // Idempotency guard — never refund twice
    const ledgerRef  = db.collection('creditLedger').doc(IDEMPOTENCY_KEY);
    const existing   = await ledgerRef.get();
    if (existing.exists) {
        console.log('Refund already applied — creditLedger entry exists. Aborting.');
        process.exit(0);
    }

    // Read current balance
    const userRef = db.collection('users').doc(TARGET_USER_ID);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
        console.error('User not found:', TARGET_USER_ID);
        process.exit(1);
    }
    const currentCredits = userDoc.data().credits || 0;
    console.log(`Current credits for ${TARGET_USER_ID}: ${currentCredits}`);

    // Apply refund atomically
    const batch = db.batch();

    batch.update(userRef, {
        credits: admin.firestore.FieldValue.increment(REFUND_AMOUNT)
    });

    batch.set(ledgerRef, {
        userId:        TARGET_USER_ID,
        amount:        REFUND_AMOUNT,
        reason:        REFUND_REASON,
        description:   '330 insurance contacts uploaded to Prospect Intel — 0 enriched due to enrichment pipeline failure. Credits charged at batch creation (upfront) before any enrichment succeeded. Full refund.',
        refundedAt:    admin.firestore.FieldValue.serverTimestamp(),
        batchSize:     330,
        creditsPerProspect: 15,
        adminAction:   true
    });

    await batch.commit();

    const afterDoc = await userRef.get();
    console.log(`Refund complete. Credits: ${currentCredits} → ${afterDoc.data().credits}`);
    console.log(`CreditLedger entry written: ${IDEMPOTENCY_KEY}`);
    process.exit(0);
}

run().catch(err => {
    console.error('Refund script failed:', err);
    process.exit(1);
});
