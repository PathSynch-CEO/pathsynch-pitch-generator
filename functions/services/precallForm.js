/**
 * Pre-Call Form Service
 *
 * Manages pre-call qualification forms sent to prospects before meetings.
 * Enterprise-only feature that feeds prospect responses into pitch generation.
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Default form questions for pre-call qualification
 */
const DEFAULT_QUESTIONS = [
    {
        id: 'challenge',
        type: 'textarea',
        question: "What's your biggest challenge right now?",
        required: true,
        feedsInto: 'painPoints',
        placeholder: 'Describe the main problem you\'re trying to solve...'
    },
    {
        id: 'current_solution',
        type: 'multiselect',
        question: "What solutions have you tried or are currently using?",
        options: ['Spreadsheets/Manual process', 'Competitor software', 'Built in-house', 'Nothing yet'],
        customOption: true,
        feedsInto: 'competitiveContext'
    },
    {
        id: 'timeline',
        type: 'radio',
        question: "What's your timeline for making a decision?",
        options: ['This month', 'This quarter', '6+ months', 'Just exploring'],
        feedsInto: 'urgency',
        required: true
    },
    {
        id: 'stakeholders',
        type: 'text',
        question: "Who else will be involved in this decision?",
        required: false,
        feedsInto: 'stakeholders',
        placeholder: 'e.g., CEO, Operations Manager, Finance Director'
    },
    {
        id: 'budget',
        type: 'radio',
        question: "What's your approximate budget range?",
        options: ['Under $100/mo', '$100-300/mo', '$300-500/mo', '$500+/mo', 'Not sure yet'],
        feedsInto: 'pricing'
    },
    {
        id: 'priority_features',
        type: 'multiselect',
        question: "Which capabilities are most important to you?",
        options: [], // Populated from seller profile
        customOption: true,
        feedsInto: 'featurePriority'
    }
];

/**
 * Generate a unique share ID for the form
 */
function generateFormShareId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = 'pf_'; // prefix for pre-call form
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Create a new pre-call form
 * @param {string} userId - Creator's user ID
 * @param {Object} formData - Form configuration
 * @returns {Object} Created form data
 */
async function createForm(userId, formData) {
    const {
        prospectEmail,
        prospectName,
        pitchId = null,
        questions = null,
        customQuestions = [],
        expirationDays = 7
    } = formData;

    // Get user's seller profile for dynamic question options
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const sellerProfile = userData.sellerProfile || {};

    // Build questions list
    let formQuestions = questions || [...DEFAULT_QUESTIONS];

    // Populate priority_features options from seller's products
    formQuestions = formQuestions.map(q => {
        if (q.id === 'priority_features' && sellerProfile.products?.length > 0) {
            const features = [];
            sellerProfile.products.forEach(product => {
                if (product.features) {
                    features.push(...product.features.slice(0, 3));
                }
            });
            return {
                ...q,
                options: [...new Set(features)].slice(0, 6) // Dedupe and limit
            };
        }
        return q;
    });

    // Add custom questions if provided
    if (customQuestions.length > 0) {
        formQuestions = [...formQuestions, ...customQuestions];
    }

    const shareId = generateFormShareId();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    const formDoc = {
        userId,
        shareId,
        prospectEmail,
        prospectName,
        pitchId,
        questions: formQuestions,
        status: 'draft', // draft -> pending -> completed | expired
        responses: null,
        createdAt: now,
        updatedAt: now,
        sentAt: null,
        completedAt: null,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        sellerCompany: sellerProfile.companyProfile?.name || '',
        sellerName: userData.name || userData.displayName || ''
    };

    const docRef = await db.collection('precallForms').add(formDoc);

    return {
        id: docRef.id,
        shareId,
        ...formDoc,
        createdAt: new Date(),
        expiresAt
    };
}

/**
 * Get a form by ID
 * @param {string} formId - Form document ID
 * @param {string} userId - Optional user ID for ownership verification
 */
async function getForm(formId, userId = null) {
    const doc = await db.collection('precallForms').doc(formId).get();

    if (!doc.exists) {
        return null;
    }

    const data = doc.data();

    // Verify ownership if userId provided
    if (userId && data.userId !== userId) {
        return null;
    }

    return {
        id: doc.id,
        ...data
    };
}

/**
 * Get a form by share ID (for public access)
 * @param {string} shareId - Public share ID
 */
async function getFormByShareId(shareId) {
    const snapshot = await db.collection('precallForms')
        .where('shareId', '==', shareId)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Check if expired
    const now = new Date();
    const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;

    if (expiresAt && now > expiresAt) {
        // Update status to expired
        await doc.ref.update({ status: 'expired' });
        return { ...data, id: doc.id, status: 'expired' };
    }

    return {
        id: doc.id,
        ...data
    };
}

/**
 * List forms for a user
 * @param {string} userId - User ID
 * @param {Object} options - Pagination and filter options
 */
