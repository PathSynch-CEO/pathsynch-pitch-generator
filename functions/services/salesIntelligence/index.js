/**
 * Sales Intelligence Module
 *
 * The Trifecta: Intent Hunter + ICP Refiner + LinkedIn Scorer
 *
 * These three components work together to identify, qualify, and
 * prioritize prospects for the Custom Sales Library.
 *
 * Intent Hunter: WHO is showing interest
 * ICP Refiner: Are they a GOOD FIT (learns from wins/losses)
 * LinkedIn Scorer: Is the PERSON right (validates against ICP)
 */

// Import all modules
const intentHunter = require('./intentHunter');
const icpRefiner = require('./icpRefiner');
const linkedinScorer = require('./linkedinScorer');
const signalTypes = require('./signalTypes');

/**
 * Comprehensive prospect analysis
 * Combines all three intelligence sources
 *
 * @param {string} userId - Seller's user ID
 * @param {object} prospect - Prospect data
 * @returns {object} Combined intelligence report
 */
async function analyzeProspect(userId, prospect) {
    const {
        email,
        company,
        companySize,
        employeeCount,
        industry,
        location,
        contactName,
        contactTitle,
        linkedinProfile,
    } = prospect;

    const analysis = {
        prospect: { email, company, contactName, contactTitle },
        timestamp: new Date().toISOString(),
        scores: {},
        recommendation: null,
        priority: null,
    };

    // 1. Get intent score (if we have tracked signals)
    try {
        const intentSummary = await intentHunter.getIntentSummary(userId);
        if (intentSummary?.topProspects) {
            const matchedProspect = intentSummary.topProspects.find(p =>
                p.email?.toLowerCase() === email?.toLowerCase() ||
                p.company?.toLowerCase() === company?.toLowerCase()
            );
            if (matchedProspect) {
                analysis.scores.intent = {
                    score: matchedProspect.score,
                    level: matchedProspect.level,
                };
            }
        }
    } catch (e) {
        console.warn('[SalesIntelligence] Intent analysis failed:', e.message);
    }

    // 2. Get ICP score (based on deal history)
    try {
        const icpScore = await icpRefiner.scoreProspect(userId, {
            company,
            employeeCount: employeeCount || companySize,
            industry,
            location,
            contactTitle,
        });
        analysis.scores.icp = {
            score: icpScore.score,
            fitLevel: icpScore.fitLevel,
            factors: icpScore.factors?.slice(0, 3),
            dataQuality: icpScore.dataQuality,
        };
    } catch (e) {
        console.warn('[SalesIntelligence] ICP analysis failed:', e.message);
    }

    // 3. Get LinkedIn score (if profile data available)
    if (linkedinProfile || contactTitle) {
        try {
            const linkedinScore = await linkedinScorer.scoreLinkedInProfile(userId, {
                headline: contactTitle,
                title: linkedinProfile?.title || contactTitle,
                company,
                companySize: employeeCount || companySize,
                industry,
                location,
                careerHistory: linkedinProfile?.careerHistory,
                skills: linkedinProfile?.skills,
                summary: linkedinProfile?.summary,
            });
            analysis.scores.linkedin = {
                score: linkedinScore.linkedinScore,
                fitLevel: linkedinScore.fitLevel,
                factors: linkedinScore.factors?.slice(0, 3),
            };
        } catch (e) {
            console.warn('[SalesIntelligence] LinkedIn analysis failed:', e.message);
        }
    }

    // Calculate combined priority score
    analysis.priority = calculatePriorityScore(analysis.scores);

    // Generate overall recommendation
    analysis.recommendation = generateOverallRecommendation(analysis);

    return analysis;
}

/**
 * Calculate priority score from all intelligence sources
 */
function calculatePriorityScore(scores) {
    let totalWeight = 0;
    let weightedScore = 0;

    // Intent score (weight: 40% if available)
    if (scores.intent?.score) {
        const intentNormalized = Math.min(100, scores.intent.score / 1.5); // Normalize to ~100
        weightedScore += intentNormalized * 0.4;
        totalWeight += 0.4;
    }

    // ICP score (weight: 35% if available)
    if (scores.icp?.score) {
        weightedScore += scores.icp.score * 0.35;
        totalWeight += 0.35;
    }

    // LinkedIn score (weight: 25% if available)
    if (scores.linkedin?.score) {
        weightedScore += scores.linkedin.score * 0.25;
        totalWeight += 0.25;
    }

    if (totalWeight === 0) {
        return { score: null, level: 'unknown', dataAvailable: false };
    }

    // Normalize to account for missing data
    const normalizedScore = Math.round(weightedScore / totalWeight);

    let level = 'low';
    if (normalizedScore >= 80) level = 'critical';
    else if (normalizedScore >= 65) level = 'high';
    else if (normalizedScore >= 50) level = 'medium';

    return {
        score: normalizedScore,
        level,
        dataAvailable: true,
        breakdown: {
            intent: scores.intent?.score ? Math.round(scores.intent.score / 1.5) : null,
            icp: scores.icp?.score || null,
            linkedin: scores.linkedin?.score || null,
        },
    };
}

