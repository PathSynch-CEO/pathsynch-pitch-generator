/**
 * Admin Dashboard API Handlers
 *
 * Provides admin-only endpoints for user management, analytics, and system stats
 */

const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getPlanLimits } = require('../config/stripe');

const db = admin.firestore();

/**
 * Get dashboard statistics
 */
async function getStats(req, res) {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        // Get user counts by plan
        const usersSnapshot = await db.collection('users').get();
        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const usersByPlan = {
            starter: users.filter(u => !u.plan || u.plan === 'starter').length,
            growth: users.filter(u => u.plan === 'growth').length,
            scale: users.filter(u => u.plan === 'scale').length
        };

        // Get pitch counts
        const pitchesSnapshot = await db.collection('pitches').get();
        const pitches = pitchesSnapshot.docs.map(doc => doc.data());

        const pitchesThisMonth = pitches.filter(p => {
            const created = p.createdAt?.toDate?.() || new Date(0);
            return created >= startOfMonth;
        }).length;

        const pitchesByLevel = {
            level1: pitches.filter(p => p.level === 1).length,
            level2: pitches.filter(p => p.level === 2).length,
            level3: pitches.filter(p => p.level === 3).length
        };

        // Get active subscriptions count
        const subscriptionsSnapshot = await db.collection('subscriptions')
            .where('status', '==', 'active')
            .get();
        const activeSubscriptions = subscriptionsSnapshot.size;

        // Get bulk jobs count
        const bulkJobsSnapshot = await db.collection('bulkJobs').get();
        const bulkJobs = bulkJobsSnapshot.size;

        // Get market reports count
        const marketReportsSnapshot = await db.collection('marketReports').get();
        const marketReports = marketReportsSnapshot.size;

        // Calculate MRR (Monthly Recurring Revenue)
        const mrr = (usersByPlan.growth * 49) + (usersByPlan.scale * 149);

        return res.status(200).json({
            success: true,
            data: {
                users: {
                    total: users.length,
                    byPlan: usersByPlan,
                    newThisMonth: users.filter(u => {
                        const created = u.createdAt?.toDate?.() || new Date(0);
                        return created >= startOfMonth;
                    }).length
                },
                pitches: {
                    total: pitches.length,
                    thisMonth: pitchesThisMonth,
                    byLevel: pitchesByLevel
                },
                subscriptions: {
                    active: activeSubscriptions
                },
                revenue: {
                    mrr: mrr,
                    arr: mrr * 12
                },
                bulkJobs: bulkJobs,
                marketReports: marketReports,
                generatedAt: now.toISOString()
            }
        });

    } catch (error) {
        console.error('Error getting admin stats:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
}

/**
 * List all users with filtering and pagination
 */
async function listUsers(req, res) {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const plan = req.query.plan; // Filter by plan
        const search = req.query.search; // Search by email or name

        let query = db.collection('users').orderBy('createdAt', 'desc');

        if (plan) {
            query = query.where('plan', '==', plan);
        }

        const snapshot = await query.offset(offset).limit(limit).get();

        let users = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                email: data.email,
                name: data.name,
                plan: data.plan || 'starter',
                pitchCount: data.pitchCount || 0,
                createdAt: data.createdAt,
                lastLoginAt: data.lastLoginAt,
                stripeCustomerId: data.stripeCustomerId || null
            };
        });

        // Apply search filter (client-side for simplicity)
        if (search) {
            const searchLower = search.toLowerCase();
            users = users.filter(u =>
                (u.email && u.email.toLowerCase().includes(searchLower)) ||
                (u.name && u.name.toLowerCase().includes(searchLower))
            );
        }

        // Get total count
        const totalSnapshot = await db.collection('users').count().get();
        const total = totalSnapshot.data().count;

        return res.status(200).json({
            success: true,
            data: users,
            pagination: {
                total: total,
                limit: limit,
                offset: offset,
                hasMore: offset + users.length < total
            }
        });

    } catch (error) {
        console.error('Error listing users:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list users'
        });
    }
}

/**
 * Get detailed user information
 */
