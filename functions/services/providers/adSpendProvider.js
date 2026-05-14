'use strict';

/**
 * adSpendProvider.js
 * Detect which competitors are running Google Ads.
 * Uses DataForSEO Google Organic SERP — extracts paid result items.
 * This is a DIFFERENT SERP surface from the Maps endpoint used by Map Pack.
 *
 * CONFIRMED FIELD NAMES (test-dataforseo-organic.cjs, May 14 2026):
 *   - Request: location_coordinate required (location_name is INVALID — same as Maps endpoint)
 *   - Paid item type: "paid" (filter out local_pack, organic, local_services, etc.)
 *   - item.title       — ad headline
 *   - item.domain      — advertiser domain (e.g. "book.zocdoc.com")
 *   - item.description — ad description text
 *   - item.url         — destination URL
 *   - item.rank_group  — position within paid results (1-based)
 *   - item.position    — "left" (top/main) or "right"/"bottom"
 */

const https = require('https');
const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { normalizeDomain } = require('./visibilityMatcher');

const DATAFORSEO_BASE = 'api.dataforseo.com';
const CACHE_TTL_HOURS = 72;

// ── Geocode city+state → lat/lng ──────────────────────────────────────────────
const _geocodeCache = {};

async function geocodeCity(city, state) {
  const key = (city + ',' + state).toLowerCase();
  if (_geocodeCache[key]) return _geocodeCache[key];

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set — required for Ad Spend geocoding');

  const address = encodeURIComponent(city + ',' + state + ',United States');
  const data = await httpsGet('https://maps.googleapis.com/maps/api/geocode/json?address=' + address + '&key=' + apiKey);
  const result = data.results && data.results[0];
  if (!result) throw new Error('Geocoding returned no results for ' + city + ', ' + state);

  const loc = result.geometry.location;
  const coords = { lat: loc.lat, lng: loc.lng };
  _geocodeCache[key] = coords;
  return coords;
}

// ── HTTP helpers (no deps) ────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' }, function(res) {
      let d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('Geocode timeout')); });
    req.end();
  });
}

