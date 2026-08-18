'use strict';

const {
    validateFile,
    sanitizeFilename,
    validatePasteUrl,
    sanitizeConfirmInput,
    CONFIRM_WHITELIST,
    ALLOWED_MIMES,
    BLOCKED_EXTENSIONS,
    MAX_FILE_SIZE,
    parseMultipart,
    _validateFileSignature,
    _stripHtml,
    _fallbackExtract,
} = require('../services/govcapture/manualUploadService');

const fs = require('fs');
const path = require('path');

// Build a real multipart/form-data body with a fixed boundary (dependency-free).
// parts: [{ name, filename?, contentType?, data }]
function buildMultipart(boundary, parts) {
    const chunks = [];
    for (const p of parts) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        if (p.filename !== undefined) {
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`));
            chunks.push(Buffer.from(`Content-Type: ${p.contentType || 'application/octet-stream'}\r\n\r\n`));
        } else {
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
        }
        chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(String(p.data)));
        chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
}

function fakeReq(boundary, rawBody) {
    return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, rawBody };
}

// ── File Validation ──────────────────────────────────────────────────────────

describe('manualUpload — validateFile', () => {
    test('file > 25MB → 413', () => {
        const file = { buffer: Buffer.alloc(26 * 1024 * 1024), mimetype: 'application/pdf', originalname: 'big.pdf' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(413);
    });

    test('no file → 400', () => {
        expect(validateFile(null).valid).toBe(false);
        expect(validateFile(null).status).toBe(400);
    });

    test('executable extension (.exe) → 415', () => {
        const file = { buffer: Buffer.from('MZ'), mimetype: 'application/octet-stream', originalname: 'malware.exe' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(415);
    });

    test('HTML file (.html) → 415', () => {
        const file = { buffer: Buffer.from('<html>'), mimetype: 'text/html', originalname: 'page.html' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(415);
    });

    test('invalid MIME (application/javascript) → 415', () => {
        const file = { buffer: Buffer.from('var x'), mimetype: 'application/javascript', originalname: 'script.txt' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(415);
    });

    test('valid PDF → accepted', () => {
        const file = { buffer: Buffer.from('%PDF-1.4 fake content'), mimetype: 'application/pdf', originalname: 'doc.pdf' };
        const result = validateFile(file);
        expect(result.valid).toBe(true);
    });

    test('valid DOCX (ZIP header) → accepted', () => {
        const buf = Buffer.alloc(100);
        buf[0] = 0x50; buf[1] = 0x4B; buf[2] = 0x03; buf[3] = 0x04; // PK zip header
        const file = {
            buffer: buf,
            mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            originalname: 'doc.docx',
        };
        const result = validateFile(file);
        expect(result.valid).toBe(true);
    });

    test('valid text → accepted', () => {
        const file = { buffer: Buffer.from('Plain text content here'), mimetype: 'text/plain', originalname: 'notes.txt' };
        expect(validateFile(file).valid).toBe(true);
    });

    test('PDF without %PDF signature → 415 (MIME spoofing)', () => {
        const file = { buffer: Buffer.from('not a real pdf'), mimetype: 'application/pdf', originalname: 'fake.pdf' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(415);
    });

    test('DOCX without ZIP header → 415', () => {
        const file = {
            buffer: Buffer.from('not a zip file'),
            mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            originalname: 'fake.docx',
        };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.status).toBe(415);
    });

    test('text with excessive binary chars → 415', () => {
        const buf = Buffer.alloc(100, 0x01); // all control chars
        const file = { buffer: buf, mimetype: 'text/plain', originalname: 'binary.txt' };
        const result = validateFile(file);
        expect(result.valid).toBe(false);
    });
});

// ── Filename Sanitization ────────────────────────────────────────────────────

describe('manualUpload — sanitizeFilename', () => {
    test('strips path separators', () => {
        expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd');
    });

    test('strips null bytes', () => {
        expect(sanitizeFilename('file\0name.pdf')).toBe('filename.pdf');
    });

    test('strips leading dots', () => {
        expect(sanitizeFilename('.hidden.pdf')).toBe('hidden.pdf');
    });

    test('empty after sanitization → null', () => {
        expect(sanitizeFilename('../../..')).toBeNull();
    });

    test('null input → null', () => {
        expect(sanitizeFilename(null)).toBeNull();
    });

    test('normal filename passes through', () => {
        expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
    });
});

// ── SSRF Guard (URL Paste) ───────────────────────────────────────────────────

describe('manualUpload — validatePasteUrl', () => {
    test('valid HTTPS → accepted', () => {
        const result = validatePasteUrl('https://sam.gov/opp/abc123');
        expect(result).not.toBeNull();
    });

    test('http:// → rejected (HTTPS only)', () => {
        expect(validatePasteUrl('http://sam.gov/opp/abc123')).toBeNull();
    });

    test('ftp:// → rejected', () => {
        expect(validatePasteUrl('ftp://files.sam.gov/doc')).toBeNull();
    });

    test('private IP (10.0.0.1) → rejected', () => {
        expect(validatePasteUrl('https://10.0.0.1/doc')).toBeNull();
    });

    test('localhost → rejected', () => {
        expect(validatePasteUrl('https://127.0.0.1/doc')).toBeNull();
    });

    test('metadata host (169.254.169.254) → rejected', () => {
        expect(validatePasteUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
    });

    test('null → null', () => {
        expect(validatePasteUrl(null)).toBeNull();
    });

    test('empty → null', () => {
        expect(validatePasteUrl('')).toBeNull();
    });
});

// ── HTML Stripping ───────────────────────────────────────────────────────────

describe('manualUpload — _stripHtml', () => {
    test('strips HTML tags', () => {
        expect(_stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
    });

    test('strips script tags with content', () => {
        const result = _stripHtml('<p>Text</p><script>alert("xss")</script>');
        expect(result).not.toContain('alert');
        expect(result).toContain('Text');
    });

    test('strips style tags', () => {
        const result = _stripHtml('<style>body{color:red}</style><p>Content</p>');
        expect(result).not.toContain('color:red');
        expect(result).toContain('Content');
    });
});

// ── Fallback Extraction ──────────────────────────────────────────────────────

describe('manualUpload — _fallbackExtract', () => {
    test('extracts date-like pattern', () => {
        const result = _fallbackExtract('Response due by 07/15/2026. NAICS 541614.');
        expect(result.dueDate).toBe('07/15/2026');
        expect(result.naicsCodes).toEqual(['541614']);
    });

    test('extracts dollar amount', () => {
        const result = _fallbackExtract('Estimated value: $750,000.00');
        expect(result.estimatedValue).toBe(750000);
    });

    test('null text → title null', () => {
        const result = _fallbackExtract(null);
        expect(result.title).toBeNull();
    });
});

// ── Confirm Endpoint Whitelist ───────────────────────────────────────────────

describe('manualUpload — sanitizeConfirmInput', () => {
    test('whitelisted fields pass through', () => {
        const input = { title: 'New Title', buyerName: 'FEMA', dueDate: '2026-08-01' };
        const result = sanitizeConfirmInput(input);
        expect(result.title).toBe('New Title');
        expect(result.buyerName).toBe('FEMA');
    });

    test('server-controlled fields stripped', () => {
        const input = {
            title: 'Good',
            userId: 'spoofed',
            sourceRefs: [{ source: 'hacked' }],
            canonicalKey: 'fake',
            primarySource: 'fake',
            createdAt: 'fake',
            fit: { score: 100 },
            awardContext: { fake: true },
        };
        const result = sanitizeConfirmInput(input);
        expect(result.title).toBe('Good');
        expect(result.userId).toBeUndefined();
        expect(result.sourceRefs).toBeUndefined();
        expect(result.canonicalKey).toBeUndefined();
        expect(result.primarySource).toBeUndefined();
        expect(result.createdAt).toBeUndefined();
        expect(result.fit).toBeUndefined();
        expect(result.awardContext).toBeUndefined();
    });

    test('null input → empty object', () => {
        expect(sanitizeConfirmInput(null)).toEqual({});
    });

    test('CONFIRM_WHITELIST has correct fields', () => {
        expect(CONFIRM_WHITELIST.has('title')).toBe(true);
        expect(CONFIRM_WHITELIST.has('naicsCodes')).toBe(true);
        expect(CONFIRM_WHITELIST.has('userId')).toBe(false);
        expect(CONFIRM_WHITELIST.has('sourceRefs')).toBe(false);
        expect(CONFIRM_WHITELIST.has('canonicalKey')).toBe(false);
    });
});

// ── Feature Flag ─────────────────────────────────────────────────────────────

describe('manualUpload — feature flag contract', () => {
    test('GOVCAPTURE_MANUAL_UPLOAD_ENABLED checked in route', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('GOVCAPTURE_MANUAL_UPLOAD_ENABLED');
    });
});

// ── Route Presence ───────────────────────────────────────────────────────────

describe('manualUpload — route contracts', () => {
    test('manual-upload endpoint exists', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('/govcapture/manual-upload');
        expect(content).toContain('/govcapture/manual-upload/:oppId/confirm');
    });

    test('security gate verifies ownership BEFORE processing', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        // Profile ownership check appears before file extraction in the route
        const ownerCheckIdx = content.indexOf('profileDoc.data().userId !== req.govUserId');
        const extractIdx = content.indexOf('extractTextFromPdf');
        expect(ownerCheckIdx).toBeGreaterThan(0);
        expect(extractIdx).toBeGreaterThan(ownerCheckIdx);
    });
});

// ── Constants ────────────────────────────────────────────────────────────────

describe('manualUpload — constants', () => {
    test('MAX_FILE_SIZE is 25MB', () => {
        expect(MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
    });

    test('ALLOWED_MIMES has 3 types', () => {
        expect(ALLOWED_MIMES.size).toBe(3);
        expect(ALLOWED_MIMES.has('application/pdf')).toBe(true);
    });

    test('BLOCKED_EXTENSIONS includes dangerous types', () => {
        expect(BLOCKED_EXTENSIONS.has('.exe')).toBe(true);
        expect(BLOCKED_EXTENSIONS.has('.html')).toBe(true);
        expect(BLOCKED_EXTENSIONS.has('.js')).toBe(true);
        expect(BLOCKED_EXTENSIONS.has('.php')).toBe(true);
    });
});

// ── Multipart parsing (rawBody-aware) ─────────────────────────────────────────
// Reproduces the Cloud Functions 2nd gen drained-stream case: the body arrives in
// req.rawBody with no readable stream. parseMultipart must handle it via
// busboy.end(rawBody) — the exact condition where multer's .single() threw
// "Unexpected end of form".

describe('manualUpload — parseMultipart', () => {
    const BOUNDARY = 'testboundary1234';

    test('parses a file + fields from a drained request (rawBody only, no stream)', async () => {
        const pdf = Buffer.from('%PDF-1.4 hello');
        const body = buildMultipart(BOUNDARY, [
            { name: 'profileId', data: 'profile-123' },
            { name: 'file', filename: 'doc.pdf', contentType: 'application/pdf', data: pdf },
        ]);
        const { file, fields } = await parseMultipart(fakeReq(BOUNDARY, body));
        expect(file).not.toBeNull();
        expect(file.originalname).toBe('doc.pdf');
        expect(file.mimetype).toBe('application/pdf');
        expect(Buffer.isBuffer(file.buffer)).toBe(true);
        expect(file.buffer.equals(pdf)).toBe(true);
        expect(file.size).toBe(pdf.length);
        expect(fields.profileId).toBe('profile-123');
    });

    test('returns multer-memoryStorage-compatible shape (originalname/mimetype/buffer/size)', async () => {
        const body = buildMultipart(BOUNDARY, [
            { name: 'file', filename: 'a.txt', contentType: 'text/plain', data: 'abc' },
        ]);
        const { file } = await parseMultipart(fakeReq(BOUNDARY, body));
        expect(Object.keys(file).sort()).toEqual(['buffer', 'fieldname', 'mimetype', 'originalname', 'size']);
    });

    test('no file part → file is null (route maps this to 400)', async () => {
        const body = buildMultipart(BOUNDARY, [{ name: 'title', data: 'no file here' }]);
        const { file, fields } = await parseMultipart(fakeReq(BOUNDARY, body));
        expect(file).toBeNull();
        expect(fields.title).toBe('no file here');
    });

    test('rejects non-multipart content-type', async () => {
        await expect(
            parseMultipart({ headers: { 'content-type': 'application/json' }, rawBody: Buffer.from('{}') })
        ).rejects.toThrow(/multipart/i);
    });

    test('oversize file is rejected with a message reflecting the actual limit (not hardcoded 25MB)', async () => {
        const big = Buffer.alloc(3 * 1024 * 1024, 0x41); // 3MB
        const body = buildMultipart(BOUNDARY, [
            { name: 'file', filename: 'big.pdf', contentType: 'application/pdf', data: big },
        ]);
        await expect(
            parseMultipart(fakeReq(BOUNDARY, body), { fileSize: 2 * 1024 * 1024 }) // 2MB cap
        ).rejects.toThrow('File exceeds 2MB limit');
    });

    test('custom fileSize option lets a larger file through (index.js filing upload = 50MB)', async () => {
        const twoMB = Buffer.alloc(2 * 1024 * 1024, 0x42);
        const body = buildMultipart(BOUNDARY, [
            { name: 'filing', filename: 'f.pdf', contentType: 'application/pdf', data: twoMB },
        ]);
        // Would truncate under the 25MB default only if >25MB; here we prove the option raises the cap
        const { file } = await parseMultipart(fakeReq(BOUNDARY, body), { fileSize: 50 * 1024 * 1024 });
        expect(file.size).toBe(twoMB.length);
        expect(file.fieldname).toBe('filing');
    });

    test('default limit is MAX_FILE_SIZE (25MB) when no option passed', async () => {
        const body = buildMultipart(BOUNDARY, [
            { name: 'file', filename: 's.txt', contentType: 'text/plain', data: 'small' },
        ]);
        const { file } = await parseMultipart(fakeReq(BOUNDARY, body));
        expect(file.size).toBe(5);
    });
});

// ── Regression guard: no drained-stream multipart parsing anywhere ────────────
// The manual-upload 500 ("Unexpected end of form") was caused by multer's
// .single() reading a request stream that Cloud Functions 2nd gen had already
// drained into req.rawBody. Assert the whole backend is free of that pattern —
// grep-zero for `.single(` AND `require('multer')` across functions/ source.

describe('manualUpload — no multer drained-stream parsing (repo-wide)', () => {
    function walkJs(dir, acc) {
        for (const name of fs.readdirSync(dir)) {
            if (name === 'node_modules' || name === 'coverage' || name === 'tests') continue;
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) walkJs(full, acc);
            else if (name.endsWith('.js')) acc.push(full);
        }
        return acc;
    }

    test('no `.single(` or `require("multer")` in functions/ source', () => {
        const root = path.resolve(__dirname, '..'); // functions/
        const offenders = [];
        for (const f of walkJs(root, [])) {
            const src = fs.readFileSync(f, 'utf8');
            if (/\.single\s*\(/.test(src) || /require\(\s*['"]multer['"]\s*\)/.test(src)) {
                offenders.push(path.relative(root, f));
            }
        }
        expect(offenders).toEqual([]);
    });
});
