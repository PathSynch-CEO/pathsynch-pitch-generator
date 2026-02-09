/**
 * Pricing Service
 *
 * Handles dynamic pricing configuration
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Default pricing configuration
 */
const DEFAULT_PRICING = {
    tiers: {
        starter: {
            name: "Starter",
            monthlyPrice: 19,
            annualPrice: 15,
            pitchLimit: 25,
            icpLimit: 1,
            workspacesLimit: 2,
            features: ["Basic analytics", "Link sharing", "Email support"]
        },
        growth: {
            name: "Growth",
            monthlyPrice: 39,
            annualPrice: 31,
            pitchLimit: 100,
            icpLimit: 3,
            workspacesLimit: 10,
            popular: true,
            features: ["Advanced analytics", "PDF download", "Priority support"]
        },
        scale: {
            name: "Scale",
            monthlyPrice: 69,
            annualPrice: 55,
            pitchLimit: -1,
            icpLimit: 6,
            workspacesLimit: -1,
            features: ["Team features", "CRM integrations", "Custom templates"]
        },
        enterprise: {
            name: "Enterprise",
            monthlyPrice: 59,
            annualPrice: 47,
            pitchLimit: -1,
            icpLimit: -1,
            workspacesLimit: -1,
            features: ["Pre-call forms", "Investor updates", "SSO/SAML", "API access"]
        }
    }
};

/**
 * Get current pricing configuration
 * Returns from Firestore if exists, otherwise returns defaults
 */
async function getPricing() {
    try {
        const doc = await db.collection('platformConfig').doc('pricing').get();

        if (!doc.exists) {
            return {
                ...DEFAULT_PRICING,
                updatedAt: null,
                updatedBy: null
            };
        }

        const data = doc.data();
        return {
            tiers: data.tiers || DEFAULT_PRICING.tiers,
            updatedAt: data.updatedAt?.toDate?.() || null,
            updatedBy: data.updatedBy || null
        };
    } catch (error) {
        console.error('Error fetching pricing:', error);
        return {
            ...DEFAULT_PRICING,
            updatedAt: null,
            updatedBy: null
        };
    }
}

/**
 * Update pricing configuration
 */
async function updatePricing(pricingData, adminEmail) {
    const { tiers } = pricingData;

    // Validate tiers
    if (!tiers || typeof tiers !== 'object') {
        throw new Error('Invalid pricing data');
    }

    // Validate each tier
    const requiredFields = ['name', 'monthlyPrice', 'annualPrice', 'pitchLimit', 'icpLimit', 'workspacesLimit', 'features'];

    for (const [tierKey, tier] of Object.entries(tiers)) {
        for (const field of requiredFields) {
            if (tier[field] === undefined) {
                throw new Error(`Missing field ${field} in tier ${tierKey}`);
            }
        }

        // Validate prices are numbers
        if (typeof tier.monthlyPrice !== 'number' || tier.monthlyPrice < 0) {
            throw new Error(`Invalid monthly price for tier ${tierKey}`);
        }
        if (typeof tier.annualPrice !== 'number' || tier.annualPrice < 0) {
            throw new Error(`Invalid annual price for tier ${tierKey}`);
        }

        // Validate limits are numbers
        if (typeof tier.pitchLimit !== 'number') {
            throw new Error(`Invalid pitch limit for tier ${tierKey}`);
        }
        if (typeof tier.icpLimit !== 'number') {
            throw new Error(`Invalid ICP limit for tier ${tierKey}`);
        }
        if (typeof tier.workspacesLimit !== 'number') {
            throw new Error(`Invalid workspaces limit for tier ${tierKey}`);
        }

        // Validate features is array
        if (!Array.isArray(tier.features)) {
            throw new Error(`Features must be an array for tier ${tierKey}`);
        }
    }

    await db.collection('platformConfig').doc('pricing').set({
        tiers,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminEmail
    });
}

/**
 * Get pricing for a specific tier
 */
async function getTierPricing(tierName) {
    const pricing = await getPricing();
    return pricing.tiers[tierName] || null;
}

/**
 * Get plan limits for a tier (compatible with existing code)
 */
async function getPlanLimits(tierName) {
    const tier = await getTierPricing(tierName);

    if (!tier) {
        // Return starter limits as default
        return {
            pitchLimit: 25,
            icpLimit: 1,
            workspacesLimit: 2
        };
    }

    return {
        pitchLimit: tier.pitchLimit,
        icpLimit: tier.icpLimit,
        workspacesLimit: tier.workspacesLimit
    };
}

/**
 * Calculate discounted price
 */
function calculateDiscountedPrice(originalPrice, discountType, discountValue) {
    if (discountType === 'percent') {
        return Math.round(originalPrice * (1 - discountValue / 100) * 100) / 100;
    } else if (discountType === 'fixed') {
        return Math.max(0, originalPrice - discountValue);
    }
    return originalPrice;
}

/**
 * Get default pricing (for fallback)
 */
function getDefaultPricing() {
    return DEFAULT_PRICING;
}

module.exports = {
    getPricing,
    updatePricing,
    getTierPricing,
    getPlanLimits,
    calculateDiscountedPrice,
    getDefaultPricing,
    DEFAULT_PRICING
};
