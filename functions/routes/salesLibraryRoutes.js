/**
 * Sales Library Routes
 * Handles routing for custom sales library document management
 */

const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/adminAuth');
const salesLibrary = require('../api/salesLibrary');

const router = createRouter();

// ============================================
// User Routes (authenticated users)
// ============================================

/**
 * Upload a document to user's sales library
 * POST /sales-library/upload
 */
router.post('/sales-library/upload', async (req, res) => {
  try {
    return await salesLibrary.uploadDocument(req, res);
  } catch (error) {
    return handleError(error, res, 'POST /sales-library/upload');
  }
});

/**
 * List all documents in user's sales library
 * GET /sales-library/documents
 */
router.get('/sales-library/documents', async (req, res) => {
  try {
    return await salesLibrary.listDocuments(req, res);
  } catch (error) {
    return handleError(error, res, 'GET /sales-library/documents');
  }
});

/**
 * Get a single document with full text
 * GET /sales-library/documents/:id
 */
router.get('/sales-library/documents/:id', async (req, res) => {
  try {
    return await salesLibrary.getDocument(req, res);
  } catch (error) {
    return handleError(error, res, 'GET /sales-library/documents/:id');
  }
});

/**
 * Delete a document from user's sales library
 * DELETE /sales-library/documents/:id
 */
router.delete('/sales-library/documents/:id', async (req, res) => {
  try {
    return await salesLibrary.deleteDocument(req, res);
  } catch (error) {
    return handleError(error, res, 'DELETE /sales-library/documents/:id');
  }
});

/**
 * Get user's library configuration
 * GET /sales-library/config
 */
router.get('/sales-library/config', async (req, res) => {
  try {
    return await salesLibrary.getConfig(req, res);
  } catch (error) {
    return handleError(error, res, 'GET /sales-library/config');
  }
});

// ============================================
// Admin Routes (admin users only)
// ============================================

/**
 * Create or update library configuration for a user
 * POST /sales-library/config
 * Requires admin access
 */
router.post('/sales-library/config', async (req, res, next) => {
  // Admin middleware
  try {
    await new Promise((resolve, reject) => {
      requireAdmin(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    next();
  } catch (error) {
    // Response already sent by requireAdmin
    return;
  }
}, async (req, res) => {
  try {
    return await salesLibrary.setConfig(req, res);
  } catch (error) {
    return handleError(error, res, 'POST /sales-library/config');
  }
});

/**
 * Admin: Upload document for a specific user
 * POST /admin/sales-library/:userId/upload
 * Requires admin access
 */
router.post('/admin/sales-library/:userId/upload', async (req, res, next) => {
  // Admin middleware
  try {
    await new Promise((resolve, reject) => {
      requireAdmin(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    next();
  } catch (error) {
    return;
  }
}, async (req, res) => {
  try {
    return await salesLibrary.adminUploadDocument(req, res);
  } catch (error) {
    return handleError(error, res, 'POST /admin/sales-library/:userId/upload');
  }
});

// Export router and available endpoints list
module.exports = router;

// For documentation
module.exports.SALES_LIBRARY_ENDPOINTS = [
  'POST   /api/v1/sales-library/upload              - Upload a document',
  'GET    /api/v1/sales-library/documents           - List all documents',
  'GET    /api/v1/sales-library/documents/:id       - Get single document',
  'DELETE /api/v1/sales-library/documents/:id       - Delete a document',
  'GET    /api/v1/sales-library/config              - Get library config',
  'POST   /api/v1/sales-library/config              - Set library config (admin)',
  'POST   /api/v1/admin/sales-library/:userId/upload - Admin upload for user'
];
