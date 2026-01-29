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

// CORS configuration - whitelist allowed origins from environment
// Format: ALLOWED_ORIGINS=https://example.com,https://app.example.com
const getAllowedOrigins = () => {
    const envOrigins = process.env.ALLOWED_ORIGINS;
    if (!envOrigins) {
        // Default to Firebase hosting domains in production
        return [
            'https://pathsynch-pitch-creation.web.app',
            'https://pathsynch-pitch-creation.firebaseapp.com'
        ];
    }
    return envOrigins.split(',').map(o => o.trim()).filter(o => o.length > 0);
};

const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = getAllowedOrigins();

        // Allow requests with no origin (mobile apps, Postman, etc.) in development only
        if (!origin) {
            const allowNoOrigin = process.env.NODE_ENV !== 'production' || process.env.ALLOW_NO_ORIGIN === 'true';
            return callback(null, allowNoOrigin);
        }

        // Check if origin is allowed
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

const cors = require('cors')(corsOptions);

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

// Import Lead capture handlers
const leadsApi = require('./api/leads');

// Import Email service
const emailService = require('./services/email');

// Import Admin handlers
const adminApi = require('./api/admin');
const { requireAdmin } = require('./middleware/adminAuth');

// Import Narrative Pipeline handlers (AI-powered)
const narrativesApi = require('./api/narratives');
const formatterApi = require('./api/formatterApi');

// Import validation middleware
const { validateBody } = require('./middleware/validation');

// Import error handler
const { handleError, ApiError, ErrorCodes } = require('./middleware/errorHandler');

// Import rate limiter
const { rateLimiter, getRateLimitStatus } = require('./middleware/rateLimiter');

