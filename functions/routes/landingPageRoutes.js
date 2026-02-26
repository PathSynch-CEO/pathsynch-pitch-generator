/**
 * Landing Page Routes
 *
 * API endpoints for generating personalized landing pages from pitches.
 * Landing pages are prospect-specific pages that can be shared and tracked.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');
const modelRouter = require('../services/modelRouter');

const router = createRouter();
const db = admin.firestore();

// Landing page limits by tier
const LANDING_PAGE_LIMITS = {
    free: 2,        // Total (not monthly) - with "Powered by SynchIntro" badge
    starter: 5,     // Per month
    growth: 25,     // Per month
    scale: -1,      // Unlimited
    enterprise: -1
};

// Tiers that can remove "Powered by" badge
const NO_BADGE_TIERS = ['scale', 'enterprise'];

/**
 * Generate a URL-friendly slug
 */
function generateSlug(prospectCompany, sellerCompany) {
    const prospect = prospectCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    const seller = sellerCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20);
    const date = new Date().toISOString().slice(0, 7).replace('-', ''); // YYYYMM
    const random = crypto.randomBytes(3).toString('hex');
    return `${prospect}-${seller}-${date}-${random}`;
}

/**
 * Hash IP address for privacy-compliant storage
 */
function hashIP(ip) {
    return crypto.createHash('sha256').update(ip + 'synchintro-salt').digest('hex').substring(0, 16);
}

/**
 * Get user's tier and check landing page limits
 */
async function getUserTierAndCheckLimit(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const tier = (userData.tier || userData.plan || 'starter').toLowerCase();

    // For free tier, count total pages (not monthly)
    if (tier === 'free') {
        const totalSnapshot = await db.collection('landingPages')
            .where('userId', '==', userId)
            .get();
        const totalPages = totalSnapshot.size;
        const limit = LANDING_PAGE_LIMITS.free;

        return {
            tier,
            pagesCount: totalPages,
            limit,
            canRemoveBadge: false,
            atLimit: totalPages >= limit
        };
    }

    // For paid tiers, count this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const pagesSnapshot = await db.collection('landingPages')
        .where('userId', '==', userId)
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
        .get();

    const pagesThisMonth = pagesSnapshot.size;
    const limit = LANDING_PAGE_LIMITS[tier] || LANDING_PAGE_LIMITS.starter;
    const canRemoveBadge = NO_BADGE_TIERS.includes(tier);

    return {
        tier,
        pagesCount: pagesThisMonth,
        limit,
        canRemoveBadge,
        atLimit: limit !== -1 && pagesThisMonth >= limit
    };
}

/**
 * Build the AI prompt for landing page content
 */
function buildLandingPagePrompt(pitchData, contactName, contactTitle) {
    const prompt = `Transform this sales pitch data into compelling landing page copy.

## PITCH DATA
Company: ${pitchData.businessName || 'Unknown Prospect'}
Industry: ${pitchData.industry || 'Unknown'}
${pitchData.address ? `Location: ${pitchData.address}` : ''}
${pitchData.websiteUrl ? `Website: ${pitchData.websiteUrl}` : ''}

${contactName ? `## CONTACT
Name: ${contactName}
${contactTitle ? `Title: ${contactTitle}` : ''}` : ''}

## EXISTING PITCH CONTENT
${pitchData.content ? pitchData.content.substring(0, 3000) : 'No content available'}

## REQUIRED OUTPUT (JSON format)
Generate landing page copy as a JSON object:
{
    "headline": "A compelling, benefit-focused headline (max 10 words)",
    "subheadline": "Supporting statement that creates urgency or curiosity (max 20 words)",
    "painPoints": ["3-4 pain points the prospect likely experiences"],
    "solution": "How the seller's product/service solves these problems (2-3 sentences)",
    "socialProof": ["2-3 credibility indicators (can be placeholders like 'Trusted by 100+ companies')"],
    "stats": [
        {"value": "X%", "label": "improvement metric"},
        {"value": "Xh", "label": "time saved metric"},
        {"value": "$XK", "label": "cost saved metric"}
    ],
    "cta": {
        "text": "Primary call-to-action text (e.g., 'Schedule a Call')",
        "urgency": "Optional urgency text below CTA"
    }
}

INSTRUCTIONS:
- Make the headline SPECIFIC to the prospect's industry/business
- Pain points should feel like the prospect wrote them (use their language)
- Stats should be believable and relevant to the industry
- Keep copy concise - this is a landing page, not a pitch deck
- Return ONLY the JSON object, no additional text.`;

    return prompt;
}

