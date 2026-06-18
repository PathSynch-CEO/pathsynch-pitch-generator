/**
 * Reply Classifier
 *
 * Lightweight sentiment classification for Instantly webhook replies.
 * No Gemini/AI — deterministic keyword matching only.
 *
 * Classification output: 'positive', 'negative', or 'ambiguous'
 *
 * Rules:
 * - Case-insensitive, punctuation-normalized
 * - Negative indicators win over positive when both appear
 * - Word-boundary matching for broad terms (call, yes)
 * - "do not call" / "don't call" override bare "call"
 */

// Positive indicators — phrases that suggest genuine interest
const POSITIVE_INDICATORS = [
    'interested',
    'tell me more',
    'pricing',
    'schedule',
    'demo',
    'call',
    'yes',
    'love to',
    'sounds good',
    'absolutely',
    'definitely',
    'lets talk',
    "let's talk",
    'when can we',
    'how much',
    'sign me up'
];

// Negative indicators — opt-out or rejection phrases
const NEGATIVE_INDICATORS = [
    'unsubscribe',
    'remove',
    'stop',
    'not interested',
    'no thanks',
    'opt out',
    'take me off',
    'do not contact',
    "don't contact",
    'do not email',
    "don't email"
];

// Negation prefixes that invalidate broad positive terms
const NEGATION_PATTERNS = [
    'do not',
    "don't",
    'dont',
    'please do not',
    "please don't",
    'no',
    'not',
    'never'
];

// Broad positive terms that need extra context checking
const BROAD_POSITIVES = ['call', 'yes'];

/**
 * Normalize text for classification.
 * Lowercases, normalizes unicode apostrophes, strips excess whitespace.
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // smart quotes → straight
        .replace(/[.,!?;:()[\]{}]/g, ' ')             // punctuation → space
        .replace(/\s+/g, ' ')                          // collapse whitespace
        .trim();
}

/**
 * Check if a phrase appears at a word boundary in the text.
 */
function hasPhrase(normalized, phrase) {
    // Build regex with word boundaries
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|\\b)${escaped}(?:\\s|\\b|$)`, 'i');
    return regex.test(normalized);
}

/**
 * Check if a broad positive term is negated in context.
 * Returns true if the term appears but is preceded by a negation.
 */
function isBroadTermNegated(normalized, term) {
    for (const negation of NEGATION_PATTERNS) {
        // Check "do not call", "don't call", "no call", etc.
        if (hasPhrase(normalized, `${negation} ${term}`)) {
            return true;
        }
    }
    return false;
}

/**
 * Classify reply sentiment.
 *
 * @param {string} replyText - The reply text to classify
 * @returns {{ classification: string, positiveMatches: string[], negativeMatches: string[] }}
 */
function classifyReply(replyText) {
    const normalized = normalizeText(replyText);

    if (!normalized) {
        return {
            classification: 'ambiguous',
            positiveMatches: [],
            negativeMatches: []
        };
    }

    const positiveMatches = [];
    const negativeMatches = [];

    // Check negative indicators first
    for (const indicator of NEGATIVE_INDICATORS) {
        if (hasPhrase(normalized, indicator)) {
            negativeMatches.push(indicator);
        }
    }

    // Check positive indicators
    for (const indicator of POSITIVE_INDICATORS) {
        if (hasPhrase(normalized, indicator)) {
            // For broad terms, verify they aren't negated
            if (BROAD_POSITIVES.includes(indicator)) {
                if (isBroadTermNegated(normalized, indicator)) {
                    // Broad term is negated — treat as negative signal
                    if (!negativeMatches.includes(`not ${indicator}`)) {
                        negativeMatches.push(`not ${indicator}`);
                    }
                    continue;
                }
            }
            positiveMatches.push(indicator);
        }
    }

    // Classification rules:
    // 1. Any negative match → negative (negative wins)
    // 2. Both positive and negative → negative
    // 3. Only positive matches → positive
    // 4. No matches → ambiguous
    let classification;
    if (negativeMatches.length > 0) {
        classification = 'negative';
    } else if (positiveMatches.length > 0) {
        classification = 'positive';
    } else {
        classification = 'ambiguous';
    }

    return {
        classification,
        positiveMatches,
        negativeMatches
    };
}

/**
 * Create a safe snippet of reply text for logging.
 * Truncates to maxLength and removes sensitive patterns.
 */
function safeSnippet(text, maxLength = 200) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength - 3) + '...';
}

module.exports = {
    classifyReply,
    normalizeText,
    safeSnippet,
    POSITIVE_INDICATORS,
    NEGATIVE_INDICATORS
};
