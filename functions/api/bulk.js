/**
 * Bulk CSV Upload API Handlers
 *
 * Handles bulk pitch generation from CSV files
 */

const admin = require('firebase-admin');
const { parse } = require('csv-parse/sync');
const archiver = require('archiver');
const { getPlanLimits } = require('../config/stripe');
const { getUserPlan } = require('../middleware/planGate');

const db = admin.firestore();

// CSV Template fields
const CSV_TEMPLATE_HEADERS = [
    'businessName',
    'segment',
    'subIndustry',
    'state',
    'city',
    'ownerName',
    'email',
    'phone',
    'customMessage',
    'websiteUrl',
    'googleRating',
    'numReviews'
];

const CSV_TEMPLATE_EXAMPLE = [
    "Joe's Lawn Care",
    "Lawn Care",
    "Residential Lawn Maintenance",
    "Texas",
    "Austin",
    "Joe Smith",
    "joe@example.com",
    "512-555-1234",
    "Looking forward to partnering!",
    "https://joeslawncare.com",
    "4.5",
    "127"
];

/**
 * Download CSV template
 */
async function downloadTemplate(req, res) {
    try {
        const headers = CSV_TEMPLATE_HEADERS.join(',');
        const example = CSV_TEMPLATE_EXAMPLE.map(v => `"${v}"`).join(',');
        const csvContent = `${headers}\n${example}`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="pathsynch_bulk_template.csv"');

        return res.status(200).send(csvContent);
    } catch (error) {
        console.error('Error generating template:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate template'
        });
    }
}

/**
 * Upload and process CSV file
 */
async function uploadCSV(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        // Get user's plan and check limits
        const plan = await getUserPlan(userId);
        const limits = getPlanLimits(plan);

        if (limits.bulkUploadRows <= 0) {
            return res.status(403).json({
                success: false,
                error: 'Bulk upload not available',
                message: 'Bulk CSV upload is available on Growth and Scale plans. Please upgrade to use this feature.'
            });
        }

        // Get CSV data from request
        const { csvData, pitchLevel = 2 } = req.body;

        if (!csvData) {
            return res.status(400).json({
                success: false,
                error: 'No CSV data provided'
            });
        }

        // Parse CSV
        let records;
        try {
            records = parse(csvData, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid CSV format',
                message: parseError.message
            });
        }

        if (records.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'CSV file is empty'
            });
        }

        // Check row limit
        if (records.length > limits.bulkUploadRows) {
            return res.status(400).json({
                success: false,
                error: 'Row limit exceeded',
                message: `Your plan allows up to ${limits.bulkUploadRows} rows per bulk upload. You submitted ${records.length} rows.`,
                limit: limits.bulkUploadRows,
                submitted: records.length
            });
        }

        // Validate rows
        const errors = [];
        const validRecords = [];

        records.forEach((record, index) => {
            const rowErrors = validateRow(record, index + 2); // +2 for header row and 0-index
            if (rowErrors.length > 0) {
                errors.push(...rowErrors);
            } else {
                validRecords.push({
                    ...record,
                    rowNumber: index + 2
                });
            }
        });

        // Create bulk job document
        const jobRef = db.collection('bulkJobs').doc();
        const jobData = {
            id: jobRef.id,
            userId: userId,
            status: 'pending',
            totalRows: records.length,
            validRows: validRecords.length,
            processedRows: 0,
            successCount: 0,
            failedCount: 0,
            pitchLevel: pitchLevel,
            pitchIds: [],
            errors: errors,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            completedAt: null
        };

        await jobRef.set(jobData);

        // If there are validation errors but some valid records, still process the valid ones
        if (validRecords.length === 0 && errors.length > 0) {
            await jobRef.update({
                status: 'failed',
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(400).json({
                success: false,
                error: 'All rows failed validation',
                jobId: jobRef.id,
                errors: errors
            });
        }

        // Start processing in the background
        // For now, we'll process synchronously but update status as we go
        processJob(jobRef.id, validRecords, pitchLevel, userId);

        return res.status(202).json({
            success: true,
            message: 'Bulk upload started',
            jobId: jobRef.id,
            totalRows: records.length,
            validRows: validRecords.length,
            validationErrors: errors
        });

    } catch (error) {
        console.error('Error processing bulk upload:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to process bulk upload',
            message: error.message
        });
    }
}

/**
 * Validate a single CSV row
 */
function validateRow(record, rowNumber) {
    const errors = [];

    // Required fields
    if (!record.businessName || record.businessName.trim() === '') {
        errors.push({
            row: rowNumber,
            field: 'businessName',
            error: 'Business name is required'
        });
    }

    if (!record.segment || record.segment.trim() === '') {
        errors.push({
            row: rowNumber,
            field: 'segment',
            error: 'Segment/Industry is required'
        });
    }

    // Email validation (optional but must be valid if provided)
    if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
        errors.push({
            row: rowNumber,
            field: 'email',
            error: 'Invalid email format'
        });
    }

    // Phone validation (optional but basic check if provided)
    if (record.phone && record.phone.replace(/\D/g, '').length < 10) {
        errors.push({
            row: rowNumber,
            field: 'phone',
            error: 'Phone number should have at least 10 digits'
        });
    }

    // Google rating validation
    if (record.googleRating) {
        const rating = parseFloat(record.googleRating);
        if (isNaN(rating) || rating < 0 || rating > 5) {
            errors.push({
                row: rowNumber,
                field: 'googleRating',
                error: 'Google rating must be between 0 and 5'
            });
        }
    }

    // Number of reviews validation
    if (record.numReviews) {
        const reviews = parseInt(record.numReviews);
        if (isNaN(reviews) || reviews < 0) {
            errors.push({
                row: rowNumber,
                field: 'numReviews',
                error: 'Number of reviews must be a positive number'
            });
        }
    }

    return errors;
}

