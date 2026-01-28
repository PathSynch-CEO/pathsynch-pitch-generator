/**
 * Formatter Registry
 *
 * Factory/registry for all asset formatters
 */

const { SalesPitchFormatter } = require('./salesPitchFormatter');
const { OnePagerFormatter } = require('./onePagerFormatter');
const { EmailSequenceFormatter } = require('./emailSequenceFormatter');
const { LinkedInFormatter } = require('./linkedInFormatter');
const { ExecutiveSummaryFormatter } = require('./executiveSummaryFormatter');
const { DeckFormatter } = require('./deckFormatter');
const { ProposalFormatter } = require('./proposalFormatter');
const { isFormatterAvailable, getAvailableFormatters } = require('../config/claude');

// Registry of all formatters
const FORMATTERS = {
    sales_pitch: new SalesPitchFormatter(),
    one_pager: new OnePagerFormatter(),
    email_sequence: new EmailSequenceFormatter(),
    linkedin: new LinkedInFormatter(),
    executive_summary: new ExecutiveSummaryFormatter(),
    deck: new DeckFormatter(),
    proposal: new ProposalFormatter()
};

// Formatter metadata for listing
const FORMATTER_INFO = {
    sales_pitch: {
        name: 'Sales Pitch',
        description: 'Verbal pitch script for sales conversations',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '30 seconds'
    },
    one_pager: {
        name: 'One-Pager',
        description: 'Single-page PDF-ready sales document',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '45 seconds'
    },
    email_sequence: {
        name: 'Email Sequence',
        description: '5-email nurture sequence',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '60 seconds'
    },
    linkedin: {
        name: 'LinkedIn Messages',
        description: '3 LinkedIn outreach messages',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '30 seconds'
    },
    executive_summary: {
        name: 'Executive Summary',
        description: 'Formal executive summary document',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '45 seconds'
    },
    deck: {
        name: 'Presentation Deck',
        description: '10-slide sales presentation',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '90 seconds'
    },
    proposal: {
        name: 'Business Proposal',
        description: 'Comprehensive proposal document',
        outputTypes: ['html', 'text', 'markdown'],
        estimatedTime: '120 seconds'
    }
};

/**
 * Get a formatter by type
 * @param {string} assetType - The asset type
 * @returns {BaseFormatter|null} The formatter or null
 */
function getFormatter(assetType) {
    return FORMATTERS[assetType] || null;
}

/**
 * Get all available formatter types
 * @returns {string[]} Array of formatter type names
 */
function getAllFormatterTypes() {
    return Object.keys(FORMATTERS);
}

/**
 * Get formatter info for a type
 * @param {string} assetType - The asset type
 * @returns {Object|null} Formatter info or null
 */
function getFormatterInfo(assetType) {
    const formatter = FORMATTERS[assetType];
    const info = FORMATTER_INFO[assetType];

    if (!formatter || !info) {
        return null;
    }

    return {
        type: assetType,
        ...info,
        planRequirement: formatter.getPlanRequirement()
    };
}

/**
 * Get all formatter info for a given plan
 * @param {string} plan - User's plan
 * @returns {Object[]} Array of formatter info objects
 */
function getFormattersForPlan(plan) {
    const available = getAvailableFormatters(plan);

    return available.map(type => ({
        ...getFormatterInfo(type),
        available: true
    }));
}

/**
 * Get complete formatter listing with availability
 * @param {string} plan - User's plan
 * @returns {Object[]} Array of all formatters with availability
 */
function getAllFormattersWithAvailability(plan) {
    return getAllFormatterTypes().map(type => {
        const info = getFormatterInfo(type);
        const available = isFormatterAvailable(type, plan);

        return {
            ...info,
            available,
            requiresUpgrade: !available
        };
    });
}

/**
 * Format a narrative with a specific formatter
 * @param {string} assetType - The asset type
 * @param {Object} narrative - The narrative to format
 * @param {Object} options - Formatting options
 * @returns {Promise<Object>} Formatted result
 */
async function formatNarrative(assetType, narrative, options = {}) {
    const formatter = getFormatter(assetType);

    if (!formatter) {
        throw new Error(`Unknown formatter type: ${assetType}`);
    }

    // Format the narrative
    const formatted = await formatter.format(narrative, options);

    // Generate all output formats
    const html = formatter.toHtml(formatted, options.branding);
    const plainText = formatter.toPlainText(formatted);
    const markdown = formatter.toMarkdown(formatted);
    const metadata = formatter.getMetadata(formatted);

    return {
        assetType,
        content: {
            json: formatted,
            html,
            plainText,
            markdown
        },
        metadata
    };
}

/**
 * Batch format a narrative into multiple asset types
 * @param {Object} narrative - The narrative to format
 * @param {string[]} assetTypes - Array of asset types to generate
 * @param {Object} options - Formatting options
 * @returns {Promise<Object>} Object mapping asset types to formatted results
 */
async function batchFormat(narrative, assetTypes, options = {}) {
    const results = {};
    const errors = {};

    // Process in parallel
    await Promise.all(
        assetTypes.map(async (type) => {
            try {
                results[type] = await formatNarrative(type, narrative, options);
            } catch (error) {
                console.error(`Error formatting ${type}:`, error);
                errors[type] = error.message;
            }
        })
    );

    return {
        results,
        errors,
        successCount: Object.keys(results).length,
        errorCount: Object.keys(errors).length
    };
}

/**
 * Validate that requested formatters are available for a plan
 * @param {string[]} assetTypes - Requested asset types
 * @param {string} plan - User's plan
 * @returns {Object} Validation result
 */
function validateFormatterAccess(assetTypes, plan) {
    const available = [];
    const unavailable = [];

    for (const type of assetTypes) {
        if (isFormatterAvailable(type, plan)) {
            available.push(type);
        } else {
            const info = getFormatterInfo(type);
            unavailable.push({
                type,
                name: info?.name || type,
                requiredPlan: info?.planRequirement || 'scale'
            });
        }
    }

    return {
        valid: unavailable.length === 0,
        available,
        unavailable,
        message: unavailable.length > 0
            ? `The following formatters require a plan upgrade: ${unavailable.map(u => u.name).join(', ')}`
            : 'All requested formatters are available'
    };
}

module.exports = {
    getFormatter,
    getAllFormatterTypes,
    getFormatterInfo,
    getFormattersForPlan,
    getAllFormattersWithAvailability,
    formatNarrative,
    batchFormat,
    validateFormatterAccess,
    FORMATTERS,
    FORMATTER_INFO
};
