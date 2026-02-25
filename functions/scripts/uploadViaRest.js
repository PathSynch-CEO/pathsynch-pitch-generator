#!/usr/bin/env node
/**
 * Upload Sales Document via Firestore REST API
 * Uses Firebase CLI credentials
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.txt': 'txt' }[ext];
}

// Get access token from Firebase CLI config
function getAccessToken() {
  try {
    // Read Firebase CLI config file
    const configPath = path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'configstore', 'firebase-tools.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.tokens && config.tokens.access_token) {
        return config.tokens.access_token;
      }
    }
    // Try alternative path for Windows
    const altPath = path.join(process.env.APPDATA || '', 'firebase', 'firebase-tools.json');
    if (fs.existsSync(altPath)) {
      const config = JSON.parse(fs.readFileSync(altPath, 'utf8'));
      if (config.tokens && config.tokens.access_token) {
        return config.tokens.access_token;
      }
    }
  } catch (e) {
    console.error('Could not read Firebase config:', e.message);
  }
  return null;
}

// Make Firestore REST API request
function firestoreRequest(method, path, data, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: `/v1/projects/pathsynch-pitch-creation/databases/(default)/documents${path}`,
      method: method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body || '{}'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Convert JS object to Firestore document format
function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (value && value._seconds !== undefined) {
    return { timestampValue: new Date(value._seconds * 1000).toISOString() };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFirestoreValue(value);
  }
  return { fields };
}

async function main() {
  const args = parseArgs();

  if (!args.userId || !args.file) {
    console.log(`
Usage: node uploadViaRest.js --userId "UID" --file "path" [options]

Options:
  --type      Document type (business_case, pitch_deck, etc.)
  --label     Human-readable label
  --setup     Also create library config
  --company   Company name (with --setup)
  --website   Company website (with --setup)
  --industry  Industry (with --setup)
  --sellingTo Target market (with --setup)
`);
    process.exit(1);
  }

  // Get access token
  console.log('\n🔑 Getting Firebase access token...');
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.error('❌ Could not get access token. Please run: firebase login --reauth');
    process.exit(1);
  }
  console.log('   Token found!');

  const userId = args.userId;
  const filePath = args.file;
  const fileName = path.basename(filePath);
  const fileType = getFileType(filePath);
  const documentType = args.type || 'other';
  const documentLabel = args.label || fileName;

  if (!fileType) {
    console.error('❌ Unsupported file type');
    process.exit(1);
  }

  console.log(`\n📁 Processing: ${fileName}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Type: ${documentType}`);

  // Read and extract text
  const fileBuffer = fs.readFileSync(filePath);
  console.log(`   Size: ${(fileBuffer.length / 1024).toFixed(1)} KB`);

  console.log('\n🔍 Extracting text...');
  const { extractText } = require('../api/salesLibrary/textExtractor');
  const extracted = await extractText(fileBuffer, fileType);
  console.log(`   Pages: ${extracted.pageCount || 'N/A'}`);
  console.log(`   Words: ${extracted.wordCount.toLocaleString()}`);

  // Create document
  const now = { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 };
  const docData = {
    userId,
    fileName,
    fileType,
    fileSizeBytes: fileBuffer.length,
    storageUrl: '',
    storagePath: `salesLibrary/${userId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    documentType,
    documentLabel,
    extractedText: extracted.text,
    pageCount: extracted.pageCount || 0,
    wordCount: extracted.wordCount,
    status: 'ready',
    errorMessage: null,
    uploadedBy: 'admin-script',
    uploadedAt: now,
    updatedAt: now
  };

  console.log('\n📝 Creating Firestore document...');
  try {
    const result = await firestoreRequest(
      'POST',
      '/salesDocuments',
      toFirestoreDoc(docData),
      accessToken
    );
    const docId = result.name.split('/').pop();
    console.log(`   Document ID: ${docId}`);
  } catch (err) {
    console.error('   Error:', err.message);
    process.exit(1);
  }

  // Create/update config if --setup
  if (args.setup) {
    console.log('\n⚙️  Setting up library config...');
    const configData = {
      userId,
      companyName: args.company || '',
      companyWebsite: args.website || '',
      industry: args.industry || '',
      sellingTo: args.sellingTo || '',
      libraryEnabled: true,
      documentCount: 1,
      createdAt: now,
      updatedAt: now
    };

    try {
      await firestoreRequest(
        'PATCH',
        `/customerLibraryConfig/${userId}?updateMask.fieldPaths=userId&updateMask.fieldPaths=companyName&updateMask.fieldPaths=companyWebsite&updateMask.fieldPaths=industry&updateMask.fieldPaths=sellingTo&updateMask.fieldPaths=libraryEnabled&updateMask.fieldPaths=documentCount&updateMask.fieldPaths=updatedAt`,
        toFirestoreDoc(configData),
        accessToken
      );
      console.log('   Config created/updated!');
    } catch (err) {
      // Try create instead
      try {
        await firestoreRequest(
          'POST',
          `/customerLibraryConfig?documentId=${userId}`,
          toFirestoreDoc(configData),
          accessToken
        );
        console.log('   Config created!');
      } catch (err2) {
        console.error('   Config error:', err2.message);
      }
    }
  }

  console.log('\n✅ Upload complete!');
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
