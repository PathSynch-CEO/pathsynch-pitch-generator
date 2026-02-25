/**
 * Shared Slide Components for L3 Styles
 *
 * Reusable slide layout components and configuration objects
 * that all L3 styles can use.
 *
 * @module pitch/level3Styles/sharedSlides
 */

/**
 * Style configurations
 */
const STYLE_CONFIGS = {
    modern_minimal: {
        colors: {
            primary: '#111827',
            secondary: '#6b7280',
            accent: '#3b82f6',
            background: '#ffffff',
            slideBackground: '#fafafa',
            text: '#111827',
            textLight: '#9ca3af'
        },
        fonts: {
            heading: "'Helvetica Neue', Arial, sans-serif",
            body: "'Helvetica Neue', Arial, sans-serif",
            headingSize: 36,
            bodySize: 16
        },
        spacing: 'generous',
        maxBulletsPerSlide: 3
    },
    data_analyst: {
        colors: {
            primary: '#1e3a5f',
            secondary: '#2c5282',
            accent: '#38b2ac',
            background: '#ffffff',
            slideBackground: '#f8fafc',
            text: '#1e293b',
            textLight: '#64748b',
            tableHeader: '#1e3a5f',
            tableStripe: '#edf2f7'
        },
        fonts: {
            heading: "Arial, sans-serif",
            body: "Arial, sans-serif",
            headingSize: 28,
            bodySize: 12
        },
        spacing: 'compact',
        maxBulletsPerSlide: 6
    },
    executive_boardroom: {
        colors: {
            primary: '#1a202c',
            secondary: '#4a5568',
            accent: '#c53030',
            background: '#ffffff',
            slideBackground: '#ffffff',
            text: '#1a202c',
            textLight: '#718096',
            headerBar: '#1a202c'
        },
        fonts: {
            heading: "Georgia, serif",
            body: "Arial, sans-serif",
            headingSize: 30,
            bodySize: 14
        },
        spacing: 'standard',
        maxBulletsPerSlide: 5,
        showSlideNumbers: true,
        showHeaderBar: true
    },
    bold_creative: {
        colors: {
            primary: '#7c3aed',
            secondary: '#ec4899',
            accent: '#f59e0b',
            background: '#0f172a',
            slideBackground: '#0f172a',
            text: '#ffffff',
            textLight: '#94a3b8',
            gradientStart: '#7c3aed',
            gradientEnd: '#ec4899'
        },
        fonts: {
            heading: "'Arial Black', Arial, sans-serif",
            body: "Arial, sans-serif",
            headingSize: 40,
            bodySize: 16
        },
        spacing: 'generous',
        maxBulletsPerSlide: 3,
        useDarkSlides: true,
        useGradientBackgrounds: true
    }
};

/**
 * Get config for a style
 */
function getConfig(styleName) {
    return STYLE_CONFIGS[styleName] || STYLE_CONFIGS.modern_minimal;
}

/**
 * Base slide wrapper
 */
function slideWrapper(content, options = {}) {
    const {
        config,
        slideNumber,
        totalSlides,
        showNumber = true,
        customBg = null,
        headerBar = false,
        headerTitle = ''
    } = options;

    const bgColor = customBg || config?.colors?.slideBackground || '#ffffff';
    const textColor = config?.colors?.text || '#1a202c';
    const lightColor = config?.colors?.textLight || '#64748b';
    const headerBarColor = config?.colors?.headerBar || '#1a202c';

    return `
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            padding: ${config?.spacing === 'compact' ? '40px' : config?.spacing === 'generous' ? '80px' : '60px'};
            display: flex;
            flex-direction: column;
            background: ${bgColor};
            color: ${textColor};
            position: relative;
            border-bottom: 1px solid #e5e7eb;
            page-break-after: always;
        ">
            ${headerBar ? `
                <div style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 6px;
                    background: ${headerBarColor};
                "></div>
                ${headerTitle ? `
                    <div style="
                        position: absolute;
                        top: 20px;
                        left: 60px;
                        font-family: ${config?.fonts?.body || 'Arial'};
                        font-size: 12px;
                        color: ${lightColor};
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    ">${headerTitle}</div>
                ` : ''}
            ` : ''}
            <div class="slide-content" style="flex: 1; display: flex; flex-direction: column; justify-content: center; max-width: 900px; margin: 0 auto; width: 100%;">
                ${content}
            </div>
            ${showNumber && slideNumber ? `
                <div style="
                    position: absolute;
                    bottom: 30px;
                    right: 60px;
                    font-family: ${config?.fonts?.body || 'Arial'};
                    font-size: 12px;
                    color: ${lightColor};
                ">${slideNumber} / ${totalSlides}</div>
            ` : ''}
        </div>
    `;
}

