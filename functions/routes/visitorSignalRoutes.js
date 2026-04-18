/**
 * Visitor Signal Routes — Sprint 3 Full Pipeline
 *
 * POST /visitor-signal/ingest — batched visitor events, full 10-rule contract
 * GET  /visitor-accounts       — account-level scoring summaries for the UI
 *
 * Contract rules:
 *  1. Input validation (batch size, event age, required fields)
 *  2. merchantConfig fetch (heuristic-only fallback if missing)
 *  3. 5 ordered Firestore writes (visitorIntelSummary first)
 *  4. Partial write handling (visitorIntelSummary first, Account360 retried)
 *  5. Low-confidence guardrail (confidence < 20 → session only)
 *  6. Learning mode guardrail (no threshold events, no hot/outreach_now)
 *  7. Signal quality gate (5 checks before hot/outreach_now)
 *  8. Duplicate threshold suppression (pubSubThresholdLog window)
 *  9. Idempotency (SHA-256 eventId, skip duplicate signalHistory)
 * 10. Retry behavior (3× exponential backoff for Firestore, IPinfo fallback)
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes, badRequest } = require('../middleware/errorHandler');
const { scoreSession, buildScoreExplanation } = require('../services/visitorSignalService');
const { isKnownISP, getConfidenceTier } = require('../utils/visitorConfidence');

const router = createRouter();
const db = admin.firestore();

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_BATCH_SIZE  = 50;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_THRESHOLDS = { warming: 75, hot: 150, outreachNow: 200 };

const VALID_EVENT_TYPES = new Set([
    'page_view', 'page_exit', 'scroll_depth', 'cta_click',
    'form_submit', 'return_visit', 'nfc_tap', 'qr_scan',
    'identified_contact', 'qr_entry', 'referral_link_entry',
    'review_prompt_shown', 'review_prompt_clicked',
    'visitor_identified'
]);

const SIGNAL_QUALITY_RULES = {
    minSessions:          2,
    minDistinctEventTypes: 3,
    minIdentitySources:   2,
    minHighIntentPages:   1,
    minDaysObserved:      1
};

const HIGH_INTENT_TAGS = ['pricing', 'demo', 'booking', 'high_intent'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 of normalized domain (first 32 hex chars).
 */
function computeAccountKey(domain) {
    if (!domain) return null;
    const normalized = domain.toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
}

/**
 * Deterministic eventId = SHA-256(merchantId + sessionId + timestamp + eventType).
 */
function computeEventId(merchantId, sessionId, timestamp, eventType) {
    return crypto.createHash('sha256')
        .update([merchantId, sessionId, timestamp, eventType].join('|'))
        .digest('hex')
        .substring(0, 32);
}

/**
 * Determine status tier. Learning mode blocks hot and outreach_now.
 */
function getStatusTier(accountScore, thresholds, learningMode, qualityGatePassed) {
    const t = thresholds || DEFAULT_THRESHOLDS;
    if (accountScore >= t.outreachNow && qualityGatePassed && !learningMode) return 'outreach_now';
    if (accountScore >= t.hot && qualityGatePassed && !learningMode) return 'hot';
    if (accountScore >= t.warming) return 'warming';
    return 'cold';
}

/**
 * Evaluate the 5-rule signal quality gate.
 */
