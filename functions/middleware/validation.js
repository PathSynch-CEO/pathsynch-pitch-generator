/**
 * Request Validation Middleware
 *
 * Uses Joi for schema validation of API request bodies.
 * Provides consistent error responses for invalid input.
 */

const Joi = require('joi');

// ============================================
// COMMON VALIDATION SCHEMAS
// ============================================

const schemas = {
    // Email validation
    email: Joi.string().email().max(254).lowercase().trim(),

    // Pitch generation input
    generatePitch: Joi.object({
        businessName: Joi.string().min(1).max(200).required(),
        contactName: Joi.string().max(100).allow('', null),
        industry: Joi.string().max(100).allow('', null),
        statedProblem: Joi.string().max(2000).allow('', null),
        pitchLevel: Joi.number().integer().min(1).max(3).default(1),
        monthlyVisits: Joi.number().integer().min(0).max(1000000).allow(null),
        transactionValue: Joi.number().min(0).max(100000).allow(null),
        repeatRate: Joi.number().min(0).max(100).allow(null),
        bookingUrl: Joi.string().uri().max(500).allow('', null),
        branding: Joi.object({
            primaryColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null),
            accentColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null),
            logoUrl: Joi.string().uri().max(500).allow('', null),
            companyName: Joi.string().max(200).allow('', null),
            hidePoweredBy: Joi.boolean().default(false)
        }).allow(null)
    }),

    // Narrative generation input
    generateNarrative: Joi.object({
        businessName: Joi.string().min(1).max(200).required(),
        industry: Joi.string().max(100).allow('', null),
        targetAudience: Joi.string().max(500).allow('', null),
        uniqueValue: Joi.string().max(1000).allow('', null),
        painPoints: Joi.array().items(Joi.string().max(500)).max(10).allow(null),
        goals: Joi.array().items(Joi.string().max(500)).max(10).allow(null),
        tone: Joi.string().valid('professional', 'consultative', 'friendly', 'urgent').default('consultative'),
        additionalContext: Joi.string().max(2000).allow('', null)
    }),

    // Team invite input
    teamInvite: Joi.object({
        email: Joi.string().email().max(254).lowercase().required(),
        role: Joi.string().valid('admin', 'manager', 'member').default('member')
    }),

    // Market report input
    marketReport: Joi.object({
        city: Joi.string().min(1).max(100).required(),
        state: Joi.string().min(2).max(50).required(),
        zipCode: Joi.string().pattern(/^\d{5}(-\d{4})?$/).allow('', null),
        industry: Joi.string().min(1).max(100).required(),
        subIndustry: Joi.string().max(100).allow('', null),
        companySize: Joi.string().valid('small', 'medium', 'large', 'enterprise').default('medium'),
        radius: Joi.number().integer().min(1000).max(50000).default(5000)
    }),

    // Saved search input
    savedSearch: Joi.object({
        name: Joi.string().max(200).allow('', null),
        city: Joi.string().min(1).max(100).required(),
        state: Joi.string().min(2).max(50).required(),
        zipCode: Joi.string().pattern(/^\d{5}(-\d{4})?$/).allow('', null),
        industry: Joi.string().min(1).max(100).required(),
        subIndustry: Joi.string().max(100).allow('', null),
        companySize: Joi.string().valid('small', 'medium', 'large', 'enterprise').default('medium'),
        radius: Joi.number().integer().min(1000).max(50000).default(5000)
    }),

    // Analytics track event
    analyticsTrack: Joi.object({
        pitchId: Joi.string().min(1).max(100).required(),
        event: Joi.string().valid('view', 'cta_click', 'share', 'download').required(),
        data: Joi.object().unknown(true).allow(null)
    }),

    // User settings update
    userSettings: Joi.object({
        profile: Joi.object({
            displayName: Joi.string().max(100).allow('', null),
            company: Joi.string().max(200).allow('', null),
            role: Joi.string().max(100).allow('', null)
        }).allow(null),
        settings: Joi.object({
            defaultTone: Joi.string().valid('professional', 'consultative', 'friendly', 'urgent').allow(null),
            defaultGoal: Joi.string().valid('book_demo', 'request_info', 'start_trial', 'contact').allow(null),
            defaultIndustry: Joi.string().max(100).allow('', null),
            emailSignature: Joi.string().max(500).allow('', null)
        }).allow(null),
        branding: Joi.object({
            logoUrl: Joi.string().uri().max(500).allow('', null),
            companyName: Joi.string().max(200).allow('', null),
            primaryColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null),
            accentColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null),
            hidePoweredBy: Joi.boolean()
        }).allow(null)
    }),

    // Pitch update
    pitchUpdate: Joi.object({
        businessName: Joi.string().min(1).max(200),
        contactName: Joi.string().max(100).allow('', null),
        shared: Joi.boolean(),
        industry: Joi.string().max(100).allow('', null),
        statedProblem: Joi.string().max(2000).allow('', null)
    }).min(1), // At least one field required

    // Email pitch/report
    emailContent: Joi.object({
        email: Joi.string().email().max(254).required(),
        pdfBase64: Joi.string().max(10 * 1024 * 1024).required(), // Max 10MB base64
        filename: Joi.string().max(200).allow('', null),
        reportData: Joi.object().unknown(true).allow(null)
    }),

    // Stripe checkout
    stripeCheckout: Joi.object({
        priceId: Joi.string().min(1).max(100).required(),
        successUrl: Joi.string().uri().max(500).allow(null),
        cancelUrl: Joi.string().uri().max(500).allow(null)
    }),

    // Team creation
    teamCreate: Joi.object({
        name: Joi.string().min(1).max(200).allow('', null)
    }),

    // Accept invite
    acceptInvite: Joi.object({
        inviteCode: Joi.string().min(1).max(100).required()
    }),

    // Role update
    roleUpdate: Joi.object({
        role: Joi.string().valid('admin', 'manager', 'member').required()
    }),

    // Format narrative
    formatNarrative: Joi.object({
        options: Joi.object({
            tone: Joi.string().valid('professional', 'consultative', 'friendly', 'urgent'),
            length: Joi.string().valid('short', 'medium', 'long'),
            includeStats: Joi.boolean(),
            includeCta: Joi.boolean()
        }).allow(null)
    }),

    // Batch format
    batchFormat: Joi.object({
        types: Joi.array().items(
            Joi.string().valid('sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'proposal', 'deck')
        ).min(1).max(7).required(),
        options: Joi.object().unknown(true).allow(null)
    }),

    // Mini report (lead capture)
    miniReport: Joi.object({
        email: Joi.string().email().max(254).required(),
        businessName: Joi.string().min(1).max(200).required(),
        city: Joi.string().min(1).max(100).required(),
        state: Joi.string().min(2).max(50).required(),
        industry: Joi.string().max(100).allow('', null)
    })
};

