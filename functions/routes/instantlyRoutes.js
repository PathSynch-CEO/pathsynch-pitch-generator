/**
 * Instantly Routes
 *
 * API endpoints for Instantly.ai integration.
 * Allows users to push pre-call brief intelligence into Instantly campaigns.
 *
 * @see https://developer.instantly.ai/
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { createRouter } = require('../utils/router');
const { handleError, badRequest, unauthorized, notFound } = require('../middleware/errorHandler');
const { requirePlan } = require('../middleware/planGate');
const instantlyService = require('../services/instantlyService');

const router = createRouter();
const db = admin.firestore();

// ============================================
// ENCRYPTION HELPERS (AES-256-CBC)
// ============================================

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

function getEncryptionKey() {
    const key = process.env.INSTANTLY_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('INSTANTLY_ENCRYPTION_KEY environment variable is not set');
    }
    return Buffer.from(key, 'hex');
}

/**
 * Encrypt plaintext using AES-256-CBC with random IV
 * @returns {string} "iv:encrypted" (hex-encoded, colon-separated)
 */
function encrypt(plaintext) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt ciphertext stored as "iv:encrypted" (hex-encoded)
 * @returns {string} plaintext
 */
function decrypt(ciphertext) {
    const key = getEncryptionKey();
    const [ivHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Decrypt an API key, handling legacy plaintext keys gracefully.
 * If decryption fails (no colon separator or invalid ciphertext), treats as legacy plaintext.
 */
function decryptApiKey(storedValue) {
    if (!storedValue) return null;

    // Check for encrypted format (iv:ciphertext, both hex)
    if (storedValue.includes(':')) {
        try {
            return decrypt(storedValue);
        } catch (err) {
            console.warn('[Instantly] Failed to decrypt API key, treating as legacy plaintext');
        }
    }

    // Legacy plaintext key — return as-is
    return storedValue;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get user's Instantly API key from Firestore (decrypted)
 */
async function getInstantlyApiKey(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return null;

    const userData = userDoc.data();
    const storedKey = userData?.integrations?.instantly?.apiKey || null;
    return decryptApiKey(storedKey);
}

/**
 * Extract intelligence from brief into Instantly custom variables
 */
function extractBriefIntelligence(brief) {
    const content = brief.briefContent || {};
    const marketContext = brief.marketContext || {};
    const contactIntel = brief.contactIntelligence || {};

    // Helper to truncate text
    const truncate = (text, maxLen) => {
        if (!text) return '';
        return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
    };

    // Helper to extract first N sentences
    const firstSentences = (text, n = 2) => {
        if (!text) return '';
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        return sentences.slice(0, n).join(' ').trim();
    };

    // Helper to parse talking point (format: "Pain → Solution" or just text)
    const parseTalkingPoint = (point, part) => {
        if (!point) return '';
        if (typeof point === 'object') {
            return part === 'pain' ? (point.pain || point.challenge || '') : (point.solution || point.response || '');
        }
        const parts = point.split('→');
        if (parts.length === 2) {
            return part === 'pain' ? parts[0].trim() : parts[1].trim();
        }
        return part === 'pain' ? point : '';
    };

    const talkingPoints = content.talkingPoints || [];

    // Build market position summary
    let marketPosition = '';
    if (marketContext.competitorCount || marketContext.opportunityScore) {
        const parts = [];
        if (marketContext.competitorCount) parts.push(`${marketContext.competitorCount} competitors`);
        if (marketContext.avgRating) parts.push(`avg ${marketContext.avgRating}★`);
        if (marketContext.opportunityScore) parts.push(`opportunity ${marketContext.opportunityScore}/100`);
        marketPosition = parts.join(', ');
    }

    return {
        synchintro_opener: truncate(content.suggestedOpener, 500),
        synchintro_company_context: firstSentences(content.companySnapshot, 2),
        synchintro_trigger: truncate(content.whyTheyTookMeeting, 300),
        synchintro_pain1: truncate(parseTalkingPoint(talkingPoints[0], 'pain'), 200),
        synchintro_pain2: truncate(parseTalkingPoint(talkingPoints[1], 'pain'), 200),
        synchintro_solution1: truncate(parseTalkingPoint(talkingPoints[0], 'solution'), 200),
        synchintro_solution2: truncate(parseTalkingPoint(talkingPoints[1], 'solution'), 200),
        synchintro_market_position: marketPosition,
        synchintro_comm_style: contactIntel?.profile?.communicationStyle || '',
        synchintro_brief_id: brief.id || ''
    };
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /instantly/connect
 * Save and test user's Instantly API key
 */
router.post('/instantly/connect', requirePlan('growth'), async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const { apiKey } = req.body;
        if (!apiKey) {
            throw badRequest('API key is required');
        }

        // Test the API key
        const testResult = await instantlyService.testConnection(apiKey);
        if (!testResult.success) {
            return res.status(401).json({
                success: false,
                error: testResult.error || 'Invalid API key'
            });
        }

        // Save to user document (encrypted)
        const encryptedKey = encrypt(apiKey);
        await db.collection('users').doc(userId).set({
            integrations: {
                instantly: {
                    apiKey: encryptedKey,
                    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'active'
                }
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[Instantly] User ${userId} connected Instantly account`);

        return res.status(200).json({
            success: true,
            message: 'Instantly connected successfully'
        });

    } catch (error) {
        return handleError(error, res, 'POST /instantly/connect');
    }
});

/**
 * GET /instantly/status
 * Check user's Instantly connection status
 */
router.get('/instantly/status', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const instantlyData = userData?.integrations?.instantly;

        if (!instantlyData || !instantlyData.apiKey) {
            return res.status(200).json({
                success: true,
                data: {
                    connected: false,
                    status: 'disconnected'
                }
            });
        }

        // Decrypt then mask API key (show last 4 characters)
        const plainKey = decryptApiKey(instantlyData.apiKey);
        const maskedKey = '••••••••••••' + plainKey.slice(-4);

        return res.status(200).json({
            success: true,
            data: {
                connected: true,
                status: instantlyData.status || 'active',
                connectedAt: instantlyData.connectedAt?.toDate?.() || null,
                maskedKey
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /instantly/status');
    }
});

/**
 * DELETE /instantly/disconnect
 * Remove user's Instantly API key
 */
router.delete('/instantly/disconnect', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        await db.collection('users').doc(userId).update({
            'integrations.instantly': admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Instantly] User ${userId} disconnected Instantly account`);

        return res.status(200).json({
            success: true,
            message: 'Instantly disconnected'
        });

    } catch (error) {
        return handleError(error, res, 'DELETE /instantly/disconnect');
    }
});

/**
 * GET /instantly/campaigns
 * List user's Instantly campaigns
 */
router.get('/instantly/campaigns', requirePlan('growth'), async (req, res) => {
    console.log('[Instantly] GET /instantly/campaigns called');
    try {
        const userId = req.userId;
        console.log('[Instantly] User ID:', userId);
        if (!userId) {
            throw unauthorized();
        }

        const apiKey = await getInstantlyApiKey(userId);
        console.log('[Instantly] API key found:', apiKey ? 'yes (length: ' + apiKey.length + ')' : 'no');
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        console.log('[Instantly] Calling listCampaigns...');
        const result = await instantlyService.listCampaigns(apiKey);
        console.log('[Instantly] listCampaigns result:', JSON.stringify(result));

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            data: result.data
        });

    } catch (error) {
        console.error('[Instantly] GET /instantly/campaigns error:', error);
        return handleError(error, res, 'GET /instantly/campaigns');
    }
});

/**
 * POST /instantly/push-lead
 * Push a pre-call brief's intelligence to Instantly as an enriched lead
 */
router.post('/instantly/push-lead', requirePlan('growth'), async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const { briefId, prospectEmail, campaignId } = req.body;
        console.log(`[Instantly] POST /instantly/push-lead briefId=${briefId} email=${prospectEmail} campaignId=${campaignId} userId=${userId}`);

        if (!briefId) {
            throw badRequest('briefId is required');
        }
        if (!prospectEmail) {
            throw badRequest('prospectEmail is required');
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(prospectEmail)) {
            throw badRequest('Invalid email format');
        }

        // Get user's API key
        const apiKey = await getInstantlyApiKey(userId);
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        // Fetch the brief
        const briefDoc = await db.collection('precallBriefs').doc(briefId).get();
        if (!briefDoc.exists) {
            throw notFound('Brief not found');
        }

        const brief = { id: briefDoc.id, ...briefDoc.data() };

        // Verify ownership
        if (brief.userId !== userId) {
            throw unauthorized('You do not have access to this brief');
        }

        // Extract intelligence into custom variables
        const customVariables = extractBriefIntelligence(brief);

        // Build lead data
        const leadData = {
            email: prospectEmail,
            companyName: brief.prospectCompany || '',
            firstName: brief.contactName?.split(' ')[0] || '',
            lastName: brief.contactName?.split(' ').slice(1).join(' ') || '',
            website: brief.prospectWebsite || '',
            campaignId: campaignId || null,
            customVariables
        };

        // Push to Instantly
        const result = await instantlyService.pushLead(apiKey, leadData);

        // Log the push attempt
        await db.collection('instantlyPushLogs').add({
            userId,
            briefId,
            prospectEmail,
            campaignId: campaignId || null,
            customVariables,
            instantlyResponse: result.data || null,
            status: result.success ? 'success' : 'failed',
            error: result.error || null,
            pushedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        // Update brief with push status
        await db.collection('precallBriefs').doc(briefId).update({
            'instantly.pushed': true,
            'instantly.pushedAt': admin.firestore.FieldValue.serverTimestamp(),
            'instantly.prospectEmail': prospectEmail,
            'instantly.campaignId': campaignId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Instantly] User ${userId} pushed brief ${briefId} to Instantly`);

        return res.status(200).json({
            success: true,
            message: 'Lead pushed to Instantly successfully',
            data: {
                briefId,
                prospectEmail,
                campaignId: campaignId || null,
                variablesPushed: Object.keys(customVariables).length
            }
        });

    } catch (error) {
        return handleError(error, res, 'POST /instantly/push-lead');
    }
});

/**
 * GET /instantly/leads
 * List leads from Instantly, optionally filtered by campaign
 */
router.get('/instantly/leads', requirePlan('growth'), async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const apiKey = await getInstantlyApiKey(userId);
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        const { campaignId, status, limit } = req.query;

        const result = await instantlyService.listLeads(apiKey, {
            campaignId,
            status,
            limit: limit ? parseInt(limit, 10) : 50
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            data: result.data
        });

    } catch (error) {
        return handleError(error, res, 'GET /instantly/leads');
    }
});

/**
 * POST /instantly/import-lead
 * Import a lead from Instantly and return structured data for brief generation
 */
router.post('/instantly/import-lead', requirePlan('growth'), async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const { email, campaignId, leadId } = req.body;

        if (!email) {
            throw badRequest('email is required');
        }

        const apiKey = await getInstantlyApiKey(userId);
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        // Fetch the lead from Instantly with full details
        console.log(`[Instantly] Importing lead: email=${email}, campaignId=${campaignId}, leadId=${leadId}`);
        const result = await instantlyService.getLead(apiKey, email, campaignId, leadId);

        if (!result.success) {
            return res.status(404).json({
                success: false,
                error: result.error || 'Lead not found in Instantly'
            });
        }

        const lead = result.data;
        const customVars = lead.customVariables || {};

        // Helper to find value from multiple possible field names (case-insensitive)
        // Also filters out "Skipped" values that Instantly uses as placeholder
        const getVar = (...keys) => {
            for (const key of keys) {
                if (customVars[key] && customVars[key] !== 'Skipped') return customVars[key];
                const lowerKey = key.toLowerCase();
                for (const [k, v] of Object.entries(customVars)) {
                    if (k.toLowerCase() === lowerKey && v && v !== 'Skipped') return v;
                }
            }
            return '';
        };

        console.log('[Instantly] Custom vars keys:', Object.keys(customVars));

        // Build structured data for brief generation form
        // Field names from Instantly payload: jobTitle, linkedIn, location, industry, companyWebsite, headline
        const importData = {
            // Contact info
            contactName: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '',
            contactEmail: lead.email,
            contactTitle: getVar('jobTitle', 'title', 'job_title', 'position', 'role', 'headline'),

            // Company info
            companyName: lead.companyName || getVar('company', 'companyName', 'company_name'),
            industry: getVar('industry', 'subIndustry'),
            location: getVar('location', 'city', 'address'),
            website: getVar('companyWebsite', 'website', 'company_website', 'companyDomain'),

            // LinkedIn (important for enrichment) - Instantly uses 'linkedIn' (camelCase)
            linkedin: getVar('linkedIn', 'linkedin', 'linkedin_url', 'li_url', 'linkedin_profile'),

            // Instantly metadata
            instantlySource: {
                campaignId: lead.campaignId,
                campaignName: lead.campaignName,
                leadEmail: lead.email,
                leadStatus: lead.status,
                lastActivity: lead.lastActivity,
                importedAt: new Date().toISOString()
            },

            // All custom variables for frontend to use
            customVariables: customVars
        };

        console.log(`[Instantly] Imported lead ${email} for user ${userId}`);
        console.log(`[Instantly] Import data:`, JSON.stringify(importData));

        return res.status(200).json({
            success: true,
            data: importData
        });

    } catch (error) {
        return handleError(error, res, 'POST /instantly/import-lead');
    }
});

// ── VISITOR INTEL — GLOBAL API KEY ENDPOINTS ─────────────────────────────────
// These use INSTANTLY_API_KEY from .env (global company key), NOT per-user keys.

const instantlyClient = require('../services/instantlyClient');
const entity360Bridge = require('../services/entity360Bridge');
const FieldValue = admin.firestore.FieldValue;

/**
 * GET /instantly/vi-campaigns
 * List Instantly campaigns using the global API key (for Visitor Intel workspace).
 * Returns: [{ id, name, status }]
 */
router.get('/instantly/vi-campaigns', async (req, res) => {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    try {
        const data = await instantlyClient.getInstantlyCampaigns();
        // Instantly V1 returns { status, data: [...] } or array directly
        const raw = Array.isArray(data) ? data : (data.data || []);
        const campaigns = raw.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status || 'active',
            leadCount: c.leads_count ?? null
        }));
        return res.json({ success: true, campaigns });
    } catch (err) {
        console.error('[Instantly] vi-campaigns error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /instantly/trigger-sequence
 * Trigger an Instantly sequence for a Visitor Intel account.
 * Uses the global INSTANTLY_API_KEY.
 * Body: { accountKey: string, campaignId: string }
 */
router.post('/instantly/trigger-sequence', async (req, res) => {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    try {
        const { accountKey, campaignId } = req.body;
        const userId = req.userId;

        if (!accountKey) return res.status(400).json({ success: false, error: 'accountKey is required' });
        if (!campaignId) return res.status(400).json({ success: false, error: 'campaignId is required' });

        // 1. Read Account360 + outbound_view
        const account360Ref = db.collection('Account360').doc(accountKey);
        const account360Snap = await account360Ref.get();
        if (!account360Snap.exists) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        const account = account360Snap.data();

        let av = account;
        try {
            const viewRef = account360Ref.collection('agentViews').doc('outbound_view');
            const viewSnap = await viewRef.get();
            if (viewSnap.exists) {
                const viewData = viewSnap.data();
                const expiresAt = viewData.expiresAt?.toDate?.() || new Date(viewData.expiresAt);
                if (expiresAt > new Date()) av = { ...account, ...viewData };
            }
        } catch (e) {
            console.warn('[Instantly] outbound_view read failed:', e.message);
        }

        // 2. Extract contact info — required for Instantly
        const contacts = av.identity?.identifiedContacts || account.identity?.identifiedContacts || [];
        const contact = contacts[0] || null;
        const contactEmail = contact?.email || null;

        if (!contactEmail) {
            return res.json({
                success: false,
                error: 'No identified contact email for this account. Visitor Intel needs an identified contact to trigger a sequence.'
            });
        }

        // 3. Build visitor intel context
        const companyName = av.companyName?.value || account.companyName?.value || account.domain || 'Unknown';
        const domain = account.domain;
        const intentSignals = av.intentSignals || account.intentSignals || {};
        const status = intentSignals.status || 'unknown';
        const score = intentSignals.currentScore?.value ?? 0;
        const whyNow = Array.isArray(intentSignals.scoreExplanation)
            ? intentSignals.scoreExplanation[0]
            : (intentSignals.scoreExplanation || '');
        const topIntentPage = intentSignals.highIntentPages?.[0]?.tag
            || intentSignals.highIntentPages?.[0]?.url
            || '';
        const recommendedAction = av.recommendedNextAction?.value || account.recommendedNextAction?.value || '';
        const nameParts = (contact.name || '').split(' ');

        // 4. Push to Instantly with visitor intel custom variables
        const contactPayload = {
            email: contactEmail,
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            company_name: companyName,
            website: domain || '',
            custom_variables: {
                custom_1: status,
                custom_2: whyNow,
                custom_3: topIntentPage,
                custom_4: String(score),
                custom_5: recommendedAction
            }
        };

        const INSTANTLY_API_BASE = 'https://api.instantly.ai/api/v1';
        const pushResp = await fetch(`${INSTANTLY_API_BASE}/lead/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: process.env.INSTANTLY_API_KEY,
                campaign_id: campaignId,
                skip_if_in_workspace: true,
                leads: [contactPayload]
            })
        });

        if (!pushResp.ok) {
            const errText = await pushResp.text();
            throw new Error(`Instantly API error ${pushResp.status}: ${errText}`);
        }

        // 5. Update Account360 outboundState
        await account360Ref.update({
            'outboundState.sequenceTriggered': true,
            'outboundState.lastOutboundAt': FieldValue.serverTimestamp()
        });

        // 6. Write signalHistory entry
        const historyRef = account360Ref.collection('signalHistory').doc();
        await historyRef.set({
            eventType: 'SEQUENCE_TRIGGERED',
            campaignId,
            email: contactEmail,
            pushedBy: userId,
            companyName,
            domain,
            timestamp: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp()
        });

        // 7. Action matching alerts (fire-and-forget)
        db.collection('notifications').doc(userId)
            .collection('alerts')
            .where('accountKey', '==', accountKey)
            .where('status', 'in', ['unread', 'read'])
            .get()
            .then(snap => {
                if (snap.empty) return;
                const batch = db.batch();
                snap.docs.forEach(doc => batch.update(doc.ref, {
                    status: 'actioned',
                    actionedAt: FieldValue.serverTimestamp()
                }));
                return batch.commit();
            })
            .catch(e => console.warn('[Instantly] Alert actioning failed:', e.message));

        // 8. Entity360 bridge (fire-and-forget)
        const merchantId = account.workspaceId;
        if (merchantId) {
            db.collection('merchantConfig').doc(merchantId).get()
                .then(snap => {
                    if (!snap.exists) return;
                    const config = snap.data();
                    if (!config.entity360MerchantId) return;
                    entity360Bridge.fireEvent(config.entity360MerchantId, 'SEQUENCE_TRIGGERED', 'INFO', {
                        campaignId,
                        email: contactEmail,
                        domain
                    });
                })
                .catch(e => console.warn('[Instantly] Entity360 SEQUENCE_TRIGGERED failed:', e.message));
        }

        return res.json({ success: true, campaignId, email: contactEmail, companyName });

    } catch (err) {
        console.error('[Instantly] trigger-sequence error:', err.message);
        return res.json({ success: false, error: err.message });
    }
});

module.exports = router;
