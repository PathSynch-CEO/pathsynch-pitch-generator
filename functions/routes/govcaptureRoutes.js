'use strict';

/**
 * SynchGov Routes — Profile CRUD (PR #1)
 *
 * All routes under /api/govcapture/*
 * Feature-gated: GOVCAPTURE_ENABLED must be 'true' (default: off).
 * Auth: req.userId required. Ownership: profile.userId === req.userId.
 * All gov* collections are CF-only (client SDK access denied by firestore.rules).
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { validateProfileInput, stripUndefined, PROFILE_CLIENT_FIELDS } = require('../services/govcapture/schemas');
const { validateStageTransitionInput, validateOutcomeInput } = require('../services/govcapture/govPursuits');
const govPursuitService = require('../services/govcapture/govPursuitService');
const { computeAnalytics } = require('../services/govcapture/govAnalyticsService');

const router = createRouter();

// ── Feature Gate (runs before auth) ──────────────────────────────────────────

function featureGate(req, res, next) {
    if (process.env.GOVCAPTURE_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
}

// ── Pursuits Feature Gate (PR-C2) ─────────────────────────────────────────────
// Pursuit endpoints are invisible (404) unless GOVCAPTURE_PURSUITS_ENABLED is on.

function pursuitsGate(req, res, next) {
    if (process.env.GOVCAPTURE_PURSUITS_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// ── Analytics Feature Gate (PR-C3) ────────────────────────────────────────────
// Analytics needs BOTH the pursuits pipeline (its data source) and its own flag.

function analyticsGate(req, res, next) {
    if (process.env.GOVCAPTURE_PURSUITS_ENABLED !== 'true'
        || process.env.GOVCAPTURE_ANALYTICS_CARDS_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// ── Evaluator Feature Gate (PR-C5) ────────────────────────────────────────────
// Evaluations hang off pursuits — both flags required.

function evaluatorGate(req, res, next) {
    if (process.env.GOVCAPTURE_PURSUITS_ENABLED !== 'true'
        || process.env.GOVCAPTURE_EVALUATOR_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// Map coded evaluator/proposal service errors to HTTP statuses.
function _evaluatorErrorStatus(code) {
    switch (code) {
        case 'PURSUIT_NOT_FOUND':
        case 'PROPOSAL_NOT_FOUND':
        case 'EVALUATION_NOT_FOUND': return 404;
        case 'FORBIDDEN':            return 403;
        case 'INVALID_FILE':
        case 'INVALID_ACK_STATE':
        case 'INVALID_INDEX':
        case 'EMPTY_DRAFT':          return 400;
        case 'PROPOSAL_MISMATCH':
        case 'NO_RFP_TEXT':          return 409;
        default:                     return 500;
    }
}

// Map a coded service error to an HTTP status.
function _pursuitErrorStatus(code) {
    switch (code) {
        case 'OPP_NOT_FOUND':
        case 'PURSUIT_NOT_FOUND':  return 404;
        case 'FORBIDDEN':          return 403;
        case 'INVALID_TRANSITION': return 409;
        default:                   return 500;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getDb() {
    return admin.firestore();
}

function _sanitizeClientInput(data) {
    if (!data || typeof data !== 'object') return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        if (PROFILE_CLIENT_FIELDS.has(key) && value !== undefined) {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

// ── GET /api/govcapture/profiles ─────────────────────────────────────────────

router.get('/govcapture/profiles', featureGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();
        const snap = await db.collection('govProfiles')
            .where('userId', '==', req.userId)
            .where('status', '==', 'active')
            .get();

        const profiles = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, profiles });
    } catch (err) {
        console.error('[GovCapture] GET /profiles error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/profiles/expand-keywords ────────────────────────────
// PR-C1 Rank-layer helper: expand solution(s) into candidate keywords for the
// user to prune before saving. Registered before /profiles/:profileId so the
// literal path wins. Gated behind GOVCAPTURE_RANK_FIELDS_ENABLED.

router.post('/govcapture/profiles/expand-keywords', featureGate, requireAuth, async (req, res) => {
    if (process.env.GOVCAPTURE_RANK_FIELDS_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'Rank fields not enabled' });
    }
    try {
        const { expandSolutionKeywords } = require('../services/govcapture/keywordExpansion');
        const solutions = Array.isArray(req.body?.solutions)
            ? req.body.solutions
            : (req.body?.solution ? [req.body.solution] : []);

        if (solutions.length === 0) {
            return res.status(400).json({ success: false, error: 'solution or solutions[] required' });
        }
        if (solutions.length > 10) {
            return res.status(400).json({ success: false, error: 'Maximum 10 solutions per request' });
        }

        const results = [];
        for (const sol of solutions) {
            const name = sol.name || sol.solutionName || null;
            try {
                const r = await expandSolutionKeywords(sol);
                results.push({ name, keywords: r.keywords, usageMetadata: r.usageMetadata });
            } catch (e) {
                console.warn('[GovCapture] keyword expansion failed:', e.message);
                results.push({ name, keywords: [], error: 'expansion_failed' });
            }
        }
        return res.json({ success: true, results });
    } catch (err) {
        console.error('[GovCapture] expand-keywords error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/profiles ────────────────────────────────────────────

router.post('/govcapture/profiles', featureGate, requireAuth, async (req, res) => {
    try {
        const sanitized = _sanitizeClientInput(req.body);
        const validation = validateProfileInput(sanitized);
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }

        const db = _getDb();
        const profileData = stripUndefined({
            ...sanitized,
            userId:        req.userId,
            status:        'active',
            rescoreNeeded: false,
            createdAt:     admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
        });

        const docRef = await db.collection('govProfiles').add(profileData);

        console.log(`[GovCapture] Profile created: ${docRef.id} for user ${req.userId}`);
        return res.status(201).json({
            success:   true,
            profileId: docRef.id,
            profile:   { id: docRef.id, ...profileData },
        });
    } catch (err) {
        console.error('[GovCapture] POST /profiles error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/profiles/:profileId ──────────────────────────────────

router.get('/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db  = _getDb();
        const doc = await db.collection('govProfiles').doc(req.params.profileId).get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }

        const data = doc.data();
        if (data.userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        return res.json({ success: true, profile: { id: doc.id, ...data } });
    } catch (err) {
        console.error('[GovCapture] GET /profiles/:id error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/profiles/:profileId ──────────────────────────────────

router.put('/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db      = _getDb();
        const docRef  = db.collection('govProfiles').doc(req.params.profileId);
        const doc     = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const sanitized = _sanitizeClientInput(req.body);
        const validation = validateProfileInput(sanitized, { isUpdate: true });
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }

        const updates = stripUndefined({
            ...sanitized,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await docRef.update(updates);

        const updated = await docRef.get();
        return res.json({ success: true, profile: { id: updated.id, ...updated.data() } });
    } catch (err) {
        console.error('[GovCapture] PUT /profiles/:id error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/govcapture/profiles/:profileId (soft-delete) ─────────────────

router.delete('/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db      = _getDb();
        const docRef  = db.collection('govProfiles').doc(req.params.profileId);
        const doc     = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await docRef.update({
            status:     'archived',
            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[GovCapture] Profile archived: ${req.params.profileId}`);
        return res.json({ success: true, message: 'Profile archived' });
    } catch (err) {
        console.error('[GovCapture] DELETE /profiles/:id error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/opportunities ─────────────────────────────────────────

router.get('/govcapture/opportunities', featureGate, requireAuth, async (req, res) => {
    const { profileId, fitLabel, primarySource, pursuitStatus, archived, limit: rawLimit, cursor } = req.query;

    if (!profileId) {
        return res.status(400).json({ success: false, error: 'profileId query param required' });
    }

    try {
        const db = _getDb();

        // Profile validation + ownership
        const profileDoc = await db.collection('govProfiles').doc(profileId).get();
        if (!profileDoc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        if (profileDoc.data().status === 'archived') {
            return res.status(409).json({ success: false, error: 'Profile is archived' });
        }

        const parsedArchived = archived === 'true';
        const pageLimit = Math.min(Math.max(parseInt(rawLimit) || 25, 1), 100);

        let query = db.collection('govOpportunities')
            .where('userId', '==', req.userId)
            .where('profileIds', 'array-contains', profileId)
            .where('archived', '==', parsedArchived)
            .orderBy('createdAt', 'desc')
            .limit(pageLimit + 1); // +1 to determine hasMore

        // Stable cursor: { createdAt, docId }
        if (cursor) {
            try {
                const parsed = typeof cursor === 'string' ? JSON.parse(cursor) : cursor;
                if (parsed.createdAt && parsed.docId) {
                    const cursorDate = new Date(parsed.createdAt);
                    query = query.startAfter(cursorDate, parsed.docId);
                }
            } catch { /* invalid cursor — ignore, start from beginning */ }
        }

        const snap = await query.get();
        let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // In-memory filters
        if (fitLabel) {
            docs = docs.filter(d => d.fit?.label === fitLabel);
        }
        if (primarySource) {
            docs = docs.filter(d => d.primarySource === primarySource);
        }
        if (pursuitStatus) {
            docs = docs.filter(d => d.pursuitStatus === pursuitStatus);
        }

        const hasMore = docs.length > pageLimit;
        const page = docs.slice(0, pageLimit);

        const nextCursor = hasMore && page.length > 0
            ? JSON.stringify({
                createdAt: page[page.length - 1].createdAt,
                docId:     page[page.length - 1].id,
            })
            : null;

        return res.json({ success: true, opportunities: page, hasMore, nextCursor });
    } catch (err) {
        console.error('[GovCapture] GET /opportunities error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/opportunities/:oppId ─────────────────────────────────

router.get('/govcapture/opportunities/:oppId', featureGate, requireAuth, async (req, res) => {
    try {
        const db  = _getDb();
        const doc = await db.collection('govOpportunities').doc(req.params.oppId).get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        return res.json({ success: true, opportunity: { id: doc.id, ...doc.data() } });
    } catch (err) {
        console.error('[GovCapture] GET /opportunities/:oppId error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/opportunities/:oppId/status ──────────────────────────

router.put('/govcapture/opportunities/:oppId/status', featureGate, requireAuth, async (req, res) => {
    try {
        const db     = _getDb();
        const docRef = db.collection('govOpportunities').doc(req.params.oppId);
        const doc    = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // PR-C2: when an active pursuit owns this opportunity's state, the pursuit
        // board is the only writer of pursuitStatus. Reject direct status writes.
        if (doc.data().pursuitActive === true) {
            return res.status(409).json({
                success: false,
                error:   'Opportunity is managed by an active pursuit; update it via the pursuit board.',
                pursuitId: doc.data().activePursuitId || doc.data().pursuitId || null,
            });
        }

        const { pursuitStatus: newStatus } = req.body || {};
        const { PURSUIT_STATUSES } = require('../services/govcapture/schemas');

        if (!newStatus || !PURSUIT_STATUSES.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                error: `pursuitStatus must be one of: ${PURSUIT_STATUSES.join(', ')}`,
            });
        }

        await docRef.update({
            pursuitStatus:    newStatus,
            pursuitUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
        });

        const updated = await docRef.get();
        return res.json({ success: true, opportunity: { id: updated.id, ...updated.data() } });
    } catch (err) {
        console.error('[GovCapture] PUT /opportunities/:oppId/status error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/opportunities/:oppId/archive ────────────────────────

router.post('/govcapture/opportunities/:oppId/archive', featureGate, requireAuth, async (req, res) => {
    try {
        const db     = _getDb();
        const docRef = db.collection('govOpportunities').doc(req.params.oppId);
        const doc    = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Idempotent — already archived is not an error
        await docRef.update({
            archived:       true,
            archivedAt:     admin.firestore.FieldValue.serverTimestamp(),
            archivedReason: 'manual',
            updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true });
    } catch (err) {
        console.error('[GovCapture] POST /opportunities/:oppId/archive error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/checklist/:profileId ─────────────────────────────────

router.get('/govcapture/checklist/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();

        // Profile ownership
        const profileDoc = await db.collection('govProfiles').doc(req.params.profileId).get();
        if (!profileDoc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const checkDoc = await db.collection('govChecklist').doc(req.params.profileId).get();

        if (checkDoc.exists) {
            return res.json({ success: true, checklist: { id: checkDoc.id, ...checkDoc.data() } });
        }

        // Return defaults if no doc
        const { DEFAULT_CHECKLIST_QUESTIONS } = require('../services/govcapture/schemas');
        const defaultQuestions = DEFAULT_CHECKLIST_QUESTIONS.map((q, i) => ({
            id:       `q${i + 1}`,
            text:     q,
            type:     'default',
            active:   true,
        }));

        return res.json({
            success: true,
            checklist: { id: req.params.profileId, questions: defaultQuestions },
        });
    } catch (err) {
        console.error('[GovCapture] GET /checklist error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/checklist/:profileId ─────────────────────────────────

router.put('/govcapture/checklist/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();

        // Profile ownership
        const profileDoc = await db.collection('govProfiles').doc(req.params.profileId).get();
        if (!profileDoc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const { questions } = req.body || {};
        if (!Array.isArray(questions)) {
            return res.status(400).json({ success: false, error: 'questions array required' });
        }

        // Validate each question
        for (const q of questions) {
            if (!q.id || !q.text) {
                return res.status(400).json({ success: false, error: 'Each question must have id and text' });
            }
            if (typeof q.text !== 'string' || q.text.length > 500) {
                return res.status(400).json({ success: false, error: 'Question text max 500 characters' });
            }
            if (q.type && !['default', 'custom'].includes(q.type)) {
                return res.status(400).json({ success: false, error: 'Question type must be default or custom' });
            }
        }

        // Merge: ensure all 5 default questions are preserved
        const { DEFAULT_CHECKLIST_QUESTIONS } = require('../services/govcapture/schemas');
        const submittedMap = new Map(questions.map(q => [q.id, q]));

        const defaults = DEFAULT_CHECKLIST_QUESTIONS.map((q, i) => {
            const id = `q${i + 1}`;
            const submitted = submittedMap.get(id);
            return {
                id,
                text:   q, // always use canonical default text
                type:   'default',
                active: submitted ? (submitted.active !== false) : true,
            };
        });

        // Custom questions from submission (exclude default IDs)
        const defaultIds = new Set(defaults.map(d => d.id));
        const custom = questions
            .filter(q => !defaultIds.has(q.id))
            .map(q => ({
                id:     q.id,
                text:   q.text,
                type:   'custom',
                active: q.active !== false,
            }));

        const merged = [...defaults, ...custom];
        if (merged.length > 20) {
            return res.status(400).json({ success: false, error: 'Maximum 20 questions (5 default + 15 custom)' });
        }

        const checkRef = db.collection('govChecklist').doc(req.params.profileId);
        const checkDoc = await checkRef.get();

        const data = {
            profileId: req.params.profileId,
            userId:    req.userId,
            questions: merged,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (checkDoc.exists) {
            await checkRef.update(data);
        } else {
            data.createdAt = admin.firestore.FieldValue.serverTimestamp();
            await checkRef.set(data);
        }

        return res.json({
            success: true,
            checklist: { id: req.params.profileId, questions: merged },
        });
    } catch (err) {
        console.error('[GovCapture] PUT /checklist error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/manual-upload ────────────────────────────────────────

router.post('/govcapture/manual-upload', featureGate, requireAuth, async (req, res) => {
    if (process.env.GOVCAPTURE_MANUAL_UPLOAD_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'Manual upload is not enabled' });
    }

    try {
        const upload = require('../services/govcapture/manualUploadService');
        const db = _getDb();

        // Determine upload type: file, url, or text
        const isJson    = req.headers['content-type']?.includes('application/json');
        const profileId = isJson ? req.body.profileId : null;
        const url       = isJson ? req.body.url : null;
        const text      = isJson ? req.body.text : null;

        // For multipart, parse with busboy (deferred to file handling below)
        let file = null;
        let mpProfileId = profileId;

        if (!isJson && req.rawBody) {
            // Multipart: parse with multer-style memory handling
            const multer = require('multer');
            const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: upload.MAX_FILE_SIZE } });
            await new Promise((resolve, reject) => {
                m.single('file')(req, res, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            file = req.file;
            mpProfileId = req.body?.profileId || profileId;
        }

        const resolvedProfileId = mpProfileId || profileId;
        if (!resolvedProfileId) {
            return res.status(400).json({ success: false, error: 'profileId required' });
        }

        // ── Security gate: verify profile ownership BEFORE any processing ──
        const profileDoc = await db.collection('govProfiles').doc(resolvedProfileId).get();
        if (!profileDoc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        if (profileDoc.data().status !== 'active') {
            return res.status(409).json({ success: false, error: 'Profile is archived' });
        }

        // ── File upload path ─────────────────────────────────────────────────
        if (file) {
            const validation = upload.validateFile(file);
            if (!validation.valid) {
                return res.status(validation.status).json({ success: false, error: validation.error });
            }

            const safeName = upload.sanitizeFilename(file.originalname);
            if (!safeName) {
                return res.status(400).json({ success: false, error: 'Invalid filename' });
            }

            // Extract text based on MIME
            let extractedText;
            if (file.mimetype === 'application/pdf') {
                extractedText = await upload.extractTextFromPdf(file.buffer);
            } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                extractedText = await upload.extractTextFromDocx(file.buffer);
            } else {
                extractedText = upload.extractTextFromPlain(file.buffer);
            }

            // AI extraction
            const { fields, usageMetadata } = await upload.extractOpportunityFields(extractedText);

            // Upload original to Storage
            const storagePath = await upload.uploadToStorage(file.buffer, req.userId, safeName, file.mimetype);

            // Create opportunity
            const opp = await upload.createOpportunityFromUpload(
                fields,
                { type: 'file_upload', confidence: 'medium', analysisStatus: 'needs_review', documentStatus: 'extracted' },
                resolvedProfileId, req.userId, storagePath, usageMetadata
            );

            return res.status(201).json({ success: true, opportunity: opp });
        }

        // ── URL paste path ───────────────────────────────────────────────────
        if (url) {
            const safeUrl = upload.validatePasteUrl(url);
            if (!safeUrl) {
                return res.status(400).json({ success: false, error: 'URL rejected: HTTPS required, private/metadata hosts blocked' });
            }

            const fetchResult = await upload.fetchUrlContent(safeUrl);

            if (!fetchResult.success) {
                // Operational failure — create opportunity with needs_review
                const { fields, usageMetadata } = fetchResult.text
                    ? await upload.extractOpportunityFields(fetchResult.text)
                    : { fields: { title: 'URL Upload — Fetch Failed' }, usageMetadata: null };

                const storagePath = fetchResult.text
                    ? await upload.uploadTextSnapshot(fetchResult.text, req.userId, 'url-paste')
                    : null;

                const opp = await upload.createOpportunityFromUpload(
                    fields,
                    { type: 'url_paste', url: fetchResult.finalUrl, confidence: 'low',
                      analysisStatus: 'needs_review', documentStatus: 'fetch_failed' },
                    resolvedProfileId, req.userId, storagePath, usageMetadata
                );

                return res.status(201).json({ success: true, opportunity: opp, warning: fetchResult.error });
            }

            // Successful fetch
            const { fields, usageMetadata } = await upload.extractOpportunityFields(fetchResult.text);
            const storagePath = await upload.uploadTextSnapshot(fetchResult.text, req.userId, 'url-paste');

            const opp = await upload.createOpportunityFromUpload(
                fields,
                { type: 'url_paste', url: fetchResult.finalUrl, confidence: 'low',
                  analysisStatus: 'needs_review', documentStatus: 'extracted' },
                resolvedProfileId, req.userId, storagePath, usageMetadata
            );

            return res.status(201).json({ success: true, opportunity: opp });
        }

        // ── Text paste path ──────────────────────────────────────────────────
        if (text) {
            const { fields, usageMetadata } = await upload.extractOpportunityFields(text);
            const storagePath = await upload.uploadTextSnapshot(text, req.userId, 'text-paste');

            const opp = await upload.createOpportunityFromUpload(
                fields,
                { type: 'text_paste', confidence: 'medium', analysisStatus: 'needs_review', documentStatus: 'extracted' },
                resolvedProfileId, req.userId, storagePath, usageMetadata
            );

            return res.status(201).json({ success: true, opportunity: opp });
        }

        return res.status(400).json({ success: false, error: 'Provide file, url, or text' });

    } catch (err) {
        console.error('[GovCapture] POST /manual-upload error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/manual-upload/:oppId/confirm ────────────────────────

router.post('/govcapture/manual-upload/:oppId/confirm', featureGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();
        const { oppId } = req.params;

        const oppDoc = await db.collection('govOpportunities').doc(oppId).get();
        if (!oppDoc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        if (oppDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const upload = require('../services/govcapture/manualUploadService');
        const sanitized = upload.sanitizeConfirmInput(req.body);

        // Force confirmed status
        sanitized.analysisStatus = 'confirmed';
        sanitized.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('govOpportunities').doc(oppId).update(sanitized);

        const updated = await db.collection('govOpportunities').doc(oppId).get();
        return res.json({ success: true, opportunity: { id: updated.id, ...updated.data() } });
    } catch (err) {
        console.error('[GovCapture] POST /manual-upload/:oppId/confirm error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/opportunities/:oppId/generate-brief ─────────────────

router.post('/govcapture/opportunities/:oppId/generate-brief', featureGate, requireAuth, async (req, res) => {
    if (process.env.GOVCAPTURE_AI_BRIEFS_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'AI briefs are not enabled' });
    }

    try {
        const { createBidBriefForOpportunity } = require('../services/govcapture/briefService');
        const { oppId } = req.params;
        const { profileId } = req.body || {};

        const result = await createBidBriefForOpportunity(oppId, profileId, req.userId);

        return res.json({
            success:         true,
            brief:           result.brief,
            aiUsageMetadata: result.aiUsageMetadata,
        });
    } catch (err) {
        const status = err.status || 500;
        console.error(`[GovCapture] POST /generate-brief error (${status}):`, err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/opportunities/:oppId/briefs ──────────────────────────

router.get('/govcapture/opportunities/:oppId/briefs', featureGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();
        const { oppId } = req.params;

        // Verify ownership
        const oppDoc = await db.collection('govOpportunities').doc(oppId).get();
        if (!oppDoc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        if (oppDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const snap = await db.collection('govOpportunities').doc(oppId)
            .collection('briefs')
            .orderBy('generatedAt', 'desc')
            .limit(20)
            .get();

        const briefs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, briefs });
    } catch (err) {
        console.error('[GovCapture] GET /briefs error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/opportunities/:oppId/score ──────────────────────────

router.post('/govcapture/opportunities/:oppId/score', featureGate, requireAuth, async (req, res) => {
    try {
        const db  = _getDb();
        const { oppId } = req.params;
        const { profileId } = req.body;

        // Load opportunity
        const oppDoc = await db.collection('govOpportunities').doc(oppId).get();
        if (!oppDoc.exists) {
            return res.status(404).json({ success: false, error: 'Opportunity not found' });
        }
        const opp = oppDoc.data();
        if (opp.userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Load profile
        const pId = profileId || opp.fit?.scoredAgainstProfileId || (opp.profileIds || [])[0];
        if (!pId) {
            return res.status(400).json({ success: false, error: 'profileId required' });
        }

        const profileDoc = await db.collection('govProfiles').doc(pId).get();
        if (!profileDoc.exists || profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Profile access denied' });
        }

        const profile = { id: profileDoc.id, ...profileDoc.data() };

        // Score + enrich (scoreAndEnrich owns the write)
        const { scoreAndEnrich } = require('../services/govcapture/scoringPipeline');
        const result = await scoreAndEnrich(opp, profile, {
            allowSemantic: true,
            write:         true,
            oppDocId:      oppId,
        });

        return res.json({
            success:      true,
            fit:          result.fit,
            awardContext: result.awardContext,
        });
    } catch (err) {
        console.error('[GovCapture] POST /opportunities/:oppId/score error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/sources/sam_gov/sync ────────────────────────────────

router.post('/govcapture/sources/sam_gov/sync', featureGate, requireAuth, async (req, res) => {
    if (process.env.GOVCAPTURE_SAM_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'SAM.gov sync is not enabled' });
    }

    const { profileId } = req.body;
    if (!profileId) {
        return res.status(400).json({ success: false, error: 'profileId required' });
    }

    try {
        const db  = _getDb();
        const doc = await db.collection('govProfiles').doc(profileId).get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!process.env.SAM_GOV_API_KEY) {
            return res.status(503).json({ success: false, error: 'SAM.gov API key not configured' });
        }

        const { syncProfileFromSam } = require('../services/govcapture/samSyncService');
        const result = await syncProfileFromSam(profileId, req.userId);

        if (result.status === 'already_running') {
            return res.status(409).json({ success: false, error: 'sync_already_running' });
        }

        return res.json({ success: true, sourceRun: result });
    } catch (err) {
        console.error('[GovCapture] POST /sources/sam_gov/sync error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/source-runs ──────────────────────────────────────────

router.get('/govcapture/source-runs', featureGate, requireAuth, async (req, res) => {
    const { profileId } = req.query;
    if (!profileId) {
        return res.status(400).json({ success: false, error: 'profileId query param required' });
    }

    try {
        const db  = _getDb();

        // Verify ownership
        const profileDoc = await db.collection('govProfiles').doc(profileId).get();
        if (!profileDoc.exists || profileDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const snap = await db.collection('govSourceRuns')
            .where('profileId', '==', profileId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const runs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, sourceRuns: runs });
    } catch (err) {
        console.error('[GovCapture] GET /source-runs error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/govcapture/run-daily-sync ────────────────────────────────

router.post('/admin/govcapture/run-daily-sync', featureGate, async (req, res) => {
    const adminKey = process.env.GOVCAPTURE_SCHEDULER_SECRET;
    if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (process.env.GOVCAPTURE_SAM_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'SAM.gov sync is not enabled' });
    }

    try {
        const db = _getDb();
        const { syncProfileFromSam } = require('../services/govcapture/samSyncService');

        // Get all active profiles
        const snap = await db.collection('govProfiles')
            .where('status', '==', 'active')
            .get();

        const results = [];
        // Sequential — not parallel (per guardrails)
        for (const doc of snap.docs) {
            try {
                const result = await syncProfileFromSam(doc.id, doc.data().userId);
                results.push({ profileId: doc.id, ...result });
            } catch (err) {
                results.push({ profileId: doc.id, status: 'failed', error: err.message });
            }
        }

        console.log(`[GovCapture] Admin daily sync: ${results.length} profiles processed`);
        return res.json({ success: true, syncs: results });
    } catch (err) {
        console.error('[GovCapture] POST /admin/govcapture/run-daily-sync error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/digest-settings/:profileId ───────────────────────────

router.get('/govcapture/digest-settings/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db  = _getDb();
        const doc = await db.collection('govProfiles').doc(req.params.profileId).get();

        if (!doc.exists) return res.status(404).json({ success: false, error: 'Profile not found' });
        if (doc.data().userId !== req.userId) return res.status(403).json({ success: false, error: 'Access denied' });

        const d = doc.data();
        return res.json({
            success: true,
            settings: {
                digestFrequency:      d.digestFrequency      || d.digestSettings?.frequency || 'off',
                digestRecipients:     d.digestRecipients      || [],
                digestMinFitScore:    d.digestMinFitScore     ?? 65,
                digestIncludeSources: d.digestIncludeSources  || [],
                sendEmptyDigest:      d.sendEmptyDigest       || false,
            },
        });
    } catch (err) {
        console.error('[GovCapture] GET /digest-settings error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/digest-settings/:profileId ───────────────────────────

const VALID_FREQUENCIES = ['daily', 'weekly', 'off'];
const VALID_SOURCES     = ['sam_gov', 'manual_upload', 'rfpmart'];
const EMAIL_REGEX       = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

router.put('/govcapture/digest-settings/:profileId', featureGate, requireAuth, async (req, res) => {
    try {
        const db     = _getDb();
        const docRef = db.collection('govProfiles').doc(req.params.profileId);
        const doc    = await docRef.get();

        if (!doc.exists) return res.status(404).json({ success: false, error: 'Profile not found' });
        if (doc.data().userId !== req.userId) return res.status(403).json({ success: false, error: 'Access denied' });

        const body = req.body || {};

        // Validate frequency
        if (body.digestFrequency !== undefined && !VALID_FREQUENCIES.includes(body.digestFrequency)) {
            return res.status(400).json({ success: false, error: `digestFrequency must be one of: ${VALID_FREQUENCIES.join(', ')}` });
        }

        // Validate recipients
        if (body.digestRecipients !== undefined) {
            if (!Array.isArray(body.digestRecipients)) {
                return res.status(400).json({ success: false, error: 'digestRecipients must be an array' });
            }
            if (body.digestRecipients.length > 10) {
                return res.status(400).json({ success: false, error: 'Maximum 10 recipients' });
            }
            const seen = new Set();
            for (const email of body.digestRecipients) {
                if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
                    return res.status(400).json({ success: false, error: `Invalid email: ${email}` });
                }
                if (/[\r\n]/.test(email)) {
                    return res.status(400).json({ success: false, error: 'Email must not contain CRLF characters' });
                }
                if (seen.has(email.toLowerCase())) {
                    return res.status(400).json({ success: false, error: `Duplicate recipient: ${email}` });
                }
                seen.add(email.toLowerCase());
            }
        }

        // Validate score
        if (body.digestMinFitScore !== undefined) {
            const s = Number(body.digestMinFitScore);
            if (isNaN(s) || s < 0 || s > 100) {
                return res.status(400).json({ success: false, error: 'digestMinFitScore must be 0-100' });
            }
        }

        // Validate sources
        if (body.digestIncludeSources !== undefined) {
            if (!Array.isArray(body.digestIncludeSources)) {
                return res.status(400).json({ success: false, error: 'digestIncludeSources must be an array' });
            }
            for (const src of body.digestIncludeSources) {
                if (!VALID_SOURCES.includes(src)) {
                    return res.status(400).json({ success: false, error: `Invalid source: ${src}` });
                }
            }
        }

        const updates = {};
        if (body.digestFrequency      !== undefined) updates.digestFrequency      = body.digestFrequency;
        if (body.digestRecipients     !== undefined) updates.digestRecipients     = body.digestRecipients;
        if (body.digestMinFitScore    !== undefined) updates.digestMinFitScore    = Number(body.digestMinFitScore);
        if (body.digestIncludeSources !== undefined) updates.digestIncludeSources = body.digestIncludeSources;
        if (body.sendEmptyDigest      !== undefined) updates.sendEmptyDigest      = !!body.sendEmptyDigest;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await docRef.update(updates);
        return res.json({ success: true, message: 'Digest settings updated' });
    } catch (err) {
        console.error('[GovCapture] PUT /digest-settings error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/digests/send-test ───────────────────────────────────

router.post('/govcapture/digests/send-test', featureGate, requireAuth, async (req, res) => {
    if (process.env.GOVCAPTURE_DIGESTS_ENABLED !== 'true') {
        return res.status(409).json({ success: false, error: 'Digests are not enabled' });
    }

    const { profileId } = req.body || {};
    if (!profileId) return res.status(400).json({ success: false, error: 'profileId required' });

    try {
        const db  = _getDb();
        const doc = await db.collection('govProfiles').doc(profileId).get();

        if (!doc.exists) return res.status(404).json({ success: false, error: 'Profile not found' });
        if (doc.data().userId !== req.userId) return res.status(403).json({ success: false, error: 'Access denied' });

        const profile = { id: doc.id, ...doc.data() };

        // Sends to profile.digestRecipients ONLY — no arbitrary override
        const { sendDigest } = require('../services/govcapture/digestSender');
        const result = await sendDigest(profile);

        return res.json({
            success: true,
            status:  result.status,
            opportunityCount: result.opportunityCount,
            ...(result.errorMessage ? { error: result.errorMessage } : {}),
        });
    } catch (err) {
        console.error('[GovCapture] POST /digests/send-test error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/govcapture/run-digest ────────────────────────────────────

router.post('/admin/govcapture/run-digest', featureGate, async (req, res) => {
    const adminKey = process.env.GOVCAPTURE_SCHEDULER_SECRET;
    if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (process.env.GOVCAPTURE_DIGESTS_ENABLED !== 'true') {
        console.log('[GovCapture] Digest run skipped — GOVCAPTURE_DIGESTS_ENABLED not set');
        return res.json({ success: true, message: 'Digests disabled', processed: 0 });
    }

    try {
        const db = _getDb();
        const { sendDigest } = require('../services/govcapture/digestSender');

        // Get all active profiles with digest enabled
        const snap = await db.collection('govProfiles')
            .where('status', '==', 'active')
            .get();

        const now   = new Date();
        const dayET = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
        const isMonday = dayET === 'Monday';

        let processed = 0, sent = 0, failed = 0, skipped = 0;

        for (const doc of snap.docs) {
            const profile = { id: doc.id, ...doc.data() };
            const freq = profile.digestFrequency || profile.digestSettings?.frequency || 'off';

            if (freq === 'off') continue;
            if (freq === 'weekly' && !isMonday) continue;

            try {
                const result = await sendDigest(profile);
                processed++;
                if (result.status === 'sent')    sent++;
                if (result.status === 'failed')  failed++;
                if (result.status === 'skipped') skipped++;
            } catch (err) {
                processed++;
                failed++;
                console.error(`[GovCapture] Digest failed for ${doc.id}:`, err.message);
            }
        }

        console.log(`[GovCapture] Digest run: ${processed} processed, ${sent} sent, ${failed} failed, ${skipped} skipped`);
        return res.json({ success: true, processed, sent, failed, skipped });
    } catch (err) {
        console.error('[GovCapture] POST /admin/govcapture/run-digest error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// PURSUITS PIPELINE (PR-C2) — all behind pursuitsGate (GOVCAPTURE_PURSUITS_ENABLED)
// ═════════════════════════════════════════════════════════════════════════════

// ── POST /api/govcapture/opportunities/:oppId/promote ─────────────────────────
// Promote an opportunity to a pursuit. Idempotent (returns the existing active one).

router.post('/govcapture/opportunities/:oppId/promote', featureGate, pursuitsGate, requireAuth, async (req, res) => {
    try {
        const workspaceId = (req.body && req.body.workspaceId) || undefined;
        const { pursuit, created } = await govPursuitService.createPursuit(req.userId, req.params.oppId, { workspaceId });
        return res.status(created ? 201 : 200).json({ success: true, created, pursuit });
    } catch (err) {
        const status = _pursuitErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] POST /opportunities/:oppId/promote error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/pursuits ──────────────────────────────────────────────
// Board list. Optional filters: ?stage= | ?outcome= | ?active=true|false.

router.get('/govcapture/pursuits', featureGate, pursuitsGate, requireAuth, async (req, res) => {
    try {
        const db = _getDb();
        let query = db.collection('govPursuits').where('userId', '==', req.userId);

        if (req.query.stage)   query = query.where('stage', '==', req.query.stage);
        if (req.query.outcome) query = query.where('outcome', '==', req.query.outcome);
        if (req.query.active === 'true')  query = query.where('active', '==', true);
        if (req.query.active === 'false') query = query.where('active', '==', false);

        const snap = await query.orderBy('updatedAt', 'desc').limit(200).get();
        const pursuits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, pursuits });
    } catch (err) {
        console.error('[GovCapture] GET /pursuits error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/pursuits/:pursuitId ───────────────────────────────────

router.get('/govcapture/pursuits/:pursuitId', featureGate, pursuitsGate, requireAuth, async (req, res) => {
    try {
        const db  = _getDb();
        const doc = await db.collection('govPursuits').doc(req.params.pursuitId).get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Pursuit not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        return res.json({ success: true, pursuit: { id: doc.id, ...doc.data() } });
    } catch (err) {
        console.error('[GovCapture] GET /pursuits/:pursuitId error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/pursuits/:pursuitId/stage ─────────────────────────────
// Advance a pursuit. Body: { toStage, note?, awardValue?, lossReason?, proposalReadiness?, portalName?, submittedAt? }

router.put('/govcapture/pursuits/:pursuitId/stage', featureGate, pursuitsGate, requireAuth, async (req, res) => {
    try {
        const validation = validateStageTransitionInput(req.body || {});
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }
        const { toStage, ...opts } = req.body;
        const pursuit = await govPursuitService.transitionStage(req.params.pursuitId, req.userId, toStage, opts);
        return res.json({ success: true, pursuit });
    } catch (err) {
        const status = _pursuitErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] PUT /pursuits/:pursuitId/stage error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/pursuits/:pursuitId/outcome ───────────────────────────
// Record a terminal outcome. Body: { outcome ('won'|'lost'|'no_bid'), awardValue?, lossReason? }

router.put('/govcapture/pursuits/:pursuitId/outcome', featureGate, pursuitsGate, requireAuth, async (req, res) => {
    try {
        const validation = validateOutcomeInput(req.body || {});
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }
        const pursuit = await govPursuitService.updateOutcome(req.params.pursuitId, req.userId, req.body);
        return res.json({ success: true, pursuit });
    } catch (err) {
        const status = _pursuitErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] PUT /pursuits/:pursuitId/outcome error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/analytics ─────────────────────────────────────────────
// PR-C3 analytics card set. Computed on-read from govOpportunities + govPursuits
// (+ govProfiles for avgContractValue/goal). Owner-scoped; behind analyticsGate.

router.get('/govcapture/analytics', featureGate, analyticsGate, requireAuth, async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days, 10) : undefined;
        const analytics = await computeAnalytics(req.userId, { days });
        return res.json({ success: true, analytics });
    } catch (err) {
        console.error('[GovCapture] GET /analytics error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// PROPOSAL EVALUATOR (PR-C5) — all behind evaluatorGate (GOVCAPTURE_EVALUATOR_ENABLED)
// ═════════════════════════════════════════════════════════════════════════════

// ── POST /api/govcapture/pursuits/:pursuitId/proposal ─────────────────────────
// Multipart draft-proposal upload (PDF/DOCX/TXT, 25 MB cap — N-7).

router.post('/govcapture/pursuits/:pursuitId/proposal', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const proposalService = require('../services/govcapture/govProposalService');
        const uploadSvc = require('../services/govcapture/manualUploadService');

        // Multipart parse (same memory-storage pattern as manual-upload).
        const multer = require('multer');
        const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadSvc.MAX_FILE_SIZE } });
        await new Promise((resolve, reject) => {
            m.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
        });
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'file is required (multipart field "file")' });
        }

        const proposal = await proposalService.saveProposal(req.userId, req.params.pursuitId, req.file);
        // Don't echo the full extracted text back.
        const { extractedText, ...rest } = proposal;
        return res.status(201).json({ success: true, proposal: rest });
    } catch (err) {
        const status = _evaluatorErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] POST /pursuits/:id/proposal error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/proposals ────────────────────────────────────────────
// Vault listing. Optional ?pursuitId= filter. extractedText stripped.

router.get('/govcapture/proposals', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const proposalService = require('../services/govcapture/govProposalService');
        const proposals = await proposalService.listProposals(req.userId, { pursuitId: req.query.pursuitId });
        return res.json({ success: true, proposals });
    } catch (err) {
        console.error('[GovCapture] GET /proposals error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/govcapture/proposals/:docId ──────────────────────────────────
// Deletion right (v2.2): doc + storage object + keywords. Evaluations survive.

router.delete('/govcapture/proposals/:docId', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const proposalService = require('../services/govcapture/govProposalService');
        await proposalService.deleteProposal(req.userId, req.params.docId);
        return res.json({ success: true });
    } catch (err) {
        const status = _evaluatorErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] DELETE /proposals/:docId error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── POST /api/govcapture/pursuits/:pursuitId/evaluate ─────────────────────────
// Run Pass A + Pass B on an uploaded draft. User-requested only (§8.6 cost rule).
// Body: { proposalDocId }

router.post('/govcapture/pursuits/:pursuitId/evaluate', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const { proposalDocId } = req.body || {};
        if (!proposalDocId) {
            return res.status(400).json({ success: false, error: 'proposalDocId is required' });
        }
        const evalService = require('../services/govcapture/govEvaluationService');
        const evaluation = await evalService.runEvaluation(req.userId, req.params.pursuitId, proposalDocId);
        return res.status(201).json({ success: true, evaluation });
    } catch (err) {
        const status = _evaluatorErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] POST /pursuits/:id/evaluate error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/pursuits/:pursuitId/evaluations ───────────────────────

router.get('/govcapture/pursuits/:pursuitId/evaluations', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const evalService = require('../services/govcapture/govEvaluationService');
        const evaluations = await evalService.listEvaluations(req.userId, req.params.pursuitId);
        return res.json({ success: true, evaluations });
    } catch (err) {
        console.error('[GovCapture] GET /pursuits/:id/evaluations error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/evaluations/:evalId/fix-first/:index/ack ─────────────
// v2.2 fix-first ack state (§10 "evaluator trusted" instrumentation).
// Body: { ackState: 'open' | 'acknowledged' | 'addressed' }

router.put('/govcapture/evaluations/:evalId/fix-first/:index/ack', featureGate, evaluatorGate, requireAuth, async (req, res) => {
    try {
        const { ackState } = req.body || {};
        const evalService = require('../services/govcapture/govEvaluationService');
        const result = await evalService.updateFixFirstAck(req.userId, req.params.evalId, req.params.index, ackState);
        return res.json({ success: true, ...result });
    } catch (err) {
        const status = _evaluatorErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] PUT /evaluations/:id/fix-first ack error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── Masters Feature Gate (PR-C6a) ─────────────────────────────────────────────
// Master-proposal vault endpoints are invisible (404) unless enabled.

function mastersGate(req, res, next) {
    if (process.env.GOVCAPTURE_MASTERS_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// Map coded master-vault service errors to HTTP statuses.
function _masterErrorStatus(code) {
    switch (code) {
        case 'MASTER_NOT_FOUND':          return 404;
        case 'FORBIDDEN':                 return 403;
        case 'INVALID_FILE':
        case 'INVALID_TITLE':
        case 'INVALID_STATUS':
        case 'INVALID_TAILORING_PREFS':
        case 'INVALID_UPDATE':
        case 'MASTER_LIMIT':              return 400;
        default:                          return 500;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// MASTER PROPOSAL VAULT (PR-C6a) — all behind mastersGate (GOVCAPTURE_MASTERS_ENABLED)
// ═════════════════════════════════════════════════════════════════════════════

// ── POST /api/govcapture/master-proposals ────────────────────────────────────
// Multipart master upload (PDF/DOCX/TXT, 25 MB cap — N-7). ?masterId= makes the
// upload a new VERSION of an existing master. Fields: title, profileId.

router.post('/govcapture/master-proposals', featureGate, mastersGate, requireAuth, async (req, res) => {
    try {
        const masterService = require('../services/govcapture/govMasterProposalService');
        const uploadSvc = require('../services/govcapture/manualUploadService');

        // Multipart parse (same memory-storage pattern as manual-upload / proposals).
        const multer = require('multer');
        const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadSvc.MAX_FILE_SIZE } });
        await new Promise((resolve, reject) => {
            m.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
        });
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'file is required (multipart field "file")' });
        }

        const master = await masterService.saveMaster(req.userId, req.file, {
            masterId:  req.query.masterId || undefined,
            title:     (req.body && req.body.title) || undefined,
            profileId: (req.body && req.body.profileId) || undefined,
        });
        // Don't echo the full extracted text back.
        const { extractedText, ...rest } = master;
        return res.status(201).json({ success: true, master: rest });
    } catch (err) {
        const status = _masterErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] POST /master-proposals error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/master-proposals ─────────────────────────────────────
// Vault listing. extractedText stripped.

router.get('/govcapture/master-proposals', featureGate, mastersGate, requireAuth, async (req, res) => {
    try {
        const masterService = require('../services/govcapture/govMasterProposalService');
        const masters = await masterService.listMasters(req.userId);
        return res.json({ success: true, masters });
    } catch (err) {
        console.error('[GovCapture] GET /master-proposals error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/govcapture/master-proposals/:masterId ───────────────────────────

router.get('/govcapture/master-proposals/:masterId', featureGate, mastersGate, requireAuth, async (req, res) => {
    try {
        const masterService = require('../services/govcapture/govMasterProposalService');
        const master = await masterService.getMaster(req.userId, req.params.masterId);
        return res.json({ success: true, master });
    } catch (err) {
        const status = _masterErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] GET /master-proposals/:id error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── PUT /api/govcapture/master-proposals/:masterId ───────────────────────────
// title / status / tailoringPrefs only.

router.put('/govcapture/master-proposals/:masterId', featureGate, mastersGate, requireAuth, async (req, res) => {
    try {
        const masterService = require('../services/govcapture/govMasterProposalService');
        const { title, status, tailoringPrefs } = req.body || {};
        const master = await masterService.updateMaster(req.userId, req.params.masterId, { title, status, tailoringPrefs });
        const { extractedText, ...rest } = master;
        return res.json({ success: true, master: rest });
    } catch (err) {
        const status = _masterErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] PUT /master-proposals/:id error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/govcapture/master-proposals/:masterId ────────────────────────
// Doc + ALL version Storage objects. Tailored drafts in govProposalDocs survive.

router.delete('/govcapture/master-proposals/:masterId', featureGate, mastersGate, requireAuth, async (req, res) => {
    try {
        const masterService = require('../services/govcapture/govMasterProposalService');
        const result = await masterService.deleteMaster(req.userId, req.params.masterId);
        return res.json({ success: true, ...result });
    } catch (err) {
        const status = _masterErrorStatus(err.code);
        if (status === 500) console.error('[GovCapture] DELETE /master-proposals/:id error:', err.message);
        return res.status(status).json({ success: false, error: err.message });
    }
});

module.exports = router;
