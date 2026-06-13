'use strict';

const axios = require('axios');
const { URL } = require('url');
const { getTechDetection, setTechDetection, normalizeHostname } = require('../enrichmentCache');

// ── SSRF Guard ───────────────────────────────────────────────────────────────

const PRIVATE_RANGES = [
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^0\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^fd/i,
];

const METADATA_HOSTS = [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.google.com',
];

function _validateUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let urlStr = raw.trim();

    // Reject non-http(s) schemes before prepending default
    if (/^[a-z][a-z0-9+.-]*:/i.test(urlStr) && !/^https?:/i.test(urlStr)) {
        return null;
    }

    if (!/^https?:\/\//i.test(urlStr)) {
        urlStr = 'https://' + urlStr;
    }

    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch {
        return null;
    }

    // Scheme check
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;

    // Metadata host check
    if (METADATA_HOSTS.includes(parsed.hostname.toLowerCase())) return null;

    // Private IP check
    if (PRIVATE_RANGES.some(r => r.test(parsed.hostname))) return null;

    return parsed.href;
}

// ── Fingerprint Database ─────────────────────────────────────────────────────

const FINGERPRINTS = [
    // ── Reputation Tools ──
    { name: 'Birdeye',           category: 'reputation', type: 'reputation',         pattern: /birdeye\.com/i },
    { name: 'Podium',            category: 'reputation', type: 'reputation',         pattern: /podium\.com/i },
    { name: 'ReviewTrackers',    category: 'reputation', type: 'review_management',  pattern: /reviewtrackers\.com/i },
    { name: 'Grade.us',          category: 'reputation', type: 'review_management',  pattern: /grade\.us/i },
    { name: 'GatherUp',          category: 'reputation', type: 'review_management',  pattern: /gatherup\.com/i },
    { name: 'Reputation.com',    category: 'reputation', type: 'reputation',         pattern: /reputation\.com/i },
    { name: 'Yext',              category: 'reputation', type: 'listing_management', pattern: /yext\.com|yextpages\.net/i },
    { name: 'SOCi',              category: 'reputation', type: 'listing_management', pattern: /meetsoci\.com|soci\.ai/i },
    { name: 'Thryv',             category: 'reputation', type: 'reputation',         pattern: /thryv\.com/i },
    { name: 'NiceJob',           category: 'reputation', type: 'review_management',  pattern: /nicejob\.co/i },
    { name: 'Broadly',           category: 'reputation', type: 'reputation',         pattern: /broadly\.com/i },
    { name: 'Weave',             category: 'reputation', type: 'reputation',         pattern: /getweave\.com/i },

    // ── Form Builders ──
    { name: 'JotForm',           category: 'forms', type: 'cost',     pattern: /jotform\.com/i },
    { name: 'Typeform',          category: 'forms', type: 'cost',     pattern: /typeform\.com/i },
    { name: 'Google Forms',      category: 'forms', type: 'basic',    pattern: /docs\.google\.com\/forms/i },
    { name: 'Wufoo',             category: 'forms', type: 'cost',     pattern: /wufoo\.com/i },
    { name: 'Gravity Forms',     category: 'forms', type: 'workflow', pattern: /gravityforms|gform_wrapper/i },
    { name: 'WPForms',           category: 'forms', type: 'workflow', pattern: /wpforms/i },
    { name: 'Formidable Forms',  category: 'forms', type: 'workflow', pattern: /formidable/i },
    { name: 'Contact Form 7',    category: 'forms', type: 'basic',    pattern: /wpcf7|contact-form-7/i },
    { name: 'HubSpot Forms',     category: 'forms', type: 'cost',     pattern: /hsforms\.net|hs-form/i },
    { name: 'Cognito Forms',     category: 'forms', type: 'cost',     pattern: /cognitoforms\.com/i },

    // ── Analytics ──
    { name: 'Google Analytics',      category: 'analytics', pattern: /google-analytics\.com|googletagmanager\.com|gtag\/js/i },
    { name: 'GA4',                   category: 'analytics', pattern: /G-[A-Z0-9]{8,}/i },
    { name: 'Facebook Pixel',        category: 'analytics', pattern: /connect\.facebook\.net|fbevents\.js|fbq\(/i },
    { name: 'CallRail',              category: 'analytics', pattern: /callrail\.com|calltrk\.com/i },
    { name: 'CallTrackingMetrics',   category: 'analytics', pattern: /calltrackingmetrics\.com|tctm\.co/i },
    { name: 'Marchex',              category: 'analytics', pattern: /marchex\.io/i },
    { name: 'Hotjar',               category: 'analytics', pattern: /hotjar\.com|static\.hotjar\.com/i },
    { name: 'Microsoft Clarity',     category: 'analytics', pattern: /clarity\.ms/i },

    // ── Scheduling ──
    { name: 'Calendly',         category: 'scheduling', pattern: /calendly\.com/i },
    { name: 'Acuity',           category: 'scheduling', pattern: /acuityscheduling\.com/i },
    { name: 'Square Appointments', category: 'scheduling', pattern: /squareup\.com\/appointments|square\.site/i },
    { name: 'Booksy',           category: 'scheduling', pattern: /booksy\.com/i },
    { name: 'Vagaro',           category: 'scheduling', pattern: /vagaro\.com/i },

    // ── Chat / Messaging ──
    { name: 'Intercom',         category: 'chat', pattern: /intercom\.io|intercomcdn\.com/i },
    { name: 'Drift',            category: 'chat', pattern: /drift\.com|js\.driftt\.com/i },
    { name: 'LiveChat',         category: 'chat', pattern: /livechatinc\.com/i },
    { name: 'Zendesk',          category: 'chat', pattern: /zdassets\.com|zendesk\.com/i },
    { name: 'Tidio',            category: 'chat', pattern: /tidio\.co/i },
    { name: 'Tawk.to',          category: 'chat', pattern: /tawk\.to/i },

    // ── CMS ──
    { name: 'WordPress',        category: 'cms', pattern: /wp-content|wp-includes|wordpress/i },
    { name: 'Squarespace',      category: 'cms', pattern: /squarespace\.com|sqsp\.com/i },
    { name: 'Wix',              category: 'cms', pattern: /wix\.com|wixsite\.com|parastorage\.com/i },
    { name: 'Shopify',          category: 'cms', pattern: /shopify\.com|cdn\.shopify/i },
    { name: 'Webflow',          category: 'cms', pattern: /webflow\.com|assets\.website-files\.com/i },
    { name: 'GoDaddy Website Builder', category: 'cms', pattern: /godaddy\.com|secureserver\.net/i },
];

// ── Detection Engine ─────────────────────────────────────────────────────────

function _matchFingerprints(html) {
    const tools = [];

    for (const fp of FINGERPRINTS) {
        if (fp.pattern.test(html)) {
            const entry = { name: fp.name, category: fp.category, confidence: 'high' };
            if (fp.type) entry.type = fp.type;
            tools.push(entry);
        }
    }

    return tools;
}

function _classifyTools(tools) {
    const reputationTools = tools
        .filter(t => t.category === 'reputation')
        .map(t => ({ name: t.name, type: t.type || 'reputation' }));

    const formBuilders = tools
        .filter(t => t.category === 'forms')
        .map(t => ({ name: t.name, type: t.type || 'basic' }));

    const analytics = tools
        .filter(t => t.category === 'analytics')
        .map(t => ({ name: t.name }));

    return { reputationTools, formBuilders, analytics };
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Detect tech stack on a prospect's website.
 *
 * @param {string} url — prospect website URL
 * @returns {Promise<object|null>} — { tools, reputationTools, formBuilders, analytics, fetchStatus }
 *                                    or null if feature-flagged off
 */
async function detectTechStack(url) {
    // Feature flag gate
    if (process.env.ENABLE_TECH_STACK_DETECTION !== 'true') {
        return null;
    }

    // Validate URL (SSRF guard)
    const safeUrl = _validateUrl(url);
    if (!safeUrl) {
        return {
            tools: [],
            reputationTools: [],
            formBuilders: [],
            analytics: [],
            fetchStatus: 'invalid_url',
        };
    }

    // Cache-first
    const hostname = normalizeHostname(url);
    try {
        const cached = await getTechDetection(hostname);
        if (cached) {
            return { ...cached, fetchStatus: 'cache_hit' };
        }
    } catch {
        // Cache read failure — proceed to live fetch
    }

    // Live fetch with SSRF protections
    let html;
    try {
        const response = await axios.get(safeUrl, {
            timeout: 8000,
            maxRedirects: 3,
            maxContentLength: 1.5 * 1024 * 1024, // 1.5 MB
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; SynchIntroBot/1.0)',
                'Accept': 'text/html',
            },
            validateStatus: (status) => status < 400,
        });

        html = typeof response.data === 'string'
            ? response.data
            : String(response.data);
    } catch (err) {
        const failResult = {
            tools: [],
            reputationTools: [],
            formBuilders: [],
            analytics: [],
            fetchStatus: 'fetch_error',
        };
        await setTechDetection(hostname, failResult, false);
        return failResult;
    }

    // Run fingerprints
    const tools = _matchFingerprints(html);
    const { reputationTools, formBuilders, analytics } = _classifyTools(tools);

    const result = {
        tools,
        reputationTools,
        formBuilders,
        analytics,
        fetchStatus: 'ok',
    };

    // Cache success
    await setTechDetection(hostname, result, true);

    return result;
}

module.exports = {
    detectTechStack,
    // Exported for testing only
    _validateUrl,
    _matchFingerprints,
    _classifyTools,
    FINGERPRINTS,
};
