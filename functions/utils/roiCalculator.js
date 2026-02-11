/**
 * ROI Calculator Utility
 *
 * Shared ROI calculation logic used across pitch generation and narratives.
 * Single source of truth for all ROI-related calculations.
 *
 * Growth rates and repeat rates are now industry-configurable via naics.js
 */

const naics = require('../config/naics');

// PathSynch pricing constants
const PATHSYNCH_MONTHLY_COST = 168;

// Default growth rate (conservative 20% instead of 30%)
const DEFAULT_GROWTH_RATE = 0.20;

/**
 * Calculate ROI data for pitch generation (template-based)
 * Uses CONSERVATIVE model - only counts revenue from NEW customers
 * Does NOT assume changes in existing customer behavior
 *
 * @param {object} inputs - Business input data
 * @param {string} [naicsCode] - Optional NAICS code for industry-specific growth rate
 * @returns {object} ROI data for pitch templates
 */
function calculatePitchROI(inputs, naicsCode = null) {
    // Get industry defaults if we have a NAICS code
    const industryDefaults = naicsCode ? naics.getIndustryDefaults(naicsCode) : null;

    // Use inputs first, then industry defaults, then fallbacks
    const monthlyCustomers = parseInt(inputs.monthlyVisits) ||
        (industryDefaults?.monthlyCustomers) || 200;
    const avgTicket = parseFloat(inputs.avgTransaction) ||
        parseFloat(inputs.avgTicket) ||
        (industryDefaults?.avgTransaction) || 50;

    // Get industry-specific growth rate, fallback to 20%
    const growthRate = industryDefaults?.customerGrowthRate || DEFAULT_GROWTH_RATE;

    // NEW CUSTOMER repeat rate - industry-specific from naics.js
    // e.g., Coffee shops 65%, Auto repair 20%, Gyms 75%
    const newCustomerRepeatRate = industryDefaults?.newCustomerRepeatRate || 0.25;

    // ============================================
    // CONSERVATIVE INCREMENTAL REVENUE MODEL
    // Only counts revenue from NEW customers
    // Does NOT assume changes in existing customer behavior
    // ============================================

    // New customers acquired through PathSynch
    const newCustomers = Math.round(monthlyCustomers * growthRate);

    // Revenue from new customers (first visit)
    const newCustomerRevenue = newCustomers * avgTicket;

    // Repeat revenue from new customers only (industry-specific rate)
    const repeatCustomersFromNew = Math.round(newCustomers * newCustomerRepeatRate * 10) / 10; // e.g., 7.5
    const repeatRevenue = repeatCustomersFromNew * avgTicket;

    // Total monthly incremental revenue (conservative)
    const monthlyIncrementalRevenue = Math.round(newCustomerRevenue + repeatRevenue);
    const sixMonthRevenue = monthlyIncrementalRevenue * 6;

    // Total customers after improvement (for display)
    const improvedCustomers = monthlyCustomers + newCustomers;

    // Cost and ROI
    const sixMonthCost = PATHSYNCH_MONTHLY_COST * 6;
    const roi = Math.round(((sixMonthRevenue - sixMonthCost) / sixMonthCost) * 100);

    return {
        // Customer metrics
        monthlyVisits: monthlyCustomers,  // Keep old name for template compatibility
        monthlyCustomers,
        newCustomers,
        improvedVisits: improvedCustomers,  // Keep old name for template compatibility
        improvedCustomers,

        // Transaction metrics
        avgTicket,

        // Growth metrics
        growthRate: Math.round(growthRate * 100),
        repeatRate: Math.round(newCustomerRepeatRate * 100),  // 25% for new customers
        improvedRepeat: Math.round(newCustomerRepeatRate * 100),

        // Revenue metrics (CONSERVATIVE - new customers only)
        newCustomerRevenue,
        repeatRevenue: Math.round(repeatRevenue),
        monthlyIncrementalRevenue,
        sixMonthRevenue,

        // Cost and ROI
        sixMonthCost,
        roi,
        monthlyCost: PATHSYNCH_MONTHLY_COST,

        // Metadata
        industryName: industryDefaults?.industryName || null,
        calculationModel: 'conservative_new_customers_only'
    };
}

/**
 * Calculate ROI data for narrative generation (AI-powered)
 * Used by narratives.js
 *
 * @param {object} inputs - Business input data
 * @returns {object} ROI data for narratives
 */
function calculateNarrativeROI(inputs) {
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
 * Format currency for display
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency string
 */
function formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Safe number parsing with default
 * @param {*} value - Value to parse
 * @param {number} decimals - Decimal places
 * @returns {number} Parsed number
 */
function safeNumber(value, decimals = 0) {
    const num = parseFloat(value) || 0;
    return decimals > 0 ? num.toFixed(decimals) : Math.round(num);
}

module.exports = {
    PATHSYNCH_MONTHLY_COST,
    calculatePitchROI,
    calculateNarrativeROI,
    formatCurrency,
    safeNumber
};
