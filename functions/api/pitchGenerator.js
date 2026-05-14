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
const geminiClient = require('../services/geminiClient');
const { retrieveChunks } = require('../services/ragService');

// Extracted modules
const { PITCH_LIMITS, checkPitchLimit, incrementPitchCount, validateStyle, validateCustomLibraryAccess } = require('./pitch/validators');
const { buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData, fetchSalesLibraryContext, buildSalesLibraryPromptBlock, enrichProspectData } = require('./pitch/dataEnricher');
const { adjustColor, truncateText, CONTENT_LIMITS } = require('./pitch/htmlBuilder');
const { generateLevel1 } = require('./pitch/level1Generator');
const { generateLevel2 } = require('./pitch/level2Generator');
const { generateLevel3 } = require('./pitch/level3Generator');

// Sprint 3+4: Parallel prospect enrichment pipeline
const { enrichProspect, buildProspectIntelligenceBlock } = require('../services/pitchEnricher');

// Template-driven L2 One-Pager pipeline
const { generateTemplateOnePager } = require('./pitch/templateOnePager');

// Vertical detection for industry-specific pitch context
const { detectVertical, buildVerticalContext } = require('../services/verticalConfigs');

// Phase 2: Smart Mode — card-specific synthesis + referral calculator
const { getSynthesisPrompt } = require('../services/synthesisPromptRouter');
const { calculateReferralPotential } = require('../services/referralCalculator');

// Phase 4: Visual engines — Gemini data viz + Imagen 3 hero imagery
const { generateVisuals } = require('../services/visualEngine');

// Card-specific system prompts — each card gets a unique JSON schema
// These override the level-based system prompt when Smart Mode is active with a card type
const CARD_SYSTEM_PROMPTS = {
    card1: `You are a sales intelligence analyst generating a competitor landscape analysis.
Lead with a positioning map (price vs quality). Name the top 3 competitors explicitly from the enrichment data.
Calculate the rating gap (prospect vs neighborhood average).
Identify the value gap — where the seller wins for this specific business.
End with 3 specific data-backed pitch hooks.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline about competitive positioning",
  "subheadline": "one-line insight about their market position",
  "positioningInsight": "2-3 sentences on where the prospect sits vs competitors (price vs quality)",
  "competitors": [
    { "name": "competitor name", "rating": 4.5, "reviews": 120, "strength": "what they do well", "weakness": "vulnerability" }
  ],
  "ratingGap": { "prospectRating": 4.2, "areaAverage": 4.4, "gapAnalysis": "what the gap means" },
  "valueGap": "2-3 sentences on the specific opportunity the seller can exploit",
  "pitchHooks": ["3 data-backed pitch hooks tied to competitive intelligence"],
  "cta": "specific next step referencing competitive urgency"
}`,

    card2: `You are a reputation intelligence analyst generating a reputation health analysis.
Lead with the current rating and review velocity (reviews per month).
Score the response rate gap vs industry standard (85%+ is best practice).
Identify the top 3 complaint patterns from available signals.
Calculate the revenue impact of their current rating gap.
Frame around what the business owner needs to hear before they lose more customers.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline about reputation health",
  "subheadline": "one-line stat about their review standing",
  "currentRating": 4.2,
  "reviewCount": 150,
  "reviewVelocity": "estimated reviews per month",
  "responseRateGap": "their estimated response rate vs 85% benchmark",
  "complaintPatterns": ["top 3 recurring complaint themes from review signals"],
  "revenueImpact": "estimated revenue lost due to rating gap (e.g., X% fewer clicks at 4.2 vs 4.5)",
  "sentimentBreakdown": { "positive": "key positive themes", "negative": "key negative themes" },
  "actionPlan": ["3 specific steps to improve reputation"],
  "cta": "specific next step tied to reputation improvement"
}`,

    card3: `You are a market intelligence analyst generating a local market opportunity analysis.
Lead with TAM and opportunity score. Frame the revenue upside: moving from current rating to top quartile = X% more clicks = Y new customers per month.
Include market size, saturation score, growth rate, demographic fit, competitor count.
Position the seller's solution as the mechanism that captures the identified opportunity.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline about market opportunity",
  "subheadline": "one-line stat about the opportunity size",
  "tamEstimate": "total addressable market size in dollars or customers",
  "opportunityScore": 78,
  "marketSaturation": "low/medium/high with explanation",
  "growthRate": "local market growth trend",
  "demographicFit": "why this market fits the prospect's ideal customer",
  "competitorCount": 12,
  "revenueUpside": "projected revenue gain from improving rating/visibility (show math)",
  "captureStrategy": ["3 specific tactics to capture the identified opportunity"],
  "cta": "specific next step tied to market opportunity"
}`,

    card4: `You are a sales strategist generating a pre-call intelligence brief.
This is an internal document for the salesperson, NOT for the prospect.
Be specific — reference the actual business name, rating, and trigger events from enrichment data.

Return a JSON object with these fields:
{
  "headline": "briefing title with prospect company name",
  "companySnapshot": "2-3 sentence company overview with key facts",
  "meetingTrigger": "the specific reason/signal why they will take the meeting now",
  "suggestedOpener": "1-2 sentence opening line tied to a specific data point about their business",
  "talkingPoints": [
    { "point": "talking point", "product": "relevant product to pitch", "dataBackup": "the stat or fact that supports this point" }
  ],
  "discoveryQuestions": ["3 hypothesis-testing questions to ask during the call"],
  "objections": [
    { "objection": "likely objection", "response": "recommended response" }
  ],
  "competitorWatch": ["competitors they might also be talking to and how to counter"],
  "cta": "recommended close/next step for the call"
}`,

    card5: `You are a referral marketing analyst generating a referral potential analysis.
Use the referral calculation data provided to produce specific, grounded projections.
Do NOT estimate — use the exact figures from the calculation data when available.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline about referral revenue potential",
  "subheadline": "one-line stat about untapped referral revenue",
  "currentMonthlyReferrals": "estimated current referrals (from calc data)",
  "potentialMonthlyReferrals": "projected referrals with an active program (from calc data)",
  "annualRevenueUnlocked": "annual referral revenue potential in dollars (from calc data)",
  "rewardStructure": { "type": "recommended reward type", "amount": "specific dollar/percent amount", "rationale": "why this structure works for their industry" },
  "paybackPeriod": "time to ROI on referral program investment",
  "programDesign": ["3 specific program design recommendations for this business"],
  "socialProof": "relevant stat or example about referral programs in their industry",
  "cta": "specific next step to launch their referral program"
}`,

    card6: `You are a local SEO expert generating a GBP (Google Business Profile) completeness audit.
Lead with the overall GBP score (0-100). Break down across dimensions.
Identify the single highest-impact missing item. Estimate ranking lift from fixing the top gap.
Frame as an engagement recommendation with specific deliverables and timeline.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline about their GBP health",
  "subheadline": "one-line stat about their GBP score or ranking opportunity",
  "gbpScore": 65,
  "dimensions": [
    { "name": "dimension name (e.g., Photos, Hours, Description)", "score": "complete/partial/missing", "impact": "high/medium/low" }
  ],
  "highestImpactGap": { "dimension": "the #1 missing item", "currentState": "what it looks like now", "fixDescription": "what to do", "estimatedLift": "expected ranking/visibility improvement" },
  "quickWins": ["3 items they can fix today for immediate improvement"],
  "fullOptimizationPlan": ["phased plan: week 1, week 2, week 3-4 deliverables"],
  "cta": "specific next step tied to GBP optimization"
}`
};

// City normalization helper — handles "Atlanta, GA", "123 Main St, Atlanta, GA 30301"
function extractCity(input) {
    if (!input) return null;
    const parts = input.split(',');
    for (const part of parts) {
        const cleaned = part.trim();
        if (/^\d/.test(cleaned)) continue;
        if (cleaned.length <= 3) continue;
        if (/\d/.test(cleaned)) continue;
        return cleaned.toLowerCase().trim();
    }
    return input.toLowerCase().trim();
}

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
 * Bracket-counter JSON extractor — correctly handles nested objects/arrays.
 * Falls back to lastIndexOf('}') if bracket counting finds no complete object.
 */
function extractJSON(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.substring(start, i + 1);
        }
    }
    // Incomplete JSON — return null so caller can handle gracefully
    return null;
}

/**
 * Generate AI-enhanced pitch content using custom sales library
 * @param {Object} salesLibraryContext - User's custom sales documents
 * @param {Object} inputs - Pitch inputs (prospect data)
 * @param {Object} sellerContext - Seller profile context
 * @param {number} level - Pitch level (1, 2, or 3)
 * @param {Array} [ragChunks=[]] - RAG-retrieved chunks for additional context
 * @param {string} [prospectIntelBlock=''] - Sprint 3+4 prospect intelligence block
 * @param {string} [cardType='standard'] - Smart Mode card type (card1-card6 or 'standard')
 * @returns {Promise<Object|null>} AI-generated content or null if failed
 */
