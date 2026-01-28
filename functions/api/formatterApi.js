/**
 * Formatter API Handlers
 *
 * Endpoints for formatting narratives into different asset types
 */

const admin = require('firebase-admin');
const {
    getFormatter,
    formatNarrative,
    batchFormat,
    validateFormatterAccess,
    getAllFormattersWithAvailability,
    getFormatterInfo
} = require('../formatters/formatterRegistry');
const { isFormatterAvailable, canBatchFormat } = require('../config/claude');
const { getUserPlan } = require('../middleware/planGate');
const { calculateCost } = require('../services/claudeClient');

const db = admin.firestore();

/**
 * Generate a unique asset ID
 */
function generateAssetId() {
    return 'asset_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * POST /api/v1/narratives/:id/format/:type
 * Format a narrative into a specific asset type
 */
async function formatNarrativeEndpoint(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;
    const assetType = req.params.type;
    const options = req.body || {};

    try {
        // Get user plan
        const plan = await getUserPlan(userId);

        // Check formatter availability for plan
        if (!isFormatterAvailable(assetType, plan)) {
            const info = getFormatterInfo(assetType);
            return res.status(403).json({
                success: false,
                error: 'Formatter not available',
                message: `The ${info?.name || assetType} formatter requires a ${info?.planRequirement || 'higher'} plan or above.`,
                currentPlan: plan,
                requiredPlan: info?.planRequirement
            });
        }

        // Get the narrative
        const narrativeDoc = await db.collection('narratives').doc(narrativeId).get();

        if (!narrativeDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Narrative not found'
            });
        }

        const narrativeData = narrativeDoc.data();

        // Check ownership
        if (narrativeData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Check if narrative is ready
        if (narrativeData.status === 'generating' || narrativeData.status === 'failed') {
            return res.status(400).json({
                success: false,
                error: 'Narrative not ready',
                message: `Narrative status is ${narrativeData.status}. Please wait or regenerate.`
            });
        }

        // Get branding options from user profile
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const branding = {
            ...userData.branding,
            ...options.branding
        };

        // Format the narrative
        const result = await formatNarrative(assetType, narrativeData.narrative, {
            ...options,
            branding,
            businessName: narrativeData.inputs?.businessName,
            contactName: narrativeData.inputs?.contactName
        });

        // Calculate cost
        const estimatedCost = result.content?.json?.usage
            ? calculateCost(result.content.json.usage)
            : 0;

        // Generate asset ID and store
        const assetId = generateAssetId();

        const assetDoc = {
            assetId,
            narrativeId,
            userId,
            assetType,
            content: {
                html: result.content.html,
                plainText: result.content.plainText,
                markdown: result.content.markdown
            },
            metadata: result.metadata,
            branding,
            tokensUsed: result.content?.json?.usage || { inputTokens: 0, outputTokens: 0 },
            estimatedCost,
            generatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('formattedAssets').doc(assetId).set(assetDoc);

        return res.status(201).json({
            success: true,
            message: `${getFormatterInfo(assetType)?.name || assetType} generated successfully`,
            data: {
                assetId,
                assetType,
                content: result.content,
                metadata: result.metadata,
                estimatedCost: `$${estimatedCost.toFixed(4)}`
            }
        });

    } catch (error) {
        console.error('Error formatting narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to format narrative',
            message: error.message
        });
    }
}

/**
 * POST /api/v1/narratives/:id/format-batch
 * Format a narrative into multiple asset types at once
 */
