/**
 * PathSynch Pitch Generator
 * Version: 3.2.0
 * Last Updated: January 27, 2026
 *
 * Changes in 3.2.0:
 * - Added booking integration (Calendly/Cal.com) support
 * - Level 2 & 3: CTA buttons now link to booking URL if provided
 * - Added white-label support (hideBranding option)
 * - Added custom branding colors support
 *
 * Changes in 3.1.0:
 * - Level 2: Fixed shareable link display size, added top bar, added PathSynch products section
 * - Level 3 Slide 2: Yellow line stretches across page
 * - Level 3 Slide 7: Added "Recommended" before "90-Day Rollout"
 * - Level 3 Slide 8: Renamed to "PathSynch Package for {Business Name}", brand color box
 * - Level 3 Slide 9: Restored to previous version layout
 * - Level 3 Slide 10: Removed telephone number
 */

const admin = require('firebase-admin');
const reviewAnalytics = require('../services/reviewAnalytics');
const { calculatePitchROI, formatCurrency, safeNumber } = require('../utils/roiCalculator');
const { getIndustryIntelligence } = require('../config/industryIntelligence');
const naics = require('../config/naics');
const precallFormService = require('../services/precallForm');

// Get Firestore reference
function getDb() {
    return admin.firestore();
}

// Generate unique IDs
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Use shared ROI calculator
const calculateROI = calculatePitchROI;

/**
 * Pitch limits by tier (matches frontend CONFIG.tiers)
 * -1 means unlimited
 */
const PITCH_LIMITS = {
    free: 5,
    starter: 25,
    growth: 100,
    scale: -1,
    enterprise: -1
};

/**
 * Check if user has reached their monthly pitch limit
 * @param {string} userId - The user ID
 * @returns {Object} { allowed: boolean, used: number, limit: number, tier: string }
 */
async function checkPitchLimit(userId) {
    const db = getDb();

    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
        return { allowed: true, used: 0, limit: 5, tier: 'free' };
    }

    const userData = userDoc.data();
    const tier = (userData.subscription?.plan || userData.subscription?.tier || userData.tier || 'free').toLowerCase();
    const limit = PITCH_LIMITS[tier] ?? PITCH_LIMITS.free;

    // Unlimited tiers
    if (limit === -1) {
        return { allowed: true, used: 0, limit: -1, tier };
    }

    // Count pitches created this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const pitchesSnapshot = await db.collection('pitches')
        .where('userId', '==', userId)
        .where('createdAt', '>=', startOfMonth)
        .get();

    const used = pitchesSnapshot.size;

    return {
        allowed: used < limit,
        used,
        limit,
        tier
    };
}

/**
 * Increment user's pitch count after successful creation
 * @param {string} userId - The user ID
 */
