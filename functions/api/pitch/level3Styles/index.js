/**
 * L3 Style Router
 *
 * Routes to the appropriate style generator based on the style parameter.
 * All styles receive the same enriched data and return HTML slide deck output.
 *
 * @module pitch/level3Styles
 */

// Style generators (lazy-loaded to avoid circular deps)
const styleGenerators = {
    modern_minimal: () => require('./modernMinimal'),
    data_analyst: () => require('./dataAnalyst'),
    executive_boardroom: () => require('./executiveBoardroom'),
    bold_creative: () => require('./boldCreative')
};

/**
 * Generate styled L3 output
 *
 * @param {string} style - Style name (modern_minimal, data_analyst, etc.)
 * @param {Object} inputs - Business and contact information
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculation data
 * @param {Object} options - Branding and customization options
 * @param {Object|null} marketData - Market intelligence data
 * @param {string} pitchId - Pitch ID for tracking
 * @returns {string} HTML content for the styled slide deck
 * @throws {Error} If style is not supported
 */
function generateStyledL3(style, inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const generatorLoader = styleGenerators[style];

    if (!generatorLoader) {
        throw new Error(`Unsupported L3 style: "${style}". Supported styles: ${Object.keys(styleGenerators).join(', ')}`);
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
    generateStyledL3,
    isStyleSupported,
    getAvailableStyles
};
