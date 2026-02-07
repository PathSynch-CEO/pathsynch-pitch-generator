/**
 * Pre-Call Form Routes
 *
 * API endpoints for managing pre-call qualification forms.
 * Enterprise-only feature.
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const precallForm = require('../services/precallForm');
const emailService = require('../services/email');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

/**
 * Check if user has Enterprise tier
 */
async function requireEnterprise(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const tier = (userData.tier || 'starter').toLowerCase();

    if (tier !== 'enterprise') {
        throw new ApiError(
            'Pre-Call Forms require Enterprise plan',
            403,
            ErrorCodes.FORBIDDEN
        );
    }

    return userData;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /precall-forms/defaults
 * Get default form questions for customization
 */
router.get('/precall-forms/defaults', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        return res.status(200).json({
            success: true,
            data: {
                questions: precallForm.getDefaultQuestions()
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /precall-forms/defaults');
    }
});

/**
 * POST /precall-forms
 * Create a new pre-call form
 */
router.post('/precall-forms', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { prospectEmail, prospectName, pitchId, questions, customQuestions, expirationDays } = req.body;

        if (!prospectEmail || !prospectEmail.includes('@')) {
            throw new ApiError('Valid prospect email is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        if (!prospectName) {
            throw new ApiError('Prospect name is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const form = await precallForm.createForm(userId, {
            prospectEmail,
            prospectName,
            pitchId,
            questions,
            customQuestions,
            expirationDays
        });

        return res.status(201).json({
            success: true,
            data: form
        });
    } catch (error) {
        return handleError(error, res, 'POST /precall-forms');
    }
});

/**
 * GET /precall-forms
 * List user's pre-call forms
 */
router.get('/precall-forms', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { status, limit, startAfter } = req.query;

        const forms = await precallForm.listForms(userId, {
            status,
            limit: parseInt(limit) || 20,
            startAfter
        });

        return res.status(200).json({
            success: true,
            data: forms
        });
    } catch (error) {
        return handleError(error, res, 'GET /precall-forms');
    }
});

/**
 * GET /precall-forms/:formId
 * Get a specific form
 */
router.get('/precall-forms/:formId', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { formId } = req.params;
        const form = await precallForm.getForm(formId, userId);

        if (!form) {
            throw new ApiError('Form not found', 404, ErrorCodes.NOT_FOUND);
        }

        return res.status(200).json({
            success: true,
            data: form
        });
    } catch (error) {
        return handleError(error, res, 'GET /precall-forms/:formId');
    }
});

/**
 * PUT /precall-forms/:formId/questions
 * Update form questions (before sending)
 */
router.put('/precall-forms/:formId/questions', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { formId } = req.params;
        const { questions } = req.body;

        if (!questions || !Array.isArray(questions)) {
            throw new ApiError('Questions array is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        await precallForm.updateFormQuestions(formId, userId, questions);

        return res.status(200).json({
            success: true,
            message: 'Questions updated'
        });
    } catch (error) {
        return handleError(error, res, 'PUT /precall-forms/:formId/questions');
    }
});

/**
 * POST /precall-forms/:formId/send
 * Send the form to the prospect via email
 */
router.post('/precall-forms/:formId/send', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const userData = await requireEnterprise(userId);

        const { formId } = req.params;
        const form = await precallForm.getForm(formId, userId);

        if (!form) {
            throw new ApiError('Form not found', 404, ErrorCodes.NOT_FOUND);
        }

        if (form.status !== 'draft') {
            throw new ApiError('Form has already been sent', 400, ErrorCodes.VALIDATION_ERROR);
        }

        // Build form URL
        const formUrl = `https://pathsynch-pitch-creation.web.app/precall-form/?id=${form.shareId}`;

        // Send email
        await sendPrecallFormEmail(form.prospectEmail, {
            prospectName: form.prospectName,
            sellerName: form.sellerName || userData.name || 'Your contact',
            sellerCompany: form.sellerCompany || userData.sellerProfile?.companyProfile?.name || '',
            formUrl
        });

        // Mark form as sent
        await precallForm.markFormSent(formId, userId);

        return res.status(200).json({
            success: true,
            message: 'Form sent successfully',
            formUrl
        });
    } catch (error) {
        return handleError(error, res, 'POST /precall-forms/:formId/send');
    }
});

/**
 * DELETE /precall-forms/:formId
 * Delete a form
 */
router.delete('/precall-forms/:formId', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { formId } = req.params;
        await precallForm.deleteForm(formId, userId);

        return res.status(200).json({
            success: true,
            message: 'Form deleted'
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /precall-forms/:formId');
    }
});

/**
 * GET /precall-forms/public/:shareId
 * Get form for public access (prospect view) - No auth required
 */
