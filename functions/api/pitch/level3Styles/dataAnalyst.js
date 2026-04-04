/**
 * Data Analyst Style - L3 Slide Deck
 *
 * Dense, information-rich. Charts, tables, metrics grids.
 * Powered by real Market Intelligence data via dataAnalystDeckRenderer.
 *
 * @module pitch/level3Styles/dataAnalyst
 */

const { renderDataAnalystHTML } = require('../../../services/dataAnalystDeckRenderer');

/**
 * Generate Data Analyst style L3 slide deck (HTML preview)
 *
 * @param {Object} inputs      - Business inputs (businessName, googleRating, numReviews, industry, etc.)
 * @param {Object} reviewData  - Review analysis data (mapped to pitch.analysis)
 * @param {Object} roiData     - ROI data
 * @param {Object} options     - Pitch options (sellerContext, style, marketContext, etc.)
 * @param {Object|null} marketData - Market intelligence data
 * @param {string} pitchId     - Pitch ID for tracking
 * @returns {string} HTML content for the styled slide deck
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const pitch = {
        inputs,
        analysis: reviewData || {},
        solutionPackage: options.solutionPackage || null,
        marketContext: options.marketContext || marketData || null,
        prospect: { opportunityScore: marketData?.opportunityScore || 0 }
    };
    const sellerProfile = options.sellerContext || options.sellerProfile || null;
    const marketReport  = marketData || options.marketContext || null;

    return renderDataAnalystHTML(pitch, sellerProfile, marketReport);
}

module.exports = { generate };
