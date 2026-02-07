/**
 * Smart Logo Fetch Service
 *
 * Multi-source logo discovery with intelligent fallbacks:
 * 1. Clearbit (most reliable for known companies)
 * 2. Logo.dev API (good coverage)
 * 3. Brand Fetch API (comprehensive)
 * 4. Website scraping (og:image, favicon, common paths)
 * 5. Google favicon as last resort
 *
 * Caches results to reduce API calls
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const marketCache = require('./marketCache');

/**
 * Make an HTTP/HTTPS request
 */
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': options.accept || '*/*',
                ...options.headers
            },
            timeout: options.timeout || 5000
        };

        const req = protocol.request(reqOptions, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
                fetchUrl(redirectUrl, options).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

/**
 * Check if a URL returns a valid image
 */
async function isValidImageUrl(url) {
    try {
        const response = await fetchUrl(url, {
            method: 'HEAD',
            timeout: 3000
        });

        const contentType = response.headers['content-type'] || '';
        return (
            response.statusCode === 200 &&
            (contentType.includes('image') || url.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i))
        );
    } catch (e) {
        return false;
    }
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        if (!url.startsWith('http')) url = 'https://' + url;
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (e) {
        return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
}

/**
 * Try Clearbit Logo API
 */
async function tryClearbit(domain) {
    const url = `https://logo.clearbit.com/${domain}`;
    if (await isValidImageUrl(url)) {
        return { url, source: 'clearbit', quality: 'high' };
    }
    return null;
}

/**
 * Try Logo.dev API (free tier available)
 */
async function tryLogoDev(domain) {
    const url = `https://img.logo.dev/${domain}?token=pk_placeholder`;
    // Note: Logo.dev requires an API key for production
    // For now, skip this source
    return null;
}

/**
 * Scrape website for logo URLs
 */
