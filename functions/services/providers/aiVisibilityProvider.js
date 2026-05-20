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
 * Citation Source Intelligence (Phase 1, May 19 2026):
 *   - Gemini: grounding chunks via result.response.candidates[0].groundingMetadata.groundingChunks
 *             each chunk has web.uri and web.title; multiple defensive paths supported
 *   - Perplexity: data.citations (URL strings) or data.choices[0].message.citations
 *   - classifyDomain: 6 types — Institutional, Corporate, Editorial, UGC, Reference, Other
 *   - classifyUrlType: 7 types — Homepage, Profile, Category Page, Article, Discussion, Comparison, Other
 *   - checkMentionsLead: multi-strategy (title substring, domain match, URL slug); skips names < 4 chars
 *   - buildGapAnalysis: type-weighted gap scoring (UGC=1.5, Reference=1.3, Editorial=1.2), capped 15
 *   - citationIntelligence: top 25 domains, top 50 URLs, top 15 gaps
 *   - Logging: DEBUG_CITATIONS env var only (top-level keys + citation count; never full responses)
 *
 * IMPORTANT: Results are directional signals, NOT definitive scores.
 * AI responses vary by model, time, grounding, and query.
 * All returned fields reflect this (verdict, sampleNote, confidence: 'directional').
 *
 * Cache TTL: 24 hours (short — AI results are non-deterministic).
 * Timeout: 25s (enforced by orchestrator via Promise.race).
 * Lead cap: 5 businesses checked per report.
 * Query cap: 3 AI queries per report (cost control).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const https = require('https');

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { checkAiMention } = require('./visibilityMatcher');

const CACHE_TTL_HOURS = 24;

// ── Citation domain lists ─────────────────────────────────────────────────────

const _UGC_DOMAINS = [
  'yelp.com', 'google.com', 'tripadvisor.com', 'bbb.org', 'facebook.com',
  'reddit.com', 'nextdoor.com', 'angieslist.com', 'houzz.com', 'healthgrades.com',
  'vitals.com', 'zocdoc.com', 'ratemds.com', 'birdeye.com', 'reviewtrackers.com',
  'trustpilot.com', 'g2.com', 'capterra.com', 'glassdoor.com', 'indeed.com'
];

const _REFERENCE_DOMAINS = [
  'yellowpages.com', 'angi.com', 'homeadvisor.com', 'thumbtack.com', 'manta.com',
  'chamberofcommerce.com', 'mapquest.com', 'foursquare.com', 'citysearch.com',
  'merchantcircle.com', 'local.com', 'superpages.com', 'whitepages.com',
  'hotfrog.com', 'ezlocal.com', 'findlocalpros.com'
];

const _EDITORIAL_DOMAINS = [
  'healthline.com', 'webmd.com', 'mayoclinic.org', 'nytimes.com', 'wsj.com',
  'forbes.com', 'businessinsider.com', 'inc.com', 'entrepreneur.com', 'hbr.org',
  'reuters.com', 'apnews.com', 'usatoday.com', 'washingtonpost.com', 'theguardian.com',
  'verywell.com', 'medicalnewstoday.com', 'everydayhealth.com', 'healthaffairs.org'
];

const _CORPORATE_TERMS = [
  'insurance', 'financial', 'bank', 'capital', 'consulting',
  'vendor', 'wholesale', 'supply', 'distribution', 'corporate', 'enterprise'
];

const _INTERNAL_GROUNDING_DOMAINS = [
  'vertexaisearch.cloud.google.com',
  'vertexai.google.com',
  'generativelanguage.googleapis.com'
];

// ── Citation helper functions ─────────────────────────────────────────────────

