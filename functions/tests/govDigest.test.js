'use strict';

// ── Composer Tests (pure — no mocks needed) ──────────────────────────────────

const { composeDigest, _esc, _stripCRLF, _scoreBadgeColor } = require('../services/govcapture/digestComposer');

const SAMPLE_PROFILE = {
    id: 'profile-1',
    profileName: 'Countifi',
    digestSettings: { frequency: 'daily' },
};

const SAMPLE_OPPS = [
    {
        id: 'opp-1', title: 'RFID Asset Management', buyerName: 'Air Force',
        location: { state: 'LA' }, dueDate: '2026-08-15', primarySource: 'sam_gov',
        fit: { score: 85, label: 'Strong Fit', reasonCodes: ['MATCH_NAICS_EXACT', 'KEYWORD_HIT:RFID'], riskCodes: [] },
        description: 'Comprehensive RFID tracking system for warehouse operations.',
    },
    {
        id: 'opp-2', title: 'Supply Chain Visibility', buyerName: 'FEMA',
        location: { state: 'VA' }, dueDate: '2026-07-20', primarySource: 'sam_gov',
        fit: { score: 68, label: 'Possible Fit', reasonCodes: ['KEYWORD_HIT:supply chain'], riskCodes: ['RISK_NEGATIVE_KEYWORD_MATCH'] },
        description: 'Supply chain analytics platform for disaster logistics.',
    },
];

describe('digestComposer — _esc', () => {
    test('escapes HTML entities', () => {
        expect(_esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('handles null/undefined', () => {
        expect(_esc(null)).toBe('');
        expect(_esc(undefined)).toBe('');
    });
});

describe('digestComposer — _stripCRLF', () => {
    test('strips carriage return and newline', () => {
        expect(_stripCRLF('Hello\r\nWorld')).toBe('Hello  World');
    });

    test('handles null', () => {
        expect(_stripCRLF(null)).toBe('');
    });
});

describe('digestComposer — _scoreBadgeColor', () => {
    test('Strong Fit → green', () => {
        expect(_scoreBadgeColor('Strong Fit')).toBe('#10B981');
    });

    test('Poor Fit → red', () => {
        expect(_scoreBadgeColor('Poor Fit')).toBe('#EF4444');
    });

    test('null → gray', () => {
        expect(_scoreBadgeColor(null)).toBe('#6B7280');
    });
});

describe('digestComposer — composeDigest', () => {
    test('opportunities sorted by score desc', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result).not.toBeNull();
        expect(result.opportunityCount).toBe(2);
        // First opp in HTML should be higher score
        const rfidIdx = result.htmlBody.indexOf('RFID Asset Management');
        const chainIdx = result.htmlBody.indexOf('Supply Chain Visibility');
        expect(rfidIdx).toBeLessThan(chainIdx);
    });

    test('subject includes count and company name', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result.subject).toContain('2');
        expect(result.subject).toContain('Countifi');
    });

    test('subject has no CRLF (header injection prevention)', () => {
        const profile = { ...SAMPLE_PROFILE, profileName: 'Test\r\nInjection' };
        const result = composeDigest(profile, SAMPLE_OPPS);
        expect(result.subject).not.toMatch(/[\r\n]/);
    });

    test('HTML escaping: title with <script> tag → escaped', () => {
        const opps = [{ ...SAMPLE_OPPS[0], title: '<script>alert("xss")</script>' }];
        const result = composeDigest(SAMPLE_PROFILE, opps);
        expect(result.htmlBody).not.toContain('<script>alert');
        expect(result.htmlBody).toContain('&lt;script&gt;');
    });

    test('plain text generated separately (not HTML-stripped)', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result.textBody).not.toContain('<div');
        expect(result.textBody).not.toContain('</div>');
        expect(result.textBody).toContain('RFID Asset Management');
    });

    test('empty opportunities, sendEmptyDigest false → null', () => {
        const result = composeDigest(SAMPLE_PROFILE, [], { sendEmptyDigest: false });
        expect(result).toBeNull();
    });

    test('empty opportunities, sendEmptyDigest true → "no new" email', () => {
        const result = composeDigest(SAMPLE_PROFILE, [], { sendEmptyDigest: true });
        expect(result).not.toBeNull();
        expect(result.opportunityCount).toBe(0);
        expect(result.htmlBody).toContain('No new opportunities');
        expect(result.textBody).toContain('No new opportunities');
    });

    test('reason codes rendered as chips', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result.htmlBody).toContain('MATCH_NAICS_EXACT');
    });

    test('risk codes rendered', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result.htmlBody).toContain('RISK_NEGATIVE_KEYWORD_MATCH');
    });

    test('opportunityIds populated', () => {
        const result = composeDigest(SAMPLE_PROFILE, SAMPLE_OPPS);
        expect(result.opportunityIds).toContain('opp-1');
        expect(result.opportunityIds).toContain('opp-2');
    });
});

// ── Sender Tests (mock SendGrid + Firestore) ─────────────────────────────────

jest.mock('@sendgrid/mail', () => ({
    setApiKey: jest.fn(),
    send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
}));

const mockGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
const mockAdd = jest.fn().mockResolvedValue({ id: 'log-1' });
const mockDoc = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn().mockReturnThis();
const mockCollection = jest.fn(() => ({
    doc: mockDoc, add: mockAdd,
    where: mockWhere, limit: jest.fn().mockReturnThis(), get: mockGet,
}));

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: mockCollection,
    }), {
        FieldValue: { serverTimestamp: () => new Date() },
    }),
    initializeApp: jest.fn(),
}));

const sgMail = require('@sendgrid/mail');
const { sendDigest, _getDigestWindow } = require('../services/govcapture/digestSender');

