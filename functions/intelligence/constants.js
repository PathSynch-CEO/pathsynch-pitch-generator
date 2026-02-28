/**
 * Intelligence Engine Constants
 *
 * Shared constants for the intelligence pipeline including
 * banned phrases, signal categories, and configuration.
 */

/**
 * Banned phrases that should never appear in generated briefs.
 * These are generic sales phrases that reduce personalization quality.
 */
const BANNED_PHRASES = [
    'streamline operations',
    'optimize workflows',
    'drive revenue growth',
    'enhance capabilities',
    'cutting-edge solution',
    'seamless integration',
    'empower teams',
    'unlock potential',
    'transform your business',
    'best-in-class',
    'leverage synergies',
    'holistic approach',
    'end-to-end solution',
    'world-class',
    'next-generation',
    'robust platform',
    'comprehensive solution',
    'innovative approach',
    'strategic partnership',
    'key stakeholders',
    'move the needle',
    'low-hanging fruit',
    'deep dive',
    'game-changer',
    'paradigm shift',
    'synergistic',
    'value-added',
    'turnkey solution',
    'scalable solution',
    'mission-critical',
];

/**
 * Signal categories for organizing intelligence signals
 */
const SIGNAL_CATEGORIES = {
    COMPANY_POSITIONING: 'company_positioning',
    MARKET_PRESENCE: 'market_presence',
    CONTACT_CONTEXT: 'contact_context',
    LEADERSHIP_DYNAMICS: 'leadership_dynamics',
    GROWTH_TRAJECTORY: 'growth_trajectory',
    TECH_STACK_GAP: 'tech_stack_gap',
    CONTENT_SIGNAL: 'content_signal',
    COMPETITIVE_PRESSURE: 'competitive_pressure',
    RISK_FACTOR: 'risk_factor',
    RAPPORT_HOOK: 'rapport_hook',
};

/**
 * Meeting type configurations
 */
const MEETING_TYPES = {
    discovery: {
        label: 'Discovery Call',
        emphasis: 'Heavy on hypotheses + questions. Light on product positioning.',
        questionFocus: 'open-ended discovery',
    },
    demo: {
        label: 'Demo',
        emphasis: 'Lead with pain-to-feature mapping. Include objection prep.',
        questionFocus: 'specific use cases and requirements',
    },
    followup: {
        label: 'Follow-up',
        emphasis: 'Reference previous meeting context. Focus on open items.',
        questionFocus: 'addressing concerns and next steps',
    },
    proposal: {
        label: 'Proposal',
        emphasis: 'ROI framing. Budget/authority signals. Competitive positioning.',
        questionFocus: 'decision criteria and timeline',
    },
    negotiation: {
        label: 'Negotiation',
        emphasis: 'Risk factors. Leverage points. BATNA analysis.',
        questionFocus: 'terms, concerns, and deal structure',
    },
};

/**
 * Test if text contains any banned phrases
 * @param {string} text - Text to check
 * @returns {object} Result with passed flag and violations list
 */
function genericityTest(text) {
    const lowerText = text.toLowerCase();
    const violations = BANNED_PHRASES.filter(phrase =>
        lowerText.includes(phrase.toLowerCase())
    );

    return {
        passed: violations.length === 0,
        violations,
        genericityScore: violations.length / BANNED_PHRASES.length,
    };
}

module.exports = {
    BANNED_PHRASES,
    SIGNAL_CATEGORIES,
    MEETING_TYPES,
    genericityTest,
};
