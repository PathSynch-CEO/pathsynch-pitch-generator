/**
 * Sales Library - File Validation
 * Validates uploaded documents for the custom sales library feature
 */

const { ApiError } = require('../../middleware/errorHandler');

// Allowed MIME types
const ALLOWED_MIME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/html': 'html'
};

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.html'];

// Size and count limits
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_DOCUMENTS_PER_USER = 20;
const MAX_EXTRACTED_WORDS = 50000; // ~200KB text, well under Firestore 1MB limit

// Document type taxonomy
const DOCUMENT_TYPES = [
  'business_case',
  'pitch_deck',
  'conference_deck',
  'one_pager',
  'case_study',
  'sales_process',
  'other'
];

/**
 * Validates file type based on MIME type and extension
 * @param {string} mimeType - The MIME type of the uploaded file
 * @param {string} fileName - Original filename for extension check
 * @returns {{ valid: boolean, fileType: string | null, error: string | null }}
 */
function validateFileType(mimeType, fileName) {
  // Check MIME type
  const fileTypeFromMime = ALLOWED_MIME_TYPES[mimeType];

  // Check extension
  const ext = fileName ? fileName.toLowerCase().slice(fileName.lastIndexOf('.')) : '';
  const validExtension = ALLOWED_EXTENSIONS.includes(ext);

  if (!fileTypeFromMime && !validExtension) {
    return {
      valid: false,
      fileType: null,
      error: `Invalid file type. Allowed types: PDF, DOCX, PPTX, TXT, MD, HTML. Received: ${mimeType || 'unknown'}`
    };
  }

  // Determine file type (prefer MIME, fallback to extension)
  let fileType = fileTypeFromMime;
  if (!fileType && validExtension) {
    fileType = ext.replace('.', '');
  }

  return {
    valid: true,
    fileType,
    error: null
  };
}

/**
 * Validates file size
 * @param {number} sizeBytes - File size in bytes
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateFileSize(sizeBytes) {
  if (!sizeBytes || sizeBytes <= 0) {
    return {
      valid: false,
      error: 'File is empty or size could not be determined'
    };
  }

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `File too large (${sizeMB}MB). Maximum allowed size is ${maxMB}MB`
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates extracted text word count
 * @param {string} text - Extracted text content
 * @returns {{ valid: boolean, wordCount: number, error: string | null }}
 */
function validateExtractedText(text) {
  if (!text || typeof text !== 'string') {
    return {
      valid: false,
      wordCount: 0,
      error: 'No text could be extracted from the document'
    };
  }

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  if (wordCount > MAX_EXTRACTED_WORDS) {
    return {
      valid: false,
      wordCount,
      error: `Document text exceeds ${MAX_EXTRACTED_WORDS.toLocaleString()} words (found ${wordCount.toLocaleString()}). Please upload a shorter document or contact support.`
    };
  }

  if (wordCount < 10) {
    return {
      valid: false,
      wordCount,
      error: 'Document contains too little text to be useful. Please ensure the document has extractable text content.'
    };
  }

  return { valid: true, wordCount, error: null };
}

/**
 * Validates document type classification
 * @param {string} documentType - The type classification
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateDocumentType(documentType) {
  if (!documentType) {
    return { valid: true, error: null }; // Will default to 'other'
  }

  if (!DOCUMENT_TYPES.includes(documentType)) {
    return {
      valid: false,
      error: `Invalid document type. Allowed types: ${DOCUMENT_TYPES.join(', ')}`
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates user hasn't exceeded document limit
 * @param {number} currentCount - Current number of documents for user
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateDocumentCount(currentCount) {
  if (currentCount >= MAX_DOCUMENTS_PER_USER) {
    return {
      valid: false,
      error: `Document limit reached (${MAX_DOCUMENTS_PER_USER} documents). Please delete existing documents before uploading new ones.`
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates complete upload request
 * @param {Object} params
 * @param {string} params.mimeType - File MIME type
 * @param {string} params.fileName - Original filename
 * @param {number} params.fileSize - File size in bytes
 * @param {string} params.documentType - Document classification
 * @param {number} params.currentDocCount - User's current document count
 * @returns {{ valid: boolean, fileType: string | null, errors: string[] }}
 */
function validateUploadRequest({ mimeType, fileName, fileSize, documentType, currentDocCount }) {
  const errors = [];
  let fileType = null;

  // File type validation
  const typeResult = validateFileType(mimeType, fileName);
  if (!typeResult.valid) {
    errors.push(typeResult.error);
  } else {
    fileType = typeResult.fileType;
  }

  // File size validation
  const sizeResult = validateFileSize(fileSize);
  if (!sizeResult.valid) {
    errors.push(sizeResult.error);
  }

  // Document type validation
  const docTypeResult = validateDocumentType(documentType);
  if (!docTypeResult.valid) {
    errors.push(docTypeResult.error);
  }

  // Document count validation
  if (typeof currentDocCount === 'number') {
    const countResult = validateDocumentCount(currentDocCount);
    if (!countResult.valid) {
      errors.push(countResult.error);
    }
  }

  return {
    valid: errors.length === 0,
    fileType,
    errors
  };
}

module.exports = {
  // Constants
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_DOCUMENTS_PER_USER,
  MAX_EXTRACTED_WORDS,
  DOCUMENT_TYPES,

  // Validators
  validateFileType,
  validateFileSize,
  validateExtractedText,
  validateDocumentType,
  validateDocumentCount,
  validateUploadRequest
};
