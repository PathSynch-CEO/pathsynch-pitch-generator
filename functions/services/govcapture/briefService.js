'use strict';

/**
 * briefService.js — Persistence wrapper for bid/no-bid brief generation.
 *
 * Owns all Firestore writes and status transitions for briefs.
 * Each generation creates a new subcollection doc (no overwrite).
 */

const admin = require('firebase-admin');
const { generateBidBrief, PROMPT_VERSION } = require('./briefGenerator');

/**
 * Create a bid/no-bid brief for an opportunity.
 *
 * @param {string} oppId
 * @param {string} profileId
 * @param {string} userId
 * @param {object} [options={}]
 * @returns {Promise<{brief: object, aiUsageMetadata: object|null}>}
 * @throws on ownership/relationship/state failures
 */
async function createBidBriefForOpportunity(oppId, profileId, userId, options = {}) {
    const db = admin.firestore();

    // 1. Load opportunity
    const oppDoc = await db.collection('govOpportunities').doc(oppId).get();
    if (!oppDoc.exists) throw Object.assign(new Error('Opportunity not found'), { status: 404 });

    const opp = oppDoc.data();
    if (opp.userId !== userId) throw Object.assign(new Error('Access denied'), { status: 403 });

    // 2. Resolve profileId
    const resolvedProfileId = profileId
        || opp.fit?.scoredAgainstProfileId
        || (opp.profileIds || [])[0];

    if (!resolvedProfileId) throw Object.assign(new Error('profileId required'), { status: 400 });

    // 3. Verify profile-opportunity relationship
    const profileLinked = (opp.profileIds || []).includes(resolvedProfileId)
        || opp.fit?.scoredAgainstProfileId === resolvedProfileId;

    if (!profileLinked) {
        throw Object.assign(new Error('Profile not linked to this opportunity'), { status: 400 });
    }

    // 4. Load profile
    const profileDoc = await db.collection('govProfiles').doc(resolvedProfileId).get();
    if (!profileDoc.exists) throw Object.assign(new Error('Profile not found'), { status: 404 });

    const profile = { id: profileDoc.id, ...profileDoc.data() };
    if (profile.userId !== userId) throw Object.assign(new Error('Profile access denied'), { status: 403 });
    if (profile.status !== 'active') throw Object.assign(new Error('Profile is archived'), { status: 409 });

    // 5. Load checklist
    let checklist = null;
    try {
        const checkDoc = await db.collection('govChecklist').doc(resolvedProfileId).get();
        if (checkDoc.exists) checklist = checkDoc.data();
    } catch { /* non-blocking */ }

    // 6. Generate brief
    const result = await generateBidBrief(opp, profile, { checklist });

    if (!result.brief) {
        // Generation failed — update opportunity status
        await db.collection('govOpportunities').doc(oppId).update({
            analysisStatus: 'failed',
            updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        throw Object.assign(
            new Error(result.error || 'brief_generation_failed'),
            { status: 500 }
        );
    }

    // 7. Write brief to subcollection (new doc — never overwrite)
    const briefData = {
        ...result.brief,
        opportunityId:      oppId,
        profileId:          resolvedProfileId,
        modelProvider:      'google',
        modelName:          'gemini-2.5-flash',
        promptVersion:      PROMPT_VERSION,
        usageMetadata:      result.aiUsageMetadata,
        opportunityUpdatedAt: opp.updatedAt || null,
        fitScoredAt:        opp.fit?.scoredAt || null,
        generatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('govOpportunities').doc(oppId)
        .collection('briefs').add(briefData);

    // 8. Update opportunity status
    await db.collection('govOpportunities').doc(oppId).update({
        analysisStatus: 'briefed',
        updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[BriefService] Brief generated for opportunity ${oppId} (profile ${resolvedProfileId})`);

    return {
        brief:           result.brief,
        aiUsageMetadata: result.aiUsageMetadata,
    };
}

module.exports = { createBidBriefForOpportunity };
