/**
 * S3 Tests — Instantly Webhook Receiver + Reply Classification
 *
 * Tests:
 * - Webhook auth/security (HMAC, replay, tenant lookup)
 * - Reply classification (positive, negative, ambiguous, edge cases)
 * - Lead enrichment (found, missing, Account360 URL)
 * - Event envelope construction and validation
 * - replyEvents Firestore writes
 * - Delivery worker replyEvents update
 * - End-to-end with mocks
 */

const http = require('http');
const crypto = require('crypto');

// ============================================
// MOCK SETUP
// ============================================

// Mock Firestore
const _firestoreData = {};

function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key] || typeof target[key] !== 'object') target[key] = {};
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}

class MockDocumentReference {
    constructor(collection, id) {
        this._collection = collection;
        this._id = id;
    }
    get id() { return this._id; }
    get path() { return `${this._collection}/${this._id}`; }
    async get() {
        const data = _firestoreData[this._collection]?.[this._id];
        return {
            exists: !!data,
            data: () => data ? JSON.parse(JSON.stringify(data)) : undefined,
            id: this._id,
            ref: this
        };
    }
    async set(data, options) {
        if (!_firestoreData[this._collection]) _firestoreData[this._collection] = {};
        if (options?.merge) {
            _firestoreData[this._collection][this._id] = deepMerge(
                _firestoreData[this._collection][this._id] || {},
                JSON.parse(JSON.stringify(data))
            );
        } else {
            _firestoreData[this._collection][this._id] = JSON.parse(JSON.stringify(data));
        }
    }
    async update(data) {
        if (!_firestoreData[this._collection]) _firestoreData[this._collection] = {};
        if (!_firestoreData[this._collection][this._id]) {
            _firestoreData[this._collection][this._id] = {};
        }
        for (const [key, value] of Object.entries(data)) {
            if (key.includes('.')) {
                setNestedValue(_firestoreData[this._collection][this._id], key, value);
            } else {
                _firestoreData[this._collection][this._id][key] = value;
            }
        }
    }
    collection(name) {
        return new MockCollectionReference(`${this._collection}/${this._id}/${name}`);
    }
}

class MockQuerySnapshot {
    constructor(docs) {
        this.docs = docs;
        this.empty = docs.length === 0;
    }
}

class MockCollectionReference {
    constructor(path) {
        this._path = path;
        this._filters = [];
        this._orderByField = null;
        this._orderByDir = null;
        this._limitCount = null;
    }
    doc(id) {
        const docId = id || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        return new MockDocumentReference(this._path, docId);
    }
    where(field, op, value) {
        const clone = new MockCollectionReference(this._path);
        clone._filters = [...this._filters, { field, op, value }];
        clone._orderByField = this._orderByField;
        clone._orderByDir = this._orderByDir;
        clone._limitCount = this._limitCount;
        return clone;
    }
    orderBy(field, dir) {
        const clone = new MockCollectionReference(this._path);
        clone._filters = [...this._filters];
        clone._orderByField = field;
        clone._orderByDir = dir || 'asc';
        clone._limitCount = this._limitCount;
        return clone;
    }
    limit(count) {
        const clone = new MockCollectionReference(this._path);
        clone._filters = [...this._filters];
        clone._orderByField = this._orderByField;
        clone._orderByDir = this._orderByDir;
        clone._limitCount = count;
        return clone;
    }
    async get() {
        const collectionData = _firestoreData[this._path] || {};
        let docs = Object.entries(collectionData).map(([id, data]) => ({
            id,
            data: () => JSON.parse(JSON.stringify(data)),
            ref: new MockDocumentReference(this._path, id),
            exists: true
        }));

        // Apply filters
        for (const filter of this._filters) {
            docs = docs.filter(doc => {
                const val = doc.data()[filter.field];
                switch (filter.op) {
                    case '==': return val === filter.value;
                    case '!=': return val !== filter.value;
                    default: return true;
                }
            });
        }

        // Apply limit
        if (this._limitCount) {
            docs = docs.slice(0, this._limitCount);
        }

        return new MockQuerySnapshot(docs);
    }
}

