/**
 * Image Utilities
 *
 * Downloads remote images and converts to base64 data URLs.
 * Used by L2 (HTML one-pager) and L3 (PPT) generators to embed logos
 * so they render reliably in iframes and PowerPoint files.
 */

const https = require('https');
const http = require('http');

/**
 * Download an image from a URL and return it as a base64 data URL.
 * Returns null on any failure (network error, timeout, non-image response).
 *
 * @param {string} imageUrl - Absolute http(s) URL to an image
 * @param {number} timeoutMs - Request timeout in milliseconds (default 8000)
 * @returns {Promise<string|null>} "data:<mime>;base64,<data>" or null
 */
async function downloadImageAsBase64(imageUrl, timeoutMs = 8000) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) return null;

    return new Promise((resolve) => {
        const client = imageUrl.startsWith('https://') ? https : http;

        const req = client.get(imageUrl, { timeout: timeoutMs }, (res) => {
            // Follow one redirect
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                req.destroy();
                return downloadImageAsBase64(res.headers.location, timeoutMs).then(resolve);
            }

            if (res.statusCode !== 200) {
                req.destroy();
                return resolve(null);
            }

            const contentType = res.headers['content-type'] || '';
            // Accept common image MIME types
            const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];
            const mime = validTypes.find(t => contentType.includes(t));
            if (!mime) {
                req.destroy();
                return resolve(null);
            }

            const chunks = [];
            let totalBytes = 0;
            const maxBytes = 5 * 1024 * 1024; // 5MB limit

            res.on('data', (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    req.destroy();
                    return resolve(null);
                }
                chunks.push(chunk);
            });

            res.on('end', () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    const base64 = buffer.toString('base64');
                    resolve(`data:${mime};base64,${base64}`);
                } catch (e) {
                    resolve(null);
                }
            });

            res.on('error', () => resolve(null));
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        req.on('error', () => resolve(null));
    });
}

module.exports = { downloadImageAsBase64 };
