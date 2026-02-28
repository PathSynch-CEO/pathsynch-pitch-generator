/**
 * Seller Profile Routes
 *
 * Manages multiple seller profiles for agencies.
 * Tier limits:
 * - Starter: 1 profile
 * - Growth: 2 profiles
 * - Scale: 3 profiles
 * - Enterprise: 4 profiles
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// Profile limits by tier
const PROFILE_LIMITS = {
    starter: 1,
    growth: 2,
    scale: 3,
    enterprise: 4,
};

/**
 * GET /seller-profiles
 * List all seller profiles for the user
 */
router.get('/seller-profiles', async (req, res) => {
    console.log('[SellerProfiles] GET /seller-profiles called, userId:', req.userId);
    try {
        if (!req.userId || req.userId === 'anonymous') {
            console.log('[SellerProfiles] Unauthorized - no userId');
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        console.log('[SellerProfiles] Fetching profiles for user:', userId);
        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            return res.json({
                success: true,
                data: {
                    profiles: [],
                    limit: PROFILE_LIMITS.starter,
                    tier: 'starter',
                },
            });
        }

        const userData = userDoc.data();
        const tier = userData.plan || userData.tier || 'starter';
        const limit = PROFILE_LIMITS[tier] || 1;
        console.log('[SellerProfiles] User tier:', tier, 'limit:', limit);

        // Get profiles from user document
        let profiles = userData.sellerProfiles || [];
        console.log('[SellerProfiles] Found', profiles.length, 'profiles');

        // Migration: If no profiles but has legacy seller data, create default profile
        if (profiles.length === 0 && (userData.companyName || userData.company?.name || userData.products?.length > 0)) {
            const defaultProfile = {
                id: 'default',
                name: 'Default Profile',
                companyName: userData.companyName || userData.company?.name || '',
                industry: userData.industry || userData.company?.industry || '',
                website: userData.website || userData.company?.website || '',
                products: userData.products || [],
                yearsInBusiness: userData.yearsInBusiness || '',
                companySize: userData.companySize || '',
                isPrimary: true,
                createdAt: new Date().toISOString(),
            };
            profiles = [defaultProfile];

            // Save the migrated profile
            await db.collection('users').doc(userId).update({
                sellerProfiles: profiles,
            });

            console.log(`[SellerProfiles] Migrated legacy data to default profile for user ${userId}`);
        }

        console.log('[SellerProfiles] Returning', profiles.length, 'profiles for user', userId);
        res.json({
            success: true,
            data: {
                profiles,
                limit,
                tier,
                canAddMore: profiles.length < limit,
            },
        });
    } catch (error) {
        console.error('[SellerProfiles] Error listing seller profiles:', error);
        handleError(res, error, 'Failed to load seller profiles');
    }
});

/**
 * GET /seller-profiles/:profileId
 * Get a specific seller profile
 */
router.get('/seller-profiles/:profileId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const { profileId } = req.params;

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const userData = userDoc.data();
        const profiles = userData.sellerProfiles || [];
        const profile = profiles.find(p => p.id === profileId);

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found',
            });
        }

        res.json({
            success: true,
            data: profile,
        });
    } catch (error) {
        console.error('Error getting seller profile:', error);
        handleError(res, error, 'Failed to load profile');
    }
});

/**
 * POST /seller-profiles
 * Create a new seller profile
 */
