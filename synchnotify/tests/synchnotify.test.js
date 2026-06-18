/**
 * SynchNotify S1 Tests
 *
 * Covers: health, HMAC auth, replay protection, idempotency,
 * event envelope validation, event processing, delivery worker,
 * tenant resolver, tier gating, dead letter handling.
 */

const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ============================================
// MOCK FIRESTORE
// ============================================

function createMockFirestore() {
    const store = {};

    function getCollection(path) {
        if (!store[path]) store[path] = {};
        return store[path];
    }

    const db = {
        _store: store,
        collection(name) {
            return {
                doc(id) {
                    const docId = id || uuidv4();
                    return {
                        get: jest.fn(async () => {
                            const data = getCollection(name)[docId];
                            return {
                                exists: !!data,
                                data: () => data,
                                id: docId
                            };
                        }),
                        set: jest.fn(async (val) => {
                            getCollection(name)[docId] = val;
                        }),
                        update: jest.fn(async (val) => {
                            if (getCollection(name)[docId]) {
                                Object.assign(getCollection(name)[docId], val);
                            }
                        })
                    };
                },
                limit() {
                    return {
                        get: jest.fn(async () => ({ docs: [] }))
                    };
                }
            };
        },
        runTransaction: jest.fn(async (fn) => {
            const transaction = {
                get: async (ref) => ref.get(),
                set: (ref, data) => ref.set(data)
            };
            return fn(transaction);
        })
    };

    return db;
}

// ============================================
// MOCK CLOUD TASKS
// ============================================

function createMockTaskClient() {
    return {
        createTask: jest.fn(async () => ({ name: 'mock-task' }))
    };
}

// ============================================
// HELPERS
// ============================================

const SIGNING_KEY = 'test-signing-key-for-synchintro-hmac-validation';

function makeSignature(timestamp, body, key = SIGNING_KEY) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const payload = timestamp + '.' + rawBody;
    return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function makeValidEvent(overrides = {}) {
    return {
        tenantId: 'dehiyRBCXcUUM72O211S27lfXbl1',
        identitySpace: 'firebase',
        merchantCode: '56B8DE',
        source: 'synchintro',
        eventType: 'positive_reply',
        priority: 'high',
        payload: {
            companyName: 'Test Corp',
            contactEmail: 'test@example.com'
        },
        timestamp: new Date().toISOString(),
        idempotencyKey: uuidv4(),
        version: '1.0',
        ...overrides
    };
}

function buildApp(db, taskClient, signingKeys) {
    const { healthRoutes } = require('../src/routes/healthRoutes');
    const { eventRoutes } = require('../src/routes/eventRoutes');
    const { internalRoutes } = require('../src/routes/internalRoutes');
    const { hmacAuth } = require('../src/middleware/hmacAuth');
    const { idempotency } = require('../src/middleware/idempotency');

    const app = express();
    app.use(express.json({
        verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
    }));

    const keys = signingKeys || { synchintro: SIGNING_KEY };

    app.use(healthRoutes({ db }));
    app.use(eventRoutes({
        db,
        taskClient,
        config: { queuePath: 'projects/test/locations/us/queues/test', serviceUrl: 'http://localhost:8080' },
        hmacMiddleware: hmacAuth({ signingKeys: keys }),
        idempotencyMiddleware: idempotency({ db })
    }));
    app.use(internalRoutes({ db }));

    return app;
}

// Minimal test HTTP helper (no supertest dependency)
function request(app) {
    const http = require('http');
    const server = http.createServer(app);

    return {
        _server: server,
        async send(method, path, body, headers = {}) {
            return new Promise((resolve, reject) => {
                server.listen(0, '127.0.0.1', () => {
                    const port = server.address().port;
                    const bodyStr = body ? JSON.stringify(body) : '';
                    const opts = {
                        hostname: '127.0.0.1',
                        port,
                        path,
                        method,
                        headers: {
                            'Content-Type': 'application/json',
                            ...headers
                        }
                    };

                    const req = http.request(opts, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', () => {
                            server.close();
                            try {
                                resolve({ status: res.statusCode, body: JSON.parse(data) });
                            } catch {
                                resolve({ status: res.statusCode, body: data });
                            }
                        });
                    });

                    req.on('error', (err) => { server.close(); reject(err); });

                    if (bodyStr) req.write(bodyStr);
                    req.end();
                });
            });
        }
    };
}

// ============================================
// TESTS
// ============================================