async function incrementPitchCount(userId) {
    const db = getDb();
    await db.collection('users').doc(userId).update({
        pitchesThisMonth: admin.firestore.FieldValue.increment(1),
        totalPitches: admin.firestore.FieldValue.increment(1),
        lastPitchAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Build seller context from seller profile or use PathSynch defaults
 * @param {Object|null} sellerProfile - The seller profile from user document
 * @param {string|null} icpId - Optional ICP ID to use (for multi-ICP support)
 * @returns {Object} Normalized seller context for pitch generation
 */
function buildSellerContext(sellerProfile, icpId = null) {
    if (!sellerProfile || !sellerProfile.companyProfile?.companyName) {
        // PathSynch defaults for backward compatibility
        return {
            companyName: 'PathSynch',
            products: [
                { name: 'PathConnect', desc: 'Review capture & NFC cards', icon: '⭐' },
                { name: 'LocalSynch', desc: 'Google optimization', icon: '📍' },
                { name: 'Forms', desc: 'Surveys, Quizzes, NPS, Events', icon: '📝' },
                { name: 'QRSynch', desc: 'QR & short-link campaigns', icon: '🔗' },
                { name: 'SynchMate', desc: 'AI customer service chatbot', icon: '🤖' },
                { name: 'PathManager', desc: 'Analytics dashboard', icon: '📊' }
            ],
            pricing: '$168',
            pricingPeriod: 'per month',
            primaryColor: '#3A6746',
            accentColor: '#D4A847',
            uniqueSellingPoints: [
                'Turn reviews into revenue',
                'Unified customer engagement platform',
                'NFC + QR technology for seamless experiences',
                'AI-powered automation'
            ],
            keyBenefits: [
                'Increase Google reviews by 300%',
                'Boost local search visibility',
                'Automate customer follow-ups',
                'Track ROI in real-time'
            ],
            targetPainPoints: [
                'Difficulty getting customer reviews',
                'Low Google visibility',
                'Manual customer follow-up processes',
                'No unified customer engagement system'
            ],
            logoUrl: null,
            tone: 'professional',
            isDefault: true
        };
    }

    // Build from seller profile
    const products = (sellerProfile.products || []).map((p, i) => ({
        name: p.name,
        desc: p.description,
        price: p.pricing || null,
        icon: ['⭐', '📦', '🎯', '💡', '🚀', '📊', '🔧', '💼', '📱', '🌐'][i % 10],
        isPrimary: p.isPrimary
    }));

    // Get primary product pricing or first product with pricing
    const primaryProduct = products.find(p => p.isPrimary) || products[0];
    // Calculate total pricing from products, or use primary product price, or fallback
    const totalPrice = products.reduce((sum, p) => {
        const price = parseFloat(String(p.price || '0').replace(/[^0-9.]/g, '')) || 0;
        return sum + price;
    }, 0);
    const pricing = totalPrice > 0
        ? `$${totalPrice}`
        : (primaryProduct?.price && primaryProduct.price !== '$0' && primaryProduct.price !== '0')
            ? primaryProduct.price
            : 'Contact for pricing';

    // Get the selected ICP - support multi-ICP structure
    let selectedIcp = null;

    // Check for new icps array first
    if (sellerProfile.icps && sellerProfile.icps.length > 0) {
        if (icpId) {
            // Find specific ICP by ID
            selectedIcp = sellerProfile.icps.find(icp => icp.id === icpId);
        }
        if (!selectedIcp) {
            // Fall back to default ICP or first ICP
            selectedIcp = sellerProfile.icps.find(icp => icp.isDefault) || sellerProfile.icps[0];
        }
    } else if (sellerProfile.icp) {
        // Legacy single ICP structure
        selectedIcp = sellerProfile.icp;
    }

    return {
        companyName: sellerProfile.companyProfile.companyName,
        industry: sellerProfile.companyProfile.industry,
        companySize: sellerProfile.companyProfile.companySize,
        websiteUrl: sellerProfile.companyProfile.websiteUrl,
        products: products,
        pricing: pricing,
        pricingPeriod: '', // Custom pricing doesn't have a period
        primaryColor: sellerProfile.branding?.primaryColor || '#3A6746',
        accentColor: sellerProfile.branding?.accentColor || '#D4A847',
        uniqueSellingPoints: sellerProfile.valueProposition?.uniqueSellingPoints || [],
        keyBenefits: sellerProfile.valueProposition?.keyBenefits || [],
        differentiator: sellerProfile.valueProposition?.differentiator || null,
        // ICP data from selected ICP
        targetPainPoints: selectedIcp?.painPoints || [],
        targetIndustries: selectedIcp?.targetIndustries || [],
        targetCompanySizes: selectedIcp?.companySizes || [],
        decisionMakers: selectedIcp?.decisionMakers || [],
        icpId: selectedIcp?.id || null,
        icpName: selectedIcp?.name || null,
        logoUrl: sellerProfile.branding?.logoUrl || null,
        tone: sellerProfile.branding?.tone || 'professional',
        isDefault: false
    };
}

/**
 * Fetch and process pre-call form data for pitch enhancement
 * @param {string} precallFormId - The pre-call form ID
 * @param {string} userId - User ID for authorization
 * @returns {Object|null} Enhanced pitch data from form responses
 */
async function getPrecallFormEnhancement(precallFormId, userId) {
    if (!precallFormId) return null;

    try {
        const db = getDb();
        const formDoc = await db.collection('precallForms').doc(precallFormId).get();

        if (!formDoc.exists) {
            console.log('Pre-call form not found:', precallFormId);
            return null;
        }

        const formData = formDoc.data();

        // Verify ownership
        if (formData.userId !== userId) {
            console.log('Pre-call form ownership mismatch');
            return null;
        }

        // Check if form has responses
        if (formData.status !== 'completed' || !formData.responses) {
            console.log('Pre-call form not completed yet');
            return null;
        }

        // Map responses to pitch enhancement using the service
        const pitchEnhancement = precallFormService.mapResponsesToPitchData(formData.responses);

        return {
            formId: precallFormId,
            prospectName: formData.prospectName,
            prospectEmail: formData.prospectEmail,
            completedAt: formData.completedAt,
            responses: formData.responses,
            enhancement: pitchEnhancement,
            // Include the prospect's exact words for personalization
            prospectChallenge: formData.responses.challenge || null,
            prospectTimeline: formData.responses.timeline || null,
            prospectBudget: formData.responses.budget || null,
            prospectCurrentSolution: formData.responses.current_solution || [],
            prospectPriorityFeatures: formData.responses.priority_features || []
        };
    } catch (error) {
        console.error('Error fetching pre-call form:', error);
        return null;
    }
}

/**
 * Enhance inputs with pre-call form data
 * @param {Object} inputs - Original pitch inputs
 * @param {Object} precallData - Pre-call form enhancement data
 * @returns {Object} Enhanced inputs
 */
function enhanceInputsWithPrecallData(inputs, precallData) {
    if (!precallData) return inputs;

    const enhanced = { ...inputs };

    // Use prospect's challenge as the stated problem if available
    if (precallData.prospectChallenge) {
        enhanced.statedProblem = precallData.prospectChallenge;
        enhanced.prospectExactWords = true; // Flag to indicate we're using their words
    }

    // Add urgency context
    if (precallData.enhancement?.urgency) {
        enhanced.urgencyLevel = precallData.enhancement.urgency;
    }

    // Add competitive context
    if (precallData.prospectCurrentSolution?.length > 0) {
        enhanced.currentSolutions = precallData.prospectCurrentSolution;
    }

    // Add priority features
    if (precallData.prospectPriorityFeatures?.length > 0) {
        enhanced.priorityFeatures = precallData.prospectPriorityFeatures;
    }

    // Add stakeholder info
    if (precallData.enhancement?.stakeholders?.length > 0) {
        enhanced.stakeholders = precallData.enhancement.stakeholders;
    }

    return enhanced;
}

// Helper: Adjust color brightness (positive = lighter, negative = darker)
function adjustColor(hex, percent) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse RGB values
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Adjust by percentage
    r = Math.min(255, Math.max(0, Math.round(r + (r * percent / 100))));
    g = Math.min(255, Math.max(0, Math.round(g + (g * percent / 100))));
    b = Math.min(255, Math.max(0, Math.round(b + (b * percent / 100))));

    // Convert back to hex
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Helper: Truncate text to a maximum character length
function truncateText(text, maxLength = 100, suffix = '...') {
    if (!text || typeof text !== 'string') return text || '';
    if (text.length <= maxLength) return text;
    // Try to cut at a word boundary
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
        return truncated.substring(0, lastSpace) + suffix;
    }
    return truncated + suffix;
}

// Content length limits for slides
const CONTENT_LIMITS = {
    uspItem: 80,           // Each USP bullet point
    benefitItem: 80,       // Each key benefit bullet point
    productName: 30,       // Product name
    productDesc: 60,       // Product description
    slideIntro: 150,       // Slide intro paragraph
    differentiator: 150    // Differentiator text
};

// Generate Level 1: Outreach Sequences
function generateLevel1(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const contactName = inputs.contactName || 'there';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || null;
    const statedProblem = inputs.statedProblem || 'increasing customer engagement';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);
    const primaryDecisionMaker = salesIntel.decisionMakers[0] || 'Owner';
    const keyPainPoint = salesIntel.painPoints[0] || 'growing customer base';
    const topKPI = salesIntel.primaryKPIs[0] || 'customer growth';
    const topChannel = salesIntel.topChannels[0] || 'Google Business Profile';

    // Branding options (white-label support) - use sellerContext first
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const customFooterText = options.footerText || inputs.footerText || '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Outreach Sequence: ${businessName}</title>
    <style>
        :root {
            --primary-color: ${customPrimaryColor};
            --accent-color: ${customAccentColor};
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 32px;
        }
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, ${adjustColor(customPrimaryColor, -20)} 100%);
            color: white;
            padding: 32px;
            border-radius: 12px;
            margin-bottom: 32px;
        }
        .header h1 { font-size: 28px; margin-bottom: 8px; }
        .header p { opacity: 0.9; font-size: 16px; }
        .meta-row {
            display: flex;
            gap: 24px;
            margin-top: 16px;
            font-size: 14px;
        }
        .meta-row span {
            background: rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 20px;
        }
        .channel-section {
            background: white;
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .channel-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #f0f0f0;
        }
        .channel-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .email-icon { background: #e3f2fd; }
        .linkedin-icon { background: #e8f4f8; }
        .channel-header h2 { font-size: 20px; color: #333; }
        .sequence-item {
            border: 1px solid #e8e8e8;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 16px;
            position: relative;
        }
        .sequence-item:last-child { margin-bottom: 0; }
        .timing-badge {
            position: absolute;
            top: -10px;
            left: 20px;
            background: var(--primary-color);
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .sequence-item h4 {
            font-size: 15px;
            color: var(--primary-color);
            margin-bottom: 12px;
            margin-top: 8px;
        }
        .sequence-item .content {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 8px;
            font-size: 14px;
            white-space: pre-wrap;
        }
        .personalization-section {
            background: #fffbf0;
            border: 1px solid #ffe0a0;
            border-radius: 12px;
            padding: 24px;
            margin-top: 24px;
        }
        .personalization-section h3 {
            color: #b8860b;
            margin-bottom: 16px;
        }
        .personalization-section ul {
            list-style: none;
        }
        .personalization-section li {
            padding: 8px 0;
            border-bottom: 1px dashed #ffe0a0;
            font-size: 14px;
        }
        .personalization-section li:last-child { border: none; }
        @media print {
            body { background: white; }
            .container { max-width: 100%; padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Outreach Sequence: ${businessName}</h1>
            <p>Multi-channel approach for ${contactName}</p>
            <div class="meta-row">
                <span>⭐ ${googleRating} rating</span>
                <span>📝 ${numReviews} reviews</span>
                <span>🏢 ${industry}</span>
            </div>
        </div>

        <!-- Email Sequence -->
        <div class="channel-section">
            <div class="channel-header">
                <div class="channel-icon email-icon">📧</div>
                <div>
                    <h2>Email Sequence</h2>
                    <p style="color: #888; font-size: 14px;">3 emails over 8 days</p>
                </div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 1</div>
                <h4>Initial Outreach${inputs.triggerEvent ? ' (Trigger-Based)' : ''}</h4>
                <div class="content">Subject: ${inputs.triggerEvent ? `Congrats on ${inputs.triggerEvent.headline ? inputs.triggerEvent.headline.substring(0, 40) + '...' : 'the news'} - quick idea` : `Quick idea for ${businessName}'s ${topKPI}`}

Hi ${contactName},

${inputs.triggerEvent ? `I saw the news about "${inputs.triggerEvent.headline || 'your recent announcement'}" - congratulations! ${inputs.triggerEvent.summary ? inputs.triggerEvent.summary.substring(0, 150) : ''}

Given this exciting development, I wanted to reach out because` : `I came across ${businessName} and was impressed by your ${googleRating}-star rating. With ${numReviews} reviews, you've clearly built something customers love.`}

I work with ${industry} businesses who are dealing with ${keyPainPoint.toLowerCase()}. We help turn customer loyalty into measurable growth:
• +${roiData.growthRate}% more foot traffic from improved ${topChannel} visibility
• +25% increase in repeat customers
• ${roiData.roi}%+ ROI in the first 6 months

Would you be open to a 15-minute call this week to see if there's a fit?

Best,
[Your Name]
${companyName}</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 4</div>
                <h4>Value-Add Follow-up</h4>
                <div class="content">Subject: Re: Quick idea for ${businessName}'s ${topKPI}

Hi ${contactName},

Following up on my note about improving ${businessName}'s ${topKPI.toLowerCase()}.

I put together a quick analysis based on your Google profile:
• Your current rating (${googleRating}★) puts you ahead of many competitors
• Improving your ${topChannel} presence could add ~${roiData.newCustomers} new customers/month
• That translates to roughly $${formatCurrency(roiData.monthlyIncrementalRevenue)}/month in additional revenue

Many ${industry} ${primaryDecisionMaker.toLowerCase()}s I work with were surprised by the impact.

Worth a conversation?

Best,
[Your Name]</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 8</div>
                <h4>Final Touch</h4>
                <div class="content">Subject: One more thought on ${businessName}

Hi ${contactName},

Last note from me - I know you're busy running ${businessName}.

If now isn't the right time, no worries. But if ${statedProblem} is on your radar, I'd love to share how other ${industry} businesses are tackling it.

Either way, keep up the great work!

Best,
[Your Name]</div>
            </div>
        </div>

        <!-- LinkedIn Sequence -->
        <div class="channel-section">
            <div class="channel-header">
                <div class="channel-icon linkedin-icon">💼</div>
                <div>
                    <h2>LinkedIn Sequence</h2>
                    <p style="color: #888; font-size: 14px;">Connection + 2 follow-ups</p>
                </div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 2</div>
                <h4>Connection Request</h4>
                <div class="content">Hi ${contactName}! I noticed ${businessName}'s great reputation in the ${industry} space. I help similar businesses grow their local presence - would love to connect and share some ideas.</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 5</div>
                <h4>Post-Connection Message</h4>
                <div class="content">Thanks for connecting, ${contactName}!

I've been researching ${businessName} - your ${googleRating}-star rating is impressive. I work with ${industry} owners on turning that goodwill into consistent growth.

Quick question: Is building online visibility a priority for you this quarter?</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 9</div>
                <h4>Insight Share</h4>
                <div class="content">Hi ${contactName},

Just worked with a ${industry} client who increased their reviews by 200% in 60 days. Their secret? Making it frictionless for happy customers to share their experience.

If you're curious how they did it, happy to share. No pitch - just thought it might be useful for ${businessName}.</div>
            </div>
        </div>

        <!-- Sales Intelligence -->
        <div class="personalization-section" style="background: #f0fdf4; border-color: #86efac;">
            <h3 style="color: #166534;">🎯 Sales Intelligence: ${industry}${subIndustry ? ' - ' + subIndustry : ''}</h3>
            <ul>
                <li><strong>Decision Makers:</strong> ${salesIntel.decisionMakers.join(', ')}</li>
                <li><strong>Key Pain Points:</strong>
                    <ul style="margin-top: 8px; margin-left: 20px;">
                        ${salesIntel.painPoints.slice(0, 3).map(pp => `<li style="border: none; padding: 4px 0;">${pp}</li>`).join('')}
                    </ul>
                </li>
                <li><strong>KPIs They Track:</strong> ${salesIntel.primaryKPIs.slice(0, 4).join(', ')}</li>
                <li><strong>Top Channels:</strong> ${salesIntel.topChannels.slice(0, 4).join(', ')}</li>
            </ul>
        </div>

        <!-- Personalization Notes -->
        <div class="personalization-section">
            <h3>📝 Personalization Notes</h3>
            <ul>
                <li><strong>Review highlights:</strong> ${reviewData?.topThemes?.length ? reviewData.topThemes.join(', ') : 'Mention specific positive feedback from their reviews'}</li>
                <li><strong>Stated problem:</strong> ${statedProblem || 'Focus on visibility and customer retention'}</li>
                <li><strong>ROI hook:</strong> ~$${formatCurrency(roiData.sixMonthRevenue)} potential in 6 months</li>
                ${reviewData?.staffMentions?.length ? `<li><strong>Staff mentions:</strong> ${reviewData.staffMentions.join(', ')}</li>` : ''}
            </ul>
        </div>

        ${customFooterText ? `
        <div style="margin-top: 32px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>
        ` : ''}

        ${!hideBranding ? `
        <div style="margin-top: 24px; text-align: center; padding: 16px;">
            <p style="color: #999; font-size: 12px;">Powered by ${companyName}</p>
        </div>
        ` : ''}
    </div>
</body>
</html>`;
}

// Generate Level 2: One-Pager (UPDATED with booking integration and market data)
function generateLevel2(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || null;
    const statedProblem = inputs.statedProblem || 'increasing customer engagement and visibility';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);

    // Booking & branding options - use sellerContext first
    const bookingUrl = options.bookingUrl || inputs.bookingUrl || null;
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const customLogo = options.sellerContext?.logoUrl || options.logoUrl || inputs.logoUrl || null;
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || inputs.contactEmail || 'hello@pathsynch.com';
    const customFooterText = options.footerText || inputs.footerText || '';

    // Review analysis data
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality service', 'Friendly staff', 'Great atmosphere'];
    const staffMentions = reviewData?.staffMentions || [];

    // CTA URL - booking or email fallback
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;
    const ctaText = bookingUrl ? 'Book a Demo' : 'Schedule Your Demo';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - ${companyName} Opportunity Brief</title>
    <style>
        :root {
            --color-primary: ${customPrimaryColor};
            --color-primary-dark: ${customPrimaryColor}dd;
            --color-secondary: #6B4423;
            --color-accent: ${customAccentColor};
            --color-bg: #ffffff;
            --color-bg-light: #f8f9fa;
            --color-text: #333333;
            --color-text-light: #666666;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--color-bg);
            color: var(--color-text);
            line-height: 1.5;
            /* FIXED: Full viewport height for proper display */
            min-height: 100vh;
        }

        /* TOP BAR - with optional branding - FIXED: Better text/image visibility */
        .top-bar {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            color: white;
            padding: 14px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .top-bar .logo {
            font-weight: 700;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .top-bar .logo img {
            height: 32px;
            max-width: 120px;
            object-fit: contain;
            filter: brightness(1.1);
        }
        .top-bar .actions {
            display: flex;
            gap: 12px;
        }
        .top-bar .btn {
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
        }
        .top-bar .btn-outline {
            background: rgba(255,255,255,0.15);
            border: 2px solid rgba(255,255,255,0.7);
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .top-bar .btn-outline:hover {
            background: rgba(255,255,255,0.25);
            border-color: white;
        }
        .top-bar .btn-primary {
            background: var(--color-accent);
            border: 2px solid var(--color-accent);
            color: #1a1a1a;
            font-weight: 700;
        }
        .top-bar .btn-primary:hover {
            background: #e5b958;
            border-color: #e5b958;
        }

        /* FIXED: Container now properly sized for screen display */
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 32px;
            min-height: calc(100vh - 60px);
        }

        /* Header Section */
        .header {
            text-align: center;
            margin-bottom: 32px;
            padding-bottom: 24px;
            border-bottom: 3px solid var(--color-primary);
        }
        .header h1 {
            font-size: 32px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .header .subtitle {
            font-size: 18px;
            color: var(--color-text-light);
        }
        .header .meta {
            display: flex;
            justify-content: center;
            gap: 24px;
            margin-top: 16px;
        }
        .header .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            color: var(--color-text-light);
        }

        /* Stats Row */
        .stats-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        .stat-box {
            background: var(--color-bg-light);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid #e8e8e8;
        }
        .stat-box .value {
            font-size: 28px;
            font-weight: 700;
            color: var(--color-primary);
        }
        .stat-box .label {
            font-size: 12px;
            color: var(--color-text-light);
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Two Column Layout */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 32px;
        }

        /* Card Styles */
        .card {
            background: var(--color-bg-light);
            border-radius: 12px;
            padding: 24px;
            border: 1px solid #e8e8e8;
        }
        .card h3 {
            font-size: 16px;
            color: var(--color-primary);
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 2px solid var(--color-accent);
        }
        .card ul {
            list-style: none;
        }
        .card li {
            padding: 8px 0;
            font-size: 14px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        .card li:last-child { border: none; }
        .card li::before {
            content: "✓";
            color: var(--color-primary);
            font-weight: bold;
            flex-shrink: 0;
        }

        /* NEW SECTION: PathSynch Products */
        .products-section {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 32px;
            color: white;
        }
        .products-section h3 {
            font-size: 18px;
            margin-bottom: 16px;
            text-align: center;
        }
        .products-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }
        .product-item {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
        }
        .product-item .icon {
            font-size: 24px;
            margin-bottom: 6px;
        }
        .product-item .name {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 4px;
        }
        .product-item .desc {
            font-size: 11px;
            opacity: 0.85;
        }

        /* Solutions Grid */
        .solutions-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        .solution-item {
            background: var(--color-bg-light);
            border-radius: 10px;
            padding: 16px;
            border-left: 4px solid var(--color-primary);
        }
        .solution-item h4 {
            font-size: 14px;
            color: var(--color-primary);
            margin-bottom: 6px;
        }
        .solution-item p {
            font-size: 13px;
            color: var(--color-text-light);
        }

        /* CTA Section */
        .cta-section {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            border-radius: 12px;
            padding: 28px;
            text-align: center;
            color: white;
        }
        .cta-section h3 {
            font-size: 20px;
            margin-bottom: 8px;
        }
        .cta-section p {
            opacity: 0.9;
            margin-bottom: 16px;
            font-size: 14px;
        }
        .cta-section .cta-button {
            display: inline-block;
            background: var(--color-accent);
            color: #333;
            padding: 12px 32px;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            font-size: 14px;
        }
        .cta-section .contact {
            margin-top: 16px;
            font-size: 13px;
            opacity: 0.85;
        }

        /* Print Styles - FIXED: One-pager with colors */
        @media print {
            .top-bar { display: none; }
            html, body {
                background: white !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            .container {
                max-width: 100%;
                padding: 0.3in;
                min-height: auto;
            }
            /* Compact everything for one page */
            .header { margin-bottom: 16px; padding-bottom: 12px; }
            .header h1 { font-size: 24px; }
            .header .subtitle { font-size: 14px; }
            .stats-row { margin-bottom: 16px; gap: 8px; }
            .stat-box { padding: 12px; }
            .stat-box .value { font-size: 20px; }
            .stat-box .label { font-size: 10px; }
            .two-col { gap: 12px; margin-bottom: 16px; }
            .card { padding: 12px; }
            .card h3 { font-size: 13px; margin-bottom: 8px; }
            .card li { padding: 4px 0; font-size: 11px; }
            .products-section {
                padding: 12px;
                margin-bottom: 16px;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .products-section h3 { font-size: 14px; margin-bottom: 8px; }
            .product-item { padding: 8px; }
            .product-item .icon { font-size: 18px; }
            .product-item .name { font-size: 11px; }
            .product-item .desc { font-size: 9px; }
            .solutions-grid { gap: 8px; margin-bottom: 16px; }
            .solution-item { padding: 10px; }
            .solution-item h4 { font-size: 12px; }
            .solution-item p { font-size: 10px; }
            .cta-section {
                padding: 16px;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .cta-section h3 { font-size: 16px; }
            .cta-section p { font-size: 12px; margin-bottom: 8px; }
            .cta-section .cta-button { padding: 8px 20px; font-size: 12px; }
        }

        /* Responsive */
        @media (max-width: 768px) {
            .stats-row { grid-template-columns: repeat(2, 1fr); }
            .two-col { grid-template-columns: 1fr; }
            .products-grid { grid-template-columns: repeat(2, 1fr); }
            .solutions-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <!-- TOP BAR - with booking integration -->
    <div class="top-bar">
        <div class="logo">
            ${customLogo ? `<img src="${customLogo}" alt="${companyName}">` : `<span style="font-size:24px;">📍</span> <span>${companyName}</span>`}
        </div>
        <div class="actions">
            <a href="#" class="btn btn-outline" onclick="window.print(); return false;">Download PDF</a>
            <a href="${ctaUrl}" class="btn btn-primary" target="${bookingUrl ? '_blank' : '_self'}"
               data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
               data-pitch-level="2"
               data-segment="${industry}"
               onclick="window.trackCTA && trackCTA(this)">${ctaText}</a>
        </div>
    </div>

    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>${businessName}</h1>
            <p class="subtitle">${hideBranding ? 'Opportunity Brief' : companyName + ' Opportunity Brief'}</p>
            <div class="meta">
                <span class="meta-item">⭐ ${googleRating} Google Rating</span>
                <span class="meta-item">📝 ${numReviews} Reviews</span>
                <span class="meta-item">🏢 ${industry}</span>
            </div>
        </div>

        ${inputs.triggerEvent ? `
        <!-- Trigger Event - Personalized Opening -->
        <div class="card trigger-event-card" style="margin-bottom: 24px; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 1px solid #86efac; border-left: 4px solid ${customPrimaryColor};">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 24px;">📰</span>
                <div>
                    <p style="font-size: 14px; color: #166534; font-weight: 600; margin-bottom: 4px;">Why We're Reaching Out</p>
                    <p style="font-size: 15px; color: #333; line-height: 1.5; margin-bottom: 8px;">
                        ${inputs.triggerEvent.headline ? `<strong>Congratulations on "${inputs.triggerEvent.headline}"!</strong> ` : ''}${inputs.triggerEvent.summary || ''}
                    </p>
                    ${inputs.triggerEvent.keyPoints && inputs.triggerEvent.keyPoints.length > 0 ? `
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #bbf7d0;">
                        <p style="font-size: 12px; color: #15803d; font-weight: 600; margin-bottom: 4px;">This presents an opportunity to:</p>
                        <ul style="margin: 0; padding-left: 16px; font-size: 13px; color: #166534;">
                            ${inputs.triggerEvent.keyPoints.slice(0, 2).map(point => `<li>${point}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                    ${inputs.triggerEvent.source ? `<p style="font-size: 11px; color: #6b7280; margin-top: 8px;">Source: ${inputs.triggerEvent.source}</p>` : ''}
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Stats Row -->
        <div class="stats-row">
            <div class="stat-box">
                <div class="value">${googleRating}★</div>
                <div class="label">Google Rating</div>
            </div>
            <div class="stat-box">
                <div class="value">+${roiData.newCustomers}</div>
                <div class="label">New Customers/Mo</div>
            </div>
            <div class="stat-box">
                <div class="value">$${formatCurrency(roiData.monthlyIncrementalRevenue)}</div>
                <div class="label">Monthly Revenue</div>
            </div>
            <div class="stat-box">
                <div class="value">${roiData.roi}%</div>
                <div class="label">Projected ROI</div>
            </div>
        </div>

        <!-- Two Column: Opportunity + Customer Analysis -->
        <div class="two-col">
            <div class="card">
                <h3>📈 The Opportunity</h3>
                <ul>
                    <li>${googleRating >= 4.0 ? `Your ${googleRating}-star rating shows customers love you` : googleRating >= 3.0 ? `Your ${googleRating}-star rating has room for improvement - we can help` : `Your ${googleRating}-star rating presents a major growth opportunity`}</li>
                    <li>${sentiment.positive >= 60 ? `${sentiment.positive}% positive sentiment shows strong customer satisfaction` : `${sentiment.positive}% positive sentiment - opportunity to improve customer experience`}</li>
                    <li>Potential to add ${roiData.newCustomers}+ new customers/month</li>
                    <li>Estimated $${formatCurrency(roiData.monthlyIncrementalRevenue)}/month from new customers</li>
                </ul>
            </div>
            <div class="card">
                <h3>💬 ${googleRating >= 3.5 ? 'What Customers Love' : 'Customer Feedback Themes'}</h3>
                <ul>
                    ${topThemes.slice(0, 4).map(theme => `<li>${theme}</li>`).join('')}
                    ${staffMentions.length > 0 ? `<li>Staff highlights: ${staffMentions.slice(0, 2).join(', ')}</li>` : ''}
                </ul>
            </div>
        </div>

        <!-- Industry Pain Points -->
        <div class="card" style="margin-bottom: 24px; border-left: 4px solid ${customAccentColor};">
            <h3>🎯 Common ${industry} Challenges We Solve</h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px;">
                ${salesIntel.painPoints.slice(0, 4).map(pp => `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <span style="color: ${customAccentColor}; font-weight: bold;">✓</span>
                        <span style="font-size: 14px; color: #555;">${pp}</span>
                    </div>
                `).join('')}
            </div>
            <p style="margin-top: 16px; font-size: 13px; color: #888;">
                <strong>Key metrics we help improve:</strong> ${salesIntel.primaryKPIs.slice(0, 3).join(' • ')}
            </p>
        </div>

        <!-- Products Section -->
        <div class="products-section">
            <h3>🚀 ${options.sellerContext?.isDefault ? 'The PathSynch Platform' : `What ${companyName} Offers`}</h3>
            <div class="products-grid">
                ${(options.sellerContext?.products || []).slice(0, 6).map(p => `
                <div class="product-item">
                    <div class="icon">${p.icon || '📦'}</div>
                    <div class="name">${p.name}</div>
                    <div class="desc">${p.desc}</div>
                </div>
                `).join('')}
            </div>
        </div>

        <!-- Solutions for Their Problem -->
        <div class="solutions-grid">
            ${(() => {
                // Use seller's USPs and benefits, or fall back to products
                const usps = options.sellerContext?.uniqueSellingPoints || [];
                const benefits = options.sellerContext?.keyBenefits || [];
                const products = options.sellerContext?.products || [];

                // Combine USPs and benefits for solutions
                let solutions = [];

                if (usps.length > 0 || benefits.length > 0) {
                    // Use USPs first, then benefits
                    const combined = [...usps.slice(0, 2), ...benefits.slice(0, 2)].slice(0, 4);
                    const icons = ['🎯', '📍', '🔄', '📊'];
                    solutions = combined.map((item, i) => ({
                        icon: icons[i] || '✨',
                        title: truncateText(item.split(' ').slice(0, 4).join(' '), 25),
                        desc: truncateText(item, 80)
                    }));
                } else if (products.length > 0) {
                    // Fall back to products
                    solutions = products.slice(0, 4).map((p, i) => ({
                        icon: p.icon || ['🎯', '📍', '🔄', '📊'][i] || '📦',
                        title: truncateText(p.name, CONTENT_LIMITS.productName),
                        desc: truncateText(p.desc, CONTENT_LIMITS.productDesc)
                    }));
                } else {
                    // PathSynch defaults
                    solutions = [
                        { icon: '🎯', title: 'Review Capture', desc: 'NFC cards + QR codes make leaving reviews effortless' },
                        { icon: '📍', title: 'Local Visibility', desc: 'Optimize your Google Business Profile for discovery' },
                        { icon: '🔄', title: 'Customer Retention', desc: 'Loyalty programs that bring customers back' },
                        { icon: '📊', title: 'Analytics', desc: 'Track what works with unified dashboards' }
                    ];
                }

                return solutions.map(s => `
            <div class="solution-item">
                <h4>${s.icon} ${s.title}</h4>
                <p>${s.desc}</p>
            </div>`).join('');
            })()}
        </div>

        <!-- CTA with booking integration -->
        <div class="cta-section">
            <h3>Ready to Grow ${businessName}?</h3>
            <p>See how ${hideBranding ? 'we' : companyName} can help you ${statedProblem}</p>
            <a href="${ctaUrl}" class="cta-button" target="${bookingUrl ? '_blank' : '_self'}"
               data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
               data-pitch-level="2"
               data-segment="${industry}"
               onclick="window.trackCTA && trackCTA(this)">${ctaText}</a>
            ${bookingUrl ? `<div class="contact" style="margin-top:12px;font-size:12px;opacity:0.8;">Or email: ${contactEmail}</div>` : `<div class="contact">${contactEmail}</div>`}
        </div>
        ${customFooterText ? `
        <div style="margin-top: 24px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>
        ` : ''}
        ${!hideBranding ? `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">PathSynch</a>
        </div>
        ` : ''}
    </div>
    <script>
    window.trackCTA = function(el) {
        if (navigator.sendBeacon) {
            navigator.sendBeacon(
                'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',
                new Blob([JSON.stringify({
                    pitchId: '${pitchId || ''}',
                    event: 'cta_click',
                    data: {
                        ctaType: el.dataset.ctaType || null,
                        ctaUrl: el.href || null,
                        pitchLevel: parseInt(el.dataset.pitchLevel) || 2,
                        segment: el.dataset.segment || null
                    }
                })], { type: 'application/json' })
            );
        }
    };
    </script>
</body>
</html>`;
}

// Generate Level 3: Enterprise Deck (UPDATED with booking integration)
function generateLevel3(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || '';
    const statedProblem = inputs.statedProblem || 'increasing customer engagement';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Booking & branding options - use sellerContext first
    const bookingUrl = options.bookingUrl || inputs.bookingUrl || null;
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const customLogo = options.sellerContext?.logoUrl || options.logoUrl || inputs.logoUrl || null;
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || inputs.contactEmail || 'hello@pathsynch.com';
    const customFooterText = options.footerText || inputs.footerText || '';

    // CTA URL - booking or email fallback
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;
    const ctaText = bookingUrl ? 'Book a Demo' : 'Schedule Demo';

    // Review analysis data
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality products', 'Excellent service', 'Great atmosphere'];
    const staffMentions = reviewData?.staffMentions || [];
    const differentiators = reviewData?.differentiators || ['Unique offerings', 'Personal touch'];

    // Enhanced review analytics (from reviewAnalytics service)
    const hasReviewAnalytics = reviewData?.analytics && reviewData?.pitchMetrics;
    const reviewHealthScore = reviewData?.pitchMetrics?.headline?.score || null;
    const reviewHealthLabel = reviewData?.pitchMetrics?.headline?.label || null;
    const reviewKeyMetrics = reviewData?.pitchMetrics?.keyMetrics || [];
    const reviewCriticalIssues = reviewData?.pitchMetrics?.criticalIssues || [];
    const reviewOpportunities = reviewData?.pitchMetrics?.opportunities || [];
    const reviewStrengths = reviewData?.pitchMetrics?.strengths || [];
    const reviewRecommendation = reviewData?.pitchMetrics?.recommendation || null;
    const volumeData = reviewData?.analytics?.volume || null;
    const qualityData = reviewData?.analytics?.quality || null;
    const responseData = reviewData?.analytics?.response || null;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);

    // Market intelligence data
    const hasMarketData = marketData && marketData.opportunityScore !== undefined;
    const opportunityScore = marketData?.opportunityScore || null;
    const opportunityLevel = marketData?.opportunityLevel || null;
    const saturation = marketData?.saturation || null;
    const competitorCount = marketData?.competitorCount || null;
    const marketSize = marketData?.marketSize || null;
    const growthRate = marketData?.growthRate || null;
    const demographics = marketData?.demographics || null;
    const marketRecommendations = marketData?.recommendations || null;
    const seasonality = marketData?.seasonality || null;
    const companySizeInfo = marketData?.companySize || null;

    // Calculate donut chart segments
    const positiveAngle = (sentiment.positive / 100) * 360;
    const neutralAngle = (sentiment.neutral / 100) * 360;
    const negativeAngle = (sentiment.negative / 100) * 360;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - ${companyName} Enterprise Pitch</title>
    <style>
        :root {
            --color-primary: ${customPrimaryColor};
            --color-primary-dark: ${customPrimaryColor}dd;
            --color-secondary: #6B4423;
            --color-accent: ${customAccentColor};
            --color-positive: #22c55e;
            --color-neutral: #f59e0b;
            --color-negative: #ef4444;
            --slide-width: 960px;
            --slide-height: 540px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #333;
            line-height: 1.5;
        }
        .slide {
            width: var(--slide-width);
            min-height: var(--slide-height);
            margin: 40px auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: visible;
            position: relative;
            padding: 40px 48px;
        }
        .content-slide {
            padding: 36px 48px;
        }
        .slide-number {
            position: absolute;
            bottom: 16px;
            right: 24px;
            font-size: 12px;
            color: #999;
        }

        /* Title Slide */
        .title-slide {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
        }
        .title-slide h1 {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .title-slide .subtitle {
            font-size: 24px;
            opacity: 0.9;
            margin-bottom: 32px;
        }
        .title-slide .meta {
            display: flex;
            gap: 32px;
            font-size: 16px;
            opacity: 0.85;
        }
        .title-slide .logo {
            position: absolute;
            bottom: 32px;
            font-size: 20px;
            font-weight: 600;
        }

        /* Content Slide */
        .content-slide h2 {
            font-size: 32px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .content-slide .slide-intro {
            font-size: 16px;
            color: #666;
            margin-bottom: 32px;
        }

        /* SLIDE 2 FIX: Yellow line stretches across */
        .content-slide .yellow-line {
            width: 100%;
            height: 4px;
            background: var(--color-accent);
            margin: 8px 0 24px 0;
        }

        /* Two Column Layout */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
        }

        /* Three Column Layout */
        .three-col {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
        }

        /* Cards - FIXED: Compact to prevent cutoff */
        .card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 18px;
        }
        .card h3 {
            font-size: 15px;
            color: var(--color-primary);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .card ul {
            list-style: none;
        }
        .card li {
            padding: 5px 0;
            font-size: 13px;
            border-bottom: 1px solid #eee;
        }
        .card li:last-child { border: none; }

        /* Solution Cards */
        .solution-card {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 24px;
            color: white;
        }
        .solution-card .icon-badge {
            font-size: 32px;
            margin-bottom: 12px;
        }
        .solution-card h3 {
            font-size: 16px;
            margin-bottom: 12px;
            color: white;
        }
        .solution-card ul {
            list-style: none;
            font-size: 13px;
        }
        .solution-card li {
            padding: 4px 0;
            opacity: 0.9;
        }

        /* Donut Chart - FIXED: Smaller to prevent cutoff */
        .donut-container {
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .donut-chart {
            width: 160px;
            height: 160px;
            border-radius: 50%;
            background: conic-gradient(
                var(--color-positive) 0deg ${positiveAngle}deg,
                var(--color-neutral) ${positiveAngle}deg ${positiveAngle + neutralAngle}deg,
                var(--color-negative) ${positiveAngle + neutralAngle}deg 360deg
            );
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .donut-chart::after {
            content: '';
            width: 90px;
            height: 90px;
            background: white;
            border-radius: 50%;
            position: absolute;
        }
        .donut-center {
            position: absolute;
            z-index: 1;
            text-align: center;
        }
        .donut-center .percent {
            font-size: 28px;
            font-weight: 700;
            color: var(--color-positive);
        }
        .donut-center .label {
            font-size: 11px;
            color: #666;
        }
        .sentiment-legend {
            display: flex;
            gap: 16px;
            margin-top: 16px;
            font-size: 12px;
        }
        .sentiment-legend span {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .legend-positive { background: var(--color-positive); }
        .legend-neutral { background: var(--color-neutral); }
        .legend-negative { background: var(--color-negative); }

        /* Timeline */
        .timeline {
            display: flex;
            gap: 16px;
        }
        .timeline-item {
            flex: 1;
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            position: relative;
        }
        .timeline-item::before {
            content: '';
            position: absolute;
            top: 50%;
            right: -16px;
            width: 16px;
            height: 2px;
            background: var(--color-accent);
        }
        .timeline-item:last-child::before { display: none; }
        .phase-badge {
            display: inline-block;
            background: var(--color-primary);
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .timeline-item h4 {
            font-size: 14px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .timeline-item ul {
            list-style: none;
            font-size: 12px;
        }
        .timeline-item li {
            padding: 3px 0;
            color: #555;
        }

        /* SLIDE 8 FIX: Brand color pricing box */
        .pricing-section {
            display: grid;
            grid-template-columns: 1fr 1.5fr;
            gap: 24px;
            height: calc(100% - 80px);
        }
        .pricing-summary {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 28px;
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .pricing-summary h3 {
            font-size: 16px;
            opacity: 0.9;
            margin-bottom: 8px;
        }
        .pricing-summary .price {
            font-size: 48px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .pricing-summary .period {
            font-size: 14px;
            opacity: 0.8;
            margin-bottom: 24px;
        }
        .pricing-summary .includes {
            font-size: 13px;
            opacity: 0.9;
        }
        .pricing-summary .includes li {
            padding: 4px 0;
            list-style: none;
        }
        .pricing-products {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 24px;
        }
        .pricing-products h3 {
            font-size: 16px;
            color: var(--color-primary);
            margin-bottom: 16px;
        }
        .product-list {
            list-style: none;
        }
        .product-list li {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e8e8e8;
            font-size: 14px;
        }
        .product-list li:last-child { border: none; }
        .product-list .name { font-weight: 500; }
        .product-list .price { color: var(--color-primary); font-weight: 600; }

        /* SLIDE 9 FIX: Previous version layout */
        .next-steps-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
            height: calc(100% - 100px);
        }
        .next-steps-column h3 {
            font-size: 18px;
            color: var(--color-primary);
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 3px solid var(--color-accent);
        }
        .step-box {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 12px;
            border-left: 4px solid var(--color-primary);
        }
        .step-box h4 {
            font-size: 14px;
            color: #333;
            margin-bottom: 6px;
        }
        .step-box p {
            font-size: 13px;
            color: #666;
        }
        .next-steps-goal {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
            border-radius: 12px;
            padding: 20px;
            margin-top: 16px;
            text-align: center;
        }
        .next-steps-goal p {
            font-size: 14px;
        }

        /* Closing Slide */
        .closing-slide {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
        }
        .closing-slide h2 {
            font-size: 36px;
            margin-bottom: 16px;
            color: white;
        }
        .closing-slide p {
            font-size: 18px;
            opacity: 0.9;
            max-width: 600px;
            margin-bottom: 32px;
        }
        .closing-slide .contact {
            font-size: 16px;
            opacity: 0.85;
        }

        /* ROI Highlight */
        .roi-highlight {
            background: var(--color-primary);
            color: white;
            border-radius: 12px;
            padding: 24px;
            text-align: center;
        }
        .roi-highlight .value {
            font-size: 36px;
            font-weight: 700;
        }
        .roi-highlight .label {
            font-size: 13px;
            opacity: 0.9;
            margin-top: 4px;
        }

        /* Print Styles - FIXED: Preserve colors, hide analytics */
        @media print {
            body { background: white !important; }
            html, body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            .slide {
                margin: 0;
                box-shadow: none;
                page-break-after: always;
                border-radius: 0;
            }
            .slide:last-child { page-break-after: avoid; }
            /* Preserve gradient backgrounds */
            .title-slide,
            .closing-slide,
            .solution-card,
            .pricing-summary {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%) !important;
            }
            .solution-card {
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%) !important;
            }
            /* Hide analytics panel in print */
            #analyticsPanel { display: none !important; }
        }
    </style>
</head>
<body>

<!-- SLIDE 1: TITLE -->
<section class="slide title-slide">
    <h1>${businessName}</h1>
    <p class="subtitle">${inputs.triggerEvent ? 'Timely Opportunity Brief' : 'Customer Engagement & Growth Strategy'}</p>
    <div class="meta">
        <span>⭐ ${googleRating} Google Rating</span>
        <span>📝 ${numReviews} Reviews</span>
        <span>🏢 ${industry}</span>
    </div>
    <div class="logo">${options.sellerContext?.logoUrl ? `<img src="${options.sellerContext.logoUrl}" alt="${companyName}" style="height: 24px;">` : ''} ${companyName}</div>
    <div class="slide-number">1 / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${inputs.triggerEvent ? `
<!-- TRIGGER EVENT SLIDE: WHY NOW -->
<section class="slide content-slide" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);">
    <h2 style="color: var(--color-primary);">📰 Why We're Reaching Out Now</h2>
    <div class="yellow-line"></div>

    <div class="card" style="background: white; padding: 32px; margin-top: 24px; border-left: 4px solid var(--color-primary);">
        <h3 style="font-size: 24px; margin-bottom: 16px; color: #166534;">${inputs.triggerEvent.headline || 'Recent News'}</h3>
        <p style="font-size: 18px; color: #333; line-height: 1.6; margin-bottom: 20px;">
            ${inputs.triggerEvent.summary || ''}
        </p>
        ${inputs.triggerEvent.keyPoints && inputs.triggerEvent.keyPoints.length > 0 ? `
        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin-top: 16px;">
            <p style="font-weight: 600; color: #15803d; margin-bottom: 12px;">This creates an opportunity to:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${inputs.triggerEvent.keyPoints.map(point => `
                    <li style="font-size: 16px; color: #166534; margin-bottom: 8px;">${point}</li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
    </div>

    ${inputs.triggerEvent.source ? `
    <p style="position: absolute; bottom: 60px; font-size: 12px; color: #6b7280;">Source: ${inputs.triggerEvent.source}</p>
    ` : ''}
    <div class="slide-number">2 / ${hasReviewAnalytics ? (hasMarketData ? '13' : '12') : (hasMarketData ? '12' : '11')}</div>
</section>
` : ''}

<!-- SLIDE 2: WHAT MAKES THEM SPECIAL - FIXED yellow line -->
<section class="slide content-slide">
    <h2>What Makes ${businessName} Special</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Customer sentiment analysis from ${numReviews} Google reviews</p>

    <div class="two-col">
        <div class="donut-container">
            <div class="donut-chart">
                <div class="donut-center">
                    <div class="percent">${sentiment.positive}%</div>
                    <div class="label">Positive</div>
                </div>
            </div>
            <div class="sentiment-legend">
                <span><div class="legend-dot legend-positive"></div> Positive ${sentiment.positive}%</span>
                <span><div class="legend-dot legend-neutral"></div> Neutral ${sentiment.neutral}%</span>
                <span><div class="legend-dot legend-negative"></div> Negative ${sentiment.negative}%</span>
            </div>
        </div>

        <div>
            <div class="card" style="margin-bottom: 16px;">
                <h3>💬 What Customers Say</h3>
                <ul>
                    ${topThemes.slice(0, 4).map(theme => `<li>✓ ${theme}</li>`).join('')}
                </ul>
            </div>
            ${staffMentions.length > 0 ? `
            <div class="card">
                <h3>⭐ Staff Highlights</h3>
                <ul>
                    ${staffMentions.slice(0, 3).map(staff => `<li>${staff}</li>`).join('')}
                </ul>
            </div>
            ` : `
            <div class="card">
                <h3>🏆 Key Differentiators</h3>
                <ul>
                    ${differentiators.slice(0, 3).map(d => `<li>✓ ${d}</li>`).join('')}
                </ul>
            </div>
            `}
        </div>
    </div>
    <div class="slide-number">2 / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${hasReviewAnalytics ? `
<!-- SLIDE 2.5: REVIEW HEALTH (conditional) -->
<section class="slide content-slide">
    <h2>Review Health Analysis</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Data-driven insights from ${volumeData?.totalReviews || numReviews} customer reviews</p>

    <div class="two-col">
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px; background: linear-gradient(135deg, ${reviewHealthScore >= 70 ? '#22c55e' : reviewHealthScore >= 50 ? '#f59e0b' : '#ef4444'} 0%, ${reviewHealthScore >= 70 ? '#16a34a' : reviewHealthScore >= 50 ? '#d97706' : '#dc2626'} 100%);">
                <div class="value">${reviewHealthScore || '-'}</div>
                <div class="label">Review Health Score</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${reviewHealthLabel || 'N/A'}</div>
            </div>
            <div class="card">
                <h3>📊 Key Metrics</h3>
                <ul style="list-style: none;">
                    ${reviewKeyMetrics.map(m => `
                    <li style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                        <span style="color: #666;">${m.label}</span>
                        <span style="font-weight: 600; color: var(--color-primary);">${m.value}${m.trend ? (m.trendValue > 0 ? ' ↑' : m.trendValue < 0 ? ' ↓' : '') : ''}</span>
                    </li>
                    `).join('')}
                </ul>
            </div>
        </div>
        <div>
            ${reviewCriticalIssues.length > 0 ? `
            <div class="card" style="margin-bottom: 12px; border-left: 4px solid #ef4444; background: #fef2f2;">
                <h3 style="color: #ef4444;">🚨 Critical Issues</h3>
                <ul style="list-style: none;">
                    ${reviewCriticalIssues.map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #991b1b;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}
            ${reviewOpportunities.length > 0 ? `
            <div class="card" style="margin-bottom: 12px; border-left: 4px solid #f59e0b; background: #fffbeb;">
                <h3 style="color: #d97706;">⚠️ Improvement Areas</h3>
                <ul style="list-style: none;">
                    ${reviewOpportunities.slice(0, 2).map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #92400e;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}
            ${reviewStrengths.length > 0 ? `
            <div class="card" style="border-left: 4px solid #22c55e; background: #f0fdf4;">
                <h3 style="color: #16a34a;">✅ Strengths</h3>
                <ul style="list-style: none;">
                    ${reviewStrengths.slice(0, 2).map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #166534;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : `
            <div class="card" style="border-left: 4px solid var(--color-primary);">
                <h3>📈 Review Velocity</h3>
                <ul style="list-style: none;">
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Last 7 days:</strong> ${volumeData?.last7Days || 0} reviews</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Last 30 days:</strong> ${volumeData?.last30Days || 0} reviews</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Monthly average:</strong> ${volumeData?.reviewsPerMonth || 'N/A'}/month</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Trend:</strong> ${volumeData?.velocityTrend === 'accelerating' ? '📈 Accelerating' : volumeData?.velocityTrend === 'slowing' ? '📉 Slowing' : '➡️ Stable'}</li>
                </ul>
            </div>
            `}
        </div>
    </div>

    ${reviewRecommendation ? `
    <div style="margin-top: 16px; padding: 16px 20px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); border-radius: 12px; color: white;">
        <p style="font-size: 14px; margin: 0;"><strong>💡 ${companyName} Recommendation:</strong> ${reviewRecommendation}</p>
    </div>
    ` : ''}
    <div class="slide-number">3 / ${hasMarketData ? '12' : '11'}</div>
</section>
` : ''}

<!-- SLIDE 3: GROWTH CHALLENGES -->
<section class="slide content-slide">
    <h2>Growth Challenges</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Common barriers facing ${industry} businesses today</p>

    <div class="three-col" style="margin-top: 32px;">
        <div class="card">
            <h3>🔍 Discovery</h3>
            <ul>
                <li>Limited online visibility</li>
                <li>Competitors outranking in search</li>
                <li>Inconsistent review velocity</li>
                <li>Incomplete Google profile</li>
            </ul>
        </div>
        <div class="card">
            <h3>🎯 Industry Pain Points</h3>
            <ul>
                ${salesIntel.painPoints.slice(0, 4).map(point => `<li>${point}</li>`).join('')}
            </ul>
        </div>
        <div class="card">
            <h3>📊 Key KPIs to Track</h3>
            <ul>
                ${salesIntel.primaryKPIs.slice(0, 4).map(kpi => `<li>${kpi}</li>`).join('')}
            </ul>
        </div>
    </div>

    <div style="margin-top: 32px; padding: 20px; background: #fff3cd; border-radius: 12px; border-left: 4px solid var(--color-accent);">
        <p style="font-size: 15px; color: #856404;"><strong>The Core Issue:</strong> ${statedProblem || `Great businesses often struggle with visibility—not quality. ${companyName} bridges that gap.`}</p>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '4' : '3'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 4: SOLUTION -->
<section class="slide content-slide">
    <h2>${companyName}: The Solution${options.sellerContext?.isDefault ? ' Ecosystem' : ''}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${truncateText(options.sellerContext?.differentiator, CONTENT_LIMITS.differentiator) || (options.sellerContext?.isDefault ? 'Integrated platform to deepen local customer engagement and drive repeat revenue' : `How ${companyName} helps businesses like yours succeed`)}</p>

    <div class="three-col">
        <div class="solution-card">
            <div class="icon-badge">🎯</div>
            <h3>${options.sellerContext?.isDefault ? 'What It Does' : 'Unique Value'}</h3>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>Captures reviews & feedback in real time</li>
                <li>Builds Google Business Profile authority</li>
                <li>Creates loyalty programs with rewards</li>
                <li>Generates QR/NFC campaigns with attribution</li>
                <li>Unified analytics dashboard</li>
                ` : (options.sellerContext?.uniqueSellingPoints || []).slice(0, 5).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || `
                <li>Tailored solutions for your needs</li>
                <li>Expert implementation support</li>
                <li>Proven results</li>
                `}
            </ul>
        </div>
        <div class="solution-card">
            <div class="icon-badge">🏆</div>
            <h3>${options.sellerContext?.isDefault ? 'Key Modules' : 'What You Get'}</h3>
            <ul>
                ${(options.sellerContext?.products || []).slice(0, 4).map(p => `<li><strong>${truncateText(p.name, CONTENT_LIMITS.productName)}:</strong> ${truncateText(p.desc, CONTENT_LIMITS.productDesc)}</li>`).join('')}
            </ul>
        </div>
        <div class="solution-card">
            <div class="icon-badge">💰</div>
            <h3>${options.sellerContext?.isDefault ? 'Proven Impact' : 'Key Benefits'}</h3>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>+44% conversion per +1 star rating</li>
                <li>+2.8% conversion per 10 reviews</li>
                <li>Complete GBP: ~7x more visibility</li>
                <li>Loyalty programs: +20% AOV typically</li>
                <li>NFC review capture: 3x response rate</li>
                ` : (options.sellerContext?.keyBenefits || []).slice(0, 5).map(b => `<li>${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || `
                <li>Increased efficiency</li>
                <li>Better customer outcomes</li>
                <li>Measurable ROI</li>
                `}
            </ul>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '5' : '4'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 5: PROJECTED ROI -->
<section class="slide content-slide">
    <h2>${businessName}: Projected ROI</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Conservative 6-month scenario with ${companyName} integration</p>

    <div class="two-col">
        <div class="card">
            <h3>📊 Conservative Assumptions</h3>
            <p style="margin-bottom: 16px;"><strong>Current baseline:</strong></p>
            <ul>
                <li>~${roiData.monthlyVisits} monthly customers</li>
                <li>~$${roiData.avgTicket} average transaction</li>
                <li>${numReviews} existing Google reviews</li>
            </ul>
            <p style="margin: 20px 0 16px;"><strong>With ${companyName}:</strong></p>
            <ul>
                <li>+${roiData.newCustomers} new customers/month (+${roiData.growthRate}%)</li>
                <li>${roiData.repeatRate}% of new customers return</li>
            </ul>
            <p style="font-size: 11px; color: #888; margin-top: 12px; font-style: italic;">*Only counts revenue from new customers. Does not assume changes in existing customer behavior.</p>
        </div>
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px;">
                <div class="value">+$${formatCurrency(roiData.monthlyIncrementalRevenue)}</div>
                <div class="label">Monthly Revenue from New Customers</div>
            </div>
            <div class="card">
                <p><strong>6-Month Revenue:</strong> ~$${formatCurrency(roiData.sixMonthRevenue)}</p>
                <p><strong>${companyName} Cost (6mo):</strong> ~$${formatCurrency(roiData.sixMonthCost)}</p>
                <p><strong>Net Profit:</strong> ~$${formatCurrency(roiData.sixMonthRevenue - roiData.sixMonthCost)}</p>
                <p style="color: var(--color-primary); font-weight: 600; margin-top: 12px; font-size: 18px;">ROI: ${roiData.roi}% in first 6 months</p>
            </div>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '6' : '5'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${hasMarketData ? `
<!-- SLIDE 5.5: MARKET INTELLIGENCE (conditional) -->
<section class="slide content-slide">
    <h2>Market Intelligence: ${inputs.address || 'Local Market'}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Data-driven insights for strategic positioning</p>

    <div class="two-col">
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div class="value">${opportunityScore || '-'}</div>
                <div class="label">Opportunity Score</div>
            </div>
            <div class="card">
                <h3>📊 Market Snapshot</h3>
                <ul>
                    <li><strong>Competition:</strong> ${saturation ? saturation.charAt(0).toUpperCase() + saturation.slice(1) : 'Medium'} (${competitorCount || 'Unknown'} competitors)</li>
                    <li><strong>Market Size:</strong> $${marketSize ? (marketSize >= 1000000 ? (marketSize/1000000).toFixed(1) + 'M' : (marketSize/1000).toFixed(0) + 'K') : 'Unknown'}</li>
                    <li><strong>Growth Rate:</strong> ${growthRate ? growthRate + '%' : 'Stable'} annually</li>
                    ${demographics?.medianIncome ? `<li><strong>Median Income:</strong> $${(demographics.medianIncome/1000).toFixed(0)}K</li>` : ''}
                </ul>
            </div>
        </div>
        <div>
            <div class="card" style="margin-bottom: 16px; border-left: 4px solid #667eea;">
                <h3>🎯 Market Position</h3>
                <p style="font-size: 14px; color: #333; margin-bottom: 12px;">
                    ${opportunityLevel === 'high' ? 'High opportunity market with room for growth' :
                      opportunityLevel === 'medium' ? 'Moderate opportunity with competitive dynamics' :
                      'Challenging market requiring differentiation'}
                </p>
                ${marketRecommendations?.targetCustomer ? `
                <p style="font-size: 13px; color: #666;">
                    <strong>Target:</strong> ${marketRecommendations.targetCustomer}
                </p>
                ` : ''}
            </div>
            ${seasonality ? `
            <div class="card" style="border-left: 4px solid #f59e0b;">
                <h3>📅 Seasonality</h3>
                <p style="font-size: 13px; color: #666;">
                    ${seasonality.isInPeakSeason ? '🔥 Currently in peak season - maximize marketing now' :
                      `Pattern: ${seasonality.pattern || 'Stable'}`}
                </p>
                ${companySizeInfo?.planningHorizon ? `
                <p style="font-size: 12px; color: #888; margin-top: 8px;">
                    Planning horizon: ${companySizeInfo.planningHorizon}
                </p>
                ` : ''}
            </div>
            ` : ''}
        </div>
    </div>

    ${salesIntel?.prospecting || salesIntel?.calendar ? `
    <div class="two-col" style="margin-top: 16px;">
        ${salesIntel.prospecting ? `
        <div class="card" style="border-left: 4px solid #10b981;">
            <h3>🕐 Best Time to Prospect</h3>
            <p style="font-size: 14px; color: #333; font-weight: 600; margin-bottom: 8px;">
                ${salesIntel.prospecting.bestMonthsLabel || 'Contact for timing'}
            </p>
            <p style="font-size: 13px; color: #666; margin-bottom: 8px;">
                ${salesIntel.prospecting.reasoning || ''}
            </p>
            <p style="font-size: 12px; color: #888; margin-bottom: 4px;">
                <strong>Buyer mindset:</strong> ${salesIntel.prospecting.buyerMindset || ''}
            </p>
            <p style="font-size: 12px; color: var(--color-primary); font-weight: 500;">
                💡 ${salesIntel.prospecting.approachTip || ''}
            </p>
        </div>
        ` : ''}
        ${salesIntel.calendar ? `
        <div class="card" style="border-left: 4px solid #8b5cf6;">
            <h3>📆 Industry Calendar</h3>
            <ul style="font-size: 13px; color: #666;">
                <li><strong>Buying Cycle:</strong> ${salesIntel.calendar.buyingCycle || 'Annual'}</li>
                <li><strong>Decision Timeline:</strong> ${salesIntel.calendar.decisionTimeline || 'Varies'}</li>
                ${salesIntel.calendar.contractRenewal ? `<li><strong>Contract Renewal:</strong> ${salesIntel.calendar.contractRenewal}</li>` : ''}
            </ul>
            ${salesIntel.calendar.keyEvents && salesIntel.calendar.keyEvents.length > 0 ? `
            <p style="font-size: 12px; color: #888; margin-top: 8px; margin-bottom: 4px;"><strong>Key Events:</strong></p>
            <ul style="font-size: 12px; color: #888; margin-top: 0;">
                ${salesIntel.calendar.keyEvents.slice(0, 3).map(e => `<li>${e.name} (${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][e.month - 1] || ''})</li>`).join('')}
            </ul>
            ` : ''}
        </div>
        ` : ''}
    </div>
    ` : ''}

    <div class="slide-number">${hasReviewAnalytics ? '7' : '6'} / ${hasReviewAnalytics ? '12' : '11'}</div>
</section>
` : ''}

<!-- SLIDE 6: PRODUCT STRATEGY -->
<section class="slide content-slide">
    <h2>${options.sellerContext?.isDefault ? 'Product Strategy: Integrated Approach' : `${companyName} Implementation Strategy`}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${options.sellerContext?.isDefault ? 'Three-pillar system to drive discovery, engagement, and retention' : `How ${companyName} delivers results for ${industry} businesses`}</p>

    <div class="three-col">
        ${options.sellerContext?.isDefault ? `
        <div class="card" style="border-top: 4px solid var(--color-primary);">
            <h3>⭐ Pillar 1: Discovery</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>PathConnect + LocalSynch</strong></p>
            <ul>
                <li>NFC cards for instant reviews</li>
                <li>Google Business optimization</li>
                <li>Review velocity tracking</li>
                <li>Reputation monitoring</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-accent);">
            <h3>🔗 Pillar 2: Engagement</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>QRSynch + Forms + SynchMate</strong></p>
            <ul>
                <li>QR campaign attribution</li>
                <li>Customer feedback surveys</li>
                <li>AI-powered chat support</li>
                <li>Short-link tracking</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-secondary);">
            <h3>🔄 Pillar 3: Retention</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>PathManager + Analytics</strong></p>
            <ul>
                <li>Unified dashboard</li>
                <li>Customer insights</li>
                <li>Performance tracking</li>
                <li>ROI measurement</li>
            </ul>
        </div>
        ` : `
        <div class="card" style="border-top: 4px solid var(--color-primary);">
            <h3>⭐ ${truncateText((options.sellerContext?.products || [])[0]?.name, CONTENT_LIMITS.productName) || 'Core Solution'}</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText((options.sellerContext?.products || [])[0]?.desc, CONTENT_LIMITS.productDesc) || 'Primary offering'}</strong></p>
            <ul>
                ${(options.sellerContext?.uniqueSellingPoints || []).slice(0, 2).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || '<li>Expert implementation</li>'}
                <li>Dedicated onboarding</li>
                ${(options.sellerContext?.products || [])[0]?.pricing ? `<li>${(options.sellerContext?.products || [])[0]?.pricing}</li>` : ''}
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-accent);">
            <h3>🔗 ${truncateText((options.sellerContext?.products || [])[1]?.name, CONTENT_LIMITS.productName) || 'Growth Tools'}</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText((options.sellerContext?.products || [])[1]?.desc, CONTENT_LIMITS.productDesc) || 'Expansion capabilities'}</strong></p>
            <ul>
                ${(options.sellerContext?.uniqueSellingPoints || []).slice(2, 4).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || '<li>Feature expansion</li>'}
                <li>Process optimization</li>
                <li>Performance tracking</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-secondary);">
            <h3>🔄 Results & ROI</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText(options.sellerContext?.differentiator, 50) || 'Measurable outcomes'}</strong></p>
            <ul>
                ${(options.sellerContext?.keyBenefits || []).slice(0, 3).map(b => `<li>${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || '<li>Measurable improvements</li><li>ROI tracking</li>'}
                <li>Ongoing optimization</li>
            </ul>
        </div>
        `}
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '8' : '7') : (hasMarketData ? '7' : '6')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 7: 90-DAY ROLLOUT - FIXED: Added "Recommended" -->
<section class="slide content-slide">
    <h2>Recommended 90-Day Rollout</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Phased implementation for maximum impact with minimal disruption</p>

    <div class="timeline" style="margin-top: 32px;">
        <div class="timeline-item">
            <div class="phase-badge">Phase 1: Days 1-30</div>
            <h4>Foundation</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>PathConnect setup & NFC cards</li>
                <li>Google Business Profile audit</li>
                ` : `
                <li>${truncateText((options.sellerContext?.products || [])[0]?.name, CONTENT_LIMITS.productName) || 'Primary solution'} setup</li>
                <li>${truncateText((options.sellerContext?.products || [])[0]?.desc, 50) || 'Initial implementation'}</li>
                `}
                <li>Staff training ${options.sellerContext?.isDefault ? 'on review requests' : '& onboarding'}</li>
                <li>Baseline metrics established</li>
            </ul>
        </div>
        <div class="timeline-item">
            <div class="phase-badge">Phase 2: Days 31-60</div>
            <h4>Expansion</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>QRSynch campaigns launched</li>
                <li>Forms for customer feedback</li>
                <li>LocalSynch optimization</li>
                ` : `
                ${(options.sellerContext?.products || []).slice(1, 3).map(p => `<li>${truncateText(p.name, 20)}: ${truncateText(p.desc, 40)}</li>`).join('') || '<li>Additional features enabled</li>'}
                <li>Process optimization & refinement</li>
                `}
                <li>First performance review</li>
            </ul>
        </div>
        <div class="timeline-item">
            <div class="phase-badge">Phase 3: Days 61-90</div>
            <h4>Optimization</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>Full PathManager analytics</li>
                <li>SynchMate chatbot (optional)</li>
                ` : `
                <li>Full ${companyName} solution deployment</li>
                ${(options.sellerContext?.products || []).length > 3 ? (options.sellerContext?.products || []).slice(3, 5).map(p => `<li>${truncateText(p.name, 25)} activated</li>`).join('') : '<li>Advanced features & integrations</li>'}
                `}
                <li>Campaign refinement</li>
                <li>ROI assessment & planning</li>
            </ul>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '9' : '8') : (hasMarketData ? '8' : '7')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 8: INVESTMENT - FIXED: Renamed, brand colors, yellow line -->
<section class="slide content-slide">
    <h2>${companyName} Package for ${businessName}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro"><strong>Recommended ${options.sellerContext?.isDefault ? 'Curated bundle' : 'solution'}</strong> to ${statedProblem || 'drive customer engagement and growth'}</p>

    <div class="pricing-section">
        <div class="pricing-summary" style="text-align: center;">
            <h3 style="text-align: center;">Your Investment</h3>
            <div class="price">${options.sellerContext?.pricing || '$168'}</div>
            <div class="period">${options.sellerContext?.pricingPeriod || 'per month'}</div>
            <ul class="includes" style="text-align: left; display: inline-block;">
                ${options.sellerContext?.isDefault ? `
                <li>✓ All core modules included</li>
                <li>✓ Dedicated onboarding</li>
                <li>✓ Priority support</li>
                <li>✓ Monthly strategy calls</li>
                <li>✓ No long-term contract</li>
                ` : (options.sellerContext?.keyBenefits || []).slice(0, 5).map(b => `<li>✓ ${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || `
                <li>✓ Full solution access</li>
                <li>✓ Implementation support</li>
                <li>✓ Ongoing assistance</li>
                `}
            </ul>
        </div>
        <div class="pricing-products">
            <h3>${options.sellerContext?.isDefault ? 'Recommended Products' : 'What You Get'}</h3>
            <ul class="product-list">
                ${(options.sellerContext?.products || []).slice(0, 6).map(p => `
                <li><span class="name">${p.icon || '📦'} ${truncateText(p.name, CONTENT_LIMITS.productName)}</span><span class="price">${p.price || 'Included'}</span></li>
                `).join('')}
            </ul>
            <div style="margin-top: 16px; padding: 12px; background: #e8f5e9; border-radius: 8px; text-align: center;">
                <span style="font-size: 13px; color: var(--color-primary);"><strong>${options.sellerContext?.isDefault ? 'Complete Platform Bundle' : 'Complete Package'}</strong> - ${options.sellerContext?.isDefault ? 'All tools included' : 'Everything you need'}</span>
            </div>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '10' : '9') : (hasMarketData ? '9' : '8')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 9: NEXT STEPS - FIXED: Previous version layout, yellow line -->
