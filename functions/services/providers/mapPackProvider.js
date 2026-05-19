'use strict';

/**
 * mapPackProvider.js
 * Get Map Pack (local 3-pack) rankings for key search terms.
 * Uses DataForSEO Google Maps SERP endpoint.
 *
 * CONFIRMED FIELD NAMES (test-dataforseo-maps.cjs, May 14 2026):
 *   - Request: location_coordinate (NOT location_name — that field is invalid)
 *   - Item type: "maps_search" (filter out "maps_paid_item")
 *   - item.rank_group    — 1-based position within organic map results
 *   - item.title         — business name
 *   - item.rating.value  — star rating
 *   - item.rating.votes_count — review count
 *   - item.address       — full address string
 *   - item.place_id      — Google place ID (snake_case, NOT camelCase)
 *   - item.domain        — website domain (may include www prefix)
 */

const https = require('https');
const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { matchSerpToCompetitor } = require('./visibilityMatcher');

const DATAFORSEO_BASE = 'api.dataforseo.com';
const CACHE_TTL_HOURS = 72;

// ── Geocode city+state → lat/lng ──────────────────────────────────────────────
// Uses existing GOOGLE_PLACES_API_KEY (Google Geocoding API, same key works).
// Results cached in-process per city+state for the lifetime of the function invocation.
const _geocodeCache = {};

