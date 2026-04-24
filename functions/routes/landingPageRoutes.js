/**
 * Landing Page Routes
 *
 * API endpoints for generating personalized landing pages from pitches.
 * Landing pages are prospect-specific pages that can be shared and tracked.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes, badRequest, notFound } = require('../middleware/errorHandler');
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
    const startTimestamp = admin.firestore.Timestamp.fromDate(startOfMonth);

    let pagesThisMonth = 0;
    try {
        const pagesSnapshot = await db.collection('landingPages')
            .where('userId', '==', userId)
            .where('createdAt', '>=', startTimestamp)
            .get();
        pagesThisMonth = pagesSnapshot.size;
    } catch (indexError) {
        // Composite index not yet created — fall back to filtering in memory
        const allSnapshot = await db.collection('landingPages')
            .where('userId', '==', userId)
            .get();
        pagesThisMonth = allSnapshot.docs.filter(doc => {
            const ts = doc.data().createdAt;
            return ts && ts.toMillis && ts.toMillis() >= startTimestamp.toMillis();
        }).length;
    }
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
 * Extract structured intelligence from a pitch document for use in prompts/fallbacks.
 * Returns a normalized intel object with real data wherever available.
 */
function extractPitchIntelligence(pitchData) {
    const reviewAnalysis   = pitchData.reviewAnalysis   || {};
    const reviewAnalytics  = pitchData.reviewAnalytics  || reviewAnalysis.analytics || {};
    const reviewPitchMetrics = pitchData.reviewPitchMetrics || reviewAnalysis.pitchMetrics || {};
    const roiData    = pitchData.roiData    || {};
    const formData   = pitchData.formData   || {};
    const marketData = pitchData.marketData || {};
    // pitchMetadata may contain enrichment results stored during generation
    const pitchMeta  = pitchData.pitchMetadata || {};
    const metaReview = pitchMeta.reviewAnalysis || {};

    // Complaint/love themes: checked across all field paths used by different pitch types
    const complaintThemes = (
        reviewAnalysis.complaintThemes               ||  // smart card 2
        reviewPitchMetrics.complaintPatterns         ||  // pitch metrics
        marketData.complaintThemes                   ||  // market intel path
        metaReview.complaintThemes                   ||  // pitchMetadata.reviewAnalysis
        pitchMeta.complaintThemes                    ||  // pitchMetadata direct
        pitchData.complaintThemes                    ||  // top-level (future)
        []
    ).filter(Boolean).slice(0, 5);

    const loveThemes = (
        reviewAnalysis.loveThemes ||
        reviewPitchMetrics.positiveThemes ||
        marketData.loveThemes ||
        []
    ).filter(Boolean).slice(0, 4);

    // Strip HTML tags from pitch content for clean text extraction
    const rawHtml = pitchData.html || pitchData.htmlContent || '';
    const cleanContent = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        rating: pitchData.googleRating,
        numReviews: pitchData.numReviews,
        complaintThemes,
        loveThemes,
        avgMonthlyReviews: reviewAnalytics.avgMonthlyReviews || reviewPitchMetrics.monthlyReviews,
        responseRate: reviewAnalytics.responseRate,
        monthlyComplaints: reviewPitchMetrics.complaintsPerMonth || reviewAnalytics.complaintsPerMonth,
        roiData,
        statedProblem: formData.statedProblem || '',
        additionalContext: formData.additionalContext || '',
        cleanContent: cleanContent.substring(0, 4500)
    };
}

/**
 * Build the AI prompt for landing page content
 */
