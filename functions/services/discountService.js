/**
 * Discount Service
 *
 * Handles discount code creation, validation, and redemption
 * Now with Stripe sync - codes created here are automatically
 * created as Stripe coupons + promotion codes
 */

const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = admin.firestore();

/**
 * Create a Stripe coupon from discount data
 */
async function createStripeCoupon(codeData) {
    const couponParams = {
        name: `Promo: ${codeData.code}`,
        metadata: {
            source: 'synchintro_admin',
            code: codeData.code
        }
    };

    // Set discount type
    if (codeData.type === 'percent') {
        couponParams.percent_off = Number(codeData.value);
    } else if (codeData.type === 'fixed') {
        couponParams.amount_off = Number(codeData.value) * 100; // Stripe uses cents
        couponParams.currency = 'usd';
    } else if (codeData.type === 'trial_extension') {
        // For trial extensions, create a 100% off coupon
        couponParams.percent_off = 100;
        couponParams.duration = 'once';
    }

    // Set duration (default: applies once)
    if (codeData.type !== 'trial_extension') {
        couponParams.duration = codeData.duration || 'once';
    }

    // Set expiration if provided
    if (codeData.expiresAt) {
        const expiryDate = codeData.expiresAt instanceof Date
            ? codeData.expiresAt
            : new Date(codeData.expiresAt);
        couponParams.redeem_by = Math.floor(expiryDate.getTime() / 1000);
    }

    const coupon = await stripe.coupons.create(couponParams);
    console.log(`Created Stripe coupon: ${coupon.id}`);
    return coupon;
}

/**
 * Create a Stripe promotion code linked to a coupon
 */
async function createStripePromotionCode(couponId, codeData) {
    const promoParams = {
        coupon: couponId,
        code: codeData.code,
        metadata: {
            source: 'synchintro_admin',
            appliesToTiers: (codeData.appliesToTiers || ['all']).join(',')
        }
    };

    // Set max redemptions if not unlimited
    if (codeData.maxRedemptions && codeData.maxRedemptions !== -1) {
        promoParams.max_redemptions = Number(codeData.maxRedemptions);
    }

    // Set expiration if provided
    if (codeData.expiresAt) {
        const expiryDate = codeData.expiresAt instanceof Date
            ? codeData.expiresAt
            : new Date(codeData.expiresAt);
        promoParams.expires_at = Math.floor(expiryDate.getTime() / 1000);
    }

    const promoCode = await stripe.promotionCodes.create(promoParams);
    console.log(`Created Stripe promotion code: ${promoCode.code} (${promoCode.id})`);
    return promoCode;
}

/**
 * Create a new discount code
 */
async function createCode(codeData) {
    const {
        code,
        type,
        value,
        appliesToTiers = ['all'],
        maxRedemptions = -1,
        expiresAt,
        createdBy
    } = codeData;

    // Validate code format
    const normalizedCode = code.toUpperCase().trim();
    if (!/^[A-Z0-9]{3,20}$/.test(normalizedCode)) {
        throw new Error('Code must be 3-20 alphanumeric characters');
    }

    // Check if code already exists
    const existingSnapshot = await db.collection('discountCodes')
        .where('code', '==', normalizedCode)
        .limit(1)
        .get();

    if (!existingSnapshot.empty) {
        throw new Error('A code with this name already exists');
    }

    // Validate type
    if (!['percent', 'fixed', 'trial_extension'].includes(type)) {
        throw new Error('Invalid discount type');
    }

    // Validate value
    if (type === 'percent' && (value < 1 || value > 100)) {
        throw new Error('Percentage must be between 1 and 100');
    }
    if (value < 1) {
        throw new Error('Value must be positive');
    }

    // Create Stripe coupon and promotion code
    let stripeCouponId = null;
    let stripePromoCodeId = null;
    let stripeSynced = false;

    try {
        const codeDataForStripe = {
            code: normalizedCode,
            type,
            value: Number(value),
            appliesToTiers: Array.isArray(appliesToTiers) ? appliesToTiers : ['all'],
            maxRedemptions: Number(maxRedemptions),
            expiresAt: expiresAt ? new Date(expiresAt) : null
        };

        const stripeCoupon = await createStripeCoupon(codeDataForStripe);
        stripeCouponId = stripeCoupon.id;

        const stripePromoCode = await createStripePromotionCode(stripeCoupon.id, codeDataForStripe);
        stripePromoCodeId = stripePromoCode.id;
        stripeSynced = true;

        console.log(`Synced discount code ${normalizedCode} to Stripe`);
    } catch (stripeError) {
        console.error('Error syncing to Stripe:', stripeError);
        // Continue without Stripe sync - code will still work internally
    }

    const newCode = {
        code: normalizedCode,
        type,
        value: Number(value),
        appliesToTiers: Array.isArray(appliesToTiers) ? appliesToTiers : ['all'],
        maxRedemptions: Number(maxRedemptions),
        redemptionCount: 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true,
        createdBy,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Stripe sync fields
        stripeCouponId,
        stripePromoCodeId,
        stripeSynced
    };

    const docRef = await db.collection('discountCodes').add(newCode);

    return {
        id: docRef.id,
        ...newCode,
        createdAt: new Date()
    };
}

