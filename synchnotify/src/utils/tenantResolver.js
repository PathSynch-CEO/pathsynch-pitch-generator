/**
 * Tenant Resolver
 *
 * Resolves tenantId to merchant configuration from Firestore.
 * Uses tenantId (Firebase UID) as the primary lookup key — never merchantCode.
 *
 * Phase 1-2: identitySpace is always "firebase", tenantId is a Firebase UID.
 * Phase 3+: Will add cross-reference resolution for PathManager MongoDB ObjectIds.
 */

/**
 * Resolve tenant configuration from merchantConfig collection.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {string} tenantId - Firebase UID (Phase 1-2) or MongoDB ObjectId (Phase 3+)
 * @param {string} identitySpace - "firebase" or "pathmanager"
 * @returns {Promise<{ found: boolean, config: Object|null, plan: string }>}
 */
async function resolveTenant({ db }, tenantId, identitySpace = 'firebase') {
    if (!tenantId || typeof tenantId !== 'string') {
        return { found: false, config: null, plan: 'starter' };
    }

    // Phase 1-2: Direct Firebase UID lookup
    if (identitySpace === 'pathmanager') {
        // Phase 3 concern — not implemented yet
        console.warn('[tenantResolver] pathmanager identity space not yet supported');
        return { found: false, config: null, plan: 'starter' };
    }

    try {
        // Read merchant config — keyed by Firebase UID (= tenantId)
        const configDoc = await db.collection('merchantConfig').doc(tenantId).get();

        // Read user doc for plan resolution
        const userDoc = await db.collection('users').doc(tenantId).get();
        const plan = resolveUserPlan(userDoc);

        if (!configDoc.exists) {
            // Tenant exists in users but has no merchantConfig — this is valid
            return {
                found: userDoc.exists,
                config: null,
                plan
            };
        }

        return {
            found: true,
            config: configDoc.data(),
            plan
        };
    } catch (error) {
        console.error('[tenantResolver] Firestore lookup failed:', error.message);
        return { found: false, config: null, plan: 'starter' };
    }
}

/**
 * Resolve user's plan from Firestore user document.
 * Mirrors the priority chain from functions/middleware/planGate.js getUserPlan().
 *
 * Priority: subscription.plan → subscription.tier → plan → tier → 'starter'
 */
function resolveUserPlan(userDoc) {
    if (!userDoc || !userDoc.exists) {
        return 'starter';
    }

    const data = userDoc.data();
    const plan = data?.subscription?.plan ||
                 data?.subscription?.tier ||
                 data?.plan ||
                 data?.tier;

    if (typeof plan === 'string') {
        return plan.toLowerCase();
    } else if (plan && typeof plan === 'object') {
        return (plan.tier || 'starter').toLowerCase();
    }

    return 'starter';
}

module.exports = { resolveTenant, resolveUserPlan };
