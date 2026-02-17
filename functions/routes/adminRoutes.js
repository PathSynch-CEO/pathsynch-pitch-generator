/**
 * Admin Routes
 *
 * Consolidated admin routes for user management, discount codes, and pricing
 */

const { createRouter } = require('../utils/router');
const admin = require('firebase-admin');
const { getPlanLimits } = require('../config/stripe');

const db = admin.firestore();
const router = createRouter();

// Import existing admin API handlers
const adminApi = require('../api/admin');

// Import services
const discountService = require('../services/discountService');
const pricingService = require('../services/pricingService');

/**
 * Admin middleware - checks if user is in admins collection
 */
async function requireAdmin(req, res, next) {
    const userEmail = req.user?.email;

    if (!userEmail) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const adminDoc = await db.collection('admins')
            .doc(userEmail.toLowerCase())
            .get();

        if (!adminDoc.exists) {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        req.adminEmail = userEmail;
        req.adminRole = adminDoc.data().role;
        next();
    } catch (error) {
        console.error('Admin check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify admin access'
        });
    }
}

/**
 * Super admin middleware
 */
async function requireSuperAdmin(req, res, next) {
    if (req.adminRole !== 'super_admin') {
        return res.status(403).json({
            success: false,
            error: 'Super admin access required'
        });
    }
    next();
}

// ====================================
// Dashboard & Stats
// ====================================

router.get('/api/v1/admin/dashboard', requireAdmin, async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Get all users
        const usersSnapshot = await db.collection('users').get();
        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // User counts by plan
        const usersByPlan = {
            free: users.filter(u => !u.plan || u.plan === 'free' || u.tier === 'FREE' || u.tier === 'free').length,
            starter: users.filter(u => u.plan === 'starter' || u.tier === 'starter').length,
            growth: users.filter(u => u.plan === 'growth' || u.tier === 'growth').length,
            scale: users.filter(u => u.plan === 'scale' || u.tier === 'scale').length,
            enterprise: users.filter(u => u.plan === 'enterprise' || u.tier === 'enterprise').length
        };

        // Paid users (non-free)
        const paidUsers = users.filter(u => {
            const plan = (u.plan || u.tier || 'free').toLowerCase();
            return plan !== 'free';
        }).length;

        // Active users (logged in within 7 days)
        const activeUsers = users.filter(u => {
            const lastLogin = u.lastLoginAt?.toDate?.() || new Date(0);
            return lastLogin >= sevenDaysAgo;
        }).length;

        // New users this month
        const newUsersThisMonth = users.filter(u => {
            const created = u.createdAt?.toDate?.() || new Date(0);
            return created >= startOfMonth;
        }).length;

        // Inactive users (no login in 30+ days)
        const inactiveUsers = users
            .filter(u => {
                const lastLogin = u.lastLoginAt?.toDate?.() || u.createdAt?.toDate?.() || new Date(0);
                return lastLogin < thirtyDaysAgo;
            })
            .map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                lastLoginAt: u.lastLoginAt?.toDate?.() || null
            }))
            .slice(0, 20); // Limit to 20

        // Recent signups (last 10)
        const recentSignups = users
            .filter(u => u.createdAt)
            .sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0))
            .slice(0, 10)
            .map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                createdAt: u.createdAt?.toDate?.() || null
            }));

        // Get pitches
        const pitchesSnapshot = await db.collection('pitches').get();
        const pitches = pitchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const pitchesThisMonth = pitches.filter(p => {
            const created = p.createdAt?.toDate?.() || new Date(0);
            return created >= startOfMonth;
        }).length;

        // Recent pitches (last 10)
        const recentPitches = pitches
            .filter(p => p.createdAt)
            .sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0))
            .slice(0, 10)
            .map(p => ({
                id: p.id,
                name: p.prospectName || p.businessName || 'Untitled',
                company: p.prospectCompany || p.segment || '',
                createdAt: p.createdAt?.toDate?.() || null
            }));

        // Power users - users with most pitches
        const pitchCountByUser = {};
        pitches.forEach(p => {
            if (p.userId) {
                pitchCountByUser[p.userId] = (pitchCountByUser[p.userId] || 0) + 1;
            }
        });

        const powerUsers = Object.entries(pitchCountByUser)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, count]) => {
                const user = users.find(u => u.id === userId);
                return {
                    id: userId,
                    name: user?.name || 'Unknown',
                    email: user?.email || 'Unknown',
                    pitchCount: count
                };
            });

        // Users who have created at least one pitch
        const usersWithPitches = new Set(pitches.map(p => p.userId)).size;
        const activationRate = users.length > 0 ? Math.round((usersWithPitches / users.length) * 100) : 0;

        // Conversion rate (paid/total)
        const conversionRate = users.length > 0 ? Math.round((paidUsers / users.length) * 100) : 0;

        // Average pitches per user
        const avgPitchesPerUser = users.length > 0 ? Math.round((pitches.length / users.length) * 10) / 10 : 0;

        // Calculate MRR (simplified)
        const pricing = await pricingService.getPricing();
        const tiers = pricing.tiers || {};
        let mrr = 0;
        mrr += usersByPlan.starter * (tiers.starter?.monthlyPrice || 19);
        mrr += usersByPlan.growth * (tiers.growth?.monthlyPrice || 49);
        mrr += usersByPlan.scale * (tiers.scale?.monthlyPrice || 99);
        mrr += usersByPlan.enterprise * (tiers.enterprise?.monthlyPrice || 89);

        // ARPU (Average Revenue Per User, for paid users)
        const arpu = paidUsers > 0 ? Math.round(mrr / paidUsers) : 0;

        // Get ICP count from users' sellerProfile.icps arrays
        const totalIcps = users.reduce((sum, u) => {
            return sum + (u.sellerProfile?.icps?.length || 0);
        }, 0);

        return res.status(200).json({
            success: true,
            data: {
                totalUsers: users.length,
                activeUsers,
                newUsersThisMonth,
                usersByPlan,
                paidUsers,
                totalPitches: pitches.length,
                pitchesThisMonth,
                totalIcps,
                mrr,
                arpu,
                activationRate,
                conversionRate,
                avgPitchesPerUser,
                recentSignups,
                recentPitches,
                powerUsers,
                inactiveUsers,
                inactiveCount: inactiveUsers.length
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load dashboard'
        });
    }
});

