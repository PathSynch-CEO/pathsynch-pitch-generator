'use strict';

/**
 * IRS Business Master File (BMF) seed script
 *
 * Downloads nonprofit org data from IRS BMF CSV exports into Firestore
 * `irsBmfCache` collection for use by the nonprofit financial enrichment service.
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=./pathconnect-442522-ec919d9337b8.json \
 *   node scripts/seed-irs-bmf.js --state GA --file data/eo_bmf_ga.csv
 *
 * CSV column headers (IRS format):
 *   EIN, NAME, ICO, STREET, CITY, STATE, ZIP, GROUP, SUBSECTION, AFFILIATION,
 *   CLASSIFICATION, RULING, DEDUCTIBILITY, FOUNDATION, ACTIVITY, ORGANIZATION,
 *   STATUS, TAX_PERIOD, ASSET_CD, INCOME_CD, FILING_REQ_CD, PF_FILING_REQ_CD,
 *   ACCT_PD, ASSET_AMT, INCOME_AMT, REVENUE_AMT, NTEE_CD, SORT_NAME
 */

const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');
const { parse } = require('csv-parse');

// ---------------------------------------------------------------------------
// Init Firebase
// ---------------------------------------------------------------------------
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

const BATCH_SIZE      = 500;   // Firestore batch-write hard limit
const WRITE_BATCH_MAX = 490;   // Stay comfortably under limit

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
}

const stateArg = getArg('--state');
const fileArg  = getArg('--file');

if (!stateArg || !fileArg) {
    console.error('Usage: node scripts/seed-irs-bmf.js --state GA --file data/eo_bmf_ga.csv');
    process.exit(1);
}

const stateCode = stateArg.toUpperCase().trim();
const csvPath   = path.resolve(__dirname, '..', fileArg);

if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Doc ID helper — lowercase name + state, spaces→underscores
// ---------------------------------------------------------------------------
function makeDocId(name, state) {
    return (name || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') +
           '_' + (state || '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
    console.log(`[IRS-BMF] Seeding ${stateCode} from ${csvPath}`);

    const rows      = [];
    const seededAt  = admin.firestore.Timestamp.now();

    // Parse CSV
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    console.log(`[IRS-BMF] Parsed ${rows.length} rows from CSV`);

    let seeded   = 0;
    let skipped  = 0;
    let batch    = db.batch();
    let batchOps = 0;

    for (const row of rows) {
        const ein  = (row.EIN  || '').trim();
        const name = (row.NAME || '').trim();

        if (!ein || !name) {
            skipped++;
            continue;
        }

        const docId  = makeDocId(name, stateCode);
        const docRef = db.collection('irsBmfCache').doc(docId);

        batch.set(docRef, {
            ein,
            name,
            city:              (row.CITY          || '').trim(),
            state:             (row.STATE         || '').trim(),
            zip:               (row.ZIP           || '').trim(),
            ruling_date:       (row.RULING        || '').trim(),
            ntee_code:         (row.NTEE_CD       || '').trim(),
            activity_code:     (row.ACTIVITY      || '').trim(),
            organization_type: (row.ORGANIZATION  || '').trim(),
            asset_amount:      parseAmountField(row.ASSET_AMT),
            income_amount:     parseAmountField(row.INCOME_AMT),
            revenue_amount:    parseAmountField(row.REVENUE_AMT),
            subsection:        (row.SUBSECTION    || '').trim(),
            foundation:        (row.FOUNDATION    || '').trim(),
            deductibility:     (row.DEDUCTIBILITY || '').trim(),
            tax_period:        (row.TAX_PERIOD    || '').trim(),
            seededAt
        }, { merge: true });

        batchOps++;
        seeded++;

        if (batchOps >= WRITE_BATCH_MAX) {
            await batch.commit();
            console.log(`[IRS-BMF] Seeded ${seeded} of ${rows.length} records for ${stateCode}`);
            batch    = db.batch();
            batchOps = 0;
        }
    }

    // Flush remaining
    if (batchOps > 0) {
        await batch.commit();
    }

    console.log(`[IRS-BMF] Done. Seeded ${seeded} records, skipped ${skipped} (missing EIN/name) for ${stateCode}`);
    process.exit(0);
}

function parseAmountField(val) {
    const n = parseInt((val || '').replace(/[^0-9-]/g, ''), 10);
    return isNaN(n) ? null : n;
}

seed().catch(err => {
    console.error('[IRS-BMF] Fatal error:', err);
    process.exit(1);
});