const mockDb = {
    collection: (name) => new MockCollectionReference(name),
    runTransaction: async (fn) => {
        const transaction = {
            get: async (ref) => ref.get(),
            set: (ref, data) => ref.set(data),
            update: (ref, data) => ref.update(data)
        };
        return fn(transaction);
    }
};

// Mock Cloud Tasks client
const _enqueuedTasks = [];
const mockTaskClient = {
    createTask: async ({ parent, task }) => {
        _enqueuedTasks.push({ parent, task });
        return [{ name: 'mock-task-name' }];
    }
};

const mockConfig = {
    queuePath: 'projects/test/locations/us-central1/queues/synchnotify',
    serviceUrl: 'http://localhost:8080'
};

// Mock Firebase auth (unused in webhook routes but needed for app startup)
jest.mock('firebase-admin', () => {
    const mockAuth = {
        verifyIdToken: async (token) => {
            if (token === 'valid-token') return { uid: 'tenant-123', email: 'test@test.com' };
            throw new Error('Invalid token');
        }
    };
    return {
        apps: [{}],
        initializeApp: jest.fn(),
        firestore: () => mockDb,
        auth: () => mockAuth,
        credential: { applicationDefault: () => ({}) }
    };
});

jest.mock('@google-cloud/tasks', () => ({
    CloudTasksClient: jest.fn().mockImplementation(() => mockTaskClient)
}));

jest.mock('@google-cloud/secret-manager', () => ({
    SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
        accessSecretVersion: async () => [{ payload: { data: Buffer.from('xoxb-test-token') } }]
    }))
}));

// Set env vars before requiring app
process.env.SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO = 'test-signing-key-synchintro';
process.env.CLOUD_TASKS_QUEUE_PATH = mockConfig.queuePath;

// ============================================
// HELPERS
// ============================================

const TENANT_ID = 'tenant-abc123';
const WEBHOOK_SECRET = 'test-webhook-secret-hex-value-for-hmac';
const TEST_EMAIL = 'jane@acmecorp.com';

function setupTenantConfig(overrides = {}) {
    if (!_firestoreData.merchantConfig) _firestoreData.merchantConfig = {};
    _firestoreData.merchantConfig[TENANT_ID] = {
        instantlyWebhookSecret: WEBHOOK_SECRET,
        merchantCode: '56B8DE',
        notificationPrefs: {
            providers: {
                slack: {
                    connected: true,
                    enabled: true,
                    channels: {
                        C07TEST: {
                            channelId: 'C07TEST',
                            channelName: '#test-channel',
                            events: ['positive_reply'],
                            active: true,
                            healthStatus: 'healthy',
                            consecutiveFailures: 0
                        }
                    }
                }
            }
        },
        ...overrides
    };
}

function clearFirestore() {
    for (const key of Object.keys(_firestoreData)) {
        delete _firestoreData[key];
    }
    _enqueuedTasks.length = 0;
}