router.get('/precall-forms/public/:shareId', async (req, res) => {
    try {
        const { shareId } = req.params;
        const form = await precallForm.getFormByShareId(shareId);

        if (!form) {
            throw new ApiError('Form not found', 404, ErrorCodes.NOT_FOUND);
        }

        if (form.status === 'expired') {
            throw new ApiError('This form has expired', 410, ErrorCodes.EXPIRED);
        }

        if (form.status === 'completed') {
            return res.status(200).json({
                success: true,
                data: {
                    status: 'completed',
                    message: 'This form has already been submitted. Thank you!'
                }
            });
        }

        // Return only what's needed for the public form
        return res.status(200).json({
            success: true,
            data: {
                shareId: form.shareId,
                questions: form.questions,
                prospectName: form.prospectName,
                sellerCompany: form.sellerCompany,
                sellerName: form.sellerName,
                expiresAt: form.expiresAt
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /precall-forms/public/:shareId');
    }
});

/**
 * POST /precall-forms/public/:shareId/submit
 * Submit form responses (prospect submission) - No auth required
 */
router.post('/precall-forms/public/:shareId/submit', async (req, res) => {
    try {
        const { shareId } = req.params;
        const { responses } = req.body;

        if (!responses || typeof responses !== 'object') {
            throw new ApiError('Responses are required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const result = await precallForm.submitResponses(shareId, responses);

        // Notify form owner
        const form = await precallForm.getFormByShareId(shareId);
        if (form) {
            await notifyFormOwner(form);
        }

        return res.status(200).json({
            success: true,
            message: 'Thank you! Your responses have been submitted.'
        });
    } catch (error) {
        return handleError(error, res, 'POST /precall-forms/public/:shareId/submit');
    }
});

/**
 * GET /precall-forms/:formId/pitch-data
 * Get mapped pitch data from form responses
 */
router.get('/precall-forms/:formId/pitch-data', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { formId } = req.params;
        const form = await precallForm.getForm(formId, userId);

        if (!form) {
            throw new ApiError('Form not found', 404, ErrorCodes.NOT_FOUND);
        }

        if (form.status !== 'completed' || !form.responses) {
            throw new ApiError('Form has not been completed yet', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const pitchData = precallForm.mapResponsesToPitchData(form.responses);

        return res.status(200).json({
            success: true,
            data: {
                formId: form.id,
                prospectName: form.prospectName,
                prospectEmail: form.prospectEmail,
                completedAt: form.completedAt,
                pitchEnhancement: pitchData,
                rawResponses: form.responses
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /precall-forms/:formId/pitch-data');
    }
});

// ============================================
// EMAIL HELPERS
// ============================================

/**
 * Send pre-call form email to prospect
 */
async function sendPrecallFormEmail(to, data) {
    const { prospectName, sellerName, sellerCompany, formUrl } = data;

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">${sellerCompany || 'SynchIntro'}</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                Quick Questions Before Our Call
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Hi ${prospectName || 'there'},
            </p>

            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Looking forward to our upcoming conversation! To make our time together as valuable as possible,
                I've put together a few quick questions that will help me understand your needs better.
            </p>

            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #666; font-size: 14px; margin: 0;">
                    <strong>⏱️ Takes only 2 minutes</strong><br>
                    Your answers help me focus on what matters most to you.
                </p>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${formUrl}"
                   style="display: inline-block; background: #3A6746; color: white; padding: 16px 40px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                    Complete Pre-Call Questions
                </a>
            </div>

            <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                See you soon!<br>
                <strong>${sellerName}</strong><br>
                ${sellerCompany || ''}
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                This form link expires in 7 days.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: 'hello@pathsynch.com',
            name: sellerCompany || 'SynchIntro'
        },
        subject: `Quick questions before our call - ${sellerCompany || sellerName}`,
        html
    };

    await sgMail.send(msg);
}

/**
 * Notify form owner when prospect submits
 */
async function notifyFormOwner(form) {
    try {
        const userDoc = await db.collection('users').doc(form.userId).get();
        if (!userDoc.exists) return;

        const userData = userDoc.data();
        const ownerEmail = userData.email;
        if (!ownerEmail) return;

        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        const responses = form.responses || {};
        const challengePreview = responses.challenge
            ? responses.challenge.substring(0, 100) + (responses.challenge.length > 100 ? '...' : '')
            : 'No response';

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Pre-Call Form Completed!</h1>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Great news! <strong>${form.prospectName}</strong> has completed your pre-call questionnaire.
            </p>

            <div style="background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #3A6746; margin: 0 0 12px 0; font-size: 14px;">Their Main Challenge:</h3>
                <p style="color: #333; font-size: 14px; margin: 0; font-style: italic;">
                    "${challengePreview}"
                </p>
            </div>

            <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <p style="color: #666; font-size: 14px; margin: 0;">
                    <strong>Timeline:</strong> ${responses.timeline || 'Not specified'}<br>
                    <strong>Budget:</strong> ${responses.budget || 'Not specified'}
                </p>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://pathsynch-pitch-creation.web.app/precall-forms.html"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Full Responses
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                SynchIntro Pre-Call Forms
            </p>
        </div>
    </div>
</body>
</html>
        `;

        const msg = {
            to: ownerEmail,
            from: {
                email: 'hello@pathsynch.com',
                name: 'SynchIntro'
            },
            subject: `${form.prospectName} completed your pre-call form`,
            html
        };

        await sgMail.send(msg);
    } catch (error) {
        console.error('Failed to notify form owner:', error.message);
    }
}

module.exports = router;
