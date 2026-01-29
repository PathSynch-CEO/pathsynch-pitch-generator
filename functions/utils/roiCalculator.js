/**
 * ROI Calculator Utility
 *
 * Shared ROI calculation logic used across pitch generation and narratives.
 * Single source of truth for all ROI-related calculations.
 */

// PathSynch pricing constants
const PATHSYNCH_MONTHLY_COST = 168;

/**
 * Calculate ROI data for pitch generation (template-based)
 * Used by pitchGenerator.js
 *
 * @param {object} inputs - Business input data
 * @returns {object} ROI data for pitch templates
 */
function calculatePitchROI(inputs) {
    const monthlyVisits = parseInt(inputs.monthlyVisits) || 500;
    const avgTicket = parseFloat(inputs.avgTransaction) || parseFloat(inputs.avgTicket) || 25;
    const repeatRate = parseFloat(inputs.repeatRate) || 0.4;

    // Improvements with PathSynch
    const improvedVisits = Math.round(monthlyVisits * 1.30);
    const improvedRepeat = Math.min(repeatRate + 0.25, 0.8);

    // Revenue calculations
    const currentRevenue = monthlyVisits * avgTicket * repeatRate;
    const projectedRevenue = improvedVisits * avgTicket * improvedRepeat;
    const monthlyIncrease = projectedRevenue - currentRevenue;
    const sixMonthRevenue = Math.round(monthlyIncrease * 6);

    // Cost and ROI
    const sixMonthCost = PATHSYNCH_MONTHLY_COST * 6;
    const roi = Math.round(((sixMonthRevenue - sixMonthCost) / sixMonthCost) * 100);

    return {
        monthlyVisits,
        avgTicket,
        repeatRate: Math.round(repeatRate * 100),
        improvedVisits,
        improvedRepeat: Math.round(improvedRepeat * 100),
        sixMonthRevenue,
        sixMonthCost,
        roi,
        monthlyCost: PATHSYNCH_MONTHLY_COST
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