function computeSignature(secret, timestamp, body) {
    const payload = timestamp + '.' + body;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildWebhookRequest(body, options = {}) {
    const timestamp = options.timestamp || new Date().toISOString();
    const rawBody = JSON.stringify(body);
    const signature = options.signature || computeSignature(WEBHOOK_SECRET, timestamp, rawBody);

    return {
        method: 'POST',
        path: `/api/v1/webhooks/instantly/${options.tenantId || TENANT_ID}`,
        headers: {
            'Content-Type': 'application/json',
            'X-PathSynch-Signature': signature,
            'X-PathSynch-Timestamp': timestamp,
            ...(options.webhookId ? { 'X-PathSynch-Webhook-Id': options.webhookId } : {})
        },
        body: rawBody
    };
}

// HTTP test helper
let server;
let serverPort;

function makeRequest(options) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: serverPort,
            path: options.path,
            method: options.method || 'POST',
            headers: options.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================
// TEST SUITES
// ============================================

describe('S3 — Instantly Webhook Receiver', () => {
    beforeAll((done) => {
        const { app } = require('../src/index');
        server = app.listen(0, () => {
            serverPort = server.address().port;
            done();
        });
    });

    afterAll((done) => {
        server.close(done);
    });

    beforeEach(() => {
        clearFirestore();
        setupTenantConfig();
    });

    // ========================================
    // WEBHOOK AUTH / SECURITY
    // ========================================
    describe('Webhook Auth & Security', () => {
        const validBody = {
            email: TEST_EMAIL,
            reply_text: 'I am interested in your services',
            campaign_name: 'Atlanta Q3'
        };

        test('valid HMAC accepted — returns 200', async () => {
            const req = buildWebhookRequest(validBody);
            const res = await makeRequest(req);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('invalid HMAC rejected — returns 401', async () => {
            const req = buildWebhookRequest(validBody, { signature: 'bad-signature' });
            const res = await makeRequest(req);
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Invalid webhook signature/);
        });

        test('missing HMAC rejected — returns 401', async () => {
            const timestamp = new Date().toISOString();
            const res = await makeRequest({
                method: 'POST',
                path: `/api/v1/webhooks/instantly/${TENANT_ID}`,
                headers: {
                    'Content-Type': 'application/json',
                    'X-PathSynch-Timestamp': timestamp
                    // No X-PathSynch-Signature
                },
                body: JSON.stringify(validBody)
            });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Missing/);
        });

        test('stale timestamp rejected — returns 401', async () => {
            const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 mins ago
            const rawBody = JSON.stringify(validBody);
            const sig = computeSignature(WEBHOOK_SECRET, staleTimestamp, rawBody);
            const res = await makeRequest({
                method: 'POST',
                path: `/api/v1/webhooks/instantly/${TENANT_ID}`,
                headers: {
                    'Content-Type': 'application/json',
                    'X-PathSynch-Signature': sig,
                    'X-PathSynch-Timestamp': staleTimestamp
                },
                body: rawBody
            });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/replay window/);
        });

        test('missing tenantId rejected — returns 404 (no route match)', async () => {
            const res = await makeRequest({
                method: 'POST',
                path: '/api/v1/webhooks/instantly/',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(validBody)
            });
            // Express returns 404 for missing path param
            expect([400, 404]).toContain(res.status);
        });

        test('unknown tenantId rejected — returns 401', async () => {
            const unknownTenant = 'unknown-tenant-xyz';
            const timestamp = new Date().toISOString();
            const rawBody = JSON.stringify(validBody);
            const sig = computeSignature(WEBHOOK_SECRET, timestamp, rawBody);
            const res = await makeRequest({
                method: 'POST',
                path: `/api/v1/webhooks/instantly/${unknownTenant}`,
                headers: {
                    'Content-Type': 'application/json',
                    'X-PathSynch-Signature': sig,
                    'X-PathSynch-Timestamp': timestamp
                },
                body: rawBody
            });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/Unknown tenantId/);
        });

        test('missing merchant webhook secret rejected — returns 401', async () => {
            // Set up tenant without webhook secret
            _firestoreData.merchantConfig[TENANT_ID] = { merchantCode: '56B8DE' };
            const req = buildWebhookRequest(validBody);
            const res = await makeRequest(req);
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/No webhook secret/);
        });

        test('duplicate webhook receipt returns 200 and does not enqueue duplicate event', async () => {
            const webhookId = 'unique-webhook-id-123';

            // First request
            const req1 = buildWebhookRequest(
                { ...validBody, reply_text: 'I am interested' },
                { webhookId }
            );
            const res1 = await makeRequest(req1);
            expect(res1.status).toBe(200);
            expect(res1.body.success).toBe(true);
            expect(res1.body.duplicate).toBeUndefined();

            const tasksAfterFirst = _enqueuedTasks.length;

            // Second request (duplicate)
            const req2 = buildWebhookRequest(
                { ...validBody, reply_text: 'I am interested' },
                { webhookId }
            );
            const res2 = await makeRequest(req2);
            expect(res2.status).toBe(200);
            expect(res2.body.duplicate).toBe(true);

            // No new task enqueued
            expect(_enqueuedTasks.length).toBe(tasksAfterFirst);
        });
    });

    // ========================================
    // CLASSIFICATION
    // ========================================
    describe('Reply Classification', () => {
        const { classifyReply, POSITIVE_INDICATORS, NEGATIVE_INDICATORS } = require('../src/services/replyClassifier');

        test.each(POSITIVE_INDICATORS.filter(p => !['call', 'yes'].includes(p)))(
            'positive indicator "%s" classified as positive',
            (indicator) => {
                const result = classifyReply(`Hi, ${indicator} please!`);
                expect(result.classification).toBe('positive');
                expect(result.positiveMatches).toContain(indicator);
            }
        );

        test('broad positive "call" classified positive in affirmative context', () => {
            const result = classifyReply('Please give me a call');
            expect(result.classification).toBe('positive');
        });

        test('broad positive "yes" classified positive in affirmative context', () => {
            const result = classifyReply('Yes, I would like to learn more');
            expect(result.classification).toBe('positive');
        });

        test.each(NEGATIVE_INDICATORS)(
            'negative indicator "%s" classified as negative',
            (indicator) => {
                const result = classifyReply(indicator);
                expect(result.classification).toBe('negative');
                expect(result.negativeMatches.length).toBeGreaterThan(0);
            }
        );

        test('classification is case-insensitive', () => {
            const result = classifyReply('I AM INTERESTED IN PRICING');
            expect(result.classification).toBe('positive');
        });

        test('ambiguous reply classified ambiguous', () => {
            const result = classifyReply('Thanks for the email');
            expect(result.classification).toBe('ambiguous');
        });

        test('negative wins over positive when both appear', () => {
            const result = classifyReply('I am interested but please unsubscribe me');
            expect(result.classification).toBe('negative');
        });

        test('"do not call" does not classify as positive', () => {
            const result = classifyReply('Please do not call me');
            expect(result.classification).toBe('negative');
        });

        test('"don\'t call" does not classify as positive', () => {
            const result = classifyReply("Don't call me again");
            expect(result.classification).toBe('negative');
        });

        test('empty text classified as ambiguous', () => {
            const result = classifyReply('');
            expect(result.classification).toBe('ambiguous');
        });

        test('null text classified as ambiguous', () => {
            const result = classifyReply(null);
            expect(result.classification).toBe('ambiguous');
        });
    });

    // ========================================
    // LEAD ENRICHMENT
    // ========================================
    describe('Lead Enrichment', () => {
        const { enrichLead } = require('../src/services/leadEnrichment');

        test('enrichment found and mapped into result', async () => {
            // Seed prospectIntel data
            _firestoreData['prospectIntel'] = {
                'batch-1': { userId: TENANT_ID, createdAt: '2026-06-01' }
            };
            _firestoreData['prospectIntel/batch-1/prospects'] = {
                'prospect-1': {
                    email: TEST_EMAIL,
                    businessName: 'Acme Corp',
                    contactName: 'Jane Doe',
                    industry: 'Technology',
                    fitScore: 85,
                    signalHits: ['low_rating', 'incomplete_gbp']
                }
            };

            const result = await enrichLead({ db: mockDb }, TENANT_ID, TEST_EMAIL);
            expect(result.companyName).toBe('Acme Corp');
            expect(result.contactName).toBe('Jane Doe');
            expect(result.industry).toBe('Technology');
            expect(result.fitScore).toBe(85);
            expect(result.buyingSignals).toEqual(['low_rating', 'incomplete_gbp']);
        });

        test('enrichment missing handled gracefully', async () => {
            const result = await enrichLead({ db: mockDb }, TENANT_ID, 'nobody@unknown.com');
            expect(result.contactEmail).toBe('nobody@unknown.com');
            expect(result.companyName).toBeNull();
            expect(result.fitScore).toBeNull();
            expect(result.buyingSignals).toEqual([]);
        });

        test('Account360 URL built only when accountId exists', async () => {
            // Seed Account360 data
            _firestoreData['Account360'] = {
                [`${TENANT_ID}:acmecorp.com`]: {
                    companyName: { value: 'Acme Corp' },
                    industry: { value: 'Technology' },
                    intentSignals: { currentScore: 78 }
                }
            };

            const result = await enrichLead({ db: mockDb }, TENANT_ID, TEST_EMAIL);
            expect(result.accountId).toBe(`${TENANT_ID}:acmecorp.com`);
            expect(result.account360Url).toBe(`https://app.pathsynch.com/account360/${TENANT_ID}:acmecorp.com`);
        });

        test('generic email domain skips Account360 lookup', async () => {
            const result = await enrichLead({ db: mockDb }, TENANT_ID, 'user@gmail.com');
            expect(result.accountId).toBeNull();
            expect(result.account360Url).toBeNull();
        });
    });

    // ========================================
    // EVENT ENVELOPE
    // ========================================
    describe('Event Envelope Construction', () => {
        test('positive reply constructs valid event envelope', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'I am interested in your demo',
                campaign_name: 'Atlanta Q3'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);
            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('positive');
            expect(res.body.eventEmitted).toBe(true);

            // Verify event was enqueued
            expect(_enqueuedTasks.length).toBeGreaterThan(0);
        });

        test('event envelope validates against S1 schema', async () => {
            const { validateEnvelope } = require('../src/services/eventProcessor');

            const envelope = {
                tenantId: TENANT_ID,
                identitySpace: 'firebase',
                merchantCode: '56B8DE',
                source: 'synchintro',
                eventType: 'positive_reply',
                priority: 'high',
                payload: {
                    replyEventId: 'test-reply-id',
                    companyName: 'Test Corp',
                    contactEmail: TEST_EMAIL,
                    replySnippet: 'Interested',
                    campaignName: 'Test Campaign',
                    receivedAt: new Date().toISOString()
                },
                timestamp: new Date().toISOString(),
                idempotencyKey: 'instantly-reply:test-hash',
                version: '1.0'
            };

            const result = validateEnvelope(envelope);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('includes identitySpace firebase', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Tell me more about pricing',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            await makeRequest(req);

            // Check the enqueued task contains identitySpace: firebase
            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            if (lastTask) {
                const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
                expect(taskBody.identitySpace).toBe('firebase');
            }
        });

        test('includes replyEventId in payload', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'I am interested',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);
            expect(res.body.replyEventId).toBeDefined();

            // Verify replyEventId in enqueued task payload
            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            if (lastTask) {
                const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
                expect(taskBody.payload.replyEventId).toBeDefined();
            }
        });

        test('uses source synchintro', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Schedule a demo',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            await makeRequest(req);

            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            if (lastTask) {
                const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
                expect(taskBody.source).toBe('synchintro');
            }
        });

        test('uses eventType positive_reply', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Absolutely interested',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            await makeRequest(req);

            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            if (lastTask) {
                const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
                expect(taskBody.eventType).toBe('positive_reply');
            }
        });

        test('uses priority high', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Sounds good',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            await makeRequest(req);

            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            if (lastTask) {
                const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
                expect(taskBody.priority).toBe('high');
            }
        });
    });

    // ========================================
    // REPLY EVENTS
    // ========================================
    describe('replyEvents Collection', () => {
        test('positive reply writes replyEvents document', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'I am definitely interested',
                campaign_name: 'Atlanta Q3'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.status).toBe(200);
            expect(res.body.replyEventId).toBeDefined();

            // Verify replyEvents document
            const replyEvents = _firestoreData.replyEvents || {};
            const replyDocs = Object.values(replyEvents);
            expect(replyDocs.length).toBeGreaterThan(0);

            const doc = replyDocs[0];
            expect(doc.tenantId).toBe(TENANT_ID);
            expect(doc.leadEmail).toBe(TEST_EMAIL);
            expect(doc.replyClassification).toBe('positive');
            expect(doc.source).toBe('instantly');
            expect(doc.webhookReceivedAt).toBeDefined();
            expect(doc.synchNotifyEventId).toBeDefined();
            expect(doc.slackNotificationSentAt).toBeNull();
            expect(doc.attioUpdatedAt).toBeNull();
            expect(doc.claimedBy).toBeNull();
        });

        test('negative reply writes replyEvents document but does not enqueue event', async () => {
            const tasksBeforeCount = _enqueuedTasks.length;
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Please unsubscribe me from this list',
                campaign_name: 'Atlanta Q3'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('negative');
            expect(res.body.eventEmitted).toBe(false);
            expect(res.body.slackSkipped).toBe(true);

            // Verify replyEvents written
            const replyEvents = _firestoreData.replyEvents || {};
            const replyDocs = Object.values(replyEvents);
            const negDoc = replyDocs.find(d => d.replyClassification === 'negative');
            expect(negDoc).toBeDefined();
            expect(negDoc.synchNotifyEventId).toBeNull();

            // No new task enqueued
            expect(_enqueuedTasks.length).toBe(tasksBeforeCount);
        });

        test('ambiguous reply writes replyEvents document but does not enqueue event', async () => {
            const tasksBeforeCount = _enqueuedTasks.length;
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Ok thanks for the info',
                campaign_name: 'Atlanta Q3'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('ambiguous');
            expect(res.body.eventEmitted).toBe(false);

            // Verify replyEvents written
            const replyEvents = _firestoreData.replyEvents || {};
            const replyDocs = Object.values(replyEvents);
            const ambDoc = replyDocs.find(d => d.replyClassification === 'ambiguous');
            expect(ambDoc).toBeDefined();
        });

        test('synchNotifyEventId stored for positive event', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'How much does it cost?',
                campaign_name: 'Test'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.body.classification).toBe('positive');

            const replyEvents = _firestoreData.replyEvents || {};
            const doc = Object.values(replyEvents).find(d => d.replyClassification === 'positive');
            expect(doc.synchNotifyEventId).toBeTruthy();
        });

        test('duplicate webhook does not create duplicate replyEvents', async () => {
            const webhookId = 'dedup-test-id';
            const body = {
                email: TEST_EMAIL,
                reply_text: 'I am interested',
                campaign_name: 'Test'
            };

            // First
            await makeRequest(buildWebhookRequest(body, { webhookId }));
            const countAfterFirst = Object.keys(_firestoreData.replyEvents || {}).length;

            // Second (duplicate)
            await makeRequest(buildWebhookRequest(body, { webhookId }));
            const countAfterSecond = Object.keys(_firestoreData.replyEvents || {}).length;

            expect(countAfterSecond).toBe(countAfterFirst);
        });
    });

    // ========================================
    // DELIVERY WORKER UPDATE
    // ========================================
    describe('Delivery Worker — replyEvents Update', () => {
        const deliveryWorker = require('../src/services/deliveryWorker');
        const slackProvider = require('../src/providers/slack/slackProvider');

        beforeEach(() => {
            slackProvider.setBotToken('xoxb-test-token');
        });

        test('successful Slack delivery updates slackNotificationSentAt', async () => {
            const replyEventId = 'reply-event-for-update';
            // Seed replyEvents document
            if (!_firestoreData.replyEvents) _firestoreData.replyEvents = {};
            _firestoreData.replyEvents[replyEventId] = {
                tenantId: TENANT_ID,
                leadEmail: TEST_EMAIL,
                slackNotificationSentAt: null,
                updatedAt: '2026-06-01'
            };

            const eventRecord = {
                eventId: 'evt-123',
                scopedKey: 'firebase:synchintro:tenant-abc123:test-key',
                tenantId: TENANT_ID,
                eventType: 'positive_reply',
                source: 'synchintro',
                payload: {
                    replyEventId,
                    companyName: 'Test Corp',
                    contactEmail: TEST_EMAIL,
                    replySnippet: 'Interested',
                    campaignName: 'Test'
                }
            };

            // Seed eventLog
            if (!_firestoreData.eventLog) _firestoreData.eventLog = {};
            _firestoreData.eventLog[eventRecord.scopedKey] = { status: 'received' };

            // Mock Slack delivery
            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = async () => ({
                sent: true, channelId: 'C07TEST', ts: '1234567890.123'
            });

            try {
                await deliveryWorker.processEvent({ db: mockDb }, eventRecord);

                // Verify replyEvents updated
                const replyDoc = _firestoreData.replyEvents[replyEventId];
                expect(replyDoc.slackNotificationSentAt).toBeDefined();
                expect(replyDoc.slackNotificationSentAt).not.toBeNull();
                expect(replyDoc.updatedAt).not.toBe('2026-06-01');
            } finally {
                slackProvider.deliver = originalDeliver;
            }
        });

        test('missing replyEventId does not fail delivery', async () => {
            const eventRecord = {
                eventId: 'evt-no-reply',
                scopedKey: 'firebase:synchintro:tenant-abc123:no-reply-key',
                tenantId: TENANT_ID,
                eventType: 'positive_reply',
                source: 'synchintro',
                payload: {
                    // No replyEventId
                    companyName: 'Test Corp',
                    contactEmail: TEST_EMAIL
                }
            };

            if (!_firestoreData.eventLog) _firestoreData.eventLog = {};
            _firestoreData.eventLog[eventRecord.scopedKey] = { status: 'received' };

            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = async () => ({
                sent: true, channelId: 'C07TEST', ts: '1234567890.456'
            });

            try {
                const result = await deliveryWorker.processEvent({ db: mockDb }, eventRecord);
                expect(result.delivered).toBe(true);
            } finally {
                slackProvider.deliver = originalDeliver;
            }
        });

        test('Slack failure does not update slackNotificationSentAt', async () => {
            const replyEventId = 'reply-event-slack-fail';
            if (!_firestoreData.replyEvents) _firestoreData.replyEvents = {};
            _firestoreData.replyEvents[replyEventId] = {
                tenantId: TENANT_ID,
                slackNotificationSentAt: null
            };

            const eventRecord = {
                eventId: 'evt-fail',
                scopedKey: 'firebase:synchintro:tenant-abc123:fail-key',
                tenantId: TENANT_ID,
                eventType: 'positive_reply',
                source: 'synchintro',
                payload: { replyEventId, companyName: 'Test' }
            };

            if (!_firestoreData.eventLog) _firestoreData.eventLog = {};
            _firestoreData.eventLog[eventRecord.scopedKey] = { status: 'received' };

            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = async () => ({
                sent: false, reason: 'channel_not_found', statusCode: 200
            });

            try {
                await expect(deliveryWorker.processEvent({ db: mockDb }, eventRecord))
                    .rejects.toThrow(/All Slack deliveries failed/);

                // slackNotificationSentAt should still be null
                expect(_firestoreData.replyEvents[replyEventId].slackNotificationSentAt).toBeNull();
            } finally {
                slackProvider.deliver = originalDeliver;
            }
        });
    });

    // ========================================
    // END-TO-END WITH MOCKS
    // ========================================
    describe('End-to-End Flow', () => {
        test('positive reply -> replyEvents -> event enqueue -> delivery worker calls SlackProvider', async () => {
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Absolutely, lets talk about pricing!',
                campaign_name: 'Atlanta Q3 Outbound'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            // 1. Webhook returns 200 with positive classification
            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('positive');
            expect(res.body.eventEmitted).toBe(true);
            expect(res.body.replyEventId).toBeDefined();

            // 2. replyEvents document written
            const replyEvents = _firestoreData.replyEvents || {};
            const replyDoc = Object.values(replyEvents).find(d =>
                d.leadEmail === TEST_EMAIL && d.replyClassification === 'positive'
            );
            expect(replyDoc).toBeDefined();
            expect(replyDoc.campaignName).toBe('Atlanta Q3 Outbound');
            expect(replyDoc.source).toBe('instantly');

            // 3. Event enqueued via Cloud Tasks
            expect(_enqueuedTasks.length).toBeGreaterThan(0);
            const lastTask = _enqueuedTasks[_enqueuedTasks.length - 1];
            const taskBody = JSON.parse(Buffer.from(lastTask.task.httpRequest.body, 'base64').toString());
            expect(taskBody.eventType).toBe('positive_reply');
            expect(taskBody.source).toBe('synchintro');
            expect(taskBody.priority).toBe('high');
            expect(taskBody.payload.replyEventId).toBeDefined();
            expect(taskBody.payload.campaignName).toBe('Atlanta Q3 Outbound');
        });

        test('negative reply -> replyEvents -> no Slack', async () => {
            const tasksBeforeCount = _enqueuedTasks.length;
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Not interested, please remove me',
                campaign_name: 'Atlanta Q3'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('negative');
            expect(res.body.slackSkipped).toBe(true);

            // replyEvents written
            const replyEvents = _firestoreData.replyEvents || {};
            expect(Object.values(replyEvents).some(d => d.replyClassification === 'negative')).toBe(true);

            // No event enqueued
            expect(_enqueuedTasks.length).toBe(tasksBeforeCount);
        });

        test('ambiguous reply -> replyEvents -> no Slack', async () => {
            const tasksBeforeCount = _enqueuedTasks.length;
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Thank you for reaching out',
                campaign_name: 'Test Campaign'
            };
            const req = buildWebhookRequest(body);
            const res = await makeRequest(req);

            expect(res.status).toBe(200);
            expect(res.body.classification).toBe('ambiguous');
            expect(res.body.slackSkipped).toBe(true);
            expect(_enqueuedTasks.length).toBe(tasksBeforeCount);
        });

        test('valid webhook returns 200 before mocked Slack delivery completes', async () => {
            // The webhook should return 200 immediately — Slack delivery happens
            // asynchronously via Cloud Tasks, not in the webhook handler
            const body = {
                email: TEST_EMAIL,
                reply_text: 'Sign me up for a demo',
                campaign_name: 'Fast Response Test'
            };
            const req = buildWebhookRequest(body);
            const start = Date.now();
            const res = await makeRequest(req);
            const elapsed = Date.now() - start;

            expect(res.status).toBe(200);
            expect(res.body.eventEmitted).toBe(true);
            // Webhook should respond quickly (no Slack wait)
            // The Cloud Task enqueue is the only async operation
            expect(elapsed).toBeLessThan(5000);
        });
    });

    // ========================================
    // WEBHOOK AUTH UTILITY
    // ========================================
    describe('Webhook Auth Utility', () => {
        const { computeWebhookSignature } = require('../src/middleware/webhookAuth');

        test('computeWebhookSignature produces valid HMAC', () => {
            const secret = 'my-secret';
            const timestamp = '2026-06-18T12:00:00Z';
            const body = '{"email":"test@test.com"}';

            const sig = computeWebhookSignature(secret, timestamp, body);
            expect(sig).toHaveLength(64); // SHA-256 hex
            expect(sig).toMatch(/^[a-f0-9]{64}$/);

            // Same inputs produce same signature
            const sig2 = computeWebhookSignature(secret, timestamp, body);
            expect(sig).toBe(sig2);
        });
    });

    // ========================================
    // SAFE SNIPPET
    // ========================================
    describe('Safe Snippet', () => {
        const { safeSnippet } = require('../src/services/replyClassifier');

        test('truncates long text', () => {
            const longText = 'A'.repeat(300);
            const snippet = safeSnippet(longText, 200);
            expect(snippet.length).toBe(200);
            expect(snippet.endsWith('...')).toBe(true);
        });

        test('preserves short text', () => {
            const short = 'Hello world';
            expect(safeSnippet(short)).toBe('Hello world');
        });

        test('handles null/undefined', () => {
            expect(safeSnippet(null)).toBe('');
            expect(safeSnippet(undefined)).toBe('');
        });
    });
});
