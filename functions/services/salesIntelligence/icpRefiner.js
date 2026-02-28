/**
 * ICP Refiner
 *
 * Learns from closed deals to refine the Ideal Customer Profile.
 * Tracks which characteristics correlate with wins vs losses,
 * and suggests ICP adjustments based on data.
 *
 * Features:
 * - Learn from closed-won deals (what works)
 * - Learn from closed-lost deals (what doesn't)
 * - Score new prospects against refined ICP
 * - Suggest ICP refinements based on patterns
 */

const admin = require('firebase-admin');
const {
    ICP_CRITERIA,
    DEAL_OUTCOMES,
    SENIORITY_LEVELS,
    COMPANY_SIZES,
    getSeniorityFromTitle,
    getCompanySizeCategory,
} = require('./signalTypes');

const db = admin.firestore();

/**
 * Default ICP scoring weights
 */
const DEFAULT_ICP_WEIGHTS = {
    [ICP_CRITERIA.INDUSTRY]: 20,
    [ICP_CRITERIA.COMPANY_SIZE]: 15,
    [ICP_CRITERIA.TITLE_SENIORITY]: 20,
    [ICP_CRITERIA.DEPARTMENT]: 10,
    [ICP_CRITERIA.LOCATION]: 5,
    [ICP_CRITERIA.USE_CASE_MATCH]: 15,
    [ICP_CRITERIA.PAIN_POINT_MATCH]: 15,
};

/**
 * Record a deal outcome for ICP learning
 *
 * @param {string} userId - User ID
 * @param {object} deal - Deal data
 * @returns {object} Updated ICP insights
 */
