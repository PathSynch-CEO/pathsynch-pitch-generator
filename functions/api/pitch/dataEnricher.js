/**
 * Data Enricher Module
 *
 * Handles data transformation and enrichment for pitch generation.
 * Includes seller context building, pre-call form integration, and input enhancement.
 * Extracted from pitchGenerator.js as part of the modular refactoring effort.
 *
 * @module pitch/dataEnricher
 */

const admin = require('firebase-admin');
const axios = require('axios');
const precallFormService = require('../../services/precallForm');
const googlePlaces = require('../../services/googlePlaces');

// Local Firestore reference helper
function getDb() {
    return admin.firestore();
}

/**
 * Validate and normalize a URL to ensure it's a valid absolute URL
 * @param {string|null} url - URL to validate
 * @returns {string|null} Valid absolute URL or null
 */
function validateImageUrl(url) {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    // Must be an absolute URL with http(s) protocol
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return null;
    }

    // Basic URL validation
    try {
        new URL(trimmed);
        return trimmed;
    } catch (e) {
        return null;
    }
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
        logoUrl: validateImageUrl(sellerProfile.branding?.logoUrl),
        tone: sellerProfile.branding?.tone || 'professional',
        isDefault: false
    };
}

/**
 * Fetch and process pre-call form data for pitch enhancement
 * @param {string} precallFormId - The pre-call form ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object|null>} Enhanced pitch data from form responses
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

/**
 * Fetch sales library context for custom pitch generation
 * Used when seller has uploaded proprietary sales materials
 * @param {string} userId - Firebase UID
 * @returns {Promise<Object|null>} Sales library context or null if not enabled
 */
async function fetchSalesLibraryContext(userId) {
    if (!userId) return null;

    try {
        const db = getDb();

        // Check if user has library enabled
        const configDoc = await db.collection('customerLibraryConfig').doc(userId).get();
        if (!configDoc.exists || !configDoc.data().libraryEnabled) {
            return null;
        }

        // Fetch all ready documents
        const docsSnapshot = await db.collection('salesDocuments')
            .where('userId', '==', userId)
            .where('status', '==', 'ready')
            .orderBy('uploadedAt', 'desc')
            .get();

        if (docsSnapshot.empty) return null;

        const config = configDoc.data();
        const documents = docsSnapshot.docs.map(doc => ({
            id: doc.id,
            fileName: doc.data().fileName,
            documentType: doc.data().documentType,
            documentLabel: doc.data().documentLabel,
            extractedText: doc.data().extractedText,
            wordCount: doc.data().wordCount
        }));

        return {
            companyName: config.companyName,
            companyWebsite: config.companyWebsite,
            industry: config.industry,
            sellingTo: config.sellingTo,
            qualificationCriteria: config.qualificationCriteria || [],
            customTargetTitles: config.customTargetTitles || [],
            roiFramework: config.roiFramework || null,
            documents
        };
    } catch (error) {
        console.error('Error fetching sales library context:', error);
        return null;
    }
}

/**
 * Document priority for truncation (most important first)
 */
const DOCUMENT_PRIORITY = {
    'business_case': 1,
    'pitch_deck': 2,
    'one_pager': 3,
    'case_study': 4,
    'conference_deck': 5,
    'sales_process': 6,
    'other': 7
};

/**
 * Prepare sales library documents for AI prompt with token budget management
 * Prioritizes documents and truncates to fit within token limit
 * @param {Object} salesLibraryContext - The sales library context
 * @param {number} maxTokens - Maximum tokens to allocate (default 8000)
 * @returns {Array} Array of documents prepared for prompt
 */
