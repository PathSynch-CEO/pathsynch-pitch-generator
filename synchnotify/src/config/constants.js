/**
 * SynchNotify Constants
 *
 * Event types, sources, priorities, and tier definitions.
 * Matches the Master PRD event registry and SynchIntro's planGate.js hierarchy.
 */

// Allowed event sources (Master PRD Section 3.2)
const ALLOWED_SOURCES = [
    'synchintro',
    'pathconnect',
    'localsynch',
    'referralsynch',
    'pathmanager'
];

// Allowed event types (Master PRD Section 6)
const ALLOWED_EVENT_TYPES = [
    'positive_reply',
    'bounce_spike',
    'domain_health',
    'warmup_stall',
    'new_review',
    'review_draft_pending',
    'review_auto_reply_posted',
    'competitor_rank_change',
    'gbp_issue',
    'ai_visibility_drop',
    'referral_received',
    'referral_converted',
    'form_submission',
    'payment_failed',
    'plan_changed',
    'daily_digest'
];

// Allowed priority levels (Master PRD Section 3.2)
const ALLOWED_PRIORITIES = [
    'critical',
    'high',
    'normal',
    'low'
];

// Identity spaces (Master PRD Section 3.1)
const ALLOWED_IDENTITY_SPACES = [
    'firebase',
    'pathmanager'
];

// Event envelope version
const ENVELOPE_VERSION = '1.0';

// HMAC replay protection window (milliseconds)
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Cloud Tasks retry policy
const CLOUD_TASK_MAX_ATTEMPTS = 3;
const CLOUD_TASK_RETRY_DELAYS_MS = [10000, 30000, 90000]; // 10s, 30s, 90s

// Plan hierarchy — matches SynchIntro's planGate.js local array pattern
// Phase 1-2: SynchIntro tiers only. Phase 3: normalize with PathManager's agency tier.
const PLAN_HIERARCHY = ['starter', 'growth', 'scale', 'enterprise'];

// Channel limits per plan tier (Master PRD Section 4)
const TIER_CHANNEL_LIMITS = {
    starter: 1,
    growth: 2,
    scale: 3,
    enterprise: Infinity
};

// Event type access by minimum tier (Master PRD Section 4)
const EVENT_TYPE_MIN_TIER = {
    positive_reply: 'starter',
    bounce_spike: 'scale',
    domain_health: 'scale',
    warmup_stall: 'scale'
};

module.exports = {
    ALLOWED_SOURCES,
    ALLOWED_EVENT_TYPES,
    ALLOWED_PRIORITIES,
    ALLOWED_IDENTITY_SPACES,
    ENVELOPE_VERSION,
    REPLAY_WINDOW_MS,
    CLOUD_TASK_MAX_ATTEMPTS,
    CLOUD_TASK_RETRY_DELAYS_MS,
    PLAN_HIERARCHY,
    TIER_CHANNEL_LIMITS,
    EVENT_TYPE_MIN_TIER
};
