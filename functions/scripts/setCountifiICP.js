#!/usr/bin/env node
/**
 * One-time script: Set ICP config for Countifi (David Hailey)
 * UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2
 *
 * Uses Firebase CLI refresh token to get an access token,
 * then writes to Firestore via REST API.
 *
 * Usage: node scripts/setCountifiICP.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT_ID = 'pathsynch-pitch-creation';
const USER_ID = 'vkSfmPqfNrWYo7ZzelTwPgtC8yw2';
const DOC_PATH = `customerLibraryConfig/${USER_ID}`;

// Firebase CLI OAuth client (public, used by all Firebase CLI installations)
const FIREBASE_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ICP data from the Countifi pilot strategy doc
const ICP_FIELDS = {
  customTargetTitles: [
    { title: 'VP of Supply Chain', priority: 1, notes: 'Key procurement decision maker' },
    { title: 'VP of Onboard Services', priority: 1, notes: 'Manages catering and inflight product' },
    { title: 'VP of IT', priority: 2, notes: 'Required for software implementation' },
    { title: 'VP of Operations', priority: 2, notes: '' },
    { title: 'Chief Commercial Officer', priority: 3, notes: '' },
    { title: 'CEO', priority: 3, notes: 'Low priority for cold outreach' }
  ],
  qualificationCriteria: [
    {
      criteriaName: 'Inventory Spend',
      criteriaDescription: 'Annual food and beverage services spend',
      dataSource: 'SEC 10-K, P&L statement',
      importance: 'critical'
    },
    {
      criteriaName: 'Inventory Write-offs',
      criteriaDescription: 'How much they lose to waste',
      dataSource: 'SEC 10-K, MD&A section',
      importance: 'critical'
    },
    {
      criteriaName: 'Inventory Waste Percentage',
      criteriaDescription: 'Leakage rate',
      dataSource: 'Industry benchmarks, internal audits',
      importance: 'important'
    },
    {
      criteriaName: 'Sustainability Goals',
      criteriaDescription: 'Public commitment to reducing food waste',
      dataSource: 'ESG reports, press releases',
      importance: 'important'
    }
  ],
  roiFramework: {
    leakageAssumption: '15% inventory leakage (conservative)',
    savingsRange: '2-5% cost reduction',
    financialLineItems: ['Food and Beverage Services', 'Selling Expenses'],
    dataSourceInstructions: 'Pull from SEC 10-K, MD&A section. Look for inventory, food/bev spend, write-offs.'
  }
};

function getRefreshToken() {
  const configPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    '.config', 'configstore', 'firebase-tools.json'
  );
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.tokens?.refresh_token || config.user?.tokens?.refresh_token;
}

function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getAccessToken(refreshToken) {
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: FIREBASE_CLIENT_ID,
    client_secret: FIREBASE_CLIENT_SECRET
  }).toString();

  const result = await httpRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (result.body.access_token) {
    return result.body.access_token;
  }
  throw new Error('Token exchange failed: ' + JSON.stringify(result.body));
}

// Convert JS values to Firestore REST API value format
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function readDocument(accessToken) {
  const result = await httpRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOC_PATH}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return result;
}

async function updateDocument(accessToken, fieldsToUpdate) {
  // Build the update mask (only update our fields)
  const updateMask = Object.keys(fieldsToUpdate).map(f => `updateMask.fieldPaths=${f}`).join('&');

  // Build Firestore fields
  const firestoreFields = {};
  for (const [key, val] of Object.entries(fieldsToUpdate)) {
    firestoreFields[key] = toFirestoreValue(val);
  }

  // Add updatedAt timestamp
  firestoreFields.updatedAt = { timestampValue: new Date().toISOString() };
  const updateMaskFull = updateMask + '&updateMask.fieldPaths=updatedAt';

  const body = JSON.stringify({ fields: firestoreFields });

  const result = await httpRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOC_PATH}?${updateMaskFull}`,
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  return result;
}

async function main() {
  console.log('=== Countifi ICP Config Writer ===\n');

  // Step 1: Get access token
  console.log('1. Getting access token from Firebase CLI credentials...');
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    console.error('   ERROR: No Firebase CLI refresh token found. Run: firebase login');
    process.exit(1);
  }
  const accessToken = await getAccessToken(refreshToken);
  console.log('   Access token obtained.\n');

  // Step 2: Read existing document
  console.log(`2. Reading existing config for ${USER_ID}...`);
  const existing = await readDocument(accessToken);
  if (existing.status === 200) {
    const fields = existing.body.fields || {};
    console.log('   Found existing config:');
    console.log(`     companyName: ${fields.companyName?.stringValue || '(not set)'}`);
    console.log(`     libraryEnabled: ${fields.libraryEnabled?.booleanValue ?? '(not set)'}`);
    console.log(`     has qualificationCriteria: ${!!fields.qualificationCriteria}`);
    console.log(`     has customTargetTitles: ${!!fields.customTargetTitles}`);
    console.log(`     has roiFramework: ${!!fields.roiFramework}`);
  } else if (existing.status === 404) {
    console.log('   No existing config found. Will create new document.');
  } else {
    console.error('   ERROR reading document:', JSON.stringify(existing.body));
    process.exit(1);
  }
  console.log('');

  // Step 3: Write ICP fields
  console.log('3. Writing ICP fields (customTargetTitles, qualificationCriteria, roiFramework)...');
  const result = await updateDocument(accessToken, ICP_FIELDS);

  if (result.status === 200) {
    console.log('   SUCCESS: ICP fields written to Firestore.\n');

    // Step 4: Verify
    console.log('4. Verifying write...');
    const verify = await readDocument(accessToken);
    if (verify.status === 200) {
      const fields = verify.body.fields || {};

      // Check customTargetTitles
      const titles = fields.customTargetTitles?.arrayValue?.values || [];
      console.log(`   customTargetTitles: ${titles.length} entries`);
      titles.forEach(t => {
        const m = t.mapValue?.fields || {};
        console.log(`     - ${m.title?.stringValue} (priority: ${m.priority?.integerValue})`);
      });

      // Check qualificationCriteria
      const criteria = fields.qualificationCriteria?.arrayValue?.values || [];
      console.log(`   qualificationCriteria: ${criteria.length} entries`);
      criteria.forEach(c => {
        const m = c.mapValue?.fields || {};
        console.log(`     - ${m.criteriaName?.stringValue} [${m.importance?.stringValue}]`);
      });

      // Check roiFramework
      const roi = fields.roiFramework?.mapValue?.fields;
      if (roi) {
        console.log('   roiFramework:');
        console.log(`     leakageAssumption: ${roi.leakageAssumption?.stringValue}`);
        console.log(`     savingsRange: ${roi.savingsRange?.stringValue}`);
        const lineItems = roi.financialLineItems?.arrayValue?.values?.map(v => v.stringValue) || [];
        console.log(`     financialLineItems: ${lineItems.join(', ')}`);
        console.log(`     dataSourceInstructions: ${roi.dataSourceInstructions?.stringValue}`);
      }

      console.log('\n   All ICP fields verified in Firestore.');
    }
  } else {
    console.error('   FAILED:', JSON.stringify(result.body, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
