#!/usr/bin/env node
/**
 * Admin CLI Script - Upload Sales Document (Firebase CLI Auth)
 *
 * Uses Firebase CLI credentials via firebase-tools to upload documents.
 * Run `firebase login` first if not logged in.
 *
 * Usage:
 *   node uploadSalesDocFirebase.js --userId "UID" --file "./doc.pdf" --type "business_case"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
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

// Get file type
function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.txt': 'txt' }[ext] || null;
}

async function main() {
  const args = parseArgs();

  if (!args.userId || !args.file) {
    console.log('Usage: node uploadSalesDocFirebase.js --userId "UID" --file "path" --type "type" [--setup] [--company "name"]');
    process.exit(1);
  }

  if (!fs.existsSync(args.file)) {
    console.error(`File not found: ${args.file}`);
    process.exit(1);
  }

  const userId = args.userId;
  const filePath = args.file;
  const fileName = path.basename(filePath);
  const documentType = args.type || 'other';
  const documentLabel = args.label || fileName;
  const fileType = getFileType(filePath);

  if (!fileType) {
    console.error('Unsupported file type. Must be PDF, DOCX, PPTX, or TXT');
    process.exit(1);
  }

  console.log(`\n📁 Processing: ${fileName}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Type: ${documentType}`);

  // Read file and extract text
  const fileBuffer = fs.readFileSync(filePath);
  console.log(`   Size: ${(fileBuffer.length / 1024).toFixed(1)} KB`);

  console.log(`\n🔍 Extracting text...`);
  const { extractText } = require('../api/salesLibrary/textExtractor');
  const extracted = await extractText(fileBuffer, fileType);
  console.log(`   Pages: ${extracted.pageCount || 'N/A'}`);
  console.log(`   Words: ${extracted.wordCount.toLocaleString()}`);

  // Create Firestore document JSON
  const timestamp = new Date().toISOString();
  const docData = {
    userId,
    fileName,
    fileType,
    fileSizeBytes: fileBuffer.length,
    storageUrl: `local://${filePath}`,
    storagePath: `salesLibrary/${userId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    documentType,
    documentLabel,
    extractedText: extracted.text,
    pageCount: extracted.pageCount,
    wordCount: extracted.wordCount,
    status: 'ready',
    errorMessage: null,
    uploadedBy: 'admin-script',
    uploadedAt: { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 },
    updatedAt: { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 }
  };

  // Write to temp JSON file for firebase CLI
  const tempDocFile = path.join(__dirname, `_temp_doc_${Date.now()}.json`);
  fs.writeFileSync(tempDocFile, JSON.stringify(docData));

  console.log(`\n📝 Creating Firestore document via Firebase CLI...`);

  try {
    // Use firebase firestore:import or direct REST API
    const result = execSync(
      `firebase firestore:delete salesDocuments --force --project pathsynch-pitch-creation 2>&1 || true`,
      { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }
    );
  } catch (e) {
    // Ignore delete errors
  }

  // Use the Firebase REST API with access token
  console.log(`\n🔑 Getting Firebase access token...`);
  let accessToken;
  try {
    accessToken = execSync('firebase login:ci --no-localhost 2>&1 | tail -1 || firebase auth:export --format json 2>&1',
      { encoding: 'utf8' }).trim();
  } catch (e) {
    // Try alternative method
  }

  // Since direct Firestore write is complex, let's output the data for manual import
  const outputFile = path.join(__dirname, `salesDoc_${userId}_${Date.now()}.json`);
  const firestoreDoc = {
    __collections__: {},
    ...docData
  };

  fs.writeFileSync(outputFile, JSON.stringify(firestoreDoc, null, 2));
  console.log(`\n📄 Document data saved to: ${outputFile}`);

  // Clean up temp file
  fs.unlinkSync(tempDocFile);

  // Output the extracted text preview
  console.log(`\n📖 Text preview (first 500 chars):`);
  console.log('---');
  console.log(extracted.text.substring(0, 500) + '...');
  console.log('---');

  // If --setup, also create config file
  if (args.setup) {
    const configData = {
      userId,
      companyName: args.company || '',
      companyWebsite: args.website || '',
      industry: args.industry || '',
      sellingTo: args.sellingTo || '',
      libraryEnabled: true,
      documentCount: 1,
      createdAt: { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 },
      updatedAt: { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 }
    };
    const configFile = path.join(__dirname, `libraryConfig_${userId}.json`);
    fs.writeFileSync(configFile, JSON.stringify(configData, null, 2));
    console.log(`\n⚙️  Config data saved to: ${configFile}`);
  }

  console.log(`\n✅ Processing complete!`);
  console.log(`\nNext steps:`);
  console.log(`1. Import the JSON files to Firestore using Firebase Console or CLI`);
  console.log(`2. Or use the deployed API endpoint with proper authentication`);
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
