/**
 * Vertex AI Search Service
 *
 * Connects to Vertex AI Search (Discovery Engine) for searching
 * the SynchIntro knowledge base. Used to ground agent responses
 * in Sales Library content and PathSynch product knowledge.
 *
 * Project: pathconnect-442522
 * Data Store: synchintro-knowledge-base
 * Location: global
 */

const { GoogleAuth } = require('google-auth-library');

const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'pathconnect-442522';
const DATA_STORE_ID = process.env.VERTEX_SEARCH_DATA_STORE_ID ||
    'projects/pathconnect-442522/locations/global/collections/default_collection/dataStores/synchintro-knowledge-base_1774560525810';

// Extract just the data store name if a full resource path is provided
function getDataStoreName() {
    if (DATA_STORE_ID.includes('/')) {
        return DATA_STORE_ID;
    }
    return `projects/${GCP_PROJECT}/locations/global/collections/default_collection/dataStores/${DATA_STORE_ID}`;
}

const SEARCH_ENDPOINT = `https://discoveryengine.googleapis.com/v1/${getDataStoreName()}/servingConfigs/default_search:search`;

let authClient = null;

/**
 * Get authenticated client for Vertex AI Search
 */
async function getAuthClient() {
    if (!authClient) {
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        authClient = await auth.getClient();
    }
    return authClient;
}

/**
 * Search the SynchIntro knowledge base
 *
 * @param {string} query - Search query
 * @param {Object} options
 * @param {number} options.maxResults - Maximum results to return (default: 5)
 * @returns {Promise<Array<{title: string, snippet: string, link: string}>>}
 */
async function searchKnowledgeBase(query, options = {}) {
    if (!query) return [];

    if (!process.env.VERTEX_SEARCH_DATA_STORE_ID && !process.env.GCP_PROJECT_ID) {
        console.warn('[VertexSearch] VERTEX_SEARCH_DATA_STORE_ID not configured — skipping');
        return [];
    }

    const maxResults = options.maxResults || 5;

    try {
        const client = await getAuthClient();

        const response = await client.request({
            url: SEARCH_ENDPOINT,
            method: 'POST',
            data: {
                query: query,
                pageSize: maxResults,
                queryExpansionSpec: {
                    condition: 'AUTO',
                },
                spellCorrectionSpec: {
                    mode: 'AUTO',
                },
            },
            timeout: 8000,
        });

        const results = (response.data.results || []).map(result => {
            const doc = result.document || {};
            const derivedData = doc.derivedStructData || {};
            const structData = doc.structData || {};

            return {
                title: derivedData.title || structData.title || doc.name || 'Untitled',
                snippet: derivedData.snippets?.[0]?.snippet ||
                    derivedData.extractive_answers?.[0]?.content ||
                    structData.description || '',
                link: derivedData.link || structData.url || '',
                relevanceScore: result.relevanceScore || null,
            };
        });

        console.log(`[VertexSearch] Found ${results.length} results for "${query.substring(0, 50)}..."`);
        return results;

    } catch (error) {
        // Graceful degradation: log and return empty
        if (error.response?.status === 404) {
            console.warn('[VertexSearch] Data store not found — check VERTEX_SEARCH_DATA_STORE_ID');
        } else if (error.response?.status === 403) {
            console.warn('[VertexSearch] Permission denied — check service account permissions');
        } else {
            console.error('[VertexSearch] Search failed:', error.message);
        }
        return [];
    }
}

/**
 * Grounded search — includes additional context for better results
 *
 * @param {string} query - Search query
 * @param {string} context - Additional context to include in the query
 * @returns {Promise<Array<{title: string, snippet: string, link: string}>>}
 */
async function groundedSearch(query, context = '') {
    const enrichedQuery = context
        ? `${query} | Context: ${context}`
        : query;

    return searchKnowledgeBase(enrichedQuery, { maxResults: 5 });
}

module.exports = { searchKnowledgeBase, groundedSearch };
