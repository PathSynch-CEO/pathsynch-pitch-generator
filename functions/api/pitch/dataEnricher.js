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
const precallFormService = require('../../services/precallForm');

// Local Firestore reference helper
function getDb() {
    return admin.firestore();
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

    return `
=== CUSTOM SALES LIBRARY MODE ===

You are generating a pitch for ${salesLibraryContext.companyName || 'the seller'},
a company in ${salesLibraryContext.industry || 'their industry'} that sells to ${salesLibraryContext.sellingTo || 'their target market'}.

IMPORTANT INSTRUCTIONS:
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

=== SELLER'S PROPRIETARY SALES MATERIALS ===

${documentsBlock}

=== END SELLER MATERIALS ===

Now generate the pitch for the following prospect:
`;
}

module.exports = {
    buildSellerContext,
    getPrecallFormEnhancement,
    enhanceInputsWithPrecallData,
    fetchSalesLibraryContext,
    prepareSalesLibraryForPrompt,
    buildSalesLibraryPromptBlock
};
