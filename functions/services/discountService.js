/**
 * Discount Service
 *
 * Handles discount code creation, validation, and redemption
 */

const admin = require('firebase-admin');
const db = admin.firestore();

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
        createdAt: admin.firestore.FieldValue.serverTimestamp()
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
 * Toggle code active status
 */
async function toggleCode(codeId, isActive) {
    await db.collection('discountCodes').doc(codeId).update({
        isActive: Boolean(isActive)
    });
}

/**
 * Delete a discount code
 */
async function deleteCode(codeId) {
    await db.collection('discountCodes').doc(codeId).delete();
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
    getRedemptions
};
