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
// Captures all paid signal types. Confirmed types:
//   'paid'           → standard Google search ad
//   'local_services' → Local Services Ad (LSA carousel)
// Defensive checks: is_paid, is_sponsored, paid, sponsored, ads_tag (present on some endpoints)

function extractPaidItems(serpData) {
  var result = [];
  var items = serpData.items || [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var signalType = null;
    var sourceField = null;

    if (item.type === 'paid') {
      signalType = 'search_ad';          sourceField = 'type';
    } else if (item.type === 'local_services') {
      signalType = 'local_services_ad';  sourceField = 'type';
    } else if (item.is_paid === true) {
      signalType = 'search_ad';          sourceField = 'is_paid';
    } else if (item.is_sponsored === true) {
      signalType = 'search_ad';          sourceField = 'is_sponsored';
    } else if (item.paid === true) {
      signalType = 'search_ad';          sourceField = 'paid';
    } else if (item.sponsored === true) {
      signalType = 'search_ad';          sourceField = 'sponsored';
    } else if (item.ads_tag) {
      signalType = 'unknown_paid';       sourceField = 'ads_tag';
    }

    if (signalType) {
      result.push({
        title:       item.title       || '',
        domain:      item.domain      || '',
        description: item.description || '',
        url:         item.url         || '',
        position:    item.rank_group  || null,
        signalType:  signalType,
        sourceField: sourceField
      });
    }
  }
  return result;
}

// ── Aggregate into Ad Spend intelligence ──────────────────────────────────────

function buildAdSpendIntelligence(queryResults, competitors) {
  if (queryResults.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  const queriesWithAds = queryResults.filter(function(r) { return r.hasAds; });

  // Build evidence array from all paid items (includes signalType from extractPaidItems)
  var evidence = [];
  queryResults.forEach(function(r) {
    (r.advertisers || []).forEach(function(ad) {
      evidence.push({
        query:        r.query,
        businessName: ad.title || ad.domain || '',
        domain:       ad.domain || null,
        signalType:   ad.signalType || 'search_ad',
        sourceField:  ad.sourceField || 'type'
      });
    });
  });

  const allAdvertiserDomains = evidence.filter(function(e) { return e.domain; }).map(function(e) { return e.domain; });
  const uniqueAdvertisers = Array.from(new Set(allAdvertiserDomains.filter(Boolean)));

  // Match advertisers to known competitors via domain, tagging signal types
  const competitorAdStatus = competitors.map(function(comp) {
    const compDomain = normalizeDomain(comp.website || comp.url || '');
    const matchingEvidence = evidence.filter(function(e) {
      const adDomain = normalizeDomain(e.domain || '');
      return compDomain && adDomain &&
        (compDomain === adDomain || compDomain.includes(adDomain) || adDomain.includes(compDomain));
    });
    const signalTypes = [];
    matchingEvidence.forEach(function(e) {
      if (e.signalType && signalTypes.indexOf(e.signalType) === -1) {
        signalTypes.push(e.signalType);
      }
    });
    return {
      name:             comp.name || comp.businessName,
      website:          comp.website || comp.url,
      runningGoogleAds: matchingEvidence.length > 0,
      adSignalTypes:    signalTypes
    };
  });

  const adSaturation = queryResults.length > 0
    ? Math.round((queriesWithAds.length / queryResults.length) * 100)
    : 0;

  const competitorsRunningAds = competitorAdStatus.filter(function(c) { return c.runningGoogleAds; }).length;

  const paidSignals = {
    searchAds:        evidence.some(function(e) { return e.signalType === 'search_ad'; }),
    localServicesAds: evidence.some(function(e) { return e.signalType === 'local_services_ad'; }),
    mapsAds:          false, // populated by mapPackProvider
    evidence:         evidence
  };

  return {
    status:               'complete',
    queriesAnalyzed:      queryResults.length,
    queriesWithAds:       queriesWithAds.length,
    adSaturation:         adSaturation + '%',
    adSaturationPct:      adSaturation,
    uniqueAdvertisers:    uniqueAdvertisers.length,
    competitorAdStatus:   competitorAdStatus,
    competitorsRunningAds: competitorsRunningAds,
    paidSignals:          paidSignals,
    pitchImplication:     generateAdSpendImplication(queriesWithAds.length, queryResults.length, uniqueAdvertisers.length, paidSignals),
    enrichedAt:           new Date().toISOString()
  };
}

// "Detected" language throughout — do not use absolute "no one is advertising" claims
function generateAdSpendImplication(withAds, total, uniqueCount, paidSignals) {
  const lsaDetected = paidSignals && paidSignals.localServicesAds;
  if (withAds === 0 && !lsaDetected) {
    return 'No paid ads were detected among known local competitors in the tracked queries. Organic and local rankings will dominate visibility.';
  }
  if (withAds < total * 0.3) {
    return 'Light paid activity detected (' + withAds + '/' + total + ' queries). SEO investment will yield outsized returns with minimal paid competition.';
  }
  if (withAds < total * 0.7) {
    return 'Moderate paid competition detected (' + uniqueCount + ' advertisers). Businesses without organic SEO are paying a premium for visibility that rankings would provide at lower long-term cost.';
  }
  return 'Heavy paid competition detected (' + uniqueCount + ' advertisers across ' + withAds + '/' + total + ' queries). Competitors are spending significantly — SEO pitch should emphasize cost savings and sustainable visibility.';
}

module.exports = { enrichAdSpend };
