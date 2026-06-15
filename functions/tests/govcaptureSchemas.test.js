'use strict';

const {
    MAX_SOLUTIONS,
    MAX_KEYWORDS_PER_SOLUTION,
    PROFILE_CLIENT_FIELDS,
    PURSUIT_STATUSES,
    FIT_LABELS,
    DEFAULT_CHECKLIST_QUESTIONS,
    SYNC_LOCK_LEASE_MINUTES,
    validateProfileInput,
    stripUndefined,
} = require('../services/govcapture/schemas');

// ── Constants ────────────────────────────────────────────────────────────────

describe('govcapture schemas — constants', () => {
    test('MAX_SOLUTIONS is 10', () => {
        expect(MAX_SOLUTIONS).toBe(10);
    });

    test('MAX_KEYWORDS_PER_SOLUTION is 60', () => {
        expect(MAX_KEYWORDS_PER_SOLUTION).toBe(60);
    });

    test('PURSUIT_STATUSES has 7 values', () => {
        expect(PURSUIT_STATUSES).toHaveLength(7);
        expect(PURSUIT_STATUSES).toContain('new');
        expect(PURSUIT_STATUSES).toContain('pursuing');
        expect(PURSUIT_STATUSES).toContain('no_bid');
    });

    test('FIT_LABELS has 6 values', () => {
        expect(FIT_LABELS).toHaveLength(6);
        expect(FIT_LABELS).toContain('Strong Fit');
        expect(FIT_LABELS).toContain('Disqualified');
    });

    test('DEFAULT_CHECKLIST_QUESTIONS has 5 questions', () => {
        expect(DEFAULT_CHECKLIST_QUESTIONS).toHaveLength(5);
        expect(DEFAULT_CHECKLIST_QUESTIONS[0]).toContain('budget');
        expect(DEFAULT_CHECKLIST_QUESTIONS[1]).toContain('pre-bid');
        expect(DEFAULT_CHECKLIST_QUESTIONS[2]).toContain('geography');
        expect(DEFAULT_CHECKLIST_QUESTIONS[3]).toContain('evaluation');
        expect(DEFAULT_CHECKLIST_QUESTIONS[4]).toContain('submission');
    });

    test('SYNC_LOCK_LEASE_MINUTES is 10', () => {
        expect(SYNC_LOCK_LEASE_MINUTES).toBe(10);
    });

    test('PROFILE_CLIENT_FIELDS does not include server-controlled fields', () => {
        expect(PROFILE_CLIENT_FIELDS.has('userId')).toBe(false);
        expect(PROFILE_CLIENT_FIELDS.has('createdAt')).toBe(false);
        expect(PROFILE_CLIENT_FIELDS.has('updatedAt')).toBe(false);
        expect(PROFILE_CLIENT_FIELDS.has('status')).toBe(false);
        expect(PROFILE_CLIENT_FIELDS.has('rescoreNeeded')).toBe(false);
    });

    test('PROFILE_CLIENT_FIELDS includes allowed fields', () => {
        expect(PROFILE_CLIENT_FIELDS.has('profileName')).toBe(true);
        expect(PROFILE_CLIENT_FIELDS.has('solutions')).toBe(true);
        expect(PROFILE_CLIENT_FIELDS.has('credentials')).toBe(true);
        expect(PROFILE_CLIENT_FIELDS.has('negativeKeywords')).toBe(true);
    });
});

// ── validateProfileInput ─────────────────────────────────────────────────────

describe('govcapture schemas — validateProfileInput', () => {
    test('valid profile passes', () => {
        const result = validateProfileInput({
            profileName: 'Test Profile',
            solutions: [{ name: 'Sol 1', keywords: ['kw1', 'kw2'] }],
        });
        expect(result.valid).toBe(true);
    });

    test('null data rejected', () => {
        expect(validateProfileInput(null).valid).toBe(false);
    });

    test('missing profileName rejected', () => {
        expect(validateProfileInput({ solutions: [] }).valid).toBe(false);
    });

    test('empty profileName rejected', () => {
        expect(validateProfileInput({ profileName: '  ' }).valid).toBe(false);
    });

    test('solutions > 10 rejected', () => {
        const solutions = Array.from({ length: 11 }, (_, i) => ({ name: `Sol ${i}` }));
        expect(validateProfileInput({ profileName: 'Test', solutions }).valid).toBe(false);
        expect(validateProfileInput({ profileName: 'Test', solutions }).error).toContain('10');
    });

    test('solutions with > 60 keywords rejected', () => {
        const keywords = Array.from({ length: 61 }, (_, i) => `kw${i}`);
        const result = validateProfileInput({
            profileName: 'Test',
            solutions: [{ name: 'Sol', keywords }],
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('60');
    });

    test('unexpected field rejected (whitelist)', () => {
        const result = validateProfileInput({
            profileName: 'Test',
            userId: 'spoofed-uid',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('userId');
    });

    test('server-controlled fields rejected: createdAt', () => {
        expect(validateProfileInput({
            profileName: 'Test',
            createdAt: new Date(),
        }).valid).toBe(false);
    });

    test('server-controlled fields rejected: status', () => {
        expect(validateProfileInput({
            profileName: 'Test',
            status: 'active',
        }).valid).toBe(false);
    });

    test('exactly 10 solutions passes', () => {
        const solutions = Array.from({ length: 10 }, (_, i) => ({ name: `Sol ${i}` }));
        expect(validateProfileInput({ profileName: 'Test', solutions }).valid).toBe(true);
    });

    test('exactly 60 keywords passes', () => {
        const keywords = Array.from({ length: 60 }, (_, i) => `kw${i}`);
        expect(validateProfileInput({
            profileName: 'Test',
            solutions: [{ name: 'Sol', keywords }],
        }).valid).toBe(true);
    });
});

// ── stripUndefined ───────────────────────────────────────────────────────────

describe('govcapture schemas — stripUndefined', () => {
    test('removes undefined values', () => {
        expect(stripUndefined({ a: 1, b: undefined, c: 'test' })).toEqual({ a: 1, c: 'test' });
    });

    test('keeps null values', () => {
        expect(stripUndefined({ a: null })).toEqual({ a: null });
    });

    test('handles null input', () => {
        expect(stripUndefined(null)).toBeNull();
    });
});