router.post('/seller-profiles', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const { name, companyName, industry, website, products, yearsInBusiness, companySize } = req.body;

        if (!name || !companyName) {
            return res.status(400).json({
                success: false,
                message: 'Profile name and company name are required',
            });
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const tier = userData.plan || userData.tier || 'starter';
        const limit = PROFILE_LIMITS[tier] || 1;
        const profiles = userData.sellerProfiles || [];

        // Check limit
        if (profiles.length >= limit) {
            return res.status(403).json({
                success: false,
                message: `You've reached your limit of ${limit} profile${limit > 1 ? 's' : ''}. Upgrade to add more.`,
                upgradeRequired: true,
            });
        }

        // Create new profile
        const newProfile = {
            id: `profile_${Date.now()}`,
            name,
            companyName,
            industry: industry || '',
            website: website || '',
            products: products || [],
            yearsInBusiness: yearsInBusiness || '',
            companySize: companySize || '',
            isPrimary: profiles.length === 0, // First profile is primary
            createdAt: new Date().toISOString(),
        };

        profiles.push(newProfile);

        await db.collection('users').doc(userId).set({
            sellerProfiles: profiles,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`[SellerProfiles] Created profile "${name}" for user ${userId}`);

        res.json({
            success: true,
            message: 'Profile created successfully',
            data: newProfile,
        });
    } catch (error) {
        console.error('Error creating seller profile:', error);
        handleError(res, error, 'Failed to create profile');
    }
});

/**
 * PUT /seller-profiles/:profileId
 * Update a seller profile
 */
router.put('/seller-profiles/:profileId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const { profileId } = req.params;
        const updates = req.body;

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const userData = userDoc.data();
        const profiles = userData.sellerProfiles || [];
        const profileIndex = profiles.findIndex(p => p.id === profileId);

        if (profileIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found',
            });
        }

        // Update profile fields
        const allowedFields = ['name', 'companyName', 'industry', 'website', 'products', 'yearsInBusiness', 'companySize'];
        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                profiles[profileIndex][field] = updates[field];
            }
        });
        profiles[profileIndex].updatedAt = new Date().toISOString();

        await db.collection('users').doc(userId).update({
            sellerProfiles: profiles,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[SellerProfiles] Updated profile "${profiles[profileIndex].name}" for user ${userId}`);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: profiles[profileIndex],
        });
    } catch (error) {
        console.error('Error updating seller profile:', error);
        handleError(res, error, 'Failed to update profile');
    }
});

/**
 * PUT /seller-profiles/:profileId/primary
 * Set a profile as the primary/default
 */
router.put('/seller-profiles/:profileId/primary', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const { profileId } = req.params;

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const userData = userDoc.data();
        const profiles = userData.sellerProfiles || [];
        const profileIndex = profiles.findIndex(p => p.id === profileId);

        if (profileIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found',
            });
        }

        // Update all profiles - only one can be primary
        profiles.forEach((p, i) => {
            p.isPrimary = (i === profileIndex);
        });

        await db.collection('users').doc(userId).update({
            sellerProfiles: profiles,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[SellerProfiles] Set "${profiles[profileIndex].name}" as primary for user ${userId}`);

        res.json({
            success: true,
            message: 'Primary profile updated',
            data: profiles[profileIndex],
        });
    } catch (error) {
        console.error('Error setting primary profile:', error);
        handleError(res, error, 'Failed to set primary profile');
    }
});

/**
 * DELETE /seller-profiles/:profileId
 * Delete a seller profile
 */
router.delete('/seller-profiles/:profileId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userId = req.userId;
        const { profileId } = req.params;

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const userData = userDoc.data();
        let profiles = userData.sellerProfiles || [];
        const profileIndex = profiles.findIndex(p => p.id === profileId);

        if (profileIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found',
            });
        }

        const deletedProfile = profiles[profileIndex];
        const wasPrimary = deletedProfile.isPrimary;

        // Remove the profile
        profiles = profiles.filter(p => p.id !== profileId);

        // If deleted profile was primary and there are other profiles, make the first one primary
        if (wasPrimary && profiles.length > 0) {
            profiles[0].isPrimary = true;
        }

        await db.collection('users').doc(userId).update({
            sellerProfiles: profiles,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[SellerProfiles] Deleted profile "${deletedProfile.name}" for user ${userId}`);

        res.json({
            success: true,
            message: 'Profile deleted successfully',
        });
    } catch (error) {
        console.error('Error deleting seller profile:', error);
        handleError(res, error, 'Failed to delete profile');
    }
});

module.exports = router;
