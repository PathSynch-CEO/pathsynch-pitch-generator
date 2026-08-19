'use strict';

/**
 * B2 + B3 — Prospect Intel billing/reliability hardening.
 *
 * B2: legacy upfront deductProspectCredits() is removed (deduct-then-fail risk).
 * B3: vendor-error circuit breaker — after N consecutive *identical* systemic
 *     vendor errors, the batch trips `enrichmentServiceDown` so the remaining
 *     prospects fail fast with a clear status instead of grinding every call.
 */

// ── Mock hoisting (mirror prospectIntelCredits.test.js) ─────────────────────────

jest.mock('firebase-admin');
jest.mock('google-auth-library', () => ({ GoogleAuth: jest.fn() }));
jest.mock('../services/googlePlaces', () => ({ lookupProspectPlace: jest.fn() }));
jest.mock('../config/industryTaxonomy', () => ({ findIndustry: jest.fn(), findSubIndustry: jest.fn() }));
jest.mock('../config/reportProfiles', () => ({ getReportProfile: jest.fn() }));
jest.mock('../services/tools/techStackDetector', () => ({ detectTechStack: jest.fn() }));
jest.mock('../services/tools/gbpGrader', () => ({ gradeGBP: jest.fn() }));
jest.mock('../services/enrichmentCache', () => ({ getPlacesLookup: jest.fn(), setPlacesLookup: jest.fn() }));
jest.mock('../services/marketContextResolver', () => ({ matchProspectToReport: jest.fn() }));
jest.mock('../services/reviewHealthEnqueue', () => ({ enqueueReviewHealthTask: jest.fn() }));

const admin = require('firebase-admin');
const svc   = require('../services/prospectIntelService');
const { _classifyVendorError, _tripCircuitIfNeeded } = svc;

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
    delete process.env.PROSPECT_VENDOR_ERROR_THRESHOLD;
});

function setBatch(id, data) {
    admin._setMockCollection('prospectIntel', {
        ...(admin._mockData.collections['prospectIntel'] || {}),
        [id]: data,
    });
}
function getBatch(id) {
    return (admin._mockData.collections['prospectIntel'] || {})[id];
}

// ── B2 — deduct-then-fail path removed ─────────────────────────────────────────

describe('B2 — legacy deductProspectCredits removed', () => {
    test('deductProspectCredits is no longer exported', () => {
        expect(svc.deductProspectCredits).toBeUndefined();
    });

    test('the charge-on-success path remains the only credit path', () => {
        expect(typeof svc.chargeProspectEnrichmentCreditOnce).toBe('function');
    });
});

// ── B3 — error classifier ──────────────────────────────────────────────────────

describe('B3 — _classifyVendorError', () => {
    test('classifies the real Jul-10 batch error as API_KEY_INVALID', () => {
        // Verbatim shape of what all 68 prospects recorded on 2026-07-10.
        const real = 'Agent HTTP 500: {"error":"400 INVALID_ARGUMENT. {\'error\': {\'code\': 400, '
            + '\'message\': \'API key not valid. Please pass a valid API key.\', \'status\': \'INVALID_ARGUMENT\'';
        expect(_classifyVendorError(real)).toBe('API_KEY_INVALID');
    });

    test('API_KEY_INVALID wins over the generic AGENT_5XX signature', () => {
        expect(_classifyVendorError('Agent HTTP 500: API_KEY_INVALID')).toBe('API_KEY_INVALID');
    });

    test('generic agent 5xx → AGENT_5XX', () => {
        expect(_classifyVendorError('Agent HTTP 503: upstream connect error')).toBe('AGENT_5XX');
    });

    test('quota exhaustion → VENDOR_QUOTA', () => {
        expect(_classifyVendorError('Agent HTTP 429: RESOURCE_EXHAUSTED quota exceeded')).toBe('VENDOR_QUOTA');
    });

    test('timeout / connection failures → AGENT_UNREACHABLE', () => {
        expect(_classifyVendorError('The operation was aborted')).toBe('AGENT_UNREACHABLE');
        expect(_classifyVendorError('request to https://agent failed, reason: ECONNREFUSED')).toBe('AGENT_UNREACHABLE');
    });

    test('prospect-specific errors do NOT trip the breaker (null)', () => {
        expect(_classifyVendorError("Cannot read properties of undefined (reading 'x')")).toBeNull();
        expect(_classifyVendorError('Agent HTTP 400: bad businessName')).toBeNull();
        expect(_classifyVendorError('')).toBeNull();
        expect(_classifyVendorError(null)).toBeNull();
    });
});

// ── B3 — circuit trip behavior ─────────────────────────────────────────────────

describe('B3 — _tripCircuitIfNeeded', () => {
    test('trips only once the identical-error streak reaches the threshold', async () => {
        process.env.PROSPECT_VENDOR_ERROR_THRESHOLD = '3';
        setBatch('b1', { status: 'processing', vendorErrorStreak: 0 });
        const ref = admin.firestore().collection('prospectIntel').doc('b1');

        let r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');
        expect(r).toMatchObject({ streak: 1, tripped: false });
        expect(getBatch('b1').enrichmentServiceDown).toBeFalsy();

        r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');
        expect(r).toMatchObject({ streak: 2, tripped: false });

        r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');
        expect(r).toMatchObject({ streak: 3, tripped: true });
        expect(getBatch('b1').enrichmentServiceDown).toBe(true);
        expect(getBatch('b1').serviceUnavailableReason).toBe('API_KEY_INVALID');
    });

    test('a different error signature resets the streak (only identical errors trip)', async () => {
        process.env.PROSPECT_VENDOR_ERROR_THRESHOLD = '3';
        setBatch('b2', { status: 'processing', vendorErrorStreak: 2, lastVendorErrorSignature: 'API_KEY_INVALID' });
        const ref = admin.firestore().collection('prospectIntel').doc('b2');

        const r = await _tripCircuitIfNeeded(ref, 'AGENT_5XX');
        expect(r).toMatchObject({ streak: 1, tripped: false });
        expect(getBatch('b2').enrichmentServiceDown).toBeFalsy();
    });

    test('idempotent once tripped — no re-trip, streak frozen', async () => {
        setBatch('b3', { status: 'processing', enrichmentServiceDown: true, vendorErrorStreak: 10 });
        const ref = admin.firestore().collection('prospectIntel').doc('b3');

        const r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');
        expect(r.already).toBe(true);
        expect(r.tripped).toBe(true);
        expect(getBatch('b3').vendorErrorStreak).toBe(10); // unchanged
    });

    test('default threshold is 10 when env unset', async () => {
        setBatch('b4', { status: 'processing', vendorErrorStreak: 8, lastVendorErrorSignature: 'API_KEY_INVALID' });
        const ref = admin.firestore().collection('prospectIntel').doc('b4');

        let r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID'); // 9
        expect(r.tripped).toBe(false);
        r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');     // 10 → trip
        expect(r).toMatchObject({ streak: 10, tripped: true });
    });

    test('missing batch doc → no throw, not tripped', async () => {
        const ref = admin.firestore().collection('prospectIntel').doc('nope');
        const r = await _tripCircuitIfNeeded(ref, 'API_KEY_INVALID');
        expect(r.tripped).toBe(false);
    });
});
