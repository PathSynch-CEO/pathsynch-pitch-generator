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
        console.log('[Instantly] Fetching campaigns from API...');

        const response = await withRetry(() => client.get('/campaigns', {
            params: { limit: 100 }
        }));

        console.log('[Instantly] Raw response structure:', JSON.stringify({
            hasData: !!response.data,
            dataType: typeof response.data,
            isArray: Array.isArray(response.data),
            hasNestedData: !!response.data?.data,
            keys: response.data ? Object.keys(response.data) : []
        }));

        // Extract relevant campaign info - handle both { data: [...] } and direct array
        const rawCampaigns = response.data?.data || response.data || [];
        const campaignArray = Array.isArray(rawCampaigns) ? rawCampaigns : [];

        const campaigns = campaignArray.map(campaign => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status
        }));

        console.log(`[Instantly] Found ${campaigns.length} campaigns`);

        return {
            success: true,
            data: campaigns
        };
    } catch (error) {
        console.error('[Instantly] List campaigns failed:', error.message);
        if (error.response) {
            console.error('[Instantly] Response status:', error.response.status);
            console.error('[Instantly] Response data:', JSON.stringify(error.response.data));
        }
        return {
            success: false,
            error: translateError(error)
        };
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

module.exports = {
    testConnection,
    listCampaigns,
    pushLead,
    translateError
};