// ====================================
// User Management
// ====================================

router.get('/api/v1/admin/users', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const tier = req.query.tier;
        const search = req.query.search;

        let query = db.collection('users').orderBy('createdAt', 'desc');

        // Note: Firestore doesn't support OR queries well, so tier filtering is done post-fetch
        const snapshot = await query.limit(500).get(); // Get more than we need for filtering

        // Get pitch counts for all users efficiently
        const pitchesSnapshot = await db.collection('pitches').select('userId').get();
        const pitchCountByUser = {};
        pitchesSnapshot.docs.forEach(doc => {
            const userId = doc.data().userId;
            if (userId) {
                pitchCountByUser[userId] = (pitchCountByUser[userId] || 0) + 1;
            }
        });

        let users = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                email: data.email,
                name: data.name,
                tier: data.plan || data.tier || 'free',
                pitchCount: pitchCountByUser[doc.id] || 0,
                createdAt: data.createdAt?.toDate?.() || null,
                lastLoginAt: data.lastLoginAt?.toDate?.() || null,
                adminNotes: data.adminNotes
            };
        });

        // Filter by tier
        if (tier) {
            users = users.filter(u => u.tier === tier);
        }

        // Search filter
        if (search) {
            const searchLower = search.toLowerCase();
            users = users.filter(u =>
                (u.email && u.email.toLowerCase().includes(searchLower)) ||
                (u.name && u.name.toLowerCase().includes(searchLower))
            );
        }

        const total = users.length;

        // Paginate
        const offset = (page - 1) * limit;
        users = users.slice(offset, offset + limit);

        return res.status(200).json({
            success: true,
            users,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('List users error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list users'
        });
    }
});

router.get('/api/v1/admin/users/:userId', requireAdmin, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.params.userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const userData = userDoc.data();

        // Get pitch count
        const pitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', req.params.userId)
            .get();

        // Get ICP count from user's sellerProfile.icps array
        const icpCount = userData.sellerProfile?.icps?.length || 0;

        // Get login count (if tracked)
        const loginCount = userData.loginCount || 0;

        return res.status(200).json({
            success: true,
            data: {
                id: userDoc.id,
                ...userData,
                createdAt: userData.createdAt?.toDate?.() || null,
                lastLoginAt: userData.lastLoginAt?.toDate?.() || null,
                pitchCount: pitchesSnapshot.size,
                icpCount,
                loginCount
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get user'
        });
    }
});

router.put('/api/v1/admin/users/:userId/plan', requireAdmin, async (req, res) => {
    try {
        const { tier, freeMonths, notes } = req.body;
        const userId = req.params.userId;

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const updates = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.adminEmail
        };

        if (tier) {
            updates.plan = tier;
            updates.tier = tier;
        }

        if (freeMonths > 0) {
            // Add free months to subscription end date
            const currentEnd = userDoc.data().subscriptionEnd?.toDate?.() || new Date();
            const newEnd = new Date(currentEnd);
            newEnd.setMonth(newEnd.getMonth() + freeMonths);
            updates.subscriptionEnd = newEnd;
            updates.freeMonthsGranted = admin.firestore.FieldValue.increment(freeMonths);
        }

        if (notes !== undefined) {
            updates.adminNotes = notes;
        }

        await userRef.update(updates);

        return res.status(200).json({
            success: true,
            message: 'User updated successfully'
        });
    } catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update user'
        });
    }
});

// ====================================
// Discount Codes
// ====================================

router.post('/api/v1/admin/discount-codes', requireAdmin, async (req, res) => {
    try {
        const code = await discountService.createCode({
            ...req.body,
            createdBy: req.adminEmail
        });

        return res.status(201).json({
            success: true,
            data: code
        });
    } catch (error) {
        console.error('Create code error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create code'
        });
    }
});

