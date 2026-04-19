/**
 * entity360Bridge.js — Sprint 5 Task 5-2
 *
 * ONE-WAY bridge: visitorSignalService → Entity360 REST API.
 * Entity360 never calls back. All calls are fire-and-forget.
 *
 * Rules:
 *  - Only fires when merchantConfig has entity360MerchantId set
 *  - Every call wrapped in try/catch — Entity360 failure never breaks visitor tracking
 *  - Never called from emulator tests (mock the fetch in tests instead)
 *
 * Entity360 service URL: process.env.ENTITY360_SERVICE_URL
 * Auth: Bearer ENTITY360_INTERNAL_API_KEY
 */

const ENTITY360_URL = process.env.ENTITY360_SERVICE_URL
    || 'https://entity360-218613212853.us-central1.run.app';

/**
 * POST a behavioral event to Entity360 — fire-and-forget.
 * @param {string} merchantId - Entity360 merchantId (e.g. '937DF5')
 * @param {string} eventType - e.g. 'BEHAVIORAL_SIGNAL'
 * @param {string} severity - 'INFO' | 'HIGH'
 * @param {Object} payload - Event-specific payload
 */
function fireEvent(merchantId, eventType, severity, payload) {
    const url = `${ENTITY360_URL}/entity360/merchant360/${merchantId}/events`;
    const body = JSON.stringify({
        eventType,
        severity,
        source: 'visitorSignalService',
        payload
    });

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ENTITY360_INTERNAL_API_KEY || ''}`
        },
        body
    })
    .then(res => {
        if (!res.ok) {
            console.warn(`[Entity360Bridge] Event ${eventType} returned ${res.status} for merchant ${merchantId}`);
        } else {
            console.log(`[Entity360Bridge] Fired ${eventType} (${severity}) for merchant ${merchantId}`);
        }
    })
    .catch(err => {
        // Must never throw — Entity360 failure is non-critical
        console.warn(`[Entity360Bridge] ${eventType} call failed for merchant ${merchantId}:`, err.message);
    });
}

/**
 * Notify Entity360 when an account status changes to hot or outreach_now.
 * Called after Account360 upsert when status is hot or outreach_now.
 *
 * @param {string} entity360MerchantId - e.g. '937DF5'
 * @param {string} accountKey
 * @param {string} domain
 * @param {number} accountScore
 * @param {Array}  highIntentPages
 * @param {string} status - 'hot' | 'outreach_now'
 */
function notifyAccountStatus(entity360MerchantId, accountKey, domain, accountScore, highIntentPages, status) {
    if (!entity360MerchantId) return;

    const signalType = status === 'outreach_now' ? 'outreach_now_triggered' : 'hot_account_detected';
    const severity   = status === 'outreach_now' ? 'HIGH' : 'INFO';

    fireEvent(entity360MerchantId, 'BEHAVIORAL_SIGNAL', severity, {
        signalType,
        accountKey,
        domain,
        accountScore,
        highIntentPages: highIntentPages || []
    });
}

/**
 * Notify Entity360 when a contact is identified via visitor tracking.
 * Called after Account360 upsert when visitor_identified event fires.
 *
 * @param {string} entity360MerchantId
 * @param {string} accountKey
 * @param {string} email
 * @param {string|null} name
 * @param {string} identitySource
 * @param {number} identityConfidenceScore
 */
function notifyContactIdentified(entity360MerchantId, accountKey, email, name, identitySource, identityConfidenceScore) {
    if (!entity360MerchantId) return;

    fireEvent(entity360MerchantId, 'BEHAVIORAL_SIGNAL', 'INFO', {
        signalType: 'contact_identified',
        accountKey,
        email,
        name: name || null,
        identitySource,
        identityConfidenceScore
    });
}

/**
 * Post a weekly behavioral summary event to Entity360 for a merchant.
 * Called by merchantBehaviorSync.js.
 *
 * @param {string} entity360MerchantId
 * @param {Object} summary
 * @param {number} summary.totalAccounts
 * @param {number} summary.hotAccounts
 * @param {number} summary.outreachNowAccounts
 * @param {Array}  summary.topHighIntentPages
 * @param {number} summary.identificationRate
 */
function notifyBehavioralSummary(entity360MerchantId, summary) {
    if (!entity360MerchantId) return;

    fireEvent(entity360MerchantId, 'BEHAVIORAL_SUMMARY', 'INFO', {
        period: 'weekly',
        totalAccounts:       summary.totalAccounts,
        hotAccounts:         summary.hotAccounts,
        outreachNowAccounts: summary.outreachNowAccounts,
        topHighIntentPages:  summary.topHighIntentPages || [],
        identificationRate:  summary.identificationRate
    });

    // Low identification rate → traffic profile update
    if (summary.identificationRate < 10) {
        fireEvent(entity360MerchantId, 'TRAFFIC_PROFILE_UPDATE', 'INFO', {
            trafficProfile: 'consumer'
        });
    }
}

module.exports = {
    fireEvent,
    notifyAccountStatus,
    notifyContactIdentified,
    notifyBehavioralSummary
};
