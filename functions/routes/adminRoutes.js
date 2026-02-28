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

/**
 * Manager or higher middleware
 */
async function requireManager(req, res, next) {
    if (!['super_admin', 'manager'].includes(req.adminRole)) {
        return res.status(403).json({
            success: false,
            error: 'Manager access required'
        });
    }
    next();
}

/**
 * Role definitions and permissions
 */
const ROLE_HIERARCHY = {
    super_admin: 3,
    manager: 2,
    billing: 1
};

const ROLE_LABELS = {
    super_admin: 'Super Admin',
    manager: 'Manager',
    billing: 'Billing'
};

/**
 * Check if a role can manage another role
 */
function canManageRole(actorRole, targetRole) {
    // Super admin can manage everyone except themselves
    if (actorRole === 'super_admin') return targetRole !== 'super_admin';
    // Manager can only invite/manage billing
    if (actorRole === 'manager') return targetRole === 'billing';
    // Billing can't manage anyone
    return false;
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
    console.log('=== ADMIN USERS ENDPOINT HIT ===');
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const tier = req.query.tier;
        const search = req.query.search;
        console.log(`[Admin Users] page=${page}, limit=${limit}, tier=${tier}, search=${search}`);

        let query = db.collection('users').orderBy('createdAt', 'desc');

        // Note: Firestore doesn't support OR queries well, so tier filtering is done post-fetch
        const snapshot = await query.limit(500).get(); // Get more than we need for filtering

        // Get pitch counts for all users efficiently
        const pitchesSnapshot = await db.collection('pitches').get();
        const pitchCountByUser = {};
        console.log(`[Admin Users] Found ${pitchesSnapshot.size} total pitches`);

        pitchesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const odId = data.odId || data.odID;  // Check for odId field
            const userId = data.userId || odId;
            if (userId) {
                pitchCountByUser[userId] = (pitchCountByUser[userId] || 0) + 1;
            }
        });

        console.log(`[Admin Users] Pitch counts by user:`, JSON.stringify(pitchCountByUser).substring(0, 500));

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

        // Debug: Log first few users with pitch counts
        console.log(`[Admin Users] Returning ${users.length} users. First 3:`,
            users.slice(0, 3).map(u => ({ id: u.id, name: u.name, pitchCount: u.pitchCount })));

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

router.put('/api/v1/admin/pricing', requireAdmin, requireSuperAdmin, async (req, res) => {
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
// Admin Team Management
// ====================================

/**
 * Get list of all admins
 * Super admin sees all, manager sees billing only
 */
router.get('/api/v1/admin/admins', requireAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('admins').orderBy('addedAt', 'desc').get();

        let admins = snapshot.docs.map(doc => ({
            email: doc.id,
            ...doc.data(),
            addedAt: doc.data().addedAt?.toDate?.() || null,
            roleLabel: ROLE_LABELS[doc.data().role] || doc.data().role
        }));

        // Managers can only see billing admins (and themselves)
        if (req.adminRole === 'manager') {
            admins = admins.filter(a =>
                a.role === 'billing' || a.email === req.adminEmail.toLowerCase()
            );
        }

        // Billing admins can only see themselves
        if (req.adminRole === 'billing') {
            admins = admins.filter(a => a.email === req.adminEmail.toLowerCase());
        }

        return res.status(200).json({
            success: true,
            data: admins,
            currentRole: req.adminRole,
            roleLabels: ROLE_LABELS
        });
    } catch (error) {
        console.error('List admins error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list admins'
        });
    }
});

/**
 * Get available roles for inviting
 */
router.get('/api/v1/admin/roles', requireAdmin, async (req, res) => {
    const availableRoles = [];

    if (req.adminRole === 'super_admin') {
        availableRoles.push(
            { value: 'manager', label: 'Manager' },
            { value: 'billing', label: 'Billing' }
        );
    } else if (req.adminRole === 'manager') {
        availableRoles.push(
            { value: 'billing', label: 'Billing' }
        );
    }

    return res.status(200).json({
        success: true,
        data: availableRoles,
        currentRole: req.adminRole,
        currentRoleLabel: ROLE_LABELS[req.adminRole]
    });
});

/**
 * Invite a new admin
 * Super admin can invite manager or billing
 * Manager can only invite billing
 */