function evaluateSignalQuality(accountData, sessionResult, sessionMeta) {
    const existingSessions = accountData.sessions || [];
    const totalSessions = existingSessions.length + 1;

    const allEventTypes = new Set(['page_view']); // current session always has page_view
    for (const s of existingSessions) {
        if (s.eventTypes) s.eventTypes.forEach(e => allEventTypes.add(e));
    }
    for (const sig of sessionResult.signals) {
        if (sig.type === 'event') allEventTypes.add(sig.event);
    }

    const allSources = new Set();
    if (sessionMeta.identitySource) allSources.add(sessionMeta.identitySource);
    for (const s of existingSessions) {
        if (s.identitySource) allSources.add(s.identitySource);
    }

    let totalHighIntent = 0;
    for (const s of existingSessions) {
        if (s.tagBreakdown) {
            for (const tag of HIGH_INTENT_TAGS) {
                totalHighIntent += (s.tagBreakdown[tag]?.count || 0);
            }
        }
    }
    for (const tag of HIGH_INTENT_TAGS) {
        totalHighIntent += (sessionResult.tagBreakdown[tag]?.count || 0);
    }

    const firstSeen = accountData.firstSeen ? toDate(accountData.firstSeen) : new Date();
    const daysObserved = Math.floor((Date.now() - firstSeen.getTime()) / 864e5);

    const checks = {
        minSessions:           totalSessions >= SIGNAL_QUALITY_RULES.minSessions,
        minDistinctEventTypes: allEventTypes.size >= SIGNAL_QUALITY_RULES.minDistinctEventTypes,
        minIdentitySources:    allSources.size >= SIGNAL_QUALITY_RULES.minIdentitySources,
        minHighIntentPages:    totalHighIntent >= SIGNAL_QUALITY_RULES.minHighIntentPages,
        minDaysObserved:       daysObserved >= SIGNAL_QUALITY_RULES.minDaysObserved
    };

    const passed = Object.values(checks).every(Boolean);
    const score  = Object.values(checks).filter(Boolean).length;

    return { passed, checks, score, total: 5 };
}

/**
 * Convert Firestore timestamp or ISO string to Date.
 */
function toDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (val._seconds) return new Date(val._seconds * 1000);
    if (val.toDate) return val.toDate();
    return new Date(val);
}

/**
 * Retry a Firestore write up to maxAttempts with exponential backoff.
 * Delays: 1s, 2s, 4s
 */
