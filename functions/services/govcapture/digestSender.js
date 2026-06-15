'use strict';

/**
 * digestSender.js — Sends SynchGov email digests via SendGrid.
 *
 * Queries opportunities, composes email, sends, writes DigestLog.
 * Never throws — all failures logged in DigestLog.
 */

const admin  = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { composeDigest } = require('./digestComposer');

// ── Window Helpers ───────────────────────────────────────────────────────────

function _getDigestWindow(frequency, now) {
    // America/New_York offset (approximate — for precise, use a TZ library)
    // For daily: today 00:00 to 23:59
    // For weekly: Monday 00:00 to Sunday 23:59
    const d = new Date(now || Date.now());

    if (frequency === 'weekly') {
        const day = d.getDay(); // 0=Sun, 1=Mon, ...
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(d);
        monday.setDate(d.getDate() + mondayOffset);
        monday.setHours(0, 0, 0, 0);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        return {
            start: monday,
            end:   sunday,
            key:   `${monday.toISOString().slice(0, 10)}:${sunday.toISOString().slice(0, 10)}`,
        };
    }

    // Daily
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);

    return {
        start,
        end,
        key: start.toISOString().slice(0, 10),
    };
}

// ── Send Digest ──────────────────────────────────────────────────────────────

/**
 * Send a digest email for a profile.
 *
 * @param {object} profile — GovProfile (must include id)
 * @param {object} [options={}]
 * @returns {Promise<object>} — DigestLog entry
 */
async function sendDigest(profile, options = {}) {
    const db = admin.firestore();
    const profileId = profile.id || profile._id;
    const frequency = profile.digestSettings?.frequency || profile.digestFrequency || 'daily';
    const minScore  = profile.digestMinFitScore ?? 65;
    const includeSources = profile.digestIncludeSources || [];
    const sendEmpty = profile.sendEmptyDigest || false;
    const recipients = profile.digestRecipients || [];

    const window = _getDigestWindow(frequency);
    const digestWindowKey = `${profileId}:${frequency}:${window.key}`;

    // ── 1. Idempotency check ─────────────────────────────────────────────
    try {
        const existingSnap = await db.collection('govDigestLogs')
            .where('digestWindowKey', '==', digestWindowKey)
            .where('status', '==', 'sent')
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            const log = _buildLog(profileId, digestWindowKey, frequency, recipients, 0, [], 'skipped', 'already_sent_for_window');
            await _writeLog(db, log);
            return log;
        }
    } catch { /* proceed on check failure */ }

    // ── 2. Query opportunities ───────────────────────────────────────────
    let opportunities = [];
    try {
        // Two queries: created since window + updated since window, merge/dedupe
        const baseQuery = db.collection('govOpportunities')
            .where('profileIds', 'array-contains', profileId)
            .where('archived', '==', false);

        const [createdSnap, updatedSnap] = await Promise.all([
            baseQuery.where('createdAt', '>=', window.start).get(),
            baseQuery.where('updatedAt', '>=', window.start).get(),
        ]);

        const seen = new Set();
        const all  = [];
        for (const snap of [createdSnap, updatedSnap]) {
            for (const doc of snap.docs) {
                if (!seen.has(doc.id)) {
                    seen.add(doc.id);
                    all.push({ id: doc.id, ...doc.data() });
                }
            }
        }

        // Filter by score + sources
        opportunities = all.filter(opp => {
            if ((opp.fit?.score || 0) < minScore) return false;
            if (includeSources.length > 0 && !includeSources.includes(opp.primarySource)) return false;
            return true;
        });
    } catch (err) {
        console.error(`[DigestSender] Query failed for ${profileId}:`, err.message);
        const log = _buildLog(profileId, digestWindowKey, frequency, recipients, 0, [], 'failed', err.message);
        await _writeLog(db, log);
        return log;
    }

    // ── 3. Compose ───────────────────────────────────────────────────────
    const composed = composeDigest(profile, opportunities, { sendEmptyDigest: sendEmpty, frequency });

    if (!composed) {
        const log = _buildLog(profileId, digestWindowKey, frequency, recipients, 0, [], 'skipped', 'no_qualifying_opportunities');
        await _writeLog(db, log);
        return log;
    }

    // ── 4. Send via SendGrid ─────────────────────────────────────────────
    const apiKey = process.env.GOVCAPTURE_SENDGRID_API_KEY;
    if (!apiKey) {
        console.warn('[DigestSender] GOVCAPTURE_SENDGRID_API_KEY not configured');
        const log = _buildLog(profileId, digestWindowKey, frequency, recipients, composed.opportunityCount, composed.opportunityIds, 'failed', 'GOVCAPTURE_SENDGRID_API_KEY not configured');
        await _writeLog(db, log);
        return log;
    }

    if (!recipients.length) {
        const log = _buildLog(profileId, digestWindowKey, frequency, [], composed.opportunityCount, composed.opportunityIds, 'skipped', 'no_recipients');
        await _writeLog(db, log);
        return log;
    }

    try {
        sgMail.setApiKey(apiKey);

        const fromEmail = process.env.GOVCAPTURE_DIGEST_FROM_EMAIL || 'noreply@synchintro.ai';

        await sgMail.send({
            to:      recipients,
            from:    { email: fromEmail, name: 'SynchGov' },
            subject: composed.subject,
            html:    composed.htmlBody,
            text:    composed.textBody,
        });

        const log = _buildLog(profileId, digestWindowKey, frequency, recipients, composed.opportunityCount, composed.opportunityIds, 'sent', null);
        await _writeLog(db, log);

        console.log(`[DigestSender] ✅ Sent ${frequency} digest for ${profileId}: ${composed.opportunityCount} opportunities to ${recipients.length} recipients`);
        return log;

    } catch (err) {
        console.error(`[DigestSender] SendGrid failed for ${profileId}:`, err.message);
        const log = _buildLog(profileId, digestWindowKey, frequency, recipients, composed.opportunityCount, composed.opportunityIds, 'failed', err.message);
        await _writeLog(db, log);
        return log;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _buildLog(profileId, digestWindowKey, frequency, recipients, oppCount, oppIds, status, errorMessage) {
    return {
        profileId,
        digestWindowKey,
        frequency,
        recipientEmails: recipients,
        recipientCount:  recipients.length,
        opportunityCount: oppCount,
        opportunityIds:   oppIds,
        status,
        errorMessage: errorMessage || null,
        sentAt: new Date().toISOString(),
    };
}

async function _writeLog(db, log) {
    try {
        await db.collection('govDigestLogs').add({
            ...log,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('[DigestSender] DigestLog write failed:', err.message);
    }
}

module.exports = {
    sendDigest,
    _getDigestWindow,
};
