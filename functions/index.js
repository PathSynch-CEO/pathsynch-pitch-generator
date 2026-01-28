/**
 * PathSynch Pitch Generator - Cloud Functions
 *
 * Main entry point for all Cloud Functions
 * API Version: v1
 *
 * Changes:
 * - 2026-01-27: Added API v1 versioning with /api/v1/ prefix
 * - 2026-01-27: Added GET /pitches (list with pagination)
 * - 2026-01-27: Added DELETE /pitches/:id
 * - 2026-01-27: Added PUT /pitches/:id (update)
 * - 2026-01-27: Restored pitchGenerator.js module
 */

const API_VERSION = 'v1';

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

// Set global options
setGlobalOptions({
    maxInstances: 10,
    region: 'us-central1'
});

// Initialize Firebase Admin
admin.initializeApp();

const db = admin.firestore();

// Import pitch generator
const pitchGenerator = require('./api/pitchGenerator');

// Import Stripe handlers
const stripeApi = require('./api/stripe');

// Import Bulk upload handlers
const bulkApi = require('./api/bulk');

// Import Export handlers
const exportApi = require('./api/export');

// Import Market intelligence handlers
const marketApi = require('./api/market');

// Import Admin handlers
const adminApi = require('./api/admin');
const { requireAdmin } = require('./middleware/adminAuth');

// Import Narrative Pipeline handlers (AI-powered)
const narrativesApi = require('./api/narratives');
const formatterApi = require('./api/formatterApi');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Normalize path - strip /api/v1 prefix for route matching
function normalizePath(path) {
    // Support both /api/v1/endpoint and /endpoint (legacy)
    if (path.startsWith('/api/v1/')) {
        return path.replace('/api/v1', '');
    }
    if (path.startsWith('/v1/')) {
        return path.replace('/v1', '');
    }
    return path;
}

async function verifyAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        console.error('Auth verification failed:', error.message);
        return null;
    }
}

function getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================
// USER MANAGEMENT
// ============================================