<section class="slide content-slide">
    <h2>Recommended Next Steps</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Clear, actionable roadmap to move from discussion to implementation</p>

    <div class="next-steps-grid">
        <div class="next-steps-column">
            <h3>Immediate (This Week)</h3>
            <div class="step-box">
                <h4>1. Schedule ${companyName} demo</h4>
                <p>${options.sellerContext?.isDefault ? 'See PathConnect, LocalSynch, QRSynch in action' : `See ${(options.sellerContext?.products || []).slice(0, 2).map(p => truncateText(p.name, 20)).join(', ')} in action`}</p>
            </div>
            <div class="step-box">
                <h4>2. Review pricing options</h4>
                <p>Explore custom ${options.sellerContext?.isDefault ? 'bundle' : 'solution'} for ${industry}</p>
            </div>
            <div class="step-box">
                <h4>3. Connect with decision maker</h4>
                <p>Typical: ${options.sellerContext?.decisionMakers?.[0] || salesIntel.decisionMakers[0] || 'Owner'} or ${options.sellerContext?.decisionMakers?.[1] || salesIntel.decisionMakers[1] || 'Manager'}</p>
            </div>
        </div>

        <div class="next-steps-column">
            <h3>Short-Term (Next 2-4 Weeks)</h3>
            <div class="step-box">
                <h4>4. Pilot period</h4>
                <p>${options.sellerContext?.isDefault ? 'Start with PathConnect only (30 days)' : 'Start with initial implementation (30 days)'}</p>
            </div>
            <div class="step-box">
                <h4>5. Staff training</h4>
                <p>${options.sellerContext?.isDefault ? 'NFC card placement, review request script' : 'Onboarding and best practices'}</p>
            </div>
            <div class="step-box">
                <h4>6. Top channels to leverage</h4>
                <p>${salesIntel.topChannels.slice(0, 2).join(', ')}</p>
            </div>
        </div>
    </div>

    <div class="next-steps-goal">
        <p><strong>Goal:</strong> By Day 30, you'll have data showing review velocity, foot traffic patterns, and early engagement interest. Then expand to full stack.</p>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '11' : '10') : (hasMarketData ? '10' : '9')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 10: CLOSING CTA -->
