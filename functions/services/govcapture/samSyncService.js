'use strict';

/**
 * samSyncService.js — Orchestrates SAM.gov sync for a single profile.
 *
 * Sequence: acquire lock → load profile → build queries → fetch + normalize +
 * dedup → release lock → write SourceRun.
 */

const admin  = require('firebase-admin');
const crypto = require('crypto');
const { searchOpportunities } = require('./samGovClient');
const { buildQueriesForProfile } = require('./samQueryBuilder');
const { normalizeOpportunity }   = require('./samNormalizer');

const MAX_RECORDS_PER_SYNC = 500;
const LOCK_LEASE_MINUTES   = 10;

// ── Sync Lock ────────────────────────────────────────────────────────────────

async function _acquireLock(db, profileId) {
    const lockRef = db.collection('govSyncLocks').doc(`${profileId}:sam_gov`);

    try {
        const acquired = await db.runTransaction(async (t) => {
            const snap = await t.get(lockRef);

            if (snap.exists) {
                const data       = snap.data();
                const acquiredAt = data.acquiredAt?.toDate ? data.acquiredAt.toDate() : new Date(data.acquiredAt);
                const elapsed    = (Date.now() - acquiredAt.getTime()) / 60000; // minutes

                if (elapsed < LOCK_LEASE_MINUTES) {
                    return false; // Still locked
                }
                // Expired lock — overwrite
            }

            t.set(lockRef, {
                profileId,
                source:     'sam_gov',
                acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt:  new Date(Date.now() + LOCK_LEASE_MINUTES * 60000),
            });
            return true;
        });

        return acquired;
    } catch (err) {
        console.error(`[SamSync] Lock acquisition failed for ${profileId}:`, err.message);
        return false;
    }
}

async function _releaseLock(db, profileId) {
    try {
        await db.collection('govSyncLocks').doc(`${profileId}:sam_gov`).delete();
    } catch (err) {
        console.warn(`[SamSync] Lock release failed for ${profileId}:`, err.message);
    }
}

// ── Sync Orchestrator ────────────────────────────────────────────────────────

/**
 * Sync a single profile against SAM.gov.
 *
 * @param {string} profileId
 * @param {string} userId
 * @returns {Promise<object>} — SourceRun summary
 */