/**
 * Process a bulk job (runs asynchronously)
 */
async function processJob(jobId, records, pitchLevel, userId) {
    const jobRef = db.collection('bulkJobs').doc(jobId);

    try {
        await jobRef.update({ status: 'processing' });

        const pitchGenerator = require('./pitchGenerator');
        const pitchIds = [];
        const errors = [];
        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < records.length; i++) {
            const record = records[i];

            try {
                // Build request body for pitch generation
                const pitchData = {
                    businessName: record.businessName,
                    industry: record.segment,
                    subIndustry: record.subIndustry || '',
                    address: [record.city, record.state].filter(Boolean).join(', '),
                    contactName: record.ownerName || '',
                    email: record.email || '',
                    phone: record.phone || '',
                    customMessage: record.customMessage || '',
                    websiteUrl: record.websiteUrl || '',
                    googleRating: parseFloat(record.googleRating) || 0,
                    numReviews: parseInt(record.numReviews) || 0,
                    pitchLevel: pitchLevel,
                    source: 'bulk_upload',
                    bulkJobId: jobId
                };

                // Generate pitch using the pitch generator
                const result = await pitchGenerator.generatePitchDirect(pitchData, userId);

                if (result.success && result.pitchId) {
                    pitchIds.push(result.pitchId);
                    successCount++;
                } else {
                    throw new Error(result.error || 'Failed to generate pitch');
                }

            } catch (pitchError) {
                console.error(`Error generating pitch for row ${record.rowNumber}:`, pitchError);
                errors.push({
                    row: record.rowNumber,
                    error: pitchError.message || 'Failed to generate pitch'
                });
                failedCount++;
            }

            // Update progress
            await jobRef.update({
                processedRows: i + 1,
                successCount: successCount,
                failedCount: failedCount,
                pitchIds: pitchIds
            });
        }

        // Mark job as complete
        await jobRef.update({
            status: successCount > 0 ? 'completed' : 'failed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            errors: admin.firestore.FieldValue.arrayUnion(...errors)
        });

        // Update usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        await db.collection('usage').doc(usageId).set({
            bulkUploadsThisMonth: admin.firestore.FieldValue.increment(1),
            pitchesGenerated: admin.firestore.FieldValue.increment(successCount),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

    } catch (error) {
        console.error('Error processing bulk job:', error);
        await jobRef.update({
            status: 'failed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            errors: admin.firestore.FieldValue.arrayUnion({
                row: 0,
                error: `System error: ${error.message}`
            })
        });
    }
}

/**
 * List user's bulk jobs
 */
async function listJobs(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;

        const jobsQuery = db.collection('bulkJobs')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .offset(offset)
            .limit(limit);

        const snapshot = await jobsQuery.get();

        const jobs = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                status: data.status,
                totalRows: data.totalRows,
                processedRows: data.processedRows,
                successCount: data.successCount,
                failedCount: data.failedCount,
                pitchLevel: data.pitchLevel,
                createdAt: data.createdAt,
                completedAt: data.completedAt
            };
        });

        return res.status(200).json({
            success: true,
            data: jobs
        });

    } catch (error) {
        console.error('Error listing jobs:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list jobs'
        });
    }
}

/**
 * Get job details
 */
async function getJob(req, res) {
    const userId = req.userId;
    const jobId = req.params.jobId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const jobDoc = await db.collection('bulkJobs').doc(jobId).get();

        if (!jobDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        const jobData = jobDoc.data();

        // Verify ownership
        if (jobData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: jobDoc.id,
                ...jobData
            }
        });

    } catch (error) {
        console.error('Error getting job:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get job details'
        });
    }
}

/**
 * Download all pitches from a job as ZIP
 */
async function downloadJob(req, res) {
    const userId = req.userId;
    const jobId = req.params.jobId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const jobDoc = await db.collection('bulkJobs').doc(jobId).get();

        if (!jobDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        const jobData = jobDoc.data();

        // Verify ownership
        if (jobData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        if (jobData.status !== 'completed' || !jobData.pitchIds || jobData.pitchIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No pitches available for download',
                message: 'Job must be completed with successful pitches to download.'
            });
        }

        // Set up ZIP archive
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="pathsynch_bulk_${jobId}.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        // Add each pitch as HTML file
        for (const pitchId of jobData.pitchIds) {
            try {
                const pitchDoc = await db.collection('pitches').doc(pitchId).get();
                if (pitchDoc.exists) {
                    const pitchData = pitchDoc.data();
                    const businessName = (pitchData.businessName || 'pitch')
                        .replace(/[^a-z0-9]/gi, '_')
                        .substring(0, 50);

                    archive.append(pitchData.html || '', {
                        name: `${businessName}_${pitchId}.html`
                    });
                }
            } catch (e) {
                console.error(`Error adding pitch ${pitchId} to ZIP:`, e);
            }
        }

        await archive.finalize();

    } catch (error) {
        console.error('Error creating download:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create download'
        });
    }
}

module.exports = {
    downloadTemplate,
    uploadCSV,
    listJobs,
    getJob,
    downloadJob
};