<section class="slide closing-slide">
    <h2>Let's Unlock ${businessName}'s Potential</h2>
    <p>Your product is great. Your customers love you. Now let's make sure everyone knows.</p>

    <a href="${ctaUrl}" class="cta-button" style="display: inline-block; margin-top: 24px; padding: 16px 48px; background: var(--color-accent); color: #1a1a1a; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: 600;"
       data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
       data-pitch-level="3"
       data-segment="${industry}"
       onclick="window.trackCTA && trackCTA(this)">
        ${ctaText}
    </a>

    ${hideBranding ? '' : `<p style="font-size: 18px; margin-top: 32px;">
        <strong>${companyName}</strong><br>
        <span style="font-size: 14px; opacity: 0.9;">${contactEmail}</span>
    </p>`}
    ${customFooterText ? `<p style="font-size: 14px; margin-top: 24px; opacity: 0.8;">${customFooterText}</p>` : ''}
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<script>
window.trackCTA = function(el) {
    if (navigator.sendBeacon) {
        navigator.sendBeacon(
            'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',
            new Blob([JSON.stringify({
                pitchId: '${pitchId || ''}',
                event: 'cta_click',
                data: {
                    ctaType: el.dataset.ctaType || null,
                    ctaUrl: el.href || null,
                    pitchLevel: parseInt(el.dataset.pitchLevel) || 3,
                    segment: el.dataset.segment || null
                }
            })], { type: 'application/json' })
        );
    }
};
</script>
</body>
</html>`;
}

// ============================================
// API HANDLERS (for index.js)
// ============================================

/**
 * Generate a new pitch - handles POST /generate-pitch
 */
async function generatePitch(req, res) {
    try {
        const db = getDb();
        const body = req.body;
        const userId = req.userId || 'anonymous';

        // Check pitch limit before generating
        if (userId !== 'anonymous') {
            const limitCheck = await checkPitchLimit(userId);
            if (!limitCheck.allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'PITCH_LIMIT_REACHED',
                    message: `You've reached your monthly limit of ${limitCheck.limit} pitches. Upgrade your plan for more.`,
                    used: limitCheck.used,
                    limit: limitCheck.limit,
                    tier: limitCheck.tier
                });
            }
        }

        // Extract trigger event data (news article, social post, etc.)
        const triggerEvent = body.triggerEvent || null;

        // Map request body to inputs format
        let inputs = {
            businessName: body.businessName,
            contactName: body.contactName || 'Business Owner',
            address: body.address,
            websiteUrl: body.websiteUrl,
            googleRating: body.googleRating,
            numReviews: body.numReviews,
            industry: body.industry,
            subIndustry: body.subIndustry,
            statedProblem: body.statedProblem || 'increasing customer engagement and visibility',
            monthlyVisits: body.monthlyVisits,
            avgTransaction: body.avgTransaction,
            avgTicket: body.avgTransaction || body.avgTicket,
            repeatRate: body.repeatRate || 0.4,
            // Trigger event for personalized opening
            triggerEvent: triggerEvent
        };

        // Market intelligence data (from market report integration)
        const marketData = body.marketData || null;

        // Get NAICS code for industry-specific defaults and growth rates
        let naicsCode = null;
        if (marketData && marketData.industry && marketData.industry.naicsCode) {
            // Use NAICS code from market intel
            naicsCode = marketData.industry.naicsCode;
        } else if (body.subIndustry || body.industry) {
            // Look up NAICS code from industry/subIndustry
            const naicsCodes = naics.getNaicsByDisplay(body.subIndustry || body.industry);
            naicsCode = naicsCodes[0] || null;
        }

        // Get industry defaults for ROI calculation
        const industryDefaults = naicsCode ? naics.getIndustryDefaults(naicsCode) : null;

        // Override defaults with market intel data if available
        if (marketData && marketData.industry) {
            // Use dynamic avgTransaction from market intel (e.g., $450 for auto repair)
            if (marketData.industry.avgTransaction) {
                inputs.avgTransaction = marketData.industry.avgTransaction;
                inputs.avgTicket = marketData.industry.avgTransaction;
            }
            // Use dynamic monthlyCustomers from market intel (e.g., 200 for local auto shop)
            if (marketData.industry.monthlyCustomers) {
                inputs.monthlyVisits = marketData.industry.monthlyCustomers;
            }
        } else if (industryDefaults) {
            // No market data - use industry defaults from NAICS config
            if (!inputs.avgTransaction && !inputs.avgTicket) {
                inputs.avgTransaction = industryDefaults.avgTransaction;
                inputs.avgTicket = industryDefaults.avgTransaction;
            }
            if (!inputs.monthlyVisits) {
                inputs.monthlyVisits = industryDefaults.monthlyCustomers;
            }
        }

        // Pre-call form enhancement (Enterprise feature)
        let precallFormData = null;
        const precallFormId = body.precallFormId || null;

        if (precallFormId && userId !== 'anonymous') {
            precallFormData = await getPrecallFormEnhancement(precallFormId, userId);
            if (precallFormData) {
                console.log('Enhancing pitch with pre-call form data:', precallFormId);
                inputs = enhanceInputsWithPrecallData(inputs, precallFormData);
            }
        }

        const level = parseInt(body.pitchLevel) || 3;

        // Analyze reviews using the enhanced review analytics service
        let reviewData = {
            sentiment: { positive: 65, neutral: 25, negative: 10 },
            topThemes: ['Quality products', 'Excellent service', 'Great atmosphere', 'Good value'],
            staffMentions: [],
            differentiators: ['Unique offerings', 'Personal touch', 'Community focus'],
            analytics: null,
            pitchMetrics: null
        };

        if (body.googleReviews && body.googleReviews.length > 50) {
            // Use enhanced review analytics
            const analytics = reviewAnalytics.analyzeReviews(
                body.googleReviews,
                parseFloat(body.googleRating) || null,
                parseInt(body.numReviews) || null
            );

            reviewData.analytics = analytics;
            reviewData.pitchMetrics = reviewAnalytics.getPitchMetrics(analytics);

            // Simple theme extraction from review text
            const reviewText = body.googleReviews.toLowerCase();
            const themes = [];

            if (reviewText.includes('friendly') || reviewText.includes('helpful')) themes.push('Friendly and helpful staff');
            if (reviewText.includes('quick') || reviewText.includes('fast')) themes.push('Quick service');
            if (reviewText.includes('clean') || reviewText.includes('neat')) themes.push('Clean environment');
            if (reviewText.includes('quality') || reviewText.includes('great')) themes.push('Quality products/service');
            if (reviewText.includes('price') || reviewText.includes('value')) themes.push('Good value for money');
            if (reviewText.includes('recommend')) themes.push('Highly recommended by customers');

            if (themes.length > 0) {
                reviewData.topThemes = themes.slice(0, 4);
            }

            // Use analytics-derived sentiment based on quality data
            if (analytics.quality && analytics.quality.distributionPct) {
                const pct = analytics.quality.distributionPct;
                reviewData.sentiment = {
                    positive: (pct[5] || 0) + (pct[4] || 0),
                    neutral: pct[3] || 0,
                    negative: (pct[2] || 0) + (pct[1] || 0)
                };
            } else {
                // Fallback: Adjust sentiment based on rating
                const rating = parseFloat(body.googleRating) || 4.0;
                if (rating >= 4.5) {
                    reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
                } else if (rating >= 4.0) {
                    reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
                } else if (rating >= 3.5) {
                    reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
                }
            }
        } else {
            // No review text provided - adjust sentiment based on rating only
            const rating = parseFloat(body.googleRating) || 4.0;
            if (rating >= 4.5) {
                reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
            } else if (rating >= 4.0) {
                reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
            } else if (rating >= 3.5) {
                reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
            }
        }

        // Calculate ROI with industry-specific growth rate
        const roiData = calculateROI(inputs, naicsCode);
        console.log(`ROI calculated with ${roiData.growthRate}% growth rate for ${roiData.industryName || 'default industry'}`);

        // userId already declared above for pre-call form enhancement

        // Get user data for creator info and seller profile
        let creatorInfo = {
            userId: userId,
            email: null,
            displayName: null
        };
        let sellerProfile = body.sellerProfile || null;

        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    creatorInfo.email = userData.email || null;
                    creatorInfo.displayName = userData.profile?.displayName || userData.displayName || null;

                    // Get seller profile from user document if not provided in request
                    if (!sellerProfile && userData.sellerProfile) {
                        sellerProfile = userData.sellerProfile;
                    }
                }
            } catch (e) {
                console.log('Could not fetch user data:', e.message);
            }
        }

        // Build seller context (uses defaults if no seller profile)
        // Pass icpId for multi-ICP support - allows selecting specific ICP persona
        const icpId = body.icpId || null;
        const sellerContext = buildSellerContext(sellerProfile, icpId);

        // Extract booking/branding options - prefer seller profile values
        const options = {
            bookingUrl: body.bookingUrl || null,
            hideBranding: body.hideBranding || false,
            primaryColor: body.primaryColor || sellerContext.primaryColor || '#3A6746',
            accentColor: body.accentColor || sellerContext.accentColor || '#D4A847',
            companyName: body.companyName || sellerContext.companyName || 'PathSynch',
            contactEmail: body.contactEmail || 'hello@pathsynch.com',
            logoUrl: body.logoUrl || sellerContext.logoUrl || null,
            // Pass full seller context for dynamic content
            sellerContext: sellerContext
        };

        // Generate IDs first (needed for tracking in generated HTML)
        const pitchId = generateId();
        const shareId = generateId();

        // Generate HTML based on level (with optional market data and pitchId for tracking)
        let html;
        switch (level) {
            case 1:
                html = generateLevel1(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 2:
                html = generateLevel2(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 3:
            default:
                html = generateLevel3(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
        }

        // Create pitch document
        const pitchData = {
            pitchId,
            shareId,
            userId,

            // Creator attribution (for team analytics)
            creatorInfo,

            // Business info
            businessName: inputs.businessName,
            contactName: inputs.contactName,
            address: inputs.address,
            websiteUrl: inputs.websiteUrl,

            // Google data
            googleRating: inputs.googleRating,
            numReviews: inputs.numReviews,

            // Classification
            industry: inputs.industry,
            subIndustry: inputs.subIndustry,
            pitchLevel: level,

            // Generated content
            html,
            roiData,
            reviewAnalysis: reviewData,
            reviewAnalytics: reviewData.analytics || null,
            reviewPitchMetrics: reviewData.pitchMetrics || null,

            // Market intelligence data (if from market report)
            marketData: marketData || null,
            source: body.source || 'manual',
            marketReportId: body.marketReportId || null,

            // Pre-call form data (Enterprise feature)
            precallFormId: precallFormId || null,
            precallFormData: precallFormData ? {
                prospectName: precallFormData.prospectName,
                prospectEmail: precallFormData.prospectEmail,
                completedAt: precallFormData.completedAt,
                enhancement: precallFormData.enhancement,
                prospectChallenge: precallFormData.prospectChallenge,
                usedProspectWords: !!precallFormData.prospectChallenge
            } : null,

            // Trigger event data (news article, social post, etc.)
            triggerEvent: triggerEvent ? {
                headline: triggerEvent.headline,
                summary: triggerEvent.summary,
                source: triggerEvent.source,
                url: triggerEvent.url,
                eventType: triggerEvent.eventType,
                usage: triggerEvent.usage
            } : null,

            // Form data (for re-generation)
            formData: body,

            // Status
            status: 'ready',
            shared: true,  // Enable public sharing by default

            // Analytics
            analytics: {
                views: 0,
                uniqueViewers: 0,
                lastViewedAt: null
            },

            // Timestamps
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await db.collection('pitches').doc(pitchId).set(pitchData);

        // Increment user's pitch count
        if (userId !== 'anonymous') {
            await incrementPitchCount(userId);
        }

        console.log(`Created pitch ${pitchId} for user ${userId} (Level ${level})`);

        return res.status(200).json({
            success: true,
            pitchId,
            shareId,
            level,
            businessName: inputs.businessName
        });

    } catch (error) {
        console.error('Error generating pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate pitch',
            error: error.message
        });
    }
}

/**
 * Get pitch by ID - handles GET /pitch/:pitchId
 */
async function getPitch(req, res) {
    try {
        const db = getDb();
        const pitchId = req.params.pitchId;

        if (!pitchId) {
            return res.status(400).json({
                success: false,
                message: 'Pitch ID is required'
            });
        }

        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Pitch not found'
            });
        }

        const pitchData = pitchDoc.data();

        return res.status(200).json({
            success: true,
            data: {
                id: pitchId,
                ...pitchData
            }
        });

    } catch (error) {
        console.error('Error getting pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get pitch',
            error: error.message
        });
    }
}