router.post('/api/v1/admin/admins', requireAdmin, async (req, res) => {
    try {
        const { email, role } = req.body;

        // Validate role
        const validRoles = ['manager', 'billing'];
        if (!email || !validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email or role. Valid roles: manager, billing'
            });
        }

        // Check if actor can invite this role
        if (!canManageRole(req.adminRole, role)) {
            return res.status(403).json({
                success: false,
                error: `Your role (${ROLE_LABELS[req.adminRole]}) cannot invite ${ROLE_LABELS[role]} users`
            });
        }

        // Check if admin already exists
        const existingDoc = await db.collection('admins').doc(email.toLowerCase()).get();
        if (existingDoc.exists) {
            return res.status(400).json({
                success: false,
                error: 'This email is already an admin'
            });
        }

        // Create the admin record
        await db.collection('admins').doc(email.toLowerCase()).set({
            email: email.toLowerCase(),
            role,
            status: 'invited',
            addedBy: req.adminEmail,
            addedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // TODO: Send invitation email via SendGrid
        // For now, they just need to log in with this email

        return res.status(201).json({
            success: true,
            message: `${ROLE_LABELS[role]} invitation sent to ${email}`,
            data: {
                email: email.toLowerCase(),
                role,
                roleLabel: ROLE_LABELS[role]
            }
        });
    } catch (error) {
        console.error('Invite admin error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to invite admin'
        });
    }
});

/**
 * Update admin role
 * Only super_admin can change roles
 */
router.put('/api/v1/admin/admins/:email/role', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const { role } = req.body;

        // Validate role
        const validRoles = ['manager', 'billing'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role. Valid roles: manager, billing'
            });
        }

        // Cannot change super_admin role
        const adminDoc = await db.collection('admins').doc(email).get();
        if (!adminDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Admin not found'
            });
        }

        if (adminDoc.data().role === 'super_admin') {
            return res.status(400).json({
                success: false,
                error: 'Cannot change Super Admin role'
            });
        }

        await db.collection('admins').doc(email).update({
            role,
            updatedBy: req.adminEmail,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            message: `Role updated to ${ROLE_LABELS[role]}`
        });
    } catch (error) {
        console.error('Update admin role error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update role'
        });
    }
});

/**
 * Remove an admin
 * Super admin can remove anyone except themselves
 * Manager can only remove billing
 */
router.delete('/api/v1/admin/admins/:email', requireAdmin, async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();

        // Cannot remove yourself
        if (email === req.adminEmail.toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'Cannot remove yourself'
            });
        }

        // Check target admin exists and get their role
        const adminDoc = await db.collection('admins').doc(email).get();
        if (!adminDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Admin not found'
            });
        }

        const targetRole = adminDoc.data().role;

        // Check if actor can remove this role
        if (!canManageRole(req.adminRole, targetRole)) {
            return res.status(403).json({
                success: false,
                error: `Your role (${ROLE_LABELS[req.adminRole]}) cannot remove ${ROLE_LABELS[targetRole]} users`
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
// Outbound Client Management
// ====================================

/**
 * Get all outbound clients
 */
router.get('/api/v1/admin/outbound-clients', requireAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('outboundClients')
            .orderBy('createdAt', 'desc')
            .get();

        const clients = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || null,
            startDate: doc.data().startDate?.toDate?.() || null,
            updatedAt: doc.data().updatedAt?.toDate?.() || null
        }));

        return res.status(200).json({
            success: true,
            data: clients
        });
    } catch (error) {
        console.error('Get outbound clients error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get outbound clients'
        });
    }
});

/**
 * Get single outbound client
 */
router.get('/api/v1/admin/outbound-clients/:clientId', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('outboundClients').doc(req.params.clientId).get();

        if (!doc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate?.() || null,
                startDate: doc.data().startDate?.toDate?.() || null,
                updatedAt: doc.data().updatedAt?.toDate?.() || null
            }
        });
    } catch (error) {
        console.error('Get outbound client error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get outbound client'
        });
    }
});

/**
 * Create new outbound client
 */
router.post('/api/v1/admin/outbound-clients', requireAdmin, async (req, res) => {
    try {
        const { companyName, contactName, contactEmail, userId, plan, icps, notes } = req.body;

        if (!companyName || !contactName || !contactEmail || !plan) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Plan configurations
        const planConfig = {
            launch: { monthlyPrice: 1999, prospectsPerMonth: 500, icpCount: 1 },
            scale: { monthlyPrice: 2999, prospectsPerMonth: 2000, icpCount: 3 }
        };

        const config = planConfig[plan] || planConfig.launch;

        const clientData = {
            userId: userId || null,
            companyName,
            contactName,
            contactEmail,
            plan,
            monthlyPrice: config.monthlyPrice,
            prospectsPerMonth: config.prospectsPerMonth,
            icpCount: config.icpCount,
            status: 'onboarding',
            startDate: admin.firestore.FieldValue.serverTimestamp(),
            nextBillingDate: null,
            pausedAt: null,
            churnedAt: null,
            stats: {
                currentMonth: {
                    emailsSent: 0,
                    opens: 0,
                    openRate: 0,
                    replies: 0,
                    replyRate: 0,
                    positiveReplies: 0,
                    meetingsBooked: 0,
                    prospectsContacted: 0
                },
                allTime: {
                    totalEmailsSent: 0,
                    totalReplies: 0,
                    totalMeetingsBooked: 0,
                    avgOpenRate: 0,
                    avgReplyRate: 0,
                    monthsActive: 0
                }
            },
            assets: {
                briefsGenerated: 0,
                pitchesGenerated: 0,
                marketReportsRun: 0,
                lastAssetDate: null
            },
            icps: (icps || []).slice(0, config.icpCount),
            notes: notes || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.adminEmail,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('outboundClients').add(clientData);

        return res.status(201).json({
            success: true,
            data: { id: docRef.id, ...clientData }
        });
    } catch (error) {
        console.error('Create outbound client error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create outbound client'
        });
    }
});

