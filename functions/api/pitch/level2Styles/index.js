/**
 * L2 Style Router
 *
 * Routes to the appropriate style generator based on the style parameter.
 * All styles receive the same enriched data and return HTML output.
 *
 * @module pitch/level2Styles
 */

// Style generators (lazy-loaded to avoid circular deps)
const styleGenerators = {
    visual_summary: () => require('./visualSummary'),
    battlecard: () => require('./battlecard'),
    roi_snapshot: () => require('./roiSnapshot'),
    executive_brief: () => require('./executiveBrief')
};

/**
 * Generate styled L2 output
 *
 * @param {string} style - Style name (visual_summary, battlecard, etc.)
 * @param {Object} inputs - Business and contact information
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculation data
 * @param {Object} options - Branding and customization options
 * @param {Object|null} marketData - Market intelligence data
 * @param {string} pitchId - Pitch ID for tracking
 * @returns {string} HTML content for the styled one-pager
 * @throws {Error} If style is not supported
 */
function generateStyledL2(style, inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const generatorLoader = styleGenerators[style];

    if (!generatorLoader) {
        throw new Error(`Unsupported L2 style: "${style}". Supported styles: ${Object.keys(styleGenerators).join(', ')}`);
    }

    const generator = generatorLoader();
    return generator.generate(inputs, reviewData, roiData, options, marketData, pitchId);
}

/**
 * Check if a style is supported
 * @param {string} style - Style name to check
 * @returns {boolean} True if style is supported
 */
function isStyleSupported(style) {
    return style === 'standard' || Object.keys(styleGenerators).includes(style);
}

/**
 * Get list of available styles
 * @returns {string[]} Array of style names
 */
function getAvailableStyles() {
    return ['standard', ...Object.keys(styleGenerators)];
}

module.exports = {
    generateStyledL2,
    isStyleSupported,
    getAvailableStyles
};