/**
 * Get pitch by share ID - handles GET /pitch/share/:shareId
 */
async function getSharedPitch(req, res) {
    try {
        const db = getDb();
        const shareId = req.params.shareId;

        if (!shareId) {
            return res.status(400).json({
                success: false,
                message: 'Share ID is required'
            });
        }

        const pitchQuery = await db.collection('pitches')
            .where('shareId', '==', shareId)
            .limit(1)
            .get();

        if (pitchQuery.empty) {
            return res.status(404).json({
                success: false,
                message: 'Shared pitch not found'
            });
        }

        const pitchDoc = pitchQuery.docs[0];
        const pitchData = pitchDoc.data();

        return res.status(200).json({
            success: true,
            data: {
                id: pitchDoc.id,
                ...pitchData
            }
        });

    } catch (error) {
        console.error('Error getting shared pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get shared pitch',
            error: error.message
        });
    }
}

/**
 * Generate a pitch directly (for bulk upload, no HTTP response)
 * Returns { success: boolean, pitchId?: string, error?: string }
 */
async function generatePitchDirect(data, userId) {
    try {
        const db = getDb();

        const inputs = {
            businessName: data.businessName,
            contactName: data.contactName || 'Business Owner',
            address: data.address,
            websiteUrl: data.websiteUrl || '',
            googleRating: data.googleRating,
            numReviews: data.numReviews,
            industry: data.industry,
            subIndustry: data.subIndustry || '',
            statedProblem: data.customMessage || 'increasing customer engagement and visibility',
            monthlyVisits: data.monthlyVisits,
            avgTransaction: data.avgTransaction,
            avgTicket: data.avgTransaction || data.avgTicket,
            repeatRate: data.repeatRate || 0.4
        };

        // Get NAICS code for industry-specific defaults
        const naicsCodes = naics.getNaicsByDisplay(data.subIndustry || data.industry);
        const naicsCode = naicsCodes[0] || null;
        const industryDefaults = naicsCode ? naics.getIndustryDefaults(naicsCode) : null;

        // Apply industry defaults if not provided
        if (!inputs.monthlyVisits && industryDefaults) {
            inputs.monthlyVisits = industryDefaults.monthlyCustomers;
        } else if (!inputs.monthlyVisits) {
            inputs.monthlyVisits = 200; // Conservative fallback
        }

        if (!inputs.avgTransaction && !inputs.avgTicket && industryDefaults) {
            inputs.avgTransaction = industryDefaults.avgTransaction;
            inputs.avgTicket = industryDefaults.avgTransaction;
        } else if (!inputs.avgTransaction && !inputs.avgTicket) {
            inputs.avgTransaction = 50; // Conservative fallback
            inputs.avgTicket = 50;
        }

        const level = parseInt(data.pitchLevel) || 2;

        // Basic review data
        const reviewData = {
            sentiment: { positive: 65, neutral: 25, negative: 10 },
            topThemes: ['Quality products', 'Excellent service', 'Great atmosphere', 'Good value'],
            staffMentions: [],
            differentiators: ['Unique offerings', 'Personal touch', 'Community focus']
        };

        // Adjust sentiment based on rating
        const rating = parseFloat(data.googleRating) || 4.0;
        if (rating >= 4.5) {
            reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
        } else if (rating >= 4.0) {
            reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
        } else if (rating >= 3.5) {
            reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
        }

        // Calculate ROI with industry-specific growth rate
        const roiData = calculateROI(inputs, naicsCode);

        // Fetch seller profile if userId provided
        let sellerProfile = null;
        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    sellerProfile = userData.sellerProfile || null;
                }
            } catch (e) {
                console.log('Could not fetch seller profile:', e.message);
            }
        }

        // Build seller context (uses defaults if no seller profile)
        // Pass icpId for multi-ICP support - allows selecting specific ICP persona
        const icpId = data.icpId || null;
        const sellerContext = buildSellerContext(sellerProfile, icpId);

        // Options - prefer seller profile values
        const options = {
            bookingUrl: data.bookingUrl || null,
            hideBranding: data.hideBranding || false,
            primaryColor: data.primaryColor || sellerContext.primaryColor || '#3A6746',
            accentColor: data.accentColor || sellerContext.accentColor || '#D4A847',
            companyName: data.companyName || sellerContext.companyName || 'PathSynch',
            contactEmail: data.contactEmail || 'hello@pathsynch.com',
            logoUrl: data.logoUrl || sellerContext.logoUrl || null,
            sellerContext: sellerContext
        };

        // Generate IDs first (needed for tracking in generated HTML)
        const pitchId = generateId();
        const shareId = generateId();

        // Generate HTML based on level
        let html;
        switch (level) {
            case 1:
                html = generateLevel1(inputs, reviewData, roiData, options, null, pitchId);
                break;
            case 2:
                html = generateLevel2(inputs, reviewData, roiData, options, null, pitchId);
                break;
            case 3:
            default:
                html = generateLevel3(inputs, reviewData, roiData, options, null, pitchId);
                break;
        }

        // Get user data for creator info
        let creatorInfo = {
            userId: userId,
            email: null,
            displayName: null
        };

        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    creatorInfo.email = userData.email || null;
                    creatorInfo.displayName = userData.profile?.displayName || userData.displayName || null;
                }
            } catch (e) {
                console.log('Could not fetch user data for creatorInfo:', e.message);
            }
        }

        // Create pitch document
        const pitchData = {
            pitchId,
            shareId,
            userId,
            creatorInfo,
            businessName: inputs.businessName,
            contactName: inputs.contactName,
            address: inputs.address,
            websiteUrl: inputs.websiteUrl,
            googleRating: inputs.googleRating,
            numReviews: inputs.numReviews,
            industry: inputs.industry,
            subIndustry: inputs.subIndustry,
            pitchLevel: level,
            html,
            roiData,
            reviewAnalysis: reviewData,
            formData: data,
            status: 'ready',
            shared: true,  // Enable public sharing by default
            source: data.source || 'bulk_upload',
            bulkJobId: data.bulkJobId || null,
            analytics: {
                views: 0,
                uniqueViewers: 0,
                lastViewedAt: null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await db.collection('pitches').doc(pitchId).set(pitchData);

        console.log(`Created pitch ${pitchId} for user ${userId} (Level ${level}) via bulk upload`);

        return { success: true, pitchId, shareId };

    } catch (error) {
        console.error('Error generating pitch directly:', error);
        return { success: false, error: error.message };
    }
}

// Export for Firebase Functions
module.exports = {
    generatePitch,
    generatePitchDirect,
    getPitch,
    getSharedPitch,
    generateLevel1,
    generateLevel2,
    generateLevel3,
    calculateROI
};