/**
 * Generate HTML template for landing page
 */
function generateLandingPageHTML(pageData) {
    const { pageContent, prospectCompany, prospectLogo, sellerCompany, sellerLogo, showBadge, ctaType, ctaDestination } = pageData;

    const ctaButton = ctaType === 'calendly'
        ? `<a href="${ctaDestination}" target="_blank" class="lp-cta-button">${pageContent.cta?.text || 'Schedule a Call'}</a>`
        : ctaType === 'email'
        ? `<a href="mailto:${ctaDestination}" class="lp-cta-button">${pageContent.cta?.text || 'Get in Touch'}</a>`
        : `<a href="${ctaDestination}" target="_blank" class="lp-cta-button">${pageContent.cta?.text || 'Learn More'}</a>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageContent.headline || 'Custom Offer'} | ${prospectCompany}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #1a1a2e; }
        .lp-container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        .lp-header { text-align: center; margin-bottom: 40px; }
        .lp-logos { display: flex; justify-content: center; align-items: center; gap: 20px; margin-bottom: 30px; }
        .lp-logo { height: 40px; max-width: 120px; object-fit: contain; }
        .lp-headline { font-size: 2.5rem; font-weight: 700; color: #1a1a2e; margin-bottom: 16px; }
        .lp-subheadline { font-size: 1.25rem; color: #4a5568; }
        .lp-section { margin-bottom: 40px; }
        .lp-section-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 20px; color: #0A9933; }
        .lp-pain-points { list-style: none; }
        .lp-pain-points li { padding: 12px 0; padding-left: 30px; position: relative; border-bottom: 1px solid #e2e8f0; }
        .lp-pain-points li::before { content: "\\2022"; color: #e53e3e; font-size: 1.5rem; position: absolute; left: 0; top: 8px; }
        .lp-solution { background: linear-gradient(135deg, #f0fff4 0%, #e6fffa 100%); padding: 30px; border-radius: 12px; font-size: 1.1rem; }
        .lp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; text-align: center; }
        .lp-stat { background: #f7fafc; padding: 24px; border-radius: 8px; }
        .lp-stat-value { font-size: 2rem; font-weight: 700; color: #0A9933; }
        .lp-stat-label { font-size: 0.9rem; color: #718096; }
        .lp-social-proof { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }
        .lp-proof-item { background: #fff; border: 1px solid #e2e8f0; padding: 12px 20px; border-radius: 8px; font-size: 0.9rem; }
        .lp-cta-section { text-align: center; padding: 40px; background: #1a1a2e; border-radius: 12px; color: white; }
        .lp-cta-button { display: inline-block; background: #0A9933; color: white; padding: 16px 40px; border-radius: 8px; font-size: 1.1rem; font-weight: 600; text-decoration: none; transition: transform 0.2s, box-shadow 0.2s; }
        .lp-cta-button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(10, 153, 51, 0.4); }
        .lp-cta-urgency { margin-top: 12px; font-size: 0.9rem; opacity: 0.8; }
        .lp-badge { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 0.8rem; color: #a0aec0; }
        .lp-badge a { color: #0A9933; text-decoration: none; }
        @media (max-width: 600px) {
            .lp-headline { font-size: 1.75rem; }
            .lp-stats { grid-template-columns: 1fr; }
            .lp-logos { flex-direction: column; }
        }
    </style>
    <script>
        // Track page view
        (function() {
            var data = {
                slug: '${pageData.slug}',
                referrer: document.referrer,
                userAgent: navigator.userAgent
            };
            fetch('${process.env.FUNCTIONS_EMULATOR ? 'http://localhost:5001/pathsynch-pitch-creation/us-central1/api/v1' : 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1'}/landing-pages/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).catch(function() {});

            // Track time on page
            var startTime = Date.now();
            window.addEventListener('beforeunload', function() {
                var timeOnPage = Math.round((Date.now() - startTime) / 1000);
                navigator.sendBeacon('${process.env.FUNCTIONS_EMULATOR ? 'http://localhost:5001/pathsynch-pitch-creation/us-central1/api/v1' : 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1'}/landing-pages/track', JSON.stringify({
                    slug: '${pageData.slug}',
                    event: 'time_on_page',
                    duration: timeOnPage
                }));
            });
        })();

        // Track CTA click
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('lp-cta-button')) {
                fetch('${process.env.FUNCTIONS_EMULATOR ? 'http://localhost:5001/pathsynch-pitch-creation/us-central1/api/v1' : 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1'}/landing-pages/track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slug: '${pageData.slug}', event: 'cta_click' })
                }).catch(function() {});
            }
        });
    </script>
</head>
<body>
    <div class="lp-container">
        <header class="lp-header">
            <div class="lp-logos">
                ${sellerLogo ? `<img src="${sellerLogo}" alt="${sellerCompany}" class="lp-logo">` : ''}
                ${prospectLogo ? `<span style="color: #cbd5e0;">+</span><img src="${prospectLogo}" alt="${prospectCompany}" class="lp-logo">` : ''}
            </div>
            <h1 class="lp-headline">${pageContent.headline || 'A Custom Solution for ' + prospectCompany}</h1>
            <p class="lp-subheadline">${pageContent.subheadline || ''}</p>
        </header>

        ${pageContent.painPoints && pageContent.painPoints.length > 0 ? `
        <section class="lp-section">
            <h2 class="lp-section-title">Sound Familiar?</h2>
            <ul class="lp-pain-points">
                ${pageContent.painPoints.map(p => `<li>${p}</li>`).join('')}
            </ul>
        </section>
        ` : ''}

        ${pageContent.solution ? `
        <section class="lp-section">
            <h2 class="lp-section-title">Here's How We Help</h2>
            <div class="lp-solution">${pageContent.solution}</div>
        </section>
        ` : ''}

        ${pageContent.stats && pageContent.stats.length > 0 ? `
        <section class="lp-section">
            <h2 class="lp-section-title">The Results</h2>
            <div class="lp-stats">
                ${pageContent.stats.map(s => `
                <div class="lp-stat">
                    <div class="lp-stat-value">${s.value}</div>
                    <div class="lp-stat-label">${s.label}</div>
                </div>
                `).join('')}
            </div>
        </section>
        ` : ''}

        ${pageContent.socialProof && pageContent.socialProof.length > 0 ? `
        <section class="lp-section">
            <div class="lp-social-proof">
                ${pageContent.socialProof.map(p => `<div class="lp-proof-item">${p}</div>`).join('')}
            </div>
        </section>
        ` : ''}

        <section class="lp-cta-section">
            ${ctaButton}
            ${pageContent.cta?.urgency ? `<p class="lp-cta-urgency">${pageContent.cta.urgency}</p>` : ''}
        </section>

        ${showBadge ? `
        <div class="lp-badge">
            Powered by <a href="https://synchintro.ai" target="_blank">SynchIntro</a>
        </div>
        ` : ''}
    </div>
</body>
</html>`;
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /landing-pages/generate
 * Generate a new landing page from pitch data
 */
router.post('/landing-pages/generate', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const {
            pitchId,
            contactName,
            contactTitle,
            ctaType,
            ctaDestination,
            expiresInDays
        } = req.body;

        // Validate required fields
        if (!pitchId) {
            throw new ApiError('Pitch ID is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        // Get pitch data
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();
        if (!pitchDoc.exists) {
            throw new ApiError('Pitch not found', 404, ErrorCodes.NOT_FOUND);
        }

        const pitchData = pitchDoc.data();
        if (pitchData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        // Check user limits
        const userStatus = await getUserTierAndCheckLimit(userId);
        if (userStatus.atLimit) {
            const limitMsg = userStatus.tier === 'free'
                ? `Free accounts are limited to ${userStatus.limit} total landing pages. Upgrade to create more.`
                : `You've reached your monthly limit of ${userStatus.limit} landing pages. Upgrade for more.`;
            throw new ApiError(limitMsg, 403, ErrorCodes.RATE_LIMITED);
        }

        // Get user info for seller details
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        console.log(`Generating landing page for pitch ${pitchId} (user: ${userId}, tier: ${userStatus.tier})`);

        // Generate landing page content via AI
        const prompt = buildLandingPagePrompt(pitchData, contactName, contactTitle);

        let pageContent;
        try {
            const aiResult = await modelRouter.generateNarrative(
                prompt,
                { type: 'landing_page', company: pitchData.businessName },
                { userId }
            );

            const jsonMatch = aiResult.narrative.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                pageContent = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found');
            }
        } catch (parseError) {
            console.warn('AI content generation failed, using fallback:', parseError.message);
            pageContent = {
                headline: `A Custom Solution for ${pitchData.businessName || 'Your Business'}`,
                subheadline: 'Discover how we can help you achieve your goals',
                painPoints: ['Struggling to find the right solution', 'Wasting time on inefficient processes', 'Looking for a trusted partner'],
                solution: 'We provide tailored solutions designed specifically for your industry and challenges.',
                socialProof: ['Trusted by industry leaders', 'Proven results'],
                stats: [
                    { value: '50%', label: 'efficiency gain' },
                    { value: '10hrs', label: 'saved weekly' },
                    { value: '$25K', label: 'annual savings' }
                ],
                cta: { text: 'Schedule a Call', urgency: 'Limited availability this month' }
            };
        }

        // Generate slug
        const slug = generateSlug(
            pitchData.businessName || 'prospect',
            userData.companyName || userData.profile?.companyName || 'seller'
        );

        // Calculate expiration
        const expiresAt = expiresInDays
            ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000))
            : null;

        // Create landing page document
        const pageRef = db.collection('landingPages').doc();
        const pageId = pageRef.id;

        const pageData = {
            id: pageId,
            slug,
            userId,
            pitchId,
            prospectCompany: pitchData.businessName || 'Unknown',
            prospectLogo: pitchData.prospectLogo || null,
            contactName: contactName || null,
            contactTitle: contactTitle || null,
            sellerCompany: userData.companyName || userData.profile?.companyName || '',
            sellerLogo: userData.companyLogo || userData.profile?.companyLogo || null,
            pageContent,
            ctaType: ctaType || 'calendly',
            ctaDestination: ctaDestination || '',
            expiresAt,
            isActive: true,
            showBadge: !userStatus.canRemoveBadge,
            views: 0,
            uniqueViews: 0,
            ctaClicks: 0,
            avgTimeOnPage: 0,
            viewLog: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await pageRef.set(pageData);

        // Generate the page URL
        const pageUrl = `https://app.synchintro.ai/p/l/${slug}`;

        return res.status(201).json({
            success: true,
            data: {
                id: pageId,
                slug,
                url: pageUrl,
                ...pageData,
                createdAt: new Date().toISOString()
            }
        });

    } catch (error) {
        return handleError(error, res, 'POST /landing-pages/generate');
    }
});