/**
 * Generate overall recommendation
 */
function generateOverallRecommendation(analysis) {
    const { scores, priority } = analysis;

    if (!priority.dataAvailable) {
        return {
            action: 'gather_data',
            message: 'Insufficient data for analysis. Track engagement signals or record deal outcomes.',
            urgency: 'low',
        };
    }

    // High intent + good fit = hot lead
    if (scores.intent?.level === 'hot' && scores.icp?.fitLevel === 'good') {
        return {
            action: 'immediate_outreach',
            message: 'Hot lead! High engagement + good ICP fit. Reach out immediately.',
            urgency: 'critical',
        };
    }

    // Good LinkedIn + good ICP but no intent = proactive outreach
    if (scores.linkedin?.fitLevel === 'good' && scores.icp?.fitLevel === 'good' && !scores.intent) {
        return {
            action: 'proactive_outreach',
            message: 'Strong profile fit. Consider proactive outreach with personalized message.',
            urgency: 'high',
        };
    }

    // High intent but poor fit = qualify carefully
    if (scores.intent?.level === 'hot' && scores.icp?.fitLevel === 'poor') {
        return {
            action: 'qualify',
            message: 'Showing interest but poor historical fit. Qualify carefully before investing time.',
            urgency: 'medium',
        };
    }

    // Good fit but no engagement = nurture
    if ((scores.icp?.fitLevel === 'good' || scores.linkedin?.fitLevel === 'good') &&
        (!scores.intent || scores.intent.level === 'cold')) {
        return {
            action: 'nurture',
            message: 'Good fit but low engagement. Add to nurture campaign.',
            urgency: 'low',
        };
    }

    // Default
    return {
        action: 'monitor',
        message: `Priority score: ${priority.score}. Continue monitoring for signals.`,
        urgency: priority.level,
    };
}

/**
 * Get dashboard data for sales intelligence
 */
async function getDashboard(userId) {
    try {
        const [intentSummary, icpInsights, scoringStats] = await Promise.all([
            intentHunter.getIntentSummary(userId),
            icpRefiner.getIcpInsights(userId),
            linkedinScorer.getScoringStats(userId),
        ]);

        return {
            intent: intentSummary,
            icp: icpInsights,
            linkedin: scoringStats,
            trifectaReady: !!(
                intentSummary?.total > 0 ||
                icpInsights?.dealsRecorded >= 5 ||
                scoringStats?.hasIcpDefinition
            ),
        };

    } catch (error) {
        console.error('[SalesIntelligence] Dashboard failed:', error.message);
        return { error: error.message };
    }
}

module.exports = {
    // Main analysis function
    analyzeProspect,
    getDashboard,

    // Intent Hunter
    intentHunter: {
        recordSignal: intentHunter.recordSignal,
        getHotProspects: intentHunter.getHotProspects,
        getProspectTimeline: intentHunter.getProspectTimeline,
        getIntentSummary: intentHunter.getIntentSummary,
        bulkImportSignals: intentHunter.bulkImportSignals,
        INTENT_THRESHOLDS: intentHunter.INTENT_THRESHOLDS,
    },

    // ICP Refiner
    icpRefiner: {
        recordDealOutcome: icpRefiner.recordDealOutcome,
        scoreProspect: icpRefiner.scoreProspect,
        getIcpInsights: icpRefiner.getIcpInsights,
        saveIcpDefinition: icpRefiner.saveIcpDefinition,
        getIcpDefinition: icpRefiner.getIcpDefinition,
    },

    // LinkedIn Scorer
    linkedinScorer: {
        scoreLinkedInProfile: linkedinScorer.scoreLinkedInProfile,
        batchScoreProfiles: linkedinScorer.batchScoreProfiles,
        getScoringStats: linkedinScorer.getScoringStats,
    },

    // Signal types and constants
    signalTypes,
};