function prepareSalesLibraryForPrompt(salesLibraryContext, maxTokens = 8000) {
    if (!salesLibraryContext?.documents?.length) return [];

    const maxChars = maxTokens * 4; // ~4 chars per token estimate

    // Sort by priority (most important first)
    const sorted = [...salesLibraryContext.documents].sort((a, b) =>
        (DOCUMENT_PRIORITY[a.documentType] || 99) - (DOCUMENT_PRIORITY[b.documentType] || 99)
    );

    let totalChars = 0;
    const included = [];

    for (const doc of sorted) {
        const textLength = doc.extractedText?.length || 0;

        if (totalChars + textLength <= maxChars) {
            // Include full document
            included.push(doc);
            totalChars += textLength;
        } else {
            // Partial inclusion
            const remaining = maxChars - totalChars;
            if (remaining > 1000) { // Minimum useful content
                included.push({
                    ...doc,
                    extractedText: doc.extractedText.substring(0, remaining) +
                        '\n[... document truncated for length ...]',
                    truncated: true
                });
            }
            break;
        }
    }

    return included;
}

/**
 * Build the AI prompt block for custom sales library
 * @param {Object} salesLibraryContext - The sales library context
 * @param {number} maxTokens - Maximum tokens for library content
 * @returns {string} Formatted prompt block to prepend to AI request
 */
function buildSalesLibraryPromptBlock(salesLibraryContext, maxTokens = 8000) {
    if (!salesLibraryContext?.documents?.length) return '';

    const preparedDocs = prepareSalesLibraryForPrompt(salesLibraryContext, maxTokens);

    if (preparedDocs.length === 0) return '';

    const documentsBlock = preparedDocs.map(doc =>
        `--- ${doc.documentLabel || doc.fileName} (${doc.documentType}) ---\n${doc.extractedText}`
    ).join('\n\n');

    // Build custom target titles section (if provided)
    let targetTitlesBlock = '';
    if (salesLibraryContext.customTargetTitles?.length > 0) {
        const titles = salesLibraryContext.customTargetTitles
            .sort((a, b) => (a.priority || 99) - (b.priority || 99))
            .map(t => {
                const priorityLabel = t.priority === 1 ? 'Primary' : t.priority === 2 ? 'Secondary' : 'Tertiary';
                return `- ${t.title} (${priorityLabel})${t.notes ? ` — ${t.notes}` : ''}`;
            }).join('\n');

        targetTitlesBlock = `
=== SELLER'S TARGET DECISION MAKERS ===
The seller has specified their target decision-maker titles. Use ONLY these titles
when referencing who to contact. Do NOT suggest other titles.

${titles}

`;
    }

    // Build qualification criteria section (if provided)
    let qualCriteriaBlock = '';
    if (salesLibraryContext.qualificationCriteria?.length > 0) {
        const criteria = salesLibraryContext.qualificationCriteria.map(c => {
            let line = `- ${c.criteriaName}`;
            if (c.criteriaDescription) line += `: ${c.criteriaDescription}`;
            if (c.dataSource) line += ` (Data source: ${c.dataSource})`;
            if (c.importance) line += ` [${c.importance}]`;
            return line;
        }).join('\n');

        qualCriteriaBlock = `
=== SELLER'S QUALIFICATION CRITERIA ===
The seller has defined specific qualification criteria that matter for their sales
process. Use these criteria when building the value proposition and pain point sections.
Do NOT use generic industry pain points — use THESE specific criteria instead.

${criteria}

`;
    }

    // Build ROI framework section (if provided)
    let roiBlock = '';
    if (salesLibraryContext.roiFramework) {
        const roi = salesLibraryContext.roiFramework;
        const parts = [];
        if (roi.leakageAssumption) parts.push(`Leakage Assumption: ${roi.leakageAssumption}`);
        if (roi.savingsRange) parts.push(`Savings Range: ${roi.savingsRange}`);
        if (roi.financialLineItems?.length) {
            parts.push(`Financial Line Items to Reference: ${roi.financialLineItems.join(', ')}`);
        }
        if (roi.dataSourceInstructions) parts.push(`Data Source Instructions: ${roi.dataSourceInstructions}`);

        if (parts.length > 0) {
            roiBlock = `
=== SELLER'S ROI FRAMEWORK ===
When calculating ROI for this prospect, use the seller's ROI framework below.
If the prospect is publicly traded, reference their specific financial data using the
seller's specified line items. If the prospect is NOT publicly traded, suggest
discovery questions to uncover the relevant financial data.

${parts.join('\n')}

`;
        }
    }

    return `
=== CUSTOM SALES LIBRARY MODE ===

You are generating a pitch for ${salesLibraryContext.companyName || 'the seller'},
a company in ${salesLibraryContext.industry || 'their industry'} that sells to ${salesLibraryContext.sellingTo || 'their target market'}.

CRITICAL RULES:
1. The seller has uploaded their own proprietary sales materials below.
2. USE THESE MATERIALS as your PRIMARY source for:
   - Value propositions and positioning
   - ROI calculations and financial projections
   - Case studies and proof points
   - Pricing structure and investment framework
   - Technical capabilities and differentiators
   - Implementation methodology and timelines
3. Use the PROSPECT'S scraped website data for PERSONALIZATION:
   - Company name, size, and industry specifics
   - Their specific pain points and operational context
   - Adjust numbers proportionally to their scale
4. DO NOT invent ROI numbers or case studies. Use ONLY what the seller provides.
5. ADAPT the materials — do not copy-paste. If a document references
   "American Airlines", replace with the prospect's name. If it mentions
   "$2B annual catering budget", scale proportionally to the prospect.
6. Maintain the seller's professional tone and positioning.
7. Reference the seller's credibility markers (partnerships, accuracy metrics,
   client logos) naturally in the pitch.
8. For Level 1 emails, NEVER open with Google review ratings, star counts, or
   generic compliments. This is enterprise B2B, not local business outreach.
   Open with a specific business challenge the prospect likely faces, followed by
   a credibility statement using the seller's existing clients, followed by a
   specific value proposition with numbers.
9. DO NOT use generic pain points. If the seller has provided custom qualification
   criteria below, use those INSTEAD of AI-generated pain points.
10. The seller's product capabilities come from their uploaded materials, NOT from
    scraping their website. Use the materials — do not generate generic descriptions.

${targetTitlesBlock}${qualCriteriaBlock}${roiBlock}=== SELLER'S PROPRIETARY SALES MATERIALS ===

${documentsBlock}

=== END SELLER MATERIALS ===

Now generate the pitch for the following prospect:
`;
}

