'use strict';

const {
    createBookingRecoveryRouter,
    MAX_BODY_BYTES
} = require('../../routes/bookingRecoveryRoutes');

const actor = {
    uid: 'operator_uid', uid_digest: 'a'.repeat(64), email_digest: 'b'.repeat(64), role: 'super_admin'
};

function response() {
    return {
        headersSent: false,
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; this.headersSent = true; return this; }
    };
}

function request(method, path, overrides = {}) {
    return Object.assign({
        method,
        path,
        normalizedPath: path,
        headers: {},
        query: {},
        body: {},
        rawBody: Buffer.from('{}'),
        get(name) { return this.headers[String(name).toLowerCase()]; }
    }, overrides);
}

function fixture() {
    const runtime = {
        recovery: {
            inventory: jest.fn().mockResolvedValue({ count: 7 }),
            inspect: jest.fn().mockResolvedValue({ classification: 'CANCEL_REQUIRED' }),
            dryRun: jest.fn().mockResolvedValue({ receipt: { persisted: false } }),
            execute: jest.fn().mockResolvedValue({ classification: 'ALREADY_CLEAN' })
        },
        recoveryPersistence: {
            readReceipt: jest.fn().mockResolvedValue({ final_classification: 'ALREADY_CLEAN' })
        }
    };
    const authorize = jest.fn(async (req, _res, next) => {
        req.recoveryActor = actor;
        next();
    });
    return {
        runtime,
        authorize,
        router: createBookingRecoveryRouter({ authorize, getRuntime: () => runtime })
    };
}

describe('governed synthetic recovery routes', () => {
    let errorLog;
    beforeEach(() => { errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => jest.restoreAllMocks());

    test('runs operator authorization before inventory', async () => {
        const { router, runtime, authorize } = fixture();
        const res = response();
        await router.handle(request('GET', '/admin/synchintro/synthetic-recovery'), res);
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(runtime.recovery.inventory).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ success: true, data: { count: 7 } });
    });

    test('stops when authorization denies the request', async () => {
        const runtime = fixture().runtime;
        const authorize = async (_req, res) => res.status(403).json({ success: false });
        const router = createBookingRecoveryRouter({ authorize, getRuntime: () => runtime });
        const res = response();
        await router.handle(request('GET', '/admin/synchintro/synthetic-recovery'), res);
        expect(res.statusCode).toBe(403);
        expect(runtime.recovery.inventory).not.toHaveBeenCalled();
    });

    test('inspects one safe reference without accepting request identifiers', async () => {
        const { router, runtime } = fixture();
        const res = response();
        await router.handle(request(
            'GET', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL'
        ), res);
        expect(runtime.recovery.inspect).toHaveBeenCalledWith('SYNCH-P2-0001_INITIAL');
        expect(res.statusCode).toBe(200);
    });

    test('dry-run accepts only an empty JSON object and binds the actor', async () => {
        const { router, runtime } = fixture();
        const req = request('POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/dry-run', {
            headers: { 'content-type': 'application/json' }
        });
        const res = response();
        await router.handle(req, res);
        expect(runtime.recovery.dryRun).toHaveBeenCalledWith('SYNCH-P2-0001_INITIAL', actor);
        expect(res.body.data.receipt.persisted).toBe(false);
    });

    test('dry-run rejects provider or workspace substitution fields', async () => {
        const { router, runtime } = fixture();
        const req = request('POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/dry-run', {
            headers: { 'content-type': 'application/json' },
            body: { provider_booking_id: 'attacker' }
        });
        const res = response();
        await router.handle(req, res);
        expect(res.statusCode).toBe(400);
        expect(runtime.recovery.dryRun).not.toHaveBeenCalled();
    });

    test('execute requires exactly one well-formed recovery operation identity', async () => {
        const { router, runtime } = fixture();
        const body = { recovery_operation_id: 'recovery-operation-0001' };
        const req = request('POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/execute', {
            headers: { 'content-type': 'application/json' }, body,
            rawBody: Buffer.from(JSON.stringify(body))
        });
        const res = response();
        await router.handle(req, res);
        expect(runtime.recovery.execute).toHaveBeenCalledWith({
            reference: 'SYNCH-P2-0001_INITIAL',
            recovery_operation_id: body.recovery_operation_id,
            actor
        });
        expect(res.statusCode).toBe(200);
    });

    test.each([
        [{}, 400],
        [{ recovery_operation_id: 'short' }, 400],
        [{ recovery_operation_id: 'recovery-operation-0001', workspace_id: 'other' }, 400]
    ])('execute rejects malformed or expanded body %p', async (body, status) => {
        const { router, runtime } = fixture();
        const res = response();
        await router.handle(request(
            'POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/execute', {
                headers: { 'content-type': 'application/json' }, body,
                rawBody: Buffer.from(JSON.stringify(body))
            }
        ), res);
        expect(res.statusCode).toBe(status);
        expect(runtime.recovery.execute).not.toHaveBeenCalled();
    });

    test('rejects unsupported media type and oversized body before execution', async () => {
        const { router, runtime } = fixture();
        for (const req of [
            request('POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/execute', {
                body: { recovery_operation_id: 'recovery-operation-0001' }
            }),
            request('POST', '/admin/synchintro/synthetic-recovery/SYNCH-P2-0001_INITIAL/execute', {
                headers: { 'content-type': 'application/json' },
                body: { recovery_operation_id: 'recovery-operation-0001' },
                rawBody: Buffer.alloc(MAX_BODY_BYTES + 1)
            })
        ]) {
            const res = response();
            await router.handle(req, res);
            expect([413, 415]).toContain(res.statusCode);
        }
        expect(runtime.recovery.execute).not.toHaveBeenCalled();
    });

    test('rejects query parameters on every recovery surface', async () => {
        const { router, runtime } = fixture();
        const res = response();
        await router.handle(request('GET', '/admin/synchintro/synthetic-recovery', {
            query: { workspace: 'attacker' }
        }), res);
        expect(res.statusCode).toBe(400);
        expect(runtime.recovery.inventory).not.toHaveBeenCalled();
    });

    test('retrieves only the actor-bound sanitized receipt', async () => {
        const { router, runtime } = fixture();
        const res = response();
        await router.handle(request(
            'GET', '/admin/synchintro/synthetic-recovery/receipts/recovery-operation-0001'
        ), res);
        expect(runtime.recoveryPersistence.readReceipt)
            .toHaveBeenCalledWith('recovery-operation-0001', actor);
        expect(res.body.data.final_classification).toBe('ALREADY_CLEAN');
    });
});