async function ensureUserExists(userId, email) {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        await userRef.set({
            userId: userId,
            profile: {
                displayName: null,
                email: email || null,
                photoUrl: null,
                company: null,
                role: null
            },
            plan: 'starter', // Default to starter plan (string format)
            settings: {
                defaultTone: 'consultative',
                defaultGoal: 'book_demo',
                defaultIndustry: null,
                emailSignature: null
            },
            branding: {
                logoUrl: null,
                companyName: null,
                primaryColor: '#3A6746',
                accentColor: '#FFC700',
                hidePoweredBy: false
            },
            stats: {
                totalPitches: 0,
                totalViews: 0,
                lastPitchAt: null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Created new user:', userId);
        return { isNew: true };
    }

    await userRef.update({
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { isNew: false, data: userDoc.data() };
}

// ============================================
// USAGE TRACKING - FIXED FOR SCALE PLAN
// ============================================

async function checkAndUpdateUsage(userId) {
    console.log('=== CHECKING USAGE FOR USER ===');
    console.log('User ID:', userId);
    
    const period = getCurrentPeriod();
    const usageId = `${userId}_${period}`;
    const usageRef = db.collection('usage').doc(usageId);
    const usageDoc = await usageRef.get();

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    // FIX: Check for plan as string (e.g., "scale") OR as object with tier (e.g., {tier: "scale"})
    let planTier;
    if (typeof userData.plan === 'string') {
        planTier = userData.plan;
    } else if (userData.plan && typeof userData.plan === 'object') {
        planTier = userData.plan.tier || 'starter';
    } else {
        planTier = 'starter';
    }
    
    console.log('User plan detected:', planTier);

    // Plan limits - ADDED scale plan!
    const planLimits = {
        free: { pitches: 5, apiCalls: 100 },
        starter: { pitches: 5, apiCalls: 100 },
        growth: { pitches: 25, apiCalls: 5000 },
        scale: { pitches: -1, apiCalls: -1 },      // UNLIMITED
        enterprise: { pitches: -1, apiCalls: -1 }  // UNLIMITED
    };

    const limits = planLimits[planTier] || planLimits.starter;
    console.log('Plan limits:', limits);

    // If unlimited plan, skip usage check entirely
    if (limits.pitches === -1) {
        console.log('✅ UNLIMITED PLAN - Skipping usage check');
        return { allowed: true, used: 0, limit: -1 };
    }

    if (!usageDoc.exists) {
        await usageRef.set({
            userId: userId,
            period: period,
            pitchesGenerated: 0,
            apiCalls: 0,
            limits: limits,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { allowed: true, used: 0, limit: limits.pitches };
    }

    const usage = usageDoc.data();
    const used = usage.pitchesGenerated || 0;
    const limit = limits.pitches;

    console.log(`Usage: ${used}/${limit}`);

    if (limit !== -1 && used >= limit) {
        console.log('❌ LIMIT REACHED');
        return { allowed: false, used, limit, message: 'Monthly pitch limit reached. Please upgrade your plan.' };
    }

    console.log('✅ USAGE OK - Allowing pitch');
    return { allowed: true, used, limit };
}

async function incrementUsage(userId, field = 'pitchesGenerated') {
    const period = getCurrentPeriod();
    const usageId = `${userId}_${period}`;
    const usageRef = db.collection('usage').doc(usageId);

    try {
        await usageRef.update({
            [field]: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        // Document might not exist, create it
        await usageRef.set({
            userId: userId,
            period: period,
            [field]: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    const userRef = db.collection('users').doc(userId);
    try {
        await userRef.update({
            'stats.totalPitches': admin.firestore.FieldValue.increment(1),
            'stats.lastPitchAt': admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.log('Could not update user stats:', error.message);
    }
}

// ============================================
// ANALYTICS TRACKING
// ============================================

async function trackPitchView(pitchId, viewerId, context = {}) {
    try {
        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        const today = new Date().toISOString().split('T')[0];

        await analyticsRef.set({
            pitchId: pitchId,
            views: admin.firestore.FieldValue.increment(1),
            [`viewsByDay.${today}`]: admin.firestore.FieldValue.increment(1),
            lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await analyticsRef.collection('events').add({
            type: 'view',
            viewerId: viewerId || 'anonymous',
            context: context,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const pitchRef = db.collection('pitches').doc(pitchId);
        await pitchRef.update({
            'analytics.views': admin.firestore.FieldValue.increment(1),
            'analytics.lastViewedAt': admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});

    } catch (error) {
        console.error('Error tracking view:', error.message);
    }
}

// ============================================
// MAIN API HANDLER
// ============================================

exports.api = onRequest({
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120
}, async (req, res) => {
    return cors(req, res, async () => {
        const rawPath = req.path;
        const path = normalizePath(rawPath);
        const method = req.method;
        const isVersioned = rawPath.startsWith('/api/v1/') || rawPath.startsWith('/v1/');

        console.log(`API Request: ${method} ${rawPath} -> ${path} (versioned: ${isVersioned})`);

        try {
            // ========== PITCH ENDPOINTS ==========

            if (path === '/generate-pitch' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                const userId = decodedToken?.uid || 'anonymous';

                if (userId !== 'anonymous') {
                    await ensureUserExists(userId, decodedToken?.email);

                    const usageCheck = await checkAndUpdateUsage(userId);
                    if (!usageCheck.allowed) {
                        return res.status(429).json({
                            success: false,
                            message: usageCheck.message,
                            usage: { used: usageCheck.used, limit: usageCheck.limit }
                        });
                    }
                }

                // Store userId for pitchGenerator
                req.userId = userId;

                const result = await pitchGenerator.generatePitch(req, res);

                if (userId !== 'anonymous') {
                    await incrementUsage(userId);
                }

                return result;
            }

            // Get pitch by ID
            if (path.match(/^\/pitch\/[^/]+$/) && method === 'GET') {
                const pitchId = path.split('/')[2];
                req.params = { pitchId };

                const decodedToken = await verifyAuth(req);
                await trackPitchView(pitchId, decodedToken?.uid, {
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                });

                return await pitchGenerator.getPitch(req, res);
            }

            // Get shared pitch
            if (path.match(/^\/pitch\/share\/[^/]+$/) && method === 'GET') {
                const shareId = path.split('/')[3];
                req.params = { shareId };

                const pitchQuery = await db.collection('pitches')
                    .where('shareId', '==', shareId)
                    .limit(1)
                    .get();

                if (!pitchQuery.empty) {
                    await trackPitchView(pitchQuery.docs[0].id, 'anonymous', {
                        ip: req.ip,
                        userAgent: req.headers['user-agent'],
                        referrer: req.headers['referer']
                    });
                }

                return await pitchGenerator.getSharedPitch(req, res);
            }

            // List all pitches (with pagination) - NEW v1 ENDPOINT
            if ((path === '/pitches' || path === '/pitch') && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const userId = decodedToken.uid;
                const limit = Math.min(parseInt(req.query.limit) || 20, 100);
                const offset = parseInt(req.query.offset) || 0;
                const sortBy = req.query.sortBy || 'createdAt';
                const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
                const industry = req.query.industry;
                const level = req.query.level ? parseInt(req.query.level) : null;

                let query = db.collection('pitches').where('userId', '==', userId);

                // Apply filters
                if (industry) {
                    query = query.where('industry', '==', industry);
                }
                if (level) {
                    query = query.where('pitchLevel', '==', level);
                }

                // Get total count for pagination
                const countSnapshot = await query.count().get();
                const total = countSnapshot.data().count;

                // Apply sorting and pagination
                query = query.orderBy(sortBy, sortOrder).offset(offset).limit(limit);
                const snapshot = await query.get();

                const pitches = snapshot.docs.map(doc => ({
                    id: doc.id,
                    businessName: doc.data().businessName,
                    industry: doc.data().industry,
                    pitchLevel: doc.data().pitchLevel,
                    createdAt: doc.data().createdAt,
                    shareId: doc.data().shareId,
                    shared: doc.data().shared || false,
                    analytics: doc.data().analytics || { views: 0 }
                }));

                return res.status(200).json({
                    success: true,
                    data: pitches,
                    pagination: {
                        total,
                        limit,
                        offset,
                        hasMore: offset + pitches.length < total
                    }
                });
            }

            // Update pitch - NEW v1 ENDPOINT
            if (path.match(/^\/pitch(es)?\/[^/]+$/) && method === 'PUT') {
                const pitchId = path.split('/').pop();
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                // Verify ownership
                const pitchRef = db.collection('pitches').doc(pitchId);
                const pitchDoc = await pitchRef.get();

                if (!pitchDoc.exists) {
                    return res.status(404).json({ success: false, message: 'Pitch not found' });
                }

                const pitchData = pitchDoc.data();
                if (pitchData.userId !== decodedToken.uid && pitchData.userId !== 'anonymous') {
                    return res.status(403).json({ success: false, message: 'Not authorized to update this pitch' });
                }

                // Allowed fields to update
                const allowedFields = ['businessName', 'contactName', 'shared', 'industry', 'statedProblem'];
                const updates = {};
                for (const field of allowedFields) {
                    if (req.body[field] !== undefined) {
                        updates[field] = req.body[field];
                    }
                }

                if (Object.keys(updates).length === 0) {
                    return res.status(400).json({ success: false, message: 'No valid fields to update' });
                }

                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                await pitchRef.update(updates);

                return res.status(200).json({
                    success: true,
                    message: 'Pitch updated',
                    data: { id: pitchId, ...updates }
                });
            }

            // Delete pitch - NEW v1 ENDPOINT
            if (path.match(/^\/pitch(es)?\/[^/]+$/) && method === 'DELETE') {
                const pitchId = path.split('/').pop();
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                // Verify ownership
                const pitchRef = db.collection('pitches').doc(pitchId);
                const pitchDoc = await pitchRef.get();

                if (!pitchDoc.exists) {
                    return res.status(404).json({ success: false, message: 'Pitch not found' });
                }

                const pitchData = pitchDoc.data();
                if (pitchData.userId !== decodedToken.uid && pitchData.userId !== 'anonymous') {
                    return res.status(403).json({ success: false, message: 'Not authorized to delete this pitch' });
                }

                // Delete pitch document
                await pitchRef.delete();

                // Also delete associated analytics
                const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
                await analyticsRef.delete().catch(() => {});

                return res.status(200).json({
                    success: true,
                    message: 'Pitch deleted',
                    data: { id: pitchId }
                });
            }

            // ========== NARRATIVE PIPELINE ENDPOINTS (AI) ==========

            // Generate narrative from business data
            if (path === '/narratives/generate' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.userEmail = decodedToken.email;
                return await narrativesApi.generateNarrative(req, res);
            }

            // List user's narratives
            if (path === '/narratives' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await narrativesApi.listNarratives(req, res);
            }

            // Get specific narrative
            if (path.match(/^\/narratives\/[^/]+$/) && !path.includes('/format') && method === 'GET') {
                const narrativeId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId };
                return await narrativesApi.getNarrative(req, res);
            }

            // Regenerate narrative sections
            if (path.match(/^\/narratives\/[^/]+\/regenerate$/) && method === 'POST') {
                const narrativeId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId };
                return await narrativesApi.regenerateNarrative(req, res);
            }

            // Delete narrative
            if (path.match(/^\/narratives\/[^/]+$/) && method === 'DELETE') {
                const narrativeId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId };
                return await narrativesApi.deleteNarrative(req, res);
            }

            // ========== FORMATTER ENDPOINTS ==========

            // List available formatters
            if (path === '/formatters' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await formatterApi.listFormatters(req, res);
            }

            // Format narrative into specific asset type
            if (path.match(/^\/narratives\/[^/]+\/format\/[^/]+$/) && method === 'POST') {
                const parts = path.split('/');
                const narrativeId = parts[2];
                const assetType = parts[4];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId, type: assetType };
                return await formatterApi.formatNarrativeEndpoint(req, res);
            }

            // Batch format narrative into multiple types
            if (path.match(/^\/narratives\/[^/]+\/format-batch$/) && method === 'POST') {
                const narrativeId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId };
                return await formatterApi.batchFormatEndpoint(req, res);
            }

            // List assets for a narrative
            if (path.match(/^\/narratives\/[^/]+\/assets$/) && method === 'GET') {
                const narrativeId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { id: narrativeId };
                return await formatterApi.listAssets(req, res);
            }

            // Get specific asset
            if (path.match(/^\/assets\/[^/]+$/) && method === 'GET') {
                const assetId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { assetId };
                return await formatterApi.getAsset(req, res);
            }

            // Delete asset
            if (path.match(/^\/assets\/[^/]+$/) && method === 'DELETE') {
                const assetId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { assetId };
                return await formatterApi.deleteAsset(req, res);
            }

            // ========== USER ENDPOINTS ==========

            if (path === '/user' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                if (!userDoc.exists) {
                    // Create user if doesn't exist
                    await ensureUserExists(decodedToken.uid, decodedToken.email);
                    const newUserDoc = await db.collection('users').doc(decodedToken.uid).get();
                    return res.status(200).json({ success: true, data: newUserDoc.data() });
                }

                return res.status(200).json({ success: true, data: userDoc.data() });
            }

            if (path === '/user/settings' && method === 'PUT') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const updates = req.body;
                const userRef = db.collection('users').doc(decodedToken.uid);

                await userRef.set({
                    ...updates,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                return res.status(200).json({ success: true, message: 'Settings updated' });
            }

            // ========== USAGE ENDPOINTS ==========

            if (path === '/usage' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const period = getCurrentPeriod();
                const usageId = `${decodedToken.uid}_${period}`;
                const usageDoc = await db.collection('usage').doc(usageId).get();

                if (!usageDoc.exists) {
                    return res.status(200).json({
                        success: true,
                        data: { period, pitchesGenerated: 0, limits: { pitches: 5 } }
                    });
                }

                return res.status(200).json({ success: true, data: usageDoc.data() });
            }

            // ========== ANALYTICS ENDPOINTS ==========

            if (path === '/analytics/track' && method === 'POST') {
                const { pitchId, event, data } = req.body;

                if (!pitchId || !event) {
                    return res.status(400).json({ success: false, message: 'Missing pitchId or event' });
                }

                const decodedToken = await verifyAuth(req);
                const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);

                await analyticsRef.collection('events').add({
                    type: event,
                    data: data || {},
                    viewerId: decodedToken?.uid || 'anonymous',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                const incrementField = {
                    'cta_click': 'ctaClicks',
                    'share': 'shares',
                    'download': 'downloads'
                }[event];

                if (incrementField) {
                    await analyticsRef.set({
                        [incrementField]: admin.firestore.FieldValue.increment(1),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                return res.status(200).json({ success: true });
            }

            if (path.match(/^\/analytics\/pitch\/[^/]+$/) && method === 'GET') {
                const pitchId = path.split('/')[3];

                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const analyticsDoc = await db.collection('pitchAnalytics').doc(pitchId).get();

                if (!analyticsDoc.exists) {
                    return res.status(200).json({
                        success: true,
                        data: { pitchId, views: 0, shares: 0, ctaClicks: 0 }
                    });
                }

                return res.status(200).json({ success: true, data: analyticsDoc.data() });
            }

            // ========== TEMPLATES ENDPOINTS ==========

            if (path === '/templates' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const systemTemplates = await db.collection('templates')
                    .where('isSystem', '==', true)
                    .get();

                const userTemplates = await db.collection('templates')
                    .where('userId', '==', decodedToken.uid)
                    .get();

                const templates = [
                    ...systemTemplates.docs.map(d => ({ id: d.id, ...d.data() })),
                    ...userTemplates.docs.map(d => ({ id: d.id, ...d.data() }))
                ];

                return res.status(200).json({ success: true, data: templates });
            }

            // ========== BULK UPLOAD ENDPOINTS ==========

            // Download CSV template
            if (path === '/bulk/template' && method === 'GET') {
                return await bulkApi.downloadTemplate(req, res);
            }

            // Upload CSV for bulk processing
            if (path === '/bulk/upload' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await bulkApi.uploadCSV(req, res);
            }

            // List user's bulk jobs
            if (path === '/bulk/jobs' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await bulkApi.listJobs(req, res);
            }

            // Get job details
            if (path.match(/^\/bulk\/jobs\/[^/]+$/) && method === 'GET') {
                const jobId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { jobId };
                return await bulkApi.getJob(req, res);
            }

            // Download job as ZIP
            if (path.match(/^\/bulk\/jobs\/[^/]+\/download$/) && method === 'GET') {
                const jobId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { jobId };
                return await bulkApi.downloadJob(req, res);
            }

            // ========== MARKET INTELLIGENCE ENDPOINTS ==========

            // Generate market report
            if (path === '/market/report' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await marketApi.generateReport(req, res);
            }

            // List user's market reports
            if (path === '/market/reports' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await marketApi.listReports(req, res);
            }

            // Get specific market report
            if (path.match(/^\/market\/reports\/[^/]+$/) && method === 'GET') {
                const reportId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { reportId };
                return await marketApi.getReport(req, res);
            }

            // Get available industries
            if (path === '/market/industries' && method === 'GET') {
                return await marketApi.getIndustries(req, res);
            }

            // ========== EXPORT ENDPOINTS ==========

            // Generate PPT for a pitch
            if (path.match(/^\/export\/ppt\/[^/]+$/) && method === 'POST') {
                const pitchId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { pitchId };
                return await exportApi.generatePPT(req, res);
            }

            // Check if PPT export is available
            if (path === '/export/check' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await exportApi.checkExportAvailable(req, res);
            }

            // ========== STRIPE ENDPOINTS ==========

            // Create checkout session
            if (path === '/stripe/create-checkout-session' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.userEmail = decodedToken.email;
                return await stripeApi.createCheckoutSession(req, res);
            }

            // Create billing portal session
            if (path === '/stripe/create-portal-session' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await stripeApi.createPortalSession(req, res);
            }

            // Stripe webhook
            if (path === '/stripe/webhook' && method === 'POST') {
                return await stripeApi.handleWebhook(req, res);
            }

            // Get subscription status
            if (path === '/subscription' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await stripeApi.getSubscription(req, res);
            }

            // ========== PRICING PLANS ENDPOINT ==========

            if (path === '/pricing-plans' && method === 'GET') {
                const { PLANS } = require('./config/stripe');
                return res.status(200).json({
                    success: true,
                    data: PLANS
                });
            }

            // ========== ADMIN ENDPOINTS ==========

            // Admin dashboard stats
            if (path === '/admin/stats' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;

                // Check admin access
                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.getStats(req, res);
            }

            // Admin list users
            if (path === '/admin/users' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.listUsers(req, res);
            }

            // Admin get user details
            if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'GET') {
                const userId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { userId };

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.getUser(req, res);
            }

            // Admin update user
            if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'PATCH') {
                const userId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                req.params = { userId };

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                // Get admin email for audit trail
                const adminUser = await admin.auth().getUser(decodedToken.uid);
                req.adminEmail = adminUser.email;

                return await adminApi.updateUser(req, res);
            }

            // Admin revenue analytics
            if (path === '/admin/revenue' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.getRevenue(req, res);
            }

            // Admin list pitches
            if (path === '/admin/pitches' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.listPitches(req, res);
            }

            // Admin usage analytics
            if (path === '/admin/usage' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;

                const { checkIsAdmin } = require('./middleware/adminAuth');
                const isAdmin = await checkIsAdmin(decodedToken.uid);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }

                return await adminApi.getUsageAnalytics(req, res);
            }

            // ========== HEALTH CHECK ==========

            if (path === '/health' && method === 'GET') {
                return res.status(200).json({
                    success: true,
                    message: 'API is healthy',
                    version: '2.2.0',
                    apiVersion: API_VERSION,
                    timestamp: new Date().toISOString(),
                    endpoints: {
                        pitches: '/api/v1/pitches',
                        narratives: '/api/v1/narratives',
                        formatters: '/api/v1/formatters',
                        assets: '/api/v1/assets',
                        user: '/api/v1/user',
                        analytics: '/api/v1/analytics',
                        templates: '/api/v1/templates'
                    },
                    features: {
                        aiNarratives: process.env.ENABLE_AI_NARRATIVES !== 'false',
                        templateFallback: process.env.FALLBACK_TO_TEMPLATES !== 'false'
                    }
                });
            }

            // ========== NOT FOUND ==========

            return res.status(404).json({
                success: false,
                error: 'Not found',
                path: path,
                apiVersion: API_VERSION,
                availableEndpoints: [
                    // Pitch endpoints (template-based)
                    'POST /api/v1/generate-pitch',
                    'GET  /api/v1/pitches',
                    'GET  /api/v1/pitch/:pitchId',
                    'PUT  /api/v1/pitch/:pitchId',
                    'DELETE /api/v1/pitch/:pitchId',
                    'GET  /api/v1/pitch/share/:shareId',
                    // Narrative endpoints (AI-powered)
                    'POST /api/v1/narratives/generate',
                    'GET  /api/v1/narratives',
                    'GET  /api/v1/narratives/:id',
                    'POST /api/v1/narratives/:id/regenerate',
                    'DELETE /api/v1/narratives/:id',
                    // Formatter endpoints
                    'GET  /api/v1/formatters',
                    'POST /api/v1/narratives/:id/format/:type',
                    'POST /api/v1/narratives/:id/format-batch',
                    'GET  /api/v1/narratives/:id/assets',
                    'GET  /api/v1/assets/:assetId',
                    'DELETE /api/v1/assets/:assetId',
                    // User endpoints
                    'GET  /api/v1/user',
                    'PUT  /api/v1/user/settings',
                    // Usage & billing
                    'GET  /api/v1/usage',
                    'GET  /api/v1/pricing-plans',
                    // Analytics
                    'POST /api/v1/analytics/track',
                    'GET  /api/v1/analytics/pitch/:pitchId',
                    // Templates
                    'GET  /api/v1/templates',
                    // Admin (restricted)
                    'GET  /api/v1/admin/stats',
                    'GET  /api/v1/admin/users',
                    'GET  /api/v1/admin/users/:userId',
                    'PATCH /api/v1/admin/users/:userId',
                    'GET  /api/v1/admin/revenue',
                    'GET  /api/v1/admin/pitches',
                    'GET  /api/v1/admin/usage',
                    // System
                    'GET  /api/v1/health'
                ],
                legacyEndpoints: '(All endpoints also available without /api/v1 prefix for backward compatibility)'
            });

        } catch (error) {
            console.error('API Error:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    });
});