// ============================================
// VALIDATION MIDDLEWARE FACTORY
// ============================================

/**
 * Creates validation middleware for a specific schema
 * @param {string} schemaName - Name of the schema in the schemas object
 * @param {object} options - Validation options
 * @returns {function} Express middleware function
 */
function validate(schemaName, options = {}) {
    const schema = schemas[schemaName];
    if (!schema) {
        throw new Error(`Unknown validation schema: ${schemaName}`);
    }

    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: options.stripUnknown !== false, // Strip unknown fields by default
            ...options
        });

        if (error) {
            const details = error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message.replace(/"/g, "'")
            }));

            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details
            });
        }

        // Replace req.body with validated/sanitized value
        req.body = value;
        next();
    };
}

/**
 * Validates request body against a schema directly
 * @param {object} body - Request body to validate
 * @param {string} schemaName - Name of the schema
 * @returns {object} { valid: boolean, value?: object, errors?: array }
 */
function validateBody(body, schemaName) {
    const schema = schemas[schemaName];
    if (!schema) {
        return { valid: false, errors: [{ field: '_schema', message: `Unknown schema: ${schemaName}` }] };
    }

    const { error, value } = schema.validate(body, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const errors = error.details.map(d => ({
            field: d.path.join('.'),
            message: d.message.replace(/"/g, "'")
        }));
        return { valid: false, errors };
    }

    return { valid: true, value };
}

/**
 * Sanitizes a string to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

module.exports = {
    schemas,
    validate,
    validateBody,
    sanitizeString
};
