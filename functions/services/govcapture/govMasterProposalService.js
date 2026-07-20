'use strict';

/**
 * govMasterProposalService.js — Master proposal vault (PR-C6a).
 *
 * Per-customer reusable master proposals — the tailoring base for PR-C6b's
 * generation engine (PRD-govcapture-c6-master-proposal-v1.md, WS-A). Mirrors
 * the govProposalDocs vault pattern: validate → full-text extract → deterministic
 * processing (keywords, section split, gap scan — no AI on upload) → Storage +
 * CF-only Firestore doc. Client access denied by rules; Admin SDK only.
 *
 * Versioning: re-upload bumps `version` and appends to `versions[]`; every
 * version's Storage object is retained (kept all — Charles decision §10.3)
 * so "what did the master say when that draft was generated?" stays answerable.
 *
 * knownGaps are per-solicitation gaps in a deliberately generic master — they
 * are surfaced to the user and fed to the tailoring gap checklist, never
 * "fixed" silently. The chat-artifact probe only FLAGS suspicious paragraphs
 * (Countifi-corpus lesson): review is human, auto-deletion is forbidden.
 */

const admin = require('firebase-admin');
const {
    validateFile,
    sanitizeFilename,
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromPlain,
} = require('./manualUploadService');
const { extractKeywords, MAX_STORED_TEXT_CHARS } = require('./govProposalService');
const { validateTailoringPrefs } = require('./schemas');

const MAX_MASTERS_PER_USER = 25;
const MAX_TITLE_LEN = 200;
const MASTER_STATUSES = ['active', 'archived'];

function _db() {
    return admin.firestore();
}

function _err(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

// ── Deterministic section split (§7.1 — no AI on upload) ─────────────────────

/**
 * Numbered top-level headings ("1. Executive Summary") → [{n, title, offset}].
 * First occurrence per section number wins (ToC/duplicate de-dup). Pure —
 * exported for tests; the Countifi corpus manifest is the reference fixture.
 */
function splitSections(text) {
    if (!text || typeof text !== 'string') return [];
    const sections = [];
    const seen = new Set();
    const re = /^(\d{1,2})\.\s+(.{2,120})$/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (seen.has(n)) continue;
        seen.add(n);
        sections.push({ n, title: m[2].trim(), offset: m.index });
    }
    return sections;
}

// ── Deterministic gap scan (§7.2 — corpus-manifest probe technique) ──────────

const CERTIFICATION_TERMS = [
    'fedramp', 'nist 800-53', 'nist 800-171', 'cjis', 'soc 2', 'stateramp',
    'cmmc', 'iso 27001',
];
const PAST_PERFORMANCE_TERMS = [
    'past performance', 'client references', 'contract references',
];
const BLANK_FIELD_LABELS = ['submitted to:', 'rfp #:', 'submission date:'];
const CHAT_ARTIFACT_PATTERNS = [
    /from here onward/i,
    /this (section|matrix|proposal) should be (reused|updated|customized|tailored)/i,
    /^(perfect|great|sure|certainly)[.!,] /im,
];

/**
 * Scan extracted text for per-solicitation gaps. Gap IDs match the Countifi
 * corpus manifest (`expectedFindings`) so corpus-driven tests assert them
 * directly. Pure — exported for tests.
 */
function scanKnownGaps(text) {
    const lower = (text || '').toLowerCase();
    const gaps = [];

    if (!CERTIFICATION_TERMS.some(t => lower.includes(t))) {
        gaps.push({
            id: 'no-security-certifications',
            summary: 'No certification or compliance framework named (FedRAMP, NIST 800-53, CJIS, SOC 2…). Add the ones held per solicitation.',
        });
    }
    if (!PAST_PERFORMANCE_TERMS.some(t => lower.includes(t))) {
        gaps.push({
            id: 'no-named-past-performance',
            summary: 'No named past-performance projects or references — usually the heaviest-weighted evaluation factor. Add named projects per solicitation.',
        });
    }
    if (lower.includes('compliance matrix') && (lower.match(/compliant/g) || []).length >= 3) {
        gaps.push({
            id: 'self-declared-compliance-matrix',
            summary: 'Compliance matrix self-declares "Compliant" against generic headings — must be regenerated against the actual RFP requirements.',
        });
    }
    const blanks = BLANK_FIELD_LABELS.filter(l => lower.includes(l));
    if (blanks.length) {
        gaps.push({
            id: 'blank-solicitation-fields',
            summary: `Solicitation fields present as blank labels (${blanks.join(', ')}) — fill per solicitation.`,
        });
    }
    const artifactHits = CHAT_ARTIFACT_PATTERNS.filter(p => p.test(text || ''));
    if (artifactHits.length) {
        gaps.push({
            id: 'possible-chat-artifacts',
            summary: 'Paragraphs with template/AI-chat meta-language detected — review and remove manually before tailoring. Flag only; never auto-removed.',
        });
    }
    return gaps;
}

