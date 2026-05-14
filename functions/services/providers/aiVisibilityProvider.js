'use strict';

/**
 * aiVisibilityProvider.js
 * Check how often competitor businesses are mentioned in AI-generated recommendation responses.
 * Uses Gemini 2.5 Flash with Google Search grounding as primary provider.
 * Falls back to Perplexity if PERPLEXITY_API_KEY is set and Gemini fails.
 *
 * CONFIRMED PATTERN (test-ai-visibility.cjs, May 14 2026):
 *   - SDK: @google/generative-ai (same as geminiLeadEnricher.js)
 *   - Model: gemini-2.5-flash
 *   - Grounding tools: [{ googleSearch: {} }]   ← NOT google_search_retrieval
 *   - Response: result.response.text()           ← plain string
 *   - thinkingBudget: 0 required (prevents thinking tokens leaking into output)
 *   - Business mention: checkAiMention() token overlap ≥50% threshold ✓
 *
 * IMPORTANT: Results are directional signals, NOT definitive scores.
 * AI responses vary by model, time, grounding, and query.
 * All returned fields reflect this (verdict, sampleNote, confidence: 'directional').
 *
 * Cache TTL: 24 hours (short — AI results are non-deterministic).
 * Timeout: 15s (enforced by orchestrator via Promise.race).
 * Lead cap: 5 businesses checked per report.
 * Query cap: 3 AI queries per report (cost control).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const https = require('https');

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { checkAiMention } = require('./visibilityMatcher');

const CACHE_TTL_HOURS = 24;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check AI visibility for qualified leads.
 * @param {Array} qualifiedLeads  - leads from market report
 * @param {Object} options        - { city, state, industry, subIndustry, industryConfig }
 * @returns {Object} aiVisibilityIntelligence
 */
async function enrichAiVisibility(qualifiedLeads, options) {
  const { city, state, subIndustry, industryConfig } = options;

  const queries = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'ai');

  // Collect business names to check (max 5)
  const businessNames = qualifiedLeads
    .slice(0, 5)
    .map(function(l) { return l.name || l.businessName || ''; })
    .filter(Boolean);

  if (businessNames.length === 0) {
    return { status: 'unavailable', reason: 'no_business_names', enrichedAt: new Date().toISOString() };
  }

  const queryResults = [];

  for (var i = 0; i < queries.length; i++) {
    const query    = queries[i];
    const cacheKey = 'aivisibility_' + normalizeCacheKey(query) + '_' + normalizeCacheKey(city) + '_' + normalizeCacheKey(state);
    const cached   = await readVisibilityCache(cacheKey);

    if (cached) {
      queryResults.push(cached);
      continue;
    }

    // Try Gemini grounded first, then Perplexity fallback
    var queryResult = null;

    try {
      queryResult = await queryGeminiGrounded(query, businessNames);
    } catch (geminiErr) {
      console.error('[AIVisibility] Gemini failed for "' + query + '":', geminiErr.message);

      // Perplexity fallback — only if key is set
      const perpKey = process.env.PERPLEXITY_API_KEY;
      if (perpKey) {
        try {
          queryResult = await queryPerplexity(query, businessNames, perpKey);
        } catch (perpErr) {
          console.error('[AIVisibility] Perplexity fallback also failed for "' + query + '":', perpErr.message);
        }
      } else {
        console.log('[AIVisibility] No PERPLEXITY_API_KEY — skipping fallback for "' + query + '"');
      }
    }

    if (queryResult) {
      queryResults.push(queryResult);
      await writeVisibilityCache(cacheKey, queryResult, CACHE_TTL_HOURS, 'ai_visibility');
    }
  }

  return buildAiVisibilityIntelligence(queryResults, qualifiedLeads);
}

// ── Gemini grounded search ────────────────────────────────────────────────────
// Pattern confirmed from geminiLeadEnricher.js (production, May 14 2026).

async function queryGeminiGrounded(query, businessNames) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);

  // tools: [{ googleSearch: {} }] confirmed correct — NOT google_search_retrieval
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    tools: [{ googleSearch: {} }]
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: query }] }],
    generationConfig: {
      temperature:     0.1,
      maxOutputTokens: 1024,
      thinkingConfig:  { thinkingBudget: 0 }
    }
  });

  // result.response.text() returns a plain string (confirmed by test)
  const responseText = result.response.text();

  const mentioned    = businessNames.filter(function(name) { return checkAiMention(responseText, name); });
  const notMentioned = businessNames.filter(function(name) { return !checkAiMention(responseText, name); });

  return {
    query:                query,
    provider:             'gemini_grounded',
    model:                'gemini-2.5-flash',
    responseSummary:      responseText.slice(0, 500),
    mentionedBusinesses:  mentioned,
    notMentionedBusinesses: notMentioned,
    totalMentioned:       mentioned.length,
    totalChecked:         businessNames.length,
    checkedAt:            new Date().toISOString()
  };
}