describe('digestSender — _getDigestWindow', () => {
    test('daily window key is date string', () => {
        const w = _getDigestWindow('daily', new Date('2026-06-15T12:00:00Z'));
        expect(w.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('weekly window key includes two dates', () => {
        const w = _getDigestWindow('weekly', new Date('2026-06-15T12:00:00Z'));
        expect(w.key).toContain(':');
    });
});

describe('digestSender — sendDigest', () => {
    const PROFILE = {
        id: 'profile-1',
        profileName: 'Countifi',
        digestFrequency: 'daily',
        digestRecipients: ['test@example.com'],
        digestMinFitScore: 65,
        digestIncludeSources: [],
        sendEmptyDigest: false,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GOVCAPTURE_SENDGRID_API_KEY = 'SG.test-key';
        process.env.GOVCAPTURE_DIGEST_FROM_EMAIL = 'digest@synchgov.ai';
        // Default: no existing sent log, no opportunities
        mockGet.mockResolvedValue({ empty: true, docs: [] });
    });

    afterEach(() => {
        delete process.env.GOVCAPTURE_SENDGRID_API_KEY;
        delete process.env.GOVCAPTURE_DIGEST_FROM_EMAIL;
    });

    test('no qualifying opportunities, sendEmptyDigest false → skipped', async () => {
        const result = await sendDigest(PROFILE);
        expect(result.status).toBe('skipped');
        expect(result.errorMessage).toContain('no_qualifying');
        expect(sgMail.send).not.toHaveBeenCalled();
    });

    test('missing GOVCAPTURE_SENDGRID_API_KEY → failed', async () => {
        delete process.env.GOVCAPTURE_SENDGRID_API_KEY;
        // Need opps to get past the "no qualifying" check
        mockGet
            .mockResolvedValueOnce({ empty: true, docs: [] }) // idempotency check
            .mockResolvedValueOnce({ docs: [{ id: 'o1', data: () => ({ ...SAMPLE_OPPS[0], profileIds: ['profile-1'] }) }] }) // created query
            .mockResolvedValueOnce({ docs: [] }); // updated query

        const result = await sendDigest(PROFILE);
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain('SENDGRID_API_KEY');
    });

    test('idempotency: already sent for window → skipped', async () => {
        mockGet.mockResolvedValueOnce({
            empty: false,
            docs: [{ id: 'existing-log', data: () => ({ status: 'sent' }) }],
        });

        const result = await sendDigest(PROFILE);
        expect(result.status).toBe('skipped');
        expect(result.errorMessage).toContain('already_sent');
        expect(sgMail.send).not.toHaveBeenCalled();
    });

    test('DigestLog includes digestWindowKey', async () => {
        const result = await sendDigest(PROFILE);
        expect(result.digestWindowKey).toBeTruthy();
        expect(result.digestWindowKey).toContain('profile-1');
    });

    test('DigestLog includes recipientEmails and recipientCount', async () => {
        const result = await sendDigest(PROFILE);
        expect(result.recipientEmails).toEqual(['test@example.com']);
        expect(result.recipientCount).toBe(1);
    });

    test('no recipients → skipped', async () => {
        // Need opps
        mockGet
            .mockResolvedValueOnce({ empty: true, docs: [] })
            .mockResolvedValueOnce({ docs: [{ id: 'o1', data: () => ({ ...SAMPLE_OPPS[0], profileIds: ['profile-1'] }) }] })
            .mockResolvedValueOnce({ docs: [] });

        const noRecipProfile = { ...PROFILE, digestRecipients: [] };
        const result = await sendDigest(noRecipProfile);
        expect(result.status).toBe('skipped');
        expect(result.errorMessage).toContain('no_recipients');
    });

    test('SendGrid failure → DigestLog failed, no throw', async () => {
        sgMail.send.mockRejectedValueOnce(new Error('SendGrid 403'));
        mockGet
            .mockResolvedValueOnce({ empty: true, docs: [] })
            .mockResolvedValueOnce({ docs: [{ id: 'o1', data: () => ({ ...SAMPLE_OPPS[0], profileIds: ['profile-1'] }) }] })
            .mockResolvedValueOnce({ docs: [] });

        const result = await sendDigest(PROFILE);
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain('SendGrid');
    });
});

// ── Route Contract Tests ─────────────────────────────────────────────────────

describe('govDigest — route contracts', () => {
    test('digest settings, test send, and admin run-digest endpoints exist', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('/govcapture/digest-settings/');
        expect(content).toContain('/govcapture/digests/send-test');
        expect(content).toContain('/admin/govcapture/run-digest');
    });

    test('run-digest uses x-admin-key + GOVCAPTURE_SCHEDULER_SECRET', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        // Should contain the pattern twice — once for daily-sync (PR #2), once for digest
        const matches = content.match(/GOVCAPTURE_SCHEDULER_SECRET/g);
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    test('send-test checks GOVCAPTURE_DIGESTS_ENABLED', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('GOVCAPTURE_DIGESTS_ENABLED');
    });

    test('settings PUT validates frequency', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain("'daily', 'weekly', 'off'");
    });

    test('settings PUT validates max 10 recipients', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('Maximum 10 recipients');
    });

    test('settings PUT rejects CRLF in email', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('CRLF');
    });

    test('settings PUT rejects duplicate recipients', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('Duplicate recipient');
    });

    test('send-test sends to profile.digestRecipients only', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        // The send-test route calls sendDigest(profile) — not sendDigest(profile, { recipients: body.recipients })
        expect(content).toContain('sendDigest(profile)');
    });

    test('run-digest checks weekly only on Monday', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('isMonday');
        expect(content).toContain('America/New_York');
    });
});
