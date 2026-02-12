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

module.exports = {
    buildSellerContext,
    getPrecallFormEnhancement,
    enhanceInputsWithPrecallData
};
