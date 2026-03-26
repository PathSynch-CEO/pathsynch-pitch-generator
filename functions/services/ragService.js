/**
 * RAG Service Client
 *
 * Handles communication with the PathSynch RAG microservice
 * (Cloud Run at RAG_SERVICE_URL). Provides ingest and retrieve operations.
 *
 * Ingest calls are always fire-and-forget — they never block pitch generation.
 * Retrieve calls are awaited but have a short timeout with graceful fallback.
 */

const axios = require('axios');

/**
 * Get the RAG service base URL from environment / Firebase secrets
 * @returns {string|null}
 */
function getRAGServiceUrl() {
  return process.env.RAG_SERVICE_URL || null;
}

/**
 * Fire-and-forget: ingest a document into the RAG index.
 * Never throws — logs errors and moves on.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Firebase userId
 * @param {string} params.libraryType - e.g. 'sales_library'
 * @param {string} params.documentId - Firestore document ID
 * @param {string} params.sourceTitle - Document filename / title
 * @param {string} [params.content] - Optional text content to ingest
 * @param {Object} [params.metadata] - Optional metadata (e.g. { source: 'seller_profile' })
 * @returns {Promise<string|null>} ragDocumentId if returned by service, else null
 */
async function ingestDocument({ tenantId, libraryType, documentId, sourceTitle, content, metadata }) {
  const baseUrl = getRAGServiceUrl();
  if (!baseUrl) {
    console.warn('[RAG] RAG_SERVICE_URL not configured — skipping ingest');
    return null;
  }

  try {
    const payload = {
      tenantId,
      libraryType,
      documentId,
      sourceTitle
    };

    if (content) {
      payload.content = content;
    }

    if (metadata) {
      payload.metadata = metadata;
    }

    console.log(`[RAG] Ingesting document ${documentId} for tenant ${tenantId}`);

    const response = await axios.post(`${baseUrl}/ingest`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000 // 10s timeout — fire-and-forget should not block long
    });

    const ragDocumentId = response.data?.ragDocumentId || response.data?.id || null;
    console.log(`[RAG] Ingest success for ${documentId}, ragDocumentId: ${ragDocumentId}`);
    return ragDocumentId;
  } catch (error) {
    console.error(`[RAG] Ingest failed for ${documentId}:`, error.message);
    return null;
  }
}

/**
 * Retrieve relevant chunks from the RAG index for a query.
 * Has a short timeout — if RAG is unavailable, returns empty array
 * so pitch generation falls back to existing behavior.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Firebase userId
 * @param {string} params.libraryType - e.g. 'sales_library'
 * @param {string} params.query - Search query (e.g. prospect businessName + industry + objective)
 * @param {number} [params.topK=5] - Number of chunks to retrieve
 * @returns {Promise<Array<{content: string, source: string, score: number}>>}
 */
async function retrieveChunks({ tenantId, libraryType, query, topK = 5 }) {
  const baseUrl = getRAGServiceUrl();
  if (!baseUrl) {
    console.warn('[RAG] RAG_SERVICE_URL not configured — skipping retrieve');
    return [];
  }

  try {
    const response = await axios.post(`${baseUrl}/retrieve`, {
      tenantId,
      libraryType,
      query,
      topK
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000 // 5s timeout — don't block pitch generation
    });

    const chunks = response.data?.chunks || response.data?.results || [];
    console.log(`[RAG] Retrieved ${chunks.length} chunks for tenant ${tenantId}`);
    return chunks;
  } catch (error) {
    console.error('[RAG] Retrieve failed:', error.message);
    return [];
  }
}

module.exports = {
  ingestDocument,
  retrieveChunks
};