// ── Perplexity fallback ───────────────────────────────────────────────────────

function queryPerplexity(query, businessNames, apiKey) {
  return new Promise(function(resolve, reject) {
    const body    = JSON.stringify({
      model:    'sonar',
      messages: [{ role: 'user', content: query }]
    });

    const req = https.request({
      hostname: 'api.perplexity.ai',
      path:     '/chat/completions',
      method:   'POST',
      headers:  {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('Perplexity HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
        try {
          const data         = JSON.parse(d);
          const responseText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
          const model        = data.model || 'sonar';

          const mentioned    = businessNames.filter(function(name) { return checkAiMention(responseText, name); });
          const notMentioned = businessNames.filter(function(name) { return !checkAiMention(responseText, name); });

          resolve({
            query:                  query,
            provider:               'perplexity',
            model:                  model,
            responseSummary:        responseText.slice(0, 500),
            mentionedBusinesses:    mentioned,
            notMentionedBusinesses: notMentioned,
            totalMentioned:         mentioned.length,
            totalChecked:           businessNames.length,
            checkedAt:              new Date().toISOString()
          });
        } catch(e) {
          reject(new Error('Perplexity JSON parse: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, function() { req.destroy(); reject(new Error('Perplexity timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Aggregate intelligence ────────────────────────────────────────────────────

function buildAiVisibilityIntelligence(queryResults, leads) {
  if (queryResults.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  const providers = Array.from(new Set(queryResults.map(function(q) { return q.provider; })));
  const models    = Array.from(new Set(queryResults.map(function(q) { return q.model; }).filter(Boolean)));

  // Per-lead mention rate across all queries
  const leadScores = leads.slice(0, 5).map(function(lead) {
    const name = lead.name || lead.businessName || '';
    if (!name) return null;

    const mentionCount = queryResults.filter(function(qr) {
      return (qr.mentionedBusinesses || []).some(function(m) {
        return m.toLowerCase() === name.toLowerCase();
      });
    }).length;

    const mentionRate = queryResults.length > 0
      ? Math.round((mentionCount / queryResults.length) * 100)
      : 0;

    // Verdict is explicitly directional — never framed as definitive score
    var verdict;
    if (mentionRate >= 66)      verdict = 'frequently_mentioned';
    else if (mentionRate >= 33) verdict = 'sometimes_mentioned';
    else                        verdict = 'not_mentioned_in_sample';

    return {
      businessName:   name,
      mentionRate:    mentionRate,       // percentage, NOT "aiVisibilityScore"
      mentionedIn:    mentionCount,
      queriesChecked: queryResults.length,
      verdict:        verdict
    };
  }).filter(Boolean);

  const avgMentionRate   = leadScores.length > 0
    ? Math.round(leadScores.reduce(function(s, l) { return s + l.mentionRate; }, 0) / leadScores.length)
    : 0;
  const notMentionedCount = leadScores.filter(function(l) { return l.verdict === 'not_mentioned_in_sample'; }).length;

  return {
    status:     'complete',
    confidence: 'directional', // ALWAYS directional — AI results are non-deterministic
    queriesRun: queryResults.length,
    providers:  providers,
    models:     models,
    sampleNote: queryResults.length + ' prompts checked across ' + providers.join(' and ') + '. Results are a directional signal and may vary.',
    leadScores: leadScores,
    marketSummary: {
      avgMentionRate:        avgMentionRate,
      notMentionedInSample:  notMentionedCount,
      totalLeadsChecked:     leadScores.length,
      pitchImplication:      generateAiVisibilityImplication(avgMentionRate, notMentionedCount, leadScores.length)
    },
    // Query details for transparency
    queryDetails: queryResults.map(function(q) {
      return {
        query:         q.query,
        provider:      q.provider,
        model:         q.model,
        mentionedCount: q.totalMentioned,
        checkedCount:  q.totalChecked,
        checkedAt:     q.checkedAt
      };
    }),
    enrichedAt: new Date().toISOString()
  };
}

// Generic language — no vertical-specific terms
function generateAiVisibilityImplication(avgRate, notMentioned, total) {
  if (avgRate < 20) {
    return 'Low AI mention rate across sampled recommendation prompts. ' + notMentioned + ' of ' + total + ' businesses checked were not mentioned. Early movers who optimize for AI citations can capture visibility their competitors are missing.';
  }
  if (avgRate < 50) {
    return 'Most businesses in this market have low AI mention rates. AI assistants are directing searchers to only a few dominant players — unranked businesses are invisible in AI-driven discovery.';
  }
  return 'Moderate AI mention rates across this market. Some businesses are being cited, but there is room to improve AI-powered discovery for those not appearing consistently.';
}

module.exports = { enrichAiVisibility };