router.get('/api/v1/admin/discount-codes', requireAdmin, async (req, res) => {
    try {
        const includeExpired = req.query.includeExpired === 'true';
        const codes = await discountService.listCodes({ includeExpired });

        return res.status(200).json({
            success: true,
            data: codes
        });
    } catch (error) {
        console.error('List codes error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list codes'
        });
    }
});

router.put('/api/v1/admin/discount-codes/:codeId/toggle', requireAdmin, async (req, res) => {
    try {
        const { isActive } = req.body;
        await discountService.toggleCode(req.params.codeId, isActive);

        return res.status(200).json({
            success: true,
            message: `Code ${isActive ? 'enabled' : 'disabled'}`
        });
    } catch (error) {
        console.error('Toggle code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to toggle code'
        });
    }
});

router.delete('/api/v1/admin/discount-codes/:codeId', requireAdmin, async (req, res) => {
    try {
        await discountService.deleteCode(req.params.codeId);

        return res.status(200).json({
            success: true,
            message: 'Code deleted'
        });
    } catch (error) {
        console.error('Delete code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete code'
        });
    }
});

// Public endpoint for code validation
router.post('/api/v1/discount-codes/validate', async (req, res) => {
    try {
        const { code, tier, userId } = req.body;
        const result = await discountService.validateCode(code, userId, tier);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Validate code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to validate code'
        });
    }
});

// Public endpoint for code redemption
router.post('/api/v1/discount-codes/redeem', async (req, res) => {
    try {
        const { code, userId, userEmail, tier } = req.body;
        const result = await discountService.redeemCode(code, userId, userEmail, tier);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Redeem code error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to redeem code'
        });
    }
});

router.get('/api/v1/admin/redemptions', requireAdmin, async (req, res) => {
    try {
        const codeId = req.query.codeId;
        const redemptions = await discountService.getRedemptions(codeId);

        return res.status(200).json({
            success: true,
            data: redemptions
        });
    } catch (error) {
        console.error('Get redemptions error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get redemptions'
        });
    }
});

// ====================================
// Pricing Management
// ====================================

router.get('/api/v1/admin/pricing', requireAdmin, async (req, res) => {
    try {
        const pricing = await pricingService.getPricing();

        return res.status(200).json({
            success: true,
            data: pricing
        });
    } catch (error) {
        console.error('Get pricing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get pricing'
        });
    }
});

router.put('/api/v1/admin/pricing', requireAdmin, async (req, res) => {
    try {
        await pricingService.updatePricing(req.body, req.adminEmail);

        return res.status(200).json({
            success: true,
            message: 'Pricing updated'
        });
    } catch (error) {
        console.error('Update pricing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update pricing'
        });
    }
});

// Public pricing endpoint (for marketing site)
router.get('/api/v1/pricing', async (req, res) => {
    try {
        const pricing = await pricingService.getPricing();

        return res.status(200).json({
            success: true,
            data: pricing.tiers
        });
    } catch (error) {
        console.error('Get public pricing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get pricing'
        });
    }
});

// ====================================
// Admin Management (super_admin only)
// ====================================

router.get('/api/v1/admin/admins', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('admins').orderBy('addedAt', 'desc').get();

        const admins = snapshot.docs.map(doc => ({
            email: doc.id,
            ...doc.data(),
            addedAt: doc.data().addedAt?.toDate?.() || null
        }));

        return res.status(200).json({
            success: true,
            data: admins
        });
    } catch (error) {
        console.error('List admins error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list admins'
        });
    }
});

router.post('/api/v1/admin/admins', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const { email, role } = req.body;

        if (!email || !['admin', 'support', 'super_admin'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email or role'
            });
        }

        await db.collection('admins').doc(email.toLowerCase()).set({
            email: email.toLowerCase(),
            role,
            addedBy: req.adminEmail,
            addedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(201).json({
            success: true,
            message: 'Admin added'
        });
    } catch (error) {
        console.error('Add admin error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to add admin'
        });
    }
});

router.delete('/api/v1/admin/admins/:email', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();

        if (email === req.adminEmail.toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'Cannot remove yourself'
            });
        }

        await db.collection('admins').doc(email).delete();

        return res.status(200).json({
            success: true,
            message: 'Admin removed'
        });
    } catch (error) {
        console.error('Remove admin error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to remove admin'
        });
    }
});

// ====================================
// Existing admin API routes
// ====================================

router.get('/api/v1/admin/stats', requireAdmin, adminApi.getStats);
router.get('/api/v1/admin/revenue', requireAdmin, adminApi.getRevenue);
router.get('/api/v1/admin/pitches', requireAdmin, adminApi.listPitches);
router.get('/api/v1/admin/usage', requireAdmin, adminApi.getUsageAnalytics);

// ====================================
// Bootstrap Admin (requires secret key)
// ====================================

router.post('/api/v1/bootstrap-admin', adminApi.bootstrapAdmin);

module.exports = router;
