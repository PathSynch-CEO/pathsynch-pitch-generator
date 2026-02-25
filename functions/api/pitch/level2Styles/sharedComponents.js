/**
 * Shared Components for L2 Styles
 *
 * Reusable HTML components that all L2 styles can use.
 * Each component returns HTML string that can be embedded in style templates.
 *
 * @module pitch/level2Styles/sharedComponents
 */

/**
 * Color palettes for each style
 */
const PALETTES = {
    visual_summary: {
        primary: '#2563eb',
        secondary: '#7c3aed',
        accent: '#06b6d4',
        bg: '#f8fafc',
        text: '#1e293b',
        textLight: '#64748b',
        success: '#10b981',
        white: '#ffffff'
    },
    battlecard: {
        primary: '#1e3a5f',
        secondary: '#e74c3c',
        accent: '#27ae60',
        bg: '#ffffff',
        text: '#1e293b',
        textLight: '#64748b',
        ourColor: '#27ae60',
        theirColor: '#94a3b8',
        white: '#ffffff'
    },
    roi_snapshot: {
        primary: '#059669',
        secondary: '#0284c7',
        accent: '#d97706',
        bg: '#f0fdf4',
        text: '#1e293b',
        textLight: '#64748b',
        success: '#10b981',
        white: '#ffffff'
    },
    executive_brief: {
        primary: '#1f2937',
        secondary: '#6b7280',
        accent: '#3b82f6',
        bg: '#ffffff',
        text: '#111827',
        textLight: '#6b7280',
        border: '#e5e7eb',
        white: '#ffffff'
    }
};

/**
 * Icon SVGs (simple, inline)
 */
