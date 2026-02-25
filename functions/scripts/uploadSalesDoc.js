#!/usr/bin/env node
/**
 * Admin CLI Script - Upload Sales Document
 *
 * Uploads a document to a user's sales library for the custom pitch generation feature.
 *
 * Usage:
 *   node uploadSalesDoc.js --userId "USER_FIREBASE_UID" --file "./document.pdf" --type "business_case" --label "Business Case Document"
 *
 * Options:
 *   --userId    Required. Firebase UID of the target user
 *   --file      Required. Path to the file to upload
 *   --type      Optional. Document type (business_case, pitch_deck, conference_deck, one_pager, case_study, sales_process, other)
 *   --label     Optional. Human-readable label for the document
 *   --setup     Optional. Also create/update customerLibraryConfig
 *   --company   Company name (used with --setup)
 *   --website   Company website (used with --setup)
 *   --industry  Company industry (used with --setup)
 *   --sellingTo Target market description (used with --setup)
 *
 * Examples:
 *   node uploadSalesDoc.js --userId "abc123" --file "./pitch.pdf" --type "pitch_deck"
 *   node uploadSalesDoc.js --userId "abc123" --file "./case.pdf" --type "business_case" --label "American Airlines Business Case"
 *   node uploadSalesDoc.js --userId "abc123" --file "./case.pdf" --setup --company "Countifi" --website "https://countifi.com" --industry "AI Inventory Management"
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Parse command line arguments
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

// Validate arguments
function validateArgs(args) {
  const errors = [];

  if (!args.userId) {
    errors.push('--userId is required');
  }

  if (!args.file) {
    errors.push('--file is required');
  } else if (!fs.existsSync(args.file)) {
    errors.push(`File not found: ${args.file}`);
  }

  const validTypes = ['business_case', 'pitch_deck', 'conference_deck', 'one_pager', 'case_study', 'sales_process', 'other'];
  if (args.type && !validTypes.includes(args.type)) {
    errors.push(`Invalid document type. Must be one of: ${validTypes.join(', ')}`);
  }

  return errors;
}

// Get file type from extension
function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mapping = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.pptx': 'pptx',
    '.txt': 'txt'
  };
  return mapping[ext] || null;
}

// Main upload function
async function uploadDocument(args) {
  // Initialize Firebase Admin (uses default credentials)
  if (!admin.apps.length) {
    admin.initializeApp({
      storageBucket: 'pathsynch-pitch-creation.appspot.com'
    });
  }

  const db = admin.firestore();
  const storage = admin.storage();

  const userId = args.userId;
  const filePath = args.file;
  const documentType = args.type || 'other';
  const fileName = path.basename(filePath);
  const documentLabel = args.label || fileName;

  // Validate file type
  const fileType = getFileType(filePath);
  if (!fileType) {
    throw new Error(`Unsupported file type. Must be PDF, DOCX, PPTX, or TXT`);
  }

  console.log(`\n📁 Uploading: ${fileName}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Type: ${documentType}`);
  console.log(`   Label: ${documentLabel}`);

  // Read file
  const fileBuffer = fs.readFileSync(filePath);
  const fileSizeBytes = fileBuffer.length;
  console.log(`   Size: ${(fileSizeBytes / 1024).toFixed(1)} KB`);

  // Import text extractor
  const { extractText } = require('../api/salesLibrary/textExtractor');
  const { validateExtractedText } = require('../api/salesLibrary/validators');

  // Extract text
  console.log(`\n🔍 Extracting text...`);
  const extractedData = await extractText(fileBuffer, fileType);
  console.log(`   Pages: ${extractedData.pageCount || 'N/A'}`);
  console.log(`   Words: ${extractedData.wordCount.toLocaleString()}`);

  // Validate extracted text
  const textValidation = validateExtractedText(extractedData.text);
  if (!textValidation.valid) {
    throw new Error(`Text validation failed: ${textValidation.error}`);
  }

  // Upload to Cloud Storage
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `salesLibrary/${userId}/${timestamp}_${sanitizedFileName}`;

  console.log(`\n☁️  Uploading to Cloud Storage...`);
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);

  await file.save(fileBuffer, {
    metadata: {
      contentType: getMimeType(fileType),
      metadata: {
        originalName: fileName,
        userId: userId
      }
    }
  });
  console.log(`   Path: ${storagePath}`);

  // Create Firestore document
  console.log(`\n📝 Creating Firestore document...`);
  const docRef = await db.collection('salesDocuments').add({
    userId,
    fileName,
    fileType,
    fileSizeBytes,
    storageUrl: `gs://${bucket.name}/${storagePath}`,
    storagePath,
    documentType,
    documentLabel,
    extractedText: extractedData.text,
    pageCount: extractedData.pageCount,
    wordCount: extractedData.wordCount,
    status: 'ready',
    errorMessage: null,
    uploadedBy: 'admin-script',
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`   Document ID: ${docRef.id}`);

  // Handle --setup flag for library config
  if (args.setup) {
    console.log(`\n⚙️  Setting up library config...`);
    const configRef = db.collection('customerLibraryConfig').doc(userId);
    const existingConfig = await configRef.get();

    const configData = {
      userId,
      companyName: args.company || '',
      companyWebsite: args.website || '',
      industry: args.industry || '',
      sellingTo: args.sellingTo || '',
      libraryEnabled: true,
      documentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!existingConfig.exists) {
      configData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      configData.documentCount = 1;
      await configRef.set(configData);
      console.log(`   Created new config`);
    } else {
      await configRef.update(configData);
      console.log(`   Updated existing config`);
    }
  } else {
    // Just increment document count if config exists
    const configRef = db.collection('customerLibraryConfig').doc(userId);
    const existingConfig = await configRef.get();
    if (existingConfig.exists) {
      await configRef.update({
        documentCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  console.log(`\n✅ Upload complete!`);
  console.log(`   Document ID: ${docRef.id}`);
  console.log(`   Status: ready`);

  return docRef.id;
}

// Get MIME type for file type
function getMimeType(fileType) {
  const mimeTypes = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain'
  };
  return mimeTypes[fileType] || 'application/octet-stream';
}

// Print usage
function printUsage() {
  console.log(`
Sales Library Document Upload Script

Usage:
  node uploadSalesDoc.js --userId <uid> --file <path> [options]

Required:
  --userId    Firebase UID of the target user
  --file      Path to the file to upload

Options:
  --type      Document type: business_case, pitch_deck, conference_deck,
              one_pager, case_study, sales_process, other (default: other)
  --label     Human-readable label (default: filename)

Library Setup (use with first upload):
  --setup     Create/update customerLibraryConfig
  --company   Company name
  --website   Company website URL
  --industry  Company industry
  --sellingTo Target market description

Examples:
  node uploadSalesDoc.js --userId "abc123" --file "./pitch.pdf" --type "pitch_deck"

  node uploadSalesDoc.js \\
    --userId "abc123" \\
    --file "./Business_Case.pdf" \\
    --type "business_case" \\
    --label "American Airlines Business Case" \\
    --setup \\
    --company "Countifi" \\
    --website "https://countifi.com" \\
    --industry "AI Inventory Management" \\
    --sellingTo "Airlines, Hospitals"
`);
}

// Main
async function main() {
  const args = parseArgs();

  if (args.help || Object.keys(args).length === 0) {
    printUsage();
    process.exit(0);
  }

  const errors = validateArgs(args);
  if (errors.length > 0) {
    console.error('\n❌ Validation errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nRun with --help for usage information.');
    process.exit(1);
  }

  try {
    await uploadDocument(args);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
