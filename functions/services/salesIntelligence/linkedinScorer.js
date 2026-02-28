/**
 * LinkedIn Scorer
 *
 * Scores prospects based on their LinkedIn profile data
 * against the user's ICP (Ideal Customer Profile).
 *
 * Works with:
 * - ICP Refiner (for learned patterns)
 * - LinkedIn Agent (for profile comparison)
 * - Intent Hunter (for engagement signals)
 */

const admin = require('firebase-admin');
const {
    LINKEDIN_FACTORS,
    SENIORITY_LEVELS,
    COMPANY_SIZES,
    getSeniorityFromTitle,
    getCompanySizeCategory,
} = require('./signalTypes');
const { getIcpDefinition, scoreProspect: scoreAgainstIcp } = require('./icpRefiner');

const db = admin.firestore();

/**
 * LinkedIn scoring weights (default)
 */
const DEFAULT_LINKEDIN_WEIGHTS = {
    [LINKEDIN_FACTORS.TITLE_MATCH]: 25,
    [LINKEDIN_FACTORS.SENIORITY_LEVEL]: 20,
    [LINKEDIN_FACTORS.DECISION_MAKER]: 15,
    [LINKEDIN_FACTORS.COMPANY_SIZE_MATCH]: 15,
    [LINKEDIN_FACTORS.INDUSTRY_MATCH]: 15,
    [LINKEDIN_FACTORS.RELEVANT_EXPERIENCE]: 10,
};

/**
 * Decision maker title patterns
 */
const DECISION_MAKER_PATTERNS = [
    'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'ciso',
    'chief', 'president', 'owner', 'founder', 'co-founder',
    'vp', 'vice president', 'svp', 'evp',
    'director', 'head of',
    'partner', 'principal',
];

/**
 * Score a LinkedIn profile against user's ICP
 *
 * @param {string} userId - Seller's user ID
 * @param {object} linkedinProfile - Prospect's LinkedIn data
 * @returns {object} Score and breakdown
 */
async function scoreLinkedInProfile(userId, linkedinProfile) {
    const {
        headline,
        title,
        company,
        companySize,
        employeeCount,
        industry,
        location,
        education,
        careerHistory,
        skills,
        summary,
        yearsExperience,
    } = linkedinProfile;

    try {
        // Get user's ICP definition
        const icpDefinition = await getIcpDefinition(userId);
        const weights = icpDefinition?.weights || DEFAULT_LINKEDIN_WEIGHTS;

        let totalScore = 0;
        const factors = [];
        const maxPossibleScore = Object.values(weights).reduce((a, b) => a + b, 0);

        // 1. Title/Seniority Match
        const titleScore = scoreTitleMatch(title || headline, icpDefinition, weights);
        totalScore += titleScore.score;
        factors.push(titleScore);

        // 2. Decision Maker Check
        const dmScore = scoreDecisionMaker(title || headline, weights);
        totalScore += dmScore.score;
        factors.push(dmScore);

        // 3. Company Size Match
        const sizeScore = scoreCompanySize(employeeCount || companySize, icpDefinition, weights);
        totalScore += sizeScore.score;
        factors.push(sizeScore);

        // 4. Industry Match
        const industryScore = scoreIndustryMatch(industry, icpDefinition, weights);
        totalScore += industryScore.score;
        factors.push(industryScore);

        // 5. Relevant Experience
        const expScore = scoreRelevantExperience(careerHistory, skills, summary, icpDefinition, weights);
        totalScore += expScore.score;
        factors.push(expScore);

        // Normalize to 0-100
        const normalizedScore = Math.round((totalScore / maxPossibleScore) * 100);

        // Determine fit level
        let fitLevel = 'poor';
        if (normalizedScore >= 80) fitLevel = 'excellent';
        else if (normalizedScore >= 65) fitLevel = 'good';
        else if (normalizedScore >= 50) fitLevel = 'moderate';
        else if (normalizedScore >= 35) fitLevel = 'weak';

        // Also get ICP score if we have deal data
        let icpScore = null;
        try {
            icpScore = await scoreAgainstIcp(userId, {
                company,
                employeeCount,
                industry,
                location,
                contactTitle: title || headline,
            });
        } catch (e) {
            // ICP scoring is optional
        }

        // Combine scores if both available
        let combinedScore = normalizedScore;
        if (icpScore && icpScore.score && icpScore.dataQuality !== 'none') {
            // Weight: 60% LinkedIn, 40% ICP history
            combinedScore = Math.round(normalizedScore * 0.6 + icpScore.score * 0.4);
        }

        return {
            linkedinScore: normalizedScore,
            icpScore: icpScore?.score || null,
            combinedScore,
            fitLevel,
            factors: factors.filter(f => f.score > 0 || f.impact !== 'neutral'),
            breakdown: {
                title: titleScore,
                decisionMaker: dmScore,
                companySize: sizeScore,
                industry: industryScore,
                experience: expScore,
            },
            recommendation: getLinkedInRecommendation(normalizedScore, fitLevel, factors),
            icpDataQuality: icpScore?.dataQuality || 'none',
        };

    } catch (error) {
        console.error('[LinkedInScorer] Failed to score profile:', error.message);
        return {
            linkedinScore: null,
            error: error.message,
        };
    }
}