// ── Text extraction by MIME (same parsers/caps as the proposal vault) ────────

async function _extractText(file) {
    if (file.mimetype === 'application/pdf') {
        return extractTextFromPdf(file.buffer, MAX_STORED_TEXT_CHARS, 100);
    }
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return extractTextFromDocx(file.buffer, MAX_STORED_TEXT_CHARS);
    }
    return extractTextFromPlain(file.buffer, MAX_STORED_TEXT_CHARS);
}

// ── saveMaster (create or new version) ───────────────────────────────────────

/**
 * Validate, process, and persist a master proposal. With `opts.masterId` the
 * upload becomes a new VERSION of an existing master (owner-checked); without
 * it a new master is created (capped at MAX_MASTERS_PER_USER).
 *
 * @param {string} userId
 * @param {object} file — multer memory-storage file
 * @param {object} [opts] — { masterId, title, profileId }
 * @returns {Promise<object>} the created/updated govMasterProposals doc
 */
async function saveMaster(userId, file, opts = {}) {
    const db = _db();

    const validation = validateFile(file);
    if (!validation.valid) throw _err('INVALID_FILE', validation.error);

    if (opts.title !== undefined && (typeof opts.title !== 'string' || opts.title.trim().length === 0 || opts.title.length > MAX_TITLE_LEN)) {
        throw _err('INVALID_TITLE', `title must be a non-empty string of at most ${MAX_TITLE_LEN} characters`);
    }

    // Version target: ownership gate BEFORE any processing (P0 share-leak class).
    let existingRef = null;
    let existing = null;
    if (opts.masterId) {
        existingRef = db.collection('govMasterProposals').doc(opts.masterId);
        const snap = await existingRef.get();
        if (!snap.exists) throw _err('MASTER_NOT_FOUND', 'Master proposal not found');
        existing = snap.data();
        if (existing.userId !== userId) throw _err('FORBIDDEN', 'Access denied');
    } else {
        const countSnap = await db.collection('govMasterProposals')
            .where('userId', '==', userId).get();
        if (countSnap.docs.length >= MAX_MASTERS_PER_USER) {
            throw _err('MASTER_LIMIT', `At most ${MAX_MASTERS_PER_USER} master proposals per account`);
        }
    }

    const extractedText = ((await _extractText(file)) || '').substring(0, MAX_STORED_TEXT_CHARS);
    const keywords = extractKeywords(extractedText);
    const sections = splitSections(extractedText);
    const knownGaps = scanKnownGaps(extractedText);

    const bucket = admin.storage().bucket();
    const safeName = sanitizeFilename(file.originalname) || `master-${Date.now()}`;
    const storagePath = `govMasterProposals/${userId}/${Date.now()}-${safeName}`;
    await bucket.file(storagePath).save(file.buffer, {
        metadata: { contentType: file.mimetype || 'application/octet-stream' },
    });

    const version = existing ? (existing.version || 1) + 1 : 1;
    const versionEntry = {
        version,
        storagePath,
        sizeBytes: file.buffer.length,
        uploadedAt: new Date().toISOString(),
    };

    const fields = {
        storagePath,
        filename: safeName,
        mimeType: file.mimetype || null,
        sizeBytes: file.buffer.length,
        extractedText,
        extractedTextLength: extractedText.length,
        extractedKeywords: keywords,
        sections,
        knownGaps,
        version,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (existing) {
        const update = {
            ...fields,
            versions: [...(existing.versions || []), versionEntry],
        };
        if (opts.title !== undefined) update.title = opts.title.trim();
        await existingRef.update(update);
        return { id: opts.masterId, ...existing, ...update };
    }

    const doc = {
        userId,
        profileId: opts.profileId || null,
        title: (opts.title || safeName).trim(),
        status: 'active',
        tailoringPrefs: null,
        versions: [versionEntry],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...fields,
    };
    const ref = await db.collection('govMasterProposals').add(doc);
    return { id: ref.id, ...doc };
}

// ── listMasters ──────────────────────────────────────────────────────────────

async function listMasters(userId) {
    const snap = await _db().collection('govMasterProposals')
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get();
    // Strip the (potentially large) extractedText from listings.
    return snap.docs.map(d => {
        const { extractedText, ...rest } = d.data();
        return { id: d.id, ...rest };
    });
}

// ── getMaster ────────────────────────────────────────────────────────────────

async function getMaster(userId, masterId) {
    const snap = await _db().collection('govMasterProposals').doc(masterId).get();
    if (!snap.exists) throw _err('MASTER_NOT_FOUND', 'Master proposal not found');
    const doc = snap.data();
    if (doc.userId !== userId) throw _err('FORBIDDEN', 'Access denied');
    return { id: snap.id, ...doc };
}

// ── updateMaster (title / status / tailoringPrefs only) ──────────────────────

async function updateMaster(userId, masterId, patch = {}) {
    const db = _db();
    const ref = db.collection('govMasterProposals').doc(masterId);
    const snap = await ref.get();
    if (!snap.exists) throw _err('MASTER_NOT_FOUND', 'Master proposal not found');
    const doc = snap.data();
    if (doc.userId !== userId) throw _err('FORBIDDEN', 'Access denied');

    const update = {};
    if (patch.title !== undefined) {
        if (typeof patch.title !== 'string' || patch.title.trim().length === 0 || patch.title.length > MAX_TITLE_LEN) {
            throw _err('INVALID_TITLE', `title must be a non-empty string of at most ${MAX_TITLE_LEN} characters`);
        }
        update.title = patch.title.trim();
    }
    if (patch.status !== undefined) {
        if (!MASTER_STATUSES.includes(patch.status)) {
            throw _err('INVALID_STATUS', `status must be one of: ${MASTER_STATUSES.join(', ')}`);
        }
        update.status = patch.status;
    }
    if (patch.tailoringPrefs !== undefined) {
        const result = validateTailoringPrefs(patch.tailoringPrefs);
        if (!result.valid) throw _err('INVALID_TAILORING_PREFS', result.error);
        update.tailoringPrefs = result.value;
    }
    if (Object.keys(update).length === 0) {
        throw _err('INVALID_UPDATE', 'Nothing to update — allowed fields: title, status, tailoringPrefs');
    }
    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(update);
    return { id: masterId, ...doc, ...update };
}

// ── deleteMaster (doc + ALL version objects) ─────────────────────────────────

/**
 * Removes the doc and every version's Storage object (best effort — a missing
 * object must not block the delete). Tailored drafts already generated from
 * this master live in govProposalDocs and SURVIVE (same survivability rule as
 * evaluations). Logs to the activity feed.
 */
async function deleteMaster(userId, masterId) {
    const db = _db();
    const ref = db.collection('govMasterProposals').doc(masterId);
    const snap = await ref.get();
    if (!snap.exists) throw _err('MASTER_NOT_FOUND', 'Master proposal not found');
    const doc = snap.data();
    if (doc.userId !== userId) throw _err('FORBIDDEN', 'Access denied');

    const bucket = admin.storage().bucket();
    const paths = new Set(
        [...(doc.versions || []).map(v => v.storagePath), doc.storagePath].filter(Boolean)
    );
    for (const path of paths) {
        try {
            await bucket.file(path).delete();
        } catch (err) {
            console.warn(`[GovMaster] storage delete failed for ${path}:`, err.message);
        }
    }
    await ref.delete();

    // Activity entry (fire-and-forget).
    try {
        await db.collection('users').doc(userId).collection('activityFeed').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'gov_master_proposal_deleted',
            masterProposalId: masterId,
            title: doc.title || null,
            filename: doc.filename || null,
            isRead: false,
            metadata: {},
        });
    } catch (err) {
        console.warn('[GovMaster] activity log failed:', err.message);
    }

    return { deleted: true };
}

module.exports = {
    saveMaster,
    listMasters,
    getMaster,
    updateMaster,
    deleteMaster,
    splitSections,
    scanKnownGaps,
    CHAT_ARTIFACT_PATTERNS,
    MAX_MASTERS_PER_USER,
    MASTER_STATUSES,
};
