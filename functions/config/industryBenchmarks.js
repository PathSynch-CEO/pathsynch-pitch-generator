/**
 * Industry Benchmarks Configuration
 *
 * ROI calculator data and conversion benchmarks by industry.
 * Used for value preview during onboarding and pitch ROI calculations.
 *
 * Data sources:
 * - Industry reports and market research
 * - SynchIntro customer data averages
 * - Sales benchmark studies
 *
 * @version 1.0.0
 * @created 2026-02-12
 */

// ============================================
// INDUSTRY BENCHMARKS
// ============================================

const INDUSTRY_BENCHMARKS = {
    // ============================================
    // FOOD & BEVERAGE
    // ============================================
    'Food & Beverage': {
        avgDealSize: 2500,
        avgDealSizeRange: { min: 500, max: 10000 },
        pitchToMeetingRate: 0.20,      // 20% of pitches result in meetings
        meetingToCloseRate: 0.30,       // 30% of meetings close
        avgSalesCycle: 14,              // days
        avgContractLength: 12,          // months
        ltv: 15000,                     // lifetime value
        notes: 'Includes catering contracts, distributor partnerships, corporate accounts'
    },
    'Full Service Restaurant': {
        avgDealSize: 3500,
        avgDealSizeRange: { min: 1000, max: 15000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.28,
        avgSalesCycle: 21,
        avgContractLength: 12,
        ltv: 20000,
        notes: 'Private events, catering, corporate partnerships'
    },
    'Fast Casual': {
        avgDealSize: 2000,
        avgDealSizeRange: { min: 500, max: 8000 },
        pitchToMeetingRate: 0.22,
        meetingToCloseRate: 0.32,
        avgSalesCycle: 10,
        avgContractLength: 6,
        ltv: 10000,
        notes: 'Corporate lunch accounts, catering'
    },
    'Coffee & Cafe': {
        avgDealSize: 1500,
        avgDealSizeRange: { min: 300, max: 5000 },
        pitchToMeetingRate: 0.25,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 7,
        avgContractLength: 6,
        ltv: 8000,
        notes: 'Wholesale accounts, office coffee, events'
    },

    // ============================================
    // TECHNOLOGY & SAAS
    // ============================================
    'Technology & SaaS': {
        avgDealSize: 15000,
        avgDealSizeRange: { min: 1000, max: 100000 },
        pitchToMeetingRate: 0.12,
        meetingToCloseRate: 0.22,
        avgSalesCycle: 45,
        avgContractLength: 12,
        ltv: 50000,
        notes: 'Annual contracts, enterprise deals'
    },
    'SaaS Products': {
        avgDealSize: 12000,
        avgDealSizeRange: { min: 500, max: 50000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 30,
        avgContractLength: 12,
        ltv: 45000,
        notes: 'Subscription-based, annual contracts typical'
    },
    'Software Development': {
        avgDealSize: 25000,
        avgDealSizeRange: { min: 5000, max: 150000 },
        pitchToMeetingRate: 0.10,
        meetingToCloseRate: 0.20,
        avgSalesCycle: 60,
        avgContractLength: 6,
        ltv: 75000,
        notes: 'Project-based, longer sales cycles'
    },
    'IT Services': {
        avgDealSize: 8000,
        avgDealSizeRange: { min: 1000, max: 50000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 30,
        avgContractLength: 12,
        ltv: 35000,
        notes: 'MSP contracts, support agreements'
    },

    // ============================================
    // HOME SERVICES
    // ============================================
    'Home Services': {
        avgDealSize: 5000,
        avgDealSizeRange: { min: 500, max: 25000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 14,
        avgContractLength: 12,
        ltv: 25000,
        notes: 'Commercial contracts, property management deals'
    },
    'Roofing': {
        avgDealSize: 12000,
        avgDealSizeRange: { min: 3000, max: 50000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.30,
        avgSalesCycle: 21,
        avgContractLength: 0,
        ltv: 15000,
        notes: 'Project-based, referral-driven'
    },
    'Residential Roofing': {
        avgDealSize: 10000,
        avgDealSizeRange: { min: 5000, max: 25000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.32,
        avgSalesCycle: 14,
        avgContractLength: 0,
        ltv: 12000,
        notes: 'Single project, referral potential'
    },
    'Commercial Roofing': {
        avgDealSize: 45000,
        avgDealSizeRange: { min: 15000, max: 200000 },
        pitchToMeetingRate: 0.10,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 60,
        avgContractLength: 0,
        ltv: 50000,
        notes: 'Larger projects, longer sales cycle'
    },
    'Plumbing & HVAC': {
        avgDealSize: 3000,
        avgDealSizeRange: { min: 500, max: 15000 },
        pitchToMeetingRate: 0.20,
        meetingToCloseRate: 0.40,
        avgSalesCycle: 7,
        avgContractLength: 12,
        ltv: 18000,
        notes: 'Maintenance contracts, emergency services'
    },
    'Electrical': {
        avgDealSize: 4000,
        avgDealSizeRange: { min: 500, max: 20000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 10,
        avgContractLength: 12,
        ltv: 20000,
        notes: 'Commercial contracts, property management'
    },
    'Landscaping': {
        avgDealSize: 2500,
        avgDealSizeRange: { min: 500, max: 10000 },
        pitchToMeetingRate: 0.22,
        meetingToCloseRate: 0.38,
        avgSalesCycle: 7,
        avgContractLength: 12,
        ltv: 15000,
        notes: 'Recurring maintenance contracts'
    },

    // ============================================
    // HEALTH & WELLNESS
    // ============================================
    'Health & Wellness': {
        avgDealSize: 3500,
        avgDealSizeRange: { min: 500, max: 20000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.30,
        avgSalesCycle: 21,
        avgContractLength: 12,
        ltv: 20000,
        notes: 'Corporate wellness, group memberships'
    },
    'Gym & Fitness': {
        avgDealSize: 5000,
        avgDealSizeRange: { min: 1000, max: 25000 },
        pitchToMeetingRate: 0.20,
        meetingToCloseRate: 0.32,
        avgSalesCycle: 14,
        avgContractLength: 12,
        ltv: 25000,
        notes: 'Corporate memberships, group training'
    },
    'Medical Practice': {
        avgDealSize: 8000,
        avgDealSizeRange: { min: 2000, max: 30000 },
        pitchToMeetingRate: 0.12,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 30,
        avgContractLength: 12,
        ltv: 40000,
        notes: 'Referral partnerships, employer health'
    },
    'Dental Practice': {
        avgDealSize: 6000,
        avgDealSizeRange: { min: 1500, max: 20000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.28,
        avgSalesCycle: 21,
        avgContractLength: 12,
        ltv: 30000,
        notes: 'Corporate dental plans, referral partnerships'
    },
    'Spa & Massage': {
        avgDealSize: 2500,
        avgDealSizeRange: { min: 500, max: 10000 },
        pitchToMeetingRate: 0.22,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 10,
        avgContractLength: 6,
        ltv: 12000,
        notes: 'Corporate wellness, hotel partnerships'
    },

    // ============================================
    // PROFESSIONAL SERVICES
    // ============================================
    'Professional Services': {
        avgDealSize: 8000,
        avgDealSizeRange: { min: 1000, max: 50000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.28,
        avgSalesCycle: 30,
        avgContractLength: 12,
        ltv: 40000,
        notes: 'Retainer agreements, project work'
    },
    'Legal': {
        avgDealSize: 12000,
        avgDealSizeRange: { min: 2000, max: 75000 },
        pitchToMeetingRate: 0.12,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 45,
        avgContractLength: 0,
        ltv: 35000,
        notes: 'Case-based, referral partnerships'
    },
    'Accounting': {
        avgDealSize: 6000,
        avgDealSizeRange: { min: 1000, max: 30000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.32,
        avgSalesCycle: 21,
        avgContractLength: 12,
        ltv: 30000,
        notes: 'Annual engagements, recurring work'
    },
    'Real Estate': {
        avgDealSize: 15000,
        avgDealSizeRange: { min: 3000, max: 100000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.20,
        avgSalesCycle: 60,
        avgContractLength: 0,
        ltv: 25000,
        notes: 'Commission-based, transaction-driven'
    },
    'Insurance': {
        avgDealSize: 4000,
        avgDealSizeRange: { min: 500, max: 25000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.30,
        avgSalesCycle: 21,
        avgContractLength: 12,
        ltv: 20000,
        notes: 'Annual premiums, commercial accounts'
    },

    // ============================================
    // RETAIL
    // ============================================
    'Retail': {
        avgDealSize: 5000,
        avgDealSizeRange: { min: 500, max: 30000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 21,
        avgContractLength: 6,
        ltv: 20000,
        notes: 'Wholesale partnerships, B2B accounts'
    },
    'General Merchandise': {
        avgDealSize: 4000,
        avgDealSizeRange: { min: 500, max: 20000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.28,
        avgSalesCycle: 14,
        avgContractLength: 6,
        ltv: 15000,
        notes: 'Wholesale accounts, corporate purchases'
    },

    // ============================================
    // AUTOMOTIVE
    // ============================================
    'Automotive': {
        avgDealSize: 6000,
        avgDealSizeRange: { min: 1000, max: 30000 },
        pitchToMeetingRate: 0.18,
        meetingToCloseRate: 0.32,
        avgSalesCycle: 14,
        avgContractLength: 12,
        ltv: 30000,
        notes: 'Fleet contracts, property management'
    },
    'Auto Repair': {
        avgDealSize: 5000,
        avgDealSizeRange: { min: 1000, max: 25000 },
        pitchToMeetingRate: 0.20,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 10,
        avgContractLength: 12,
        ltv: 25000,
        notes: 'Fleet maintenance contracts'
    },
    'Body Shop': {
        avgDealSize: 4000,
        avgDealSizeRange: { min: 1000, max: 15000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.30,
        avgSalesCycle: 14,
        avgContractLength: 12,
        ltv: 20000,
        notes: 'Insurance partnerships, fleet accounts'
    },
    'Car Dealership': {
        avgDealSize: 25000,
        avgDealSizeRange: { min: 5000, max: 100000 },
        pitchToMeetingRate: 0.10,
        meetingToCloseRate: 0.20,
        avgSalesCycle: 45,
        avgContractLength: 0,
        ltv: 50000,
        notes: 'Fleet sales, corporate accounts'
    },

    // ============================================
    // SALON & BEAUTY
    // ============================================
    'Salon & Beauty': {
        avgDealSize: 2000,
        avgDealSizeRange: { min: 300, max: 8000 },
        pitchToMeetingRate: 0.22,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 7,
        avgContractLength: 6,
        ltv: 10000,
        notes: 'Events, weddings, corporate accounts'
    },
    'Hair Salon': {
        avgDealSize: 2500,
        avgDealSizeRange: { min: 500, max: 10000 },
        pitchToMeetingRate: 0.22,
        meetingToCloseRate: 0.35,
        avgSalesCycle: 7,
        avgContractLength: 6,
        ltv: 12000,
        notes: 'Bridal, events, corporate wellness'
    },

    // ============================================
    // MANUFACTURING
    // ============================================
    'Manufacturing': {
        avgDealSize: 50000,
        avgDealSizeRange: { min: 10000, max: 500000 },
        pitchToMeetingRate: 0.08,
        meetingToCloseRate: 0.20,
        avgSalesCycle: 90,
        avgContractLength: 24,
        ltv: 150000,
        notes: 'OEM partnerships, long-term contracts'
    },
    'Machine Shop': {
        avgDealSize: 30000,
        avgDealSizeRange: { min: 5000, max: 200000 },
        pitchToMeetingRate: 0.10,
        meetingToCloseRate: 0.22,
        avgSalesCycle: 60,
        avgContractLength: 12,
        ltv: 100000,
        notes: 'Contract manufacturing, recurring orders'
    },

    // ============================================
    // EDUCATION & TRAINING
    // ============================================
    'Education & Training': {
        avgDealSize: 10000,
        avgDealSizeRange: { min: 1000, max: 75000 },
        pitchToMeetingRate: 0.15,
        meetingToCloseRate: 0.25,
        avgSalesCycle: 30,
        avgContractLength: 12,
        ltv: 40000,
        notes: 'Corporate training, institutional partnerships'
    },
    'Corporate Training': {
        avgDealSize: 15000,
        avgDealSizeRange: { min: 2000, max: 100000 },
        pitchToMeetingRate: 0.12,
        meetingToCloseRate: 0.22,
        avgSalesCycle: 45,
        avgContractLength: 12,
        ltv: 50000,
        notes: 'Enterprise training programs'
    }
};

// ============================================
// DEFAULT BENCHMARKS (FALLBACK)
// ============================================

const DEFAULT_BENCHMARKS = {
    avgDealSize: 5000,
    avgDealSizeRange: { min: 1000, max: 25000 },
    pitchToMeetingRate: 0.15,
    meetingToCloseRate: 0.25,
    avgSalesCycle: 21,
    avgContractLength: 12,
    ltv: 25000,
    notes: 'Default benchmarks for unspecified industries'
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get benchmarks for an industry/sub-industry
 * Falls back to parent industry, then to defaults
 * @param {string} industry - Primary industry
 * @param {string} subIndustry - Optional sub-industry
 * @returns {Object} Benchmark data
 */
function getBenchmarks(industry, subIndustry = null) {
    // Try sub-industry first
    if (subIndustry && INDUSTRY_BENCHMARKS[subIndustry]) {
        return INDUSTRY_BENCHMARKS[subIndustry];
    }

    // Fall back to industry
    if (INDUSTRY_BENCHMARKS[industry]) {
        return INDUSTRY_BENCHMARKS[industry];
    }

    // Return defaults
    return DEFAULT_BENCHMARKS;
}

/**
 * Calculate projected revenue based on pitch volume
 * @param {Object} params - Calculation parameters
 * @returns {Object} Projection results
 */
function calculateProjectedRevenue(params) {
    const {
        industry,
        subIndustry = null,
        pitchesPerMonth = 20,
        customDealSize = null,
        customMeetingRate = null,
        customCloseRate = null
    } = params;

    const benchmarks = getBenchmarks(industry, subIndustry);

    const avgDealSize = customDealSize || benchmarks.avgDealSize;
    const pitchToMeetingRate = customMeetingRate || benchmarks.pitchToMeetingRate;
    const meetingToCloseRate = customCloseRate || benchmarks.meetingToCloseRate;

    const meetingsPerMonth = pitchesPerMonth * pitchToMeetingRate;
    const dealsPerMonth = meetingsPerMonth * meetingToCloseRate;
    const revenuePerMonth = dealsPerMonth * avgDealSize;
    const revenuePerYear = revenuePerMonth * 12;

    return {
        inputs: {
            pitchesPerMonth,
            avgDealSize,
            pitchToMeetingRate,
            meetingToCloseRate
        },
        projections: {
            meetingsPerMonth: Math.round(meetingsPerMonth * 10) / 10,
            dealsPerMonth: Math.round(dealsPerMonth * 10) / 10,
            revenuePerMonth: Math.round(revenuePerMonth),
            revenuePerYear: Math.round(revenuePerYear)
        },
        benchmarks: {
            avgSalesCycle: benchmarks.avgSalesCycle,
            avgContractLength: benchmarks.avgContractLength,
            ltv: benchmarks.ltv
        }
    };
}

/**
 * Get the pitch volume tier label
 * @param {string} volume - Volume string (e.g., "1-5", "6-20")
 * @returns {number} Representative number for calculations
 */
function pitchVolumeToNumber(volume) {
    const mapping = {
        '1-5': 3,
        '6-20': 13,
        '21-50': 35,
        '50+': 75
    };
    return mapping[volume] || 20;
}

/**
 * Get industry-specific tips based on benchmarks
 * @param {string} industry - Industry name
 * @returns {Array} Tips for improving conversions
 */
function getIndustryTips(industry) {
    const benchmarks = getBenchmarks(industry);
    const tips = [];

    // Low meeting rate
    if (benchmarks.pitchToMeetingRate < 0.15) {
        tips.push({
            type: 'meeting_rate',
            message: 'Your industry has longer consideration cycles. Use Level 3 decks to stand out.',
            action: 'Try an Enterprise Deck'
        });
    }

    // Long sales cycle
    if (benchmarks.avgSalesCycle > 30) {
        tips.push({
            type: 'sales_cycle',
            message: 'Expect 30+ day sales cycles. Use follow-up sequences to stay top of mind.',
            action: 'Enable email follow-ups'
        });
    }

    // High deal value
    if (benchmarks.avgDealSize > 10000) {
        tips.push({
            type: 'deal_value',
            message: 'High-value deals benefit from detailed ROI analysis.',
            action: 'Include ROI calculator in pitches'
        });
    }

    return tips;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    INDUSTRY_BENCHMARKS,
    DEFAULT_BENCHMARKS,
    getBenchmarks,
    calculateProjectedRevenue,
    pitchVolumeToNumber,
    getIndustryTips
};