async function getUser(req, res) {
    const userId = req.params.userId;

    try {
        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const userData = userDoc.data();

        // Get user's pitches count
        const pitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', userId)
            .get();

        // Get user's subscription
        const subscriptionSnapshot = await db.collection('subscriptions')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        const subscription = subscriptionSnapshot.empty
            ? null
            : subscriptionSnapshot.docs[0].data();

        // Get current month usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageDoc = await db.collection('usage').doc(`${userId}_${period}`).get();
        const usage = usageDoc.exists ? usageDoc.data() : {};

        // Get bulk jobs
        const bulkJobsSnapshot = await db.collection('bulkJobs')
            .where('userId', '==', userId)
            .get();

        // Get market reports
        const marketReportsSnapshot = await db.collection('marketReports')
            .where('userId', '==', userId)
            .get();

        return res.status(200).json({
            success: true,
            data: {
                id: userDoc.id,
                ...userData,
                stats: {
                    pitchCount: pitchesSnapshot.size,
                    bulkJobCount: bulkJobsSnapshot.size,
                    marketReportCount: marketReportsSnapshot.size
                },
                subscription: subscription,
                usage: {
                    pitchesThisMonth: usage.pitchesThisMonth || 0,
                    bulkUploadsThisMonth: usage.bulkUploadsThisMonth || 0,
                    marketReportsThisMonth: usage.marketReportsThisMonth || 0
                },
                limits: getPlanLimits(userData.plan || 'starter')
            }
        });

    } catch (error) {
        console.error('Error getting user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get user'
        });
    }
}

/**
 * Update user (plan, status, etc.)
 */
async function updateUser(req, res) {
    const userId = req.params.userId;
    const { plan, notes } = req.body;

    try {
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

        if (plan && ['starter', 'growth', 'scale'].includes(plan)) {
            updates.plan = plan;
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
        console.error('Error updating user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update user'
        });
    }
}

/**
 * Get revenue analytics
 */
async function getRevenue(req, res) {
    try {
        const now = new Date();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

        // Get subscriptions
        const subscriptionsSnapshot = await db.collection('subscriptions').get();
        const subscriptions = subscriptionsSnapshot.docs.map(doc => doc.data());

        // Calculate current MRR
        const activeSubscriptions = subscriptions.filter(s => s.status === 'active');
        const growthCount = activeSubscriptions.filter(s => s.plan === 'growth').length;
        const scaleCount = activeSubscriptions.filter(s => s.plan === 'scale').length;

        const currentMRR = (growthCount * 49) + (scaleCount * 149);

        // Build monthly revenue data (last 6 months)
        const monthlyData = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

            const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

            // Count active subscriptions for that month
            const activeInMonth = subscriptions.filter(s => {
                const start = s.currentPeriodStart?.toDate?.() || new Date(0);
                return start <= monthEnd && s.status === 'active';
            });

            const growthInMonth = activeInMonth.filter(s => s.plan === 'growth').length;
            const scaleInMonth = activeInMonth.filter(s => s.plan === 'scale').length;
            const mrrInMonth = (growthInMonth * 49) + (scaleInMonth * 149);

            monthlyData.push({
                month: monthLabel,
                mrr: mrrInMonth,
                growthCount: growthInMonth,
                scaleCount: scaleInMonth
            });
        }

        // Get recent transactions from Stripe (if configured)
        let recentCharges = [];
        if (process.env.STRIPE_SECRET_KEY) {
            try {
                const charges = await stripe.charges.list({
                    limit: 10,
                    created: {
                        gte: Math.floor(sixMonthsAgo.getTime() / 1000)
                    }
                });
                recentCharges = charges.data.map(c => ({
                    id: c.id,
                    amount: c.amount / 100,
                    currency: c.currency,
                    status: c.status,
                    created: new Date(c.created * 1000).toISOString(),
                    customer: c.customer
                }));
            } catch (stripeError) {
                console.warn('Could not fetch Stripe charges:', stripeError.message);
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                current: {
                    mrr: currentMRR,
                    arr: currentMRR * 12,
                    growthSubscriptions: growthCount,
                    scaleSubscriptions: scaleCount,
                    totalPaid: growthCount + scaleCount
                },
                monthly: monthlyData,
                recentCharges: recentCharges
            }
        });

    } catch (error) {
        console.error('Error getting revenue:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get revenue data'
        });
    }
}

