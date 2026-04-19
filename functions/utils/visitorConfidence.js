/**
 * Visitor Confidence Utilities
 *
 * Shared helpers for identity confidence scoring and ISP detection
 * used by trackVisitor, visitorRoutes, and the frontend.
 */

// Known ISPs — if resolved org name contains any of these (case-insensitive),
// account_match_confidence degrades to 10.
const KNOWN_ISPS = [
    'comcast', 'at&t', 'verizon', 't-mobile', 'xfinity', 'spectrum', 'cox',
    'charter', 'optimum', 'frontier', 'centurylink', 'lumen', 'windstream',
    'consolidated', 'mediacom'
];

/**
 * Check if a resolved org name belongs to a known ISP/carrier
 */
function isKnownISP(orgName) {
    if (!orgName) return false;
    const lower = orgName.toLowerCase();
    return KNOWN_ISPS.some(isp => lower.includes(isp));
}

/**
 * Derive confidence tier from identity_confidence_score
 * @param {number} score - 0-100
 * @returns {'identified'|'probable'|'unknown'}
 */
function getConfidenceTier(score) {
    if (score >= 80) return 'identified';
    if (score >= 40) return 'probable';
    return 'unknown';
}

/**
 * Get identity_confidence_score based on the identity source
 * @param {string} source - one of the identity_source enum values
 * @returns {number} 0-100
 */
function getScoreForSource(source) {
    switch (source) {
        case 'form_submit': return 100;
        case 'nfc_tap': return 85;
        case 'qr_scan': return 85;
        case 'return_fingerprint': return 65;
        case 'ip_company': return 30;
        default: return 0;
    }
}

/**
 * Compute account_match_confidence for a visitor record
 * @param {string} identitySource - identity_source value
 * @param {string|null} orgName - resolved org name from IPinfo
 * @returns {number} 0-100
 */
function getAccountMatchConfidence(identitySource, orgName) {
    if (identitySource === 'form_submit') return 100;
    if (identitySource === 'nfc_tap' || identitySource === 'qr_scan') return 85;
    if (isKnownISP(orgName)) return 10;
    if (identitySource === 'ip_company') return 30;
    return 20;
}

/**
 * Compute contact_match_confidence
 * @param {boolean} visitorIdentified - whether visitor_identified event has fired
 * @param {string|null} emailDomain - domain portion of visitor email
 * @param {string|null} companyDomain - resolved company domain
 * @returns {number} 0-100
 */
function getContactMatchConfidence(visitorIdentified, emailDomain, companyDomain) {
    if (!visitorIdentified) return 0;
    if (emailDomain && companyDomain && emailDomain.toLowerCase() === companyDomain.toLowerCase()) return 100;
    if (emailDomain) return 60;
    return 0;
}

/**
 * Build the full confidence fields object for a new visitor record
 * @param {object} opts
 * @param {string} opts.identitySource - identity_source enum value
 * @param {string|null} opts.orgName - resolved org name from IPinfo
 * @param {boolean} [opts.visitorIdentified=false]
 * @param {string|null} [opts.emailDomain=null]
 * @param {string|null} [opts.companyDomain=null]
 * @returns {object} the 4 confidence fields
 */
function buildConfidenceFields(opts) {
    const {
        identitySource = 'ip_company',
        orgName = null,
        visitorIdentified = false,
        emailDomain = null,
        companyDomain = null
    } = opts;

    return {
        identity_confidence_score: getScoreForSource(identitySource),
        identity_source: identitySource,
        account_match_confidence: getAccountMatchConfidence(identitySource, orgName),
        contact_match_confidence: getContactMatchConfidence(visitorIdentified, emailDomain, companyDomain)
    };
}

/**
 * Default confidence fields for backfilling existing records
 */
const BACKFILL_DEFAULTS = {
    identity_confidence_score: 20,
    identity_source: 'ip_company',
    account_match_confidence: 20,
    contact_match_confidence: 0
};

module.exports = {
    KNOWN_ISPS,
    isKnownISP,
    getConfidenceTier,
    getScoreForSource,
    getAccountMatchConfidence,
    getContactMatchConfidence,
    buildConfidenceFields,
    BACKFILL_DEFAULTS
};