async function batchFormatEndpoint(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;
    const { assetTypes, options = {} } = req.body;

    try {
        if (!Array.isArray(assetTypes) || assetTypes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request',
                message: 'assetTypes must be a non-empty array'
            });
        }

        // Get user plan
        const plan = await getUserPlan(userId);

        // Check if user can batch format
        if (!canBatchFormat(plan, assetTypes.length)) {
            return res.status(403).json({
                success: false,
                error: 'Batch formatting not available',
                message: `Your plan does not support batch formatting with ${assetTypes.length} asset types.`,
                currentPlan: plan
            });
        }

        // Validate all formatters are available
        const accessValidation = validateFormatterAccess(assetTypes, plan);
        if (!accessValidation.valid) {
            return res.status(403).json({
                success: false,
                error: 'Some formatters not available',
                message: accessValidation.message,
                unavailableFormatters: accessValidation.unavailable
            });
        }

        // Get the narrative
        const narrativeDoc = await db.collection('narratives').doc(narrativeId).get();

        if (!narrativeDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Narrative not found'
            });
        }

        const narrativeData = narrativeDoc.data();

        // Check ownership
        if (narrativeData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Get branding
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const branding = {
            ...userData.branding,
            ...options.branding
        };

        // Batch format
        const batchResult = await batchFormat(narrativeData.narrative, assetTypes, {
            ...options,
            branding,
            businessName: narrativeData.inputs?.businessName,
            contactName: narrativeData.inputs?.contactName
        });

        // Store all successful results
        const batch = db.batch();
        const assets = {};

        for (const [type, result] of Object.entries(batchResult.results)) {
            const assetId = generateAssetId();

            const assetDoc = {
                assetId,
                narrativeId,
                userId,
                assetType: type,
                content: {
                    html: result.content.html,
                    plainText: result.content.plainText,
                    markdown: result.content.markdown
                },
                metadata: result.metadata,
                branding,
                tokensUsed: result.content?.json?.usage || { inputTokens: 0, outputTokens: 0 },
                generatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            batch.set(db.collection('formattedAssets').doc(assetId), assetDoc);

            assets[type] = {
                assetId,
                assetType: type,
                content: result.content,
                metadata: result.metadata
            };
        }

        await batch.commit();

        return res.status(201).json({
            success: true,
            message: `Generated ${batchResult.successCount} asset(s)`,
            data: {
                assets,
                errors: batchResult.errors,
                successCount: batchResult.successCount,
                errorCount: batchResult.errorCount
            }
        });

    } catch (error) {
        console.error('Error batch formatting narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to batch format narrative',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/narratives/:id/assets
 * List all formatted assets for a narrative
 */
async function listAssets(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;

    try {
        // Verify narrative ownership
        const narrativeDoc = await db.collection('narratives').doc(narrativeId).get();

        if (!narrativeDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Narrative not found'
            });
        }

        if (narrativeDoc.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Get all assets for this narrative
        const assetsSnapshot = await db.collection('formattedAssets')
            .where('narrativeId', '==', narrativeId)
            .orderBy('generatedAt', 'desc')
            .get();

        const assets = assetsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                assetId: data.assetId,
                assetType: data.assetType,
                metadata: data.metadata,
                generatedAt: data.generatedAt
            };
        });

        return res.status(200).json({
            success: true,
            data: assets
        });

    } catch (error) {
        console.error('Error listing assets:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list assets',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/assets/:assetId
 * Get a specific formatted asset
 */
async function getAsset(req, res) {
    const userId = req.userId;
    const assetId = req.params.assetId;
    const format = req.query.format || 'all'; // all, html, text, markdown, json

    try {
        const assetDoc = await db.collection('formattedAssets').doc(assetId).get();

        if (!assetDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }

        const assetData = assetDoc.data();

        // Check ownership
        if (assetData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Return requested format
        let content;
        let contentType = 'application/json';

        switch (format) {
            case 'html':
                content = assetData.content.html;
                contentType = 'text/html';
                break;
            case 'text':
                content = assetData.content.plainText;
                contentType = 'text/plain';
                break;
            case 'markdown':
                content = assetData.content.markdown;
                contentType = 'text/markdown';
                break;
            default:
                // Return full asset data
                return res.status(200).json({
                    success: true,
                    data: {
                        assetId: assetData.assetId,
                        narrativeId: assetData.narrativeId,
                        assetType: assetData.assetType,
                        content: assetData.content,
                        metadata: assetData.metadata,
                        generatedAt: assetData.generatedAt
                    }
                });
        }

        // Return raw content for specific formats
        res.setHeader('Content-Type', contentType);
        return res.send(content);

    } catch (error) {
        console.error('Error getting asset:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get asset',
            message: error.message
        });
    }
}

/**
 * DELETE /api/v1/assets/:assetId
 * Delete a formatted asset
 */
async function deleteAsset(req, res) {
    const userId = req.userId;
    const assetId = req.params.assetId;

    try {
        const assetDoc = await db.collection('formattedAssets').doc(assetId).get();

        if (!assetDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }

        if (assetDoc.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        await db.collection('formattedAssets').doc(assetId).delete();

        return res.status(200).json({
            success: true,
            message: 'Asset deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting asset:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete asset',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/formatters
 * List available formatters for the user's plan
 */
async function listFormatters(req, res) {
    const userId = req.userId;

    try {
        const plan = await getUserPlan(userId);
        const formatters = getAllFormattersWithAvailability(plan);

        return res.status(200).json({
            success: true,
            data: {
                plan,
                formatters
            }
        });

    } catch (error) {
        console.error('Error listing formatters:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list formatters',
            message: error.message
        });
    }
}

module.exports = {
    formatNarrativeEndpoint,
    batchFormatEndpoint,
    listAssets,
    getAsset,
    deleteAsset,
    listFormatters
};
