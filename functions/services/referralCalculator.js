/**
 * Referral Calculator — Referral Potential Analysis for Card 5
 *
 * Calculates referral potential metrics for a business based on
 * industry benchmarks and market data. Used by Smart Mode card5
 * to ground the AI synthesis in exact figures.
 */

// Industry-specific referral rates (percentage of customers who refer)
const INDUSTRY_REFERRAL_RATES = {
    restaurant: 0.08,
    healthcare: 0.12,
    fitness: 0.15,
    retail: 0.06,
    home_services: 0.18,
    professional_services: 0.14,
    auto: 0.09,
    automotive: 0.09,
    dental: 0.12,
    hvac: 0.18,
    plumbing: 0.18,
    construction: 0.14,
    real_estate: 0.14,
    technology: 0.10,
    default: 0.10,
};

/**
 * Normalize industry string to a lookup key
 * @param {string} industry
 * @returns {string}
 */
function normalizeIndustry(industry) {
    if (!industry) return 'default';
    const lower = industry.toLowerCase().replace(/[^a-z_]/g, '_').replace(/_+/g, '_');

    // Direct match
    if (INDUSTRY_REFERRAL_RATES[lower]) return lower;

    // Partial matches
    if (lower.includes('restaurant') || lower.includes('food')) return 'restaurant';
    if (lower.includes('health') || lower.includes('medical') || lower.includes('dental')) return 'healthcare';
    if (lower.includes('fitness') || lower.includes('gym')) return 'fitness';
    if (lower.includes('retail') || lower.includes('store')) return 'retail';
    if (lower.includes('home') || lower.includes('plumb') || lower.includes('hvac') || lower.includes('clean')) return 'home_services';
    if (lower.includes('auto') || lower.includes('car') || lower.includes('mechanic')) return 'auto';
    if (lower.includes('real_estate') || lower.includes('realt')) return 'real_estate';
    if (lower.includes('tech') || lower.includes('software') || lower.includes('saas')) return 'technology';
    if (lower.includes('consult') || lower.includes('legal') || lower.includes('account') || lower.includes('financ')) return 'professional_services';
    if (lower.includes('construct')) return 'construction';

    return 'default';
}

/**
 * Calculate referral potential for a business
 *
 * @param {Object} marketData
 * @param {number} marketData.estimatedMonthlyCustomers - Monthly customer count
 * @param {number} marketData.avgTransaction - Average transaction value ($)
 * @param {number} [marketData.medianIncome] - Area median household income
 * @param {string} [marketData.industry] - Business industry
 * @returns {Object} Structured referral calculation data
 */
function calculateReferralPotential(marketData) {
    const {
        estimatedMonthlyCustomers = 100,
        avgTransaction = 100,
        medianIncome = 60000,
        industry = 'default',
    } = marketData || {};

    const industryKey = normalizeIndustry(industry);
    const referralRate = INDUSTRY_REFERRAL_RATES[industryKey] || INDUSTRY_REFERRAL_RATES.default;

    // Current organic referrals (without a program)
    const monthlyReferrals = Math.round(estimatedMonthlyCustomers * referralRate);

    // With an active referral program, expect 2.5x lift
    const potentialMonthlyReferrals = Math.round(monthlyReferrals * 2.5);

    // Lifetime value: avg transaction x 12 months x 2.5 year retention
    const ltv = avgTransaction * 12 * 2.5;

    // Annual revenue from new referral customers
    const annualRevenueUnlocked = potentialMonthlyReferrals * avgTransaction * 12;

    // LTV uplift from referral program
    const ltvUplift = estimatedMonthlyCustomers * 0.10 * ltv;

    // Recommended reward structure
    const recommendedReward = ltv > 500
        ? '$25 credit per referral'
        : '10% off next purchase';

    // Payback period: how many customers to break even on reward cost
    const paybackPeriod = Math.round(25 / (avgTransaction * referralRate)) + ' customers';

    // Net new customers per month from program
    const netNewMonthly = potentialMonthlyReferrals - monthlyReferrals;

    return {
        industry: industryKey,
        referralRate,
        referralRatePercent: (referralRate * 100).toFixed(1) + '%',
        monthlyReferrals,
        potentialMonthlyReferrals,
        netNewMonthly,
        ltv: Math.round(ltv),
        annualRevenueUnlocked: Math.round(annualRevenueUnlocked),
        ltvUplift: Math.round(ltvUplift),
        recommendedReward,
        paybackPeriod,
        estimatedMonthlyCustomers,
        avgTransaction,
        medianIncome,
    };
}

module.exports = {
    calculateReferralPotential,
    INDUSTRY_REFERRAL_RATES,
};