/**
 * Fetch and enrich prospect data from Google Places
 * @param {string} businessName - Prospect business name
 * @param {string} location - Business location (address, city, or coordinates)
 * @param {string} website - Optional business website
 * @returns {Promise<Object>} Enriched Google Places data
 */
async function fetchProspectPlacesData(businessName, location = null, website = null) {
    const result = {
        success: false,
        source: 'google_places',
        data: null
    };

    if (!businessName) return result;

    try {
        // Find the business in Google Places
        const locationResult = await googlePlaces.findCompanyLocation(businessName, website);

        if (!locationResult.success || !locationResult.placeId) {
            console.log('Could not find business in Google Places:', businessName);
            return result;
        }

        // Get detailed place information including reviews
        const details = await googlePlaces.getPlaceDetails(locationResult.placeId);

        if (!details.success) {
            return result;
        }

        const place = details.data;

        // Analyze review themes
        const reviewAnalysis = analyzeGoogleReviews(place.reviews || []);

        result.success = true;
        result.data = {
            // Basic info
            name: place.name,
            address: place.address,
            phone: place.phone,
            website: place.website,

            // Ratings & reviews
            rating: place.rating,
            reviewCount: place.reviewCount,
            priceLevel: place.priceLevel,

            // Business category
            businessCategory: place.types?.[0] || null,
            businessTypes: place.types || [],

            // Hours
            openingHours: place.openingHours?.weekday_text || null,
            isOpenNow: place.openingHours?.open_now || null,

            // Review analysis
            reviewThemes: reviewAnalysis.themes,
            positiveThemes: reviewAnalysis.positiveThemes,
            negativeThemes: reviewAnalysis.negativeThemes,
            customerConcerns: reviewAnalysis.concerns,

            // Raw reviews for reference
            topReviews: (place.reviews || []).slice(0, 3).map(r => ({
                rating: r.rating,
                text: r.text?.substring(0, 200) || ''
            }))
        };

        console.log('Successfully enriched prospect with Google Places data:', businessName);

    } catch (error) {
        console.error('Error fetching prospect Places data:', error.message);
    }

    return result;
}

