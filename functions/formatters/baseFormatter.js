/**
 * Base Formatter Interface
 *
 * Abstract base class for all asset formatters
 */

/**
 * Base formatter class that all formatters must extend
 */
class BaseFormatter {
    constructor(assetType, planRequirement) {
        if (this.constructor === BaseFormatter) {
            throw new Error('BaseFormatter is abstract and cannot be instantiated directly');
        }
        this.assetType = assetType;
        this.planRequirement = planRequirement;
    }

    /**
     * Get the asset type identifier
     * @returns {string} Asset type
     */
    getAssetType() {
        return this.assetType;
    }

    /**
     * Get the minimum plan required for this formatter
     * @returns {string} Plan name (starter, growth, scale)
     */
    getPlanRequirement() {
        return this.planRequirement;
    }

    /**
     * Get the system prompt for this formatter
     * Must be implemented by subclasses
     * @returns {string} System prompt
     */
    getSystemPrompt() {
        throw new Error('getSystemPrompt must be implemented by subclass');
    }

    /**
     * Format a narrative into the target asset
     * @param {Object} narrative - The narrative object
     * @param {Object} options - Formatting options
     * @returns {Promise<Object>} Formatted asset
     */
    async format(narrative, options = {}) {
        throw new Error('format must be implemented by subclass');
    }

    /**
     * Convert formatted JSON to HTML representation
     * @param {Object} formattedContent - The formatted content object
     * @param {Object} branding - Branding options
     * @returns {string} HTML string
     */
    toHtml(formattedContent, branding = {}) {
        throw new Error('toHtml must be implemented by subclass');
    }

    /**
     * Convert formatted JSON to plain text
     * @param {Object} formattedContent - The formatted content object
     * @returns {string} Plain text string
     */
    toPlainText(formattedContent) {
        throw new Error('toPlainText must be implemented by subclass');
    }

    /**
     * Convert formatted JSON to markdown
     * @param {Object} formattedContent - The formatted content object
     * @returns {string} Markdown string
     */
    toMarkdown(formattedContent) {
        throw new Error('toMarkdown must be implemented by subclass');
    }

    /**
     * Get metadata about the formatted content
     * @param {Object} formattedContent - The formatted content object
     * @returns {Object} Metadata object
     */
    getMetadata(formattedContent) {
        return {
            assetType: this.assetType,
            wordCount: this.countWords(formattedContent),
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Count words in content (recursive object traversal)
     * @param {any} content - Content to count words in
     * @returns {number} Word count
     */
    countWords(content) {
        if (typeof content === 'string') {
            return content.split(/\s+/).filter(w => w.length > 0).length;
        }
        if (Array.isArray(content)) {
            return content.reduce((sum, item) => sum + this.countWords(item), 0);
        }
        if (content && typeof content === 'object') {
            return Object.values(content).reduce((sum, val) => sum + this.countWords(val), 0);
        }
        return 0;
    }

    /**
     * Apply branding to HTML content
     * @param {string} html - HTML content
     * @param {Object} branding - Branding options
     * @returns {string} Branded HTML
     */
    applyBranding(html, branding = {}) {
        const {
            primaryColor = '#2563eb',
            accentColor = '#1e40af',
            logoUrl = null,
            companyName = 'PathSynch',
            hideBranding = false
        } = branding;

        let brandedHtml = html;

        // Replace color placeholders
        brandedHtml = brandedHtml.replace(/\{\{primaryColor\}\}/g, primaryColor);
        brandedHtml = brandedHtml.replace(/\{\{accentColor\}\}/g, accentColor);
        brandedHtml = brandedHtml.replace(/\{\{companyName\}\}/g, companyName);

        // Handle logo
        if (logoUrl) {
            brandedHtml = brandedHtml.replace(
                /\{\{logoPlaceholder\}\}/g,
                `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px;" />`
            );
        } else {
            brandedHtml = brandedHtml.replace(/\{\{logoPlaceholder\}\}/g, companyName);
        }

        // Handle powered by
        if (hideBranding) {
            brandedHtml = brandedHtml.replace(/\{\{poweredBy\}\}/g, '');
        } else {
            brandedHtml = brandedHtml.replace(
                /\{\{poweredBy\}\}/g,
                '<div style="text-align: center; font-size: 12px; color: #666; margin-top: 20px;">Powered by PathSynch</div>'
            );
        }

        return brandedHtml;
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (typeof text !== 'string') return text;
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

module.exports = { BaseFormatter };
