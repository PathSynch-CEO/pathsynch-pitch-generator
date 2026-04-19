/**
 * URL Heuristic Fallbacks
 *
 * Server-side regex patterns for classifying page URLs when
 * the merchant has not manually tagged them.
 */

const HEURISTIC_RULES = [
    { pattern: /\/(pricing|plans|packages|rates|cost)/i,   tag: 'pricing' },
    { pattern: /\/(demo|request-demo|book-demo|schedule-demo)/i, tag: 'demo' },
    { pattern: /\/(book|booking|schedule|appointment|calendar|reserve)/i, tag: 'booking' },
    { pattern: /\/(case-stud|case_stud|customers|success-stor|testimonial)/i, tag: 'case_study' },
    { pattern: /\/(contact|get-started|get-in-touch|request-quote|free-trial|signup|sign-up)/i, tag: 'high_intent' },
    { pattern: /\/(about|team|careers|jobs|press|news|blog|resources|whitepaper)/i, tag: 'low_intent' },
    { pattern: /\/(faq|help|support|knowledge-base|knowledgebase|docs|documentation)/i, tag: 'support_faq' },
];

/**
 * Classify a URL path using heuristic regex patterns.
 * @param {string} url - Full URL or path (e.g. "/pricing" or "https://example.com/pricing")
 * @returns {string} Tag name or 'unclassified'
 */
function classifyUrl(url) {
    if (!url) return 'unclassified';

    // Extract pathname from full URLs
    let path = url;
    try {
        if (url.startsWith('http')) {
            path = new URL(url).pathname;
        }
    } catch {
        // If URL parsing fails, use the raw string
    }

    for (const rule of HEURISTIC_RULES) {
        if (rule.pattern.test(path)) {
            return rule.tag;
        }
    }

    return 'unclassified';
}

/**
 * Classify an array of URLs, applying merchant overrides first, then heuristics.
 * @param {string[]} urls - Array of page URLs
 * @param {Object[]} merchantMappings - Array of { url, tag } from merchantConfig
 * @returns {Object[]} Array of { url, tag, source } where source is 'merchant' or 'heuristic' or 'unclassified'
 */
function classifyUrls(urls, merchantMappings = []) {
    const merchantMap = new Map();
    for (const m of merchantMappings) {
        merchantMap.set(normalizeUrl(m.url), m.tag);
    }

    return urls.map(url => {
        const normalized = normalizeUrl(url);

        // Merchant override takes priority
        if (merchantMap.has(normalized)) {
            return { url, tag: merchantMap.get(normalized), source: 'merchant' };
        }

        // Heuristic fallback
        const tag = classifyUrl(url);
        return {
            url,
            tag,
            source: tag === 'unclassified' ? 'unclassified' : 'heuristic'
        };
    });
}

/**
 * Normalize a URL for matching (lowercase pathname, strip trailing slash).
 */
function normalizeUrl(url) {
    if (!url) return '';
    let path = url;
    try {
        if (url.startsWith('http')) {
            path = new URL(url).pathname;
        }
    } catch {
        // use raw
    }
    return path.toLowerCase().replace(/\/+$/, '') || '/';
}

module.exports = {
    classifyUrl,
    classifyUrls,
    normalizeUrl,
    HEURISTIC_RULES
};