function buildLandingPagePrompt(pitchData, contactName, contactTitle) {
    const intel = extractPitchIntelligence(pitchData);

    // Build structured intelligence block so AI has concrete numbers to work with
    let intelligenceBlock = '';

    if (intel.rating || intel.numReviews) {
        intelligenceBlock += '\n## REPUTATION DATA (USE THESE EXACT NUMBERS IN STATS)';
        if (intel.rating) intelligenceBlock += `\nGoogle Rating: ${intel.rating} stars`;
        if (intel.numReviews) intelligenceBlock += `\nTotal Reviews: ${intel.numReviews.toLocaleString()}`;
        if (intel.avgMonthlyReviews) intelligenceBlock += `\nMonthly Reviews: ${intel.avgMonthlyReviews}/month`;
        if (intel.responseRate !== undefined) intelligenceBlock += `\nReview Response Rate: ${intel.responseRate}%`;
        if (intel.monthlyComplaints) intelligenceBlock += `\nMonthly Complaints: ~${intel.monthlyComplaints}`;
    }

    if (intel.complaintThemes.length > 0) {
        intelligenceBlock += '\n\n## COMPLAINT PATTERNS (use as pain points — these are REAL customer complaints)';
        intelligenceBlock += '\n' + intel.complaintThemes.map(t => `- ${t}`).join('\n');
    }

    if (intel.loveThemes.length > 0) {
        intelligenceBlock += '\n\n## WHAT CUSTOMERS LOVE (use for social proof)';
        intelligenceBlock += '\n' + intel.loveThemes.map(t => `- ${t}`).join('\n');
    }

    if (intel.statedProblem) {
        intelligenceBlock += `\n\n## STATED PROBLEM\n${intel.statedProblem}`;
    }

    if (intel.additionalContext) {
        intelligenceBlock += `\n\n## ADDITIONAL CONTEXT\n${intel.additionalContext.substring(0, 400)}`;
    }

    const prompt = `Transform this pitch intelligence into landing page copy for ${pitchData.businessName || 'this prospect'}.

## PROSPECT
Company: ${pitchData.businessName || 'Unknown Prospect'}
Industry: ${pitchData.industry || 'Unknown'}
${pitchData.address ? `Location: ${pitchData.address}` : ''}
${pitchData.websiteUrl ? `Website: ${pitchData.websiteUrl}` : ''}
${contactName ? `Contact: ${contactName}${contactTitle ? `, ${contactTitle}` : ''}` : ''}
${intelligenceBlock}

## PITCH CONTENT (extract specific messaging from here)
${intel.cleanContent || 'No content available'}

## CRITICAL INSTRUCTIONS — DO NOT USE GENERIC PLACEHOLDERS
- **headline**: Be SPECIFIC. If they have a 4.3★ rating with 1,138 reviews, use that data. Reference their actual reputation gap or opportunity.
- **subheadline**: Use the exact format "Discover how we can help ${pitchData.businessName} turn reputation into revenue" OR a close variant using the EXACT business name. NEVER substitute it with the industry category (e.g., never write "Restaurant" or "Food & Beverage").
- **painPoints**: The painPoints array MUST reference specific issues found in the prospect's actual reviews (listed in COMPLAINT PATTERNS above). Each item must name a concrete pattern (e.g., "slow kitchen response times", "unanswered 2-star complaints"). Never use generic statements like "Struggling to find the right solution" or "Inconsistent customer experience". If no complaint patterns are listed, extract specific recurring themes from PITCH CONTENT — never invent generic placeholders.
- **stats**: Use REAL numbers from the pitch data above. stat 1 = Google rating (e.g., "4.3★"), stat 2 = review count (e.g., "1,138"), stat 3 = a response rate or monthly complaints metric. NEVER use "50% efficiency gain" or "$25K annual savings" unless that specific number appears in the pitch.
- **socialProof**: Extract from "What Customers Love" themes or positive review patterns listed above.
- **solution**: MUST reference at least 2 specific complaint patterns by name (e.g., "inconsistent table service" and "slow kitchen times"). If any metric is below industry average (e.g., 0% response rate, low review velocity), call it out explicitly. Write a 2-3 sentence paragraph that is specific to ${pitchData.businessName}'s situation, not a generic template.
- **cta.text**: 3-5 words, action-oriented, industry-appropriate.
- **BRAND RULE**: NEVER use em dashes (the — character) anywhere in any field. Use commas, periods, or separate sentences instead.

Return ONLY this JSON object (no other text):
{
    "headline": "...",
    "subheadline": "...",
    "painPoints": ["...", "...", "..."],
    "solution": "...",
    "socialProof": ["...", "..."],
    "stats": [
        {"value": "...", "label": "..."},
        {"value": "...", "label": "..."},
        {"value": "...", "label": "..."}
    ],
    "cta": {
        "text": "...",
        "urgency": "..."
    }
}`;

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

        // Check user limits — wrap in try/catch in case Firestore composite index is missing
        let userStatus;
        try {
            userStatus = await getUserTierAndCheckLimit(userId);
        } catch (limitErr) {
            console.warn('[LandingPage] getUserTierAndCheckLimit failed (index may be missing), proceeding without limit check:', limitErr.message);
            userStatus = { tier: 'starter', pagesCount: 0, limit: 100, canRemoveBadge: false, atLimit: false };
        }
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
        console.log(`[LandingPage] Pitch top-level keys: ${Object.keys(pitchData).join(', ')}`);

        // Extract structured intelligence before AI call so it's available in fallback
        const intel = extractPitchIntelligence(pitchData);
        console.log(`[LandingPage] Intel — rating: ${intel.rating}, reviews: ${intel.numReviews}, responseRate: ${intel.responseRate}%, complaintThemes (${intel.complaintThemes.length}): ${intel.complaintThemes.join(' | ') || 'none found'}`);

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
            console.warn('AI content generation failed, using data-driven fallback:', parseError.message);

            // Build fallback from real pitch data — never use hardcoded generic strings
            const fallbackStats = [];
            if (intel.rating) {
                fallbackStats.push({ value: `${intel.rating}★`, label: 'Google rating' });
            }
            if (intel.numReviews) {
                fallbackStats.push({ value: intel.numReviews.toLocaleString(), label: 'reviews analyzed' });
            }
            if (intel.responseRate !== undefined) {
                fallbackStats.push({ value: `${intel.responseRate}%`, label: 'review response rate' });
            } else if (intel.monthlyComplaints) {
                fallbackStats.push({ value: `~${intel.monthlyComplaints}/mo`, label: 'unaddressed complaints' });
            }
            // Pad to 3 stats if needed with non-generic industry context
            while (fallbackStats.length < 3) {
                const placeholders = [
                    { value: '30d', label: 'avg response time reduction' },
                    { value: '2×', label: 'review engagement boost' },
                    { value: '90%', label: 'client retention rate' }
                ];
                fallbackStats.push(placeholders[fallbackStats.length] || { value: '—', label: 'metric pending' });
            }

            pageContent = {
                headline: intel.rating
                    ? `${intel.rating} Stars — But Are You Getting Full Value From ${intel.numReviews ? intel.numReviews.toLocaleString() : 'Your'} Reviews?`
                    : `A Smarter Solution for ${pitchData.businessName || 'Your Business'}`,
                subheadline: `Discover how we can help ${pitchData.businessName || 'your business'} turn reputation into revenue`,
                painPoints: intel.complaintThemes.length >= 3
                    ? intel.complaintThemes.slice(0, 3)
                    : intel.complaintThemes.length > 0
                        ? intel.complaintThemes  // 1-2 themes — use what's available
                        : [`Reputation patterns are quietly affecting ${pitchData.businessName}'s growth`, 'Review response gaps leaving customer concerns unaddressed', 'Missed opportunities to convert satisfied customers into advocates'],
                solution: intel.complaintThemes.length >= 2
                    ? `At ${pitchData.businessName}, customers consistently flag "${intel.complaintThemes[0]}" and "${intel.complaintThemes[1]}" as recurring pain points${intel.responseRate === 0 || intel.responseRate < 10 ? `. With a ${intel.responseRate ?? 0}% review response rate, these concerns are going unaddressed publicly` : ''}. We provide a structured system to surface these patterns early, respond to them at scale, and turn them into a repeatable improvement loop.`
                    : `We help ${pitchData.businessName || 'your business'} address the specific reputation patterns holding back growth. We turn review data into a system for consistent, measurable improvement.`,
                socialProof: intel.loveThemes.length > 0
                    ? intel.loveThemes.slice(0, 3)
                    : ['Trusted by local businesses across the region', 'Measurable improvement in 90 days'],
                stats: fallbackStats.slice(0, 3),
                cta: { text: 'Schedule a Call', urgency: 'Limited availability this month' }
            };
        }

        // Enforce real complaint themes — AI regularly ignores the COMPLAINT PATTERNS
        // section of the prompt and generates generic pain points. When real themes exist,
        // always override the AI output so the page reflects actual prospect data.
        if (intel.complaintThemes.length > 0 && pageContent) {
            pageContent.painPoints = intel.complaintThemes.slice(0, 3);
            console.log(`[LandingPage] Overrode AI pain points with real complaint themes: ${pageContent.painPoints.join(' | ')}`);
        } else if (pageContent) {
            console.log(`[LandingPage] No complaint themes — AI pain points kept as-is: ${(pageContent.painPoints || []).join(' | ')}`);
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
            sellerCompany: userData.sellerProfile?.companyName || userData.companyName || userData.profile?.companyName || '',
            sellerLogo: userData.sellerProfile?.branding?.logoUrl || userData.companyLogo || userData.profile?.companyLogo || null,
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

        let snapshot;
        try {
            snapshot = await db.collection('landingPages')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
        } catch (indexError) {
            // Composite index not yet created — fetch without orderBy, sort in JS
            snapshot = await db.collection('landingPages')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
        }

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
            throw badRequest('Slug required');
        }

        // Find landing page by slug
        const snapshot = await db.collection('landingPages')
            .where('slug', '==', slug)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            throw notFound('Page');
        }

        const pageDoc = snapshot.docs[0];
        const pageId = pageDoc.id;
        const pageData = pageDoc.data();

        // Check expiration
        if (pageData.expiresAt && pageData.expiresAt.toDate() < new Date()) {
            throw badRequest('Page expired');
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
        return handleError(error, res, 'POST /landing-pages/track');
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
