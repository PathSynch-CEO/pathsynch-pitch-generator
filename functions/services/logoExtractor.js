/**
 * Logo Extractor Service
 *
 * Tiered approach for logo extraction:
 * 1. Try Clearbit/favicon (free, instant)
 * 2. Fallback: Screenshot + Gemini 3 Flash vision
 * 3. Flag for human review if confidence < 70%
 *
 * Also extracts brand colors from website CSS and meta tags
 *
 * @version 1.1.0
 */

const axios = require('axios');
const geminiClient = require('./geminiClient');

// Common brand color names to hex mappings
const COLOR_NAMES = {
    'white': '#FFFFFF', 'black': '#000000', 'red': '#FF0000',
    'green': '#00FF00', 'blue': '#0000FF', 'yellow': '#FFFF00',
    'orange': '#FFA500', 'purple': '#800080', 'pink': '#FFC0CB',
    'gray': '#808080', 'grey': '#808080', 'navy': '#000080',
    'teal': '#008080', 'maroon': '#800000', 'olive': '#808000'
};

/**
 * Extract logo using tiered approach
 * @param {string} websiteUrl - Company website URL
 * @param {string} companyName - Company name for context
 * @returns {Promise<Object>} Logo extraction result
 */
async function extractLogo(websiteUrl, companyName = '') {
    console.log('Starting logo extraction for:', websiteUrl);

    // Normalize URL
    let domain = websiteUrl;
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
        domain = domain.replace(/^https?:\/\//, '');
    }
    domain = domain.replace(/^www\./, '').split('/')[0];

    const result = {
        success: false,
        logoUrl: null,
        source: null,
        confidence: 0,
        needsReview: false,
        alternatives: [],
        brandColors: {
            primary: null,
            secondary: null,
            accent: null,
            all: []
        },
        metadata: {
            domain,
            companyName,
            extractedAt: new Date().toISOString()
        }
    };

    // ============================================
    // TIER 1: Clearbit Logo API (free, instant)
    // ============================================
    try {
        console.log('Tier 1: Trying Clearbit for:', domain);
        const clearbitUrl = `https://logo.clearbit.com/${domain}`;

        const clearbitResponse = await axios.head(clearbitUrl, {
            timeout: 5000,
            validateStatus: (status) => status === 200
        });

        if (clearbitResponse.status === 200) {
            result.success = true;
            result.logoUrl = clearbitUrl;
            result.source = 'clearbit';
            result.confidence = 95; // Clearbit is highly reliable
            console.log('Clearbit logo found:', clearbitUrl);
            return result;
        }
    } catch (clearbitError) {
        console.log('Clearbit not available:', clearbitError.message);
    }

    // ============================================
    // TIER 1B: Google Favicon (free fallback)
    // ============================================
    try {
        console.log('Tier 1B: Trying Google Favicon for:', domain);
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

        const faviconResponse = await axios.head(faviconUrl, {
            timeout: 5000,
            validateStatus: (status) => status === 200
        });

        if (faviconResponse.status === 200) {
            // Favicon found, but it's usually low quality - add as alternative
            result.alternatives.push({
                url: faviconUrl,
                source: 'google_favicon',
                quality: 'low',
                size: '128x128'
            });
            console.log('Google favicon found (added as alternative)');
        }
    } catch (faviconError) {
        console.log('Google favicon not available:', faviconError.message);
    }

    // ============================================
    // TIER 1C: Try common logo paths
    // ============================================
    const commonLogoPaths = [
        '/logo.png',
        '/logo.svg',
        '/images/logo.png',
        '/img/logo.png',
        '/assets/logo.png',
        '/assets/images/logo.png',
        '/static/logo.png',
        '/favicon.ico',
        '/apple-touch-icon.png'
    ];

    for (const path of commonLogoPaths) {
        try {
            const logoUrl = `https://${domain}${path}`;
            const response = await axios.head(logoUrl, {
                timeout: 3000,
                validateStatus: (status) => status === 200
            });

            if (response.status === 200) {
                const contentType = response.headers['content-type'] || '';
                if (contentType.includes('image')) {
                    result.alternatives.push({
                        url: logoUrl,
                        source: 'direct_path',
                        path: path,
                        contentType
                    });
                    console.log('Direct logo path found:', logoUrl);

                    // If we found a good logo path (not favicon), use it
                    if (!path.includes('favicon')) {
                        result.success = true;
                        result.logoUrl = logoUrl;
                        result.source = 'direct_path';
                        result.confidence = 80;
                        return result;
                    }
                }
            }
        } catch (e) {
            // Path doesn't exist, continue
        }
    }

    // ============================================
    // TIER 2: HTML Meta Tags (og:image, etc.)
    // ============================================
    try {
        console.log('Tier 2: Fetching HTML meta tags for:', domain);
        const htmlResponse = await axios.get(`https://${domain}`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            maxRedirects: 5
        });

        const html = htmlResponse.data;

        // ============================================
        // EXTRACT BRAND COLORS FROM HTML
        // ============================================
        const extractedColors = extractBrandColorsFromHTML(html);
        if (extractedColors.length > 0) {
            result.brandColors.all = extractedColors;
            result.brandColors.primary = extractedColors[0] || null;
            result.brandColors.secondary = extractedColors[1] || null;
            result.brandColors.accent = extractedColors[2] || null;
            console.log('Extracted brand colors:', extractedColors);
        }

        // Extract meta tags
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        const appleIconMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
        const iconMatch = html.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i);

        if (ogImageMatch) {
            let ogImageUrl = ogImageMatch[1];
            // Handle relative URLs
            if (!ogImageUrl.startsWith('http')) {
                ogImageUrl = `https://${domain}${ogImageUrl.startsWith('/') ? '' : '/'}${ogImageUrl}`;
            }
            result.alternatives.push({
                url: ogImageUrl,
                source: 'og_image',
                quality: 'medium'
            });
            console.log('OG image found:', ogImageUrl);
        }

        if (appleIconMatch) {
            let iconUrl = appleIconMatch[1];
            if (!iconUrl.startsWith('http')) {
                iconUrl = `https://${domain}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
            }
            result.alternatives.push({
                url: iconUrl,
                source: 'apple_touch_icon',
                quality: 'medium'
            });
        }

        // If we found og:image, it's often a good logo or brand image
        if (ogImageMatch && result.alternatives.length > 0) {
            const ogImage = result.alternatives.find(a => a.source === 'og_image');
            if (ogImage) {
                result.success = true;
                result.logoUrl = ogImage.url;
                result.source = 'og_image';
                result.confidence = 70;
                result.needsReview = true; // OG images may not always be logos
                return result;
            }
        }

    } catch (htmlError) {
        console.log('HTML fetch failed:', htmlError.message);
    }

    // ============================================
    // TIER 3: Gemini Vision Analysis (if we have website content)
    // ============================================
    // Note: This would require screenshot capability (Puppeteer)
    // For now, we'll use the best alternative we found

    if (result.alternatives.length > 0) {
        // Use the best alternative we found
        const bestAlt = result.alternatives[0];
        result.success = true;
        result.logoUrl = bestAlt.url;
        result.source = bestAlt.source;
        result.confidence = 60;
        result.needsReview = true; // Flag for human review
        console.log('Using best alternative:', bestAlt.url);
        return result;
    }

    // ============================================
    // NO LOGO FOUND - Flag for manual review
    // ============================================
    result.needsReview = true;
    result.metadata.failureReason = 'No logo found through any automated method';
    console.log('No logo found for:', domain);

    return result;
}

/**
 * Batch extract logos for multiple domains
 * @param {Array} websites - Array of {url, companyName} objects
 * @returns {Promise<Array>} Array of extraction results
 */
async function batchExtractLogos(websites) {
    const results = await Promise.allSettled(
        websites.map(site => extractLogo(site.url, site.companyName))
    );

    return results.map((result, index) => ({
        input: websites[index],
        ...( result.status === 'fulfilled'
            ? result.value
            : { success: false, error: result.reason?.message }
        )
    }));
}

/**
 * Validate if a logo URL is still accessible
 * @param {string} logoUrl - URL to validate
 * @returns {Promise<boolean>} Whether the logo is accessible
 */
async function validateLogoUrl(logoUrl) {
    try {
        const response = await axios.head(logoUrl, {
            timeout: 5000,
            validateStatus: (status) => status === 200
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

/**
 * Extract brand colors from HTML content
 * Looks for theme-color meta tags, CSS custom properties, and inline styles
 * @param {string} html - HTML content to analyze
 * @returns {Array} Array of hex color codes
 */
function extractBrandColorsFromHTML(html) {
    const colors = new Set();

    // 1. Theme color meta tag (most reliable)
    const themeColorMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
    if (themeColorMatch) {
        const color = normalizeColor(themeColorMatch[1]);
        if (color) colors.add(color);
    }

    // 2. MS Application tile color
    const tileColorMatch = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
    if (tileColorMatch) {
        const color = normalizeColor(tileColorMatch[1]);
        if (color) colors.add(color);
    }

    // 3. CSS custom properties (--primary, --brand, etc.)
    const cssVarMatches = html.matchAll(/--(?:primary|brand|accent|main|theme)[-\w]*\s*:\s*([^;}\n]+)/gi);
    for (const match of cssVarMatches) {
        const color = normalizeColor(match[1].trim());
        if (color && !isNeutralColor(color)) colors.add(color);
    }

    // 4. Background colors on header, nav, or body
    const bgColorMatches = html.matchAll(/(?:header|nav|\.header|\.nav|\.brand)[^{]*\{[^}]*background(?:-color)?\s*:\s*([^;}\n]+)/gi);
    for (const match of bgColorMatches) {
        const color = normalizeColor(match[1].trim());
        if (color && !isNeutralColor(color)) colors.add(color);
    }

    // 5. Inline style colors on logo or brand elements
    const inlineStyleMatches = html.matchAll(/(?:class|id)=["'][^"']*(?:logo|brand|header)[^"']*["'][^>]*style=["'][^"']*(?:background|color)\s*:\s*([^;}"']+)/gi);
    for (const match of inlineStyleMatches) {
        const color = normalizeColor(match[1].trim());
        if (color && !isNeutralColor(color)) colors.add(color);
    }

    // 6. Link colors (often brand color)
    const linkColorMatch = html.match(/a\s*\{[^}]*color\s*:\s*([^;}\n]+)/i);
    if (linkColorMatch) {
        const color = normalizeColor(linkColorMatch[1].trim());
        if (color && !isNeutralColor(color)) colors.add(color);
    }

    // Convert Set to Array and limit to 5 colors
    return Array.from(colors).slice(0, 5);
}

/**
 * Normalize a color value to hex format
 * @param {string} color - Color value (hex, rgb, rgba, or named)
 * @returns {string|null} Hex color code or null if invalid
 */
function normalizeColor(color) {
    if (!color) return null;

    color = color.trim().toLowerCase();

    // Already hex
    if (/^#[0-9a-f]{3,8}$/i.test(color)) {
        // Expand 3-digit hex to 6-digit
        if (color.length === 4) {
            return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
        }
        return color.substring(0, 7).toUpperCase(); // Strip alpha if present
    }

    // RGB/RGBA
    const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
        const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
        const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`.toUpperCase();
    }

    // Named colors
    if (COLOR_NAMES[color]) {
        return COLOR_NAMES[color];
    }

    return null;
}

/**
 * Check if a color is neutral (black, white, gray)
 * @param {string} hexColor - Hex color code
 * @returns {boolean} True if neutral
 */
function isNeutralColor(hexColor) {
    if (!hexColor || !hexColor.startsWith('#')) return false;

    const hex = hexColor.substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Check if grayscale (r, g, b are similar)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    // If the color difference is small, it's likely a shade of gray
    if (diff < 30) {
        return true;
    }

    // Very dark or very light colors
    const brightness = (r + g + b) / 3;
    if (brightness < 30 || brightness > 240) {
        return true;
    }

    return false;
}

module.exports = {
    extractLogo,
    batchExtractLogos,
    validateLogoUrl,
    extractBrandColorsFromHTML
};
