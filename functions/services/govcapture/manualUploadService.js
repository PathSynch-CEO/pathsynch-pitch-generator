'use strict';

/**
 * manualUploadService.js — Manual opportunity upload processing.
 *
 * Handles PDF, DOCX, text, and URL paste.
 * Validates files, extracts text, calls AI extraction, creates opportunities.
 */

const admin   = require('firebase-admin');
const crypto  = require('crypto');
const { _validateUrl } = require('../tools/techStackDetector');

const MAX_TEXT_CHARS    = 10000;
const MAX_FILE_SIZE     = 25 * 1024 * 1024; // 25 MB
const MAX_URL_SIZE      = 5 * 1024 * 1024;  // 5 MB
const URL_TIMEOUT_MS    = 8000;

const ALLOWED_MIMES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
]);

const BLOCKED_EXTENSIONS = new Set([
    '.exe', '.bat', '.sh', '.cmd', '.ps1', '.js', '.html', '.htm',
    '.php', '.py', '.rb', '.msi', '.dll', '.com', '.scr',
]);

// ── File Validation ──────────────────────────────────────────────────────────

function validateFile(file) {
    if (!file || !file.buffer) {
        return { valid: false, error: 'No file provided', status: 400 };
    }

    // Size check
    if (file.buffer.length > MAX_FILE_SIZE) {
        return { valid: false, error: `File exceeds 25MB limit (${Math.round(file.buffer.length / 1024 / 1024)}MB)`, status: 413 };
    }

    // Extension check
    const ext = _getExtension(file.originalname);
    if (BLOCKED_EXTENSIONS.has(ext)) {
        return { valid: false, error: `File type ${ext} is not allowed`, status: 415 };
    }

    // MIME check
    if (!ALLOWED_MIMES.has(file.mimetype)) {
        return { valid: false, error: `MIME type ${file.mimetype} is not allowed. Accepted: PDF, DOCX, TXT`, status: 415 };
    }

    // File signature validation
    const sigResult = _validateFileSignature(file.buffer, file.mimetype);
    if (!sigResult.valid) {
        return { valid: false, error: sigResult.error, status: 415 };
    }

    return { valid: true };
}

function sanitizeFilename(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let name = raw
        .replace(/[/\\]/g, '')       // strip path separators
        .replace(/\.\./g, '')         // strip directory traversal
        .replace(/\0/g, '')           // strip null bytes
        .replace(/[\x00-\x1f]/g, '') // strip control chars
        .replace(/^\.+/, '')          // strip leading dots
        .trim();
    return name || null;
}

function _getExtension(filename) {
    if (!filename) return '';
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.substring(dot).toLowerCase() : '';
}

function _validateFileSignature(buffer, mimetype) {
    if (mimetype === 'application/pdf') {
        // PDF must start with %PDF
        const header = buffer.slice(0, 5).toString('ascii');
        if (!header.startsWith('%PDF')) {
            return { valid: false, error: 'File signature does not match PDF format' };
        }
    }

    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // DOCX is a ZIP file — starts with PK (0x50 0x4B)
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
            return { valid: false, error: 'File signature does not match DOCX format' };
        }
    }

    if (mimetype === 'text/plain') {
        // Check for excessive binary/control characters
        const sample = buffer.slice(0, Math.min(1000, buffer.length));
        let binaryCount = 0;
        for (const byte of sample) {
            if (byte < 0x09 || (byte > 0x0D && byte < 0x20 && byte !== 0x1B)) {
                binaryCount++;
            }
        }
        if (binaryCount > sample.length * 0.1) {
            return { valid: false, error: 'File appears to be binary, not text' };
        }
    }

    return { valid: true };
}

// ── Text Extraction ──────────────────────────────────────────────────────────

async function extractTextFromPdf(buffer) {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer, { max: 20 }); // max 20 pages
    return (data.text || '').substring(0, MAX_TEXT_CHARS);
}

async function extractTextFromDocx(buffer) {
    // Guard: cap decompressed size
    if (buffer.length > MAX_FILE_SIZE) {
        throw new Error('DOCX file too large for extraction');
    }
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').substring(0, MAX_TEXT_CHARS);
}