async function withRetry(fn, maxAttempts = 3, label = '') {
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i < maxAttempts - 1) {
                const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
                console.warn(`[visitorSignal] ${label} attempt ${i + 1} failed, retrying in ${delay}ms`, err.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

/**
 * Build an Account360 provenance block for a field value.
 */
function provenance(value, confidence = 60) {
    return {
        value,
        confidence,
        source:         'visitorSignalService',
        updatedAt:      new Date().toISOString(),
        sourceTier:     'derived',
        humanConfirmed: false
    };
}

/**
 * ConflictEngine: resolve competing field writes for Account360.
 * Priority: humanConfirmed → sourceTier (primary>derived>inferred) → confidence → updatedAt
 */
const SOURCE_TIER_RANK = { primary: 3, derived: 2, inferred: 1 };

function resolveField(existing, incoming) {
    if (!existing) return incoming;
    // 1. humanConfirmed wins
    if (existing.humanConfirmed) return existing;
    if (incoming.humanConfirmed) return incoming;
    // 2. Stronger sourceTier wins
    const existRank = SOURCE_TIER_RANK[existing.sourceTier] || 0;
    const incomRank = SOURCE_TIER_RANK[incoming.sourceTier] || 0;
    if (existRank !== incomRank) return existRank > incomRank ? existing : incoming;
    // 3. Higher confidence wins
    if (existing.confidence !== incoming.confidence) {
        return existing.confidence > incoming.confidence ? existing : incoming;
    }
    // 4. Most recent updatedAt wins
    return new Date(incoming.updatedAt) >= new Date(existing.updatedAt) ? incoming : existing;
}

// ── POST /visitor-signal/ingest ──────────────────────────────────────────────

router.post('/visitor-signal/ingest', async (req, res) => {
    try {
        // ── Rule 1: Input validation ──────────────────────────────────────
        const { merchantId, sessionId, visitorId, learningMode, events } = req.body;

        if (!merchantId) throw badRequest('merchantId is required');
        if (!sessionId)  throw badRequest('sessionId is required');
        if (!visitorId)  throw badRequest('visitorId is required');
        if (!events || !Array.isArray(events)) throw badRequest('events must be an array');
        if (events.length === 0)              throw badRequest('events array cannot be empty');
        if (events.length > MAX_BATCH_SIZE) {
            throw badRequest(`Batch size ${events.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
        }

        const now = Date.now();
        for (const evt of events) {
            if (!evt.type) throw badRequest('Each event must have a type field');
            if (evt.timestamp) {
                const age = now - new Date(evt.timestamp).getTime();
                if (age > MAX_EVENT_AGE_MS) throw badRequest('Batch contains events older than 24 hours');
            }
        }

        // ── Rule 2: merchantConfig fetch ──────────────────────────────────
        let config = null;
        let heuristicOnly = false;
        try {
            const configDoc = await db.collection('merchantConfig').doc(merchantId).get();
            if (configDoc.exists) {
                config = configDoc.data();
            } else {
                heuristicOnly = true;
                console.warn(`[visitorSignal] merchantConfig missing for ${merchantId} — heuristic only`);
            }
        } catch (err) {
            heuristicOnly = true;
            console.warn(`[visitorSignal] merchantConfig read failed — heuristic only`, err.message);
        }

        const merchantMappings = config?.urlMappings || [];
        const thresholds       = config?.thresholds  || DEFAULT_THRESHOLDS;
        const suppHours        = config?.duplicateSuppressionHours || 4;
        const isLearningMode   = learningMode !== undefined
            ? learningMode
            : (config?.learningModeActive ?? true);

        // ── Extract pages, event flags, identity from batch ───────────────
        const pages = [];
        const eventFlags = {};
        let identitySource         = 'ip_company';
        let identityConfidenceScore = 20;
        let companyDomain  = null;
        let companyName    = null;
        let visitorEmail   = null;
        let isISP          = false;
        let startTime      = null;
        let lastSeenAt     = null;

        const SOURCE_RANK = {
            form_submit: 5, nfc_tap: 4, qr_scan: 4,
            return_fingerprint: 3, ip_company: 2, unknown: 1
        };

        for (const evt of events) {
            const evtDate = evt.timestamp ? new Date(evt.timestamp) : new Date();
            if (!startTime || evtDate < startTime) startTime = evtDate;
            if (!lastSeenAt || evtDate > lastSeenAt) lastSeenAt = evtDate;

            if (evt.type === 'page_view' && evt.page) pages.push(evt.page);

            if (['form_submit', 'return_visit', 'nfc_tap', 'qr_scan', 'identified_contact']
                    .includes(evt.type)) {
                eventFlags[evt.type] = true;
            }

            if (evt.identitySource &&
                (SOURCE_RANK[evt.identitySource] || 0) > (SOURCE_RANK[identitySource] || 0)) {
                identitySource = evt.identitySource;
            }
            if (evt.identityConfidenceScore > identityConfidenceScore) {
                identityConfidenceScore = evt.identityConfidenceScore;
            }
            if (evt.companyDomain) companyDomain = evt.companyDomain;
            if (evt.companyName)   companyName   = evt.companyName;
            if (evt.email)         visitorEmail  = evt.email;
            if (evt.isISP)         isISP         = true;
        }

        // ── Rule 9: Compute eventId for idempotency ───────────────────────
        // Use the first page_view or the first event as the canonical event
        const canonicalEvt = events.find(e => e.type === 'page_view') || events[0];
        const eventId = computeEventId(
            merchantId, sessionId,
            canonicalEvt.timestamp || new Date().toISOString(),
            canonicalEvt.type
        );

        // ── Scoring engine ────────────────────────────────────────────────
        const scoreResult    = scoreSession({ pages, merchantMappings, events: eventFlags, isISP, lastSeenAt });
        const scoreExplanation = buildScoreExplanation(scoreResult);

        const eventTypes = [...new Set(
            scoreResult.signals.map(s => s.type === 'event' ? s.event : 'page_view')
        )];

        const sessionMeta = { identitySource, identityConfidenceScore, identitySource };

        // ── Rule 5: Low-confidence guardrail ──────────────────────────────
        const lowConfidence = identityConfidenceScore < 20;

        // ── Account key ───────────────────────────────────────────────────
        const accountKey = companyDomain ? computeAccountKey(companyDomain) : null;
        let isDuplicateEvent = false;

        // ── Build account aggregation (needed for write order) ────────────
        let accountScore  = scoreResult.score;
        let accountStatus = null;
        let qualityGate   = null;
        let accountUpdate = null;
        let existingAccountData = {};

        if (accountKey && !lowConfidence) {
            const accountRef = db.collection('visitorIntelSummary').doc(merchantId)
                .collection('accounts').doc(accountKey);
            const accountSnap = await accountRef.get();
            existingAccountData = accountSnap.exists ? accountSnap.data() : {};

            const existingSessions = existingAccountData.sessions || [];
            const thirtyDaysAgo   = now - 30 * 864e5;

            const allSessions = [
                ...existingSessions,
                {
                    sessionId,
                    score:          scoreResult.score,
                    timestamp:      (startTime || new Date()).toISOString(),
                    eventTypes:     [...new Set(eventTypes)],
                    identitySource,
                    tagBreakdown:   scoreResult.tagBreakdown
                }
            ];

            const recentSessions = allSessions.filter(s =>
                new Date(s.timestamp).getTime() >= thirtyDaysAgo
            );

            accountScore = recentSessions.reduce((sum, s) => sum + (s.score || 0), 0);

            const highIntentPages = new Set();
            for (const s of recentSessions) {
                if (s.tagBreakdown) {
                    for (const tag of HIGH_INTENT_TAGS) {
                        if (s.tagBreakdown[tag]?.count > 0) highIntentPages.add(tag);
                    }
                }
            }

            const totalVisits = (existingAccountData.totalVisits || 0) + pages.length;

            qualityGate = evaluateSignalQuality(
                { ...existingAccountData, sessions: existingSessions },
                scoreResult,
                sessionMeta
            );

            accountStatus = getStatusTier(accountScore, thresholds, isLearningMode, qualityGate.passed);

            accountUpdate = {
                accountKey,
                merchantId,
                companyDomain,
                companyName: companyName || existingAccountData.companyName || null,
                accountScore,
                status: accountStatus,
                signal_quality_score:   qualityGate.score,
                signal_quality_passed:  qualityGate.passed,
                signal_quality_checks:  qualityGate.checks,
                scoreExplanation,
                highIntentPages: [...highIntentPages],
                totalVisits,
                lastVisit:             FieldValue.serverTimestamp(),
                identityConfidenceTier: getConfidenceTier(identityConfidenceScore),
                identityConfidenceScore,
                identitySource,
                sessions: recentSessions,
                updatedAt: FieldValue.serverTimestamp()
            };

            if (!accountSnap.exists) {
                accountUpdate.firstSeen  = FieldValue.serverTimestamp();
                accountUpdate.createdAt  = FieldValue.serverTimestamp();
            }
        }

        // ── Rule 3 / Rule 4: Write order — visitorIntelSummary FIRST ─────
        // Write 4: visitorIntelSummary (dashboard sees data even if Account360 is delayed)
        if (accountKey && accountUpdate) {
            const summaryRef = db.collection('visitorIntelSummary').doc(merchantId)
                .collection('accounts').doc(accountKey);
            await summaryRef.set(accountUpdate, { merge: true });
        }

        // Write 1: websiteVisitors session
        const sessionRef = db.collection('websiteVisitors').doc(merchantId)
            .collection('sessions').doc(sessionId);

        const sessionDoc = {
            sessionId,
            merchantId,
            visitorId,
            startTime:              startTime || new Date(),
            score:                  scoreResult.score,
            scoreExplanation,
            tagBreakdown:           scoreResult.tagBreakdown,
            negativeSignals:        scoreResult.negatives,
            signals:                scoreResult.signals,
            identitySource,
            identityConfidenceScore,
            pages,
            eventTypes:             [...new Set(eventTypes)],
            createdAt:              FieldValue.serverTimestamp()
        };

        await sessionRef.set(sessionDoc);

        // Writes 2 & 3: Account360 (with retry, skipped if low confidence)
        if (accountKey && !lowConfidence && !heuristicOnly) {
            const account360Ref = db.collection('Account360').doc(accountKey);

            // Rule 9: idempotency — check signalHistory before appending
            const historyRef = account360Ref.collection('signalHistory').doc(eventId);
            const historySnap = await historyRef.get();
            isDuplicateEvent = historySnap.exists;

            // Write 2: Account360 upsert with provenance
            await withRetry(async () => {
                const snap = await account360Ref.get();
                const existing = snap.exists ? snap.data() : {};

                const incomingFields = {
                    companyDomain:          provenance(companyDomain, 70),
                    companyName:            provenance(companyName || existing.companyName?.value || null, 60),
                    lastVisit:              provenance(new Date().toISOString(), 80),
                    accountScore:           provenance(accountScore, 75),
                    status:                 provenance(accountStatus, 75),
                    identitySource:         provenance(identitySource, 65),
                    identityConfidenceScore: provenance(identityConfidenceScore, 80),
                    visitorEmail:           visitorEmail ? provenance(visitorEmail, 90) : null
                };

                // Apply ConflictEngine
                const resolved = {};
                for (const [key, incoming] of Object.entries(incomingFields)) {
                    if (incoming === null) continue;
                    resolved[key] = resolveField(existing[key], incoming);
                }

                await account360Ref.set({
                    accountKey,
                    merchantId,
                    ...resolved,
                    updatedAt: FieldValue.serverTimestamp(),
                    ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
                }, { merge: true });
            }, 3, 'Account360 upsert');

            // Write 3: signalHistory append (idempotency — skip if duplicate eventId)
            if (!isDuplicateEvent) {
                await withRetry(async () => {
                    await historyRef.set({
                        eventId,
                        merchantId,
                        sessionId,
                        visitorId,
                        score:         scoreResult.score,
                        accountScore,
                        status:        accountStatus,
                        signals:       scoreResult.signals,
                        negatives:     scoreResult.negatives,
                        tagBreakdown:  scoreResult.tagBreakdown,
                        pages,
                        eventTypes:    [...new Set(eventTypes)],
                        identitySource,
                        identityConfidenceScore,
                        timestamp:     (startTime || new Date()).toISOString(),
                        createdAt:     FieldValue.serverTimestamp()
                    });
                }, 3, 'Account360 signalHistory');
            }

            // Write 5: pubSubThresholdLog (Rule 6: skip in learning mode)
            // Rule 8: duplicate suppression check
            const thresholdCrossed = accountScore >= thresholds.warming;
            if (thresholdCrossed && !isLearningMode) {
                const suppWindowMs = suppHours * 3600000;
                const logRef = db.collection('pubSubThresholdLog').doc(merchantId);
                const logSnap = await logRef.get();
                const logData = logSnap.exists ? logSnap.data() : {};

                const lastEntry = logData[accountKey];
                const lastEntryTs = lastEntry ? new Date(lastEntry.timestamp).getTime() : 0;
                const suppressed = (now - lastEntryTs) < suppWindowMs;

                const logEntry = {
                    accountKey,
                    merchantId,
                    accountScore,
                    status:     accountStatus,
                    timestamp:  new Date().toISOString(),
                    suppressed
                };

                if (!suppressed) {
                    // Emit: write to pubSubThresholdLog (Pub/Sub emulator not running)
                    await logRef.set({
                        [accountKey]: logEntry,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                } else {
                    // Suppressed: log entry with suppressed: true
                    await logRef.set({
                        [accountKey + '_suppressed_' + Date.now()]: logEntry,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    console.log(`[visitorSignal] Threshold suppressed for ${accountKey} (within ${suppHours}h window)`);
                }
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                sessionId,
                sessionScore:   scoreResult.score,
                accountKey,
                accountScore,
                status:         accountStatus,
                signalQuality:  qualityGate,
                learningMode:   isLearningMode,
                lowConfidence,
                scoreExplanation,
                eventId,
                duplicateEventSkipped: isDuplicateEvent
            }
        });

    } catch (error) {
        return handleError(error, res, 'POST /visitor-signal/ingest');
    }
});

// ── GET /visitor-accounts ────────────────────────────────────────────────────

/**
 * Return account-level scoring summaries for the authenticated merchant.
 * Used by the Visitor Intel frontend.
 */
router.get('/visitor-accounts', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const snap = await db.collection('visitorIntelSummary').doc(userId)
            .collection('accounts')
            .orderBy('accountScore', 'desc')
            .limit(200)
            .get();

        const accounts = snap.docs.map(d => {
            const data = d.data();
            const { sessions, ...rest } = data; // omit bulky sessions array
            return rest;
        });

        return res.status(200).json({ success: true, data: accounts });

    } catch (error) {
        if (error.message?.includes('index')) {
            return res.status(200).json({ success: true, data: [] });
        }
        return handleError(error, res, 'GET /visitor-accounts');
    }
});

module.exports = router;