/**
 * List all discount codes
 */
async function listCodes({ includeExpired = false } = {}) {
    const snapshot = await db.collection('discountCodes')
        .orderBy('createdAt', 'desc')
        .get();

    const codes = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() || null,
            expiresAt: data.expiresAt?.toDate?.() || null
        };
    });

    if (!includeExpired) {
        const now = new Date();
        return codes.filter(code => !code.expiresAt || code.expiresAt > now);
    }

    return codes;
}

/**
 * Toggle code active status (also updates Stripe)
 */
async function toggleCode(codeId, isActive) {
    const codeDoc = await db.collection('discountCodes').doc(codeId).get();

    if (codeDoc.exists) {
        const codeData = codeDoc.data();

        // Update Stripe promotion code if synced
        if (codeData.stripePromoCodeId) {
            try {
                await stripe.promotionCodes.update(codeData.stripePromoCodeId, {
                    active: Boolean(isActive)
                });
                console.log(`Updated Stripe promo code ${codeData.stripePromoCodeId} active=${isActive}`);
            } catch (error) {
                console.error('Error updating Stripe promo code:', error);
            }
        }
    }

    await db.collection('discountCodes').doc(codeId).update({
        isActive: Boolean(isActive),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Delete a discount code (deactivates in Stripe - codes can't be deleted)
 */
async function deleteCode(codeId) {
    const codeDoc = await db.collection('discountCodes').doc(codeId).get();

    if (codeDoc.exists) {
        const codeData = codeDoc.data();

        // Deactivate Stripe promotion code if synced
        if (codeData.stripePromoCodeId) {
            try {
                await stripe.promotionCodes.update(codeData.stripePromoCodeId, {
                    active: false
                });
                console.log(`Deactivated Stripe promo code ${codeData.stripePromoCodeId}`);
            } catch (error) {
                console.error('Error deactivating Stripe promo code:', error);
            }
        }
    }

    await db.collection('discountCodes').doc(codeId).delete();
}

/**
 * Sync an existing code to Stripe (for codes created before sync was added)
 */
async function syncToStripe(codeId) {
    const codeDoc = await db.collection('discountCodes').doc(codeId).get();

    if (!codeDoc.exists) {
        throw new Error('Discount code not found');
    }

    const codeData = codeDoc.data();

    // Skip if already synced
    if (codeData.stripeSynced && codeData.stripePromoCodeId) {
        return {
            success: true,
            alreadySynced: true,
            message: 'Code already synced to Stripe',
            stripePromoCodeId: codeData.stripePromoCodeId
        };
    }

    // Create Stripe coupon
    const stripeCoupon = await createStripeCoupon(codeData);

    // Create Stripe promotion code
    const stripePromoCode = await createStripePromotionCode(stripeCoupon.id, codeData);

    // Update Firestore with Stripe IDs
    await db.collection('discountCodes').doc(codeId).update({
        stripeCouponId: stripeCoupon.id,
        stripePromoCodeId: stripePromoCode.id,
        stripeSynced: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
        success: true,
        alreadySynced: false,
        message: `Synced ${codeData.code} to Stripe`,
        stripeCouponId: stripeCoupon.id,
        stripePromoCodeId: stripePromoCode.id
    };
}

/**
 * Validate a discount code
 */
async function validateCode(code, userId, tier) {
    const normalizedCode = code.toUpperCase().trim();

    const snapshot = await db.collection('discountCodes')
        .where('code', '==', normalizedCode)
        .where('isActive', '==', true)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return { valid: false, error: 'Invalid code' };
    }

    const codeDoc = snapshot.docs[0];
    const data = codeDoc.data();

    // Check expiry
    if (data.expiresAt) {
        const expiryDate = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
        if (expiryDate < new Date()) {
            return { valid: false, error: 'Code expired' };
        }
    }

    // Check max redemptions
    if (data.maxRedemptions !== -1 && data.redemptionCount >= data.maxRedemptions) {
        return { valid: false, error: 'Code fully redeemed' };
    }

    // Check tier applicability
    if (!data.appliesToTiers.includes('all') && !data.appliesToTiers.includes(tier)) {
        return { valid: false, error: 'Code not valid for this plan' };
    }

    // Check if user already redeemed this code
    if (userId) {
        const redemptionSnapshot = await db.collection('codeRedemptions')
            .where('userId', '==', userId)
            .where('codeId', '==', codeDoc.id)
            .limit(1)
            .get();

        if (!redemptionSnapshot.empty) {
            return { valid: false, error: 'Code already used' };
        }
    }

    return {
        valid: true,
        discount: {
            id: codeDoc.id,
            code: data.code,
            type: data.type,
            value: data.value,
            appliesToTiers: data.appliesToTiers
        }
    };
}

/**
 * Redeem a discount code
 */
async function redeemCode(code, userId, userEmail, tier) {
    // First validate
    const validation = await validateCode(code, userId, tier);

    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const discount = validation.discount;

    // Calculate discount amount based on type
    let discountAmount = 0;
    if (discount.type === 'percent') {
        // Will be calculated at checkout based on plan price
        discountAmount = discount.value; // Store as percentage
    } else if (discount.type === 'fixed') {
        discountAmount = discount.value;
    } else if (discount.type === 'trial_extension') {
        discountAmount = discount.value; // Days
    }

    // Create redemption record
    const redemption = {
        codeId: discount.id,
        code: discount.code,
        userId,
        userEmail,
        appliedToTier: tier,
        discountType: discount.type,
        discountValue: discount.value,
        discountAmount,
        redeemedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Use a transaction to ensure atomicity
    await db.runTransaction(async (transaction) => {
        // Increment redemption count
        const codeRef = db.collection('discountCodes').doc(discount.id);
        transaction.update(codeRef, {
            redemptionCount: admin.firestore.FieldValue.increment(1)
        });

        // Create redemption record
        const redemptionRef = db.collection('codeRedemptions').doc();
        transaction.set(redemptionRef, redemption);
    });

    return {
        success: true,
        discount: {
            type: discount.type,
            value: discount.value
        }
    };
}

/**
 * Get redemption history
 */
async function getRedemptions(codeId = null) {
    let query = db.collection('codeRedemptions')
        .orderBy('redeemedAt', 'desc')
        .limit(100);

    if (codeId) {
        query = query.where('codeId', '==', codeId);
    }

    const snapshot = await query.get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        redeemedAt: doc.data().redeemedAt?.toDate?.() || null
    }));
}

module.exports = {
    createCode,
    listCodes,
    toggleCode,
    deleteCode,
    validateCode,
    redeemCode,
    getRedemptions,
    syncToStripe
};