async function syncProfileFromSam(profileId, userId) {
    const db = admin.firestore();

    const sourceRun = {
        profileId,
        userId,
        source:       'sam_gov',
        status:       'running',
        queriesUsed:  [],
        totalFetched: 0,
        created:      0,
        updated:      0,
        deduped:      0,
        errors:       [],
        startedAt:    new Date().toISOString(),
        completedAt:  null,
    };

    // ── 1. Acquire lock ──────────────────────────────────────────────────
    const locked = await _acquireLock(db, profileId);
    if (!locked) {
        sourceRun.status = 'already_running';
        sourceRun.completedAt = new Date().toISOString();
        await _writeSourceRun(db, sourceRun);
        return sourceRun;
    }

    try {
        // ── 2. Load profile ──────────────────────────────────────────────
        const profileDoc = await db.collection('govProfiles').doc(profileId).get();
        if (!profileDoc.exists || profileDoc.data().status !== 'active') {
            sourceRun.status = 'failed';
            sourceRun.errors.push('Profile not found or inactive');
            sourceRun.completedAt = new Date().toISOString();
            await _writeSourceRun(db, sourceRun);
            return sourceRun;
        }

        const profile = profileDoc.data();

        // ── 3. Determine last sync date ──────────────────────────────────
        let lastSyncDate = null;
        try {
            const runsSnap = await db.collection('govSourceRuns')
                .where('profileId', '==', profileId)
                .where('source', '==', 'sam_gov')
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();

            if (!runsSnap.empty) {
                const lastRun = runsSnap.docs[0].data();
                lastSyncDate = lastRun.completedAt || lastRun.startedAt;
            }
        } catch {
            // No previous runs — use default lookback
        }

        // ── 4. Build queries ─────────────────────────────────────────────
        const queries = buildQueriesForProfile(profile, lastSyncDate);
        sourceRun.queriesUsed = queries.map(q => ({
            bucket: q.bucket,
            keyword: q.keyword || null,
            naicsCode: q.naicsCode || null,
            noticeType: q.noticeType || null,
        }));

        if (queries.length === 0) {
            sourceRun.status = 'completed';
            sourceRun.completedAt = new Date().toISOString();
            await _writeSourceRun(db, sourceRun);
            return sourceRun;
        }

        // ── 5. Execute queries ───────────────────────────────────────────
        for (const query of queries) {
            if (sourceRun.totalFetched >= MAX_RECORDS_PER_SYNC) break;

            try {
                const result = await searchOpportunities(query);

                if (!result.success) {
                    sourceRun.errors.push(`Query failed: ${result.error}`);
                    continue;
                }

                const opps = result.data?.opportunities || [];
                sourceRun.totalFetched += opps.length;

                // Normalize and dedup each opportunity
                for (const samRecord of opps) {
                    if (sourceRun.totalFetched > MAX_RECORDS_PER_SYNC) break;

                    try {
                        const normalized = normalizeOpportunity(samRecord, profileId, userId);
                        if (!normalized) continue;

                        await _upsertOpportunity(db, normalized, profileId);

                    } catch (normErr) {
                        sourceRun.errors.push(`Normalize error: ${normErr.message}`);
                    }
                }

            } catch (queryErr) {
                sourceRun.errors.push(`Query execution error: ${queryErr.message}`);
            }
        }

        // ── 6. Finalize ──────────────────────────────────────────────────
        sourceRun.status = sourceRun.errors.length > 0 ? 'partial' : 'completed';
        sourceRun.completedAt = new Date().toISOString();

    } catch (err) {
        console.error(`[SamSync] ❌ Sync failed for profile ${profileId}:`, err.message);
        sourceRun.status = 'failed';
        sourceRun.errors.push(err.message);
        sourceRun.completedAt = new Date().toISOString();
    } finally {
        // MUST release lock even on error
        await _releaseLock(db, profileId);
    }

    await _writeSourceRun(db, sourceRun);
    console.log(`[SamSync] Profile ${profileId}: ${sourceRun.status} — ${sourceRun.created} created, ${sourceRun.updated} updated, ${sourceRun.deduped} deduped, ${sourceRun.errors.length} errors`);
    return sourceRun;
}

// ── Upsert Opportunity ───────────────────────────────────────────────────────

async function _upsertOpportunity(db, normalized, profileId) {
    const existing = await db.collection('govOpportunities')
        .where('canonicalKey', '==', normalized.canonicalKey)
        .limit(1)
        .get();

    if (!existing.empty) {
        const doc = existing.docs[0];
        const data = doc.data();

        // Merge profileIds
        const mergedProfileIds = Array.from(new Set([
            ...(data.profileIds || []),
            profileId,
        ]));

        // Update with newer data
        await doc.ref.update({
            profileIds:  mergedProfileIds,
            title:       normalized.title || data.title,
            description: normalized.description || data.description,
            updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        });

        return 'updated';
    }

    // New opportunity
    await db.collection('govOpportunities').add({
        ...normalized,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return 'created';
}

// ── Write SourceRun ──────────────────────────────────────────────────────────

async function _writeSourceRun(db, sourceRun) {
    try {
        await db.collection('govSourceRuns').add({
            ...sourceRun,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('[SamSync] SourceRun write failed:', err.message);
    }
}

// ── syncAllActiveProfiles ────────────────────────────────────────────────────

/**
 * Run a SAM sync for every active gov profile, sequentially (per guardrails —
 * never parallel against the SAM API). One profile's failure never blocks the
 * rest. Shared by the admin run-daily-sync route and the govDailySamSync
 * scheduled function.
 *
 * @param {Function} [syncFn] — injectable for tests; defaults to syncProfileFromSam
 * @returns {Promise<Array>} per-profile results
 */
async function syncAllActiveProfiles(syncFn = syncProfileFromSam) {
    const db = admin.firestore();
    const snap = await db.collection('govProfiles')
        .where('status', '==', 'active')
        .get();

    const results = [];
    for (const doc of snap.docs) {
        try {
            const result = await syncFn(doc.id, doc.data().userId);
            results.push({ profileId: doc.id, ...result });
        } catch (err) {
            results.push({ profileId: doc.id, status: 'failed', error: err.message });
        }
    }
    return results;
}

module.exports = {
    syncProfileFromSam,
    syncAllActiveProfiles,
    // Exported for testing
    _acquireLock,
    _releaseLock,
};