/**
 * Update outbound client
 */
router.patch('/api/v1/admin/outbound-clients/:clientId', requireAdmin, async (req, res) => {
    try {
        const clientRef = db.collection('outboundClients').doc(req.params.clientId);
        const doc = await clientRef.get();

        if (!doc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        const { status, notes, plan, icps } = req.body;
        const updates = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.adminEmail
        };

        if (status) {
            updates.status = status;
            if (status === 'paused') {
                updates.pausedAt = admin.firestore.FieldValue.serverTimestamp();
            } else if (status === 'churned') {
                updates.churnedAt = admin.firestore.FieldValue.serverTimestamp();
            } else if (status === 'active') {
                updates.pausedAt = null;
            }
        }

        if (notes !== undefined) {
            updates.notes = notes;
        }

        if (plan) {
            const planConfig = {
                launch: { monthlyPrice: 1999, prospectsPerMonth: 500, icpCount: 1 },
                scale: { monthlyPrice: 2999, prospectsPerMonth: 2000, icpCount: 3 }
            };
            const config = planConfig[plan] || planConfig.launch;
            updates.plan = plan;
            updates.monthlyPrice = config.monthlyPrice;
            updates.prospectsPerMonth = config.prospectsPerMonth;
            updates.icpCount = config.icpCount;
        }

        if (icps) {
            updates.icps = icps;
        }

        await clientRef.update(updates);

        return res.status(200).json({
            success: true,
            message: 'Client updated'
        });
    } catch (error) {
        console.error('Update outbound client error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update outbound client'
        });
    }
});

/**
 * Update outbound client campaign stats
 */
router.patch('/api/v1/admin/outbound-clients/:clientId/stats', requireAdmin, async (req, res) => {
    try {
        const clientRef = db.collection('outboundClients').doc(req.params.clientId);
        const doc = await clientRef.get();

        if (!doc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        const { emailsSent, opens, replies, positiveReplies, meetingsBooked, prospectsContacted } = req.body;
        const clientData = doc.data();

        // Calculate rates
        const openRate = emailsSent > 0 ? (opens / emailsSent) * 100 : 0;
        const replyRate = emailsSent > 0 ? (replies / emailsSent) * 100 : 0;

        // Update current month stats
        const currentMonth = {
            emailsSent: emailsSent || 0,
            opens: opens || 0,
            openRate: Math.round(openRate * 10) / 10,
            replies: replies || 0,
            replyRate: Math.round(replyRate * 10) / 10,
            positiveReplies: positiveReplies || 0,
            meetingsBooked: meetingsBooked || 0,
            prospectsContacted: prospectsContacted || 0
        };

        // Update all-time aggregates
        const allTime = clientData.stats?.allTime || {};
        const updatedAllTime = {
            totalEmailsSent: (allTime.totalEmailsSent || 0) + (emailsSent || 0),
            totalReplies: (allTime.totalReplies || 0) + (replies || 0),
            totalMeetingsBooked: (allTime.totalMeetingsBooked || 0) + (meetingsBooked || 0),
            avgOpenRate: openRate, // Simplified - could track weighted average
            avgReplyRate: replyRate,
            monthsActive: allTime.monthsActive || 1
        };

        await clientRef.update({
            'stats.currentMonth': currentMonth,
            'stats.allTime': updatedAllTime,
            'stats.lastUpdated': admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.adminEmail
        });

        return res.status(200).json({
            success: true,
            message: 'Stats updated'
        });
    } catch (error) {
        console.error('Update stats error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update stats'
        });
    }
});

/**
 * Delete (soft) outbound client
 */
