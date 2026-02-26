/**
 * Visitor Routes
 *
 * API endpoints for website visitor identification.
 * Tracks visitors to seller websites and resolves IPs to companies.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// IPinfo.io API token (from environment)
const IPINFO_TOKEN = process.env.IPINFO_TOKEN;

// Visitor limits by tier
const VISITOR_LIMITS = {
    free: 0,        // Not available
    starter: 50,    // Per month
    growth: 500,    // Per month
    scale: -1,      // Unlimited
    enterprise: -1
};

// Cache TTL (30 days in milliseconds)
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * Hash IP address for privacy-compliant storage
 */
function hashIP(ip) {
    return crypto.createHash('sha256').update(ip + 'synchintro-visitor-salt').digest('hex').substring(0, 32);
}

/**
 * Generate a unique snippet key for a user
 */
function generateSnippetKey(userId) {
    return crypto.createHash('sha256').update(userId + 'synchintro-snippet-key').digest('hex').substring(0, 24);
}

/**
 * Get user ID from snippet key
 */
async function getUserIdFromSnippetKey(snippetKey) {
    // Look up the user by their snippet key
    const usersSnapshot = await db.collection('users')
        .where('visitorSnippetKey', '==', snippetKey)
        .limit(1)
        .get();

    if (usersSnapshot.empty) {
        return null;
    }

    return usersSnapshot.docs[0].id;
}

/**
 * Get user's tier and check visitor limits
 */
