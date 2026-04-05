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
    // Prefer explicit marketData, then options.marketContext, then inputs.marketContext
    // (inputs.marketContext is set by pitchGenerator.js when source === 'market_intel_leads')
    const effectiveMarket = marketData || options.marketContext || inputs.marketContext || null;

    const pitch = {
        inputs,
        analysis: reviewData || {},
        solutionPackage: options.solutionPackage || null,
        marketContext: effectiveMarket,
        prospect: { opportunityScore: inputs.opportunityScore || marketData?.opportunityScore || 0 }
    };
    const sellerProfile = options.sellerContext || options.sellerProfile || null;

    console.debug('[DA Deck] marketReport keys:', effectiveMarket ? Object.keys(effectiveMarket) : 'NULL');
    console.debug('[DA Deck] benchmarks:', JSON.stringify(effectiveMarket?.benchmarks));
    console.debug('[DA Deck] competitors length:', effectiveMarket?.competitors?.length ?? 0);
    console.debug('[DA Deck] opportunityScore:', pitch.prospect.opportunityScore);

    return renderDataAnalystHTML(pitch, sellerProfile, effectiveMarket);
}

module.exports = { generate };
