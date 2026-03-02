/**
 * Instantly Service
 *
 * Handles all communication with the Instantly.ai API V2.
 * Used for pushing SynchIntro pre-call brief intelligence into Instantly campaigns.
 *
 * @see https://developer.instantly.ai/
 */

const axios = require('axios');

const BASE_URL = 'https://api.instantly.ai/api/v2';
const TIMEOUT = 15000; // 15 seconds

/**
 * Create axios instance with auth headers
 */
function createClient(apiKey) {
    return axios.create({
        baseURL: BASE_URL,
        timeout: TIMEOUT,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute request with exponential backoff retry on 429
 */
async function withRetry(fn, maxRetries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Only retry on 429 (rate limit)
            if (error.response?.status === 429 && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 2000; // 2s, 4s
                console.log(`[Instantly] Rate limited, retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Translate Instantly API errors into clean messages
 */
function translateError(error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return 'Couldn\'t reach Instantly. Please try again in a moment.';
    }

    if (!error.response) {
        return 'Network error connecting to Instantly.';
    }

    const status = error.response.status;
    const data = error.response.data;

    switch (status) {
        case 401:
            return 'Invalid API key. Check your Instantly API key in Settings.';
        case 403:
            return 'Access denied. Your API key may not have permission for this action.';
        case 404:
            return 'Resource not found in Instantly.';
        case 429:
            return 'Instantly is rate limiting requests. Please wait a minute and try again.';
        case 500:
        case 502:
        case 503:
            return 'Instantly is temporarily unavailable. Please try again later.';
        default:
            return data?.message || data?.error || `Instantly error (${status})`;
    }
}

/**
 * Test API key validity by listing campaigns
 */
async function testConnection(apiKey) {
    try {
        const client = createClient(apiKey);
        const response = await withRetry(() => client.get('/campaigns', {
            params: { limit: 1 }
        }));

        return {
            success: true,
            message: 'Connection successful'
        };
    } catch (error) {
        console.error('[Instantly] Test connection failed:', error.message);
        return {
            success: false,
            error: translateError(error)
        };
    }
}

/**
 * List user's campaigns
 */
async function listCampaigns(apiKey) {
    try {
        const client = createClient(apiKey);

        const response = await withRetry(() => client.get('/campaigns', {
            params: { limit: 100 }
        }));

        // Log raw response structure
        console.log('[Instantly] Response keys:', Object.keys(response.data || {}));
        console.log('[Instantly] Response data sample:', JSON.stringify(response.data).substring(0, 500));

        // Instantly V2 API may return different structures
        let rawCampaigns = [];
        const data = response.data;

        if (Array.isArray(data)) {
            rawCampaigns = data;
        } else if (data && typeof data === 'object') {
            // Try common wrapper properties
            rawCampaigns = data.items || data.data || data.campaigns || [];
        }

        const campaigns = (Array.isArray(rawCampaigns) ? rawCampaigns : []).map(c => ({
            id: c.id,
            name: c.name,
            status: c.status
        }));

        console.log('[Instantly] Found', campaigns.length, 'campaigns');

        return { success: true, data: campaigns };
    } catch (error) {
        console.error('[Instantly] List campaigns error:', error.message);
        return { success: false, error: translateError(error) };
    }
}

/**
 * Push a lead to Instantly with custom variables
 *
 * @param {string} apiKey - User's Instantly API key
 * @param {object} leadData - Lead data including email and custom variables
 * @param {string} leadData.email - Prospect's email address (required)
 * @param {string} [leadData.campaignId] - Optional campaign to add lead to
 * @param {object} leadData.customVariables - Custom variables with synchintro_ prefix
 */
async function pushLead(apiKey, leadData) {
    try {
        const client = createClient(apiKey);

        // Build lead payload
        const payload = {
            email: leadData.email,
            custom_variables: leadData.customVariables || {}
        };

        // Add to campaign if specified
        if (leadData.campaignId) {
            payload.campaign_id = leadData.campaignId;
        }

        // Add optional fields if provided
        if (leadData.firstName) payload.first_name = leadData.firstName;
        if (leadData.lastName) payload.last_name = leadData.lastName;
        if (leadData.companyName) payload.company_name = leadData.companyName;

        const response = await withRetry(() => client.post('/leads', payload));

        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('[Instantly] Push lead failed:', error.message);
        return {
            success: false,
            error: translateError(error)
        };
    }
}

/**
 * List leads from Instantly, optionally filtered by campaign
 *
 * @param {string} apiKey - User's Instantly API key
 * @param {object} options - Filter options
 * @param {string} [options.campaignId] - Filter by campaign ID
 * @param {string} [options.search] - Search by email
 * @param {number} [options.limit] - Max leads to return (default 50)
 * @param {number} [options.skip] - Number of leads to skip for pagination
 */
async function listLeads(apiKey, options = {}) {
    try {
        const client = createClient(apiKey);
        const limit = options.limit || 50;

        // Instantly API V2 uses POST for listing leads with filters
        const requestBody = {
            limit: limit
        };

        // Add campaign filter if provided
        if (options.campaignId) {
            requestBody.campaign_id = options.campaignId;
        }

        // Add email search if provided
        if (options.search) {
            requestBody.search = options.search;
        }

        // Add pagination
        if (options.skip) {
            requestBody.skip = options.skip;
        }

        console.log('[Instantly] Listing leads with params:', JSON.stringify(requestBody));

        // Try POST /leads/list endpoint first (V2 pattern)
        let response;
        try {
            response = await withRetry(() => client.post('/leads/list', requestBody));
        } catch (postError) {
            console.log('[Instantly] POST /leads/list failed, trying GET /leads:', postError.message);
            // Fallback to GET endpoint
            const params = { limit };
            if (options.campaignId) params.campaign_id = options.campaignId;
            if (options.search) params.email = options.search;
            response = await withRetry(() => client.get('/leads', { params }));
        }

        console.log('[Instantly] Leads response status:', response.status);
        console.log('[Instantly] Leads response keys:', Object.keys(response.data || {}));

        // Parse response - handle different structures
        let rawLeads = [];
        const data = response.data;

        if (Array.isArray(data)) {
            rawLeads = data;
        } else if (data && typeof data === 'object') {
            rawLeads = data.items || data.data || data.leads || data.results || [];
        }

        // Log first raw lead for debugging field names
        if (rawLeads.length > 0) {
            console.log('[Instantly] Sample raw lead keys:', Object.keys(rawLeads[0]));
            console.log('[Instantly] Sample raw lead:', JSON.stringify(rawLeads[0]).substring(0, 1000));
        }

        // Map to consistent format - include ALL fields from Instantly
        const leads = (Array.isArray(rawLeads) ? rawLeads : []).map(lead => {
            // Instantly stores custom fields in 'payload' object!
            // Also check custom_variables as fallback
            const customVars = lead.payload || lead.custom_variables || lead.customVariables || {};

            // Also check for fields at top level and merge them
            const topLevelCustomFields = ['title', 'job_title', 'linkedin', 'linkedin_url', 'linkedIn',
                                          'position', 'industry', 'website', 'phone', 'location', 'city'];
            topLevelCustomFields.forEach(field => {
                if (lead[field] && !customVars[field]) {
                    customVars[field] = lead[field];
                }
            });

            return {
                id: lead.id,
                email: lead.email,
                firstName: lead.first_name || lead.firstName || lead.first || customVars.firstName || '',
                lastName: lead.last_name || lead.lastName || lead.last || customVars.lastName || '',
                companyName: lead.company_name || lead.companyName || lead.company || customVars.companyName || '',
                status: lead.status || lead.lead_status || 'unknown',
                campaignId: lead.campaign_id || lead.campaignId || '',
                campaignName: lead.campaign_name || lead.campaignName || '',
                customVariables: customVars,
                lastActivity: lead.last_activity || lead.lastActivity || lead.updated_at || null,
                createdAt: lead.created_at || lead.createdAt || null
            };
        });

        console.log('[Instantly] Found', leads.length, 'leads');
        if (leads.length > 0) {
            console.log('[Instantly] Sample mapped lead customVariables:', JSON.stringify(leads[0].customVariables));
        }

        // Return total count if available for pagination
        const total = data?.total || data?.totalCount || leads.length;

        return { success: true, data: leads, total };
    } catch (error) {
        console.error('[Instantly] List leads error:', error.message);
        if (error.response) {
            console.error('[Instantly] Response status:', error.response.status);
            console.error('[Instantly] Response data:', JSON.stringify(error.response.data));
        }
        return { success: false, error: translateError(error) };
    }
}

/**
 * Get a specific lead with full details including custom variables
 *
 * @param {string} apiKey - User's Instantly API key
 * @param {string} email - Lead email address
 * @param {string} [campaignId] - Optional campaign ID to narrow search
 * @param {string} [leadId] - Optional lead ID for direct lookup
 */
async function getLead(apiKey, email, campaignId = null, leadId = null) {
    try {
        const client = createClient(apiKey);
        let lead = null;

        // Try to get lead by ID first (returns full details)
        if (leadId) {
            try {
                console.log(`[Instantly] Getting lead by ID: ${leadId}`);
                const response = await withRetry(() => client.get(`/leads/${leadId}`));
                lead = response.data;
                console.log('[Instantly] Lead by ID response:', JSON.stringify(lead).substring(0, 500));
            } catch (idError) {
                console.log('[Instantly] Get by ID failed, trying email search:', idError.message);
            }
        }

        // Fallback to email search if ID lookup failed
        if (!lead) {
            const params = { email };
            if (campaignId) {
                params.campaign_id = campaignId;
            }

            console.log(`[Instantly] Searching lead by email: ${email}`);
            const response = await withRetry(() => client.get('/leads', { params }));

            let rawLeads = [];
            const data = response.data;

            if (Array.isArray(data)) {
                rawLeads = data;
            } else if (data && typeof data === 'object') {
                rawLeads = data.items || data.data || data.leads || [];
            }

            if (!rawLeads.length) {
                return { success: false, error: 'Lead not found' };
            }

            lead = rawLeads[0];
            console.log('[Instantly] Lead by email response:', JSON.stringify(lead).substring(0, 500));

            // If we got an ID from list, try to get full details
            if (lead.id && !lead.custom_variables) {
                try {
                    console.log(`[Instantly] Fetching full details for lead ID: ${lead.id}`);
                    const detailResponse = await withRetry(() => client.get(`/leads/${lead.id}`));
                    const fullLead = detailResponse.data;
                    console.log('[Instantly] Full lead details:', JSON.stringify(fullLead).substring(0, 500));
                    // Merge full details
                    lead = { ...lead, ...fullLead };
                } catch (detailError) {
                    console.log('[Instantly] Could not fetch full details:', detailError.message);
                }
            }
        }

        // Log all keys to see what Instantly returns
        console.log('[Instantly] Final lead keys:', Object.keys(lead));

        // Extract custom variables - Instantly stores them in 'payload' object!
        // Also check custom_variables as fallback
        let customVars = lead.payload || lead.custom_variables || lead.customVariables || lead.variables || {};

        console.log('[Instantly] Payload/custom vars found:', JSON.stringify(customVars).substring(0, 500));

        // Also check for fields at top level that might be custom
        const possibleCustomFields = ['title', 'job_title', 'jobTitle', 'position', 'linkedin',
                                      'linkedin_url', 'linkedIn', 'phone', 'website', 'industry',
                                      'company_size', 'revenue', 'location', 'city', 'country'];
        possibleCustomFields.forEach(field => {
            if (lead[field] && !customVars[field]) {
                customVars[field] = lead[field];
            }
        });

        console.log('[Instantly] Final extracted custom variables:', JSON.stringify(customVars));

        return {
            success: true,
            data: {
                id: lead.id,
                email: lead.email,
                firstName: lead.first_name || lead.firstName || lead.first || '',
                lastName: lead.last_name || lead.lastName || lead.last || '',
                companyName: lead.company_name || lead.companyName || lead.company || '',
                status: lead.status || lead.lead_status || 'unknown',
                campaignId: lead.campaign_id || lead.campaignId || '',
                campaignName: lead.campaign_name || lead.campaignName || '',
                customVariables: customVars,
                lastActivity: lead.last_activity || lead.lastActivity || lead.updated_at || null,
                createdAt: lead.created_at || lead.createdAt || null
            }
        };
    } catch (error) {
        console.error('[Instantly] Get lead error:', error.message);
        return { success: false, error: translateError(error) };
    }
}

module.exports = {
    testConnection,
    listCampaigns,
    pushLead,
    listLeads,
    getLead,
    translateError
};