async function listForms(userId, options = {}) {
    const { status = null, limit = 20, startAfter = null } = options;

    let query = db.collection('precallForms')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

    if (status) {
        query = query.where('status', '==', status);
    }

    if (limit) {
        query = query.limit(limit);
    }

    if (startAfter) {
        const startDoc = await db.collection('precallForms').doc(startAfter).get();
        if (startDoc.exists) {
            query = query.startAfter(startDoc);
        }
    }

    const snapshot = await query.get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

/**
 * Update form status to pending (sent)
 * @param {string} formId - Form ID
 * @param {string} userId - User ID for ownership verification
 */
async function markFormSent(formId, userId) {
    const formRef = db.collection('precallForms').doc(formId);
    const doc = await formRef.get();

    if (!doc.exists || doc.data().userId !== userId) {
        throw new Error('Form not found or access denied');
    }

    await formRef.update({
        status: 'pending',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Submit form responses (from prospect)
 * @param {string} shareId - Form share ID
 * @param {Object} responses - Prospect's responses
 */
async function submitResponses(shareId, responses) {
    const form = await getFormByShareId(shareId);

    if (!form) {
        throw new Error('Form not found');
    }

    if (form.status === 'expired') {
        throw new Error('This form has expired');
    }

    if (form.status === 'completed') {
        throw new Error('This form has already been submitted');
    }

    const formRef = db.collection('precallForms').doc(form.id);

    await formRef.update({
        status: 'completed',
        responses,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If linked to a pitch, update the pitch with form data
    if (form.pitchId) {
        await linkFormToPitch(form.id, form.pitchId, responses);
    }

    return {
        success: true,
        formId: form.id
    };
}

/**
 * Link form responses to a pitch
 * @param {string} formId - Form ID
 * @param {string} pitchId - Pitch ID
 * @param {Object} responses - Form responses
 */
async function linkFormToPitch(formId, pitchId, responses) {
    try {
        const pitchRef = db.collection('pitches').doc(pitchId);
        const pitchDoc = await pitchRef.get();

        if (!pitchDoc.exists) {
            console.warn('Pitch not found for form linking:', pitchId);
            return;
        }

        await pitchRef.update({
            precallFormId: formId,
            precallResponses: responses,
            'enrichment.precallForm': {
                formId,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                challenge: responses.challenge || null,
                currentSolution: responses.current_solution || [],
                timeline: responses.timeline || null,
                budget: responses.budget || null,
                priorityFeatures: responses.priority_features || []
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Failed to link form to pitch:', error);
    }
}

/**
 * Delete a form
 * @param {string} formId - Form ID
 * @param {string} userId - User ID for ownership verification
 */
async function deleteForm(formId, userId) {
    const formRef = db.collection('precallForms').doc(formId);
    const doc = await formRef.get();

    if (!doc.exists || doc.data().userId !== userId) {
        throw new Error('Form not found or access denied');
    }

    await formRef.delete();
}

/**
 * Update form questions (before sending)
 * @param {string} formId - Form ID
 * @param {string} userId - User ID
 * @param {Array} questions - Updated questions
 */
async function updateFormQuestions(formId, userId, questions) {
    const formRef = db.collection('precallForms').doc(formId);
    const doc = await formRef.get();

    if (!doc.exists || doc.data().userId !== userId) {
        throw new Error('Form not found or access denied');
    }

    if (doc.data().status !== 'draft') {
        throw new Error('Cannot update questions after form has been sent');
    }

    await formRef.update({
        questions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Map form responses to pitch enhancement data
 * @param {Object} responses - Form responses
 * @returns {Object} Pitch enhancement data
 */
function mapResponsesToPitchData(responses) {
    const result = {
        painPoints: [],
        competitiveContext: [],
        urgency: 'medium',
        stakeholders: [],
        pricingTier: null,
        featurePriority: []
    };

    // Map challenge to pain points
    if (responses.challenge) {
        result.painPoints.push({
            source: 'precall_form',
            text: responses.challenge,
            isProspectQuote: true
        });
    }

    // Map current solution to competitive context
    if (responses.current_solution) {
        result.competitiveContext = Array.isArray(responses.current_solution)
            ? responses.current_solution
            : [responses.current_solution];
    }

    // Map timeline to urgency
    const timelineMap = {
        'This month': 'high',
        'This quarter': 'medium',
        '6+ months': 'low',
        'Just exploring': 'exploratory'
    };
    result.urgency = timelineMap[responses.timeline] || 'medium';

    // Map stakeholders
    if (responses.stakeholders) {
        result.stakeholders = responses.stakeholders
            .split(/[,;]/)
            .map(s => s.trim())
            .filter(s => s);
    }

    // Map budget to pricing tier
    const budgetMap = {
        'Under $100/mo': 'starter',
        '$100-300/mo': 'growth',
        '$300-500/mo': 'scale',
        '$500+/mo': 'enterprise',
        'Not sure yet': null
    };
    result.pricingTier = budgetMap[responses.budget] || null;

    // Map priority features
    if (responses.priority_features) {
        result.featurePriority = Array.isArray(responses.priority_features)
            ? responses.priority_features
            : [responses.priority_features];
    }

    return result;
}

/**
 * Get default questions
 */
function getDefaultQuestions() {
    return [...DEFAULT_QUESTIONS];
}

module.exports = {
    DEFAULT_QUESTIONS,
    createForm,
    getForm,
    getFormByShareId,
    listForms,
    markFormSent,
    submitResponses,
    deleteForm,
    updateFormQuestions,
    mapResponsesToPitchData,
    getDefaultQuestions,
    generateFormShareId
};