async function recordDealOutcome(userId, deal) {
    const {
        dealId,
        outcome, // closed_won, closed_lost, disqualified, no_decision, competitor_loss
        prospectData, // Company info, contact info, etc.
        dealValue,
        salesCycle, // Days from first contact to close
        lossReason, // Why we lost (if applicable)
        winFactors, // What helped us win (if applicable)
        notes,
    } = deal;

    if (!userId || !outcome || !prospectData) {
        throw new Error('userId, outcome, and prospectData are required');
    }

    // Validate outcome
    if (!Object.values(DEAL_OUTCOMES).includes(outcome)) {
        throw new Error(`Invalid outcome: ${outcome}`);
    }

    try {
        // Extract and normalize prospect attributes
        const attributes = extractProspectAttributes(prospectData);

        // Record the deal
        const dealRef = db.collection('icpDeals').doc(dealId || undefined);
        await dealRef.set({
            id: dealRef.id,
            userId,
            outcome,
            dealValue: dealValue || null,
            salesCycle: salesCycle || null,
            lossReason: lossReason || null,
            winFactors: winFactors || [],
            notes: notes || null,
            // Normalized attributes for analysis
            attributes,
            // Original prospect data
            prospectData,
            recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update ICP patterns
        await updateIcpPatterns(userId, outcome, attributes);

        console.log(`[ICPRefiner] Recorded ${outcome} deal for user ${userId}`);

        // Return updated ICP insights
        return await getIcpInsights(userId);

    } catch (error) {
        console.error('[ICPRefiner] Failed to record deal:', error.message);
        throw error;
    }
}

/**
 * Extract and normalize prospect attributes
 */
function extractProspectAttributes(prospectData) {
    const {
        company,
        companySize,
        employeeCount,
        industry,
        location,
        contactName,
        contactTitle,
        department,
        useCase,
        painPoints,
        budget,
    } = prospectData;

    // Determine seniority
    const seniority = getSeniorityFromTitle(contactTitle);

    // Determine company size category
    const sizeCategory = getCompanySizeCategory(employeeCount || companySize);

    return {
        [ICP_CRITERIA.INDUSTRY]: industry?.toLowerCase() || null,
        [ICP_CRITERIA.COMPANY_SIZE]: sizeCategory?.key || null,
        [ICP_CRITERIA.TITLE_SENIORITY]: seniority?.key || null,
        [ICP_CRITERIA.DEPARTMENT]: department?.toLowerCase() || null,
        [ICP_CRITERIA.LOCATION]: location?.toLowerCase() || null,
        [ICP_CRITERIA.USE_CASE_MATCH]: useCase || null,
        [ICP_CRITERIA.PAIN_POINT_MATCH]: painPoints || null,
        // Raw values for deeper analysis
        _raw: {
            company,
            employeeCount,
            contactTitle,
            budget,
        },
    };
}

/**
 * Update ICP patterns based on deal outcome
 */
async function updateIcpPatterns(userId, outcome, attributes) {
    const patternsRef = db.collection('icpPatterns').doc(userId);
    const patternsDoc = await patternsRef.get();

    const isWin = outcome === DEAL_OUTCOMES.CLOSED_WON;
    const isLoss = [DEAL_OUTCOMES.CLOSED_LOST, DEAL_OUTCOMES.COMPETITOR_LOSS].includes(outcome);

    // Initialize patterns if needed
    let patterns = patternsDoc.exists ? patternsDoc.data() : {
        userId,
        totalDeals: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        // Attribute frequencies
        attributes: {},
        // Win/loss correlations
        winCorrelations: {},
        lossCorrelations: {},
        lastUpdated: null,
    };

    // Update totals
    patterns.totalDeals++;
    if (isWin) patterns.wins++;
    if (isLoss) patterns.losses++;
    patterns.winRate = patterns.wins / patterns.totalDeals;

    // Update attribute frequencies
    for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('_') || !value) continue;

        if (!patterns.attributes[key]) {
            patterns.attributes[key] = {};
        }

        const valueKey = String(value).toLowerCase();
        if (!patterns.attributes[key][valueKey]) {
            patterns.attributes[key][valueKey] = { total: 0, wins: 0, losses: 0 };
        }

        patterns.attributes[key][valueKey].total++;
        if (isWin) patterns.attributes[key][valueKey].wins++;
        if (isLoss) patterns.attributes[key][valueKey].losses++;
    }

    // Calculate correlations (which attributes correlate with wins/losses)
    patterns.winCorrelations = calculateCorrelations(patterns.attributes, 'wins');
    patterns.lossCorrelations = calculateCorrelations(patterns.attributes, 'losses');

    patterns.lastUpdated = admin.firestore.FieldValue.serverTimestamp();

    await patternsRef.set(patterns);
}

/**
 * Calculate attribute correlations with outcomes
 */
function calculateCorrelations(attributes, outcomeType) {
    const correlations = {};

    for (const [attrKey, values] of Object.entries(attributes)) {
        const attrCorrelations = [];

        for (const [value, counts] of Object.entries(values)) {
            if (counts.total < 2) continue; // Need at least 2 data points

            const rate = counts[outcomeType] / counts.total;
            if (rate > 0.5) { // More than 50% correlation
                attrCorrelations.push({
                    value,
                    rate: Math.round(rate * 100),
                    count: counts.total,
                });
            }
        }

        if (attrCorrelations.length > 0) {
            correlations[attrKey] = attrCorrelations
                .sort((a, b) => b.rate - a.rate)
                .slice(0, 3); // Top 3 values
        }
    }

    return correlations;
}

/**
 * Score a prospect against the refined ICP
 */