describe('SynchNotify S1', () => {
    let db, taskClient;

    beforeEach(() => {
        db = createMockFirestore();
        taskClient = createMockTaskClient();
        jest.clearAllMocks();
    });

    // ---- Health Endpoints ----

    describe('GET /health', () => {
        it('returns ok status', async () => {
            const app = buildApp(db, taskClient);
            const res = await request(app).send('GET', '/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
        });
    });

    describe('GET /ready', () => {
        it('returns readiness status with firestore check', async () => {
            const app = buildApp(db, taskClient);
            const res = await request(app).send('GET', '/ready');
            // Mock Firestore succeeds, so firestore should be true
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ready');
            expect(res.body.firestore).toBe(true);
        });
    });

    // ---- HMAC Auth ----

    describe('HMAC Authentication', () => {
        it('accepts valid HMAC signature', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(202);
            expect(res.body.received).toBe(true);
            expect(res.body.eventId).toBeDefined();
        });

        it('rejects missing Authorization header', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const timestamp = new Date().toISOString();

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Missing Authorization/);
        });

        it('rejects missing X-Timestamp header', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const signature = makeSignature(new Date().toISOString(), JSON.stringify(event));

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`
            });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Missing Authorization/);
        });

        it('rejects invalid HMAC signature', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const timestamp = new Date().toISOString();

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': 'HMAC-SHA256 invalid-signature-value',
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Invalid HMAC signature/);
        });

        it('rejects expired timestamp (beyond 5-min window)', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 minutes ago
            const rawBody = JSON.stringify(event);
            const signature = makeSignature(staleTimestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': staleTimestamp
            });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/replay window/);
        });
    });

    // ---- Replay Protection Boundary ----

    describe('Replay Protection Boundary', () => {
        it('accepts timestamp at 4m59s (within window)', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            // 4 minutes 59 seconds ago — just inside the 5-minute window
            const borderTimestamp = new Date(Date.now() - (4 * 60 + 59) * 1000).toISOString();
            const rawBody = JSON.stringify(event);
            const signature = makeSignature(borderTimestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': borderTimestamp
            });

            expect(res.status).toBe(202);
        });

        it('rejects timestamp at 5m01s (outside window)', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            // 5 minutes 1 second ago — just outside the 5-minute window
            const staleTimestamp = new Date(Date.now() - (5 * 60 + 1) * 1000).toISOString();
            const rawBody = JSON.stringify(event);
            const signature = makeSignature(staleTimestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': staleTimestamp
            });

            expect(res.status).toBe(401);
        });
    });

    // ---- Event Envelope Validation ----

    describe('Event Envelope Validation', () => {
        function sendSignedEvent(app, event) {
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);
            return request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });
        }

        it('rejects missing tenantId', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent({ tenantId: undefined });
            const res = await sendSignedEvent(app, event);
            expect(res.status).toBe(400);
            expect(res.body.details).toEqual(expect.arrayContaining([
                expect.stringMatching(/tenantId/)
            ]));
        });

        it('rejects invalid eventType', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent({ eventType: 'not_a_real_event' });
            const res = await sendSignedEvent(app, event);
            expect(res.status).toBe(400);
            expect(res.body.details).toEqual(expect.arrayContaining([
                expect.stringMatching(/eventType/)
            ]));
        });

        it('rejects missing source', async () => {
            // Note: missing source will cause HMAC auth to fail with 400 before envelope validation
            const app = buildApp(db, taskClient);
            const event = makeValidEvent({ source: undefined });
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);
            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });
            expect(res.status).toBe(400);
        });

        it('rejects missing idempotencyKey', async () => {
            const app = buildApp(db, taskClient);
            // idempotencyKey is checked in idempotency middleware
            const event = makeValidEvent({ idempotencyKey: undefined });
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);
            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });
            expect(res.status).toBe(400);
        });

        it('rejects invalid priority', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent({ priority: 'ultra' });
            const res = await sendSignedEvent(app, event);
            expect(res.status).toBe(400);
            expect(res.body.details).toEqual(expect.arrayContaining([
                expect.stringMatching(/priority/)
            ]));
        });

        it('accepts valid event and returns 202', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const res = await sendSignedEvent(app, event);
            expect(res.status).toBe(202);
            expect(res.body.received).toBe(true);
            expect(res.body.eventId).toBeDefined();
            expect(res.body.queued).toBe(true);
        });
    });

    // ---- Idempotency ----

    describe('Idempotency', () => {
        it('writes event receipt to Firestore', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(202);

            // Verify eventLog was written
            const scopedKey = `firebase:synchintro:${event.tenantId}:${event.idempotencyKey}`;
            const eventLogData = db._store['eventLog']?.[scopedKey];
            expect(eventLogData).toBeDefined();
            expect(eventLogData.eventId).toBe(res.body.eventId);
            expect(eventLogData.tenantId).toBe(event.tenantId);
        });

        it('returns 202 for duplicate idempotencyKey without re-enqueueing', async () => {
            const idempotencyKey = uuidv4();
            const event = makeValidEvent({ idempotencyKey });
            const scopedKey = `firebase:synchintro:${event.tenantId}:${idempotencyKey}`;

            // Pre-seed the eventLog with this idempotency key
            db._store['eventLog'] = db._store['eventLog'] || {};
            db._store['eventLog'][scopedKey] = {
                eventId: 'original-event-id',
                tenantId: event.tenantId,
                status: 'processed'
            };

            const app = buildApp(db, taskClient);
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(202);
            expect(res.body.duplicate).toBe(true);
            expect(res.body.eventId).toBe('original-event-id');
            // Cloud Tasks should NOT be called for duplicate
            expect(taskClient.createTask).not.toHaveBeenCalled();
        });
    });

    // ---- Cloud Task Enqueueing ----

    describe('Cloud Task Enqueueing', () => {
        it('enqueues Cloud Task for valid event', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = makeSignature(timestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(202);
            expect(res.body.queued).toBe(true);
            expect(taskClient.createTask).toHaveBeenCalledTimes(1);

            // Verify task payload
            const call = taskClient.createTask.mock.calls[0][0];
            expect(call.parent).toBe('projects/test/locations/us/queues/test');
            expect(call.task.httpRequest.url).toBe('http://localhost:8080/internal/deliver');
        });
    });

    // ---- Delivery Worker ----

    describe('Delivery Worker (POST /internal/deliver)', () => {
        it('processes event successfully (S1 no-op)', async () => {
            const app = buildApp(db, taskClient);
            const eventRecord = {
                eventId: uuidv4(),
                scopedKey: 'firebase:synchintro:tenant1:key1',
                tenantId: 'tenant1',
                eventType: 'positive_reply',
                source: 'synchintro'
            };

            // Pre-seed eventLog so update works
            db._store['eventLog'] = db._store['eventLog'] || {};
            db._store['eventLog'][eventRecord.scopedKey] = { ...eventRecord, status: 'received' };

            const res = await request(app).send('POST', '/internal/deliver', eventRecord);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.stub).toBe(true);
        });

        it('rejects request with missing eventId', async () => {
            const app = buildApp(db, taskClient);
            const res = await request(app).send('POST', '/internal/deliver', { foo: 'bar' });
            expect(res.status).toBe(400);
        });
    });

    // ---- Dead Letter Handling ----

    describe('Dead Letter Handling', () => {
        it('writes to deadLetterEvents on max retry failure', async () => {
            const deliveryWorker = require('../src/services/deliveryWorker');

            const eventRecord = {
                eventId: 'dead-letter-test',
                scopedKey: 'firebase:synchintro:tenant1:dead-key',
                tenantId: 'tenant1',
                identitySpace: 'firebase',
                source: 'synchintro',
                eventType: 'positive_reply',
                priority: 'high',
                payload: {}
            };

            // Pre-seed eventLog
            db._store['eventLog'] = db._store['eventLog'] || {};
            db._store['eventLog'][eventRecord.scopedKey] = { ...eventRecord, status: 'received' };

            await deliveryWorker.writeDeadLetter({ db }, eventRecord, 'Simulated failure', 3);

            // Verify deadLetterEvents was written
            const deadLetters = db._store['deadLetterEvents'];
            expect(deadLetters).toBeDefined();
            const entries = Object.values(deadLetters);
            expect(entries.length).toBe(1);
            expect(entries[0].eventId).toBe('dead-letter-test');
            expect(entries[0].failureReason).toBe('Simulated failure');
            expect(entries[0].attemptCount).toBe(3);
            expect(entries[0].resolved).toBe(false);
        });
    });

    // ---- Tenant Resolver ----

    describe('Tenant Resolver', () => {
        it('resolves tenant by tenantId, not merchantCode', async () => {
            const { resolveTenant } = require('../src/utils/tenantResolver');

            const tenantId = 'dehiyRBCXcUUM72O211S27lfXbl1';

            // Seed merchantConfig and users
            db._store['merchantConfig'] = { [tenantId]: { entity360MerchantId: 'e360_123' } };
            db._store['users'] = { [tenantId]: { plan: 'growth' } };

            const result = await resolveTenant({ db }, tenantId, 'firebase');

            expect(result.found).toBe(true);
            expect(result.config.entity360MerchantId).toBe('e360_123');
            expect(result.plan).toBe('growth');
        });

        it('returns starter plan for unknown tenant', async () => {
            const { resolveTenant } = require('../src/utils/tenantResolver');

            const result = await resolveTenant({ db }, 'unknown-uid', 'firebase');

            expect(result.found).toBe(false);
            expect(result.plan).toBe('starter');
        });

        it('resolves plan via subscription.plan priority chain', async () => {
            const { resolveUserPlan } = require('../src/utils/tenantResolver');

            // subscription.plan should take priority over top-level tier
            const mockDoc = {
                exists: true,
                data: () => ({
                    tier: 'FREE',
                    plan: 'starter',
                    subscription: { plan: 'enterprise' }
                })
            };

            expect(resolveUserPlan(mockDoc)).toBe('enterprise');
        });
    });

    // ---- Tier Gating ----

    describe('Tier Gating', () => {
        const { meetsMinTier, getChannelLimit, canReceiveEventType } = require('../src/utils/tierGating');

        it('starter meets starter', () => {
            expect(meetsMinTier('starter', 'starter')).toBe(true);
        });

        it('starter does not meet growth', () => {
            expect(meetsMinTier('starter', 'growth')).toBe(false);
        });

        it('enterprise meets any tier', () => {
            expect(meetsMinTier('enterprise', 'starter')).toBe(true);
            expect(meetsMinTier('enterprise', 'growth')).toBe(true);
            expect(meetsMinTier('enterprise', 'scale')).toBe(true);
            expect(meetsMinTier('enterprise', 'enterprise')).toBe(true);
        });

        it('unknown plan fails closed', () => {
            expect(meetsMinTier('platinum', 'starter')).toBe(false);
        });

        it('returns correct channel limits', () => {
            expect(getChannelLimit('starter')).toBe(1);
            expect(getChannelLimit('growth')).toBe(2);
            expect(getChannelLimit('scale')).toBe(3);
            expect(getChannelLimit('enterprise')).toBe(Infinity);
        });

        it('positive_reply available to all tiers', () => {
            expect(canReceiveEventType('starter', 'positive_reply')).toBe(true);
        });

        it('bounce_spike requires scale+', () => {
            expect(canReceiveEventType('starter', 'bounce_spike')).toBe(false);
            expect(canReceiveEventType('growth', 'bounce_spike')).toBe(false);
            expect(canReceiveEventType('scale', 'bounce_spike')).toBe(true);
            expect(canReceiveEventType('enterprise', 'bounce_spike')).toBe(true);
        });
    });

    // ---- Event Envelope Validation (Unit) ----

    describe('validateEnvelope (unit)', () => {
        const { validateEnvelope } = require('../src/services/eventProcessor');

        it('accepts a valid envelope', () => {
            const result = validateEnvelope(makeValidEvent());
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('rejects null input', () => {
            const result = validateEnvelope(null);
            expect(result.valid).toBe(false);
        });

        it('rejects invalid identitySpace', () => {
            const result = validateEnvelope(makeValidEvent({ identitySpace: 'mongo' }));
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toMatch(/identitySpace/);
        });

        it('rejects non-string timestamp', () => {
            const result = validateEnvelope(makeValidEvent({ timestamp: 12345 }));
            expect(result.valid).toBe(false);
        });

        it('rejects non-ISO timestamp', () => {
            const result = validateEnvelope(makeValidEvent({ timestamp: 'not-a-date' }));
            expect(result.valid).toBe(false);
        });
    });

    // ---- computeSignature utility ----

    describe('computeSignature utility', () => {
        const { computeSignature } = require('../src/middleware/hmacAuth');

        it('produces valid signature that the middleware accepts', async () => {
            const app = buildApp(db, taskClient);
            const event = makeValidEvent();
            const rawBody = JSON.stringify(event);
            const timestamp = new Date().toISOString();
            const signature = computeSignature(SIGNING_KEY, timestamp, rawBody);

            const res = await request(app).send('POST', '/api/v1/events', event, {
                'Authorization': `HMAC-SHA256 ${signature}`,
                'X-Timestamp': timestamp
            });

            expect(res.status).toBe(202);
        });
    });
});