/**
 * Score title match against ICP
 */
function scoreTitleMatch(title, icpDefinition, weights) {
    const weight = weights[LINKEDIN_FACTORS.TITLE_MATCH] || 25;

    if (!title) {
        return {
            factor: LINKEDIN_FACTORS.TITLE_MATCH,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'No title available',
        };
    }

    const titleLower = title.toLowerCase();
    const targetTitles = icpDefinition?.targetTitles || [];

    // Check for exact match
    let matchScore = 0;
    let matchReason = 'No title match';

    if (targetTitles.length > 0) {
        for (const target of targetTitles) {
            if (titleLower.includes(target.toLowerCase())) {
                matchScore = weight;
                matchReason = `Matches target title: ${target}`;
                break;
            }
        }

        // Partial match for related titles
        if (matchScore === 0) {
            const seniority = getSeniorityFromTitle(title);
            if (['C_LEVEL', 'VP', 'DIRECTOR'].includes(seniority.key)) {
                matchScore = weight * 0.5;
                matchReason = `${seniority.label} role (partial match)`;
            }
        }
    } else {
        // No target titles defined, score based on seniority
        const seniority = getSeniorityFromTitle(title);
        matchScore = (seniority.weight / 100) * weight;
        matchReason = `${seniority.label} seniority`;
    }

    return {
        factor: LINKEDIN_FACTORS.TITLE_MATCH,
        score: matchScore,
        maxScore: weight,
        value: title,
        impact: matchScore >= weight * 0.5 ? 'positive' : 'neutral',
        reason: matchReason,
    };
}

/**
 * Score decision maker status
 */
function scoreDecisionMaker(title, weights) {
    const weight = weights[LINKEDIN_FACTORS.DECISION_MAKER] || 15;

    if (!title) {
        return {
            factor: LINKEDIN_FACTORS.DECISION_MAKER,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'No title available',
        };
    }

    const titleLower = title.toLowerCase();
    const isDecisionMaker = DECISION_MAKER_PATTERNS.some(pattern =>
        titleLower.includes(pattern)
    );

    return {
        factor: LINKEDIN_FACTORS.DECISION_MAKER,
        score: isDecisionMaker ? weight : 0,
        maxScore: weight,
        value: isDecisionMaker,
        impact: isDecisionMaker ? 'positive' : 'neutral',
        reason: isDecisionMaker ? 'Likely decision maker' : 'May need to reach decision maker',
    };
}

/**
 * Score company size match
 */
function scoreCompanySize(size, icpDefinition, weights) {
    const weight = weights[LINKEDIN_FACTORS.COMPANY_SIZE_MATCH] || 15;

    if (!size) {
        return {
            factor: LINKEDIN_FACTORS.COMPANY_SIZE_MATCH,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'Company size unknown',
        };
    }

    const sizeCategory = getCompanySizeCategory(
        typeof size === 'number' ? size : parseInt(size) || 0
    );

    if (!sizeCategory) {
        return {
            factor: LINKEDIN_FACTORS.COMPANY_SIZE_MATCH,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'Could not determine company size',
        };
    }

    const targetSizes = icpDefinition?.targetCompanySizes || [];

    if (targetSizes.length > 0) {
        const isMatch = targetSizes.includes(sizeCategory.key);
        return {
            factor: LINKEDIN_FACTORS.COMPANY_SIZE_MATCH,
            score: isMatch ? weight : weight * 0.3,
            maxScore: weight,
            value: sizeCategory.label,
            impact: isMatch ? 'positive' : 'negative',
            reason: isMatch ? `Matches target size: ${sizeCategory.label}` : `${sizeCategory.label} not in target sizes`,
        };
    }

    // No target sizes defined, score based on general desirability
    const baseScore = (sizeCategory.weight / 100) * weight;
    return {
        factor: LINKEDIN_FACTORS.COMPANY_SIZE_MATCH,
        score: baseScore,
        maxScore: weight,
        value: sizeCategory.label,
        impact: 'neutral',
        reason: `${sizeCategory.label} company`,
    };
}

/**
 * Score industry match
 */