async function geocodeCity(city, state) {
  const key = (city + ',' + state).toLowerCase();
  if (_geocodeCache[key]) return _geocodeCache[key];

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set — required for Map Pack geocoding');

  const address = encodeURIComponent(city + ',' + state + ',United States');
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + address + '&key=' + apiKey;

  const data = await httpsGet(url);
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
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET'
    };
    const req = https.request(options, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('JSON parse: ' + e.message)); }
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
    const options = {
      hostname: DATAFORSEO_BASE,
      path: '/v3/serp/google/maps/live/advanced',
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      })
    };
    const req = https.request(options, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('DataForSEO Maps HTTP ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('DataForSEO Maps timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Get Map Pack rankings for key search terms.
 * @param {Object} reportData - market report data (competitors[], etc.)
 * @param {Object} options    - { city, state, industry, subIndustry, industryConfig }
 * @returns {Object} mapPackIntelligence
 */
async function enrichMapPack(reportData, options) {
  const { city, state, industry, subIndustry, industryConfig } = options;

  const queries     = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'local');
  const competitors = (reportData.competitors) ||
                      (reportData.data && reportData.data.competitors) || [];

  // Geocode once for all queries
  let coords;
  try {
    coords = await geocodeCity(city, state);
  } catch (geoErr) {
    console.error('[MapPack] Geocoding failed:', geoErr.message);
    return { status: 'unavailable', reason: 'geocode_failed', enrichedAt: new Date().toISOString() };
  }

  const locationCoordinate = coords.lat + ',' + coords.lng + ',10000'; // 10km radius
  const queryAnalysis = [];

  for (var i = 0; i < queries.length; i++) {
    const query    = queries[i];
    const cacheKey = 'mappack_' + normalizeCacheKey(query) + '_' + normalizeCacheKey(city) + '_' + normalizeCacheKey(state);
    const cached   = await readVisibilityCache(cacheKey);

    if (cached) {
      queryAnalysis.push(cached);
      continue;
    }

    try {
      const serpData = await callMapsSERP(query, locationCoordinate);
      const extracted = extractMapResults(serpData);
      const mapsAdEvidence = extracted.mapsAdEvidence || [];

      const matchedResults = extracted.results.map(function(item) {
        const match = matchSerpToCompetitor(item, competitors);
        return Object.assign({}, item, {
          matchedCompetitor: match ? (match.business.name || match.business.businessName) : null,
          matchType:         match ? match.matchType  : null,
          matchConfidence:   match ? match.confidence : null
        });
      });

      const result = {
        query:                    query,
        topThree:                 matchedResults.filter(function(r) { return r.inTopThree; }),
        allResults:               matchedResults,
        totalResults:             matchedResults.length,
        knownCompetitorsInPack:   matchedResults.filter(function(r) { return r.matchedCompetitor && r.inTopThree; }).length,
        mapsAdEvidence:           mapsAdEvidence
      };

      queryAnalysis.push(result);
      await writeVisibilityCache(cacheKey, result, CACHE_TTL_HOURS, 'map_pack');

    } catch (err) {
      console.error('[MapPack] SERP call failed for "' + query + '":', err.message);
    }
  }

  return buildMapPackIntelligence(queryAnalysis, competitors);
}

// ── DataForSEO Maps SERP call ─────────────────────────────────────────────────

async function callMapsSERP(query, locationCoordinate) {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DATAFORSEO credentials not set');

  const auth    = Buffer.from(login + ':' + password).toString('base64');
  const payload = [{
    keyword:             query,
    location_coordinate: locationCoordinate,  // CONFIRMED: location_name is invalid for this endpoint
    language_code:       'en',
    depth:               20
  }];

  const data = await httpsPost(payload, { 'Authorization': 'Basic ' + auth });

  const task = data.tasks && data.tasks[0];
  if (!task || task.status_code !== 20000) {
    throw new Error('DataForSEO Maps task error: ' + (task && task.status_message));
  }

  return (task.result && task.result[0]) || {};
}

// ── Extract organic map results + paid Maps signals ───────────────────────────
// Organic: maps_search items only. Confirmed type from test (May 14 2026).
// Paid:    maps_paid_item items (DataForSEO Maps paid listings).
// Defensive: also checks is_paid/is_sponsored/paid/sponsored/ads_tag on organic items.

function extractMapResults(serpData) {
  var items = serpData.items || [];
  var mapsAdEvidence = [];

  // Capture paid Maps listings (maps_paid_item type)
  items.filter(function(i) { return i.type === 'maps_paid_item'; }).forEach(function(item) {
    mapsAdEvidence.push({
      title:      item.title    || '',
      domain:     item.domain   || null,
      place_id:   item.place_id || null,
      signalType: 'maps_ad',
      sourceField: 'type'
    });
  });

  // Organic results — also check for paid indicator fields
  var organicItems = items.filter(function(i) { return i.type === 'maps_search'; });
  organicItems.forEach(function(item) {
    var sf = null;
    if      (item.is_paid === true)         sf = 'is_paid';
    else if (item.is_sponsored === true)    sf = 'is_sponsored';
    else if (item.paid === true)            sf = 'paid';
    else if (item.sponsored === true)       sf = 'sponsored';
    else if (item.ads_tag)                  sf = 'ads_tag';
    if (sf) {
      mapsAdEvidence.push({
        title:       item.title    || '',
        domain:      item.domain   || null,
        place_id:    item.place_id || null,
        signalType:  'maps_ad',
        sourceField: sf
      });
    }
  });

  var results = organicItems.slice(0, 10).map(function(item) {
    return {
      position:    item.rank_group,
      title:       item.title || '',
      rating:      (item.rating && item.rating.value)       || null,
      reviewCount: (item.rating && item.rating.votes_count) || null,
      address:     item.address || null,
      place_id:    item.place_id || null,   // confirmed snake_case
      domain:      item.domain  || null,
      inTopThree:  item.rank_group <= 3
    };
  });

  return { results: results, mapsAdEvidence: mapsAdEvidence };
}

// ── Aggregate query results into Map Pack intelligence ────────────────────────

function buildMapPackIntelligence(queryAnalysis, competitors) {
  if (queryAnalysis.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  // Count how often each business appears in the 3-pack
  const packAppearances = {};
  for (var i = 0; i < queryAnalysis.length; i++) {
    var topThree = queryAnalysis[i].topThree || [];
    for (var j = 0; j < topThree.length; j++) {
      var key = topThree[j].matchedCompetitor || topThree[j].title;
      packAppearances[key] = (packAppearances[key] || 0) + 1;
    }
  }

  const entries = Object.entries(packAppearances).sort(function(a, b) { return b[1] - a[1]; });
  const dominantEntry = entries[0];

  const avgCompetitorsInPack = queryAnalysis.length > 0
    ? parseFloat(
        (queryAnalysis.reduce(function(s, q) { return s + (q.knownCompetitorsInPack || 0); }, 0)
          / queryAnalysis.length).toFixed(1)
      )
    : 0;

  // Aggregate Maps paid ad evidence across all queries
  var allMapsAdEvidence = [];
  for (var qi = 0; qi < queryAnalysis.length; qi++) {
    var qe = queryAnalysis[qi].mapsAdEvidence || [];
    for (var ei = 0; ei < qe.length; ei++) {
      allMapsAdEvidence.push(Object.assign({}, qe[ei], { query: queryAnalysis[qi].query }));
    }
  }

  return {
    status:           'complete',
    queriesAnalyzed:  queryAnalysis.length,
    queryAnalysis:    queryAnalysis,
    summary: {
      avgCompetitorsInPack,
      dominantPlayer:             dominantEntry ? dominantEntry[0] : null,
      dominantPlayerAppearances:  dominantEntry ? dominantEntry[1] : 0,
      dominantPlayerConsistency:  dominantEntry
        ? Math.round((dominantEntry[1] / queryAnalysis.length) * 100) + '%'
        : '0%'
    },
    mapsAds: {
      detected: allMapsAdEvidence.length > 0,
      count:    allMapsAdEvidence.length,
      evidence: allMapsAdEvidence
    },
    enrichedAt: new Date().toISOString()
  };
}

module.exports = { enrichMapPack };