// Import modular routes
const {
    pitchRoutes,
    userRoutes,
    teamRoutes,
    analyticsRoutes,
    AVAILABLE_ENDPOINTS
} = require('./routes');

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

        // Send welcome email to new users
        if (email) {
            try {
                await emailService.sendWelcomeEmail(email, {
                    displayName: null // Will use generic greeting
                });
                console.log('Welcome email sent to:', email);
            } catch (emailError) {
                console.error('Failed to send welcome email:', emailError);
                // Don't fail user creation if email fails
            }
        }

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

        // Set up request context for route modules
        const decodedToken = await verifyAuth(req);
        req.userId = decodedToken?.uid || 'anonymous';
        req.userEmail = decodedToken?.email;
        req.path = path; // Normalized path for route matching

        // Ensure user exists if authenticated and get their plan
        let userPlan = 'anonymous';
        if (req.userId !== 'anonymous') {
            await ensureUserExists(req.userId, req.userEmail);

            // Fetch user's plan for rate limiting
            try {
                const userDoc = await db.collection('users').doc(req.userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    if (typeof userData.plan === 'string') {
                        userPlan = userData.plan;
                    } else if (userData.plan && typeof userData.plan === 'object') {
                        userPlan = userData.plan.tier || 'starter';
                    } else {
                        userPlan = 'starter';
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch user plan for rate limiting:', err.message);
                userPlan = 'starter';
            }
        }

        // Set up user object for rate limiter
        req.user = {
            uid: req.userId !== 'anonymous' ? req.userId : null,
            email: req.userEmail,
            plan: userPlan
        };

        // Apply rate limiting
        const rateLimitMiddleware = rateLimiter();
        const rateLimitResult = await new Promise((resolve) => {
            rateLimitMiddleware(req, res, () => resolve(true));
            // If response was sent (rate limited), resolve false after a short delay
            setTimeout(() => resolve(res.headersSent ? false : true), 0);
        });

        if (!rateLimitResult || res.headersSent) {
            return; // Rate limit response already sent
        }

        try {
            // ========== TRY MODULAR ROUTES FIRST ==========
            // Route modules handle: user, team, analytics endpoints
            // (pitch routes still inline due to usage tracking integration)

            // User routes: /user, /user/settings, /usage, /templates, /subscription, /pricing-plans
            if (await userRoutes.handle(req, res)) return;

            // Team routes: /team, /team/invite, /team/accept-invite, /team/members/*, /team/invites/*
            if (await teamRoutes.handle(req, res)) return;

            // Analytics routes: /analytics/track, /analytics/pitch/:pitchId
            if (path.startsWith('/analytics')) {
                // Validate analytics/track body
                if (path === '/analytics/track' && method === 'POST') {
                    const validation = validateBody(req.body, 'analyticsTrack');
                    if (!validation.valid) {
                        return res.status(400).json({
                            success: false,
                            error: 'Validation failed',
                            details: validation.errors
                        });
                    }
                    req.body = validation.value;
                }
                if (await analyticsRoutes.handle(req, res)) return;
            }

            // ========== PITCH ENDPOINTS (inline for usage tracking) ==========

            if (path === '/generate-pitch' && method === 'POST') {
                // Validate request body
                const validation = validateBody(req.body, 'generatePitch');
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors
                    });
                }
                req.body = validation.value;

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
                // Validate request body
                const validation = validateBody(req.body, 'generateNarrative');
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors
                    });
                }
                req.body = validation.value;

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
            // NOTE: These routes are now handled by userRoutes module above.
            // The inline code below is kept as reference but should never be reached.

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
            // NOTE: These routes are now handled by analyticsRoutes module above.
            // The inline code below is kept as reference but should never be reached.

            if (path === '/analytics/track' && method === 'POST') {
                // Validate request body
                const validation = validateBody(req.body, 'analyticsTrack');
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors
                    });
                }
                req.body = validation.value;

                const { pitchId, event, data } = req.body;
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

            // Get company size options
            if (path === '/market/company-sizes' && method === 'GET') {
                return await marketApi.getCompanySizes(req, res);
            }

            // Get user's custom sub-industries
            if (path === '/market/custom-sub-industries' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await marketApi.getCustomSubIndustries(req, res);
            }

            // Save a custom sub-industry
            if (path === '/market/sub-industry' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await marketApi.saveCustomSubIndustry(req, res);
            }

            // Email market report PDF
            if (path.match(/^\/market\/reports\/[^/]+\/email$/) && method === 'POST') {
                const reportId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { email, pdfBase64, filename, reportData } = req.body;
                if (!email) {
                    return res.status(400).json({ success: false, message: 'Email address required' });
                }
                if (!pdfBase64) {
                    return res.status(400).json({ success: false, message: 'PDF content required' });
                }

                try {
                    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
                    const location = reportData?.location || 'Your Market';
                    const industry = reportData?.industry || 'Industry Analysis';

                    await emailService.sendMarketReportEmail(
                        email,
                        `Market Intelligence Report - ${location} ${industry}`,
                        pdfBuffer,
                        filename || `Market_Report_${reportId}.pdf`,
                        reportData || {}
                    );

                    return res.status(200).json({
                        success: true,
                        message: 'Report sent successfully',
                        sentTo: email
                    });
                } catch (error) {
                    console.error('Email send error:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to send email. Please try again.'
                    });
                }
            }

            // ========== PITCH EMAIL ENDPOINTS ==========

            // Email pitch deck PDF
            if (path.match(/^\/pitch(es)?\/[^/]+\/email$/) && method === 'POST') {
                const pitchId = path.split('/')[2];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                // Verify pitch ownership
                const pitchRef = db.collection('pitches').doc(pitchId);
                const pitchDoc = await pitchRef.get();

                if (!pitchDoc.exists) {
                    return res.status(404).json({ success: false, message: 'Pitch not found' });
                }

                const pitchData = pitchDoc.data();
                if (pitchData.userId !== decodedToken.uid && pitchData.userId !== 'anonymous') {
                    return res.status(403).json({ success: false, message: 'Not authorized' });
                }

                const { email, pdfBase64, filename } = req.body;
                if (!email) {
                    return res.status(400).json({ success: false, message: 'Email address required' });
                }
                if (!pdfBase64) {
                    return res.status(400).json({ success: false, message: 'PDF content required' });
                }

                try {
                    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

                    // Get sender's company name from user profile
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const userData = userDoc.exists ? userDoc.data() : {};
                    const senderCompanyName = userData.branding?.companyName || userData.profile?.company || 'PathSynch';

                    // Build pitch URL for "View Report" button
                    const pitchUrl = `https://pathsynch-pitch-creation.web.app/pitch.html?id=${pitchId}`;

                    await emailService.sendPitchEmail(
                        email,
                        `${senderCompanyName} - Pitch for ${pitchData.businessName || 'Your Business'}`,
                        pdfBuffer,
                        filename || `Pitch_${pitchData.businessName || pitchId}.pdf`,
                        {
                            businessName: pitchData.businessName,
                            contactName: pitchData.contactName,
                            senderCompanyName: senderCompanyName,
                            pitchUrl: pitchUrl,
                            pitchId: pitchId
                        }
                    );

                    // Track the email send event
                    await db.collection('pitchAnalytics').add({
                        pitchId: pitchId,
                        event: 'email_sent',
                        recipientEmail: email,
                        userId: decodedToken.uid,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return res.status(200).json({
                        success: true,
                        message: 'Pitch sent successfully',
                        sentTo: email
                    });
                } catch (error) {
                    console.error('Email send error:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to send email. Please try again.'
                    });
                }
            }

            // ========== TEAM MANAGEMENT ENDPOINTS ==========
            // NOTE: These routes are now handled by teamRoutes module above.
            // The inline code below is kept as reference but should never be reached.

            // Get team info
            if (path === '/team' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    // Check if user is part of a team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const userData = userDoc.exists ? userDoc.data() : {};
                    const teamId = userData.teamId;

                    if (!teamId) {
                        // User doesn't have a team yet - return solo mode
                        return res.status(200).json({
                            success: true,
                            data: {
                                hasTeam: false,
                                role: 'owner',
                                members: [{
                                    id: decodedToken.uid,
                                    email: decodedToken.email,
                                    role: 'owner',
                                    name: userData.displayName || decodedToken.email?.split('@')[0] || 'Owner',
                                    joinedAt: userData.createdAt || new Date()
                                }]
                            }
                        });
                    }

                    // Get team data
                    const teamDoc = await db.collection('teams').doc(teamId).get();
                    if (!teamDoc.exists) {
                        return res.status(404).json({ success: false, message: 'Team not found' });
                    }

                    const team = teamDoc.data();

                    // Get all team members
                    const membersSnapshot = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .get();

                    const members = membersSnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    // Get pending invites
                    const invitesSnapshot = await db.collection('teamInvites')
                        .where('teamId', '==', teamId)
                        .where('status', '==', 'pending')
                        .get();

                    const pendingInvites = invitesSnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    return res.status(200).json({
                        success: true,
                        data: {
                            hasTeam: true,
                            teamId,
                            teamName: team.name,
                            ownerId: team.ownerId,
                            plan: team.plan,
                            maxMembers: team.maxMembers,
                            members,
                            pendingInvites,
                            userRole: members.find(m => m.userId === decodedToken.uid)?.role || 'member'
                        }
                    });
                } catch (error) {
                    console.error('Error getting team:', error);
                    return res.status(500).json({ success: false, message: 'Failed to load team' });
                }
            }

            // Create team (for existing users upgrading)
            if (path === '/team' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { name } = req.body;

                try {
                    // Check if user already has a team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const userData = userDoc.exists ? userDoc.data() : {};

                    if (userData.teamId) {
                        return res.status(409).json({ success: false, message: 'You already have a team' });
                    }

                    // Get user's plan to determine max members
                    const plan = userData.plan || 'starter';
                    const stripeConfig = require('./config/stripe');
                    const planLimits = stripeConfig.getPlanLimits(plan);
                    const maxMembers = planLimits.teamMembers || 1;

                    // Create team
                    const teamRef = await db.collection('teams').add({
                        name: name || `${decodedToken.email?.split('@')[0]}'s Team`,
                        ownerId: decodedToken.uid,
                        plan,
                        maxMembers,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Add owner as first member
                    await db.collection('teamMembers').add({
                        teamId: teamRef.id,
                        userId: decodedToken.uid,
                        email: decodedToken.email,
                        name: userData.displayName || decodedToken.email?.split('@')[0],
                        role: 'owner',
                        joinedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Update user with team ID
                    await db.collection('users').doc(decodedToken.uid).set({
                        teamId: teamRef.id
                    }, { merge: true });

                    return res.status(201).json({
                        success: true,
                        message: 'Team created',
                        data: { teamId: teamRef.id }
                    });
                } catch (error) {
                    console.error('Error creating team:', error);
                    return res.status(500).json({ success: false, message: 'Failed to create team' });
                }
            }

            // Invite team member
            if (path === '/team/invite' && method === 'POST') {
                // Validate request body
                const validation = validateBody(req.body, 'teamInvite');
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors
                    });
                }
                req.body = validation.value;

                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { email, role } = req.body;

                try {
                    // Get user's team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const userData = userDoc.exists ? userDoc.data() : {};
                    const teamId = userData.teamId;

                    if (!teamId) {
                        return res.status(400).json({ success: false, message: 'Create a team first' });
                    }

                    // Get team
                    const teamDoc = await db.collection('teams').doc(teamId).get();
                    const team = teamDoc.data();

                    // Check if user can invite (owner or admin)
                    const memberSnapshot = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .where('userId', '==', decodedToken.uid)
                        .limit(1)
                        .get();

                    const userMembership = memberSnapshot.docs[0]?.data();
                    if (!userMembership || !['owner', 'admin'].includes(userMembership.role)) {
                        return res.status(403).json({ success: false, message: 'Only owners and admins can invite members' });
                    }

                    // Check team member limit
                    const currentMembersSnapshot = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .get();

                    const pendingInvitesSnapshot = await db.collection('teamInvites')
                        .where('teamId', '==', teamId)
                        .where('status', '==', 'pending')
                        .get();

                    const totalCount = currentMembersSnapshot.size + pendingInvitesSnapshot.size;
                    if (totalCount >= team.maxMembers) {
                        return res.status(400).json({
                            success: false,
                            message: `Team limit reached (${team.maxMembers} members). Upgrade to add more.`
                        });
                    }

                    // Check if already invited or member
                    const existingInvite = await db.collection('teamInvites')
                        .where('teamId', '==', teamId)
                        .where('email', '==', email.toLowerCase())
                        .where('status', '==', 'pending')
                        .limit(1)
                        .get();

                    if (!existingInvite.empty) {
                        return res.status(409).json({ success: false, message: 'Invite already sent to this email' });
                    }

                    const existingMember = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .where('email', '==', email.toLowerCase())
                        .limit(1)
                        .get();

                    if (!existingMember.empty) {
                        return res.status(409).json({ success: false, message: 'This user is already a team member' });
                    }

                    // Create invite
                    const inviteCode = require('crypto').randomBytes(16).toString('hex');
                    const inviteRef = await db.collection('teamInvites').add({
                        teamId,
                        teamName: team.name,
                        email: email.toLowerCase(),
                        role: role || 'member',
                        invitedBy: decodedToken.uid,
                        inviterEmail: decodedToken.email,
                        inviteCode,
                        status: 'pending',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
                    });

                    // Send invite email via SendGrid
                    const inviteUrl = `https://pathsynch-pitch-creation.web.app/join-team.html?code=${inviteCode}`;
                    try {
                        await emailService.sendTeamInviteEmail(email, {
                            teamName: team.name,
                            inviterName: decodedToken.name || null,
                            inviterEmail: decodedToken.email,
                            role: role || 'member',
                            inviteUrl,
                            inviteCode
                        });
                    } catch (emailError) {
                        console.error('Failed to send invite email:', emailError);
                        // Don't fail the invite if email fails
                    }

                    return res.status(201).json({
                        success: true,
                        message: `Invite sent to ${email}`,
                        data: {
                            inviteId: inviteRef.id,
                            inviteCode,
                            inviteUrl
                        }
                    });
                } catch (error) {
                    console.error('Error inviting member:', error);
                    return res.status(500).json({ success: false, message: 'Failed to send invite' });
                }
            }

            // Get invite details (public - no auth required)
            if (path === '/team/invite-details' && method === 'GET') {
                const inviteCode = req.query.code;

                if (!inviteCode) {
                    return res.status(400).json({ success: false, message: 'Invite code required' });
                }

                try {
                    const inviteSnapshot = await db.collection('teamInvites')
                        .where('inviteCode', '==', inviteCode)
                        .where('status', '==', 'pending')
                        .limit(1)
                        .get();

                    if (inviteSnapshot.empty) {
                        return res.status(404).json({ success: false, message: 'Invalid or expired invite' });
                    }

                    const invite = inviteSnapshot.docs[0].data();

                    // Check if expired
                    if (invite.expiresAt && new Date(invite.expiresAt.toDate()) < new Date()) {
                        return res.status(410).json({ success: false, message: 'This invite has expired' });
                    }

                    // Return limited info (don't expose sensitive data)
                    return res.status(200).json({
                        success: true,
                        data: {
                            teamName: invite.teamName,
                            inviterEmail: invite.inviterEmail,
                            role: invite.role,
                            expiresAt: invite.expiresAt
                        }
                    });
                } catch (error) {
                    console.error('Error fetching invite details:', error);
                    return res.status(500).json({ success: false, message: 'Failed to load invite' });
                }
            }

            // Accept team invite
            if (path === '/team/accept-invite' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { inviteCode } = req.body;

                if (!inviteCode) {
                    return res.status(400).json({ success: false, message: 'Invite code required' });
                }

                try {
                    // Find invite
                    const inviteSnapshot = await db.collection('teamInvites')
                        .where('inviteCode', '==', inviteCode)
                        .where('status', '==', 'pending')
                        .limit(1)
                        .get();

                    if (inviteSnapshot.empty) {
                        return res.status(404).json({ success: false, message: 'Invalid or expired invite' });
                    }

                    const inviteDoc = inviteSnapshot.docs[0];
                    const invite = inviteDoc.data();

                    // Check if invite expired
                    if (invite.expiresAt && new Date(invite.expiresAt.toDate()) < new Date()) {
                        await inviteDoc.ref.update({ status: 'expired' });
                        return res.status(400).json({ success: false, message: 'Invite has expired' });
                    }

                    // Check if user is already in another team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const userData = userDoc.exists ? userDoc.data() : {};

                    if (userData.teamId && userData.teamId !== invite.teamId) {
                        return res.status(400).json({ success: false, message: 'You are already part of another team' });
                    }

                    // Add user to team
                    await db.collection('teamMembers').add({
                        teamId: invite.teamId,
                        userId: decodedToken.uid,
                        email: decodedToken.email,
                        name: userData.displayName || decodedToken.email?.split('@')[0],
                        role: invite.role,
                        joinedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Update user with team ID
                    await db.collection('users').doc(decodedToken.uid).set({
                        teamId: invite.teamId
                    }, { merge: true });

                    // Mark invite as accepted
                    await inviteDoc.ref.update({
                        status: 'accepted',
                        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                        acceptedBy: decodedToken.uid
                    });

                    return res.status(200).json({
                        success: true,
                        message: `You've joined ${invite.teamName}!`,
                        data: { teamId: invite.teamId }
                    });
                } catch (error) {
                    console.error('Error accepting invite:', error);
                    return res.status(500).json({ success: false, message: 'Failed to accept invite' });
                }
            }

            // Update team member role
            if (path.match(/^\/team\/members\/[^/]+\/role$/) && method === 'PUT') {
                const memberId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { role } = req.body;
                const validRoles = ['admin', 'manager', 'member'];
                if (!validRoles.includes(role)) {
                    return res.status(400).json({ success: false, message: 'Invalid role' });
                }

                try {
                    // Get user's team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const teamId = userDoc.data()?.teamId;

                    if (!teamId) {
                        return res.status(400).json({ success: false, message: 'No team found' });
                    }

                    // Check if user is owner or admin
                    const callerMemberSnapshot = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .where('userId', '==', decodedToken.uid)
                        .limit(1)
                        .get();

                    const callerRole = callerMemberSnapshot.docs[0]?.data()?.role;
                    if (!['owner', 'admin'].includes(callerRole)) {
                        return res.status(403).json({ success: false, message: 'Only owners and admins can change roles' });
                    }

                    // Get target member
                    const memberDoc = await db.collection('teamMembers').doc(memberId).get();
                    if (!memberDoc.exists || memberDoc.data().teamId !== teamId) {
                        return res.status(404).json({ success: false, message: 'Member not found' });
                    }

                    // Cannot change owner's role
                    if (memberDoc.data().role === 'owner') {
                        return res.status(400).json({ success: false, message: 'Cannot change owner role' });
                    }

                    // Update role
                    await memberDoc.ref.update({ role });

                    return res.status(200).json({
                        success: true,
                        message: 'Role updated'
                    });
                } catch (error) {
                    console.error('Error updating role:', error);
                    return res.status(500).json({ success: false, message: 'Failed to update role' });
                }
            }

            // Remove team member
            if (path.match(/^\/team\/members\/[^/]+$/) && method === 'DELETE') {
                const memberId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    // Get user's team
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    const teamId = userDoc.data()?.teamId;

                    if (!teamId) {
                        return res.status(400).json({ success: false, message: 'No team found' });
                    }

                    // Check if user is owner or admin
                    const callerMemberSnapshot = await db.collection('teamMembers')
                        .where('teamId', '==', teamId)
                        .where('userId', '==', decodedToken.uid)
                        .limit(1)
                        .get();

                    const callerRole = callerMemberSnapshot.docs[0]?.data()?.role;
                    if (!['owner', 'admin'].includes(callerRole)) {
                        return res.status(403).json({ success: false, message: 'Only owners and admins can remove members' });
                    }

                    // Get target member
                    const memberDoc = await db.collection('teamMembers').doc(memberId).get();
                    if (!memberDoc.exists || memberDoc.data().teamId !== teamId) {
                        return res.status(404).json({ success: false, message: 'Member not found' });
                    }

                    // Cannot remove owner
                    if (memberDoc.data().role === 'owner') {
                        return res.status(400).json({ success: false, message: 'Cannot remove team owner' });
                    }

                    const removedUserId = memberDoc.data().userId;

                    // Remove member
                    await memberDoc.ref.delete();

                    // Remove team ID from user
                    if (removedUserId) {
                        await db.collection('users').doc(removedUserId).update({
                            teamId: admin.firestore.FieldValue.delete()
                        });
                    }

                    return res.status(200).json({
                        success: true,
                        message: 'Member removed'
                    });
                } catch (error) {
                    console.error('Error removing member:', error);
                    return res.status(500).json({ success: false, message: 'Failed to remove member' });
                }
            }

            // Cancel pending invite
            if (path.match(/^\/team\/invites\/[^/]+$/) && method === 'DELETE') {
                const inviteId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    const inviteDoc = await db.collection('teamInvites').doc(inviteId).get();
                    if (!inviteDoc.exists) {
                        return res.status(404).json({ success: false, message: 'Invite not found' });
                    }

                    const invite = inviteDoc.data();

                    // Verify user has permission
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    if (userDoc.data()?.teamId !== invite.teamId) {
                        return res.status(403).json({ success: false, message: 'Not authorized' });
                    }

                    await inviteDoc.ref.delete();

                    return res.status(200).json({
                        success: true,
                        message: 'Invite cancelled'
                    });
                } catch (error) {
                    console.error('Error cancelling invite:', error);
                    return res.status(500).json({ success: false, message: 'Failed to cancel invite' });
                }
            }

            // ========== SAVED SEARCHES ENDPOINTS ==========

            // Save a search
            if (path === '/market/saved-searches' && method === 'POST') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                const { name, city, state, zipCode, industry, subIndustry, companySize, radius } = req.body;

                if (!city || !state || !industry) {
                    return res.status(400).json({ success: false, message: 'City, state, and industry are required' });
                }

                try {
                    // Check if user already has this search saved
                    const existingQuery = await db.collection('savedSearches')
                        .where('userId', '==', decodedToken.uid)
                        .where('city', '==', city)
                        .where('state', '==', state)
                        .where('industry', '==', industry)
                        .limit(1)
                        .get();

                    if (!existingQuery.empty) {
                        return res.status(409).json({ success: false, message: 'Search already saved' });
                    }

                    // Save the search
                    const searchRef = await db.collection('savedSearches').add({
                        userId: decodedToken.uid,
                        name: name || `${city}, ${state} - ${industry}`,
                        city,
                        state,
                        zipCode: zipCode || null,
                        industry,
                        subIndustry: subIndustry || null,
                        companySize: companySize || 'medium',
                        radius: radius || 5000,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastRunAt: null
                    });

                    return res.status(201).json({
                        success: true,
                        message: 'Search saved',
                        data: { id: searchRef.id }
                    });
                } catch (error) {
                    console.error('Error saving search:', error);
                    return res.status(500).json({ success: false, message: 'Failed to save search' });
                }
            }

            // List saved searches
            if (path === '/market/saved-searches' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    const snapshot = await db.collection('savedSearches')
                        .where('userId', '==', decodedToken.uid)
                        .orderBy('createdAt', 'desc')
                        .limit(20)
                        .get();

                    const searches = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    return res.status(200).json({ success: true, data: searches });
                } catch (error) {
                    console.error('Error listing saved searches:', error);
                    return res.status(500).json({ success: false, message: 'Failed to load saved searches' });
                }
            }

            // Delete saved search
            if (path.match(/^\/market\/saved-searches\/[^/]+$/) && method === 'DELETE') {
                const searchId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    const searchRef = db.collection('savedSearches').doc(searchId);
                    const searchDoc = await searchRef.get();

                    if (!searchDoc.exists) {
                        return res.status(404).json({ success: false, message: 'Search not found' });
                    }

                    if (searchDoc.data().userId !== decodedToken.uid) {
                        return res.status(403).json({ success: false, message: 'Not authorized' });
                    }

                    await searchRef.delete();

                    return res.status(200).json({ success: true, message: 'Search deleted' });
                } catch (error) {
                    console.error('Error deleting saved search:', error);
                    return res.status(500).json({ success: false, message: 'Failed to delete search' });
                }
            }

            // Update lastRunAt when running a saved search
            if (path.match(/^\/market\/saved-searches\/[^/]+\/run$/) && method === 'POST') {
                const searchId = path.split('/')[3];
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }

                try {
                    const searchRef = db.collection('savedSearches').doc(searchId);
                    await searchRef.update({
                        lastRunAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return res.status(200).json({ success: true });
                } catch (error) {
                    console.error('Error updating saved search:', error);
                    return res.status(500).json({ success: false });
                }
            }

            // ========== LEAD CAPTURE ENDPOINTS (Public - No Auth) ==========

            // Generate free mini-report (lead magnet)
            if (path === '/leads/mini-report' && method === 'POST') {
                return await leadsApi.generateMiniReport(req, res);
            }

            // Get lead statistics (admin only)
            if (path === '/leads/stats' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                // Check if admin (you may want to add proper admin check)
                req.userId = decodedToken.uid;
                return await leadsApi.getLeadStats(req, res);
            }

            // Export leads as CSV (admin only)
            if (path === '/leads/export' && method === 'GET') {
                const decodedToken = await verifyAuth(req);
                if (!decodedToken) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                req.userId = decodedToken.uid;
                return await leadsApi.exportLeads(req, res);
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
                availableEndpoints: AVAILABLE_ENDPOINTS,
                legacyEndpoints: '(All endpoints also available without /api/v1 prefix for backward compatibility)'
            });

        } catch (error) {
            return handleError(error, res, `API ${method} ${path}`);
        }
    });
});