function scoreIndustryMatch(industry, icpDefinition, weights) {
    const weight = weights[LINKEDIN_FACTORS.INDUSTRY_MATCH] || 15;

    if (!industry) {
        return {
            factor: LINKEDIN_FACTORS.INDUSTRY_MATCH,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'Industry unknown',
        };
    }

    const industryLower = industry.toLowerCase();
    const targetIndustries = icpDefinition?.targetIndustries || [];

    if (targetIndustries.length > 0) {
        const isMatch = targetIndustries.some(target =>
            industryLower.includes(target.toLowerCase()) ||
            target.toLowerCase().includes(industryLower)
        );

        return {
            factor: LINKEDIN_FACTORS.INDUSTRY_MATCH,
            score: isMatch ? weight : weight * 0.2,
            maxScore: weight,
            value: industry,
            impact: isMatch ? 'positive' : 'negative',
            reason: isMatch ? `Matches target industry` : `${industry} not in target industries`,
        };
    }

    // No target industries defined
    return {
        factor: LINKEDIN_FACTORS.INDUSTRY_MATCH,
        score: weight * 0.5,
        maxScore: weight,
        value: industry,
        impact: 'neutral',
        reason: `Industry: ${industry}`,
    };
}

/**
 * Score relevant experience
 */
function scoreRelevantExperience(careerHistory, skills, summary, icpDefinition, weights) {
    const weight = weights[LINKEDIN_FACTORS.RELEVANT_EXPERIENCE] || 10;

    // Combine all text for keyword analysis
    const allText = [
        ...(careerHistory || []).map(c => typeof c === 'string' ? c : `${c.title} at ${c.company}`),
        ...(skills || []),
        summary || '',
    ].join(' ').toLowerCase();

    if (!allText || allText.length < 20) {
        return {
            factor: LINKEDIN_FACTORS.RELEVANT_EXPERIENCE,
            score: 0,
            maxScore: weight,
            impact: 'neutral',
            reason: 'Insufficient profile data',
        };
    }

    // Check for relevant keywords (could be customized per user)
    const relevantKeywords = icpDefinition?.relevantKeywords || [
        'sales', 'marketing', 'growth', 'revenue', 'business development',
        'strategy', 'operations', 'technology', 'digital', 'transformation',
    ];

    const matchedKeywords = relevantKeywords.filter(kw =>
        allText.includes(kw.toLowerCase())
    );

    const matchRatio = matchedKeywords.length / Math.min(relevantKeywords.length, 5);
    const score = Math.min(weight, weight * matchRatio * 1.5); // Can exceed 100% for many matches

    return {
        factor: LINKEDIN_FACTORS.RELEVANT_EXPERIENCE,
        score,
        maxScore: weight,
        value: matchedKeywords.slice(0, 3).join(', '),
        impact: score >= weight * 0.5 ? 'positive' : 'neutral',
        reason: matchedKeywords.length > 0
            ? `Relevant experience: ${matchedKeywords.slice(0, 3).join(', ')}`
            : 'No relevant keywords found',
    };
}

/**
 * Get recommendation based on LinkedIn score
 */
function getLinkedInRecommendation(score, fitLevel, factors) {
    const positiveFactors = factors.filter(f => f.impact === 'positive');
    const negativeFactors = factors.filter(f => f.impact === 'negative');

    if (score >= 80) {
        return `Excellent LinkedIn fit. Strong match on: ${positiveFactors.map(f => f.factor).join(', ')}. Prioritize outreach.`;
    } else if (score >= 65) {
        return `Good LinkedIn fit. ${positiveFactors.length > 0 ? `Strengths: ${positiveFactors[0].reason}` : 'Worth pursuing.'}`
    } else if (score >= 50) {
        const concern = negativeFactors[0]?.reason || 'May need qualification';
        return `Moderate fit. Note: ${concern}`;
    } else if (score >= 35) {
        return `Weak LinkedIn fit. ${negativeFactors.length > 0 ? negativeFactors[0].reason : 'Consider if worth pursuing.'}`;
    } else {
        return 'Poor LinkedIn fit. Profile does not match your typical winning customers.';
    }
}

/**
 * Batch score multiple LinkedIn profiles
 */
async function batchScoreProfiles(userId, profiles) {
    const results = [];

    for (const profile of profiles) {
        const score = await scoreLinkedInProfile(userId, profile);
        results.push({
            profile: {
                name: profile.name,
                title: profile.title || profile.headline,
                company: profile.company,
            },
            ...score,
        });
    }

    // Sort by combined score descending
    results.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

    return results;
}

/**
 * Get scoring summary for a user
 */
async function getScoringStats(userId) {
    // This would track historical scoring data
    // For now, return the ICP definition status

    const icpDefinition = await getIcpDefinition(userId);

    return {
        hasIcpDefinition: !!icpDefinition,
        targetIndustries: icpDefinition?.targetIndustries?.length || 0,
        targetTitles: icpDefinition?.targetTitles?.length || 0,
        targetCompanySizes: icpDefinition?.targetCompanySizes?.length || 0,
        lastUpdated: icpDefinition?.updatedAt?.toDate() || null,
    };
}

module.exports = {
    DEFAULT_LINKEDIN_WEIGHTS,
    DECISION_MAKER_PATTERNS,
    scoreLinkedInProfile,
    batchScoreProfiles,
    getScoringStats,
    scoreTitleMatch,
    scoreDecisionMaker,
    scoreCompanySize,
    scoreIndustryMatch,
};
