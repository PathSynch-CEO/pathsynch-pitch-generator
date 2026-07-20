'use strict';

/**
 * govProposalService.js — Proposal library / Tier-1 document vault (PR-C5, §8.5).
 *
 * Draft proposals persist to Cloud Storage under govProposals/{userId}/… and a
 * govProposalDocs doc. Client access is denied by the storage.rules default
 * deny block and the govProposalDocs firestore deny rule — Admin SDK only (N-7).
 *
 * Deletion right (v2.2): user-initiated delete removes the doc, the storage
 * object, and the extracted keywords/text. Evaluation RESULTS on the pursuit
 * survive document deletion (they live in govEvaluations).
 */

const admin = require('firebase-admin');
const {
    validateFile,
    sanitizeFilename,
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromPlain,
} = require('./manualUploadService');

const MAX_KEYWORDS = 30;
const MIN_KEYWORD_LEN = 4;
const MAX_STORED_TEXT_CHARS = 200000; // extracted text cap on the Firestore doc

// Compact stopword list for deterministic keyword extraction (no AI on upload).
const STOPWORDS = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'their',
    'which', 'shall', 'must', 'each', 'other', 'than', 'them', 'they', 'these',
    'those', 'such', 'into', 'upon', 'under', 'over', 'through', 'during',
    'including', 'include', 'included', 'would', 'could', 'should', 'about',
    'after', 'before', 'between', 'against', 'within', 'without', 'above',
    'below', 'because', 'where', 'when', 'what', 'while', 'there', 'here',
    'more', 'most', 'some', 'only', 'also', 'being', 'been', 'does', 'doing',
    'section', 'page', 'pages', 'date', 'name', 'address',
]);

function _db() {
    return admin.firestore();
}

function _err(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

// ── Deterministic keyword extraction ─────────────────────────────────────────

/**
 * Top-N frequent terms, lowercased, stopword-filtered. Pure — exported for tests.
 */
function extractKeywords(text, maxKeywords = MAX_KEYWORDS) {
    if (!text || typeof text !== 'string') return [];
    const counts = new Map();
    const tokens = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [];
    for (const t of tokens) {
        if (t.length < MIN_KEYWORD_LEN || STOPWORDS.has(t)) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxKeywords)
        .map(([term]) => term);
}

// ── Text extraction by MIME (reuses manualUploadService parsers) ─────────────

async function _extractText(file) {
    // Full-text extraction: the default 10k extractor cap is for opportunity-field
    // extraction; proposals need the whole document (real drafts run ~50k+ chars).
    if (file.mimetype === 'application/pdf') {
        return extractTextFromPdf(file.buffer, MAX_STORED_TEXT_CHARS, 100);
    }
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return extractTextFromDocx(file.buffer, MAX_STORED_TEXT_CHARS);
    }
    return extractTextFromPlain(file.buffer, MAX_STORED_TEXT_CHARS);
}

// ── saveProposal ─────────────────────────────────────────────────────────────

/**
 * Validate, persist, and index a draft proposal for a pursuit.
 * Ownership of the pursuit is checked BEFORE any processing.
 *
 * @param {string} userId
 * @param {string} pursuitId
 * @param {object} file — multer memory-storage file { originalname, mimetype, buffer }
 * @returns {Promise<object>} the created govProposalDocs doc
 */
async function saveProposal(userId, pursuitId, file) {
    const db = _db();

    // Ownership gate first (P0 share-leak class, PR #23).
    const pursuitSnap = await db.collection('govPursuits').doc(pursuitId).get();
    if (!pursuitSnap.exists) throw _err('PURSUIT_NOT_FOUND', 'Pursuit not found');
    if (pursuitSnap.data().userId !== userId) throw _err('FORBIDDEN', 'Access denied');

    const validation = validateFile(file);
    if (!validation.valid) throw _err('INVALID_FILE', validation.error);

    const extractedText = ((await _extractText(file)) || '').substring(0, MAX_STORED_TEXT_CHARS);
    const keywords = extractKeywords(extractedText);

    // Persist original to Storage (Admin SDK; client access default-denied).
    const bucket = admin.storage().bucket();
    const safeName = sanitizeFilename(file.originalname) || `proposal-${Date.now()}`;
    const storagePath = `govProposals/${userId}/${Date.now()}-${safeName}`;
    await bucket.file(storagePath).save(file.buffer, {
        metadata: { contentType: file.mimetype || 'application/octet-stream' },
    });

    const doc = {
        userId,
        pursuitId,
        storagePath,
        filename: safeName,
        mimeType: file.mimetype || null,
        sizeBytes: file.buffer.length,
        extractedText,
        extractedTextLength: extractedText.length,
        extractedKeywords: keywords,
        evaluationIds: [],
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('govProposalDocs').add(doc);
    return { id: ref.id, ...doc };
}

// ── listProposals ─────────────────────────────────────────────────────────────

async function listProposals(userId, options = {}) {
    const db = _db();
    let query = db.collection('govProposalDocs').where('userId', '==', userId);
    if (options.pursuitId) query = query.where('pursuitId', '==', options.pursuitId);
    const snap = await query.orderBy('uploadedAt', 'desc').limit(100).get();
    // Strip the (potentially large) extractedText from listings.
    return snap.docs.map(d => {
        const { extractedText, ...rest } = d.data();
        return { id: d.id, ...rest };
    });
}

// ── deleteProposal (deletion right, v2.2) ─────────────────────────────────────

/**
 * Remove doc + storage object + extracted keywords/text. Logs to the activity
 * feed. govEvaluations referencing this doc survive (proposalDocId goes stale
 * by design); proposalReadiness on the pursuit persists.
 */
async function deleteProposal(userId, docId) {
    const db = _db();
    const ref = db.collection('govProposalDocs').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) throw _err('PROPOSAL_NOT_FOUND', 'Proposal not found');
    const doc = snap.data();
    if (doc.userId !== userId) throw _err('FORBIDDEN', 'Access denied');

    // Storage object first (best effort — a missing object must not block the delete).
    if (doc.storagePath) {
        try {
            await admin.storage().bucket().file(doc.storagePath).delete();
        } catch (err) {
            console.warn(`[GovProposal] storage delete failed for ${doc.storagePath}:`, err.message);
        }
    }
    await ref.delete();

    // Activity entry (fire-and-forget).
    try {
        await db.collection('users').doc(userId).collection('activityFeed').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'gov_proposal_deleted',
            proposalDocId: docId,
            pursuitId: doc.pursuitId || null,
            filename: doc.filename || null,
            isRead: false,
            metadata: {},
        });
    } catch (err) {
        console.warn('[GovProposal] activity log failed:', err.message);
    }

    return { deleted: true };
}

/**
 * Owner-checked single read (used by the evaluation orchestrator).
 */
async function getProposal(userId, docId) {
    const snap = await _db().collection('govProposalDocs').doc(docId).get();
    if (!snap.exists) throw _err('PROPOSAL_NOT_FOUND', 'Proposal not found');
    const doc = snap.data();
    if (doc.userId !== userId) throw _err('FORBIDDEN', 'Access denied');
    return { id: snap.id, ...doc };
}

module.exports = {
    saveProposal,
    listProposals,
    deleteProposal,
    getProposal,
    extractKeywords,
    MAX_STORED_TEXT_CHARS,
};