/**
 * Analyze Google reviews to extract themes and concerns
 * @param {Array} reviews - Array of Google reviews
 * @returns {Object} Review analysis
 */
function analyzeGoogleReviews(reviews) {
    const analysis = {
        themes: [],
        positiveThemes: [],
        negativeThemes: [],
        concerns: []
    };

    if (!reviews || reviews.length === 0) return analysis;

    // Combine all review text
    const allText = reviews.map(r => (r.text || '').toLowerCase()).join(' ');

    // Positive theme keywords
    const positiveKeywords = {
        'service': ['great service', 'excellent service', 'friendly staff', 'helpful', 'professional'],
        'quality': ['high quality', 'excellent', 'amazing', 'best', 'outstanding'],
        'value': ['great value', 'worth it', 'reasonable price', 'good price', 'affordable'],
        'atmosphere': ['nice atmosphere', 'great ambiance', 'clean', 'welcoming', 'comfortable'],
        'speed': ['fast', 'quick', 'efficient', 'timely', 'prompt'],
        'recommend': ['recommend', 'will be back', 'come back', 'return']
    };

    // Negative theme keywords (pain point indicators)
    const negativeKeywords = {
        'wait_times': ['long wait', 'waited', 'slow service', 'took forever', 'too long'],
        'pricing': ['expensive', 'overpriced', 'too much', 'not worth'],
        'quality_issues': ['poor quality', 'disappointing', 'not good', 'terrible', 'worst'],
        'communication': ['no response', 'didn\'t call back', 'poor communication', 'never heard'],
        'staff_issues': ['rude', 'unprofessional', 'unfriendly', 'attitude'],
        'availability': ['not available', 'out of stock', 'couldn\'t get', 'booked up']
    };

    // Check positive themes
    for (const [theme, keywords] of Object.entries(positiveKeywords)) {
        if (keywords.some(kw => allText.includes(kw))) {
            analysis.positiveThemes.push(formatThemeName(theme));
        }
    }

    // Check negative themes (customer concerns / pain points)
    for (const [theme, keywords] of Object.entries(negativeKeywords)) {
        if (keywords.some(kw => allText.includes(kw))) {
            analysis.negativeThemes.push(formatThemeName(theme));
            analysis.concerns.push(formatConcern(theme));
        }
    }

    // Combine top themes
    analysis.themes = [...analysis.positiveThemes.slice(0, 3), ...analysis.negativeThemes.slice(0, 2)];

    return analysis;
}

/**
 * Format theme name for display
 */
function formatThemeName(theme) {
    const names = {
        'service': 'Great customer service',
        'quality': 'High quality products/services',
        'value': 'Good value for money',
        'atmosphere': 'Pleasant atmosphere',
        'speed': 'Fast and efficient',
        'recommend': 'Highly recommended',
        'wait_times': 'Long wait times',
        'pricing': 'Pricing concerns',
        'quality_issues': 'Quality inconsistencies',
        'communication': 'Communication gaps',
        'staff_issues': 'Staff training opportunities',
        'availability': 'Availability challenges'
    };
    return names[theme] || theme.replace(/_/g, ' ');
}

/**
 * Format concern as pain point
 */
function formatConcern(theme) {
    const concerns = {
        'wait_times': 'Customers mention wait times as a pain point',
        'pricing': 'Some customers feel pricing could be more competitive',
        'quality_issues': 'Quality consistency is an area for improvement',
        'communication': 'Customer communication could be enhanced',
        'staff_issues': 'Staff training may benefit the customer experience',
        'availability': 'Product/service availability is a challenge'
    };
    return concerns[theme] || `${formatThemeName(theme)} mentioned in reviews`;
}

