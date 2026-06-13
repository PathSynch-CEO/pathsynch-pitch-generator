'use strict';

// ── Firebase Admin Mock ──────────────────────────────────────────────────────

let mockTransactionData = { reviewHealthStatus: 'not_queued' };

const mockTxGet = jest.fn(async () => ({
    exists: true,
    data: () => ({ ...mockTransactionData }),
}));
const mockTxUpdate = jest.fn();

const mockGet = jest.fn(async () => ({
    exists: true,
    data: () => ({ ...mockTransactionData }),
}));
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({
    get: mockGet,
    update: mockUpdate,
    collection: jest.fn(() => ({ doc: mockDoc })),
}));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockRunTransaction = jest.fn(async (fn) => {
    return fn({ get: mockTxGet, update: mockTxUpdate });
});

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }), {
        FieldValue: {
            serverTimestamp: () => new Date(),
            increment: (n) => ({ _increment: n }),
        },
    }),
    initializeApp: jest.fn(),
}));

// Mock GoogleAuth — don't make real GCP calls
jest.mock('google-auth-library', () => ({
    GoogleAuth: jest.fn().mockImplementation(() => ({
        getClient: jest.fn().mockResolvedValue({
            getAccessToken: jest.fn().mockResolvedValue({ token: 'mock-token' }),
        }),
    })),
}));

// Mock fetch globally
const mockFetchResponse = { ok: true, json: jest.fn().mockResolvedValue({ name: 'tasks/mock-task' }) };
global.fetch = jest.fn().mockResolvedValue(mockFetchResponse);

const { enqueueReviewHealthTask } = require('../services/reviewHealthEnqueue');

// ── Layer 1: Firestore Status Transition ─────────────────────────────────────

describe('reviewHealthEnqueue — Layer 1 status transition', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.REVIEW_TASK_SECRET = 'test-secret';
        mockTransactionData = { reviewHealthStatus: 'not_queued' };
    });

    afterEach(() => {
        delete process.env.REVIEW_TASK_SECRET;
    });

    test('not_queued → queued + task created', async () => {
        mockTransactionData = { reviewHealthStatus: 'not_queued' };
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(true);
        expect(mockTxUpdate).toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
    });

    test('failed → queued + task created (re-enrichment)', async () => {
        mockTransactionData = { reviewHealthStatus: 'failed' };
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(true);
    });

    test('queued → skip, no task created', async () => {
        mockTransactionData = { reviewHealthStatus: 'queued' };
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(false);
        expect(result.reason).toBe('already_in_progress_or_complete');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('processing → skip', async () => {
        mockTransactionData = { reviewHealthStatus: 'processing' };
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(false);
    });

    test('complete → skip', async () => {
        mockTransactionData = { reviewHealthStatus: 'complete' };
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(false);
    });

    test('no reviewHealthStatus field → treated as not_queued', async () => {
        mockTransactionData = {}; // no reviewHealthStatus
        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(true);
    });
});

// ── Layer 2: Cloud Tasks Named Task ──────────────────────────────────────────

describe('reviewHealthEnqueue — Layer 2 named tasks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.REVIEW_TASK_SECRET = 'test-secret';
        mockTransactionData = { reviewHealthStatus: 'not_queued' };
    });

    afterEach(() => {
        delete process.env.REVIEW_TASK_SECRET;
    });

    test('Cloud Tasks payload contains named task', async () => {
        await enqueueReviewHealthTask('batch1', 'prospect1');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('cloudtasks.googleapis.com'),
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('reviewhealth-batch1-prospect1'),
            })
        );
    });

    test('ALREADY_EXISTS (409) treated as success', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 409,
            text: jest.fn().mockResolvedValue('ALREADY_EXISTS'),
        });

        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(true);
        expect(result.reason).toBe('already_exists');
    });

    test('other HTTP error → enqueue failed, status reverted', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: jest.fn().mockResolvedValue('Internal Server Error'),
        });

        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(false);
        expect(result.reason).toBe('enqueue_failed');
        // Status should be reverted to 'failed'
        expect(mockUpdate).toHaveBeenCalled();
    });
});

// ── Transaction Failure ──────────────────────────────────────────────────────

describe('reviewHealthEnqueue — transaction failure', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.REVIEW_TASK_SECRET = 'test-secret';
    });

    test('transaction error → enqueued false', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('Firestore contention'));

        const result = await enqueueReviewHealthTask('batch1', 'prospect1');
        expect(result.enqueued).toBe(false);
        expect(result.reason).toBe('transaction_failed');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
