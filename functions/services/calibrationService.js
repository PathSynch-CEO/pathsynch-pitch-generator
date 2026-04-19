/**
 * Calibration Service
 *
 * Day-30 auto-calibration for Visitor Intel merchants.
 * Reads 30 days of session data, computes traffic statistics,
 * auto-tunes thresholds, and deactivates learning mode.
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Threshold presets
const THRESHOLDS_LOW_TRAFFIC  = { warming: 50,  hot: 100, outreachNow: 150 };
const THRESHOLDS_NORMAL       = { warming: 75,  hot: 150, outreachNow: 200 };

// Traffic profile boundaries
const B2B_HIGH_CUTOFF      = 0.30; // > 30% non-IP-company → b2b
const B2B_LOW_CUTOFF       = 0.10; // < 10% → consumer
const LOW_TRAFFIC_MEDIAN   = 20;   // median session score below this → use low thresholds

/**
 * Compute median of a numeric array.
 */
function median(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calibrate a merchant after 30 days of learning mode.
 *
 * 1. Reads sessions from websiteVisitors/{merchantId}/sessions (last 30 days)
 * 2. Computes medianSessionScore, identifiedPct, b2bPct
 * 3. Auto-tunes thresholds and trafficProfile
 * 4. Sets learningModeActive: false on merchantConfig
 * 5. Writes calibrationReport subcollection document
 *
 * @param {string} merchantId
 * @returns {Object} calibration result summary
 */
async function calibrateMerchant(merchantId) {
    if (!merchantId) throw new Error('merchantId is required');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // --- 1. Read sessions from last 30 days ---
    const sessionsSnap = await db
        .collection('websiteVisitors')
        .doc(merchantId)
        .collection('sessions')
        .get();

    const sessions = sessionsSnap.docs
        .map(d => d.data())
        .filter(s => {
            if (!s.startTime) return true; // include if no timestamp
            const ts = s.startTime._seconds
                ? new Date(s.startTime._seconds * 1000)
                : new Date(s.startTime);
            return ts >= thirtyDaysAgo;
        });

    const totalSessions = sessions.length;

    // --- 2. Compute statistics ---
    const scores = sessions.map(s => s.score || 0);
    const medianSessionScore = median(scores);

    // identifiedPct: sessions where identityConfidenceScore >= 80
    const identifiedCount = sessions.filter(s =>
        (s.identityConfidenceScore || 0) >= 80
    ).length;
    const identifiedPct = totalSessions > 0
        ? Math.round((identifiedCount / totalSessions) * 100) / 100
        : 0;

    // b2bPct: sessions where identity_source is not ip_company or unknown
    const NON_IP_SOURCES = ['form_submit', 'nfc_tap', 'qr_scan', 'return_fingerprint'];
    const b2bCount = sessions.filter(s =>
        NON_IP_SOURCES.includes(s.identitySource)
    ).length;
    const b2bPct = totalSessions > 0
        ? Math.round((b2bCount / totalSessions) * 100) / 100
        : 0;

    // --- 3. Auto-tune thresholds ---
    const adjustedThresholds = medianSessionScore < LOW_TRAFFIC_MEDIAN
        ? THRESHOLDS_LOW_TRAFFIC
        : THRESHOLDS_NORMAL;

    // --- 4. Derive traffic profile ---
    let trafficProfile;
    if (b2bPct > B2B_HIGH_CUTOFF) {
        trafficProfile = 'b2b';
    } else if (b2bPct < B2B_LOW_CUTOFF) {
        trafficProfile = 'consumer';
    } else {
        trafficProfile = 'mixed';
    }

    // --- 5. Collect top pages ---
    const pageCounts = {};
    for (const s of sessions) {
        for (const page of (s.pages || [])) {
            pageCounts[page] = (pageCounts[page] || 0) + 1;
        }
    }
    const topPages = Object.entries(pageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, visits]) => ({ url, visits }));

    // --- 6. Write merchantConfig updates ---
    const configRef = db.collection('merchantConfig').doc(merchantId);
    const now = FieldValue.serverTimestamp();

    await configRef.set({
        learningModeActive: false,
        learningModeCompletedAt: now,
        thresholds: adjustedThresholds,
        trafficProfile,
        updatedAt: now
    }, { merge: true });

    // --- 7. Write calibration report ---
    const reportRef = configRef.collection('calibrationReport').doc('latest');
    const report = {
        merchantId,
        totalSessions,
        medianSessionScore,
        identifiedPct,
        b2bPct,
        trafficProfile,
        adjustedThresholds,
        topPages,
        calibratedAt: now,
        learningModeActive: false
    };

    await reportRef.set(report);

    console.log(`[Calibration] ${merchantId}: ${totalSessions} sessions, median=${medianSessionScore}, b2bPct=${b2bPct}, profile=${trafficProfile}`);

    return {
        merchantId,
        totalSessions,
        medianSessionScore,
        identifiedPct,
        b2bPct,
        trafficProfile,
        adjustedThresholds,
        topPages
    };
}

module.exports = { calibrateMerchant };
