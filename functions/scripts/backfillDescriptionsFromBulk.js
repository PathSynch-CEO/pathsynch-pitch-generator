'use strict';

/**
 * backfillDescriptionsFromBulk.js — Fill missing opportunity descriptions from
 * SAM.gov's public bulk CSV extract instead of the metered API.
 *
 * WHY THIS EXISTS
 * ---------------
 * SAM.gov's search API returns `description` as a URL, not text. samNormalizer
 * parks that link in sourceRefs[0].descriptionUrl and sets description: null —
 * and nothing ever fetches it, so the scorer has been grading title + NAICS +
 * agency with an empty statement of work.
 *
 * Fetching each descriptionUrl costs one API call against a ~10 requests/day
 * quota (PathSynch Labs' SAM.gov entity registration is still unvalidated, which
 * pins the key to the no-role tier). 555 descriptions at 10/day is 55+ days.
 *
 * The bulk extract has the same text, needs no API key, and does not touch the
 * quota. One streamed pass fills everything the file covers.
 *
 * COVERAGE CAVEAT
 * ---------------
 * Only the FY archive files carry data today. They contain *archived*
 * opportunities, so active ones are not covered — the daily active extract
 * (Contract Opportunities/datagov/ContractOpportunitiesFullCSV.csv) is
 * published but empty (685 bytes, header row only, as of 2026-08-05). If that
 * file ever returns to full size, add it to SOURCES below and active
 * opportunities become free too. Worth re-checking; it is a one-line change.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-...json \
 *   node scripts/backfillDescriptionsFromBulk.js [--dry-run] [--fy=2026,2025]
 */

const https = require('https');
const admin = require('firebase-admin');
const { parse } = require('csv-parse');

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fyArg  = (args.find(a => a.startsWith('--fy=')) || '').replace('--fy=', '') || '2026';
const FYS    = fyArg.split(',').map(s => s.trim()).filter(Boolean);

const BASE = 'https://sam.gov/api/prod/fileextractservices/v1/api/download/';
const SOURCES = FYS.map(fy => ({
    label: `FY${fy}`,
    url:   `${BASE}Contract%20Opportunities/Archived%20Data/FY${fy}_archived_opportunities.csv?privacy=Public`,
}));

// Anything shorter than this is a stub ("Description", a bare link) — not worth writing.
const MIN_DESCRIPTION_CHARS = 40;

function preflight() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Preflight failed: GOOGLE_APPLICATION_CREDENTIALS is not set (needed for Firestore access).');
        process.exit(2);
    }
}

/** Opportunities missing a description, keyed by SAM noticeId. */
async function loadTargets(db) {
    const snap = await db.collection('govOpportunities').get();
    const byNoticeId = new Map();
    let alreadyHave = 0, noNoticeId = 0;

    snap.forEach((doc) => {
        const d = doc.data();
        if (d.description && String(d.description).trim().length > 0) { alreadyHave++; return; }
        const noticeId = d.sourceRefs && d.sourceRefs[0] && d.sourceRefs[0].sourceExternalId;
        if (!noticeId) { noNoticeId++; return; }
        byNoticeId.set(String(noticeId).toLowerCase(), doc.id);
    });

    console.log(`Scanned ${snap.size} opportunities — ${byNoticeId.size} need a description, `
        + `${alreadyHave} already have one, ${noNoticeId} have no noticeId.`);
    return byNoticeId;
}

/**
 * Stream one CSV and collect descriptions for the notice IDs we still want.
 * Streaming matters: these files run 700MB–1.2GB and must never be buffered.
 */
function harvest(source, wanted, found) {
    return new Promise((resolve, reject) => {
        const parser = parse({
            columns:          true,
            relax_quotes:     true,
            relax_column_count: true,
            skip_empty_lines: true,
        });

        let rows = 0, matched = 0;

        parser.on('data', (row) => {
            rows++;
            const noticeId = String(row.NoticeId || '').toLowerCase();
            if (!noticeId || !wanted.has(noticeId) || found.has(noticeId)) return;

            const description = String(row.Description || '').trim();
            if (description.length < MIN_DESCRIPTION_CHARS) return;

            found.set(noticeId, description);
            matched++;
        });
        parser.on('error', reject);
        parser.on('end', () => {
            console.log(`  ${source.label}: ${rows.toLocaleString()} rows scanned, ${matched} descriptions harvested.`);
            resolve();
        });

        const get = (url, depth) => {
            if (depth > 5) return reject(new Error('too many redirects'));
            https.get(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return get(res.headers.location, depth + 1);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${source.label}`));
                res.pipe(parser);
            }).on('error', reject);
        };
        get(source.url, 0);
    });
}

async function writeDescriptions(db, found, targets) {
    let written = 0;
    let batch = db.batch();
    let inBatch = 0;

    for (const [noticeId, description] of found) {
        const docId = targets.get(noticeId);
        if (!docId) continue;

        batch.update(db.collection('govOpportunities').doc(docId), {
            description,
            descriptionSource:      'sam_bulk_extract',
            descriptionFetchedAt:   admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:              admin.firestore.FieldValue.serverTimestamp(),
        });
        written++;
        inBatch++;

        if (inBatch >= 400) {          // Firestore caps a batch at 500 writes.
            await batch.commit();
            batch = db.batch();
            inBatch = 0;
        }
    }
    if (inBatch > 0) await batch.commit();
    return written;
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

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Backfilling descriptions from ${SOURCES.map(s => s.label).join(', ')}\n`);

    const targets = await loadTargets(db);
    if (targets.size === 0) {
        console.log('Nothing to backfill.');
        return;
    }

    const found = new Map();
    for (const source of SOURCES) {
        console.log(`Streaming ${source.label}...`);
        await harvest(source, targets, found);
    }

    const lengths = [...found.values()].map(d => d.length).sort((a, b) => a - b);
    const coverage = (found.size / targets.size * 100).toFixed(1);
    console.log(`\nHarvested ${found.size} of ${targets.size} wanted descriptions (${coverage}%).`);
    if (lengths.length) {
        console.log(`Length — min=${lengths[0]} median=${lengths[Math.floor(lengths.length / 2)]} max=${lengths[lengths.length - 1]}`);
    }

    if (dryRun) {
        console.log('\n[DRY-RUN] No writes performed.');
        return;
    }

    const written = await writeDescriptions(db, found, targets);
    console.log(`\nDone — wrote descriptions to ${written} opportunities.`);
    console.log('Opportunities left without a description are not in these archives '
        + '(still active, or archived in another fiscal year).');
}

main().then(() => process.exit(0)).catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
});