async function scrapeWebsiteForLogos(domain) {
    const logos = [];
    const baseUrl = `https://${domain}`;

    try {
        const response = await fetchUrl(baseUrl, {
            accept: 'text/html',
            timeout: 8000
        });

        if (response.statusCode !== 200) {
            return logos;
        }

        const html = response.body;

        // 1. Check Open Graph image (often a logo or brand image)
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        if (ogImageMatch) {
            const ogUrl = ogImageMatch[1].startsWith('http') ? ogImageMatch[1] : baseUrl + ogImageMatch[1];
            logos.push({ url: ogUrl, source: 'og:image', quality: 'medium' });
        }

        // 2. Check Twitter image
        const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
        if (twitterImageMatch) {
            const twUrl = twitterImageMatch[1].startsWith('http') ? twitterImageMatch[1] : baseUrl + twitterImageMatch[1];
            logos.push({ url: twUrl, source: 'twitter:image', quality: 'medium' });
        }

        // 3. Look for images with "logo" in class, id, alt, or src (multiple patterns)
        const logoPatterns = [
            /<img[^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/gi,
            /<img[^>]*src=["']([^"']*logo[^"']*)["']/gi,
            /<img[^>]*src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["']/gi
        ];

        let match;
        for (const regex of logoPatterns) {
            while ((match = regex.exec(html)) !== null) {
                let imgUrl = match[1];
                if (!imgUrl.startsWith('http') && !imgUrl.startsWith('data:')) {
                    imgUrl = imgUrl.startsWith('/') ? baseUrl + imgUrl : baseUrl + '/' + imgUrl;
                }
                if (!imgUrl.startsWith('data:') && !logos.some(l => l.url === imgUrl)) {
                    logos.push({ url: imgUrl, source: 'html-logo-class', quality: 'high' });
                }
            }
        }

        // 4. Check for header/navbar images (often logos)
        const headerLogoRegex = /<(?:header|nav)[^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
        while ((match = headerLogoRegex.exec(html)) !== null) {
            let imgUrl = match[1];
            if (!imgUrl.startsWith('http') && !imgUrl.startsWith('data:')) {
                imgUrl = imgUrl.startsWith('/') ? baseUrl + imgUrl : baseUrl + '/' + imgUrl;
            }
            if (!imgUrl.startsWith('data:') && !logos.some(l => l.url === imgUrl)) {
                logos.push({ url: imgUrl, source: 'header-img', quality: 'medium' });
            }
        }

        // 5. Look for WordPress uploads with logo/brand keywords (multiple patterns)
        const wpPatterns = [
            // Pattern 1: URL contains logo/brand/header in filename
            /["'](https?:\/\/[^"']*wp-content\/uploads\/[^"']*[-_]?(?:logo|brand|header)[^"']*\.(?:png|jpg|jpeg|svg|webp))["']/gi,
            // Pattern 2: URL in src attribute
            /src=["'](https?:\/\/[^"']*wp-content\/uploads\/[^"']*[-_]?(?:logo|brand|header)[^"']*\.(?:png|jpg|jpeg|svg|webp))["']/gi,
            // Pattern 3: Any wp-content URL with logo keyword (looser match)
            /(?:src|href|content)=["']([^"']*wp-content\/uploads\/[^"']*logo[^"']*\.(?:png|jpg|jpeg|svg|webp))["']/gi
        ];

        for (const wpRegex of wpPatterns) {
            while ((match = wpRegex.exec(html)) !== null) {
                let imgUrl = match[1];
                if (!imgUrl.startsWith('http')) {
                    imgUrl = baseUrl + (imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl);
                }
                if (!logos.some(l => l.url === imgUrl)) {
                    logos.push({ url: imgUrl, source: 'wp-uploads', quality: 'high' });
                }
            }
        }

        // 6. Schema.org Organization logo
        const schemaLogoMatch = html.match(/"logo"\s*:\s*(?:"([^"]+)"|{\s*"url"\s*:\s*"([^"]+)")/i);
        if (schemaLogoMatch) {
            const schemaUrl = schemaLogoMatch[1] || schemaLogoMatch[2];
            if (schemaUrl && !logos.some(l => l.url === schemaUrl)) {
                logos.push({ url: schemaUrl, source: 'schema-org', quality: 'high' });
            }
        }

        // 7. Look for any image in wp-content/uploads that looks like a logo
        const wpAnyLogoRegex = /["']([^"']*wp-content\/uploads\/\d{4}\/\d{2}\/[^"']*\.(?:png|jpg|jpeg|svg))["']/gi;
        while ((match = wpAnyLogoRegex.exec(html)) !== null) {
            let imgUrl = match[1];
            if (!imgUrl.startsWith('http')) {
                imgUrl = baseUrl + (imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl);
            }
            // Only add if URL suggests it's a logo (common naming patterns)
            if ((imgUrl.toLowerCase().includes('logo') ||
                 imgUrl.toLowerCase().includes('brand') ||
                 imgUrl.toLowerCase().includes('header')) &&
                !logos.some(l => l.url === imgUrl)) {
                logos.push({ url: imgUrl, source: 'wp-uploads', quality: 'high' });
            }
        }

        // 8. Look for site-icon (WordPress)
        const siteIconMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
        if (siteIconMatch) {
            let iconUrl = siteIconMatch[1];
            if (!iconUrl.startsWith('http')) {
                iconUrl = iconUrl.startsWith('/') ? baseUrl + iconUrl : baseUrl + '/' + iconUrl;
            }
            if (!logos.some(l => l.url === iconUrl)) {
                logos.push({ url: iconUrl, source: 'site-icon', quality: 'medium' });
            }
        }

        // 9. Look for custom-logo class (WordPress theme standard)
        const customLogoMatch = html.match(/<img[^>]*class=["'][^"']*custom-logo[^"']*["'][^>]*src=["']([^"']+)["']/i);
        if (customLogoMatch) {
            let logoUrl = customLogoMatch[1];
            if (!logoUrl.startsWith('http')) {
                logoUrl = logoUrl.startsWith('/') ? baseUrl + logoUrl : baseUrl + '/' + logoUrl;
            }
            if (!logos.some(l => l.url === logoUrl)) {
                logos.push({ url: logoUrl, source: 'custom-logo', quality: 'high' });
            }
        }

        // 10. Check for SVG logos (inline or referenced)
        const svgLogoRegex = /<(?:a|div)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<svg/gi;
        if (svgLogoRegex.test(html)) {
            // Site has inline SVG logo - may need special handling
            console.log('Site uses inline SVG logo');
        }

    } catch (e) {
        console.warn('Website scraping failed:', e.message);
    }

    return logos;
}

/**
 * Try common logo paths
 */
async function tryCommonPaths(domain) {
    const baseUrl = `https://${domain}`;
    const paths = [
        '/logo.png',
        '/logo.svg',
        '/logo.jpg',
        '/images/logo.png',
        '/images/logo.svg',
        '/images/logo.jpg',
        '/img/logo.png',
        '/img/logo.svg',
        '/assets/logo.png',
        '/assets/images/logo.png',
        '/static/logo.png',
        '/static/images/logo.png',
        // WordPress common paths
        '/wp-content/uploads/logo.png',
        '/wp-content/uploads/logo.svg',
        '/wp-content/themes/theme/images/logo.png',
        '/wp-content/uploads/sites/logo.png',
        // Other CMS paths
        '/sites/default/files/logo.png',
        '/media/logo.png',
        // Favicons
        '/favicon.ico',
        '/favicon.png',
        '/apple-touch-icon.png',
        '/apple-touch-icon-precomposed.png',
        '/apple-touch-icon-180x180.png',
        '/android-chrome-192x192.png'
    ];

    const found = [];
    for (const path of paths) {
        const url = baseUrl + path;
        if (await isValidImageUrl(url)) {
            const quality = path.includes('logo') ? 'high' : (path.includes('apple-touch') || path.includes('android-chrome') ? 'medium' : 'low');
            found.push({ url, source: 'common-path', quality });
            if (found.length >= 3) break; // Limit checks
        }
    }

    return found.length > 0 ? found : null;
}

/**
 * Google Favicon API (always works but low quality)
 */
function getGoogleFavicon(domain, size = 128) {
    return {
        url: `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`,
        source: 'google-favicon',
        quality: 'low'
    };
}

/**
 * Main function: Fetch logo for a domain
 * Returns array of logo options sorted by quality
 * @param {string} websiteUrl - Website URL to fetch logos for
 * @param {boolean} bypassCache - If true, skip cache lookup
 */
async function fetchLogos(websiteUrl, bypassCache = false) {
    const domain = extractDomain(websiteUrl);

    // Check cache first (unless bypassing)
    const cacheKey = { domain };
    if (!bypassCache) {
        try {
            const cached = await marketCache.getCached('logos', cacheKey);
            if (cached) {
                console.log('Logo cache hit for:', domain);
                return { ...cached.data, fromCache: true };
            }
        } catch (e) {
            // Cache miss - continue
        }
    } else {
        console.log('Bypassing cache for logo fetch:', domain);
    }

    const logos = [];
    const errors = [];

    // 1. Try Clearbit first (most reliable)
    try {
        const clearbit = await tryClearbit(domain);
        if (clearbit) logos.push(clearbit);
    } catch (e) {
        errors.push({ source: 'clearbit', error: e.message });
    }

    // 2. Scrape website for logos
    try {
        const scraped = await scrapeWebsiteForLogos(domain);
        // Validate each scraped URL
        for (const logo of scraped) {
            if (await isValidImageUrl(logo.url)) {
                if (!logos.some(l => l.url === logo.url)) {
                    logos.push(logo);
                }
            }
        }
    } catch (e) {
        errors.push({ source: 'scrape', error: e.message });
    }

    // 3. Try common paths
    try {
        const commonPaths = await tryCommonPaths(domain);
        if (commonPaths) {
            // Handle both single object and array
            const pathsArray = Array.isArray(commonPaths) ? commonPaths : [commonPaths];
            for (const pathLogo of pathsArray) {
                if (pathLogo && !logos.some(l => l.url === pathLogo.url)) {
                    logos.push(pathLogo);
                }
            }
        }
    } catch (e) {
        errors.push({ source: 'common-paths', error: e.message });
    }

    // 4. Always add Google favicon as fallback
    const googleFavicon = getGoogleFavicon(domain);
    if (!logos.some(l => l.source === 'google-favicon')) {
        logos.push(googleFavicon);
    }

    // Sort by quality (high > medium > low)
    const qualityOrder = { high: 0, medium: 1, low: 2 };
    logos.sort((a, b) => (qualityOrder[a.quality] || 2) - (qualityOrder[b.quality] || 2));

    const result = {
        success: logos.length > 0,
        domain,
        logos: logos.slice(0, 6), // Max 6 options
        primaryLogo: logos[0] || null,
        errors: errors.length > 0 ? errors : undefined,
        fetchedAt: new Date().toISOString()
    };

    // Cache result for 7 days
    try {
        await marketCache.setCache('logos', cacheKey, result, 7 * 24 * 60 * 60 * 1000);
    } catch (e) {
        console.warn('Failed to cache logo result:', e.message);
    }

    return result;
}

/**
 * Get the best logo URL for a domain (simple helper)
 */
async function getBestLogo(websiteUrl) {
    const result = await fetchLogos(websiteUrl);
    return result.primaryLogo?.url || null;
}

module.exports = {
    fetchLogos,
    getBestLogo,
    extractDomain
};
