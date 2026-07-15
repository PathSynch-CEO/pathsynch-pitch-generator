'use strict';

/**
 * rescoreGovOpportunities.js — One-time rescore sweep for PR-C1 (v2.2 §4.4-6).
 *
 * After enabling GOVCAPTURE_RANK_FIELDS_ENABLED, existing opportunities still
 * carry scores from the pre-gate formula. This sweep rescores every non-archived
 * opportunity whose fit.scoringVersion is absent or below the current gated
 * version, under the new formula — so the inbox never mixes incompatible scores.
 *
 * Idempotent: an opportunity already at the current scoringVersion is skipped, so
 * re-running is safe. Respects the Gemini prefilter gate (no extra LLM cost for
 * low-relevance rows beyond the existing pipeline behavior).
 *
 * Preconditions (fail-fast checked below):
 *   GOVCAPTURE_RANK_FIELDS_ENABLED=true   (else the sweep would stamp legacy v1)
 *   GEMINI_API_KEY set                    (semantic solution match)
 *   GOOGLE_APPLICATION_CREDENTIALS → a key with Firestore access to the project
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-...json \
 *   GOVCAPTURE_RANK_FIELDS_ENABLED=true GEMINI_API_KEY=... \
 *   node scripts/rescoreGovOpportunities.js [--dry-run] [--user=<uid>]
 */

const admin = require('firebase-admin');
const { SCORING_VERSION_GATED } = require('../services/govcapture/govScoreConstants');

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const userArg = (args.find(a => a.startsWith('--user=')) || '').replace('--user=', '') || null;

function preflight() {
    const problems = [];
    if (process.env.GOVCAPTURE_RANK_FIELDS_ENABLED !== 'true') {
        problems.push('GOVCAPTURE_RANK_FIELDS_ENABLED must be "true" (otherwise this would stamp legacy v1).');
    }
    if (!process.env.GEMINI_API_KEY) {
        problems.push('GEMINI_API_KEY is not set (needed for semantic solution scoring).');
    }
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        problems.push('GOOGLE_APPLICATION_CREDENTIALS is not set (needed for Firestore access).');
    }
    if (problems.length) {
        console.error('Preflight failed:\n  - ' + problems.join('\n  - '));
        process.exit(2);
    }
}

async function main() {
    preflight();

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId:  'pathsynch-pitch-creation',
        });
    }
    const db = admin.firestore();
    const { scoreAndEnrich } = require('../services/govcapture/scoringPipeline');

    // Active profiles (optionally scoped to one user).
    let profileQuery = db.collection('govProfiles').where('status', '==', 'active');
    if (userArg) profileQuery = profileQuery.where('userId', '==', userArg);
    const profileSnap = await profileQuery.get();

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Sweep target: ${profileSnap.size} active profile(s)` + (userArg ? ` for user ${userArg}` : ''));

    let scanned = 0, rescored = 0, skipped = 0, failed = 0;

    for (const pDoc of profileSnap.docs) {
        const profile = { id: pDoc.id, ...pDoc.data() };
        const oppSnap = await db.collection('govOpportunities')
            .where('profileIds', 'array-contains', pDoc.id)
            .where('archived', '==', false)
            .get();

        for (const oDoc of oppSnap.docs) {
            scanned++;
            const opp = oDoc.data();
            const currentVersion = opp.fit && typeof opp.fit.scoringVersion === 'number' ? opp.fit.scoringVersion : 0;
            if (currentVersion >= SCORING_VERSION_GATED) { skipped++; continue; }

            if (dryRun) {
                console.log(`  [DRY-RUN] would rescore ${oDoc.id} (profile ${pDoc.id}, v${currentVersion} → v${SCORING_VERSION_GATED})`);
                rescored++;
                continue;
            }
            try {
                await scoreAndEnrich(opp, profile, { write: true, oppDocId: oDoc.id, allowSemantic: true });
                rescored++;
            } catch (err) {
                console.warn(`  Rescore failed for ${oDoc.id}:`, err.message);
                failed++;
            }
        }
    }

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Done — scanned=${scanned} rescored=${rescored} skipped=${skipped} failed=${failed}`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error('Sweep failed:', err.message);
    process.exit(1);
});
