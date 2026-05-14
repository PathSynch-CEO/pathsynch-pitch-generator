'use strict';

/**
 * visibilityEnrichmentService.js
 * Orchestrator — runs all enabled visibility enrichments in parallel.
 * Non-blocking: failures are logged and skipped, never surface to caller.
 *
 * Feature flags (functions/.env):
 *   ENABLE_MAP_PACK_ENRICHMENT=true|false       Phase 1A — DataForSEO Google Maps SERP
 *   ENABLE_AD_SPEND_ENRICHMENT=true|false        Phase 1B — DataForSEO Google Organic SERP
 *   ENABLE_WEBSITE_SIGNALS_ENRICHMENT=true|false Phase 2  — Google PageSpeed Insights
 *   ENABLE_AI_VISIBILITY_ENRICHMENT=true|false   Phase 3  — Gemini grounded + Perplexity
 *
 * @param {Object} reportData - the market report data object
 * @param {Object} options    - { city, state, industry, subIndustry, industryConfig, qualifiedLeads[] }
 * @returns {Object|null} { mapPackIntelligence?, adSpendIntelligence?, websiteConversionSignals?, aiVisibilityIntelligence? }
 */

const { enrichMapPack } = require('./providers/mapPackProvider');

async function enrichVisibility(reportData, options) {
  const results = {};
  const {
    city, state, industry, subIndustry, industryConfig,
    qualifiedLeads = []
  } = options;

  const enableMapPack = process.env.ENABLE_MAP_PACK_ENRICHMENT === 'true';
  const enableAdSpend = process.env.ENABLE_AD_SPEND_ENRICHMENT === 'true';
  const enableWebsite = process.env.ENABLE_WEBSITE_SIGNALS_ENRICHMENT === 'true';
  const enableAiVis   = process.env.ENABLE_AI_VISIBILITY_ENRICHMENT === 'true';

  const tasks = [];

  // Phase 1A: Map Pack (Google Maps SERP)
  if (enableMapPack) {
    tasks.push(
      Promise.race([
        enrichMapPack(reportData, { city, state, industry, subIndustry, industryConfig })
          .then(function(r) { results.mapPackIntelligence = r; }),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('Map Pack timeout')); }, 12000);
        })
      ]).catch(function(err) {
        console.error('[VisibilityEnrichment] Map Pack error (non-blocking):', err.message);
      })
    );
  }

  // Phase 1B: Ad Spend — not yet implemented, flag guards the require()
  if (enableAdSpend) {
    tasks.push(
      Promise.race([
        (function() {
          try {
            const { enrichAdSpend } = require('./providers/adSpendProvider');
            return enrichAdSpend(reportData, { city, state, industry, subIndustry, industryConfig })
              .then(function(r) { results.adSpendIntelligence = r; });
          } catch (e) {
            return Promise.reject(new Error('adSpendProvider not implemented: ' + e.message));
          }
        })(),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('Ad Spend timeout')); }, 12000);
        })
      ]).catch(function(err) {
        console.error('[VisibilityEnrichment] Ad Spend error (non-blocking):', err.message);
      })
    );
  }

  // Phase 2: Website Conversion Signals — not yet implemented
  if (enableWebsite) {
    tasks.push(
      Promise.race([
        (function() {
          try {
            const { enrichWebsiteSignals } = require('./providers/websiteSignalsProvider');
            return enrichWebsiteSignals(qualifiedLeads.slice(0, 3))
              .then(function(r) { results.websiteConversionSignals = r; });
          } catch (e) {
            return Promise.reject(new Error('websiteSignalsProvider not implemented: ' + e.message));
          }
        })(),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('Website signals timeout')); }, 20000);
        })
      ]).catch(function(err) {
        console.error('[VisibilityEnrichment] Website signals error (non-blocking):', err.message);
      })
    );
  }

  // Phase 3: AI Visibility — not yet implemented
  if (enableAiVis) {
    tasks.push(
      Promise.race([
        (function() {
          try {
            const { enrichAiVisibility } = require('./providers/aiVisibilityProvider');
            return enrichAiVisibility(qualifiedLeads, { city, state, industry, subIndustry, industryConfig })
              .then(function(r) { results.aiVisibilityIntelligence = r; });
          } catch (e) {
            return Promise.reject(new Error('aiVisibilityProvider not implemented: ' + e.message));
          }
        })(),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('AI visibility timeout')); }, 15000);
        })
      ]).catch(function(err) {
        console.error('[VisibilityEnrichment] AI visibility error (non-blocking):', err.message);
      })
    );
  }

  await Promise.allSettled(tasks);

  return Object.keys(results).length > 0 ? results : null;
}

module.exports = { enrichVisibility };