function extractTextFromPlain(buffer) {
    return buffer.toString('utf-8').substring(0, MAX_TEXT_CHARS);
}

// ── URL Paste ────────────────────────────────────────────────────────────────

/**
 * Validate URL for paste (HTTPS only, stricter than techStackDetector).
 * Returns safe URL or null.
 */
function validatePasteUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    // HTTPS only for URL paste
    if (!/^https:\/\//i.test(trimmed)) return null;

    // Reuse SSRF guard from techStackDetector
    return _validateUrl(trimmed);
}

async function fetchUrlContent(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; SynchIntroBot/1.0)',
                'Accept': 'text/html, text/plain, application/pdf',
            },
            redirect: 'follow',
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return { success: false, text: null, finalUrl: url, error: `HTTP ${response.status}` };
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0');
        if (contentLength > MAX_URL_SIZE) {
            return { success: false, text: null, finalUrl: url, error: 'Content exceeds 5MB cap' };
        }

        const text = await response.text();
        const truncated = text.substring(0, MAX_URL_SIZE);

        // Strip HTML tags if HTML response
        const contentType = response.headers.get('content-type') || '';
        const visibleText = contentType.includes('html')
            ? _stripHtml(truncated)
            : truncated;

        return {
            success: true,
            text: visibleText.substring(0, MAX_TEXT_CHARS),
            finalUrl: response.url || url,
            error: null,
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, text: null, finalUrl: url, error: 'URL fetch timed out (8s)' };
        }
        return { success: false, text: null, finalUrl: url, error: `URL fetch error: ${err.message}` };
    }
}

function _stripHtml(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── AI Extraction ────────────────────────────────────────────────────────────

const EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
        title:              { type: 'string', nullable: true },
        buyerName:          { type: 'string', nullable: true },
        dueDate:            { type: 'string', nullable: true },
        description:        { type: 'string', nullable: true },
        location:           { type: 'object', nullable: true, properties: { city: { type: 'string' }, state: { type: 'string' } } },
        naicsCodes:         { type: 'array', nullable: true, items: { type: 'string' } },
        setAside:           { type: 'string', nullable: true },
        estimatedValue:     { type: 'number', nullable: true },
        solicitationNumber: { type: 'string', nullable: true },
    },
    required: ['title'],
};

async function extractOpportunityFields(text) {
    if (!text || text.trim().length < 20) {
        return { fields: _fallbackExtract(text), usageMetadata: null };
    }

    try {
        const { generateStructured } = require('../structuredGeneration');

        const response = await generateStructured({
            systemInstruction: 'Extract government opportunity details from the provided text. Return JSON. If a field cannot be determined, set it to null.',
            userPrompt: text.substring(0, 4000),
            responseSchema: EXTRACTION_SCHEMA,
            model: 'gemini-2.5-flash',
            temperature: 0.2,
            maxOutputTokens: 1024,
            returnMetadata: true,
        });

        return {
            fields: response.result || _fallbackExtract(text),
            usageMetadata: response.usageMetadata || null,
        };
    } catch (err) {
        console.warn('[ManualUpload] AI extraction failed, using fallback:', err.message);
        return { fields: _fallbackExtract(text), usageMetadata: null };
    }
}

function _fallbackExtract(text) {
    if (!text) return { title: null };
    const t = text.substring(0, 5000);

    // Basic regex extraction
    const dateMatch = t.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
    const naicsMatch = t.match(/\b(\d{6})\b/);
    const dollarMatch = t.match(/\$[\d,]+(?:\.\d{2})?/);

    return {
        title: t.substring(0, 200).split('\n')[0]?.trim() || null,
        buyerName: null,
        dueDate: dateMatch ? dateMatch[1] : null,
        description: t.substring(0, 2000),
        naicsCodes: naicsMatch ? [naicsMatch[1]] : null,
        estimatedValue: dollarMatch ? parseFloat(dollarMatch[0].replace(/[$,]/g, '')) : null,
        solicitationNumber: null,
        location: null,
        setAside: null,
    };
}

