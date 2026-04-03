/**
 * Template Selector
 *
 * Selects the best-fit pitch template for a given user, outreach type, and industry.
 *
 * Priority order:
 *   1. User's own custom template  (createdBy == userId, templateType == outreachType, isDefault == true)
 *   2. Industry-specific system default (isSystemDefault == true, templateType == outreachType, industry == matchedIndustry)
 *   3. Global system default       (isSystemDefault == true, templateType == outreachType, industry == "all")
 *
 * Returns null if no template found — callers should fall back to legacy generation.
 */

const admin = require('firebase-admin');

/**
 * Normalise outreachType to the templateType stored in Firestore.
 * Supports: 'l2', 'One-Pager (L2)', 'L2_ONE_PAGER', or just '2' / 2
 */
function normaliseTemplateType(outreachType) {
    if (!outreachType) return null;
    const raw = String(outreachType).toLowerCase().trim();
    if (raw === 'l2' || raw === '2' || raw === 'one-pager (l2)' || raw === 'l2_one_pager') {
        return 'L2_ONE_PAGER';
    }
    if (raw === 'l1' || raw === '1' || raw === 'outreach email (l1)') return 'L1_EMAIL';
    if (raw === 'l3' || raw === '3' || raw === 'enterprise deck (l3)') return 'L3_DECK';
    // Pass through anything already normalised (e.g. direct templateType value)
    return outreachType.toUpperCase();
}

/**
 * Select the best template for the given parameters.
 *
 * @param {string} userId      - Firebase UID of the requesting user
 * @param {string} outreachType - Outreach format ('l2', 'One-Pager (L2)', etc.)
 * @param {string} industry     - Prospect industry slug (e.g. 'restaurant', 'auto_repair')
 * @returns {Promise<Object|null>} Template document data or null
 */
async function selectTemplate(userId, outreachType, industry) {
    const db = admin.firestore();
    const templateType = normaliseTemplateType(outreachType);

    if (!templateType) {
        console.warn('[TemplateSelector] Could not normalise outreachType:', outreachType);
        return null;
    }

    // ── Priority 1: User's own custom default ────────────────────────────────
    try {
        const userCustomSnap = await db.collection('pitchTemplates')
            .where('createdBy', '==', userId)
            .where('templateType', '==', templateType)
            .where('isDefault', '==', true)
            .limit(1)
            .get();

        if (!userCustomSnap.empty) {
            const doc = userCustomSnap.docs[0];
            console.log(`[TemplateSelector] Priority 1 match: user custom template ${doc.id}`);
            return { id: doc.id, ...doc.data() };
        }
    } catch (err) {
        console.warn('[TemplateSelector] Priority 1 query failed:', err.message);
    }

    // ── Priority 2: Industry-specific system default ──────────────────────────
    if (industry) {
        try {
            const industrySnap = await db.collection('pitchTemplates')
                .where('isSystemDefault', '==', true)
                .where('templateType', '==', templateType)
                .where('industry', '==', industry)
                .limit(1)
                .get();

            if (!industrySnap.empty) {
                const doc = industrySnap.docs[0];
                console.log(`[TemplateSelector] Priority 2 match: industry template ${doc.id} for ${industry}`);
                return { id: doc.id, ...doc.data() };
            }
        } catch (err) {
            console.warn('[TemplateSelector] Priority 2 query failed:', err.message);
        }
    }

    // ── Priority 3: Global system default (industry == "all") ─────────────────
    try {
        const globalSnap = await db.collection('pitchTemplates')
            .where('isSystemDefault', '==', true)
            .where('templateType', '==', templateType)
            .where('industry', '==', 'all')
            .limit(1)
            .get();

        if (!globalSnap.empty) {
            const doc = globalSnap.docs[0];
            console.log(`[TemplateSelector] Priority 3 match: global default template ${doc.id}`);
            return { id: doc.id, ...doc.data() };
        }
    } catch (err) {
        console.warn('[TemplateSelector] Priority 3 query failed:', err.message);
    }

    console.log(`[TemplateSelector] No template found for type=${templateType}, industry=${industry}`);
    return null;
}

module.exports = { selectTemplate, normaliseTemplateType };