router.delete('/api/v1/admin/outbound-clients/:clientId', requireAdmin, async (req, res) => {
    try {
        const clientRef = db.collection('outboundClients').doc(req.params.clientId);
        const doc = await clientRef.get();

        if (!doc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        // Soft delete by setting status to churned
        await clientRef.update({
            status: 'churned',
            churnedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.adminEmail
        });

        return res.status(200).json({
            success: true,
            message: 'Client marked as churned'
        });
    } catch (error) {
        console.error('Delete outbound client error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete client'
        });
    }
});

// ====================================
// Agent Monitoring
// ====================================

/**
 * Get agent execution logs
 */
router.get('/api/v1/admin/agent-logs', requireAdmin, async (req, res) => {
    try {
        const { agentType, status, userId, limit = 50, offset = 0 } = req.query;

        let query = db.collection('agentLogs')
            .orderBy('startedAt', 'desc');

        if (agentType) {
            query = query.where('agentType', '==', agentType);
        }
        if (status) {
            query = query.where('status', '==', status);
        }
        if (userId) {
            query = query.where('userId', '==', userId);
        }

        const snapshot = await query
            .limit(parseInt(limit))
            .offset(parseInt(offset))
            .get();

        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            startedAt: doc.data().startedAt?.toDate?.() || null,
            completedAt: doc.data().completedAt?.toDate?.() || null
        }));

        return res.status(200).json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error('Get agent logs error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get agent logs'
        });
    }
});

/**
 * Get agent statistics
 */
router.get('/api/v1/admin/agent-stats', requireAdmin, async (req, res) => {
    try {
        const { period = 'week' } = req.query;

        // Calculate date ranges
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfWeek.getDate() - 7);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Get logs for this month
        const snapshot = await db.collection('agentLogs')
            .where('startedAt', '>=', startOfMonth)
            .orderBy('startedAt', 'desc')
            .get();

        const logs = snapshot.docs.map(doc => ({
            ...doc.data(),
            startedAt: doc.data().startedAt?.toDate?.()
        }));

        // Calculate stats
        let costToday = 0, costWeek = 0, costMonth = 0;
        const callsByService = {
            'web-scraper': { today: 0, week: 0, month: 0, costMonth: 0 },
            'gemini': { today: 0, week: 0, month: 0, costMonth: 0 }
        };

        logs.forEach(log => {
            const logDate = log.startedAt;
            const cost = log.totalCost || 0;

            costMonth += cost;
            if (logDate >= startOfWeek) costWeek += cost;
            if (logDate >= startOfToday) costToday += cost;

            // Count API calls by service
            (log.apiCalls || []).forEach(call => {
                const service = call.service || 'unknown';
                if (!callsByService[service]) {
                    callsByService[service] = { today: 0, week: 0, month: 0, costMonth: 0 };
                }

                callsByService[service].month++;
                callsByService[service].costMonth += call.cost || 0;
                if (logDate >= startOfWeek) callsByService[service].week++;
                if (logDate >= startOfToday) callsByService[service].today++;
            });
        });

        return res.status(200).json({
            success: true,
            data: {
                costToday,
                costWeek,
                costMonth,
                totalExecutions: logs.length,
                callsByService
            }
        });
    } catch (error) {
        console.error('Get agent stats error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get agent stats'
        });
    }
});

/**
 * Get agent health status
 */
router.get('/api/v1/admin/agent-health', requireAdmin, async (req, res) => {
    try {
        const agentTypes = ['contactEnricher', 'newsIntelligence', 'linkedinResearch'];
        const health = {};

        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        for (const agentType of agentTypes) {
            // Get logs from last 24 hours for this agent type
            const snapshot = await db.collection('agentLogs')
                .where('agentType', '==', agentType)
                .where('startedAt', '>=', twentyFourHoursAgo)
                .orderBy('startedAt', 'desc')
                .limit(100)
                .get();

            const logs = snapshot.docs.map(doc => ({
                ...doc.data(),
                startedAt: doc.data().startedAt?.toDate?.()
            }));

            if (logs.length === 0) {
                health[agentType] = null; // Not deployed or no data
                continue;
            }

            const successCount = logs.filter(l => l.status === 'success').length;
            const lastSuccess = logs.find(l => l.status === 'success')?.startedAt;
            const lastFailure = logs.find(l => l.status === 'failed')?.startedAt;

            health[agentType] = {
                totalCount24h: logs.length,
                successCount24h: successCount,
                successRate24h: logs.length > 0 ? (successCount / logs.length) * 100 : 0,
                lastSuccess,
                lastFailure,
                minutesSinceLastSuccess: lastSuccess ? Math.floor((now - lastSuccess) / 60000) : null
            };
        }

        return res.status(200).json({
            success: true,
            data: health
        });
    } catch (error) {
        console.error('Get agent health error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get agent health'
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