/**
 * Fetch and extract intelligence from prospect website
 * @param {string} websiteUrl - Prospect website URL
 * @returns {Promise<Object>} Website intelligence
 */
async function fetchProspectWebsiteData(websiteUrl) {
    const result = {
        success: false,
        source: 'website',
        data: null
    };

    if (!websiteUrl) return result;

    try {
        // Normalize URL
        let url = websiteUrl.trim();
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        console.log('Scraping prospect website:', url);

        // Fetch the homepage
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 10000,
            maxRedirects: 3
        });

        const html = response.data;

        // Extract intelligence from HTML
        result.data = {
            // Headings reveal priorities
            headings: extractHeadings(html),

            // Products/services mentioned
            productServices: extractProductServices(html),

            // Blog topics (current focus areas)
            blogTopics: extractBlogTopics(html),

            // Job postings (growth areas)
            jobPostings: extractJobPostings(html),

            // Tech stack detection
            techStack: detectTechStack(html),

            // Primary CTA
            primaryCTA: extractPrimaryCTA(html),

            // Social links
            socialLinks: extractSocialLinks(html),

            // Meta description
            metaDescription: extractMetaDescription(html)
        };

        result.success = true;
        console.log('Successfully scraped prospect website');

    } catch (error) {
        console.warn('Website scraping failed:', error.message);
    }

    return result;
}

/**
 * Extract H1 and H2 headings from HTML
 */
function extractHeadings(html) {
    const headings = [];

    // H1 tags
    const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
    h1Matches.slice(0, 3).forEach(match => {
        const text = stripHtml(match).trim();
        if (text && text.length < 200) {
            headings.push(text);
        }
    });

    // H2 tags
    const h2Matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
    h2Matches.slice(0, 5).forEach(match => {
        const text = stripHtml(match).trim();
        if (text && text.length < 200 && !headings.includes(text)) {
            headings.push(text);
        }
    });

    return headings.slice(0, 6);
}

/**
 * Extract product/service mentions
 */