/**
 * List all pitches with filtering
 */
async function listPitches(req, res) {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const level = parseInt(req.query.level);
        const userId = req.query.userId;

        let query = db.collection('pitches').orderBy('createdAt', 'desc');

        if (level && [1, 2, 3].includes(level)) {
            query = query.where('level', '==', level);
        }

        if (userId) {
            query = query.where('userId', '==', userId);
        }

        const snapshot = await query.offset(offset).limit(limit).get();

        const pitches = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                businessName: data.businessName,
                segment: data.segment,
                level: data.level,
                userId: data.userId,
                createdAt: data.createdAt
            };
        });

        // Get total count
        const totalSnapshot = await db.collection('pitches').count().get();
        const total = totalSnapshot.data().count;

        return res.status(200).json({
            success: true,
            data: pitches,
            pagination: {
                total: total,
                limit: limit,
                offset: offset,
                hasMore: offset + pitches.length < total
            }
        });

    } catch (error) {
        console.error('Error listing pitches:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list pitches'
        });
    }
}

/**
 * Get usage analytics
 */
async function getUsageAnalytics(req, res) {
    try {
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Get all usage docs for current month
        const usageSnapshot = await db.collection('usage')
            .where(admin.firestore.FieldPath.documentId(), '>=', `_${period}`)
            .where(admin.firestore.FieldPath.documentId(), '<=', `~${period}`)
            .get();

        let totalPitches = 0;
        let totalBulkUploads = 0;
        let totalMarketReports = 0;

        usageSnapshot.docs.forEach(doc => {
            const data = doc.data();
            totalPitches += data.pitchesThisMonth || 0;
            totalBulkUploads += data.bulkUploadsThisMonth || 0;
            totalMarketReports += data.marketReportsThisMonth || 0;
        });

        // Get pitches created by day (last 30 days)
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const pitchesSnapshot = await db.collection('pitches')
            .where('createdAt', '>=', thirtyDaysAgo)
            .get();

        const pitchesByDay = {};
        pitchesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt?.toDate?.();
            if (date) {
                const dayKey = date.toISOString().split('T')[0];
                pitchesByDay[dayKey] = (pitchesByDay[dayKey] || 0) + 1;
            }
        });

        // Format as array
        const dailyPitches = Object.entries(pitchesByDay)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return res.status(200).json({
            success: true,
            data: {
                currentMonth: {
                    period: period,
                    pitches: totalPitches,
                    bulkUploads: totalBulkUploads,
                    marketReports: totalMarketReports
                },
                dailyPitches: dailyPitches
            }
        });

    } catch (error) {
        console.error('Error getting usage analytics:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get usage analytics'
        });
    }
}

/**
 * Bootstrap super_admin
 * This endpoint allows setting up admins with the secret key
 */
async function bootstrapAdmin(req, res) {
    try {
        const { email, secretKey, force } = req.body;

        // Require a secret key to prevent abuse
        const expectedKey = process.env.ADMIN_BOOTSTRAP_KEY || 'synchintro-beta-2026';

        if (secretKey !== expectedKey) {
            return res.status(403).json({
                success: false,
                error: 'Invalid bootstrap key'
            });
        }

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Check if any admins already exist (skip if force=true)
        if (!force) {
            const existingAdmins = await db.collection('admins').limit(1).get();
            if (!existingAdmins.empty) {
                return res.status(400).json({
                    success: false,
                    error: 'Admin already exists. Use force:true to add another admin.'
                });
            }
        }

        // Create the super_admin
        const normalizedEmail = email.toLowerCase().trim();
        await db.collection('admins').doc(normalizedEmail).set({
            email: normalizedEmail,
            role: 'super_admin',
            addedBy: 'system_bootstrap',
            addedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`Bootstrapped super_admin: ${normalizedEmail}`);

        return res.status(200).json({
            success: true,
            message: `Super admin created: ${normalizedEmail}`,
            email: normalizedEmail
        });

    } catch (error) {
        console.error('Error bootstrapping admin:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to bootstrap admin'
        });
    }
}

module.exports = {
    getStats,
    listUsers,
    getUser,
    updateUser,
    getRevenue,
    listPitches,
    getUsageAnalytics,
    bootstrapAdmin
};
