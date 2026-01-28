/**
 * Narrative API Handlers
 *
 * Endpoints for narrative generation and management
 */

const admin = require('firebase-admin');
const narrativeReasoner = require('../services/narrativeReasoner');
const narrativeValidator = require('../services/narrativeValidator');
const narrativeCache = require('../services/narrativeCache');
const { CLAUDE_CONFIG, canGenerateNarrative, canRegenerate } = require('../config/claude');
const { calculateCost } = require('../services/claudeClient');
const { getUserPlan, getUserUsage } = require('../middleware/planGate');

const db = admin.firestore();

/**
 * Generate a unique narrative ID
 */
function generateNarrativeId() {
    return 'narr_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Calculate ROI data from inputs (imported logic from pitchGenerator)
 */
function calculateROI(inputs) {
    const monthlyVisits = parseFloat(inputs.monthlyVisits) || 500;
    const avgTransaction = parseFloat(inputs.avgTransaction) || 50;
    const repeatRate = parseFloat(inputs.repeatRate) || 0.3;

    const currentMonthlyRevenue = monthlyVisits * avgTransaction;
    const annualRevenue = currentMonthlyRevenue * 12;

    // Conservative improvement estimates
    const visibilityIncrease = 0.15; // 15% more visibility
    const conversionIncrease = 0.10; // 10% better conversion
    const retentionIncrease = 0.12; // 12% better retention

    const projectedMonthlyRevenue = currentMonthlyRevenue * (1 + visibilityIncrease + conversionIncrease);
    const projectedAnnualRevenue = projectedMonthlyRevenue * 12;

    return {
        current: {
            monthlyRevenue: currentMonthlyRevenue,
            annualRevenue: annualRevenue,
            repeatRate: repeatRate
        },
        projected: {
            monthlyRevenue: projectedMonthlyRevenue,
            annualRevenue: projectedAnnualRevenue,
            repeatRate: repeatRate * (1 + retentionIncrease)
        },
        improvement: {
            monthly: projectedMonthlyRevenue - currentMonthlyRevenue,
            annual: projectedAnnualRevenue - annualRevenue,
            percentage: ((projectedAnnualRevenue - annualRevenue) / annualRevenue * 100).toFixed(1)
        }
    };
}

/**
 * POST /api/v1/narratives/generate
 * Generate a new narrative from business data
 */
async function generateNarrative(req, res) {
    const userId = req.userId;
    const userEmail = req.userEmail;

    try {
        // Get user plan and usage
        const plan = await getUserPlan(userId);
        const usage = await getUserUsage(userId);
        const narrativesThisMonth = usage.narrativesGenerated || 0;

        // Check if user can generate more narratives
        if (!canGenerateNarrative(plan, narrativesThisMonth)) {
            return res.status(429).json({
                success: false,
                error: 'Narrative limit reached',
                message: 'You have reached your monthly narrative limit. Please upgrade your plan for more.',
                usage: { current: narrativesThisMonth, plan }
            });
        }

        const inputs = req.body;

        // Validate required fields
        if (!inputs.businessName || !inputs.industry) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'businessName and industry are required'
            });
        }

        // Check cache first
        const cacheKey = narrativeCache.generateCacheKey(inputs);
        const cached = await narrativeCache.getCached(cacheKey);

        if (cached) {
            // Return cached narrative
            await narrativeCache.incrementHitCount(cacheKey);

            return res.status(200).json({
                success: true,
                message: 'Narrative retrieved from cache',
                data: {
                    narrativeId: 'cached_' + cacheKey,
                    narrative: cached.narrative,
                    validation: cached.validation,
                    cached: true,
                    cachedAt: cached.cachedAt
                }
            });
        }

        // Calculate ROI data
        const roiData = calculateROI(inputs);

        // Generate narrative
        let narrativeResult;
        try {
            narrativeResult = await narrativeReasoner.generate(inputs, null, roiData);
        } catch (aiError) {
            console.error('AI narrative generation failed:', aiError);

            // Check if fallback is enabled
            if (CLAUDE_CONFIG.fallbackToTemplates) {
                return res.status(503).json({
                    success: false,
                    error: 'AI temporarily unavailable',
                    message: 'AI narrative generation is temporarily unavailable. Please use template-based pitch generation.',
                    fallbackAvailable: true
                });
            }

            throw aiError;
        }

        // Validate the narrative
        const validationResult = await narrativeValidator.fullValidate(
            narrativeResult.narrative,
            { inputs, roiData },
            { autoFix: true }
        );

        // Use auto-fixed narrative if available
        const finalNarrative = validationResult.fixedNarrative || narrativeResult.narrative;

        // Calculate total token usage and cost
        const totalUsage = {
            inputTokens: (narrativeResult.usage?.inputTokens || 0) + (validationResult.usage?.inputTokens || 0),
            outputTokens: (narrativeResult.usage?.outputTokens || 0) + (validationResult.usage?.outputTokens || 0)
        };
        const estimatedCost = calculateCost(totalUsage);

        // Generate narrative ID
        const narrativeId = generateNarrativeId();

        // Store in Firestore
        const narrativeDoc = {
            narrativeId,
            userId,
            userEmail,
            inputs,
            roiData,
            narrative: finalNarrative,
            validation: validationResult.validation,
            status: validationResult.validation.isValid ? 'ready' : 'needs_review',
            tokensUsed: totalUsage,
            estimatedCost,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('narratives').doc(narrativeId).set(narrativeDoc);

        // Update usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        await db.collection('usage').doc(usageId).set({
            userId,
            period,
            narrativesGenerated: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Cache the narrative for future use (only if valid)
        if (validationResult.validation.isValid) {
            await narrativeCache.setCache(cacheKey, finalNarrative, validationResult.validation, inputs);
        }

        return res.status(201).json({
            success: true,
            message: 'Narrative generated successfully',
            data: {
                narrativeId,
                narrative: finalNarrative,
                validation: validationResult.validation,
                status: narrativeDoc.status,
                tokensUsed: totalUsage,
                estimatedCost: `$${estimatedCost.toFixed(4)}`
            }
        });

    } catch (error) {
        console.error('Error generating narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate narrative',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/narratives/:id
 * Get a narrative by ID
 */
async function getNarrative(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;

    try {
        const narrativeDoc = await db.collection('narratives').doc(narrativeId).get();

        if (!narrativeDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Narrative not found',
                message: 'No narrative found with this ID'
            });
        }

        const narrativeData = narrativeDoc.data();

        // Check ownership
        if (narrativeData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have access to this narrative'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                narrativeId: narrativeData.narrativeId,
                narrative: narrativeData.narrative,
                validation: narrativeData.validation,
                inputs: narrativeData.inputs,
                roiData: narrativeData.roiData,
                status: narrativeData.status,
                createdAt: narrativeData.createdAt,
                updatedAt: narrativeData.updatedAt
            }
        });

    } catch (error) {
        console.error('Error getting narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get narrative',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/narratives
 * List user's narratives
 */
async function listNarratives(req, res) {
    const userId = req.userId;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;

    try {
        let query = db.collection('narratives')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit + 1); // Fetch one extra to check if there's more

        if (offset > 0) {
            // Get the offset document
            const allDocs = await db.collection('narratives')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(offset)
                .get();

            if (!allDocs.empty) {
                const lastDoc = allDocs.docs[allDocs.docs.length - 1];
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        const narratives = [];
        let hasMore = false;

        snapshot.docs.forEach((doc, index) => {
            if (index < limit) {
                const data = doc.data();
                narratives.push({
                    narrativeId: data.narrativeId,
                    businessName: data.inputs?.businessName,
                    industry: data.inputs?.industry,
                    status: data.status,
                    validationScore: data.validation?.score,
                    createdAt: data.createdAt
                });
            } else {
                hasMore = true;
            }
        });

        return res.status(200).json({
            success: true,
            data: narratives,
            pagination: {
                limit,
                offset,
                hasMore
            }
        });

    } catch (error) {
        console.error('Error listing narratives:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list narratives',
            message: error.message
        });
    }
}

/**
 * POST /api/v1/narratives/:id/regenerate
 * Regenerate specific sections of a narrative
 */
async function regenerateNarrative(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;
    const { sections, modifications } = req.body;

    try {
        // Get user plan and check regeneration limit
        const plan = await getUserPlan(userId);
        const usage = await getUserUsage(userId);
        const regenerationsThisMonth = usage.aiRegenerations || 0;

        if (!canRegenerate(plan, regenerationsThisMonth)) {
            return res.status(429).json({
                success: false,
                error: 'Regeneration limit reached',
                message: 'You have reached your monthly regeneration limit. Please upgrade your plan for more.',
                usage: { current: regenerationsThisMonth, plan }
            });
        }

        // Get existing narrative
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

        // Regenerate specified sections
        const result = await narrativeReasoner.regenerateSection(
            narrativeData.narrative,
            sections || Object.keys(narrativeData.narrative),
            narrativeData.inputs,
            modifications
        );

        // Validate the updated narrative
        const validationResult = await narrativeValidator.fullValidate(
            result.narrative,
            { inputs: narrativeData.inputs, roiData: narrativeData.roiData },
            { autoFix: true }
        );

        const finalNarrative = validationResult.fixedNarrative || result.narrative;

        // Calculate total usage
        const totalUsage = {
            inputTokens: (result.usage?.inputTokens || 0) + (validationResult.usage?.inputTokens || 0),
            outputTokens: (result.usage?.outputTokens || 0) + (validationResult.usage?.outputTokens || 0)
        };

        // Update the narrative document
        await db.collection('narratives').doc(narrativeId).update({
            narrative: finalNarrative,
            validation: validationResult.validation,
            status: validationResult.validation.isValid ? 'ready' : 'needs_review',
            tokensUsed: {
                inputTokens: (narrativeData.tokensUsed?.inputTokens || 0) + totalUsage.inputTokens,
                outputTokens: (narrativeData.tokensUsed?.outputTokens || 0) + totalUsage.outputTokens
            },
            regeneratedSections: result.regeneratedSections,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update regeneration usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        await db.collection('usage').doc(usageId).set({
            aiRegenerations: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
            success: true,
            message: 'Narrative regenerated successfully',
            data: {
                narrativeId,
                narrative: finalNarrative,
                validation: validationResult.validation,
                regeneratedSections: result.regeneratedSections,
                tokensUsed: totalUsage
            }
        });

    } catch (error) {
        console.error('Error regenerating narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to regenerate narrative',
            message: error.message
        });
    }
}

/**
 * DELETE /api/v1/narratives/:id
 * Delete a narrative
 */
async function deleteNarrative(req, res) {
    const userId = req.userId;
    const narrativeId = req.params.id;

    try {
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

        // Delete the narrative
        await db.collection('narratives').doc(narrativeId).delete();

        // Also delete associated formatted assets
        const assetsSnapshot = await db.collection('formattedAssets')
            .where('narrativeId', '==', narrativeId)
            .get();

        const batch = db.batch();
        assetsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        return res.status(200).json({
            success: true,
            message: 'Narrative deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting narrative:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete narrative',
            message: error.message
        });
    }
}

module.exports = {
    generateNarrative,
    getNarrative,
    listNarratives,
    regenerateNarrative,
    deleteNarrative
};
