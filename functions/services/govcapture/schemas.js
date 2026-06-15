'use strict';

/**
 * SynchGov Firestore Schema Definitions — PRD v1.2 §3
 *
 * These are reference constants and validation helpers.
 * All gov* collections are CF-only (deny rules in firestore.rules).
 */

// ── govProfiles/{profileId} — §3A ────────────────────────────────────────────

/**
 * @typedef {object} GovProfile
 * @property {string}   userId
 * @property {string}   profileName
 * @property {string}   profileType         — 'pathsynch_internal' | 'countifi' | 'custom'
 * @property {string}   status              — 'active' | 'archived'
 * @property {boolean}  rescoreNeeded
 * @property {Array}    solutions           — ≤10 items
 * @property {object}   credentials
 * @property {object}   filters
 * @property {object}   digestSettings
 * @property {number}   autoArchiveDays
 * @property {Array}    negativeKeywords    — scoring only, never source queries
 * @property {Date}     createdAt
 * @property {Date}     updatedAt
 */

const MAX_SOLUTIONS = 10;
const MAX_KEYWORDS_PER_SOLUTION = 60;

/**
 * Fields the client is allowed to set on create/update.
 * Server-controlled fields (userId, createdAt, status on create) are stripped.
 */
const PROFILE_CLIENT_FIELDS = new Set([
    'profileName',
    'profileType',
    'solutions',
    'credentials',
    'filters',
    'digestSettings',
    'autoArchiveDays',
    'negativeKeywords',
]);

// ── govOpportunities/{oppId} — §3B ──────────────────────────────────────────

/**
 * @typedef {object} GovOpportunity
 * @property {string}   userId
 * @property {Array}    profileIds          — array-contains for multi-profile
 * @property {string}   primarySource       — 'sam_gov' | 'manual_upload' | 'rfpmart'
 * @property {string}   canonicalKey        — dedup key
 * @property {string}   title
 * @property {string}   buyerName
 * @property {string}   description
 * @property {object}   rawDates            — { responseDate, postedDate, archiveDate }
 * @property {string}   dateParseStatus     — 'parsed' | 'ambiguous' | 'missing'
 * @property {object}   location
 * @property {Array}    naicsCodes
 * @property {string}   setAside
 * @property {number}   estimatedValue
 * @property {object}   fit                 — { score, label, pass, reasons[], risks[], dimensions }
 * @property {object}   awardContext        — Pass 2 enrichment from USAspending
 * @property {object}   checklistAnswers
 * @property {string}   pursuitStatus       — 'new' | 'reviewing' | 'pursuing' | 'bid_submitted' | 'won' | 'lost' | 'no_bid'
 * @property {boolean}  archived
 * @property {Date}     createdAt
 * @property {Date}     updatedAt
 */

const PURSUIT_STATUSES = ['new', 'reviewing', 'pursuing', 'bid_submitted', 'won', 'lost', 'no_bid'];
const FIT_LABELS = ['Strong Fit', 'Good Fit', 'Possible Fit', 'Stretch', 'Poor Fit', 'Disqualified'];

// ── govChecklist/{profileId} — §3F ──────────────────────────────────────────

const DEFAULT_CHECKLIST_QUESTIONS = [
    'What is the budget ceiling or estimated contract value?',
    'Is there a mandatory pre-bid meeting or site visit?',
    'Are there specific geography requirements (place of performance)?',
    'What are the evaluation criteria and their weights?',
    'What are the submission instructions and required attachments?',
];

// ── govSyncLocks/{lockKey} — §3H ────────────────────────────────────────────

const SYNC_LOCK_LEASE_MINUTES = 10;

// ── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate a profile payload from client input.
 * Returns { valid: true } or { valid: false, error: string }.
 */
/**
 * @param {object} data
 * @param {object} [options]
 * @param {boolean} [options.isUpdate=false] — skip profileName requirement on updates
 */
function validateProfileInput(data, options = {}) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Profile data required' };
    }

    // Check for disallowed fields
    const keys = Object.keys(data);
    for (const key of keys) {
        if (!PROFILE_CLIENT_FIELDS.has(key)) {
            return { valid: false, error: `Unexpected field: ${key}` };
        }
    }

    // profileName required on create, optional on update
    if (!options.isUpdate) {
        if (!data.profileName || typeof data.profileName !== 'string' || !data.profileName.trim()) {
            return { valid: false, error: 'profileName is required' };
        }
    } else if (data.profileName !== undefined) {
        if (typeof data.profileName !== 'string' || !data.profileName.trim()) {
            return { valid: false, error: 'profileName must be a non-empty string' };
        }
    }

    // Solutions cap
    if (data.solutions) {
        if (!Array.isArray(data.solutions)) {
            return { valid: false, error: 'solutions must be an array' };
        }
        if (data.solutions.length > MAX_SOLUTIONS) {
            return { valid: false, error: `Maximum ${MAX_SOLUTIONS} solutions allowed` };
        }
        for (let i = 0; i < data.solutions.length; i++) {
            const sol = data.solutions[i];
            if (sol.keywords && Array.isArray(sol.keywords) && sol.keywords.length > MAX_KEYWORDS_PER_SOLUTION) {
                return { valid: false, error: `Solution ${i}: maximum ${MAX_KEYWORDS_PER_SOLUTION} keywords` };
            }
        }
    }

    return { valid: true };
}

/**
 * Strip undefined values from an object before Firestore write.
 */
function stripUndefined(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            cleaned[k] = v;
        }
    }
    return cleaned;
}

module.exports = {
    MAX_SOLUTIONS,
    MAX_KEYWORDS_PER_SOLUTION,
    PROFILE_CLIENT_FIELDS,
    PURSUIT_STATUSES,
    FIT_LABELS,
    DEFAULT_CHECKLIST_QUESTIONS,
    SYNC_LOCK_LEASE_MINUTES,
    validateProfileInput,
    stripUndefined,
};