async function generateLibraryEnhancedContent(salesLibraryContext, inputs, sellerContext, level, ragChunks = [], prospectIntelBlock = '', cardType = 'standard') {
    const hasCardInstructions = !!(prospectIntelBlock && prospectIntelBlock.includes('CARD SYNTHESIS INSTRUCTIONS'));
    if (!salesLibraryContext?.documents?.length && ragChunks.length === 0 && !hasCardInstructions) return null;

    try {
        const libraryPromptBlock = buildSalesLibraryPromptBlock(salesLibraryContext);

        // Build RAG context block if chunks available
        let ragContextBlock = '';
        if (ragChunks.length > 0) {
            const chunksText = ragChunks.map((chunk, i) => {
                const source = chunk.source || chunk.sourceTitle || `Chunk ${i + 1}`;
                const score = chunk.score ? ` (relevance: ${(chunk.score * 100).toFixed(0)}%)` : '';
                return `[${source}${score}]\n${chunk.content || chunk.text || ''}`;
            }).join('\n\n');

            ragContextBlock = `
SELLER CONTEXT (from Sales Library):
${chunksText}

Use this context to make the pitch reflect the seller's actual products, case studies, and value propositions rather than generating generic content.
`;
        }

        if (!libraryPromptBlock && !ragContextBlock && !hasCardInstructions) return null;

        // Build prospect context
        const prospectContext = `
PROSPECT INFORMATION:
- Company Name: ${inputs.businessName || 'Unknown'}
- Industry: ${inputs.industry || 'Unknown'}
- Sub-Industry: ${inputs.subIndustry || 'N/A'}
- Location: ${inputs.address || 'Unknown'}
- Website: ${inputs.websiteUrl || 'N/A'}
- Google Rating: ${inputs.googleRating || 'N/A'} (${inputs.numReviews || 0} reviews)
- Contact Name: ${inputs.contactName || 'Decision Maker'}
- Stated Problem/Need: ${inputs.statedProblem || 'Looking to improve operations'}
`;

        // Generate level-specific content
        // Card-specific system prompts override level-based defaults when Smart Mode is active
        let systemPrompt;
        const JSON_PREFIX = 'IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.\n\n';

        if (cardType && cardType !== 'standard' && CARD_SYSTEM_PROMPTS[cardType]) {
            systemPrompt = JSON_PREFIX + CARD_SYSTEM_PROMPTS[cardType];
            console.log(`[SmartMode] Using card-specific system prompt for ${cardType}`);
        } else if (level === 1) {
            systemPrompt = `You are a sales copywriter. Generate a personalized outreach email and LinkedIn message for this prospect.

Return a JSON object with these fields:
{
  "emailSubject": "compelling subject line",
  "emailBody": "personalized email body (3-4 paragraphs)",
  "linkedinMessage": "shorter LinkedIn connection request message",
  "keyValueProps": ["3-4 value propositions tailored to this prospect"],
  "personalizedHook": "opening line referencing something specific about their business"
}`;
        } else if (level === 4) {
            systemPrompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation, reasoning, or text before or after the JSON.

You are a sales strategist creating a Sales Library powered one-pager.

CRITICAL INSTRUCTIONS:
- The Sales Library documents provided below are your PRIMARY content source.
- Extract the seller's actual product name, methodology, proof points, case studies, and pricing from those documents.
- Do NOT use generic industry language or invent statistics. Every claim must trace back to the uploaded documents.
- Structure the pitch around the SELLER'S narrative and value proposition as found in their documents.
- If the documents contain case studies, reference them by name with specific results.
- If the documents contain ROI data or metrics, use those exact numbers (scaled to the prospect where appropriate).
- The output must read as if it was written by someone who deeply studied the seller's materials.

Return a JSON object with these fields:
{
  "headline": "seller's actual value proposition drawn from their documents",
  "subheadline": "specific outcome or proof point from the seller's materials",
  "sellerProductName": "exact product or service name from the documents",
  "sellerMethodology": "the seller's specific approach, process, or framework from their docs",
  "proofPoints": ["3-4 specific stats, results, or claims taken directly from the documents"],
  "caseStudyName": "name of the featured case study from the documents (or null if none)",
  "caseStudyResult": "the specific measurable result from that case study (or null)",
  "sellerDifferentiators": ["3-4 things that make the seller unique per their documents"],
  "problemStatement": "the problem the seller solves, in their own language from the docs",
  "solutionOverview": "how the seller solves it, per their documents",
  "keyBenefits": ["4 benefits grounded in the seller's actual product capabilities"],
  "callToAction": "the seller's preferred next step from their documents, or a sensible default"
}`;
        } else if (level === 2) {
            systemPrompt = `You are a sales strategist. Generate content for a one-pager sales document for this prospect.

Return a JSON object with these fields:
{
  "headline": "attention-grabbing headline",
  "subheadline": "supporting statement",
  "problemStatement": "2-3 sentences describing their specific challenge",
  "solutionOverview": "2-3 sentences on how you solve it",
  "keyBenefits": ["4 specific benefits with metrics if available"],
  "socialProof": "relevant case study or credibility marker from your materials",
  "cta": "clear call to action"
}`;
        } else {
            systemPrompt = JSON_PREFIX + `You are a sales strategist. Generate content for a full enterprise pitch deck for this prospect.

Return a JSON object with these fields:
{
  "deckTitle": "presentation title",
  "executiveSummary": "2-3 sentence executive summary",
  "problemSlide": "description of their problem/opportunity",
  "solutionSlide": "how you solve it (1-2 sentences)",
  "roiProjection": "projected ROI — 1-2 sentences with a specific number, e.g. '12% more clicks at 4.5★ = ~$2k/month additional revenue'",
  "implementationPhases": ["Phase 1 (Days 1-30): description", "Phase 2 (Days 31-60): description", "Phase 3 (Days 61-90): description"],
  "caseStudyReference": "relevant case study adapted to this prospect (1 sentence)",
  "pricingFramework": "pricing structure from your materials (1 sentence)",
  "nextSteps": ["Step 1", "Step 2", "Step 3"]
}`;
        }

        const fullPrompt = (libraryPromptBlock || '') + ragContextBlock + prospectContext + (prospectIntelBlock ? '\n' + prospectIntelBlock + '\n' : '');

        const response = await geminiClient.sendMessage({
            systemPrompt,
            userMessage: fullPrompt,
            maxTokens: level === 3 ? 4096 : 2048,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 }
        });

        if (!response?.content) {
            console.error(`[L4] generateLibraryEnhancedContent: Gemini returned empty response. level=${level}`);
            return null;
        }

        console.log(`[L4] generateLibraryEnhancedContent: Gemini responded (${response.content.length} chars) for level=${level}`);
        if (level === 3) {
            console.log(`[L3-DEBUG] Raw Gemini response (first 400 chars): ${response.content.substring(0, 400)}`);
        }

        // Parse JSON response — bracket-counter extractor handles nested objects correctly
        try {
            const rawText = response.content;
            const jsonStr = extractJSON(rawText);

            if (!jsonStr) {
                console.error(`[L4] No complete JSON object found in response. Raw: ${rawText.substring(0, 200)}`);
                return null;
            }

            const parsed = JSON.parse(jsonStr);
            console.log(`[L4] generateLibraryEnhancedContent: JSON parsed OK. Fields: ${Object.keys(parsed).join(', ')}`);
            return parsed;
        } catch (parseError) {
            console.error(`[L4] generateLibraryEnhancedContent JSON parse failed: ${parseError.message}, level=${level}`);
            console.error(`[L4] Raw response (first 500 chars): ${response.content.substring(0, 500)}`);
            return null;
        }
    } catch (error) {
        console.error(`[L4] generateLibraryEnhancedContent failed: ${error.message}, level=${level}`);
        return null;
    }
}

// Note: PITCH_LIMITS, checkPitchLimit, incrementPitchCount imported from ./pitch/validators.js
// Note: buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData imported from ./pitch/dataEnricher.js
// Note: adjustColor, truncateText, CONTENT_LIMITS imported from ./pitch/htmlBuilder.js
// Note: generateLevel1 imported from ./pitch/level1Generator.js
// Note: generateLevel2 imported from ./pitch/level2Generator.js
// Note: generateLevel3 imported from ./pitch/level3Generator.js

/**
 * Generate LinkedIn warm-up posts for pre-outreach engagement
 * @param {Object} inputs - Pitch inputs (prospect data)
 * @param {Object} sellerContext - Seller profile context
 * @returns {Promise<Array|null>} Array of LinkedIn posts or null if failed
 */
async function generateLinkedInPosts(inputs, sellerContext) {
    try {
        const systemPrompt = `You are a LinkedIn content strategist. Generate 3 LinkedIn post drafts for a seller to publish BEFORE reaching out to a prospect. These posts build credibility and warm up the prospect's feed.

PROSPECT CONTEXT (DO NOT mention the prospect directly):
- Prospect's Industry: ${inputs.industry || 'Unknown'}
- Prospect's Challenges: ${inputs.statedProblem || 'operational efficiency'}

SELLER CONTEXT:
- Company: ${sellerContext?.companyName || 'Our company'}
- Industry: ${sellerContext?.industry || 'B2B'}

REQUIRED OUTPUT (JSON format):
{
    "posts": [
        {
            "type": "industry_insight",
            "content": "100-200 word post about a trend in the prospect's industry with a data point. First person, seller voice.",
            "hashtags": ["2-3 relevant hashtags"],
            "suggestedTiming": "5 days before outreach"
        },
        {
            "type": "social_proof",
            "content": "100-200 word post showcasing seller's credibility - client wins, awards, results. First person.",
            "hashtags": ["2-3 relevant hashtags"],
            "suggestedTiming": "3 days before outreach"
        },
        {
            "type": "thought_leadership",
            "content": "100-200 word post with unique perspective on a topic the prospect likely cares about. First person.",
            "hashtags": ["2-3 relevant hashtags"],
            "suggestedTiming": "1 day before outreach"
        }
    ]
}

RULES:
- Never name the specific prospect
- First person (seller's voice)
- 100-200 words each
- Professional but conversational
- 2-3 hashtags per post
- Return ONLY the JSON object`;

        const response = await geminiClient.sendMessage({
            systemPrompt,
            userMessage: 'Generate LinkedIn posts for pre-outreach warm-up based on the context provided.',
            maxTokens: 2048,
            temperature: 0.8
        });

        if (!response?.content) return null;

        try {
            let jsonStr = response.content;
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }
            const parsed = JSON.parse(jsonStr.trim());
            return parsed.posts || null;
        } catch (parseError) {
            console.error('Failed to parse LinkedIn posts response:', parseError.message);
            return null;
        }
    } catch (error) {
        console.error('Error generating LinkedIn posts:', error.message);
        return null;
    }
}

// Tiers that have access to LinkedIn posts feature
const LINKEDIN_POSTS_TIERS = ['growth', 'scale', 'enterprise'];

/**
 * Generate Level 4: Product One-Pager (Sales Library powered)
 * Validates that the user has Sales Library documents, then delegates
 * to the Level 2 one-pager generator with library content injected.
 *
 * @param {Object} inputs - Business and contact information
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculation data
 * @param {Object} options - Branding and customization options (includes salesLibraryContext)
 * @param {Object|null} marketData - Market intelligence data
 * @param {string} pitchId - Pitch ID for tracking
 * @returns {string} HTML content for the one-pager
 */
function generateLevel4(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    // L4 requires Sales Library — reject if empty
    const libraryContext = options.salesLibraryContext;
    if (!libraryContext || !libraryContext.documents || libraryContext.documents.length === 0) {
        throw new Error(
            'Your Sales Library is empty. Please upload at least one document ' +
            'to your Sales Library before generating a Product One-Pager.'
        );
    }

    // Reuse Level 2 generator with pitchLevel flag so it renders L4-specific sections.
    // Sales Library content overrides generic business data via
    // libraryEnhancedContent already injected into options by generatePitch().
    const l4Options = { ...options, pitchLevel: 4 };
    return generateLevel2(inputs, reviewData, roiData, l4Options, marketData, pitchId);
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
        let userTier = 'free';
        if (userId !== 'anonymous') {
            const limitCheck = await checkPitchLimit(userId);
            userTier = limitCheck.tier || 'free';
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

        // Phase 2: Smart Mode parameters
        const smartMode = body.smartMode === true;
        const smartPrompt = body.smartPrompt || '';
        const cardType = body.cardType || 'standard';
        const visualStyle = body.visualStyle || 'none';
        const outreachType = body.outreachType || null;
        const smartGoal = body.goal || '';
        const injectedLibraryItems = Array.isArray(body.injectedLibraryItems) ? body.injectedLibraryItems : [];
        // Phase 5C: Outline-first approved sections
        const outlineSections = Array.isArray(body.outlineSections) ? body.outlineSections : [];

        // If Smart Mode with outreachType, map to pitchLevel
        const outreachLevelMap = { l1: 1, l2: 2, l3: 3, l4: 4, 'One-Pager (L2)': 2 };
        const resolvedLevel = outreachType && outreachLevelMap[outreachType]
            ? outreachLevelMap[outreachType]
            : null;

        // Validate style parameter (tier-gated)
        // Smart Mode defaults to L2 (supports visuals); legacy form defaults to L3
        const level = resolvedLevel || parseInt(body.pitchLevel) || (smartMode ? 2 : 3);
        let validatedStyle = 'standard';
        try {
            validatedStyle = validateStyle(level, body.style, userTier);
        } catch (styleError) {
            return res.status(403).json({
                success: false,
                error: 'STYLE_NOT_AVAILABLE',
                message: styleError.message,
                requestedStyle: body.style,
                tier: userTier
            });
        }

        // Extract trigger event data (news article, social post, etc.)
        const triggerEvent = body.triggerEvent || null;

        // Map request body to inputs format
        // Use ?? null for numbers (preserves 0), || null for strings (converts '' to null too)
        let inputs = {
            businessName: body.businessName,
            contactName: body.contactName || 'Business Owner',
            address: body.address || null,
            websiteUrl: body.websiteUrl || null,
            googleRating: body.googleRating ?? null,
            numReviews: body.numReviews ?? null,
            industry: body.industry || null,
            subIndustry: body.subIndustry || null,
            statedProblem: body.statedProblem || 'increasing customer engagement and visibility',
            monthlyVisits: body.monthlyVisits ?? null,
            avgTransaction: body.avgTransaction ?? null,
            avgTicket: body.avgTransaction || body.avgTicket || null,
            repeatRate: body.repeatRate ?? 0.4,
            // Trigger event for personalized opening
            triggerEvent: triggerEvent
        };

        // Smart Mode: parse natural language smartPrompt to extract structured fields
        if (smartMode && smartPrompt) {
            // a) Extract URL from prompt
            const urlMatch = smartPrompt.match(/https?:\/\/[^\s,)]+/);
            const extractedUrl = urlMatch ? urlMatch[0].replace(/[.,;:!?)]+$/, '') : '';

            // b) Extract city/state FIRST (before stripping words from prompt)
            //    Handles "in SoDo Atlanta, GA" / "in Atlanta GA" / "in New York, NY"
            const cityMatch = smartPrompt.match(/\bin\s+([\w]+(?:\s+[\w]+){0,2}),?\s*([A-Z]{2})?\b/);
            let extractedCity = '';
            let extractedState = '';
            if (cityMatch) {
                extractedCity = cityMatch[1];
                extractedState = cityMatch[2] || '';
            }

            // c) Extract business name — strip URL, location clause, and analysis card prefix
            let businessDescription = smartPrompt
                .replace(/https?:\/\/[^\s,)]+/g, '')                           // remove URLs
                .replace(/\b(that\s+is\s+)?opening\s+in\s+\w+/gi, '')          // remove "opening in April" etc.
                .replace(/\bin\s+[\w]+(?:\s+[\w]+){0,2},?\s*[A-Z]{0,2}\b/g, '') // remove "in CityName, ST"
                .replace(/^(Analyze|Research|Build|Generate|Measure|Create|Audit|Score)\s+([\w\s]+?\s+for\s+|[\w\s]+?\s+of\s+|competitor\s+\w+\s+and\s+\w+\s*)/i, '') // strip card prefixes (with or without "for")
                .replace(/\s+/g, ' ')
                .trim();

            // d) Set inputs fields from extracted values
            if (extractedUrl && !inputs.websiteUrl) {
                inputs.websiteUrl = extractedUrl;
            }

            if (!inputs.businessName || inputs.businessName === smartPrompt) {
                inputs.businessName = businessDescription || extractedUrl || smartPrompt;
            }

            if (extractedCity && !inputs.address) {
                inputs.address = extractedState ? `${extractedCity}, ${extractedState}` : extractedCity;
            }

            // Store the full prompt as additional context for AI synthesis
            inputs.statedProblem = smartPrompt + (inputs.statedProblem ? '\n' + inputs.statedProblem : '');

            console.log(`[SmartMode] Parsed: business="${inputs.businessName}", url="${inputs.websiteUrl || ''}", address="${inputs.address || ''}"`);
        }

        // ── Server-side pricing calculation from selected products ─────────────
        // Do NOT rely on AI for arithmetic. Calculate totals here and pass as
        // resolved values so the template renderer uses exact figures.
        const rawSelectedProducts = Array.isArray(body.selectedProducts) ? body.selectedProducts
            : (body.selectedProduct ? [body.selectedProduct] : []);

        if (rawSelectedProducts.length > 0) {
            let totalMonthly = 0;
            let totalSetup = 0;
            const lineItems = [];

            for (const p of rawSelectedProducts) {
                const name = p.productName || p.name || 'Product';
                const ps   = p.pricingStructure || 'custom';
                const monthly  = parseFloat(p.monthlyPrice)  || 0;
                const oneTime  = parseFloat(p.oneTimeFee)    || 0;
                const setup    = parseFloat(p.setupFee)      || 0;

                if (ps === 'monthly' || ps === 'tiered') {
                    totalMonthly += monthly;
                    totalSetup   += setup;
                    lineItems.push(monthly > 0 ? `${name} — $${monthly}/mo` : `${name} — included`);
                } else if (ps === 'one_time') {
                    totalSetup += oneTime;
                    lineItems.push(oneTime > 0 ? `${name} — $${oneTime} one-time` : `${name} — included`);
                } else if (ps === 'per_unit') {
                    const unitPrice = parseFloat(p.perUnitPrice) || 0;
                    const label     = (p.perUnitLabel || 'unit').trim();
                    // Integrations pricing is handled by the post-loop integrationCount block
                    const isIntegrations = name.toLowerCase().includes('integration');
                    if (isIntegrations) {
                        lineItems.push(`${name} — first 3 free, +$${unitPrice || 19}/mo each additional`);
                    } else {
                        totalMonthly += unitPrice;
                        lineItems.push(unitPrice > 0 ? `${name} — $${unitPrice}/${label}` : `${name} — included`);
                    }
                } else if (ps === 'quarterly') {
                    // Treat quarterly as recurring — not added to monthly total, noted separately
                    lineItems.push(monthly > 0 ? `${name} — $${monthly}/quarter` : `${name} — included`);
                } else if (ps === 'custom') {
                    // Custom products can have oneTimeFee/setupFee (setup) + perUnitPrice or monthlyPrice (recurring)
                    const unitPrice = parseFloat(p.perUnitPrice) || 0;
                    const label     = (p.perUnitLabel || '').trim();
                    const fixedFee  = setup + oneTime; // some products use setupFee, some oneTimeFee, some both

                    if (fixedFee  > 0) totalSetup   += fixedFee;
                    if (unitPrice > 0) totalMonthly += unitPrice;
                    if (monthly   > 0) totalMonthly += monthly;

                    const priceParts = [];
                    if (unitPrice > 0) priceParts.push(`$${unitPrice}/mo${label ? ` per ${label}` : ''}`);
                    if (monthly   > 0) priceParts.push(`$${monthly}/mo`);
                    if (fixedFee  > 0) priceParts.push(`$${fixedFee} one-time`);

                    lineItems.push(priceParts.length > 0 ? `${name} — ${priceParts.join(' + ')}` : `${name} — included`);
                } else {
                    // included_in_plan — bundled at no additional charge
                    lineItems.push(`${name} — included`);
                }
            }

            // Additional integrations pricing (first 3 free; $19/mo each additional)
            const integrationCount = Math.max(0, parseInt(body.integrationCount) || 0);
            if (integrationCount > 0) {
                const integrationProduct = rawSelectedProducts.find(p =>
                    (p.productName || p.name || '').toLowerCase().includes('integration')
                );
                const unitPrice = parseFloat(integrationProduct?.perUnitPrice) || 19;
                const additionalCost = integrationCount * unitPrice;
                totalMonthly += additionalCost;
                lineItems.push(`${integrationCount} additional integration${integrationCount !== 1 ? 's' : ''} — $${additionalCost}/mo`);
            }

            // Multi-location: multiply totals by location count
            const locationCount = Math.max(1, parseInt(body.locationCount) || 1);
            if (locationCount > 1) {
                totalMonthly = totalMonthly * locationCount;
                totalSetup   = totalSetup   * locationCount;
                inputs.locationCount = locationCount;
            }

            if (totalMonthly > 0) inputs.monthlyTotal    = `$${totalMonthly}/mo`;
            if (totalSetup   > 0) inputs.setupFee         = `$${totalSetup} one-time setup`;
            inputs.pricingLineItems  = lineItems;
            inputs.selectedProducts  = rawSelectedProducts;
            console.log(`[Pricing] server-calc from ${rawSelectedProducts.length} products (x${locationCount} locations): monthly=${inputs.monthlyTotal || '$0'} setup=${inputs.setupFee || 'none'}`);
        }

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

        // Vertical detection — auto-detect industry vertical for pitch context
        const verticalConfig = detectVertical(inputs.industry, inputs.subIndustry, inputs.businessName);
        const verticalContextBlock = buildVerticalContext(verticalConfig);
        if (verticalConfig) {
            console.log(`[Vertical] Detected: ${verticalConfig.key} (${verticalConfig.industryName}) for ${inputs.businessName || 'unknown'}`);
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

        // Note: level is already parsed above for style validation

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

        // Check for custom sales library (enterprise feature)
        let salesLibraryContext = null;
        let libraryEnhancedContent = null;
        let ragChunks = [];
        const useCustomLibrary = body.useCustomLibrary !== false; // Default to true if library exists

        if (userId && userId !== 'anonymous' && useCustomLibrary) {
            // Fetch sales library context and RAG chunks in parallel
            const ragQuery = [
                inputs.businessName,
                inputs.industry,
                body.campaignObjective || inputs.statedProblem
            ].filter(Boolean).join(' ');

            const [libraryCtx, retrievedChunks] = await Promise.all([
                fetchSalesLibraryContext(userId),
                ragQuery ? retrieveChunks({
                    tenantId: userId,
                    libraryType: 'sales_library',
                    query: ragQuery,
                    topK: 5
                }) : Promise.resolve([])
            ]);

            salesLibraryContext = libraryCtx;
            ragChunks = retrievedChunks || [];

            if (ragChunks.length > 0) {
                console.log(`RAG retrieved ${ragChunks.length} chunks for pitch generation`);
            }

        }

        // === LIBRARY CACHE CHECK ===
        let marketIntelCache = null;
        try {
            const city = extractCity(
                inputs.city || inputs.address
            );
            const industry = (inputs.industry ||
                inputs.subIndustry || '').toLowerCase().trim();

            if (city && industry) {
                const thirtyDaysAgo = new Date(
                    Date.now() - 30 * 24 * 60 * 60 * 1000
                );

                const cacheSnap = await admin.firestore()
                    .collection('library').doc(userId)
                    .collection('items')
                    .where('type', '==', 'intel')
                    .where('subType', '==', 'market')
                    .where('city', '==', city)
                    .where('industry', '==', industry)
                    .where('createdAt', '>', thirtyDaysAgo)
                    .limit(1)
                    .get();

                if (!cacheSnap.empty) {
                    marketIntelCache = cacheSnap.docs[0].data();
                    console.log('[Cache] Market Intel HIT for',
                        city, industry,
                        '— skipping redundant agent calls');
                } else {
                    console.log('[Cache] Market Intel MISS for',
                        city, industry);
                }
            }
        } catch (cacheErr) {
            // Cache check failure is non-fatal
            console.warn('[Cache] Check failed:', cacheErr.message);
            marketIntelCache = null;
        }

        // Feature 2: Enrich prospect data with Google Places and website scraping
        // Sprint 3+4: Run deep enrichment in parallel with Places enrichment
        let prospectEnrichment = null;
        let deepEnrichment = null;

        try {
            // Google Places always runs (business-specific)
            // Deep enrichment (competitors, news) skipped on cache hit
            const enrichmentPromises = [
                enrichProspectData(
                    inputs.businessName,
                    inputs.address || inputs.location,
                    inputs.websiteUrl
                ),
            ];

            if (!marketIntelCache) {
                enrichmentPromises.push(
                    enrichProspect({
                        businessName: inputs.businessName,
                        city: inputs.address?.split(',')[0]?.trim() || '',
                        state: inputs.address?.split(',')[1]?.trim()?.replace(/\d+/g, '').trim() || '',
                        industry: inputs.industry || inputs.subIndustry || '',
                        websiteUrl: inputs.websiteUrl || '',
                        icpType: sellerContext.icpName || '',
                    })
                );
            }

            const results = await Promise.allSettled(enrichmentPromises);
            const placesResult = results[0];
            const deepResult = results[1] || null;

            if (placesResult.status === 'fulfilled') {
                prospectEnrichment = placesResult.value;
                console.log('Prospect enrichment sources:', prospectEnrichment?.sources || []);
            } else {
                console.warn('Prospect enrichment failed:', placesResult.reason?.message);
            }

            if (deepResult && deepResult.status === 'fulfilled') {
                deepEnrichment = deepResult.value;
                console.log('Deep enrichment sources:', deepEnrichment?.sourcesUsed || [], `(${deepEnrichment?.elapsed}ms)`);
            } else if (deepResult) {
                console.warn('Deep enrichment failed (non-blocking):', deepResult.reason?.message);
            } else if (marketIntelCache) {
                console.log('[Cache] Deep enrichment skipped — using cached market intel');
            }
        } catch (enrichError) {
            console.warn('Enrichment pipeline error (non-blocking):', enrichError.message);
        }

        // If we got Google Places data, enhance reviewData
        if (prospectEnrichment?.googlePlaces) {
            const placesData = prospectEnrichment.googlePlaces;
            if (placesData.rating && !inputs.googleRating) {
                inputs.googleRating = placesData.rating;
                inputs.numReviews = placesData.reviewCount || 0;
            }
            if (placesData.positiveThemes?.length > 0 || placesData.negativeThemes?.length > 0) {
                reviewData.topThemes = [
                    ...(placesData.positiveThemes || []).slice(0, 3),
                    ...(reviewData.topThemes || []).slice(0, 2)
                ].slice(0, 5);
                reviewData.customerConcerns = placesData.customerConcerns || [];
            }
        }

        // Build prospect intelligence prompt block for AI synthesis
        let prospectIntelligenceBlock = deepEnrichment
            ? buildProspectIntelligenceBlock(deepEnrichment)
            : '';

        // Inject vertical context into the intelligence block
        if (verticalContextBlock) {
            prospectIntelligenceBlock = verticalContextBlock + '\n' + prospectIntelligenceBlock;
        }

        // Inject cached market intel if deep enrichment was skipped
        if (marketIntelCache && !deepEnrichment) {
            try {
                const cachedContent = JSON.parse(marketIntelCache.content || '{}');
                prospectIntelligenceBlock += '\n\n=== CACHED MARKET INTELLIGENCE ===\n'
                    + 'This data was pre-researched for this market:\n'
                    + JSON.stringify(cachedContent.summary || {}, null, 2).substring(0, 1500);

                // Inject market benchmarks into pitch context
                const benchmarks = cachedContent.benchmarks;
                if (benchmarks?.avgRating) {
                    prospectIntelligenceBlock +=
                        '\n\n=== MARKET BENCHMARKS ===\n'
                        + `Market average rating: ${benchmarks.avgRating}\u2605\n`
                        + `Top quartile: ${benchmarks.topQuartileAvg}\u2605\n`
                        + `Market leader: ${benchmarks.marketLeader} (${benchmarks.marketLeaderRating}\u2605)\n`
                        + `Avg reviews in market: ${benchmarks.avgReviews}\n\n`
                        + `INSTRUCTION: Reference these benchmarks in the pitch. `
                        + `If the prospect is below the ${benchmarks.avgRating}\u2605 market average, `
                        + `explicitly state the gap and its business impact. `
                        + `If above average, use it as a strength to reinforce.`;
                }
            } catch (parseErr) {
                console.warn('[Cache] Failed to parse cached content:', parseErr.message);
            }
        }

        // FIX 1: Market Intel context injection from linked market report
        if (body.source === 'market_intel_leads' && body.marketReportId) {
            try {
                const reportSnap = await db.collection('marketReports').doc(body.marketReportId).get();
                if (reportSnap.exists) {
                    const report = reportSnap.data();
                    const benchmarks = report.data?.benchmarks;
                    const reportCity = report.location?.city || extractCity(inputs.city || inputs.address) || '';
                    const reportIndustry = report.industry?.display || inputs.industry || '';
                    const reportLeads = report.data?.leads || [];
                    const matchedLead = reportLeads.find(l => l.name === inputs.businessName);
                    const leadSEOTier = matchedLead?.seoTier || matchedLead?.dataForSEO?.seoTier || 'moderate';
                    // Set opportunity score on inputs so L3 Data Analyst renderer can read it
                    inputs.opportunityScore = matchedLead?.opportunityScore || 0;
                    console.debug('[DA Deck] matchedLead:', inputs.businessName, '— opportunityScore:', inputs.opportunityScore);

                    if (benchmarks?.avgRating) {
                        const leadReviews = parseInt(inputs.numReviews) || 0;
                        const avgReviews = parseInt(benchmarks.avgReviews) || 0;
                        const presenceGap = avgReviews > 0 ? Math.round((1 - (leadReviews / avgReviews)) * 100) : 0;

                        prospectIntelligenceBlock +=
                            '\n\n=== MARKET INTELLIGENCE CONTEXT (use this data naturally in the pitch) ===\n'
                            + `This prospect is in the ${reportCity} ${reportIndustry} market with ${benchmarks.totalCompetitors} competitors.\n`
                            + `Market average rating: ${benchmarks.avgRating}. Market average reviews: ${benchmarks.avgReviews}.\n`
                            + `Market leader: ${benchmarks.marketLeader} with ${benchmarks.marketLeaderReviews} reviews.\n`
                            + `This prospect has ${inputs.googleRating || 'N/A'} stars and ${leadReviews} reviews — `
                            + `${presenceGap > 0 ? presenceGap + '% below' : Math.abs(presenceGap) + '% above'} the market average in review volume.\n`
                            + `They sit in the high-rating, low-volume quadrant of the positioning matrix — high quality but low visibility. `
                            + `Their SEO tier is ${leadSEOTier}.\n`
                            + `Weave 1-2 specific market comparison sentences into the pitch narrative. `
                            + `Reference the market leader by name. Do NOT just list these numbers — interpret them as a sales insight.`;

                        console.log('[MarketIntel] Injected market context for', inputs.businessName, '— presenceGap:', presenceGap + '%');

                        // Inject competitor data for battlecard renderer
                        const reportCompetitors = report.data?.competitors || [];
                        inputs.marketContext = {
                            competitors: reportCompetitors.slice(0, 20).map(c => ({
                                name: c.name || c.businessName || '',
                                rating: c.rating != null ? parseFloat(c.rating) : null,
                                reviewCount: parseInt(c.reviewCount || c.reviews || c.numReviews) || 0,
                                responseRate: c.responseRate != null ? parseFloat(c.responseRate) : null,
                                seoTier: c.seoTier || null
                            })).filter(c => c.name),
                            benchmarks,
                            city: reportCity,
                            industry: reportIndustry,
                            seoLandscape: report.data?.seoLandscape || null
                        };
                    }
                }
            } catch (reportErr) {
                console.warn('[MarketIntel] Failed to fetch market report for pitch context:', reportErr.message);
            }
        }

        // Account360 enrichment — read outbound_view when accountKey is provided (Sprint 5)
        let account360View = null;
        if (body.accountKey) {
            try {
                const db = getDb();
                const viewRef = db.collection('Account360').doc(body.accountKey)
                    .collection('agentViews').doc('outbound_view');
                const viewSnap = await viewRef.get();
                if (viewSnap.exists) {
                    const viewData = viewSnap.data();
                    const expiresAt = viewData.expiresAt?.toDate?.() || new Date(viewData.expiresAt);
                    if (expiresAt > new Date()) {
                        account360View = viewData;
                        console.log('[Account360] outbound_view hit for accountKey', body.accountKey);
                    } else {
                        console.log('[Account360] outbound_view expired for accountKey', body.accountKey);
                    }
                }
            } catch (err) {
                console.warn('[Account360] Failed to read outbound_view (non-blocking):', err.message);
            }
        }

        if (account360View) {
            const av = account360View;
            const contact = av.identity?.identifiedContacts?.[0];
            const highIntentList = (av.intentSignals?.highIntentPages || [])
                .map(p => p.tag || p.url || p).filter(Boolean).join(', ');
            const accountIntelBlock = [
                'ACCOUNT INTELLIGENCE (from Visitor Intel):',
                `Company: ${av.companyName?.value || 'Unknown'} (${av.identity?.tier || 'unknown'} match, ${av.identity?.confidence ?? 0}/100 confidence)`,
                av.intentSignals?.status  ? `Intent Status: ${av.intentSignals.status} — Score: ${av.intentSignals?.currentScore?.value ?? 0}` : '',
                highIntentList            ? `High-intent pages: ${highIntentList}` : '',
                av.intentSignals?.scoreExplanation?.[0] ? `Why now: ${av.intentSignals.scoreExplanation[0]}` : '',
                contact                   ? `Contact: ${contact.name || ''} <${contact.email}>`.trim() : '',
                av.recommendedNextAction?.value ? `Recommended angle: ${av.recommendedNextAction.value}` : ''
            ].filter(Boolean).join('\n');

            inputs.statedProblem = accountIntelBlock + '\n\n' + (inputs.statedProblem || '');
            inputs.account360View = av;
            console.log('[Account360] Injected account intelligence for', av.companyName?.value);
        }

        // Visitor Intel context — prepend to statedProblem when pitch originates from a visitor card
        // Falls back to URL param approach when account360View is not available
        if (body.visitorContext && !account360View) {
            const vc = body.visitorContext;
            const visitorBlock = [
                'VISITOR CONTEXT: This pitch is being generated from a website visitor.',
                `Company: ${vc.companyName || 'Unknown'} (${vc.confidenceTier || 'unknown'} match, ${vc.confidenceScore ?? 0}/100 confidence)`,
                `Pages visited: ${(vc.pagesVisited || []).join(', ') || 'none'}`,
                `Visit count: ${vc.visitCount || 1} · Last seen: ${vc.lastSeen || 'unknown'}`,
                vc.identifiedContact ? `Contact: ${vc.identifiedContact.name} <${vc.identifiedContact.email}>` : ''
            ].filter(Boolean).join('\n');

            inputs.statedProblem = visitorBlock + '\n\n' + (inputs.statedProblem || '');
            inputs.visitorContext = vc;
            console.log('[VisitorIntel] Injected visitor context for', vc.companyName);
        }

        // Phase 2: Card-specific synthesis prompt injection
        let referralData = null;
        let cardCredits = 0;
        let visualCredits = 0;

        if (smartMode && cardType && cardType !== 'standard') {
            cardCredits = 85;

            // Card 5: Run referral calculator
            if (cardType === 'card5') {
                try {
                    const refInput = {
                        estimatedMonthlyCustomers: inputs.monthlyVisits || 100,
                        avgTransaction: inputs.avgTransaction || inputs.avgTicket || 100,
                        medianIncome: marketData?.demographics?.medianIncome || 60000,
                        industry: inputs.industry || inputs.subIndustry || 'default',
                    };
                    referralData = calculateReferralPotential(refInput);
                    console.log(`[Phase2] Referral calc complete: $${referralData.annualRevenueUnlocked}/yr potential`);
                } catch (refErr) {
                    console.warn('[Phase2] Referral calculator failed (non-blocking):', refErr.message);
                }
            }

            // Load injected library items
            let injectedIntelBlock = '';
            if (injectedLibraryItems.length > 0 && userId !== 'anonymous') {
                try {
                    const injectedParts = ['--- INJECTED INTELLIGENCE (free context) ---'];
                    for (const itemId of injectedLibraryItems.slice(0, 10)) {
                        const itemDoc = await db.collection('library').doc(userId).collection('items').doc(itemId).get();
                        if (itemDoc.exists) {
                            const itemData = itemDoc.data();
                            const title = itemData.title || itemData.name || 'Intel';
                            const content = (itemData.content || '').substring(0, 500);
                            injectedParts.push(`[${title}]: ${content}`);
                        }
                    }
                    injectedParts.push('--- END INJECTED INTELLIGENCE ---');
                    if (injectedParts.length > 2) {
                        injectedIntelBlock = injectedParts.join('\n');
                    }
                } catch (libErr) {
                    console.warn('[Phase2] Failed to load injected library items:', libErr.message);
                }
            }

            // Get card-specific synthesis prompt
            const cardPrompt = getSynthesisPrompt(cardType, deepEnrichment);

            if (cardPrompt || injectedIntelBlock) {
                const cardBlock = [];

                if (injectedIntelBlock) {
                    cardBlock.push(injectedIntelBlock);
                }

                if (cardPrompt) {
                    cardBlock.push('--- CARD SYNTHESIS INSTRUCTIONS ---');
                    cardBlock.push(cardPrompt);
                    if (cardType === 'card5' && referralData) {
                        cardBlock.push('--- REFERRAL CALCULATION DATA ---');
                        cardBlock.push(JSON.stringify(referralData, null, 2));
                    }
                    cardBlock.push('--- END CARD SYNTHESIS INSTRUCTIONS ---');
                }

                // Append card block after the prospect intelligence block
                prospectIntelligenceBlock = prospectIntelligenceBlock + '\n' + cardBlock.join('\n');
            }

            // Calculate visual style credits
            if (visualStyle === 'both') {
                visualCredits = 60;
            } else if (visualStyle === 'data-driven' || visualStyle === 'cinematic') {
                visualCredits = 35;
            }

            console.log(`[Phase2] Smart mode: card=${cardType}, visual=${visualStyle}, credits=${cardCredits + visualCredits}`);
        }

        // Phase 5C: Inject user-approved outline sections into the intelligence block
        if (outlineSections.length > 0) {
            const outlineBlock = [
                '--- USER-APPROVED PITCH OUTLINE ---',
                'The user has reviewed and approved the following section order. Structure the pitch to follow this outline exactly:',
                ...outlineSections.map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`),
                '--- END PITCH OUTLINE ---'
            ].join('\n');
            prospectIntelligenceBlock = prospectIntelligenceBlock + '\n' + outlineBlock;
            console.log(`[Phase5C] Outline injected: ${outlineSections.length} sections`);
        }

        // Sprint 4A: Fetch and inject L4 template if templateId is provided
        if (level === 4 && body.templateId) {
            try {
                const templateDb = getDb();
                // Try salesDocuments first (flat collection with userId field)
                let templateDoc = await templateDb.collection('salesDocuments').doc(body.templateId).get();
                let templateData = null;

                if (templateDoc.exists && templateDoc.data().userId === userId) {
                    templateData = templateDoc.data();
                } else {
                    // Fall back to library/{userId}/items
                    templateDoc = await templateDb.collection('library').doc(userId).collection('items').doc(body.templateId).get();
                    if (templateDoc.exists) {
                        templateData = templateDoc.data();
                    }
                }

                if (templateData) {
                    const templateContent = templateData.content || templateData.extractedText || templateData.rawText || '';
                    if (templateContent) {
                        const templateBlock = [
                            '',
                            '=== PITCH TEMPLATE — FOLLOW THIS STRUCTURE ===',
                            `Template type: ${body.templateType || 'custom'}`,
                            'CRITICAL: Follow this structure, section order, and tone exactly.',
                            'Adapt ALL content for the specific prospect. Never copy placeholder text verbatim.',
                            '',
                            templateContent.substring(0, 2000),
                            '=== END PITCH TEMPLATE ==='
                        ].join('\n');
                        prospectIntelligenceBlock = prospectIntelligenceBlock + '\n' + templateBlock;
                        console.log(`[L4] Template injected: ${body.templateType || 'custom'} for ${body.businessName || 'unknown'}`);
                    }
                }
            } catch (e) {
                console.warn('[L4] Template load failed:', e.message, '— generating without template');
            }
        }

        // Part B: Market Intel Pitch Context Bridge — fetch structured context from report (NON-BLOCKING)
        let marketIntelContext = null;
        if (body.useMarketIntelContext && body.marketIntelReportId) {
            try {
                const { buildMarketIntelPitchContext } = require('../services/marketIntelPitchContext');
                marketIntelContext = await buildMarketIntelPitchContext({
                    reportId: body.marketIntelReportId,
                    libraryItemId: body.libraryItemId || null,
                    selectedLeadId: body.selectedLeadId || null,
                    selectedLeadPlaceId: body.selectedLeadPlaceId || null,
                    selectedLeadName: body.selectedMarketLeadName || body.businessName || null,
                    selectedLeadWebsite: body.websiteUrl || body.website || null,
                    userId: userId
                });
                console.log(`[MarketIntelBridge] Context loaded — completeness: ${marketIntelContext.contextCompleteness}, lead: ${marketIntelContext.selectedLead?.businessName || 'none'}`);
            } catch (contextError) {
                console.warn('[PitchGen] Market Intel context failed (non-blocking):', contextError.message);
            }
        }

        // Append market intel context block to prospectIntelligenceBlock (does NOT replace it)
        if (marketIntelContext) {
            const mic = marketIntelContext;
            let contextBlock = '\n\n=== MARKET INTELLIGENCE CONTEXT ===\n';
            contextBlock += 'Use this market intelligence as trusted context. Do NOT contradict these data points.\n\n';

            // Language rules
            contextBlock += '--- LANGUAGE RULES ---\n';
            contextBlock += `Use "${mic.languageRules.competitorLanguage}" instead of "competitors".\n`;
            contextBlock += `Use "${mic.languageRules.opportunityLanguage}" instead of "opportunity gap".\n`;
            contextBlock += `Use "${mic.languageRules.audienceLanguage}" instead of "customers".\n`;
            if (mic.languageRules.avoidTerms.length > 0) {
                contextBlock += `AVOID: ${mic.languageRules.avoidTerms.join(', ')}.\n`;
            }

            // Thesis
            if (mic.thesis.thesis) {
                contextBlock += '\n--- STRATEGIC MARKET THESIS ---\n';
                contextBlock += mic.thesis.thesis + '\n';
                if (mic.thesis.gapLabel) contextBlock += `Gap Label: ${mic.thesis.gapLabel}\n`;
                if (mic.thesis.pitchFrame) contextBlock += `Pitch Frame: ${mic.thesis.pitchFrame}\n`;
            }

            // Selected lead
            if (mic.selectedLead) {
                contextBlock += '\n--- SELECTED PROSPECT ---\n';
                contextBlock += `Business: ${mic.selectedLead.businessName}\n`;
                if (mic.selectedLead.rating !== null && mic.selectedLead.rating !== undefined)
                    contextBlock += `Rating: ${mic.selectedLead.rating}\u2605\n`;
                if (mic.selectedLead.reviews !== null && mic.selectedLead.reviews !== undefined)
                    contextBlock += `Reviews: ${mic.selectedLead.reviews}\n`;
                if (mic.selectedLead.opportunityScore !== null && mic.selectedLead.opportunityScore !== undefined)
                    contextBlock += `Opportunity Score: ${mic.selectedLead.opportunityScore}/100\n`;
                if (mic.selectedLead.whyThisBusiness)
                    contextBlock += `Why This Business: ${mic.selectedLead.whyThisBusiness}\n`;
                if (mic.selectedLead.primaryGap)
                    contextBlock += `Primary Gap: ${mic.selectedLead.primaryGap}\n`;
            }

            // Benchmarks
            if (mic.benchmarks.marketAvgRating !== null) {
                contextBlock += '\n--- MARKET BENCHMARKS ---\n';
                contextBlock += `Market Avg Rating: ${mic.benchmarks.marketAvgRating}\u2605\n`;
                contextBlock += `Market Avg Reviews: ${mic.benchmarks.marketAvgReviews}\n`;
                if (mic.benchmarks.leaderName)
                    contextBlock += `Leader: ${mic.benchmarks.leaderName} (${mic.benchmarks.leaderReviewCount} reviews)\n`;
                contextBlock += `Total Competitors: ${mic.benchmarks.totalCompetitors}\n`;
            }

            // Roadmap (capped at 4)
            if (mic.roadmap.length > 0) {
                contextBlock += '\n--- STRATEGIC ROADMAP ---\n';
                for (const phase of mic.roadmap.slice(0, 4)) {
                    contextBlock += `Phase ${phase.phase} (${phase.name}, ${phase.timeframe}): ${phase.focus}\n`;
                    if (phase.pathsynchProduct) contextBlock += `  Product: ${phase.pathsynchProduct}\n`;
                }
            }

            // KPIs (capped at 6)
            if (mic.kpis.length > 0) {
                contextBlock += '\n--- KPI TARGETS ---\n';
                for (const kpi of mic.kpis.slice(0, 6)) {
                    contextBlock += `${kpi.kpi}: Current ${kpi.currentValue}, Target ${kpi.target || 'See roadmap'}\n`;
                }
            }

            // Angle
            contextBlock += '\n--- RECOMMENDED ANGLE ---\n';
            contextBlock += `Primary: ${mic.recommendedPitch.primaryAngle}\n`;
            contextBlock += `CTA: ${mic.recommendedPitch.recommendedCTA}\n`;

            contextBlock += '\n=== END MARKET INTELLIGENCE CONTEXT ===\n';
            contextBlock += '\nCONTEXT PRIORITY: Prioritize in order: 1) Selected lead data, 2) Thesis/gap, 3) Benchmarks, 4) KPI targets, 5) Roadmap, 6) Product catalog, 7) Generic defaults.\n';
            contextBlock += 'Do NOT let generic templates override specific Market Intelligence findings.\n';

            // APPEND to existing prospectIntelligenceBlock — do NOT replace it
            prospectIntelligenceBlock += contextBlock;
        }

        // Now generate library-enhanced content (with enrichment intelligence)
        if (salesLibraryContext?.documents?.length > 0) {
            console.log(`Custom sales library found: ${salesLibraryContext.documents.length} documents for ${salesLibraryContext.companyName}`);
            libraryEnhancedContent = await generateLibraryEnhancedContent(
                salesLibraryContext,
                inputs,
                sellerContext,
                level,
                ragChunks,
                prospectIntelligenceBlock,
                cardType
            );
            if (libraryEnhancedContent) {
                console.log('AI-enhanced content generated from sales library');
            }
        } else if (ragChunks.length > 0) {
            libraryEnhancedContent = await generateLibraryEnhancedContent(
                { documents: [], companyName: sellerContext.companyName || '' },
                inputs,
                sellerContext,
                level,
                ragChunks,
                prospectIntelligenceBlock,
                cardType
            );
            if (libraryEnhancedContent) {
                console.log('AI-enhanced content generated from RAG chunks (no full library docs)');
            }
        } else if (prospectIntelligenceBlock && prospectIntelligenceBlock.includes('CARD SYNTHESIS INSTRUCTIONS')) {
            // Smart Mode card selected but no library docs or RAG — still run AI synthesis
            // so card-specific instructions reach the AI model
            libraryEnhancedContent = await generateLibraryEnhancedContent(
                { documents: [], companyName: sellerContext.companyName || '' },
                inputs,
                sellerContext,
                level,
                [],
                prospectIntelligenceBlock,
                cardType
            );
            if (libraryEnhancedContent) {
                console.log('[Phase2] AI-enhanced content generated from card synthesis instructions (no library/RAG)');
            }
        }

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
            sellerContext: sellerContext,
            // Custom sales library data (if available)
            salesLibraryContext: salesLibraryContext,
            libraryEnhancedContent: libraryEnhancedContent,
            useCustomLibrary: !!libraryEnhancedContent,
            // Style variant (standard, visual_summary, battlecard, etc.)
            style: validatedStyle,
            // Feature 2: Prospect enrichment data
            prospectEnrichment: prospectEnrichment,
            // Sprint 3+4: Deep enrichment intelligence block
            prospectIntelligenceBlock: prospectIntelligenceBlock,
            deepEnrichment: deepEnrichment,
            // Sprint 4A: L4 template selection
            templateId: body.templateId || null,
            templateType: body.templateType || null,
            // Phase 2: Smart Mode card type for card-specific rendering
            cardType: cardType,
            // Template pipeline: pass outreachType for template selection
            outreachType: outreachType,
            // L2 style variant for template renderer (e.g. 'executive_brief', 'roi_snapshot')
            // Derived from explicit body.l2Style first, then body.style (the style card value)
            l2Style: body.l2Style || (body.style && body.style !== 'standard' ? body.style : null)
        };

        // L4 hard gate: if Sales Library AI synthesis failed, do NOT silently render L2.
        // Better to tell the user something went wrong than serve a generic pitch.
        if (level === 4 && !libraryEnhancedContent) {
            console.error(`[L4] Hard gate: libraryEnhancedContent is null for level=4, userId=${userId}`);
            return res.status(422).json({
                success: false,
                error: 'Unable to process your Sales Library documents. Please try again or check that your uploaded documents contain readable text.'
            });
        }

        // Generate IDs first (needed for tracking in generated HTML)
        const pitchId = generateId();
        const shareId = generateId();

        // Generate HTML based on level (with optional market data and pitchId for tracking)
        let html;
        let templateOnePagerResult = null;
        switch (level) {
            case 1:
                html = generateLevel1(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 2:
                // Template-driven pipeline: attempt template-based generation first.
                // Falls back to legacy generateLevel2 if no template found or pipeline errors.
                try {
                    // FIX 2: L2 stat card debug — log rating/review inputs before template pipeline
                    console.log('[L2 STAT DEBUG] Before generateTemplateOnePager — googleRating:', inputs.googleRating,
                        '| numReviews:', inputs.numReviews,
                        '| source:', inputs.source || 'direct');
                    templateOnePagerResult = await generateTemplateOnePager(inputs, options, userId);
                } catch (tmplErr) {
                    console.error('[TemplateOnePager] Pipeline error (falling back to legacy L2):', tmplErr.message);
                    templateOnePagerResult = null;
                }
                if (templateOnePagerResult && templateOnePagerResult.html) {
                    html = templateOnePagerResult.html;
                    console.log(`[TemplateOnePager] Used template: ${templateOnePagerResult.templateId}`);
                } else {
                    html = generateLevel2(inputs, reviewData, roiData, options, marketData, pitchId);
                }
                break;
            case 4:
                html = generateLevel4(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 3:
            default:
                html = generateLevel3(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
        }

        // Phase 4: Visual engines (skip for L1 outreach sequences)
        let visuals = { dataViz: null, heroImage: null };
        if (level !== 1 && visualStyle && visualStyle !== 'none') {
            try {
                visuals = await generateVisuals({
                    cardType,
                    visualStyle,
                    enrichmentData: deepEnrichment,
                    pitchContent: html,
                    businessName: inputs.businessName,
                    industry: inputs.industry || null,
                    city: inputs.address ? inputs.address.split(',')[0].trim() : null,
                    primaryColor: body.primaryColor || '#0D9488',
                    accentColor: body.accentColor || '#F59E0B',
                    userId,
                    pitchId
                });
            } catch (err) {
                console.error('[VisualEngine] Failed:', err.message);
            }
        }

        // FIX 2: Zero visual credits for L1 (visuals never run for L1)
        if (level === 1) {
            visualCredits = 0;
        }

        // Generate LinkedIn warm-up posts if requested (Growth+ only)
        let linkedInPosts = null;
        const includeLinkedInPosts = body.includeLinkedInPosts === true;
        if (includeLinkedInPosts && LINKEDIN_POSTS_TIERS.includes(userTier)) {
            console.log(`Generating LinkedIn posts for pitch ${pitchId}`);
            linkedInPosts = await generateLinkedInPosts(inputs, sellerContext);
            if (linkedInPosts) {
                console.log(`Generated ${linkedInPosts.length} LinkedIn posts`);
            }
        } else if (includeLinkedInPosts && !LINKEDIN_POSTS_TIERS.includes(userTier)) {
            console.log(`LinkedIn posts requested but user tier ${userTier} does not have access`);
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
            style: validatedStyle,

            // Generated content
            html,
            roiData,
            reviewAnalysis: reviewData,
            reviewAnalytics: reviewData.analytics || null,
            reviewPitchMetrics: reviewData.pitchMetrics || null,

            // Template-driven One-Pager metadata (L2 only)
            templateMeta: templateOnePagerResult ? {
                templateId: templateOnePagerResult.templateId,
                templateName: templateOnePagerResult.templateName,
                generatedWithTemplate: true,
                aiFieldCount: templateOnePagerResult.aiFieldCount || 0,
                enrichmentMeta: templateOnePagerResult.enrichmentMeta || {}
            } : null,

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

            // Custom sales library data (Enterprise feature)
            salesLibrary: salesLibraryContext ? {
                companyName: salesLibraryContext.companyName,
                documentCount: salesLibraryContext.documents?.length || 0,
                usedLibrary: !!libraryEnhancedContent
            } : null,

            // Sprint 3+4: Enrichment metadata + Phase 2: Card credit tracking
            pitchMetadata: {
                enrichment: deepEnrichment ? {
                    sourcesUsed: deepEnrichment.sourcesUsed || [],
                    creditsUsed: deepEnrichment.creditsUsed || 0,
                    elapsed: deepEnrichment.elapsed || 0,
                    enrichedAt: deepEnrichment.enrichedAt || null,
                } : null,
                // Phase 2: Smart mode card tracking
                smartMode: smartMode || false,
                cardType: cardType || 'standard',
                visualStyle: visualStyle || 'none',
                cardCredits: cardCredits,
                visualCredits: visualCredits,
                totalCredits: (deepEnrichment?.creditsUsed || 0) + cardCredits + visualCredits,
            },

            // Form data (for re-generation)
            formData: body,

            // Phase 4: Visual assets
            visuals: {
                dataViz: visuals.dataViz || null,
                heroImage: visuals.heroImage || null
            },

            // LinkedIn warm-up posts (Growth+ feature)
            linkedInPosts: linkedInPosts || null,
            includeLinkedInPosts: includeLinkedInPosts,

            // Status (pipeline: Draft → Sent → Viewed → Replied)
            status: 'Draft',
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

        // Part B: Store market intel source metadata on pitch document (B-4)
        if (marketIntelContext) {
            pitchData.source = 'market_intel';
            pitchData.marketIntelReportId = marketIntelContext.reportId;
            pitchData.libraryItemId = marketIntelContext.libraryItemId;
            pitchData.selectedMarketLeadName = marketIntelContext.selectedLead?.businessName || null;
            pitchData.marketIntelContextCompleteness = marketIntelContext.contextCompleteness;
            pitchData.gapLabel = marketIntelContext.thesis?.gapLabel || null;
            pitchData.industryId = marketIntelContext.market?.industryId || null;
            pitchData.subIndustryId = marketIntelContext.market?.subIndustryId || null;
        }

        // Save to Firestore
        await db.collection('pitches').doc(pitchId).set(pitchData);

        // Increment user's pitch count
        if (userId !== 'anonymous') {
            await incrementPitchCount(userId);
        }

        console.log(`Created pitch ${pitchId} for user ${userId} (Level ${level})`);

        // Phase 2: Auto-save to library for cards 3, 4, 5
        if (smartMode && ['card3', 'card4', 'card5'].includes(cardType) && userId !== 'anonymous') {
            const cardSubTypes = { card3: 'market', card4: 'brief', card5: 'referral' };
            const cardLabels = { card3: 'Market Opportunity', card4: 'Pre-Call Brief', card5: 'Referral Analysis' };
            try {
                const libraryItemId = generateId();
                await db.collection('library').doc(userId).collection('items').doc(libraryItemId).set({
                    type: 'intel',
                    subType: cardSubTypes[cardType],
                    title: (inputs.businessName || 'Prospect') + ' — ' + cardLabels[cardType],
                    industry: inputs.industry || null,
                    city: inputs.address?.split(',')[0]?.trim() || null,
                    content: html ? html.substring(0, 10000) : null,
                    pitchId: pitchId,
                    creditsUsed: 85,
                    usageCount: 0,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Phase2] Auto-saved ${cardType} to library/${userId}/items/${libraryItemId}`);
            } catch (libSaveErr) {
                console.warn('[Phase2] Library auto-save failed (non-blocking):', libSaveErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            pitchId,
            shareId,
            level,
            businessName: inputs.businessName,
            generatedWithTemplate: templateOnePagerResult ? true : false,
            templateId: templateOnePagerResult?.templateId || null,
            verticalConfig: verticalConfig ? {
                key: verticalConfig.key,
                industryName: verticalConfig.industryName,
                pitchAngle: verticalConfig.pitchAngle,
                recommendedProducts: verticalConfig.recommendedProducts
            } : null
        });

    } catch (error) {
        console.error('Error generating pitch:', error);
        console.error('Error stack:', error.stack);
        console.error('Request body keys:', Object.keys(req.body || {}));
        return res.status(500).json({
            success: false,
            message: 'Failed to generate pitch',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

        // Vertical detection for batch path
        const verticalConfig = detectVertical(inputs.industry, inputs.subIndustry, inputs.businessName);
        const verticalContextBlock = buildVerticalContext(verticalConfig);
        if (verticalConfig) {
            console.log(`[Vertical] Detected (batch): ${verticalConfig.key} for ${inputs.businessName || 'unknown'}`);
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

        // Fetch Sales Library context for L4 (and optionally for other levels)
        let salesLibraryContext = null;
        let libraryEnhancedContent = null;
        if (userId && userId !== 'anonymous') {
            try {
                salesLibraryContext = await fetchSalesLibraryContext(userId);
            } catch (e) {
                console.log('Could not fetch sales library in generatePitchDirect:', e.message);
            }
        }

        // L4 requires Sales Library — fail early with clear message
        if (level === 4 && (!salesLibraryContext || !salesLibraryContext.documents?.length)) {
            return {
                success: false,
                error: 'L4 pitches require uploaded Sales Library documents. Please upload your sales materials in the Library tab first.'
            };
        }

        // Sprint 4A: Fetch and inject L4 template for batch path
        let templateBlock = '';
        if (level === 4 && data.templateId) {
            try {
                let templateDoc = await db.collection('salesDocuments').doc(data.templateId).get();
                let templateData = null;

                if (templateDoc.exists && templateDoc.data().userId === userId) {
                    templateData = templateDoc.data();
                } else {
                    templateDoc = await db.collection('library').doc(userId).collection('items').doc(data.templateId).get();
                    if (templateDoc.exists) {
                        templateData = templateDoc.data();
                    }
                }

                if (templateData) {
                    const templateContent = templateData.content || templateData.extractedText || templateData.rawText || '';
                    if (templateContent) {
                        templateBlock = [
                            '',
                            '=== PITCH TEMPLATE — FOLLOW THIS STRUCTURE ===',
                            `Template type: ${data.templateType || 'custom'}`,
                            'CRITICAL: Follow this structure, section order, and tone exactly.',
                            'Adapt ALL content for the specific prospect. Never copy placeholder text verbatim.',
                            '',
                            templateContent.substring(0, 2000),
                            '=== END PITCH TEMPLATE ==='
                        ].join('\n');
                        console.log(`[L4] Template injected (batch): ${data.templateType || 'custom'} for ${data.businessName || 'unknown'}`);
                    }
                }
            } catch (e) {
                console.warn('[L4] Template load failed (batch):', e.message);
            }
        }

        // Generate library-enhanced content if Sales Library exists
        const batchIntelBlock = (verticalContextBlock || '') + (templateBlock ? '\n' + templateBlock : '');
        if (salesLibraryContext?.documents?.length > 0) {
            try {
                libraryEnhancedContent = await generateLibraryEnhancedContent(
                    salesLibraryContext, inputs, sellerContext, level, [], batchIntelBlock
                );
            } catch (e) {
                console.log('Library-enhanced content failed in generatePitchDirect:', e.message);
            }
        }

        // Options - prefer seller profile values
        const options = {
            bookingUrl: data.bookingUrl || null,
            hideBranding: data.hideBranding || false,
            primaryColor: data.primaryColor || sellerContext.primaryColor || '#3A6746',
            accentColor: data.accentColor || sellerContext.accentColor || '#D4A847',
            companyName: data.companyName || sellerContext.companyName || 'PathSynch',
            contactEmail: data.contactEmail || 'hello@pathsynch.com',
            logoUrl: data.logoUrl || sellerContext.logoUrl || null,
            sellerContext: sellerContext,
            salesLibraryContext: salesLibraryContext,
            libraryEnhancedContent: libraryEnhancedContent,
            useCustomLibrary: !!libraryEnhancedContent
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
            case 4:
                html = generateLevel4(inputs, reviewData, roiData, options, null, pitchId);
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
            status: 'Draft',
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

// ============================================
// PHASE 5C: OUTLINE-FIRST GENERATION
// ============================================

/**
 * Generate a section outline before full pitch creation.
 * Returns an array of sections the user can reorder/edit before committing credits.
 *
 * POST /generate-outline
 */
async function generateOutline(req, res) {
    try {
        const body = req.body;
        const userId = req.userId || 'anonymous';

        const businessName = body.businessName || body.smartPrompt || 'Business';
        const industry = body.industry || null;
        const level = parseInt(body.pitchLevel) || 2;
        const cardType = body.cardType || 'standard';
        const goal = body.goal || '';
        const smartPrompt = body.smartPrompt || '';

        // Build the outline prompt based on pitch level
        let sectionGuidance;
        if (level === 1) {
            sectionGuidance = `Generate 4-6 sections for an outreach email pitch. Typical sections:
- Hook / Opening Line
- Pain Point Identification
- Solution Overview
- Social Proof / Credibility
- Call to Action
- P.S. Line (optional)`;
        } else if (level === 2 || level === 4) {
            sectionGuidance = `Generate 5-8 sections for a one-pager sales document. Typical sections:
- Headline & Hook
- Problem Statement
- Solution Overview
- Key Benefits / Value Props
- ROI / Metrics
- Social Proof
- Pricing Overview (optional)
- Call to Action`;
        } else {
            sectionGuidance = `Generate 8-12 sections for a full enterprise pitch deck. Typical sections:
- Title Slide
- Executive Summary
- Market Landscape / Problem
- Solution Overview
- How It Works
- ROI Analysis
- Case Study / Social Proof
- Implementation Timeline
- Pricing & Packages
- Competitive Advantage
- Next Steps
- Closing / Contact`;
        }

        // Card-specific context
        let cardContext = '';
        if (cardType && cardType !== 'standard') {
            const cardNames = {
                card1: 'Deep Business Analysis',
                card2: 'Competitor Landscape',
                card3: 'Growth Opportunity Audit',
                card4: 'Online Presence Score',
                card5: 'Referral Revenue Calculator',
                card6: 'Market Position Analysis'
            };
            cardContext = `\nThe pitch uses the "${cardNames[cardType] || cardType}" analysis card, so include a section specifically for that analysis.`;
        }

        const systemPrompt = `You are a sales pitch architect. Generate a section outline for a pitch presentation.

Return a JSON array of section objects. Each section has:
- "id": a short snake_case identifier (e.g. "problem_statement")
- "title": display title (e.g. "The Challenge You're Facing")
- "description": one sentence describing what this section covers

${sectionGuidance}${cardContext}

${goal ? `The pitch goal is: ${goal}` : ''}

Respond ONLY with a valid JSON array. No markdown, no explanation.`;

        const userMessage = `Business: ${businessName}${industry ? `\nIndustry: ${industry}` : ''}${smartPrompt ? `\nContext: ${smartPrompt}` : ''}`;

        const response = await geminiClient.sendMessage({
            systemPrompt,
            userMessage,
            maxTokens: 1024,
            temperature: 0.7
        });

        // Parse AI response
        let sections = [];
        try {
            const text = response.text || response.content || response;
            const cleaned = (typeof text === 'string' ? text : JSON.stringify(text))
                .replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            sections = JSON.parse(cleaned);

            if (!Array.isArray(sections)) {
                throw new Error('Response is not an array');
            }

            // Validate and sanitize each section
            sections = sections.slice(0, 15).map((s, i) => ({
                id: (s.id || `section_${i + 1}`).replace(/[^a-z0-9_]/g, '_').substring(0, 50),
                title: String(s.title || `Section ${i + 1}`).substring(0, 200),
                description: String(s.description || '').substring(0, 500)
            }));
        } catch (parseErr) {
            console.error('[Outline] Failed to parse AI response:', parseErr.message);
            // Return sensible defaults instead of failing
            sections = getDefaultOutline(level);
        }

        return res.status(200).json({
            success: true,
            sections,
            pitchLevel: level,
            businessName
        });

    } catch (error) {
        console.error('[Outline] Error generating outline:', error);

        // Graceful fallback — return default outline so the user isn't stuck
        const level = parseInt(req.body?.pitchLevel) || 2;
        return res.status(200).json({
            success: true,
            sections: getDefaultOutline(level),
            pitchLevel: level,
            businessName: req.body?.businessName || 'Business',
            fallback: true
        });
    }
}

/**
 * Default outline sections per level (used when AI fails)
 */
function getDefaultOutline(level) {
    if (level === 1) {
        return [
            { id: 'hook', title: 'Opening Hook', description: 'Personalized opening referencing their business' },
            { id: 'pain_point', title: 'Pain Point', description: 'The core challenge they face' },
            { id: 'solution', title: 'Solution Overview', description: 'How you solve their problem' },
            { id: 'proof', title: 'Social Proof', description: 'Credibility markers and results' },
            { id: 'cta', title: 'Call to Action', description: 'Clear next step' }
        ];
    } else if (level === 2 || level === 4) {
        return [
            { id: 'headline', title: 'Headline & Hook', description: 'Attention-grabbing headline' },
            { id: 'problem', title: 'Problem Statement', description: 'Their specific challenge' },
            { id: 'solution', title: 'Solution Overview', description: 'How you solve it' },
            { id: 'benefits', title: 'Key Benefits', description: 'Top value propositions with metrics' },
            { id: 'roi', title: 'ROI Analysis', description: 'Projected return on investment' },
            { id: 'proof', title: 'Social Proof', description: 'Case studies and testimonials' },
            { id: 'cta', title: 'Call to Action', description: 'Clear next step to engage' }
        ];
    } else {
        return [
            { id: 'title', title: 'Title Slide', description: 'Opening slide with business name' },
            { id: 'executive_summary', title: 'Executive Summary', description: 'High-level overview' },
            { id: 'market_landscape', title: 'Market Landscape', description: 'Industry context and trends' },
            { id: 'problem', title: 'The Challenge', description: 'Core business problem' },
            { id: 'solution', title: 'Solution Overview', description: 'How you solve it' },
            { id: 'how_it_works', title: 'How It Works', description: 'Implementation details' },
            { id: 'roi', title: 'ROI Analysis', description: 'Financial projections' },
            { id: 'case_study', title: 'Case Study', description: 'Relevant success story' },
            { id: 'timeline', title: 'Implementation Timeline', description: '90-day rollout plan' },
            { id: 'pricing', title: 'Pricing & Packages', description: 'Package options' },
            { id: 'next_steps', title: 'Next Steps', description: 'Clear action items' },
            { id: 'closing', title: 'Closing', description: 'Contact information' }
        ];
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
    generateLevel4,
    calculateROI,
    generateOutline
};