/**
 * GET /landing-pages
 * List user's landing pages
 */
router.get('/landing-pages', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const limit = parseInt(req.query.limit) || 20;

        const snapshot = await db.collection('landingPages')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const pages = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                url: `https://app.synchintro.ai/p/l/${data.slug}`,
                createdAt: data.createdAt?.toDate?.() || null,
                expiresAt: data.expiresAt?.toDate?.() || null
            };
        });

        // Get user limits
        const userStatus = await getUserTierAndCheckLimit(userId);

        return res.status(200).json({
            success: true,
            data: pages,
            limits: {
                used: userStatus.pagesCount,
                limit: userStatus.limit,
                remaining: userStatus.limit === -1 ? -1 : Math.max(0, userStatus.limit - userStatus.pagesCount)
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /landing-pages');
    }
});

/**
 * GET /landing-pages/:id
 * Get a specific landing page with analytics
 */
router.get('/landing-pages/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const pageId = req.params.id;
        const pageDoc = await db.collection('landingPages').doc(pageId).get();

        if (!pageDoc.exists) {
            throw new ApiError('Landing page not found', 404, ErrorCodes.NOT_FOUND);
        }

        const pageData = pageDoc.data();

        if (pageData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        return res.status(200).json({
            success: true,
            data: {
                id: pageDoc.id,
                ...pageData,
                url: `https://app.synchintro.ai/p/l/${pageData.slug}`,
                createdAt: pageData.createdAt?.toDate?.() || null,
                expiresAt: pageData.expiresAt?.toDate?.() || null
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /landing-pages/:id');
    }
});

/**
 * PUT /landing-pages/:id
 * Update a landing page
 */
router.put('/landing-pages/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const pageId = req.params.id;
        const pageDoc = await db.collection('landingPages').doc(pageId).get();

        if (!pageDoc.exists) {
            throw new ApiError('Landing page not found', 404, ErrorCodes.NOT_FOUND);
        }

        const pageData = pageDoc.data();

        if (pageData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        // Only allow updating specific fields
        const allowedFields = ['isActive', 'ctaType', 'ctaDestination', 'expiresAt'];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                if (field === 'expiresAt' && req.body[field]) {
                    updates[field] = admin.firestore.Timestamp.fromDate(new Date(req.body[field]));
                } else {
                    updates[field] = req.body[field];
                }
            }
        }

        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('landingPages').doc(pageId).update(updates);

        return res.status(200).json({
            success: true,
            message: 'Landing page updated successfully'
        });

    } catch (error) {
        return handleError(error, res, 'PUT /landing-pages/:id');
    }
});

