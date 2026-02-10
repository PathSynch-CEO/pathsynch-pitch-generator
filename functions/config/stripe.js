/**
 * Stripe Configuration
 *
 * Plan definitions and Stripe price mappings
 */

const PLANS = {
    starter: {
        name: 'Starter',
        price: 19,
        priceAnnual: 15,
        stripePriceId: process.env.STRIPE_PRICE_STARTER || 'price_1Sw3xHCwhZJHjP6KtttBfis5',
        limits: {
            teamMembers: 1,  // Max team members (including owner)
            pitchesPerMonth: 10,
            icpLimit: 1,     // Max ICP personas
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
            '1 user',
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
        priceAnnual: 39,
        stripePriceId: process.env.STRIPE_PRICE_GROWTH || 'price_1Sw3ytCwhZJHjP6K0z0QzKIY',
        limits: {
            teamMembers: 3,  // Max team members (including owner)
            pitchesPerMonth: 100,
            icpLimit: 3,     // Max ICP personas
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
            'Up to 3 team members',
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
        price: 99,
        priceAnnual: 79,
        stripePriceId: process.env.STRIPE_PRICE_SCALE || 'price_1Sw3zKCwhZJHjP6KLl7Xk9xy',
        limits: {
            teamMembers: 5,  // Max team members (including owner)
            pitchesPerMonth: -1, // Unlimited
            icpLimit: 6,     // Max ICP personas
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
            'Up to 5 team members',
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
    },
    enterprise: {
        name: 'Enterprise',
        price: 89,
        priceAnnual: 71,
        stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || 'price_1Sw3zoCwhZJHjP6K105NsAtg',
        limits: {
            teamMembers: -1, // Unlimited
            pitchesPerMonth: -1, // Unlimited
            icpLimit: -1,     // Unlimited ICP personas
            bulkUploadRows: 500,
            marketReportsPerMonth: -1, // Unlimited
            pptExport: true,
            whiteLabel: true,
            // Narrative pipeline limits
            narrativesPerMonth: -1, // Unlimited
            formatters: ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'deck', 'proposal'],
            batchFormat: true,
            aiRegenerations: -1, // Unlimited
            // Enterprise-only features
            precallForms: true,
            investorUpdates: true,
            integrations: ['stripe', 'shopify', 'quickbooks', 'ga4'],
            customBranding: true,
            apiAccess: true,
            ssoEnabled: true,
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
            'Unlimited team members',
            'Unlimited pitches',
            'Unlimited AI narratives',
            'Unlimited market reports',
            'All formatter types',
            'Bulk CSV upload (500 rows)',
            'Pre-call qualification forms',
            'Investor update reports',
            'Stripe/Shopify/QuickBooks/GA4 integrations',
            'Custom branding',
            'API access',
            'SSO authentication',
            'Dedicated account manager',
            'Priority support (24/7)',
            'Custom integrations available'
        ]
    }
};

// Team role definitions
const TEAM_ROLES = {
    owner: {
        name: 'Owner',
        description: 'Full access. Can manage billing, team, and all settings.',
        permissions: ['manage_billing', 'manage_team', 'manage_settings', 'create_pitches', 'view_analytics', 'manage_pitches']
    },
    admin: {
        name: 'Admin',
        description: 'Can manage team and settings, but not billing.',
        permissions: ['manage_team', 'manage_settings', 'create_pitches', 'view_analytics', 'manage_pitches']
    },
    manager: {
        name: 'Manager',
        description: 'Can create and manage pitches, view analytics.',
        permissions: ['create_pitches', 'view_analytics', 'manage_pitches']
    },
    member: {
        name: 'Member',
        description: 'Can create pitches and view own analytics.',
        permissions: ['create_pitches', 'view_own_analytics']
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
        case 'precallForms':
            return limits.precallForms === true;
        case 'investorUpdates':
            return limits.investorUpdates === true;
        case 'integrations':
            return Array.isArray(limits.integrations) && limits.integrations.length > 0;
        case 'apiAccess':
            return limits.apiAccess === true;
        case 'ssoEnabled':
            return limits.ssoEnabled === true;
        default:
            return false;
    }
}

// Check if user has access to a specific integration
function hasIntegration(planName, provider) {
    const limits = getPlanLimits(planName);
    if (!Array.isArray(limits.integrations)) return false;
    return limits.integrations.includes(provider);
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

// Check if user has permission based on role
function hasPermission(role, permission) {
    const roleConfig = TEAM_ROLES[role];
    if (!roleConfig) return false;
    return roleConfig.permissions.includes(permission);
}

module.exports = {
    PLANS,
    TEAM_ROLES,
    getPlanLimits,
    getPlanByPriceId,
    hasFeature,
    hasIntegration,
    isWithinLimits,
    hasPermission
};