async function scoreProspect(userId, prospectData) {
    try {
        // Get user's ICP patterns
        const patternsDoc = await db.collection('icpPatterns').doc(userId).get();

        // Get user's custom ICP definition (if any)
        const icpDoc = await db.collection('icpDefinitions').doc(userId).get();
        const customIcp = icpDoc.exists ? icpDoc.data() : null;

        const patterns = patternsDoc.exists ? patternsDoc.data() : null;
        const attributes = extractProspectAttributes(prospectData);

        let score = 50; // Start at neutral
        const factors = [];
        const weights = customIcp?.weights || DEFAULT_ICP_WEIGHTS;

        // Score based on patterns (if we have data)
        if (patterns && patterns.totalDeals >= 5) {
            for (const [attrKey, value] of Object.entries(attributes)) {
                if (attrKey.startsWith('_') || !value) continue;

                const valueKey = String(value).toLowerCase();
                const attrPatterns = patterns.attributes[attrKey]?.[valueKey];

                if (attrPatterns && attrPatterns.total >= 2) {
                    const winRate = attrPatterns.wins / attrPatterns.total;
                    const weight = weights[attrKey] || 10;

                    // Adjust score based on historical win rate
                    const adjustment = (winRate - 0.5) * weight * 2;
                    score += adjustment;

                    factors.push({
                        attribute: attrKey,
                        value,
                        winRate: Math.round(winRate * 100),
                        impact: adjustment > 0 ? 'positive' : adjustment < 0 ? 'negative' : 'neutral',
                        adjustment: Math.round(adjustment),
                    });
                }
            }
        }

        // Also score against custom ICP criteria (if defined)
        if (customIcp?.criteria) {
            const icpMatch = scoreAgainstCustomIcp(attributes, customIcp.criteria);
            score = (score + icpMatch.score) / 2; // Average pattern score with ICP score
            factors.push(...icpMatch.factors);
        }

        // Clamp score to 0-100
        score = Math.max(0, Math.min(100, Math.round(score)));

        // Determine fit level
        let fitLevel = 'poor';
        if (score >= 80) fitLevel = 'excellent';
        else if (score >= 65) fitLevel = 'good';
        else if (score >= 50) fitLevel = 'moderate';
        else if (score >= 35) fitLevel = 'weak';

        return {
            score,
            fitLevel,
            factors,
            dataQuality: patterns?.totalDeals >= 10 ? 'high' :
                patterns?.totalDeals >= 5 ? 'medium' : 'low',
            recommendation: getScoreRecommendation(score, fitLevel, factors),
        };

    } catch (error) {
        console.error('[ICPRefiner] Failed to score prospect:', error.message);
        return {
            score: 50,
            fitLevel: 'unknown',
            factors: [],
            dataQuality: 'none',
            error: error.message,
        };
    }
}

/**
 * Score against custom ICP criteria
 */
function scoreAgainstCustomIcp(attributes, criteria) {
    let score = 50;
    const factors = [];

    for (const criterion of criteria) {
        const { attribute, targetValues, weight = 10, required = false } = criterion;
        const prospectValue = attributes[attribute];

        if (!prospectValue) {
            if (required) {
                score -= weight;
                factors.push({
                    attribute,
                    value: 'missing',
                    impact: 'negative',
                    adjustment: -weight,
                    reason: 'Required attribute missing',
                });
            }
            continue;
        }

        const valueMatch = targetValues?.some(tv =>
            String(prospectValue).toLowerCase().includes(tv.toLowerCase())
        );

        if (valueMatch) {
            score += weight;
            factors.push({
                attribute,
                value: prospectValue,
                impact: 'positive',
                adjustment: weight,
                reason: 'Matches ICP criteria',
            });
        } else if (required) {
            score -= weight / 2;
            factors.push({
                attribute,
                value: prospectValue,
                impact: 'negative',
                adjustment: -weight / 2,
                reason: 'Does not match required criteria',
            });
        }
    }

    return { score, factors };
}

/**
 * Get recommendation based on score
 */
function getScoreRecommendation(score, fitLevel, factors) {
    if (score >= 80) {
        return 'High-priority prospect. Matches your ideal customer profile well. Prioritize outreach.';
    } else if (score >= 65) {
        return 'Good fit. Worth pursuing. Focus on their specific pain points in your outreach.';
    } else if (score >= 50) {
        const negatives = factors.filter(f => f.impact === 'negative');
        if (negatives.length > 0) {
            return `Moderate fit. Watch for: ${negatives.map(n => n.attribute).join(', ')}. May require qualification.`;
        }
        return 'Moderate fit. Needs qualification to confirm alignment.';
    } else if (score >= 35) {
        return 'Weak fit. Consider if this is worth pursuing given your ICP.';
    } else {
        return 'Poor fit. Based on your historical data, this prospect type has low win rates.';
    }
}