/**
 * DELETE /landing-pages/:id
 * Delete a landing page
 */
router.delete('/landing-pages/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const pageId = req.params.id;
        const pageDoc = await db.collection('landingPages').doc(pageId).get();

        if (!pageDoc.exists) {
            throw new ApiError('Landing page not found', 404, ErrorCodes.NOT_FOUND);
        }

        const pageData = pageDoc.data();

        if (pageData.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        await db.collection('landingPages').doc(pageId).delete();

        return res.status(200).json({
            success: true,
            message: 'Landing page deleted successfully'
        });

    } catch (error) {
        return handleError(error, res, 'DELETE /landing-pages/:id');
    }
});

/**
 * POST /landing-pages/track
 * Track landing page analytics (public endpoint, no auth)
 */
router.post('/landing-pages/track', async (req, res) => {
    try {
        const { slug, event, duration, referrer, userAgent } = req.body;

        if (!slug) {
            return res.status(400).json({ success: false, error: 'Slug required' });
        }

        // Find landing page by slug
        const snapshot = await db.collection('landingPages')
            .where('slug', '==', slug)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        const pageDoc = snapshot.docs[0];
        const pageId = pageDoc.id;
        const pageData = pageDoc.data();

        // Check expiration
        if (pageData.expiresAt && pageData.expiresAt.toDate() < new Date()) {
            return res.status(410).json({ success: false, error: 'Page expired' });
        }

        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
        const ipHash = hashIP(ip);

        if (event === 'cta_click') {
            // Track CTA click
            await db.collection('landingPages').doc(pageId).update({
                ctaClicks: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else if (event === 'time_on_page' && duration) {
            // Update average time on page
            const currentAvg = pageData.avgTimeOnPage || 0;
            const views = pageData.views || 1;
            const newAvg = Math.round((currentAvg * (views - 1) + duration) / views);

            await db.collection('landingPages').doc(pageId).update({
                avgTimeOnPage: newAvg,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Default: page view
            // Check if this is a unique view (IP not in viewLog)
            const isUnique = !pageData.viewLog?.some(v => v.ipHash === ipHash);

            const viewEntry = {
                viewedAt: new Date().toISOString(),
                ipHash,
                userAgent: userAgent || req.headers['user-agent'] || '',
                referrer: referrer || ''
            };

            const updates = {
                views: admin.firestore.FieldValue.increment(1),
                viewLog: admin.firestore.FieldValue.arrayUnion(viewEntry),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            if (isUnique) {
                updates.uniqueViews = admin.firestore.FieldValue.increment(1);
            }

            await db.collection('landingPages').doc(pageId).update(updates);
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Landing page tracking error:', error.message);
        return res.status(500).json({ success: false });
    }
});

/**
 * GET /landing-pages/public/:slug
 * Serve a public landing page (HTML)
 */
router.get('/landing-pages/public/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;

        // Find landing page by slug
        const snapshot = await db.collection('landingPages')
            .where('slug', '==', slug)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).send('<html><body><h1>Page not found</h1></body></html>');
        }

        const pageDoc = snapshot.docs[0];
        const pageData = pageDoc.data();

        // Check expiration
        if (pageData.expiresAt && pageData.expiresAt.toDate() < new Date()) {
            return res.status(410).send('<html><body><h1>This page has expired</h1></body></html>');
        }

        // Generate and return HTML
        const html = generateLandingPageHTML(pageData);
        res.setHeader('Content-Type', 'text/html');
        return res.send(html);

    } catch (error) {
        console.error('Landing page serve error:', error.message);
        return res.status(500).send('<html><body><h1>Error loading page</h1></body></html>');
    }
});

module.exports = router;