async function getUserTierAndCheckLimit(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const tier = (userData.tier || userData.plan || 'starter').toLowerCase();

    const limit = VISITOR_LIMITS[tier];

    // Free tier has no access
    if (limit === 0) {
        return {
            tier,
            visitorsThisMonth: 0,
            limit: 0,
            hasAccess: false,
            atLimit: true
        };
    }

    // Get current month's visitor count
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const visitorsSnapshot = await db.collection('websiteVisitors')
        .where('userId', '==', userId)
        .where('firstSeenAt', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
        .get();

    const visitorsThisMonth = visitorsSnapshot.size;

    return {
        tier,
        visitorsThisMonth,
        limit,
        hasAccess: true,
        atLimit: limit !== -1 && visitorsThisMonth >= limit
    };
}

/**
 * Resolve IP to company using IPinfo.io
 */
async function resolveIPToCompany(ip) {
    // Check cache first
    const ipHash = hashIP(ip);
    const cacheDoc = await db.collection('ipCache').doc(ipHash).get();

    if (cacheDoc.exists) {
        const cached = cacheDoc.data();
        const cacheAge = Date.now() - (cached.cachedAt?.toDate?.()?.getTime() || 0);

        if (cacheAge < CACHE_TTL) {
            return cached.company;
        }
    }

    // Call IPinfo.io API
    if (!IPINFO_TOKEN) {
        console.warn('IPINFO_TOKEN not configured');
        return null;
    }

    try {
        const response = await axios.get(`https://ipinfo.io/${ip}?token=${IPINFO_TOKEN}`, {
            timeout: 5000
        });

        const data = response.data;

        // Extract company info
        const company = {
            name: data.company?.name || data.org || null,
            domain: data.company?.domain || null,
            type: data.company?.type || null,
            industry: data.company?.industry || null,
            employeeRange: null,
            location: data.city ? `${data.city}, ${data.region}, ${data.country}` : data.country || null,
            isHosting: data.privacy?.hosting || false,
            isProxy: data.privacy?.proxy || false,
            isVpn: data.privacy?.vpn || false
        };

        // Don't cache hosting/proxy/VPN IPs as they're not useful
        if (company.isHosting || company.isProxy || company.isVpn) {
            return null;
        }

        // Cache the result
        await db.collection('ipCache').doc(ipHash).set({
            ip: ipHash, // Store hash, not actual IP
            company,
            cachedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return company;
    } catch (error) {
        console.error('IPinfo API error:', error.message);
        return null;
    }
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /visitors/track
 * Track a website visitor (public endpoint, no auth)
 */
router.post('/visitors/track', async (req, res) => {
    try {
        const { snippetKey, page, referrer, userAgent } = req.body;

        if (!snippetKey) {
            return res.status(400).json({ success: false, error: 'snippetKey required' });
        }

        // Get user ID from snippet key
        const userId = await getUserIdFromSnippetKey(snippetKey);
        if (!userId) {
            return res.status(404).json({ success: false, error: 'Invalid snippet key' });
        }

        // Check user limits
        const userStatus = await getUserTierAndCheckLimit(userId);
        if (!userStatus.hasAccess) {
            return res.status(200).json({ success: true, tracked: false, reason: 'tier_restricted' });
        }

        // Get visitor IP
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        // Skip private/local IPs
        if (ip === 'unknown' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('127.') || ip === '::1') {
            return res.status(200).json({ success: true, tracked: false, reason: 'private_ip' });
        }

        const ipHash = hashIP(ip);

        // Resolve IP to company
        const company = await resolveIPToCompany(ip);

        if (!company || !company.name) {
            return res.status(200).json({ success: true, tracked: false, reason: 'unknown_company' });
        }

        // Check if we're at the limit for new visitors
        if (userStatus.atLimit) {
            // Still track visits for existing visitors, just don't create new ones
            const existingVisitor = await db.collection('websiteVisitors')
                .where('userId', '==', userId)
                .where('ipHash', '==', ipHash)
                .limit(1)
                .get();

            if (existingVisitor.empty) {
                return res.status(200).json({ success: true, tracked: false, reason: 'limit_reached' });
            }
        }

        // Check if visitor already exists
        const existingSnapshot = await db.collection('websiteVisitors')
            .where('userId', '==', userId)
            .where('ipHash', '==', ipHash)
            .limit(1)
            .get();

        if (!existingSnapshot.empty) {
            // Update existing visitor
            const visitorDoc = existingSnapshot.docs[0];
            const visitorData = visitorDoc.data();

            const uniquePages = visitorData.uniquePages || [];
            if (page && !uniquePages.includes(page)) {
                uniquePages.push(page);
            }

            await visitorDoc.ref.update({
                totalVisits: admin.firestore.FieldValue.increment(1),
                uniquePages: uniquePages.slice(-20), // Keep last 20 pages
                lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(200).json({ success: true, tracked: true, existing: true });
        }

        // Create new visitor
        const visitorRef = db.collection('websiteVisitors').doc();
        await visitorRef.set({
            id: visitorRef.id,
            userId,
            ipHash,
            companyName: company.name,
            companyDomain: company.domain || null,
            industry: company.industry || null,
            employeeRange: company.employeeRange || null,
            location: company.location || null,
            totalVisits: 1,
            uniquePages: page ? [page] : [],
            firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            pitchGenerated: false,
            pitchId: null,
            briefGenerated: false,
            briefId: null,
            status: 'new',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, tracked: true, existing: false });

    } catch (error) {
        console.error('Visitor tracking error:', error.message);
        return res.status(500).json({ success: false });
    }
});

/**
 * GET /visitors
 * List visitors for authenticated user
 */
router.get('/visitors', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        // Check access
        const userStatus = await getUserTierAndCheckLimit(userId);
        if (!userStatus.hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'FEATURE_NOT_AVAILABLE',
                message: 'Website Visitor Intel is not available on your current plan. Upgrade to Starter or higher.'
            });
        }

        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status; // 'new', 'pitched', 'dismissed'

        let query = db.collection('websiteVisitors')
            .where('userId', '==', userId)
            .orderBy('lastSeenAt', 'desc')
            .limit(limit);

        if (status) {
            query = db.collection('websiteVisitors')
                .where('userId', '==', userId)
                .where('status', '==', status)
                .orderBy('lastSeenAt', 'desc')
                .limit(limit);
        }

        const snapshot = await query.get();
        const visitors = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                firstSeenAt: data.firstSeenAt?.toDate?.() || null,
                lastSeenAt: data.lastSeenAt?.toDate?.() || null
            };
        });

        return res.status(200).json({
            success: true,
            data: visitors,
            limits: {
                used: userStatus.visitorsThisMonth,
                limit: userStatus.limit,
                remaining: userStatus.limit === -1 ? -1 : Math.max(0, userStatus.limit - userStatus.visitorsThisMonth)
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /visitors');
    }
});

/**
 * PUT /visitors/:id
 * Update visitor status
 */
router.put('/visitors/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const visitorId = req.params.id;
        const visitorDoc = await db.collection('websiteVisitors').doc(visitorId).get();

        if (!visitorDoc.exists) {
            throw new ApiError('Visitor not found', 404, ErrorCodes.NOT_FOUND);
        }

        const visitorData = visitorDoc.data();

        if (visitorData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        // Only allow updating specific fields
        const allowedFields = ['status', 'pitchGenerated', 'pitchId', 'briefGenerated', 'briefId'];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('websiteVisitors').doc(visitorId).update(updates);

        return res.status(200).json({
            success: true,
            message: 'Visitor updated successfully'
        });

    } catch (error) {
        return handleError(error, res, 'PUT /visitors/:id');
    }
});

/**
 * GET /visitors/snippet
 * Get user's tracking snippet
 */
router.get('/visitors/snippet', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        // Check access
        const userStatus = await getUserTierAndCheckLimit(userId);
        if (!userStatus.hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'FEATURE_NOT_AVAILABLE',
                message: 'Website Visitor Intel is not available on your current plan. Upgrade to Starter or higher.'
            });
        }

        // Get or create snippet key
        const userDoc = await db.collection('users').doc(userId).get();
        let snippetKey = userDoc.data()?.visitorSnippetKey;

        if (!snippetKey) {
            snippetKey = generateSnippetKey(userId);
            await db.collection('users').doc(userId).update({
                visitorSnippetKey: snippetKey
            });
        }

        // Generate the snippet code
        const snippet = `<!-- SynchIntro Visitor Tracking -->
<script>
(function() {
  var s = '${snippetKey}';
  var d = document, w = window;
  var t = function() {
    var x = new XMLHttpRequest();
    x.open('POST', 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/visitors/track', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({
      snippetKey: s,
      page: w.location.pathname,
      referrer: d.referrer,
      userAgent: navigator.userAgent
    }));
  };
  if (d.readyState === 'complete') t();
  else w.addEventListener('load', t);
})();
</script>`;

        return res.status(200).json({
            success: true,
            data: {
                snippetKey,
                snippet,
                limits: {
                    used: userStatus.visitorsThisMonth,
                    limit: userStatus.limit,
                    remaining: userStatus.limit === -1 ? -1 : Math.max(0, userStatus.limit - userStatus.visitorsThisMonth)
                }
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /visitors/snippet');
    }
});

/**
 * DELETE /visitors/:id
 * Delete a visitor record
 */
router.delete('/visitors/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const visitorId = req.params.id;
        const visitorDoc = await db.collection('websiteVisitors').doc(visitorId).get();

        if (!visitorDoc.exists) {
            throw new ApiError('Visitor not found', 404, ErrorCodes.NOT_FOUND);
        }

        const visitorData = visitorDoc.data();

        if (visitorData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        await db.collection('websiteVisitors').doc(visitorId).delete();

        return res.status(200).json({
            success: true,
            message: 'Visitor deleted successfully'
        });

    } catch (error) {
        return handleError(error, res, 'DELETE /visitors/:id');
    }
});

module.exports = router;
