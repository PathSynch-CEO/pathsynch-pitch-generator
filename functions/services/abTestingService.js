/**
 * A/B Testing Service
 *
 * Manages A/B tests for prompt variants and model comparisons
 * with sticky user assignment and statistical analysis.
 */

const admin = require('firebase-admin');
const { GEMINI_CONFIG, isFeatureEnabled } = require('../config/gemini');

const db = admin.firestore();

/**
 * Test status enum
 */
const TestStatus = {
    DRAFT: 'draft',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    ARCHIVED: 'archived'
};

/**
 * Test type enum
 */
const TestType = {
    PROMPT: 'prompt',
    MODEL: 'model'
};

/**
 * Event type enum
 */
const EventType = {
    GENERATION: 'generation',
    FEEDBACK: 'feedback',
    ERROR: 'error',
    LATENCY: 'latency'
};

/**
 * Create a new A/B test
 * @param {Object} testConfig - Test configuration
 * @returns {Promise<Object>} Created test document
 */
async function createTest(testConfig) {
    const {
        name,
        description,
        testType,
        operation, // e.g., 'narrativeGeneration', 'validation'
        variants,
        targetAudience = {},
        metrics = ['qualityScore', 'latencyMs', 'errorRate']
    } = testConfig;

    const testId = `test_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;

    // Validate variants
    if (!Array.isArray(variants) || variants.length < 2) {
        throw new Error('A/B test must have at least 2 variants');
    }

    // Ensure variants have weights that sum to 100
    let totalWeight = variants.reduce((sum, v) => sum + (v.weight || 0), 0);
    if (totalWeight !== 100) {
        // Auto-distribute weights evenly
        const evenWeight = Math.floor(100 / variants.length);
        const remainder = 100 - (evenWeight * variants.length);
        variants.forEach((v, i) => {
            v.weight = evenWeight + (i === 0 ? remainder : 0);
        });
    }

    // Add variant IDs if not present
    variants.forEach((v, i) => {
        if (!v.variantId) {
            v.variantId = i === 0 ? 'control' : `variant_${i}`;
        }
        v.isControl = i === 0;
    });

    const testDoc = {
        testId,
        name,
        description: description || '',
        testType: testType || TestType.MODEL,
        operation,
        status: TestStatus.DRAFT,
        variants,
        targetAudience,
        metrics,
        results: {
            totalAssignments: 0,
            variantStats: variants.reduce((acc, v) => {
                acc[v.variantId] = {
                    assignments: 0,
                    generations: 0,
                    errors: 0,
                    totalLatencyMs: 0,
                    totalQualityScore: 0,
                    feedbackCount: 0,
                    totalFeedbackScore: 0
                };
                return acc;
            }, {})
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        startedAt: null,
        completedAt: null
    };

    await db.collection('abTests').doc(testId).set(testDoc);

    return { testId, ...testDoc };
}

/**
 * Get a test by ID
 */
async function getTest(testId) {
    const doc = await db.collection('abTests').doc(testId).get();
    if (!doc.exists) {
        return null;
    }
    return { testId: doc.id, ...doc.data() };
}

/**
 * List tests with optional filters
 */
async function listTests(filters = {}) {
    let query = db.collection('abTests');

    if (filters.status) {
        query = query.where('status', '==', filters.status);
    }
    if (filters.operation) {
        query = query.where('operation', '==', filters.operation);
    }

    query = query.orderBy('createdAt', 'desc');

    if (filters.limit) {
        query = query.limit(filters.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ testId: doc.id, ...doc.data() }));
}

/**
 * Start a test
 */
async function startTest(testId) {
    const test = await getTest(testId);
    if (!test) {
        throw new Error('Test not found');
    }

    if (test.status !== TestStatus.DRAFT && test.status !== TestStatus.PAUSED) {
        throw new Error(`Cannot start test in ${test.status} status`);
    }

    await db.collection('abTests').doc(testId).update({
        status: TestStatus.RUNNING,
        startedAt: test.startedAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return getTest(testId);
}

/**
 * Pause a test
 */
async function pauseTest(testId) {
    const test = await getTest(testId);
    if (!test) {
        throw new Error('Test not found');
    }

    if (test.status !== TestStatus.RUNNING) {
        throw new Error('Can only pause running tests');
    }

    await db.collection('abTests').doc(testId).update({
        status: TestStatus.PAUSED,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return getTest(testId);
}

/**
 * Stop and complete a test
 */
async function stopTest(testId) {
    const test = await getTest(testId);
    if (!test) {
        throw new Error('Test not found');
    }

    // Calculate final statistics
    const analysis = analyzeResults(test);

    await db.collection('abTests').doc(testId).update({
        status: TestStatus.COMPLETED,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        'results.analysis': analysis
    });

    return getTest(testId);
}

/**
 * Get or assign a variant for a user
 * Implements sticky assignment - same user always gets same variant
 */
async function getVariantForUser(testId, userId) {
    // Check if A/B testing is enabled
    if (!isFeatureEnabled('enableAbTesting')) {
        return null;
    }

    const test = await getTest(testId);
    if (!test || test.status !== TestStatus.RUNNING) {
        return null;
    }

    // Check target audience filters
    if (!matchesTargetAudience(userId, test.targetAudience)) {
        return null;
    }

    // Check for existing assignment
    const assignmentId = `${userId}_${testId}`;
    const existingAssignment = await db.collection('abTestAssignments').doc(assignmentId).get();

    if (existingAssignment.exists) {
        const data = existingAssignment.data();
        const variant = test.variants.find(v => v.variantId === data.variantId);
        return variant || null;
    }

    // Assign new variant based on weights
    const variant = selectVariant(test.variants, userId);

    // Store assignment
    await db.collection('abTestAssignments').doc(assignmentId).set({
        userId,
        testId,
        variantId: variant.variantId,
        assignedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update test stats
    await db.collection('abTests').doc(testId).update({
        'results.totalAssignments': admin.firestore.FieldValue.increment(1),
        [`results.variantStats.${variant.variantId}.assignments`]: admin.firestore.FieldValue.increment(1)
    });

    return variant;
}

/**
 * Select a variant based on weights (deterministic for same user)
 */
function selectVariant(variants, userId) {
    // Create deterministic hash from userId
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    hash = Math.abs(hash) % 100;

    // Select variant based on weights
    let cumulative = 0;
    for (const variant of variants) {
        cumulative += variant.weight;
        if (hash < cumulative) {
            return variant;
        }
    }

    // Fallback to control
    return variants[0];
}

/**
 * Check if user matches target audience
 */
function matchesTargetAudience(userId, targetAudience) {
    // If no audience specified, include everyone
    if (!targetAudience || Object.keys(targetAudience).length === 0) {
        return true;
    }

    // Add audience filter logic as needed
    // e.g., targetAudience.plans, targetAudience.userIds, etc.

    if (targetAudience.userIds && !targetAudience.userIds.includes(userId)) {
        return false;
    }

    return true;
}

/**
 * Record an event for a test variant
 */
async function recordEvent(testId, variantId, userId, eventType, metrics = {}) {
    // Check if A/B testing is enabled
    if (!isFeatureEnabled('enableAbTesting')) {
        return;
    }

    const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;

    await db.collection('abTestEvents').doc(eventId).set({
        eventId,
        testId,
        variantId,
        userId,
        eventType,
        metrics,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update aggregate stats
    const updates = {};

    switch (eventType) {
        case EventType.GENERATION:
            updates[`results.variantStats.${variantId}.generations`] = admin.firestore.FieldValue.increment(1);
            if (metrics.latencyMs) {
                updates[`results.variantStats.${variantId}.totalLatencyMs`] = admin.firestore.FieldValue.increment(metrics.latencyMs);
            }
            if (metrics.qualityScore) {
                updates[`results.variantStats.${variantId}.totalQualityScore`] = admin.firestore.FieldValue.increment(metrics.qualityScore);
            }
            break;

        case EventType.FEEDBACK:
            updates[`results.variantStats.${variantId}.feedbackCount`] = admin.firestore.FieldValue.increment(1);
            if (metrics.rating) {
                updates[`results.variantStats.${variantId}.totalFeedbackScore`] = admin.firestore.FieldValue.increment(metrics.rating);
            }
            break;

        case EventType.ERROR:
            updates[`results.variantStats.${variantId}.errors`] = admin.firestore.FieldValue.increment(1);
            break;
    }

    if (Object.keys(updates).length > 0) {
        await db.collection('abTests').doc(testId).update(updates);
    }
}

/**
 * Analyze test results and calculate statistical significance
 */
function analyzeResults(test) {
    const { variants, results } = test;
    const stats = results.variantStats;

    const analysis = {
        variants: {},
        winner: null,
        isSignificant: false,
        confidenceLevel: 0,
        recommendation: ''
    };

    // Calculate metrics for each variant
    for (const variant of variants) {
        const variantStats = stats[variant.variantId] || {};

        const generations = variantStats.generations || 0;
        const errors = variantStats.errors || 0;
        const feedbackCount = variantStats.feedbackCount || 0;

        analysis.variants[variant.variantId] = {
            name: variant.name || variant.variantId,
            isControl: variant.isControl,
            sampleSize: generations,
            errorRate: generations > 0 ? (errors / generations * 100).toFixed(2) : 0,
            avgLatencyMs: generations > 0 ? Math.round(variantStats.totalLatencyMs / generations) : 0,
            avgQualityScore: generations > 0 ? (variantStats.totalQualityScore / generations).toFixed(2) : 0,
            avgFeedbackScore: feedbackCount > 0 ? (variantStats.totalFeedbackScore / feedbackCount).toFixed(2) : 0
        };
    }

    // Find control and treatment for comparison
    const control = variants.find(v => v.isControl);
    const treatment = variants.find(v => !v.isControl);

    if (!control || !treatment) {
        analysis.recommendation = 'Insufficient data for analysis';
        return analysis;
    }

    const controlStats = analysis.variants[control.variantId];
    const treatmentStats = analysis.variants[treatment.variantId];

    // Calculate statistical significance (simplified chi-squared approximation)
    const minSampleSize = 100;

    if (controlStats.sampleSize < minSampleSize || treatmentStats.sampleSize < minSampleSize) {
        analysis.recommendation = `Need at least ${minSampleSize} samples per variant (current: control=${controlStats.sampleSize}, treatment=${treatmentStats.sampleSize})`;
        return analysis;
    }

    // Compare quality scores
    const controlQuality = parseFloat(controlStats.avgQualityScore);
    const treatmentQuality = parseFloat(treatmentStats.avgQualityScore);
    const qualityDiff = treatmentQuality - controlQuality;
    const qualityDiffPercent = controlQuality > 0 ? (qualityDiff / controlQuality * 100).toFixed(2) : 0;

    // Simple significance test (z-test approximation)
    const pooledSamples = controlStats.sampleSize + treatmentStats.sampleSize;
    const standardError = Math.sqrt(
        (controlQuality * (100 - controlQuality) / controlStats.sampleSize) +
        (treatmentQuality * (100 - treatmentQuality) / treatmentStats.sampleSize)
    );

    const zScore = standardError > 0 ? Math.abs(qualityDiff) / standardError : 0;

    // z-score thresholds: 1.96 = 95% confidence, 2.58 = 99% confidence
    if (zScore >= 2.58) {
        analysis.confidenceLevel = 99;
        analysis.isSignificant = true;
    } else if (zScore >= 1.96) {
        analysis.confidenceLevel = 95;
        analysis.isSignificant = true;
    } else if (zScore >= 1.65) {
        analysis.confidenceLevel = 90;
        analysis.isSignificant = false;
    } else {
        analysis.confidenceLevel = Math.round(zScore / 1.96 * 95);
        analysis.isSignificant = false;
    }

    // Determine winner
    if (analysis.isSignificant) {
        if (treatmentQuality > controlQuality) {
            analysis.winner = treatment.variantId;
            analysis.recommendation = `Treatment (${treatment.name}) wins with ${qualityDiffPercent}% improvement in quality score at ${analysis.confidenceLevel}% confidence. Consider rolling out.`;
        } else {
            analysis.winner = control.variantId;
            analysis.recommendation = `Control performs better. Treatment shows ${Math.abs(qualityDiffPercent)}% degradation. Recommend keeping control.`;
        }
    } else {
        analysis.recommendation = `Results not statistically significant (${analysis.confidenceLevel}% confidence). Quality difference: ${qualityDiffPercent}%. Continue collecting data.`;
    }

    return analysis;
}

/**
 * Get test results with analysis
 */
async function getTestResults(testId) {
    const test = await getTest(testId);
    if (!test) {
        throw new Error('Test not found');
    }

    const analysis = analyzeResults(test);

    return {
        testId: test.testId,
        name: test.name,
        status: test.status,
        startedAt: test.startedAt,
        completedAt: test.completedAt,
        totalAssignments: test.results.totalAssignments,
        analysis
    };
}

/**
 * Get active test for an operation
 */
async function getActiveTestForOperation(operation) {
    const tests = await listTests({
        status: TestStatus.RUNNING,
        operation,
        limit: 1
    });

    return tests.length > 0 ? tests[0] : null;
}

module.exports = {
    TestStatus,
    TestType,
    EventType,
    createTest,
    getTest,
    listTests,
    startTest,
    pauseTest,
    stopTest,
    getVariantForUser,
    recordEvent,
    analyzeResults,
    getTestResults,
    getActiveTestForOperation
};
