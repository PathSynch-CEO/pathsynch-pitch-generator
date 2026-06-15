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

module.exports = router;
