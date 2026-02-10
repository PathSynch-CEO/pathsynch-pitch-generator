/**
 * Pricing Service
 *
 * Handles dynamic pricing configuration with Stripe sync
 */

const admin = require('firebase-admin');
const db = admin.firestore();

// Lazy-load Stripe
let stripe = null;
function getStripe() {
    if (!stripe) {
        const Stripe = require('stripe');
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

/**
 * Default pricing configuration (aligned with Stripe)
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
            monthlyPrice: 49,
            annualPrice: 39,
            pitchLimit: 100,
            icpLimit: 3,
            workspacesLimit: 10,
            popular: true,
            features: ["Advanced analytics", "PDF download", "Priority support"]
        },
        scale: {
            name: "Scale",
            monthlyPrice: 99,
            annualPrice: 79,
            pitchLimit: -1,
            icpLimit: 6,
            workspacesLimit: -1,
            features: ["Team features", "CRM integrations", "Custom templates"]
        },
        enterprise: {
            name: "Enterprise",
            monthlyPrice: 89,
            annualPrice: 71,
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

/**
 * Sync a tier's pricing to Stripe
 * Creates/updates product and creates new prices (prices are immutable in Stripe)
 */
async function syncTierToStripe(tierKey, tierData, existingStripeData = null) {
    const stripeClient = getStripe();

    const productName = `SynchIntro ${tierData.name}`;
    const productDescription = tierData.features?.slice(0, 3).join(', ') || `${tierData.name} plan`;

    let productId = existingStripeData?.productId;

    // Build comprehensive metadata
    const productMetadata = {
        app: 'synchintro',
        tier: tierKey,
        pitchLimit: String(tierData.pitchLimit),
        icpLimit: String(tierData.icpLimit),
        workspacesLimit: String(tierData.workspacesLimit),
        popular: tierData.popular ? 'true' : 'false'
    };

    // Create or update the product
    if (productId) {
        // Update existing product
        await stripeClient.products.update(productId, {
            name: productName,
            description: productDescription,
            metadata: productMetadata
        });
    } else {
        // Create new product
        const product = await stripeClient.products.create({
            name: productName,
            description: productDescription,
            metadata: productMetadata
        });
        productId = product.id;
    }

    // Check if prices need to be updated
    const existingMonthlyPrice = existingStripeData?.prices?.monthly;
    const existingAnnualPrice = existingStripeData?.prices?.annual;

    let monthlyPriceId = existingMonthlyPrice;
    let annualPriceId = existingAnnualPrice;

    // Get existing price amounts to compare
    let needNewMonthlyPrice = !existingMonthlyPrice;
    let needNewAnnualPrice = !existingAnnualPrice;

    if (existingMonthlyPrice) {
        try {
            const existingPrice = await stripeClient.prices.retrieve(existingMonthlyPrice);
            const existingAmount = existingPrice.unit_amount / 100;
            if (existingAmount !== tierData.monthlyPrice) {
                needNewMonthlyPrice = true;
            }
        } catch (e) {
            needNewMonthlyPrice = true;
        }
    }

    if (existingAnnualPrice) {
        try {
            const existingPrice = await stripeClient.prices.retrieve(existingAnnualPrice);
            // Annual is stored as yearly amount, we display as monthly
            const existingMonthlyAmount = (existingPrice.unit_amount / 100) / 12;
            if (Math.abs(existingMonthlyAmount - tierData.annualPrice) > 0.01) {
                needNewAnnualPrice = true;
            }
        } catch (e) {
            needNewAnnualPrice = true;
        }
    }

    // Create new monthly price if needed
    if (needNewMonthlyPrice && tierData.monthlyPrice > 0) {
        // Archive old price if exists
        if (existingMonthlyPrice) {
            try {
                await stripeClient.prices.update(existingMonthlyPrice, { active: false });
            } catch (e) {
                console.log('Could not archive old monthly price:', e.message);
            }
        }

        const monthlyPrice = await stripeClient.prices.create({
            product: productId,
            unit_amount: Math.round(tierData.monthlyPrice * 100),
            currency: 'usd',
            recurring: { interval: 'month' },
            metadata: {
                app: 'synchintro',
                tier: tierKey,
                billing: 'monthly',
                displayPrice: String(tierData.monthlyPrice)
            }
        });
        monthlyPriceId = monthlyPrice.id;
    }

    // Create new annual price if needed
    if (needNewAnnualPrice && tierData.annualPrice > 0) {
        // Archive old price if exists
        if (existingAnnualPrice) {
            try {
                await stripeClient.prices.update(existingAnnualPrice, { active: false });
            } catch (e) {
                console.log('Could not archive old annual price:', e.message);
            }
        }

        // Annual price is stored as the per-year amount
        const yearlyAmount = Math.round(tierData.annualPrice * 12 * 100);
        const annualPrice = await stripeClient.prices.create({
            product: productId,
            unit_amount: yearlyAmount,
            currency: 'usd',
            recurring: { interval: 'year' },
            metadata: {
                app: 'synchintro',
                tier: tierKey,
                billing: 'annual',
                monthlyEquivalent: String(tierData.annualPrice),
                yearlyTotal: String(tierData.annualPrice * 12),
                savings: String(Math.round((1 - tierData.annualPrice / tierData.monthlyPrice) * 100)) + '%'
            }
        });
        annualPriceId = annualPrice.id;
    }

    // Update the product's default price to monthly
    if (monthlyPriceId) {
        await stripeClient.products.update(productId, {
            default_price: monthlyPriceId
        });
    }

    return {
        productId,
        prices: {
            monthly: monthlyPriceId,
            annual: annualPriceId
        },
        syncedAt: new Date().toISOString()
    };
}

/**
 * Update pricing with Stripe sync
 */
async function updatePricingWithStripeSync(pricingData, adminEmail) {
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

        if (typeof tier.monthlyPrice !== 'number' || tier.monthlyPrice < 0) {
            throw new Error(`Invalid monthly price for tier ${tierKey}`);
        }
        if (typeof tier.annualPrice !== 'number' || tier.annualPrice < 0) {
            throw new Error(`Invalid annual price for tier ${tierKey}`);
        }
        if (typeof tier.pitchLimit !== 'number') {
            throw new Error(`Invalid pitch limit for tier ${tierKey}`);
        }
        if (typeof tier.icpLimit !== 'number') {
            throw new Error(`Invalid ICP limit for tier ${tierKey}`);
        }
        if (typeof tier.workspacesLimit !== 'number') {
            throw new Error(`Invalid workspaces limit for tier ${tierKey}`);
        }
        if (!Array.isArray(tier.features)) {
            throw new Error(`Features must be an array for tier ${tierKey}`);
        }
    }

    // Sync each tier to Stripe
    const syncResults = {};
    const errors = [];

    for (const [tierKey, tier] of Object.entries(tiers)) {
        // Skip free tiers (price = 0)
        if (tier.monthlyPrice === 0 && tier.annualPrice === 0) {
            syncResults[tierKey] = { skipped: true, reason: 'free_tier' };
            continue;
        }

        try {
            const existingStripe = tier.stripe || null;
            const stripeData = await syncTierToStripe(tierKey, tier, existingStripe);

            // Add stripe data to tier
            tiers[tierKey].stripe = stripeData;
            syncResults[tierKey] = { success: true, ...stripeData };
        } catch (error) {
            console.error(`Error syncing tier ${tierKey} to Stripe:`, error);
            errors.push({ tier: tierKey, error: error.message });
            syncResults[tierKey] = { success: false, error: error.message };
        }
    }

    // Save to Firestore even if some Stripe syncs failed
    await db.collection('platformConfig').doc('pricing').set({
        tiers,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminEmail,
        lastStripeSync: admin.firestore.FieldValue.serverTimestamp(),
        stripeSyncResults: syncResults
    });

    return {
        success: errors.length === 0,
        syncResults,
        errors: errors.length > 0 ? errors : undefined
    };
}

/**
 * Get Stripe price IDs for a tier
 */
async function getStripePriceIds(tierKey) {
    const pricing = await getPricing();
    const tier = pricing.tiers?.[tierKey];

    if (!tier?.stripe?.prices) {
        return null;
    }

    return tier.stripe.prices;
}

/**
 * Sync metadata to existing Stripe products by name
 * This updates products that were created before metadata was added
 */
async function syncMetadataToExistingProducts() {
    const stripeClient = getStripe();
    const results = {};

    // Define the tiers and their metadata
    const tierMetadata = {
        starter: { tier: 'starter', pitchLimit: '25', icpLimit: '1', workspacesLimit: '2', popular: 'false' },
        growth: { tier: 'growth', pitchLimit: '100', icpLimit: '3', workspacesLimit: '10', popular: 'true' },
        scale: { tier: 'scale', pitchLimit: '-1', icpLimit: '6', workspacesLimit: '-1', popular: 'false' },
        enterprise: { tier: 'enterprise', pitchLimit: '-1', icpLimit: '-1', workspacesLimit: '-1', popular: 'false' }
    };

    // List all SynchIntro products
    const products = await stripeClient.products.list({ limit: 100, active: true });

    for (const product of products.data) {
        // Check if it's a SynchIntro product
        if (!product.name.startsWith('SynchIntro')) continue;

        // Determine tier from product name
        let tierKey = null;
        if (product.name.includes('Starter')) tierKey = 'starter';
        else if (product.name.includes('Growth')) tierKey = 'growth';
        else if (product.name.includes('Scale')) tierKey = 'scale';
        else if (product.name.includes('Enterprise')) tierKey = 'enterprise';

        if (!tierKey) continue;

        try {
            // Update product metadata
            await stripeClient.products.update(product.id, {
                metadata: {
                    app: 'synchintro',
                    ...tierMetadata[tierKey]
                }
            });

            // Update price metadata for this product's prices
            const prices = await stripeClient.prices.list({ product: product.id, active: true });

            for (const price of prices.data) {
                const billing = price.recurring?.interval === 'year' ? 'annual' : 'monthly';
                const displayPrice = price.recurring?.interval === 'year'
                    ? Math.round(price.unit_amount / 100 / 12)
                    : price.unit_amount / 100;

                await stripeClient.prices.update(price.id, {
                    metadata: {
                        app: 'synchintro',
                        tier: tierKey,
                        billing: billing,
                        displayPrice: String(displayPrice)
                    }
                });
            }

            results[product.name] = { success: true, productId: product.id, pricesUpdated: prices.data.length };
        } catch (error) {
            results[product.name] = { success: false, error: error.message };
        }
    }

    return results;
}

module.exports = {
    getPricing,
    updatePricing,
    updatePricingWithStripeSync,
    getTierPricing,
    getPlanLimits,
    calculateDiscountedPrice,
    getDefaultPricing,
    getStripePriceIds,
    syncTierToStripe,
    syncMetadataToExistingProducts,
    DEFAULT_PRICING
};
