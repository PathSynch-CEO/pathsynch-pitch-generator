/**
 * SynchNotify S2 Tests — Slack Provider + Config CRUD + Delivery Worker
 *
 * Covers:
 * - Block Kit formatting for positive_reply
 * - Fit score color mapping
 * - Slack delivery (mocked)
 * - Config CRUD endpoints
 * - Tier gating for channel limits
 * - Delivery worker routing to Slack
 * - NotificationLog writes
 * - Channel health updates
 */

const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ============================================
// MOCK FIRESTORE (shared with S1 tests)
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
                                data: () => data ? { ...data } : undefined,
                                id: docId
                            };
                        }),
                        set: jest.fn(async (val, options) => {
                            if (options?.merge) {
                                const existing = getCollection(name)[docId] || {};
                                getCollection(name)[docId] = deepMerge(existing, val);
                            } else {
                                getCollection(name)[docId] = val;
                            }
                        }),
                        update: jest.fn(async (val) => {
                            const existing = getCollection(name)[docId] || {};
                            // Handle dot-notation paths
                            for (const [key, value] of Object.entries(val)) {
                                if (key.includes('.')) {
                                    setNestedValue(existing, key, value);
                                } else {
                                    existing[key] = value;
                                }
                            }
                            getCollection(name)[docId] = existing;
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

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

// ============================================
// MOCK AUTH
// ============================================

function createMockAuth(defaultUid = 'test-tenant-uid') {
    return {
        verifyIdToken: jest.fn(async (token) => {
            if (token === 'invalid-token') throw new Error('Invalid token');
            if (token === 'other-tenant-token') return { uid: 'other-tenant-uid', email: 'other@test.com' };
            return { uid: defaultUid, email: 'test@test.com' };
        })
    };
}

// ============================================
// HTTP HELPER
// ============================================

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

function buildConfigApp(db, mockAuth) {
    const { configRoutes } = require('../src/routes/configRoutes');
    const { firebaseAuth } = require('../src/middleware/firebaseAuth');

    const app = express();
    app.use(express.json());
    app.use(configRoutes({
        db,
        authMiddleware: firebaseAuth({ auth: mockAuth })
    }));
    return app;
}

// ============================================
// TESTS
// ============================================

describe('SynchNotify S2', () => {
    let db;

    beforeEach(() => {
        db = createMockFirestore();
        jest.clearAllMocks();
    });

    // ---- Slack Message Formatting ----

    describe('Slack Message Formatting', () => {
        const { formatMessage } = require('../src/providers/slack/slackProvider');

        const fullPayload = {
            companyName: 'Acme Corp',
            contactName: 'John Doe',
            contactEmail: 'john@acme.com',
            industry: 'SaaS',
            buyingSignals: ['Budget approved', 'Timeline: Q3'],
            fitScore: 87,
            replySnippet: 'Yes, I would love to schedule a demo!',
            campaignName: 'Q3 Outbound',
            account360Url: 'https://app.pathsynch.com/account360/abc123',
            receivedAt: '2026-06-18T12:00:00Z'
        };

        it('produces valid JSON Block Kit output for positive_reply', () => {
            const result = formatMessage('positive_reply', fullPayload);
            expect(result).toBeDefined();
            expect(result.blocks).toBeInstanceOf(Array);
            expect(result.blocks.length).toBeGreaterThan(0);
            expect(result.text).toBeDefined();
            // Verify JSON serializable
            const json = JSON.stringify(result);
            expect(JSON.parse(json)).toEqual(result);
        });

        it('includes all required fields when payload is complete', () => {
            const result = formatMessage('positive_reply', fullPayload);
            const blocksStr = JSON.stringify(result.blocks);

            expect(blocksStr).toContain('Acme Corp');
            expect(blocksStr).toContain('John Doe');
            expect(blocksStr).toContain('john@acme.com');
            expect(blocksStr).toContain('SaaS');
            expect(blocksStr).toContain('Budget approved');
            expect(blocksStr).toContain('87');
            expect(blocksStr).toContain('demo');
            expect(blocksStr).toContain('Q3 Outbound');
            expect(blocksStr).toContain('account360');
        });

        it('handles missing optional fields gracefully', () => {
            const result = formatMessage('positive_reply', {
                companyName: 'Minimal Corp'
            });
            expect(result.blocks).toBeInstanceOf(Array);
            expect(result.blocks.length).toBeGreaterThan(0);
            // Should have header at minimum
            expect(result.blocks[0].type).toBe('header');
        });

        it('truncates reply snippet safely at 200 chars', () => {
            const longReply = 'A'.repeat(250);
            const result = formatMessage('positive_reply', {
                companyName: 'Test',
                replySnippet: longReply
            });
            const snippetBlock = result.blocks.find(b =>
                b.type === 'section' && b.text?.text?.startsWith('>')
            );
            expect(snippetBlock).toBeDefined();
            // 200 char limit: 197 chars + '...' = shown text <= ~202 with '> ' prefix
            expect(snippetBlock.text.text.length).toBeLessThanOrEqual(205);
        });

        it('includes Account360 button only when URL exists', () => {
            const withUrl = formatMessage('positive_reply', {
                companyName: 'Test',
                account360Url: 'https://app.pathsynch.com/account360/abc'
            });
            const actionsBlock = withUrl.blocks.find(b => b.type === 'actions');
            expect(actionsBlock).toBeDefined();
            expect(actionsBlock.elements[0].url).toBe('https://app.pathsynch.com/account360/abc');

            const withoutUrl = formatMessage('positive_reply', {
                companyName: 'Test'
            });
            const noActions = withoutUrl.blocks.find(b => b.type === 'actions');
            expect(noActions).toBeUndefined();
        });

        it('handles unknown event type with fallback', () => {
            const result = formatMessage('unknown_type', {});
            expect(result.blocks).toBeInstanceOf(Array);
            expect(result.text).toContain('unknown_type');
        });
    });

    // ---- Fit Score ----

    describe('Fit Score Mapping', () => {
        const { getFitScoreEmoji, getFitScoreLabel } = require('../src/providers/slack/slackProvider');

        it('80+ maps to green', () => {
            expect(getFitScoreEmoji(80)).toBe(':large_green_circle:');
            expect(getFitScoreEmoji(95)).toBe(':large_green_circle:');
            expect(getFitScoreLabel(80)).toBe('Strong Fit');
        });

        it('60-79 maps to yellow/amber', () => {
            expect(getFitScoreEmoji(60)).toBe(':large_yellow_circle:');
            expect(getFitScoreEmoji(79)).toBe(':large_yellow_circle:');
            expect(getFitScoreLabel(60)).toBe('Moderate Fit');
        });

        it('below 60 maps to red', () => {
            expect(getFitScoreEmoji(59)).toBe(':red_circle:');
            expect(getFitScoreEmoji(0)).toBe(':red_circle:');
            expect(getFitScoreLabel(59)).toBe('Weak Fit');
        });

        it('missing score maps to neutral/unknown', () => {
            expect(getFitScoreEmoji(null)).toBe(':white_circle:');
            expect(getFitScoreEmoji(undefined)).toBe(':white_circle:');
            expect(getFitScoreLabel(null)).toBe('Unknown');
        });
    });

    // ---- Slack Delivery ----

    describe('Slack Delivery', () => {
        const slackProvider = require('../src/providers/slack/slackProvider');

        beforeEach(() => {
            slackProvider.clearBotTokenCache();
        });

        it('returns sent:true on successful Slack API call', async () => {
            slackProvider.setBotToken('xoxb-test-token');
            const result = await slackProvider.deliver(
                { channelId: 'C123456' },
                { text: 'Test', blocks: [] },
                {
                    httpPost: jest.fn(async () => ({
                        ok: true,
                        ts: '1234567890.123456'
                    }))
                }
            );

            expect(result.sent).toBe(true);
            expect(result.channelId).toBe('C123456');
            expect(result.ts).toBe('1234567890.123456');
        });

        it('returns sent:false on Slack API failure', async () => {
            slackProvider.setBotToken('xoxb-test-token');
            const result = await slackProvider.deliver(
                { channelId: 'C123456' },
                { text: 'Test', blocks: [] },
                {
                    httpPost: jest.fn(async () => ({
                        ok: false,
                        error: 'channel_not_found',
                        statusCode: 200
                    }))
                }
            );

            expect(result.sent).toBe(false);
            expect(result.reason).toBe('channel_not_found');
        });

        it('returns sent:false when bot token is unavailable', async () => {
            slackProvider.clearBotTokenCache();
            // No token set, no env var, no Secret Manager
            const result = await slackProvider.deliver(
                { channelId: 'C123456' },
                { text: 'Test', blocks: [] },
                { botToken: null }
            );

            // Will try getBotToken which returns null
            expect(result.sent).toBe(false);
            expect(result.reason).toContain('bot token');
        });

        it('does not expose bot token in result', async () => {
            slackProvider.setBotToken('xoxb-secret-token');
            const result = await slackProvider.deliver(
                { channelId: 'C123456' },
                { text: 'Test', blocks: [] },
                {
                    httpPost: jest.fn(async () => ({ ok: true, ts: '123' }))
                }
            );

            const resultStr = JSON.stringify(result);
            expect(resultStr).not.toContain('xoxb-secret-token');
        });

        it('returns sent:false when channelId is missing', async () => {
            const result = await slackProvider.deliver(
                {},
                { text: 'Test', blocks: [] }
            );
            expect(result.sent).toBe(false);
            expect(result.reason).toContain('channelId');
        });
    });

    // ---- Config CRUD ----

    describe('Config CRUD Endpoints', () => {
        const TENANT_ID = 'test-tenant-uid';
        let mockAuth;

        beforeEach(() => {
            mockAuth = createMockAuth(TENANT_ID);
            // Seed users collection for tier resolution
            db._store['users'] = { [TENANT_ID]: { plan: 'growth' } };
        });

        describe('POST /api/v1/config/slack/connect', () => {
            it('saves channel config', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/connect', {
                    channelId: 'C07ABC123',
                    channelName: '#feed-positive-replies',
                    events: ['positive_reply']
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.channel.channelId).toBe('C07ABC123');
                expect(res.body.totalChannels).toBe(1);

                // Verify Firestore write
                const config = db._store['merchantConfig']?.[TENANT_ID];
                expect(config.notificationPrefs.providers.slack.connected).toBe(true);
                expect(config.notificationPrefs.providers.slack.channels['C07ABC123']).toBeDefined();
            });

            it('rejects missing channelId', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/connect', {
                    channelName: '#test'
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('channelId');
            });

            it('rejects unsupported event type', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/connect', {
                    channelId: 'C123',
                    events: ['positive_reply', 'bounce_spike']
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('bounce_spike');
            });

            it('enforces channel limit per tier (growth = 2)', async () => {
                // Pre-seed 2 channels
                db._store['merchantConfig'] = {
                    [TENANT_ID]: {
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    channels: {
                                        'C001': { channelId: 'C001', events: ['positive_reply'], active: true },
                                        'C002': { channelId: 'C002', events: ['positive_reply'], active: true }
                                    }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/connect', {
                    channelId: 'C003',
                    events: ['positive_reply']
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(403);
                expect(res.body.error).toContain('Channel limit');
            });

            it('rejects unauthenticated requests', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/connect', {
                    channelId: 'C123'
                });

                expect(res.status).toBe(401);
            });
        });

        describe('GET /api/v1/config/slack/status', () => {
            it('returns status with no secrets exposed', async () => {
                db._store['merchantConfig'] = {
                    [TENANT_ID]: {
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    connectedAt: '2026-06-18T00:00:00Z',
                                    channels: {
                                        'C123': {
                                            channelId: 'C123',
                                            channelName: '#test',
                                            events: ['positive_reply'],
                                            active: true,
                                            healthStatus: 'healthy',
                                            consecutiveFailures: 0,
                                            lastDeliveryAt: null
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('GET', '/api/v1/config/slack/status', null, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(200);
                expect(res.body.connected).toBe(true);
                expect(res.body.enabled).toBe(true);
                expect(res.body.channels).toHaveLength(1);
                expect(res.body.channels[0].channelId).toBe('C123');

                // Verify no secrets in response
                const responseStr = JSON.stringify(res.body);
                expect(responseStr).not.toContain('xoxb');
                expect(responseStr).not.toContain('botToken');
                expect(responseStr).not.toContain('signingSecret');
                expect(responseStr).not.toContain('webhook');
            });

            it('returns disconnected status for new tenant', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('GET', '/api/v1/config/slack/status', null, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(200);
                expect(res.body.connected).toBe(false);
                expect(res.body.channels).toHaveLength(0);
            });
        });

        describe('PUT /api/v1/config/slack/toggle', () => {
            it('enables Slack', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('PUT', '/api/v1/config/slack/toggle', {
                    enabled: true
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(200);
                expect(res.body.enabled).toBe(true);
            });

            it('disables Slack', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('PUT', '/api/v1/config/slack/toggle', {
                    enabled: false
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(200);
                expect(res.body.enabled).toBe(false);
            });

            it('rejects non-boolean enabled', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('PUT', '/api/v1/config/slack/toggle', {
                    enabled: 'yes'
                }, { 'Authorization': 'Bearer valid-token' });

                expect(res.status).toBe(400);
            });
        });

        describe('DELETE /api/v1/config/slack/disconnect', () => {
            it('soft-deactivates Slack config without deleting merchantConfig', async () => {
                db._store['merchantConfig'] = {
                    [TENANT_ID]: {
                        entity360MerchantId: 'keep-this',
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    channels: { 'C123': { channelId: 'C123' } }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('DELETE', '/api/v1/config/slack/disconnect', null, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);

                // Verify soft disconnect — preserves other merchantConfig fields
                const config = db._store['merchantConfig'][TENANT_ID];
                expect(config.entity360MerchantId).toBe('keep-this');
                expect(config.notificationPrefs.providers.slack.connected).toBe(false);
                expect(config.notificationPrefs.providers.slack.enabled).toBe(false);
                // Channel config preserved (soft delete)
                expect(config.notificationPrefs.providers.slack.channels).toBeDefined();
            });
        });

        describe('POST /api/v1/config/slack/test', () => {
            it('sends test message to active channels', async () => {
                // Mock slackProvider.deliver
                const slackProvider = require('../src/providers/slack/slackProvider');
                const originalDeliver = slackProvider.deliver;
                slackProvider.deliver = jest.fn(async () => ({
                    sent: true,
                    channelId: 'C123',
                    ts: '123.456'
                }));

                db._store['merchantConfig'] = {
                    [TENANT_ID]: {
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    channels: {
                                        'C123': {
                                            channelId: 'C123',
                                            channelName: '#test',
                                            events: ['positive_reply'],
                                            active: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/test', {}, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.results).toHaveLength(1);
                expect(res.body.results[0].sent).toBe(true);

                slackProvider.deliver = originalDeliver;
            });

            it('rejects when no active channels exist', async () => {
                db._store['merchantConfig'] = {
                    [TENANT_ID]: {
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    channels: {
                                        'C123': { channelId: 'C123', active: false, events: ['positive_reply'] }
                                    }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/test', {}, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('No active');
            });

            it('rejects when Slack is not connected', async () => {
                const app = buildConfigApp(db, mockAuth);
                const res = await request(app).send('POST', '/api/v1/config/slack/test', {}, {
                    'Authorization': 'Bearer valid-token'
                });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('not connected');
            });
        });

        describe('Cross-tenant access', () => {
            it('user cannot access another tenant Slack config', async () => {
                // Seed config for a different tenant
                db._store['merchantConfig'] = {
                    'other-tenant-uid': {
                        notificationPrefs: {
                            providers: {
                                slack: {
                                    connected: true,
                                    enabled: true,
                                    channels: { 'C999': { channelId: 'C999' } }
                                }
                            }
                        }
                    }
                };

                const app = buildConfigApp(db, mockAuth);
                // Request as test-tenant-uid, but other-tenant-uid's config exists
                const res = await request(app).send('GET', '/api/v1/config/slack/status', null, {
                    'Authorization': 'Bearer valid-token'
                });

                // Should return test-tenant-uid's config (empty), NOT other-tenant-uid's
                expect(res.status).toBe(200);
                expect(res.body.connected).toBe(false);
                expect(res.body.channels).toHaveLength(0);
            });
        });
    });

    // ---- Tier Gating for Channels ----

    describe('Tier Gating — Channel Limits', () => {
        const { getChannelLimit, meetsMinTier } = require('../src/utils/tierGating');

        it('starter limit is 1', () => {
            expect(getChannelLimit('starter')).toBe(1);
        });

        it('growth limit is 2', () => {
            expect(getChannelLimit('growth')).toBe(2);
        });

        it('scale limit is 3', () => {
            expect(getChannelLimit('scale')).toBe(3);
        });

        it('enterprise is unlimited', () => {
            expect(getChannelLimit('enterprise')).toBe(Infinity);
        });

        it('uses planHierarchy local array pattern (not TIER_RANK object)', () => {
            // Verify the hierarchy is an array in constants
            const { PLAN_HIERARCHY } = require('../src/config/constants');
            expect(Array.isArray(PLAN_HIERARCHY)).toBe(true);
            expect(PLAN_HIERARCHY).toEqual(['starter', 'growth', 'scale', 'enterprise']);
        });
    });

    // ---- Delivery Worker ----

    describe('Delivery Worker — Slack Routing', () => {
        const deliveryWorker = require('../src/services/deliveryWorker');
        const slackProvider = require('../src/providers/slack/slackProvider');

        const TENANT_ID = 'delivery-test-tenant';

        function seedMerchantConfig(slackOverrides = {}) {
            db._store['merchantConfig'] = {
                [TENANT_ID]: {
                    notificationPrefs: {
                        providers: {
                            slack: {
                                connected: true,
                                enabled: true,
                                channels: {
                                    'C123': {
                                        channelId: 'C123',
                                        channelName: '#test',
                                        events: ['positive_reply'],
                                        active: true,
                                        healthStatus: 'healthy',
                                        consecutiveFailures: 0,
                                        lastDeliveryAt: null
                                    }
                                },
                                ...slackOverrides
                            }
                        }
                    }
                }
            };
        }

        function makeEventRecord(overrides = {}) {
            return {
                eventId: uuidv4(),
                scopedKey: `firebase:synchintro:${TENANT_ID}:${uuidv4()}`,
                tenantId: TENANT_ID,
                eventType: 'positive_reply',
                source: 'synchintro',
                payload: {
                    companyName: 'Test Corp',
                    contactEmail: 'test@test.com',
                    fitScore: 85
                },
                ...overrides
            };
        }

        beforeEach(() => {
            slackProvider.clearBotTokenCache();
            slackProvider.setBotToken('xoxb-test-token');
        });

        it('calls SlackProvider for positive_reply event', async () => {
            seedMerchantConfig();
            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = jest.fn(async () => ({
                sent: true,
                channelId: 'C123',
                ts: '123.456'
            }));

            // Seed eventLog so update works
            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.delivered).toBe(true);
            expect(result.provider).toBe('slack');
            expect(slackProvider.deliver).toHaveBeenCalledTimes(1);

            slackProvider.deliver = originalDeliver;
        });

        it('skips when Slack is not connected', async () => {
            seedMerchantConfig({ connected: false });
            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.delivered).toBe(false);
            expect(result.suppressed).toBe(true);
            expect(result.reason).toContain('not connected');
        });

        it('skips when Slack is disabled', async () => {
            seedMerchantConfig({ enabled: false });
            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.delivered).toBe(false);
            expect(result.suppressed).toBe(true);
            expect(result.reason).toContain('disabled');
        });

        it('skips inactive channels', async () => {
            db._store['merchantConfig'] = {
                [TENANT_ID]: {
                    notificationPrefs: {
                        providers: {
                            slack: {
                                connected: true,
                                enabled: true,
                                channels: {
                                    'C123': {
                                        channelId: 'C123',
                                        events: ['positive_reply'],
                                        active: false
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.delivered).toBe(false);
            expect(result.suppressed).toBe(true);
            expect(result.reason).toContain('No active channels');
        });

        it('skips channels not subscribed to event type', async () => {
            db._store['merchantConfig'] = {
                [TENANT_ID]: {
                    notificationPrefs: {
                        providers: {
                            slack: {
                                connected: true,
                                enabled: true,
                                channels: {
                                    'C123': {
                                        channelId: 'C123',
                                        events: ['bounce_spike'],
                                        active: true
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const event = makeEventRecord({ eventType: 'positive_reply' });
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.delivered).toBe(false);
            expect(result.suppressed).toBe(true);
        });

        it('writes notificationLog on successful delivery', async () => {
            seedMerchantConfig();
            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = jest.fn(async () => ({
                sent: true,
                channelId: 'C123',
                ts: '123.456'
            }));

            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            await deliveryWorker.processEvent({ db }, event);

            // Verify notificationLog was written
            const logEntries = Object.values(db._store['notificationLog'] || {});
            expect(logEntries.length).toBe(1);
            expect(logEntries[0].provider).toBe('slack');
            expect(logEntries[0].channelId).toBe('C123');
            expect(logEntries[0].status).toBe('delivered');

            slackProvider.deliver = originalDeliver;
        });

        it('throws on all-channel Slack failure for retry/dead-letter', async () => {
            seedMerchantConfig();
            const originalDeliver = slackProvider.deliver;
            slackProvider.deliver = jest.fn(async () => ({
                sent: false,
                reason: 'channel_not_found'
            }));

            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            await expect(
                deliveryWorker.processEvent({ db }, event)
            ).rejects.toThrow('All Slack deliveries failed');

            slackProvider.deliver = originalDeliver;
        });

        it('logs suppressed reason when no merchantConfig exists', async () => {
            const event = makeEventRecord();
            db._store['eventLog'] = { [event.scopedKey]: { ...event, status: 'received' } };

            const result = await deliveryWorker.processEvent({ db }, event);

            expect(result.suppressed).toBe(true);
            expect(result.reason).toContain('not connected');
        });
    });

    // ---- Secret Manager ----

    describe('Secret Manager', () => {
        const secretManager = require('../src/utils/secretManager');

        beforeEach(() => {
            secretManager.clearCache();
        });

        it('falls back to environment variable when Secret Manager unavailable', async () => {
            process.env.TEST_SECRET = 'env-value';
            secretManager.setClient(null);

            const value = await secretManager.loadSecret('TEST_SECRET', {
                envFallback: 'TEST_SECRET'
            });

            expect(value).toBe('env-value');
            delete process.env.TEST_SECRET;
        });

        it('caches loaded secrets in memory', async () => {
            process.env.CACHED_SECRET = 'cached-value';
            secretManager.setClient(null);

            const first = await secretManager.loadSecret('CACHED_SECRET', {
                envFallback: 'CACHED_SECRET'
            });
            delete process.env.CACHED_SECRET;

            // Should return cached value even after env var deleted
            const second = await secretManager.loadSecret('CACHED_SECRET', {
                envFallback: 'CACHED_SECRET'
            });

            expect(first).toBe('cached-value');
            expect(second).toBe('cached-value');
        });
    });
});
