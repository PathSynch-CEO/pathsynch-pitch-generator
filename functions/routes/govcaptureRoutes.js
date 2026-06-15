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

router.get('/api/govcapture/profiles', featureGate, requireAuth, async (req, res) => {
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

// ── POST /api/govcapture/profiles ────────────────────────────────────────────

router.post('/api/govcapture/profiles', featureGate, requireAuth, async (req, res) => {
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

router.get('/api/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
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

router.put('/api/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
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

router.delete('/api/govcapture/profiles/:profileId', featureGate, requireAuth, async (req, res) => {
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

// ── POST /api/govcapture/manual-upload ────────────────────────────────────────

router.post('/api/govcapture/manual-upload', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/govcapture/manual-upload/:oppId/confirm', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/govcapture/opportunities/:oppId/generate-brief', featureGate, requireAuth, async (req, res) => {
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

router.get('/api/govcapture/opportunities/:oppId/briefs', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/govcapture/opportunities/:oppId/score', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/govcapture/sources/sam_gov/sync', featureGate, requireAuth, async (req, res) => {
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

router.get('/api/govcapture/source-runs', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/admin/govcapture/run-daily-sync', featureGate, async (req, res) => {
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

router.get('/api/govcapture/digest-settings/:profileId', featureGate, requireAuth, async (req, res) => {
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

router.put('/api/govcapture/digest-settings/:profileId', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/govcapture/digests/send-test', featureGate, requireAuth, async (req, res) => {
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

router.post('/api/admin/govcapture/run-digest', featureGate, async (req, res) => {
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

module.exports = router;