// ── Opportunity Creation ─────────────────────────────────────────────────────

async function createOpportunityFromUpload(extracted, source, profileId, userId, storagePath, usageMetadata) {
    const db = admin.firestore();

    const canonicalKey = crypto.createHash('sha1')
        .update(`manual_upload:${userId}:${Date.now()}:${Math.random()}`)
        .digest('hex');

    const rawDueDate = extracted.dueDate;
    const parsedDue  = rawDueDate ? new Date(rawDueDate) : null;
    const validDue   = parsedDue && !isNaN(parsedDue.getTime()) ? parsedDue : null;

    const opp = {
        userId,
        profileIds:       [profileId],
        primarySource:    'manual_upload',
        sourceConfidence: source.confidence || 'medium',
        canonicalKey,

        title:              extracted.title || 'Untitled Upload',
        description:        (extracted.description || '').substring(0, 5000) || null,
        buyerName:          extracted.buyerName || null,
        agencyName:         null,
        departmentName:     null,
        solicitationNumber: extracted.solicitationNumber || null,
        noticeType:         null,

        location:       extracted.location || null,
        naicsCodes:     extracted.naicsCodes || [],
        setAside:       extracted.setAside || null,
        estimatedValue: extracted.estimatedValue || null,

        dueDate:        validDue ? validDue.toISOString() : null,
        postedDate:     null,
        rawDates:       { dueDateRaw: rawDueDate || null },
        dateParseStatus: rawDueDate ? (validDue ? 'parsed' : 'needs_review') : 'missing',

        sourceRefs: [{
            source:         source.type,
            rawPayloadRef:  storagePath || null,
            sourceUrl:      source.url || null,
            descriptionUrl: null,
            fetchedAt:      new Date().toISOString(),
        }],

        fit:              null,
        awardContext:     null,
        checklistAnswers: null,

        analysisStatus:   source.analysisStatus || 'needs_review',
        documentStatus:   source.documentStatus || 'extracted',
        pursuitStatus:    'new',
        archived:         false,

        ...(usageMetadata ? { extractionUsageMetadata: usageMetadata } : {}),

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('govOpportunities').add(opp);
    return { id: docRef.id, ...opp };
}

// ── Storage Upload ───────────────────────────────────────────────────────────

async function uploadToStorage(buffer, userId, filename, contentType) {
    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const safeName = sanitizeFilename(filename) || `upload-${timestamp}`;
    const storagePath = `govcapture-uploads/${userId}/${timestamp}-${safeName}`;

    const file = bucket.file(storagePath);
    await file.save(buffer, {
        metadata: { contentType: contentType || 'application/octet-stream' },
    });

    return storagePath;
}

async function uploadTextSnapshot(text, userId, label) {
    const buffer = Buffer.from(text.substring(0, MAX_TEXT_CHARS), 'utf-8');
    return uploadToStorage(buffer, userId, `${label}-${Date.now()}.txt`, 'text/plain');
}

// ── Confirm Endpoint Field Whitelist ─────────────────────────────────────────

const CONFIRM_WHITELIST = new Set([
    'title', 'buyerName', 'agencyName', 'dueDate', 'description', 'location',
    'naicsCodes', 'setAside', 'estimatedValue', 'solicitationNumber',
    'rawDates', 'documentStatus', 'analysisStatus',
]);

function sanitizeConfirmInput(data) {
    if (!data || typeof data !== 'object') return {};
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
        if (CONFIRM_WHITELIST.has(key) && value !== undefined) {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

module.exports = {
    validateFile,
    sanitizeFilename,
    validatePasteUrl,
    fetchUrlContent,
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromPlain,
    extractOpportunityFields,
    createOpportunityFromUpload,
    uploadToStorage,
    uploadTextSnapshot,
    sanitizeConfirmInput,
    CONFIRM_WHITELIST,
    ALLOWED_MIMES,
    BLOCKED_EXTENSIONS,
    MAX_FILE_SIZE,
    _validateFileSignature,
    _stripHtml,
    _fallbackExtract,
};
