/**
 * HTML Builder Module
 *
 * Shared HTML/CSS utilities for pitch generation.
 * Includes color manipulation, text truncation, and reusable HTML components.
 * Extracted from pitchGenerator.js as part of the modular refactoring effort.
 *
 * @module pitch/htmlBuilder
 */

/**
 * Adjust color brightness (positive = lighter, negative = darker)
 * @param {string} hex - Hex color code (with or without #)
 * @param {number} percent - Percentage to adjust (-100 to 100)
 * @returns {string} Adjusted hex color with #
 */
function adjustColor(hex, percent) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse RGB values
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Adjust by percentage
    r = Math.min(255, Math.max(0, Math.round(r + (r * percent / 100))));
    g = Math.min(255, Math.max(0, Math.round(g + (g * percent / 100))));
    b = Math.min(255, Math.max(0, Math.round(b + (b * percent / 100))));

    // Convert back to hex
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Truncate text to a maximum character length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length (default 100)
 * @param {string} suffix - Suffix to append when truncated (default '...')
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 100, suffix = '...') {
    if (!text || typeof text !== 'string') return text || '';
    if (text.length <= maxLength) return text;
    // Try to cut at a word boundary
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
        return truncated.substring(0, lastSpace) + suffix;
    }
    return truncated + suffix;
}

/**
 * Content length limits for slides
 */
const CONTENT_LIMITS = {
    uspItem: 80,           // Each USP bullet point
    benefitItem: 80,       // Each key benefit bullet point
    productName: 30,       // Product name
    productDesc: 60,       // Product description
    slideIntro: 150,       // Slide intro paragraph
    differentiator: 150    // Differentiator text
};

/**
 * Build CSS variables block for custom branding
 * @param {Object} options - Branding options
 * @param {string} options.primaryColor - Primary brand color
 * @param {string} options.accentColor - Accent brand color
 * @returns {string} CSS :root block with variables
 */
function buildCssVariables(options = {}) {
    const primaryColor = options.primaryColor || '#3A6746';
    const accentColor = options.accentColor || '#D4A847';

    return `
        :root {
            --color-primary: ${primaryColor};
            --color-primary-dark: ${primaryColor}dd;
            --color-accent: ${accentColor};
            --color-secondary: #6B4423;
            --color-bg: #ffffff;
            --color-bg-light: #f8f9fa;
            --color-text: #333333;
            --color-text-light: #666666;
            --color-positive: #22c55e;
            --color-neutral: #f59e0b;
            --color-negative: #ef4444;
        }
    `;
}

/**
 * Build CTA tracking script for analytics
 * @param {string} pitchId - Pitch ID for tracking
 * @param {number} defaultLevel - Default pitch level for tracking
 * @returns {string} Script tag with tracking code
 */
function buildCtaTrackingScript(pitchId, defaultLevel = 0) {
    return `
<script>
window.trackCTA = function(el) {
    if (navigator.sendBeacon) {
        navigator.sendBeacon(
            'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',
            new Blob([JSON.stringify({
                pitchId: '${pitchId || ''}',
                event: 'cta_click',
                data: {
                    ctaType: el.dataset.ctaType || null,
                    ctaUrl: el.href || null,
                    pitchLevel: parseInt(el.dataset.pitchLevel) || ${defaultLevel},
                    segment: el.dataset.segment || null
                }
            })], { type: 'application/json' })
        );
    }
};
</script>`;
}

/**
 * Build a stats box component
 * @param {string} value - The stat value to display
 * @param {string} label - The label for the stat
 * @returns {string} HTML for the stat box
 */
function buildStatBox(value, label) {
    return `
        <div class="stat-box">
            <div class="value">${value}</div>
            <div class="label">${label}</div>
        </div>
    `;
}

/**
 * Build branding footer with optional custom text
 * @param {boolean} hideBranding - Whether to hide PathSynch branding
 * @param {string} companyName - Company name for branding
 * @param {string} customFooterText - Optional custom footer text
 * @returns {string} HTML for footer section
 */
function buildBrandingFooter(hideBranding, companyName, customFooterText) {
    let html = '';

    if (customFooterText) {
        html += `
        <div style="margin-top: 24px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>`;
    }

    if (!hideBranding) {
        html += `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">${companyName || 'PathSynch'}</a>
        </div>`;
    }

    return html;
}

/**
 * Build a CTA button with tracking attributes
 * @param {Object} options - Button options
 * @param {string} options.url - Button URL
 * @param {string} options.text - Button text
 * @param {string} options.ctaType - CTA type for tracking (e.g., 'book_demo', 'contact')
 * @param {number} options.pitchLevel - Pitch level for tracking
 * @param {string} options.segment - Segment/industry for tracking
 * @param {boolean} options.newTab - Whether to open in new tab
 * @param {string} options.className - CSS class name
 * @returns {string} HTML for the CTA button
 */
function buildCtaButton(options = {}) {
    const {
        url = '#',
        text = 'Get Started',
        ctaType = 'contact',
        pitchLevel = 0,
        segment = '',
        newTab = false,
        className = 'cta-button'
    } = options;

    return `<a href="${url}" class="${className}" target="${newTab ? '_blank' : '_self'}"
       data-cta-type="${ctaType}"
       data-pitch-level="${pitchLevel}"
       data-segment="${segment}"
       onclick="window.trackCTA && trackCTA(this)">${text}</a>`;
}

/**
 * Escape HTML entities in text
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (!text || typeof text !== 'string') return text || '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    adjustColor,
    truncateText,
    CONTENT_LIMITS,
    buildCssVariables,
    buildCtaTrackingScript,
    buildStatBox,
    buildBrandingFooter,
    buildCtaButton,
    escapeHtml
};
