'use strict';

/**
 * services/pitchMetrics.js
 *
 * Shared pitch lifecycle helpers extracted from index.js.
 *
 * Functions:
 *   ensureUserExists(userId, email)
 *   checkAndUpdateUsage(userId)
 *   incrementUsage(userId, field)
 *   trackPitchView(pitchId, viewerId, context)
 *   extractTriggerEventContent(url)
 *
 * All functions depend on firebase-admin being initialised before this
 * module is first require()'d (index.js does this at startup).
 */

const admin = require('firebase-admin');
const { getCurrentPeriod } = require('../lib/shared');

// Lazily resolved Firestore reference (admin already initialised by index.js)
let _db;
function getDb() {
    if (!_db) {
        _db = admin.firestore();
    }
    return _db;
}

// ── User bootstrap ─────────────────────────────────────────────────────────────

/**
 * Ensure a Firestore user document exists; create it with defaults if not.
 * Sends welcome email on first creation if email is provided.
 * @param {string} userId
 * @param {string|null} email
 * @returns {Promise<{isNew: boolean, data?: object}>}
 */
async function ensureUserExists(userId, email) {
    const db = getDb();
    const emailService = require('./email');
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        await userRef.set({
            userId: userId,
            profile: {
                displayName: null,
                email: email || null,
                photoUrl: null,
                company: null,
                role: null
            },
            plan: 'starter', // Default to starter plan (string format)
            settings: {
                defaultTone: 'consultative',
                defaultGoal: 'book_demo',
                defaultIndustry: null,
                emailSignature: null
            },
            branding: {
                logoUrl: null,
                companyName: null,
                primaryColor: '#3A6746',
                accentColor: '#FFC700',
                hidePoweredBy: false
            },
            stats: {
                totalPitches: 0,
                totalViews: 0,
                lastPitchAt: null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Created new user:', userId);

        if (email) {
            try {
                await emailService.sendWelcomeEmail(email, {
                    displayName: null // Will use generic greeting
                });
                console.log('Welcome email sent to:', email);
            } catch (emailError) {
                console.error('Failed to send welcome email:', emailError);
            }
        }

        return { isNew: true };
    }

    await userRef.update({
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { isNew: false, data: userDoc.data() };
}

// ── Usage tracking ─────────────────────────────────────────────────────────────

/**
 * Check whether the user has remaining pitch quota for the current period.
 * Returns { allowed, used, limit } — or { allowed: false, ... } when capped.
 * @param {string} userId
 * @returns {Promise<{allowed: boolean, used: number, limit: number, message?: string}>}
 */
async function checkAndUpdateUsage(userId) {
    console.log('=== CHECKING USAGE FOR USER ===');
    console.log('User ID:', userId);

    const db = getDb();
    const period = getCurrentPeriod();
    const usageId = `${userId}_${period}`;
    const usageRef = db.collection('usage').doc(usageId);
    const usageDoc = await usageRef.get();

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // subscription.plan must come first — Stripe writes here; userData.plan/tier is stale (set at signup)
    const rawPlan = userData?.subscription?.plan ||
                    userData?.subscription?.tier ||
                    userData?.plan ||
                    userData?.tier;
    let planTier;
    if (typeof rawPlan === 'string') {
        planTier = rawPlan.toLowerCase();
    } else if (rawPlan && typeof rawPlan === 'object') {
        planTier = (rawPlan.tier || 'starter').toLowerCase();
    } else {
        planTier = 'starter';
    }

    console.log('User plan detected:', planTier);

    const planLimits = {
        free:       { pitches: 5,  apiCalls: 100 },
        starter:    { pitches: 5,  apiCalls: 100 },
        growth:     { pitches: 25, apiCalls: 5000 },
        scale:      { pitches: -1, apiCalls: -1 },      // UNLIMITED
        enterprise: { pitches: -1, apiCalls: -1 }       // UNLIMITED
    };

    const limits = planLimits[planTier] || planLimits.starter;
    console.log('Plan limits:', limits);

    if (limits.pitches === -1) {
        console.log('✅ UNLIMITED PLAN - Skipping usage check');
        return { allowed: true, used: 0, limit: -1 };
    }

    if (!usageDoc.exists) {
        await usageRef.set({
            userId:           userId,
            period:           period,
            pitchesGenerated: 0,
            apiCalls:         0,
            limits:           limits,
            createdAt:        admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:        admin.firestore.FieldValue.serverTimestamp()
        });
        return { allowed: true, used: 0, limit: limits.pitches };
    }

    const usage = usageDoc.data();
    const used  = usage.pitchesGenerated || 0;
    const limit = limits.pitches;

    console.log(`Usage: ${used}/${limit}`);

    if (limit !== -1 && used >= limit) {
        console.log('❌ LIMIT REACHED');
        return { allowed: false, used, limit, message: 'Monthly pitch limit reached. Please upgrade your plan.' };
    }

    console.log('✅ USAGE OK - Allowing pitch');
    return { allowed: true, used, limit };
}

/**
 * Increment a usage counter for the current billing period.
 * Also bumps stats.totalPitches on the user document.
 * @param {string} userId
 * @param {string} [field='pitchesGenerated']
 */
async function incrementUsage(userId, field = 'pitchesGenerated') {
    const db = getDb();
    const period  = getCurrentPeriod();
    const usageId = `${userId}_${period}`;
    const usageRef = db.collection('usage').doc(usageId);

    try {
        await usageRef.update({
            [field]:      admin.firestore.FieldValue.increment(1),
            updatedAt:    admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        // Document might not exist yet — create it
        await usageRef.set({
            userId:    userId,
            period:    period,
            [field]:   1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    const userRef = db.collection('users').doc(userId);
    try {
        await userRef.update({
            'stats.totalPitches': admin.firestore.FieldValue.increment(1),
            'stats.lastPitchAt':  admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.log('Could not update user stats:', error.message);
    }
}

// ── Analytics ──────────────────────────────────────────────────────────────────

/**
 * Record a pitch view in pitchAnalytics and update the pitch document counters.
 * Errors are swallowed — view tracking must never block the response.
 * @param {string} pitchId
 * @param {string|null} viewerId
 * @param {object} [context={}]
 */
async function trackPitchView(pitchId, viewerId, context = {}) {
    try {
        const db = getDb();
        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        const today = new Date().toISOString().split('T')[0];

        await analyticsRef.set({
            pitchId:                    pitchId,
            views:                      admin.firestore.FieldValue.increment(1),
            [`viewsByDay.${today}`]:    admin.firestore.FieldValue.increment(1),
            lastViewedAt:               admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:                  admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await analyticsRef.collection('events').add({
            type:      'view',
            viewerId:  viewerId || 'anonymous',
            context:   context,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const pitchRef = db.collection('pitches').doc(pitchId);
        await pitchRef.update({
            'analytics.views':        admin.firestore.FieldValue.increment(1),
            'analytics.lastViewedAt': admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});

    } catch (error) {
        console.error('Error tracking view:', error.message);
    }
}

// ── Trigger event extraction ───────────────────────────────────────────────────

/**
 * Fetch a URL and use Gemini to extract key sales-context fields.
 * @param {string} url
 * @returns {Promise<object>} Extracted trigger event data
 */
async function extractTriggerEventContent(url) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SynchIntro/1.0; +https://synchintro.com)',
            'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();

    const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000);

    let source = 'Article';
    if (url.includes('linkedin.com'))                                       source = 'LinkedIn';
    else if (url.includes('twitter.com') || url.includes('x.com'))         source = 'Twitter/X';
    else if (url.includes('facebook.com'))                                  source = 'Facebook';
    else if (url.includes('bizjournals.com'))                               source = 'Business Journal';
    else if (url.includes('prnewswire.com') || url.includes('businesswire.com')) source = 'Press Release';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Extract key information from this article/post for a sales outreach context.

URL: ${url}

Content:
${textContent}

Extract and return JSON with these fields:
- headline: The main headline or title (string)
- summary: A 1-2 sentence summary relevant for sales outreach (string)
- date: Publication date if found (string, or null)
- keyPoints: Array of 2-4 key points that would be relevant for a sales pitch (array of strings)
- companyMentioned: Primary company/organization mentioned (string, or null)
- eventType: Type of event - one of: "expansion", "new_location", "funding", "partnership", "leadership_change", "product_launch", "growth", "other" (string)

Return ONLY valid JSON, no markdown formatting.`;

    const result      = await model.generateContent(prompt);
    const responseText = result.response.text();

    let extracted;
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            extracted = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('No JSON found in response');
        }
    } catch (parseError) {
        console.error('Failed to parse AI response:', responseText);
        extracted = {
            headline:         'News Article',
            summary:          textContent.substring(0, 200) + '...',
            date:             null,
            keyPoints:        [],
            companyMentioned: null,
            eventType:        'other'
        };
    }

    return { ...extracted, source, url };
}

module.exports = {
    ensureUserExists,
    checkAndUpdateUsage,
    incrementUsage,
    trackPitchView,
    extractTriggerEventContent
};
