/**
 * Visitor Signal Service
 *
 * Classifies page visits into intent signals, calculates session-level
 * scores, and generates score explanations. Core scoring engine for
 * Sprint 2 Visitor Intel.
 *
 * Used by: visitorRoutes (on track event), session aggregator (Task 2-3)
 */

const { classifyUrl, classifyUrls } = require('../utils/urlHeuristics');

// ============================================
// TAG WEIGHTS
// ============================================
// Each tag has a base weight (points per page view) and a multiplier
// applied when the page is visited multiple times in a session.

const TAG_WEIGHTS = {
    pricing:      { base: 30, multiplier: 1.5 },
    demo:         { base: 35, multiplier: 1.5 },
    booking:      { base: 35, multiplier: 1.5 },
    high_intent:  { base: 25, multiplier: 1.3 },
    case_study:   { base: 25, multiplier: 1.2 },
    low_intent:   { base: 0,  multiplier: 1.0 },
    support_faq:  { base: 0,  multiplier: 1.0 },
    unclassified: { base: 5,  multiplier: 1.0 }
};

// ============================================
// EVENT WEIGHTS
// ============================================
// Points awarded for visitor-level events beyond page views.

const EVENT_WEIGHTS = {
    form_submit:        50,  // Filled out a form on the merchant's site
    return_visit:       15,  // Came back after ≥24h gap
    multi_page_session: 10,  // Viewed 3+ pages in one session
    repeat_high_intent: 20,  // Visited a high-intent page more than once
    nfc_tap:            40,  // Tapped NFC tag (physical)
    qr_scan:            40,  // Scanned QR code (physical)
    identified_contact: 30   // A contact was identified (email match)
};

// ============================================
// NEGATIVE SIGNAL RULES
// ============================================
// Deductions applied when negative patterns are detected.

const NEGATIVE_SIGNALS = {
    only_support:     { deduction: -15, description: 'Only visited support/FAQ pages' },
    bounce:           { deduction: -10, description: 'Single page view, no return' },
    isp_visitor:      { deduction: -20, description: 'Visitor resolved to ISP, not a company' },
    stale_visitor:    { deduction: -10, description: 'No activity in 14+ days' }
};

// Staleness threshold (days with no activity before penalty)
const STALE_DAYS = 14;

// ============================================
// PAGE CLASSIFICATION
// ============================================

/**
 * Classify a single page URL using merchant mappings + heuristic fallback.
 * @param {string} pageUrl - The page URL or path
 * @param {Object[]} merchantMappings - Array of { url, tag } from merchantConfig
 * @returns {{ url: string, tag: string, source: string }}
 */
function classifyPage(pageUrl, merchantMappings = []) {
    const results = classifyUrls([pageUrl], merchantMappings);
    return results[0];
}

/**
 * Classify multiple pages at once.
 * @param {string[]} pageUrls
 * @param {Object[]} merchantMappings
 * @returns {Object[]} Array of { url, tag, source }
 */
function classifyPages(pageUrls, merchantMappings = []) {
    return classifyUrls(pageUrls, merchantMappings);
}

// ============================================
// SESSION SCORING
// ============================================

/**
 * Calculate a session score from a list of page views and events.
 *
 * @param {Object} opts
 * @param {string[]} opts.pages - Array of page URLs visited in the session
 * @param {Object[]} opts.merchantMappings - Merchant URL tag overrides
 * @param {Object} [opts.events] - Map of event names that occurred, e.g. { form_submit: true, return_visit: true }
 * @param {boolean} [opts.isISP] - Whether the visitor resolved to a known ISP
 * @param {Date|null} [opts.lastSeenAt] - Last activity timestamp (for staleness check)
 * @returns {{ score: number, signals: Object[], negatives: Object[], explanation: string[], tagBreakdown: Object }}
 */