function _normalizeCitationDomain(url) {
  if (!url) return '';
  try {
    var parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch(e) {
    return url.toLowerCase().replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function _classifyDomain(domain, competitorDomains, leadDomains) {
  var d = domain.toLowerCase();
  if (competitorDomains.indexOf(d) !== -1 || leadDomains.indexOf(d) !== -1) return 'Institutional';
  for (var i = 0; i < _UGC_DOMAINS.length; i++) {
    if (d === _UGC_DOMAINS[i] || d.endsWith('.' + _UGC_DOMAINS[i])) return 'UGC';
  }
  for (var j = 0; j < _REFERENCE_DOMAINS.length; j++) {
    if (d === _REFERENCE_DOMAINS[j] || d.endsWith('.' + _REFERENCE_DOMAINS[j])) return 'Reference';
  }
  for (var k = 0; k < _EDITORIAL_DOMAINS.length; k++) {
    if (d === _EDITORIAL_DOMAINS[k] || d.endsWith('.' + _EDITORIAL_DOMAINS[k])) return 'Editorial';
  }
  for (var s = 0; s < _CORPORATE_TERMS.length; s++) {
    if (d.indexOf(_CORPORATE_TERMS[s]) !== -1) return 'Corporate';
  }
  return 'Other';
}

function _classifyUrlType(url, title) {
  var u = url.toLowerCase();
  var t = (title || '').toLowerCase();
  // Comparison — check first (before article patterns)
  if (/\/(vs|compare|alternatives|reviews?-vs|best-|top-\d)/.test(u) ||
      /\b(vs\.?|versus|compare|best \d+|top \d+)\b/.test(t)) return 'Comparison';
  // Discussion
  if (/\/(forum|thread|community|discussion|r\/\w+|questions?|answers?|talk|board)/.test(u)) return 'Discussion';
  // Profile
  if (/\/(biz\/|business\/|listing\/|profile\/|place\/|company\/|provider\/|physician\/|dentist\/|salon\/)/.test(u)) return 'Profile';
  // Category Page
  if (/\/(category\/|directory\/|find\/|search\/|browse\/|near\/|results\/|locations?\/)/.test(u)) return 'Category Page';
  // Article
  if (/\/(blog\/|articles?\/|news\/|posts?\/|health\/|advice\/|guide\/|tips\/|learn\/)/.test(u)) return 'Article';
  // Homepage: path is empty or just /
  var withoutDomain = url.replace(/^https?:\/\/[^\/]+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (!withoutDomain || withoutDomain === '/' || withoutDomain === '') return 'Homepage';
  return 'Other';
}

function _checkMentionsLead(url, title, domain, qualifiedLeads) {
  var mentioned = [];
  var urlLower = url.toLowerCase();
  var titleLower = (title || '').toLowerCase();
  var domainLower = domain.toLowerCase();

  for (var i = 0; i < qualifiedLeads.length; i++) {
    var lead = qualifiedLeads[i];
    var name = (lead.name || lead.businessName || '').trim();
    if (name.length < 4) continue;
    var nameLower = name.toLowerCase();
    var nameSlug  = nameLower.replace(/[^a-z0-9]/g, '');

    // Strategy 1: title contains business name
    if (nameLower && titleLower.indexOf(nameLower) !== -1) { mentioned.push(name); continue; }
    // Strategy 2: domain matches lead website
    var leadDomain = _normalizeCitationDomain(lead.website || lead.url || '');
    if (leadDomain && leadDomain.length >= 4 && domainLower === leadDomain) { mentioned.push(name); continue; }
    // Strategy 3: URL slug contains name slug
    var urlSlug = urlLower.replace(/[^a-z0-9]/g, '');
    if (nameSlug && nameSlug.length >= 4 && urlSlug.indexOf(nameSlug) !== -1) { mentioned.push(name); }
  }
  return mentioned;
}

function _buildCitationCollector(queryResults, qualifiedLeads) {
  var leadDomains = qualifiedLeads.map(function(l) {
    return _normalizeCitationDomain(l.website || l.url || '');
  }).filter(Boolean);

  var citationCollector = {};
  var totalQueries = queryResults.length;

  for (var qi = 0; qi < queryResults.length; qi++) {
    var urls = queryResults[qi].citationUrls || [];
    for (var ui = 0; ui < urls.length; ui++) {
      var urlItem = urls[ui];
      if (!urlItem || !urlItem.uri) continue;
      var domain = _normalizeCitationDomain(urlItem.uri);
      var isInternal = false;
      for (var gi = 0; gi < _INTERNAL_GROUNDING_DOMAINS.length; gi++) {
        if (domain === _INTERNAL_GROUNDING_DOMAINS[gi] || domain.endsWith('.' + _INTERNAL_GROUNDING_DOMAINS[gi])) {
          isInternal = true; break;
        }
      }
      if (isInternal) continue;
      if (!domain) continue;

      if (!citationCollector[domain]) {
        citationCollector[domain] = {
          retrievals:   0,
          urlEntries:   [],
          type:         _classifyDomain(domain, [], leadDomains),
          totalQueries: totalQueries
        };
      }
      citationCollector[domain].retrievals++;

      // Dedup URLs by normalized form
      var urlNorm = urlItem.uri.split('?')[0].split('#')[0].replace(/\/$/, '');
      var existing = null;
      for (var ei = 0; ei < citationCollector[domain].urlEntries.length; ei++) {
        if (citationCollector[domain].urlEntries[ei].url === urlNorm) {
          existing = citationCollector[domain].urlEntries[ei];
          break;
        }
      }
      if (existing) {
        existing.retrievals++;
      } else {
        citationCollector[domain].urlEntries.push({
          url:            urlNorm,
          title:          urlItem.title || '',
          urlType:        _classifyUrlType(urlItem.uri, urlItem.title),
          domainType:     citationCollector[domain].type,
          mentionedLeads: _checkMentionsLead(urlItem.uri, urlItem.title, domain, qualifiedLeads),
          retrievals:     1
        });
      }
    }
  }

  return citationCollector;
}

function _buildGapAnalysis(citationCollector, qualifiedLeads) {
  var TYPE_WEIGHTS = { UGC: 1.5, Reference: 1.3, Editorial: 1.2, Corporate: 0.6, Institutional: 0.3, Other: 0.5 };
  var ACTIONABLE_TYPES = ['UGC', 'Reference', 'Editorial'];

  var gaps = [];
  var keys = Object.keys(citationCollector);
  for (var i = 0; i < keys.length; i++) {
    var domain = keys[i];
    var entry  = citationCollector[domain];
    if (ACTIONABLE_TYPES.indexOf(entry.type) === -1) continue;

    var weight   = TYPE_WEIGHTS[entry.type] || 0.5;
    var gapScore = Math.round(entry.retrievals * weight * 10);
    var suggestedAction = '';
    if (entry.type === 'UGC')       suggestedAction = 'Claim and optimize profile on ' + domain;
    else if (entry.type === 'Reference') suggestedAction = 'Ensure business is listed on ' + domain;
    else if (entry.type === 'Editorial') suggestedAction = 'Build content presence on ' + domain;

    gaps.push({
      domain:          domain,
      type:            entry.type,
      retrievalRate:   entry.retrievals + '/' + (entry.totalQueries || 1),
      gapScore:        gapScore,
      suggestedAction: suggestedAction
    });
  }

  gaps.sort(function(a, b) { return b.gapScore - a.gapScore; });
  return gaps.slice(0, 15);
}

function _buildCitationIntelligence(citationCollector, totalQueries, qualifiedLeads) {
  var domainKeys = Object.keys(citationCollector);
  domainKeys.sort(function(a, b) {
    return citationCollector[b].retrievals - citationCollector[a].retrievals;
  });

  var topDomains = domainKeys.slice(0, 25).map(function(d) {
    var e = citationCollector[d];
    return {
      domain:          d,
      type:            e.type,
      retrievals:      e.retrievals,
      citationRatePct: totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) : 0,
      citationRate:    totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) + '%' : '0%'
    };
  });

  // Collect all URL entries, sort by retrievals
  var allUrls = [];
  for (var di = 0; di < domainKeys.length; di++) {
    var ue = citationCollector[domainKeys[di]].urlEntries || [];
    for (var ui = 0; ui < ue.length; ui++) { allUrls.push(ue[ui]); }
  }
  allUrls.sort(function(a, b) { return b.retrievals - a.retrievals; });

  // Type breakdown (retrievals by domain type)
  var typeBreakdown = {};
  for (var ti = 0; ti < topDomains.length; ti++) {
    var t = topDomains[ti];
    typeBreakdown[t.type] = (typeBreakdown[t.type] || 0) + t.retrievals;
  }

  return {
    totalDomainsFound: domainKeys.length,
    totalUrlsFound:    allUrls.length,
    totalQueries:      totalQueries,
    topDomains:        topDomains,
    topUrls:           allUrls.slice(0, 50),
    typeBreakdown:     typeBreakdown,
    gapAnalysis:       _buildGapAnalysis(citationCollector, qualifiedLeads),
    enrichedAt:        new Date().toISOString()
  };
}

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

  const avi = buildAiVisibilityIntelligence(queryResults, qualifiedLeads);

  // ── Citation Intelligence (Phase 1) ────────────────────────────────────────
  if (queryResults.length > 0) {
    var citationCollector = _buildCitationCollector(queryResults, qualifiedLeads);
    if (Object.keys(citationCollector).length > 0) {
      avi.citationIntelligence = _buildCitationIntelligence(citationCollector, queryResults.length, qualifiedLeads);
      if (process.env.DEBUG_CITATIONS === 'true') {
        console.log('[AIVisibility] citationIntelligence keys:', Object.keys(avi.citationIntelligence),
                    '| totalUrls:', avi.citationIntelligence.totalUrlsFound,
                    '| totalDomains:', avi.citationIntelligence.totalDomainsFound);
      }
    }
  }

  return avi;
}

// ── Gemini grounded search ────────────────────────────────────────────────────
// Pattern confirmed from geminiLeadEnricher.js (production, May 14 2026).

async function queryGeminiGrounded(query, businessNames, modelOverride) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);

  // tools: [{ googleSearch: {} }] confirmed correct — NOT google_search_retrieval
  const model = genAI.getGenerativeModel({
    model: modelOverride || 'gemini-2.5-flash',
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

  // ── Extract grounding chunks for Citation Intelligence ──────────────────────
  var citationUrls = [];
  try {
    var candidates = result.response.candidates;
    if (candidates && candidates[0]) {
      var meta = candidates[0].groundingMetadata || candidates[0].grounding_metadata;
      if (meta) {
        var chunks = meta.groundingChunks || meta.grounding_chunks || meta.retrievalResults || [];
        for (var ci = 0; ci < chunks.length; ci++) {
          var chunk = chunks[ci];
          var web   = chunk.web || chunk.webResult || null;
          if (!web && chunk.uri) { web = chunk; }
          var uri   = (web && (web.uri || web.url)) || null;
          if (uri) { citationUrls.push({ uri: uri, title: (web && web.title) || '' }); }
        }
      }
    }
  } catch(gme) { /* groundingMetadata unavailable — normal for some queries */ }

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
    citationUrls:         citationUrls,
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

          // ── Extract citations for Citation Intelligence ──────────────────────
          var citationUrls = [];
          var rawCitations = data.citations ||
                             (data.choices && data.choices[0] && data.choices[0].message &&
                              data.choices[0].message.citations) || [];
          for (var ci = 0; ci < rawCitations.length; ci++) {
            var cit = rawCitations[ci];
            if (typeof cit === 'string') {
              citationUrls.push({ uri: cit, title: '' });
            } else if (cit && (cit.url || cit.uri)) {
              citationUrls.push({ uri: cit.url || cit.uri, title: cit.title || '' });
            }
          }

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
            citationUrls:           citationUrls,
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
        query:          q.query,
        provider:       q.provider,
        model:          q.model,
        mentionedCount: q.totalMentioned,
        checkedCount:   q.totalChecked,
        checkedAt:      q.checkedAt
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

module.exports = {
  enrichAiVisibility,
  queryGeminiGrounded,
  queryPerplexity,
  _buildCitationCollector,
  _buildCitationIntelligence,
  _buildGapAnalysis,
  _classifyDomain,
  _classifyUrlType
};