const ICONS = {
    target: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    chart: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    shield: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    x: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    dollar: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    trending: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    clock: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    users: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    alert: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    award: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`,
    zap: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
};

/**
 * Get icon SVG by name
 */
function icon(name) {
    return ICONS[name] || ICONS.target;
}

/**
 * Get palette for a style
 */
function getPalette(styleName) {
    return PALETTES[styleName] || PALETTES.visual_summary;
}

/**
 * Metric card: displays a key number with label
 */
function metricCard(value, label, options = {}) {
    const { icon: iconName, color = '#2563eb', size = 'normal' } = options;
    const fontSize = size === 'large' ? '42px' : size === 'small' ? '24px' : '32px';
    const labelSize = size === 'large' ? '16px' : size === 'small' ? '11px' : '13px';

    return `
        <div class="metric-card" style="text-align: center; padding: ${size === 'small' ? '16px' : '24px'};">
            ${iconName ? `<div style="color: ${color}; margin-bottom: 8px;">${icon(iconName)}</div>` : ''}
            <div style="font-size: ${fontSize}; font-weight: 700; color: ${color}; line-height: 1;">${value}</div>
            <div style="font-size: ${labelSize}; color: #64748b; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
        </div>
    `;
}

/**
 * Section header with optional icon
 */
function sectionHeader(title, options = {}) {
    const { subtitle, icon: iconName, color = '#1e293b', uppercase = true } = options;

    return `
        <div class="section-header" style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                ${iconName ? `<span style="color: ${color};">${icon(iconName)}</span>` : ''}
                <h3 style="font-size: 14px; font-weight: 700; color: ${color}; ${uppercase ? 'text-transform: uppercase; letter-spacing: 0.5px;' : ''} margin: 0;">${title}</h3>
            </div>
            ${subtitle ? `<p style="font-size: 14px; color: #64748b; margin: 8px 0 0 0;">${subtitle}</p>` : ''}
        </div>
    `;
}

/**
 * Two-column layout wrapper
 */
function twoColumn(leftContent, rightContent, options = {}) {
    const { gap = '24px', ratio = '1:1' } = options;
    const [leftRatio, rightRatio] = ratio.split(':').map(Number);
    const total = leftRatio + rightRatio;

    return `
        <div style="display: grid; grid-template-columns: ${leftRatio}fr ${rightRatio}fr; gap: ${gap};">
            <div>${leftContent}</div>
            <div>${rightContent}</div>
        </div>
    `;
}

/**
 * Three-column layout wrapper
 */
function threeColumn(col1, col2, col3, options = {}) {
    const { gap = '16px' } = options;

    return `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: ${gap};">
            <div>${col1}</div>
            <div>${col2}</div>
            <div>${col3}</div>
        </div>
    `;
}

/**
 * Comparison row (for battlecards)
 */
function comparisonRow(category, ourValue, theirValue, options = {}) {
    const { highlight = false, ourColor = '#27ae60', theirColor = '#94a3b8' } = options;

    return `
        <tr style="${highlight ? 'background: #f0fdf4;' : ''}">
            <td style="padding: 16px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${category}</td>
            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; color: ${theirColor};">${theirValue}</td>
            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; color: ${ourColor}; font-weight: 600;">${ourValue}</td>
        </tr>
    `;
}

/**
 * Progress bar
 */
function progressBar(value, max, label, options = {}) {
    const { color = '#2563eb', showValue = true } = options;
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    return `
        <div class="progress-container" style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 13px; color: #64748b;">${label}</span>
                ${showValue ? `<span style="font-size: 13px; font-weight: 600; color: ${color};">${value}${typeof max === 'number' ? `/${max}` : ''}</span>` : ''}
            </div>
            <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                <div style="height: 100%; width: ${percentage}%; background: ${color}; border-radius: 4px;"></div>
            </div>
        </div>
    `;
}

/**
 * Call-to-action block
 */
function ctaBlock(headline, body, buttonText, buttonUrl, options = {}) {
    const { color = '#2563eb', centered = true } = options;

    return `
        <div class="cta-block" style="background: ${color}; color: white; padding: 32px; border-radius: 12px; ${centered ? 'text-align: center;' : ''}">
            <h3 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">${headline}</h3>
            <p style="font-size: 15px; opacity: 0.9; margin: 0 0 20px 0;">${body}</p>
            <a href="${buttonUrl}" style="display: inline-block; background: white; color: ${color}; padding: 12px 28px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 15px;">${buttonText}</a>
        </div>
    `;
}

/**
 * Bullet list with custom styling
 */
function bulletList(items, options = {}) {
    const { icon: bulletIcon = '•', color = '#2563eb' } = options;

    return `
        <ul style="list-style: none; padding: 0; margin: 0;">
            ${items.map(item => `
                <li style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; display: flex; align-items: flex-start; gap: 12px;">
                    <span style="color: ${color}; flex-shrink: 0;">${bulletIcon === 'check' ? icon('check') : bulletIcon}</span>
                    <span style="font-size: 14px; color: #374151;">${item}</span>
                </li>
            `).join('')}
        </ul>
    `;
}

/**
 * Quote/testimonial block
 */
function quoteBlock(quote, attribution, options = {}) {
    const { color = '#2563eb' } = options;

    return `
        <div style="border-left: 4px solid ${color}; padding-left: 20px; margin: 20px 0;">
            <p style="font-size: 16px; font-style: italic; color: #374151; margin: 0 0 8px 0;">"${quote}"</p>
            <p style="font-size: 13px; color: #64748b; margin: 0;">— ${attribution}</p>
        </div>
    `;
}

/**
 * Card wrapper
 */
function card(content, options = {}) {
    const { padding = '24px', shadow = true, border = false, borderColor = '#e5e7eb' } = options;

    return `
        <div style="background: white; border-radius: 12px; padding: ${padding}; ${shadow ? 'box-shadow: 0 2px 12px rgba(0,0,0,0.06);' : ''} ${border ? `border: 1px solid ${borderColor};` : ''}">
            ${content}
        </div>
    `;
}

/**
 * Format currency with proper formatting
 */
function formatCurrency(value) {
    if (typeof value !== 'number') {
        value = parseFloat(value) || 0;
    }
    if (value >= 1000000) {
        return '$' + (value / 1000000).toFixed(1) + 'M';
    }
    if (value >= 1000) {
        return '$' + (value / 1000).toFixed(0) + 'K';
    }
    return '$' + value.toLocaleString();
}

/**
 * Format percentage
 */
function formatPercent(value) {
    if (typeof value !== 'number') {
        value = parseFloat(value) || 0;
    }
    return Math.round(value) + '%';
}

module.exports = {
    PALETTES,
    ICONS,
    icon,
    getPalette,
    metricCard,
    sectionHeader,
    twoColumn,
    threeColumn,
    comparisonRow,
    progressBar,
    ctaBlock,
    bulletList,
    quoteBlock,
    card,
    formatCurrency,
    formatPercent
};
