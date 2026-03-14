/**
 * Sales Library API Handlers
 * Handles document upload, listing, retrieval, and deletion for custom sales libraries
 */

const admin = require('firebase-admin');
const Busboy = require('busboy');
const { extractText } = require('./textExtractor');
const {
  validateUploadRequest,
  validateExtractedText,
  DOCUMENT_TYPES,
  MAX_FILE_SIZE_BYTES
} = require('./validators');

const db = admin.firestore();
const storage = admin.storage();

/**
 * Parses multipart form data from request
 * @param {Object} req - Express request object
 * @returns {Promise<{ fileBuffer: Buffer, fileName: string, mimeType: string, fields: Object }>}
 */
function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1
      }
    });

    const fields = {};
    let fileBuffer = null;
    let fileName = null;
    let mimeType = null;
    let fileTruncated = false;

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      fileName = info.filename;
      mimeType = info.mimeType;
      const chunks = [];

      file.on('data', chunk => chunks.push(chunk));
      file.on('limit', () => {
        fileTruncated = true;
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      if (fileTruncated) {
        reject(new Error(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`));
        return;
      }
      resolve({ fileBuffer, fileName, mimeType, fields });
    });

    busboy.on('error', reject);

    // Handle raw body if already parsed (Cloud Functions behavior)
    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

/**
 * Upload a document to the sales library
 * POST /sales-library/upload
 */
async function uploadDocument(req, res, targetUserId = null) {
  const userId = targetUserId || req.userId;

  if (!userId || userId === 'anonymous') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  try {
    // Parse multipart form
    const { fileBuffer, fileName, mimeType, fields } = await parseMultipartForm(req);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    // Get current document count
    const existingDocs = await db.collection('salesDocuments')
      .where('userId', '==', userId)
      .count()
      .get();
    const currentDocCount = existingDocs.data().count;

    // Validate upload request
    const validation = validateUploadRequest({
      mimeType,
      fileName,
      fileSize: fileBuffer.length,
      documentType: fields.documentType,
      currentDocCount
    });

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors
      });
    }

    // Create initial Firestore document with processing status
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `salesLibrary/${userId}/${timestamp}_${sanitizedFileName}`;

    const docRef = await db.collection('salesDocuments').add({
      userId,
      fileName: fileName,
      fileType: validation.fileType,
      fileSizeBytes: fileBuffer.length,
      storageUrl: `gs://${storage.bucket().name}/${storagePath}`,
      storagePath,
      documentType: fields.documentType || 'other',
      documentLabel: fields.documentLabel || fileName,
      extractedText: '',
      pageCount: null,
      wordCount: 0,
      status: 'processing',
      errorMessage: null,
      uploadedBy: req.userId, // Original uploader (may differ from userId for admin uploads)
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Upload file to Cloud Storage
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          originalName: fileName,
          userId: userId,
          documentId: docRef.id
        }
      }
    });

    // Extract text from document
    let extractedData;
    try {
      extractedData = await extractText(fileBuffer, validation.fileType);
    } catch (extractError) {
      // Update document with error status
      await docRef.update({
        status: 'error',
        errorMessage: extractError.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(422).json({
        success: false,
        error: 'Text extraction failed',
        details: extractError.message,
        documentId: docRef.id
      });
    }

    // Validate extracted text
    const textValidation = validateExtractedText(extractedData.text);
    if (!textValidation.valid) {
      await docRef.update({
        status: 'error',
        errorMessage: textValidation.error,
        wordCount: textValidation.wordCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(422).json({
        success: false,
        error: 'Document validation failed',
        details: textValidation.error,
        documentId: docRef.id
      });
    }

    // Update document with extracted content
    await docRef.update({
      extractedText: extractedData.text,
      pageCount: extractedData.pageCount,
      wordCount: extractedData.wordCount,
      status: 'ready',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update document count in config (if exists)
    const configRef = db.collection('customerLibraryConfig').doc(userId);
    const configDoc = await configRef.get();
    if (configDoc.exists) {
      await configRef.update({
        documentCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Document uploaded and processed successfully',
      data: {
        documentId: docRef.id,
        fileName,
        fileType: validation.fileType,
        documentType: fields.documentType || 'other',
        documentLabel: fields.documentLabel || fileName,
        pageCount: extractedData.pageCount,
        wordCount: extractedData.wordCount,
        status: 'ready'
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      details: error.message
    });
  }
}

/**
 * List all documents for a user
 * GET /sales-library/documents
 */
async function listDocuments(req, res) {
  const userId = req.userId;

  if (!userId || userId === 'anonymous') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  try {
    const snapshot = await db.collection('salesDocuments')
      .where('userId', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .get();

    const documents = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        fileName: data.fileName,
        fileType: data.fileType,
        documentType: data.documentType,
        documentLabel: data.documentLabel,
        pageCount: data.pageCount,
        wordCount: data.wordCount,
        status: data.status,
        errorMessage: data.errorMessage,
        uploadedAt: data.uploadedAt?.toDate?.() || data.uploadedAt
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        documents,
        count: documents.length
      }
    });

  } catch (error) {
    console.error('List documents error:', error);
    console.error('List documents error stack:', error.stack);

    // Check for missing index error
    if (error.code === 9 || error.message?.includes('index')) {
      console.error('Missing Firestore index. Create composite index: salesDocuments (userId ASC, uploadedAt DESC)');
      return res.status(500).json({
        success: false,
        error: 'Database configuration issue. Please contact support.',
        details: 'Missing index for salesDocuments collection'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to list documents',
      details: error.message
    });
  }
}

/**
 * Get a single document with full text
 * GET /sales-library/documents/:id
 */
async function getDocument(req, res) {
  const userId = req.userId;
  const documentId = req.params.id;

  if (!userId || userId === 'anonymous') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (!documentId) {
    return res.status(400).json({
      success: false,
      error: 'Document ID required'
    });
  }

  try {
    const docRef = db.collection('salesDocuments').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const data = doc.data();

    // Check ownership (unless admin)
    if (data.userId !== userId && !req.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: doc.id,
        fileName: data.fileName,
        fileType: data.fileType,
        documentType: data.documentType,
        documentLabel: data.documentLabel,
        extractedText: data.extractedText,
        pageCount: data.pageCount,
        wordCount: data.wordCount,
        status: data.status,
        errorMessage: data.errorMessage,
        uploadedAt: data.uploadedAt?.toDate?.() || data.uploadedAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      }
    });

  } catch (error) {
    console.error('Get document error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get document'
    });
  }
}

/**
 * Delete a document
 * DELETE /sales-library/documents/:id
 */
async function deleteDocument(req, res) {
  const userId = req.userId;
  const documentId = req.params.id;

  if (!userId || userId === 'anonymous') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (!documentId) {
    return res.status(400).json({
      success: false,
      error: 'Document ID required'
    });
  }

  try {
    const docRef = db.collection('salesDocuments').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const data = doc.data();

    // Check ownership (unless admin)
    if (data.userId !== userId && !req.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Delete from Cloud Storage
    if (data.storagePath) {
      try {
        const bucket = storage.bucket();
        await bucket.file(data.storagePath).delete();
      } catch (storageError) {
        console.warn('Storage delete warning:', storageError.message);
        // Continue with Firestore delete even if storage fails
      }
    }

    // Delete Firestore document
    await docRef.delete();

    // Update document count in config (if exists)
    const configRef = db.collection('customerLibraryConfig').doc(data.userId);
    const configDoc = await configRef.get();
    if (configDoc.exists) {
      await configRef.update({
        documentCount: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete document'
    });
  }
}

/**
 * Get library configuration for user
 * GET /sales-library/config
 */
async function getConfig(req, res) {
  const userId = req.userId;

  if (!userId || userId === 'anonymous') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  try {
    // Always get the real document count from Firestore
    const docCountSnap = await db.collection('salesDocuments')
      .where('userId', '==', userId)
      .count()
      .get();
    const realDocCount = docCountSnap.data().count;

    const configDoc = await db.collection('customerLibraryConfig').doc(userId).get();

    if (!configDoc.exists) {
      return res.status(200).json({
        success: true,
        data: {
          libraryEnabled: realDocCount > 0,
          documentCount: realDocCount
        }
      });
    }

    const data = configDoc.data();
    return res.status(200).json({
      success: true,
      data: {
        companyName: data.companyName,
        companyWebsite: data.companyWebsite,
        industry: data.industry,
        sellingTo: data.sellingTo,
        libraryEnabled: data.libraryEnabled !== false,
        documentCount: realDocCount,
        qualificationCriteria: data.qualificationCriteria || [],
        customTargetTitles: data.customTargetTitles || [],
        roiFramework: data.roiFramework || null
      }
    });

  } catch (error) {
    console.error('Get config error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get library configuration'
    });
  }
}

/**
 * Create or update library configuration (admin only)
 * POST /sales-library/config
 */
async function setConfig(req, res) {
  // Admin check should be done in route handler
  const {
    userId, companyName, companyWebsite, industry, sellingTo, libraryEnabled,
    notes, customPricingTier, monthlyPrice,
    qualificationCriteria, customTargetTitles, roiFramework
  } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required'
    });
  }

  try {
    const configRef = db.collection('customerLibraryConfig').doc(userId);
    const existingDoc = await configRef.get();

    const configData = {
      userId,
      companyName: companyName || '',
      companyWebsite: companyWebsite || '',
      industry: industry || '',
      sellingTo: sellingTo || '',
      libraryEnabled: libraryEnabled !== false, // Default to true
      notes: notes || '',
      customPricingTier: customPricingTier || null,
      monthlyPrice: monthlyPrice || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Custom ICP fields — only set if provided (allows partial updates)
    if (qualificationCriteria !== undefined) {
      configData.qualificationCriteria = Array.isArray(qualificationCriteria)
        ? qualificationCriteria : [];
    }
    if (customTargetTitles !== undefined) {
      configData.customTargetTitles = Array.isArray(customTargetTitles)
        ? customTargetTitles : [];
    }
    if (roiFramework !== undefined) {
      configData.roiFramework = roiFramework && typeof roiFramework === 'object'
        ? roiFramework : null;
    }

    if (!existingDoc.exists) {
      configData.documentCount = 0;
      configData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await configRef.set(configData);
    } else {
      await configRef.update(configData);
    }

    return res.status(200).json({
      success: true,
      message: 'Library configuration saved',
      data: { userId, libraryEnabled: configData.libraryEnabled }
    });

  } catch (error) {
    console.error('Set config error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save library configuration'
    });
  }
}

/**
 * Admin upload - upload document for a specific user
 * POST /admin/sales-library/:userId/upload
 */
async function adminUploadDocument(req, res) {
  const targetUserId = req.params.userId;

  if (!targetUserId) {
    return res.status(400).json({
      success: false,
      error: 'Target user ID required'
    });
  }

  // Verify target user exists
  try {
    await admin.auth().getUser(targetUserId);
  } catch (authError) {
    return res.status(404).json({
      success: false,
      error: 'Target user not found'
    });
  }

  // Use the regular upload function with target user ID
  return uploadDocument(req, res, targetUserId);
}

/**
 * Fetch sales library context for pitch generation
 * Used by pitch generators to inject custom content
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
async function fetchSalesLibraryContext(userId) {
  if (!userId) return null;

  try {
    // Check if user has library config — skip only if explicitly disabled
    const configDoc = await db.collection('customerLibraryConfig').doc(userId).get();
    if (configDoc.exists && configDoc.data().libraryEnabled === false) {
      return null;
    }

    // Fetch all ready documents
    const docsSnapshot = await db.collection('salesDocuments')
      .where('userId', '==', userId)
      .where('status', '==', 'ready')
      .orderBy('uploadedAt', 'desc')
      .get();

    if (docsSnapshot.empty) return null;

    const config = configDoc.exists ? configDoc.data() : {};
    const documents = docsSnapshot.docs.map(doc => ({
      id: doc.id,
      fileName: doc.data().fileName,
      documentType: doc.data().documentType,
      documentLabel: doc.data().documentLabel,
      extractedText: doc.data().extractedText,
      wordCount: doc.data().wordCount
    }));

    return {
      companyName: config.companyName || '',
      companyWebsite: config.companyWebsite || '',
      industry: config.industry || '',
      sellingTo: config.sellingTo || '',
      qualificationCriteria: config.qualificationCriteria || [],
      customTargetTitles: config.customTargetTitles || [],
      roiFramework: config.roiFramework || null,
      documents
    };
  } catch (error) {
    console.error('Error fetching sales library context:', error);
    return null;
  }
}

module.exports = {
  // Route handlers
  uploadDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  getConfig,
  setConfig,
  adminUploadDocument,

  // For pitch generation integration
  fetchSalesLibraryContext
};
