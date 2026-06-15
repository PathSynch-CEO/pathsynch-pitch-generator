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

module.exports = router;
