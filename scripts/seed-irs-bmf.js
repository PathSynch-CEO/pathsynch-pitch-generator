/**
 * seed-irs-bmf.js
 *
 * Downloads/reads IRS EO BMF CSV and seeds Firestore irsBmfCache collection.
 * Uses csv-parse (NOT line.split) — org names contain commas.
 *
 * Usage:
 *   node scripts/seed-irs-bmf.js [--state GA] [--file ./data/eo_ga.csv]
 *
 * Download BMF CSV from:
 *   https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
 *   Choose the state-specific CSV (e.g. eo_ga.csv for Georgia)
 *   Place it in pathsynch-pitch-generator/data/
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const admin = require('firebase-admin');

// Parse CLI args
const args = process.argv.slice(2);
const stateIdx = args.indexOf('--state');
const fileIdx = args.indexOf('--file');
const targetState = stateIdx >= 0 ? args[stateIdx + 1].toUpperCase() : 'GA';
const defaultFile = path.join(__dirname, '..', 'data', 'eo_' + targetState.toLowerCase() + '.csv');
const csvFile = fileIdx >= 0 ? args[fileIdx + 1] : defaultFile;

// Initialize Firebase Admin
const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? require(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : null;

if (serviceAccount) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  // Use application default credentials (gcloud auth)
  admin.initializeApp({ projectId: 'pathsynch-pitch-creation' });
}

const db = admin.firestore();

function normalizeForCache(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// IRS BMF column mapping (actual column names from IRS EO BMF CSV)
// Columns: EIN, NAME, ICO, STREET, CITY, STATE, ZIP, GROUP, SUBSECTION, AFFILIATION,
//          CLASSIFICATION, RULING, DEDUCTIBILITY, FOUNDATION, ACTIVITY, ORGANIZATION,
//          STATUS, TAX_PERIOD, ASSET_CD, INCOME_CD, FILING_REQ_CD, PF_FILING_REQ_CD,
//          ACCT_PD, ASSET_AMT, INCOME_AMT, REVENUE_AMT, NTEE_CD, SORT_NAME
function mapRecord(record) {
  return {
    ein: (record.EIN || record.ein || '').trim(),
    name: (record.NAME || record.name || '').trim(),
    normalizedName: normalizeForCache((record.NAME || record.name || '').trim()),
    city: (record.CITY || record.city || '').trim(),
    state: (record.STATE || record.state || '').trim().toUpperCase(),
    nteeCode: (record.NTEE_CD || record.ntee_cd || '').trim(),
    nteeDescription: nteeToDescription((record.NTEE_CD || record.ntee_cd || '').trim()),
    rulingDate: (record.RULING || record.ruling || '').trim(),
    assetAmount: safeNum(record.ASSET_AMT || record.asset_amt),
    incomeAmount: safeNum(record.INCOME_AMT || record.income_amt),
    revenueAmount: safeNum(record.REVENUE_AMT || record.revenue_amt),
    seedDate: new Date().toISOString()
  };
}

function safeNum(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

var NTEE_CATEGORIES = {
  'A': 'Arts, Culture & Humanities', 'B': 'Education',
  'C': 'Environment', 'D': 'Animal-Related',
  'E': 'Health – General & Rehabilitative', 'F': 'Mental Health & Crisis Intervention',
  'G': 'Diseases, Disorders & Medical Disciplines', 'H': 'Medical Research',
  'I': 'Crime & Legal-Related', 'J': 'Employment',
  'K': 'Food, Agriculture & Nutrition', 'L': 'Housing & Shelter',
  'M': 'Public Safety, Disaster Preparedness & Relief', 'N': 'Recreation & Sports',
  'O': 'Youth Development', 'P': 'Human Services – Multipurpose & Other',
  'Q': 'International, Foreign Affairs & National Security',
  'R': 'Civil Rights, Social Action & Advocacy',
  'S': 'Community Improvement & Capacity Building',
  'T': 'Philanthropy, Voluntarism & Grantmaking Foundations',
  'U': 'Science & Technology', 'V': 'Social Science',
  'W': 'Public & Societal Benefit – Multipurpose & Other',
  'X': 'Religion-Related', 'Y': 'Mutual & Membership Benefit', 'Z': 'Unknown'
};
function nteeToDescription(nteeCode) {
  if (!nteeCode) return 'Nonprofit Organization';
  var letter = (nteeCode || '').toUpperCase().charAt(0);
  return NTEE_CATEGORIES[letter] || 'Nonprofit Organization';
}

async function writeBatch(records) {
  const BATCH_SIZE = 500;
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(function(rec) {
      if (!rec.ein) return;
      const docId = rec.ein + '_' + normalizeForCache(rec.name).substring(0, 20);
      const ref = db.collection('irsBmfCache').doc(docId);
      batch.set(ref, rec, { merge: false });
    });
    await batch.commit();
    written += chunk.length;
    console.log(`  Written ${written} / ${records.length} records...`);
  }
  return written;
}

async function main() {
  if (!fs.existsSync(csvFile)) {
    console.error(`CSV file not found: ${csvFile}`);
    console.error('Download the IRS EO BMF CSV from:');
    console.error('  https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf');
    console.error(`  Place it at: ${csvFile}`);
    process.exit(1);
  }

  console.log(`Reading IRS BMF CSV: ${csvFile}`);
  console.log(`Target state: ${targetState}`);

  const records = [];
  let lineCount = 0;
  let skipped = 0;

  await new Promise(function(resolve, reject) {
    fs.createReadStream(csvFile)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', function(row) {
        lineCount++;
        var stateVal = (row.STATE || row.state || '').trim().toUpperCase();
        if (stateVal !== targetState) { skipped++; return; }
        var rec = mapRecord(row);
        if (rec.ein && rec.name) records.push(rec);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`\nCSV lines processed: ${lineCount}`);
  console.log(`Skipped (wrong state): ${skipped}`);
  console.log(`Records to write: ${records.length}`);

  if (records.length === 0) {
    console.warn('No records found for state:', targetState);
    console.warn('Check that STATE column exists and matches:', targetState);
    process.exit(0);
  }

  console.log('\nWriting to Firestore irsBmfCache...');
  const written = await writeBatch(records);
  console.log(`\nDone. Wrote ${written} records to irsBmfCache.`);
  process.exit(0);
}

main().catch(function(e) {
  console.error('Seed script failed:', e.message);
  process.exit(1);
});