/**
 * Title slide
 */
function titleSlide(title, subtitle, options = {}) {
    const { config, prepared = '', gradient = false } = options;
    const textColor = config?.colors?.text || '#1a202c';
    const accentColor = config?.colors?.accent || '#3b82f6';

    let bgStyle = `background: ${config?.colors?.background || '#ffffff'};`;
    if (gradient && config?.colors?.gradientStart) {
        bgStyle = `background: linear-gradient(135deg, ${config.colors.gradientStart} 0%, ${config.colors.gradientEnd} 100%);`;
    }

    return `
        <div style="text-align: center; ${gradient ? 'color: white;' : ''}">
            <h1 style="
                font-family: ${config?.fonts?.heading || 'Arial'};
                font-size: ${(config?.fonts?.headingSize || 36) + 16}px;
                font-weight: 700;
                letter-spacing: -1px;
                margin-bottom: 16px;
                color: ${gradient ? 'white' : textColor};
            ">${title}</h1>
            ${subtitle ? `
                <p style="
                    font-family: ${config?.fonts?.body || 'Arial'};
                    font-size: 24px;
                    color: ${gradient ? 'rgba(255,255,255,0.9)' : accentColor};
                    margin-bottom: 32px;
                ">${subtitle}</p>
            ` : ''}
            ${prepared ? `
                <p style="
                    font-family: ${config?.fonts?.body || 'Arial'};
                    font-size: 14px;
                    color: ${gradient ? 'rgba(255,255,255,0.7)' : config?.colors?.textLight || '#64748b'};
                ">${prepared}</p>
            ` : ''}
        </div>
    `;
}

/**
 * Content slide with title and body
 */
function contentSlide(title, body, options = {}) {
    const { config } = options;
    const textColor = config?.colors?.text || '#1a202c';

    return `
        <h2 style="
            font-family: ${config?.fonts?.heading || 'Arial'};
            font-size: ${config?.fonts?.headingSize || 36}px;
            font-weight: 700;
            margin-bottom: 32px;
            color: ${textColor};
        ">${title}</h2>
        <div style="
            font-family: ${config?.fonts?.body || 'Arial'};
            font-size: ${config?.fonts?.bodySize || 16}px;
            line-height: 1.6;
            color: ${config?.colors?.textLight || '#64748b'};
        ">${body}</div>
    `;
}

/**
 * Metrics slide with multiple metric cards
 */