/**
 * Get ICP insights and recommendations
 */
async function getIcpInsights(userId) {
    try {
        const patternsDoc = await db.collection('icpPatterns').doc(userId).get();

        if (!patternsDoc.exists) {
            return {
                hasData: false,
                message: 'Record some deal outcomes to start building ICP insights.',
                recommendations: [],
            };
        }

        const patterns = patternsDoc.data();

        if (patterns.totalDeals < 5) {
            return {
                hasData: true,
                dealsRecorded: patterns.totalDeals,
                message: `You have ${patterns.totalDeals} deals recorded. Record at least 5 for meaningful insights.`,
                winRate: patterns.winRate,
                recommendations: [],
            };
        }

        // Generate recommendations
        const recommendations = [];

        // Recommend winning attributes
        for (const [attr, correlations] of Object.entries(patterns.winCorrelations)) {
            for (const corr of correlations) {
                if (corr.rate >= 70 && corr.count >= 3) {
                    recommendations.push({
                        type: 'target',
                        attribute: attr,
                        value: corr.value,
                        reason: `${corr.rate}% win rate with ${corr.count} deals`,
                        priority: 'high',
                    });
                }
            }
        }

        // Warn about losing attributes
        for (const [attr, correlations] of Object.entries(patterns.lossCorrelations)) {
            for (const corr of correlations) {
                if (corr.rate >= 60 && corr.count >= 3) {
                    recommendations.push({
                        type: 'avoid',
                        attribute: attr,
                        value: corr.value,
                        reason: `${corr.rate}% loss rate with ${corr.count} deals`,
                        priority: 'medium',
                    });
                }
            }
        }

        return {
            hasData: true,
            dealsRecorded: patterns.totalDeals,
            winRate: Math.round(patterns.winRate * 100),
            wins: patterns.wins,
            losses: patterns.losses,
            winCorrelations: patterns.winCorrelations,
            lossCorrelations: patterns.lossCorrelations,
            recommendations: recommendations.slice(0, 10),
            lastUpdated: patterns.lastUpdated?.toDate() || null,
        };

    } catch (error) {
        console.error('[ICPRefiner] Failed to get ICP insights:', error.message);
        return { hasData: false, error: error.message };
    }
}

/**
 * Save custom ICP definition
 */
async function saveIcpDefinition(userId, icpDefinition) {
    const {
        name,
        description,
        criteria,
        weights,
        targetIndustries,
        targetCompanySizes,
        targetTitles,
        targetDepartments,
    } = icpDefinition;

    try {
        const icpRef = db.collection('icpDefinitions').doc(userId);
        await icpRef.set({
            userId,
            name: name || 'Default ICP',
            description: description || '',
            criteria: criteria || [],
            weights: weights || DEFAULT_ICP_WEIGHTS,
            targetIndustries: targetIndustries || [],
            targetCompanySizes: targetCompanySizes || [],
            targetTitles: targetTitles || [],
            targetDepartments: targetDepartments || [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return { success: true };

    } catch (error) {
        console.error('[ICPRefiner] Failed to save ICP definition:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Get custom ICP definition
 */
async function getIcpDefinition(userId) {
    try {
        const icpDoc = await db.collection('icpDefinitions').doc(userId).get();

        if (!icpDoc.exists) {
            return null;
        }

        return icpDoc.data();

    } catch (error) {
        console.error('[ICPRefiner] Failed to get ICP definition:', error.message);
        return null;
    }
}

module.exports = {
    DEFAULT_ICP_WEIGHTS,
    recordDealOutcome,
    scoreProspect,
    getIcpInsights,
    saveIcpDefinition,
    getIcpDefinition,
    extractProspectAttributes,
};