function extractProductServices(html) {
    const services = [];

    // Look for common product/service patterns
    const patterns = [
        /<li[^>]*class="[^"]*service[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
        /<div[^>]*class="[^"]*product[^"]*"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi,
        /<a[^>]*href="\/services\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    ];

    for (const pattern of patterns) {
        const matches = html.match(pattern) || [];
        matches.forEach(match => {
            const text = stripHtml(match).trim();
            if (text && text.length > 3 && text.length < 100 && !services.includes(text)) {
                services.push(text);
            }
        });
    }

    return services.slice(0, 8);
}

/**
 * Extract blog post titles
 */
function extractBlogTopics(html) {
    const topics = [];

    // Look for blog post patterns
    const patterns = [
        /<article[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi,
        /<a[^>]*href="[^"]*blog[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        /<div[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi
    ];

    for (const pattern of patterns) {
        const matches = html.match(pattern) || [];
        matches.forEach(match => {
            const text = stripHtml(match).trim();
            if (text && text.length > 10 && text.length < 150 && !topics.includes(text)) {
                topics.push(text);
            }
        });
    }

    return topics.slice(0, 5);
}

/**
 * Extract job posting titles
 */
function extractJobPostings(html) {
    const jobs = [];

    // Look for careers/jobs patterns
    const patterns = [
        /<a[^>]*href="[^"]*(?:careers|jobs)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        /<div[^>]*class="[^"]*job[^"]*"[^>]*>[\s\S]*?<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi,
        /<li[^>]*class="[^"]*position[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    ];

    for (const pattern of patterns) {
        const matches = html.match(pattern) || [];
        matches.forEach(match => {
            const text = stripHtml(match).trim();
            if (text && text.length > 5 && text.length < 100 && !jobs.includes(text)) {
                jobs.push(text);
            }
        });
    }

    return jobs.slice(0, 5);
}

/**
 * Detect technology stack from HTML
 */
function detectTechStack(html) {
    const tech = [];

    const detections = {
        'Shopify': /shopify\.com|cdn\.shopify/i,
        'WordPress': /wp-content|wordpress/i,
        'Squarespace': /squarespace/i,
        'Wix': /wix\.com|wixstatic/i,
        'Salesforce': /salesforce|pardot/i,
        'HubSpot': /hubspot|hs-scripts/i,
        'Marketo': /marketo|munchkin/i,
        'Google Analytics': /google-analytics|gtag|googletagmanager/i,
        'Intercom': /intercom/i,
        'Drift': /drift\.com/i,
        'Zendesk': /zendesk/i,
        'Stripe': /stripe\.com|js\.stripe/i,
        'React': /react|reactjs/i,
        'Vue.js': /vue\.js|vuejs/i,
        'Angular': /angular/i,
        'Bootstrap': /bootstrap/i,
        'Tailwind': /tailwind/i
    };

    for (const [name, pattern] of Object.entries(detections)) {
        if (pattern.test(html)) {
            tech.push(name);
        }
    }

    return tech.slice(0, 6);
}

/**
 * Extract primary CTA text
 */
function extractPrimaryCTA(html) {
    // Look for prominent CTA buttons
    const patterns = [
        /<a[^>]*class="[^"]*(?:cta|btn-primary|button-primary)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        /<button[^>]*class="[^"]*(?:cta|primary)[^"]*"[^>]*>([\s\S]*?)<\/button>/gi
    ];

    for (const pattern of patterns) {
        const matches = html.match(pattern) || [];
        for (const match of matches) {
            const text = stripHtml(match).trim();
            if (text && text.length > 3 && text.length < 50) {
                return text;
            }
        }
    }

    // Fallback: look for common CTA phrases
    const ctaPhrases = ['Get Started', 'Book Now', 'Schedule Demo', 'Contact Us', 'Free Trial', 'Learn More'];
    for (const phrase of ctaPhrases) {
        if (html.includes(phrase)) {
            return phrase;
        }
    }

    return null;
}

/**
 * Extract social media links
 */
function extractSocialLinks(html) {
    const social = {};

    const patterns = {
        linkedin: /href="(https?:\/\/(?:www\.)?linkedin\.com\/[^"]+)"/i,
        twitter: /href="(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"]+)"/i,
        facebook: /href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/i,
        instagram: /href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i,
        youtube: /href="(https?:\/\/(?:www\.)?youtube\.com\/[^"]+)"/i
    };

    for (const [platform, pattern] of Object.entries(patterns)) {
        const match = html.match(pattern);
        if (match) {
            social[platform] = match[1];
        }
    }

    return Object.keys(social).length > 0 ? social : null;
}

/**
 * Extract meta description
 */
function extractMetaDescription(html) {
    const match = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                  html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i);
    return match ? match[1].substring(0, 300) : null;
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Combine all prospect enrichment data
 * @param {string} businessName - Prospect business name
 * @param {string} location - Business location
 * @param {string} websiteUrl - Business website
 * @returns {Promise<Object>} Combined enrichment data with source tracking
 */
async function enrichProspectData(businessName, location = null, websiteUrl = null) {
    const enrichment = {
        sources: [],
        googlePlaces: null,
        website: null
    };

    // Fetch Google Places data
    const placesData = await fetchProspectPlacesData(businessName, location, websiteUrl);
    if (placesData.success) {
        enrichment.googlePlaces = placesData.data;
        enrichment.sources.push('google_places');
    }

    // Fetch website data
    const websiteData = await fetchProspectWebsiteData(websiteUrl || placesData.data?.website);
    if (websiteData.success) {
        enrichment.website = websiteData.data;
        enrichment.sources.push('website');
    }

    return enrichment;
}

module.exports = {
    buildSellerContext,
    getPrecallFormEnhancement,
    enhanceInputsWithPrecallData,
    fetchSalesLibraryContext,
    prepareSalesLibraryForPrompt,
    buildSalesLibraryPromptBlock,
    // Feature 2: Prospect enrichment
    fetchProspectPlacesData,
    fetchProspectWebsiteData,
    enrichProspectData,
    analyzeGoogleReviews
};
