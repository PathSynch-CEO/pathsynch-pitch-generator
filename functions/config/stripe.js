/**
 * Stripe Configuration
 *
 * Plan definitions and Stripe price mappings
 */

const PLANS = {
    starter: {
        name: 'Starter',
        price: 0,
        stripePriceId: null, // Free plan, no Stripe price
        limits: {
            pitchesPerMonth: 10,
            bulkUploadRows: 5,
            marketReportsPerMonth: 0,
            pptExport: false,
            whiteLabel: false,
            // Narrative pipeline limits
            narrativesPerMonth: 5,
            formatters: ['sales_pitch', 'one_pager'],
            batchFormat: false,
            aiRegenerations: 2,
            // Market intelligence features
            marketFeatures: {
                basicDemographics: true,
                detailedDemographics: false,
                ageDistribution: false,
                educationProfile: false,
                commutePatterns: false,
                opportunityScore: false,
                establishmentTrend: false,
                recommendations: false,
                visualizations: false,
                pdfExport: false,
                pitchIntegration: false
            }
        },
        features: [
            '10 pitches per month',
            '5 AI narratives per month',
            'Level 1-3 templates',
            'Sales pitch & one-pager formatters',
            'Basic analytics',
            'Email support'
        ]
    },
    growth: {
        name: 'Growth',
        price: 49,
        stripePriceId: process.env.STRIPE_PRICE_GROWTH || 'price_growth',
        limits: {
            pitchesPerMonth: 100,
            bulkUploadRows: 50,
            marketReportsPerMonth: 5,
            pptExport: false,
            whiteLabel: true,
            // Narrative pipeline limits
            narrativesPerMonth: 25,
            formatters: ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary'],
            batchFormat: 3,
            aiRegenerations: 10,
            // Market intelligence features
            marketFeatures: {
                basicDemographics: true,
                detailedDemographics: true,
                ageDistribution: true,
                educationProfile: true,
                commutePatterns: true,
                opportunityScore: true,
                establishmentTrend: true,
                recommendations: true,
                visualizations: true,
                pdfExport: false,
                pitchIntegration: false
            }
        },
        features: [
            '100 pitches per month',
            '25 AI narratives per month',
            'Bulk CSV upload (50 rows)',
            '5 market reports per month',
            '5 formatter types + batch (3)',
            'White-label branding',
            'Priority support',
            'Opportunity scoring',
            'Demographic analysis',
            'Market recommendations'
        ]
    },
    scale: {
        name: 'Scale',
        price: 149,
        stripePriceId: process.env.STRIPE_PRICE_SCALE || 'price_scale',
        limits: {
            pitchesPerMonth: -1, // Unlimited
            bulkUploadRows: 100,
            marketReportsPerMonth: 20,
            pptExport: true,
            whiteLabel: true,
            // Narrative pipeline limits
            narrativesPerMonth: -1, // Unlimited
            formatters: ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'deck', 'proposal'],
            batchFormat: true,
            aiRegenerations: -1, // Unlimited
            // Market intelligence features
            marketFeatures: {
                basicDemographics: true,
                detailedDemographics: true,
                ageDistribution: true,
                educationProfile: true,
                commutePatterns: true,
                opportunityScore: true,
                establishmentTrend: true,
                recommendations: true,
                visualizations: true,
                pdfExport: true,
                pitchIntegration: true
            }
        },
        features: [
            'Unlimited pitches',
            'Unlimited AI narratives',
            'All 7 formatter types',
            'Bulk CSV upload (100 rows)',
            '20 market reports per month',
            'PPT/Slides export',
            'Deck & proposal formatters',
            'White-label branding',
            'Dedicated support',
            'PDF market reports',
            'Pitch deck integration'
        ]
    }
};

// Get plan limits by plan name
function getPlanLimits(planName) {
    const plan = PLANS[planName] || PLANS.starter;
    return plan.limits;
}

// Get plan by Stripe price ID
function getPlanByPriceId(priceId) {
    for (const [planName, plan] of Object.entries(PLANS)) {
        if (plan.stripePriceId === priceId) {
            return { name: planName, ...plan };
        }
    }
    return null;
}

// Check if a feature is available for a plan
function hasFeature(planName, feature) {
    const limits = getPlanLimits(planName);
    switch (feature) {
        case 'pptExport':
            return limits.pptExport === true;
        case 'whiteLabel':
            return limits.whiteLabel === true;
        case 'bulkUpload':
            return limits.bulkUploadRows > 0;
        case 'marketReports':
            return limits.marketReportsPerMonth > 0;
        default:
            return false;
    }
}

// Check if usage is within plan limits
function isWithinLimits(planName, usageType, currentUsage) {
    const limits = getPlanLimits(planName);

    switch (usageType) {
        case 'pitches':
            return limits.pitchesPerMonth === -1 || currentUsage < limits.pitchesPerMonth;
        case 'bulkUploadRows':
            return currentUsage <= limits.bulkUploadRows;
        case 'marketReports':
            return currentUsage < limits.marketReportsPerMonth;
        default:
            return false;
    }
}

module.exports = {
    PLANS,
    getPlanLimits,
    getPlanByPriceId,
    hasFeature,
    isWithinLimits
};