function scoreSession(opts) {
    const {
        pages = [],
        merchantMappings = [],
        events = {},
        isISP = false,
        lastSeenAt = null
    } = opts;

    let score = 0;
    const signals = [];
    const negatives = [];
    const explanation = [];
    const tagBreakdown = {};

    // --- 1. Classify and score pages ---
    const classified = classifyPages(pages, merchantMappings);
    const tagCounts = {};

    for (const item of classified) {
        const tag = item.tag;
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }

    for (const [tag, count] of Object.entries(tagCounts)) {
        const weight = TAG_WEIGHTS[tag] || TAG_WEIGHTS.unclassified;
        // First view gets base weight; subsequent views get base × multiplier
        const firstViewPoints = weight.base;
        const repeatPoints = count > 1 ? Math.round(weight.base * weight.multiplier * (count - 1)) : 0;
        const tagTotal = firstViewPoints + repeatPoints;

        tagBreakdown[tag] = { count, points: tagTotal };
        score += tagTotal;

        if (tagTotal > 0) {
            signals.push({
                type: 'page_view',
                tag,
                count,
                points: tagTotal,
                description: `${count}× ${tag} page${count > 1 ? 's' : ''} (+${tagTotal})`
            });
        }
    }

    if (Object.keys(tagCounts).length > 0) {
        const highIntentTags = ['pricing', 'demo', 'booking', 'high_intent'];
        const highIntentCount = highIntentTags.reduce((sum, t) => sum + (tagCounts[t] || 0), 0);
        explanation.push(`Viewed ${pages.length} page${pages.length !== 1 ? 's' : ''} (${highIntentCount} high-intent)`);
    }

    // --- 2. Event scoring ---
    for (const [event, occurred] of Object.entries(events)) {
        if (!occurred) continue;
        const weight = EVENT_WEIGHTS[event];
        if (weight) {
            score += weight;
            signals.push({
                type: 'event',
                event,
                points: weight,
                description: `${formatEventName(event)} (+${weight})`
            });
            explanation.push(formatEventName(event));
        }
    }

    // --- 3. Auto-detect events from page data ---
    // Multi-page session (3+ unique pages)
    if (pages.length >= 3 && !events.multi_page_session) {
        score += EVENT_WEIGHTS.multi_page_session;
        signals.push({
            type: 'event',
            event: 'multi_page_session',
            points: EVENT_WEIGHTS.multi_page_session,
            description: `Multi-page session (+${EVENT_WEIGHTS.multi_page_session})`
        });
    }

    // Repeat high-intent visits
    const highIntentRepeat = ['pricing', 'demo', 'booking'].some(t => (tagCounts[t] || 0) > 1);
    if (highIntentRepeat && !events.repeat_high_intent) {
        score += EVENT_WEIGHTS.repeat_high_intent;
        signals.push({
            type: 'event',
            event: 'repeat_high_intent',
            points: EVENT_WEIGHTS.repeat_high_intent,
            description: `Repeat high-intent visit (+${EVENT_WEIGHTS.repeat_high_intent})`
        });
    }

    // --- 4. Negative signals ---
    // Only support/FAQ pages
    const allTags = Object.keys(tagCounts);
    const onlySupport = allTags.length > 0 && allTags.every(t => t === 'support_faq' || t === 'low_intent');
    if (onlySupport && pages.length > 0) {
        score += NEGATIVE_SIGNALS.only_support.deduction;
        negatives.push({ ...NEGATIVE_SIGNALS.only_support, rule: 'only_support' });
        explanation.push('Only low-intent/support pages visited');
    }

    // Bounce (single page, no return)
    if (pages.length === 1 && !events.return_visit) {
        score += NEGATIVE_SIGNALS.bounce.deduction;
        negatives.push({ ...NEGATIVE_SIGNALS.bounce, rule: 'bounce' });
        explanation.push('Single page bounce');
    }

    // ISP visitor
    if (isISP) {
        score += NEGATIVE_SIGNALS.isp_visitor.deduction;
        negatives.push({ ...NEGATIVE_SIGNALS.isp_visitor, rule: 'isp_visitor' });
        explanation.push('Visitor IP belongs to an ISP');
    }

    // Stale visitor (no activity in 14+ days)
    if (lastSeenAt) {
        const lastSeen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt._seconds ? lastSeenAt._seconds * 1000 : lastSeenAt);
        const daysSince = Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince >= STALE_DAYS) {
            score += NEGATIVE_SIGNALS.stale_visitor.deduction;
            negatives.push({ ...NEGATIVE_SIGNALS.stale_visitor, rule: 'stale_visitor', daysSince });
            explanation.push(`No activity for ${daysSince} days`);
        }
    }

    // Floor at 0
    score = Math.max(0, score);

    return {
        score,
        signals,
        negatives,
        explanation,
        tagBreakdown
    };
}

// ============================================
// SCORE EXPLANATION
// ============================================

/**
 * Generate a human-readable score explanation string.
 * @param {{ score: number, signals: Object[], negatives: Object[], explanation: string[] }} result
 * @returns {string}
 */
function buildScoreExplanation(result) {
    const parts = [];

    if (result.explanation.length > 0) {
        parts.push(result.explanation.join('. ') + '.');
    }

    if (result.negatives.length > 0) {
        const deductions = result.negatives.map(n => n.description).join('; ');
        parts.push(`Deductions: ${deductions}.`);
    }

    parts.push(`Session score: ${result.score}`);

    return parts.join(' ');
}

// ============================================
// HELPERS
// ============================================

function formatEventName(event) {
    const names = {
        form_submit: 'Form submitted',
        return_visit: 'Return visit',
        multi_page_session: 'Multi-page session',
        repeat_high_intent: 'Repeat high-intent visit',
        nfc_tap: 'NFC tap',
        qr_scan: 'QR scan',
        identified_contact: 'Contact identified'
    };
    return names[event] || event.replace(/_/g, ' ');
}

module.exports = {
    TAG_WEIGHTS,
    EVENT_WEIGHTS,
    NEGATIVE_SIGNALS,
    STALE_DAYS,
    classifyPage,
    classifyPages,
    scoreSession,
    buildScoreExplanation
};