function metricsSlide(title, metrics, options = {}) {
    const { config, columns = 4 } = options;
    const accentColor = config?.colors?.accent || '#3b82f6';
    const textColor = config?.colors?.text || '#1a202c';

    return `
        <h2 style="
            font-family: ${config?.fonts?.heading || 'Arial'};
            font-size: ${config?.fonts?.headingSize || 36}px;
            font-weight: 700;
            margin-bottom: 48px;
            color: ${textColor};
            text-align: center;
        ">${title}</h2>
        <div style="display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 24px;">
            ${metrics.map(m => `
                <div style="text-align: center; padding: 24px;">
                    <div style="
                        font-family: ${config?.fonts?.body || 'Arial'};
                        font-size: 48px;
                        font-weight: 700;
                        color: ${accentColor};
                        line-height: 1;
                    ">${m.value}</div>
                    <div style="
                        font-family: ${config?.fonts?.body || 'Arial'};
                        font-size: 14px;
                        color: ${config?.colors?.textLight || '#64748b'};
                        margin-top: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">${m.label}</div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Bullet list slide
 */
function bulletSlide(title, bullets, options = {}) {
    const { config, icon = '→' } = options;
    const textColor = config?.colors?.text || '#1a202c';
    const accentColor = config?.colors?.accent || '#3b82f6';

    return `
        <h2 style="
            font-family: ${config?.fonts?.heading || 'Arial'};
            font-size: ${config?.fonts?.headingSize || 36}px;
            font-weight: 700;
            margin-bottom: 40px;
            color: ${textColor};
        ">${title}</h2>
        <ul style="list-style: none; padding: 0; margin: 0;">
            ${bullets.map(b => `
                <li style="
                    font-family: ${config?.fonts?.body || 'Arial'};
                    font-size: ${config?.fonts?.bodySize || 16}px;
                    padding: 16px 0;
                    border-bottom: 1px solid ${config?.useDarkSlides ? 'rgba(255,255,255,0.1)' : '#e5e7eb'};
                    display: flex;
                    align-items: flex-start;
                    gap: 16px;
                    color: ${config?.colors?.textLight || '#64748b'};
                ">
                    <span style="color: ${accentColor}; flex-shrink: 0;">${icon}</span>
                    <span>${b}</span>
                </li>
            `).join('')}
        </ul>
    `;
}

/**
 * Table slide
 */
function tableSlide(title, headers, rows, options = {}) {
    const { config } = options;
    const headerBg = config?.colors?.tableHeader || config?.colors?.primary || '#1e3a5f';
    const stripeBg = config?.colors?.tableStripe || '#f8fafc';

    return `
        <h2 style="
            font-family: ${config?.fonts?.heading || 'Arial'};
            font-size: ${config?.fonts?.headingSize || 28}px;
            font-weight: 700;
            margin-bottom: 24px;
            color: ${config?.colors?.text || '#1a202c'};
        ">${title}</h2>
        <table style="width: 100%; border-collapse: collapse; font-family: ${config?.fonts?.body || 'Arial'}; font-size: ${config?.fonts?.bodySize || 12}px;">
            <thead>
                <tr style="background: ${headerBg}; color: white;">
                    ${headers.map(h => `<th style="padding: 12px 16px; text-align: left; font-weight: 600;">${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows.map((row, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : stripeBg};">
                        ${row.map(cell => `<td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${cell}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Quote slide
 */
function quoteSlide(quote, attribution, options = {}) {
    const { config } = options;
    const textColor = config?.colors?.text || '#1a202c';

    return `
        <div style="text-align: center; max-width: 700px; margin: 0 auto;">
            <div style="
                font-family: ${config?.fonts?.heading || 'Georgia'};
                font-size: 28px;
                font-style: italic;
                line-height: 1.5;
                color: ${textColor};
                margin-bottom: 24px;
            ">"${quote}"</div>
            <div style="
                font-family: ${config?.fonts?.body || 'Arial'};
                font-size: 14px;
                color: ${config?.colors?.textLight || '#64748b'};
            ">— ${attribution}</div>
        </div>
    `;
}

/**
 * CTA/Contact slide
 */
function ctaSlide(headline, subtext, contact, options = {}) {
    const { config, buttonText = 'Get Started', buttonUrl = '#' } = options;
    const accentColor = config?.colors?.accent || '#3b82f6';

    return `
        <div style="text-align: center;">
            <h2 style="
                font-family: ${config?.fonts?.heading || 'Arial'};
                font-size: ${config?.fonts?.headingSize || 36}px;
                font-weight: 700;
                margin-bottom: 16px;
                color: ${config?.colors?.text || '#1a202c'};
            ">${headline}</h2>
            ${subtext ? `
                <p style="
                    font-family: ${config?.fonts?.body || 'Arial'};
                    font-size: 18px;
                    color: ${config?.colors?.textLight || '#64748b'};
                    margin-bottom: 32px;
                ">${subtext}</p>
            ` : ''}
            <a href="${buttonUrl}" style="
                display: inline-block;
                background: ${accentColor};
                color: white;
                padding: 16px 40px;
                border-radius: 8px;
                font-family: ${config?.fonts?.body || 'Arial'};
                font-size: 16px;
                font-weight: 600;
                text-decoration: none;
            ">${buttonText}</a>
            ${contact ? `
                <div style="margin-top: 40px; font-family: ${config?.fonts?.body || 'Arial'}; font-size: 14px; color: ${config?.colors?.textLight || '#64748b'};">
                    ${contact}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Format currency helper
 */
function formatCurrency(value) {
    if (typeof value !== 'number') value = parseFloat(value) || 0;
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
    return '$' + value.toLocaleString();
}

module.exports = {
    STYLE_CONFIGS,
    getConfig,
    slideWrapper,
    titleSlide,
    contentSlide,
    metricsSlide,
    bulletSlide,
    tableSlide,
    quoteSlide,
    ctaSlide,
    formatCurrency
};