function httpsPost(body, headers) {
  return new Promise(function(resolve, reject) {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: DATAFORSEO_BASE,
      path: '/v3/serp/google/organic/live/advanced',
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      })
    }, function(res) {
      let d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('DataForSEO Organic HTTP ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('DataForSEO Organic timeout')); });
    req.write(bodyStr); req.end();
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect which competitors are running Google Ads.
 * @param {Object} reportData - market report data (competitors[], etc.)
 * @param {Object} options    - { city, state, industry, subIndustry, industryConfig }
 * @returns {Object} adSpendIntelligence
 */
async function enrichAdSpend(reportData, options) {
  const { city, state, industry, subIndustry, industryConfig } = options;

  const queries     = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'local');
  const competitors = (reportData.competitors) ||
                      (reportData.data && reportData.data.competitors) || [];

  // Geocode once for all queries
  let coords;
  try {
    coords = await geocodeCity(city, state);
  } catch (geoErr) {
    console.error('[AdSpend] Geocoding failed:', geoErr.message);
    return { status: 'unavailable', reason: 'geocode_failed', enrichedAt: new Date().toISOString() };
  }

  const locationCoordinate = coords.lat + ',' + coords.lng + ',10000';
  const queryResults = [];

  for (var i = 0; i < queries.length; i++) {
    const query    = queries[i];
    const cacheKey = 'adspend_' + normalizeCacheKey(query) + '_' + normalizeCacheKey(city) + '_' + normalizeCacheKey(state);
    const cached   = await readVisibilityCache(cacheKey);

    if (cached) {
      queryResults.push(cached);
      continue;
    }

    try {
      const serpData = await callOrganicSERP(query, locationCoordinate);
      const paidItems = extractPaidItems(serpData);

      const result = {
        query:       query,
        hasAds:      paidItems.length > 0,
        adCount:     paidItems.length,
        advertisers: paidItems
      };

      queryResults.push(result);
      await writeVisibilityCache(cacheKey, result, CACHE_TTL_HOURS, 'ad_spend');

    } catch (err) {
      console.error('[AdSpend] Organic SERP failed for "' + query + '":', err.message);
    }
  }

  return buildAdSpendIntelligence(queryResults, competitors);
}

// ── DataForSEO Organic SERP call ──────────────────────────────────────────────

async function callOrganicSERP(query, locationCoordinate) {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DATAFORSEO credentials not set');

  const auth    = Buffer.from(login + ':' + password).toString('base64');
  const payload = [{
    keyword:             query,
    location_coordinate: locationCoordinate,  // CONFIRMED: location_name is invalid
    language_code:       'en',
    depth:               10
  }];

  const data = await httpsPost(payload, { 'Authorization': 'Basic ' + auth });

  const task = data.tasks && data.tasks[0];
  if (!task || task.status_code !== 20000) {
    throw new Error('DataForSEO Organic task error: ' + (task && task.status_message));
  }

  return (task.result && task.result[0]) || {};
}

// ── Extract paid items ────────────────────────────────────────────────────────
// Filters to type === 'paid' only. Other types (local_pack, organic, local_services) are ignored.

function extractPaidItems(serpData) {
  const items = (serpData.items || []).filter(function(i) { return i.type === 'paid'; });
  return items.map(function(item) {
    return {
      title:       item.title       || '',
      domain:      item.domain      || '',
      description: item.description || '',
      url:         item.url         || '',
      position:    item.rank_group  || null
    };
  });
}

// ── Aggregate into Ad Spend intelligence ──────────────────────────────────────

function buildAdSpendIntelligence(queryResults, competitors) {
  if (queryResults.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  const queriesWithAds     = queryResults.filter(function(r) { return r.hasAds; });
  const allAdvertiserDomains = queryResults.reduce(function(acc, r) {
    return acc.concat((r.advertisers || []).map(function(a) { return a.domain; }));
  }, []);
  const uniqueAdvertisers = Array.from(new Set(allAdvertiserDomains.filter(Boolean)));

  // Match advertisers to known competitors via domain
  const competitorAdStatus = competitors.map(function(comp) {
    const compDomain = normalizeDomain(comp.website || comp.url || '');
    const isAdvertising = uniqueAdvertisers.some(function(ad) {
      const adDomain = normalizeDomain(ad);
      return compDomain && adDomain &&
        (compDomain === adDomain || compDomain.includes(adDomain) || adDomain.includes(compDomain));
    });
    return {
      name:            comp.name || comp.businessName,
      website:         comp.website || comp.url,
      runningGoogleAds: isAdvertising
    };
  });

  const adSaturation = queryResults.length > 0
    ? Math.round((queriesWithAds.length / queryResults.length) * 100)
    : 0;

  const competitorsRunningAds = competitorAdStatus.filter(function(c) { return c.runningGoogleAds; }).length;

  return {
    status:              'complete',
    queriesAnalyzed:     queryResults.length,
    queriesWithAds:      queriesWithAds.length,
    adSaturation:        adSaturation + '%',
    uniqueAdvertisers:   uniqueAdvertisers.length,
    competitorAdStatus:  competitorAdStatus,
    competitorsRunningAds: competitorsRunningAds,
    pitchImplication:    generateAdSpendImplication(queriesWithAds.length, queryResults.length, uniqueAdvertisers.length),
    enrichedAt:          new Date().toISOString()
  };
}

// Generic language — no vertical-specific terms
function generateAdSpendImplication(withAds, total, uniqueCount) {
  if (withAds === 0) {
    return 'No competitors running Google Ads for these search terms. Organic rankings will dominate visibility with no paid competition.';
  }
  if (withAds < total * 0.3) {
    return 'Light ad competition (' + withAds + '/' + total + ' queries show ads). SEO investment will yield outsized returns with minimal paid competition.';
  }
  if (withAds < total * 0.7) {
    return 'Moderate ad competition (' + uniqueCount + ' advertisers). Businesses without organic SEO are paying a premium for visibility that rankings would provide at lower long-term cost.';
  }
  return 'Heavy ad competition (' + uniqueCount + ' advertisers across ' + withAds + '/' + total + ' queries). Competitors are spending significantly on ads — SEO pitch should emphasize cost savings and sustainable visibility.';
}

module.exports = { enrichAdSpend };
