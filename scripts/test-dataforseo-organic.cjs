/**
 * test-dataforseo-organic.cjs
 * Probes the DataForSEO Google Organic SERP API and confirms paid item structure.
 * Run BEFORE wiring adSpendProvider.js into market.js.
 *
 * Confirms:
 *   - Paid item type name (spec expects "paid")
 *   - Field names on paid items: title, domain, description, url
 *   - Response path: tasks[0].result[0].items
 *   - location_name vs location_coordinate (lesson from Phase 1A)
 *
 * Usage:
 *   node scripts/test-dataforseo-organic.cjs [--query "dental practice Houston"] [--city Houston] [--state TX]
 *
 * Credentials loaded from functions/.env. No npm deps — Node built-in https only.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.join(__dirname, '..', 'functions', '.env');
  if (!fs.existsSync(envPath)) { console.error('ERROR: functions/.env not found'); process.exit(1); }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' }, function(res) {
      let d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function httpsPost(url, body, headers) {
  return new Promise(function(resolve, reject) {
    const parsed  = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) })
    }, function(res) {
      let d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr); req.end();
  });
}

async function geocodeCity(city, state, apiKey) {
  const address = encodeURIComponent(city + ',' + state + ',United States');
  const data = await httpsGet('https://maps.googleapis.com/maps/api/geocode/json?address=' + address + '&key=' + apiKey);
  const result = data.results && data.results[0];
  if (!result) throw new Error('No geocode result for ' + city + ', ' + state);
  return { lat: result.geometry.location.lat, lng: result.geometry.location.lng };
}

const args = process.argv.slice(2);
function getArg(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }
const query = getArg('--query', 'dental practice Houston TX');
const city  = getArg('--city',  'Houston');
const state = getArg('--state', 'TX');

const EXPECTED_PAID_TYPE   = 'paid';
const EXPECTED_PAID_FIELDS = ['title', 'domain', 'description', 'url'];

async function test() {
  const env      = loadEnv();
  const login    = env.DATAFORSEO_LOGIN;
  const password = env.DATAFORSEO_PASSWORD;
  const apiKey   = env.GOOGLE_PLACES_API_KEY;
  if (!login || !password) { console.error('ERROR: DataForSEO creds missing'); process.exit(1); }

  console.log('DataForSEO Google Organic SERP — paid item field probe');
  console.log('  Query   :', '"' + query + '"');
  console.log('  City    :', city + ', ' + state);
  console.log('');

  // Try 1: location_name (may fail — lesson from Phase 1A Maps test)
  // Try 2: location_coordinate fallback
  const auth = Buffer.from(login + ':' + password).toString('base64');

  // First try location_name — Organic may support it even though Maps does not
  console.log('--- Attempt 1: location_name ---');
  let data;
  try {
    data = await httpsPost(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      [{ keyword: query, location_name: city + ',' + state + ',United States', language_code: 'en', depth: 10 }],
      { 'Authorization': 'Basic ' + auth }
    );
    const task = data.tasks && data.tasks[0];
    if (task && task.status_code === 20000) {
      console.log('  ✓ location_name WORKS for Organic SERP');
    } else {
      console.log('  ✗ location_name failed:', task && task.status_message);
      data = null;
    }
  } catch(e) {
    console.log('  ✗ location_name request error:', e.message);
    data = null;
  }

  // Fallback: location_coordinate
  if (!data) {
    console.log('');
    console.log('--- Attempt 2: location_coordinate ---');
    if (!apiKey) { console.error('ERROR: GOOGLE_PLACES_API_KEY needed for geocoding fallback'); process.exit(1); }
    const coords = await geocodeCity(city, state, apiKey);
    const locationCoordinate = coords.lat + ',' + coords.lng + ',10000';
    console.log('  Geocoded:', locationCoordinate);
    data = await httpsPost(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      [{ keyword: query, location_coordinate: locationCoordinate, language_code: 'en', depth: 10 }],
      { 'Authorization': 'Basic ' + auth }
    );
    const task = data.tasks && data.tasks[0];
    if (task && task.status_code === 20000) {
      console.log('  ✓ location_coordinate works');
    } else {
      console.error('  ✗ Both location formats failed:', task && task.status_message);
      process.exit(1);
    }
  }

  const task   = data.tasks[0];
  const result = task.result && task.result[0];
  if (!result) { console.error('ERROR: No result in task'); process.exit(1); }

  console.log('');
  console.log('=== TOP-LEVEL RESPONSE KEYS ===');
  console.log(Object.keys(data));
  console.log('status_code:', data.status_code, '|', data.status_message);

  console.log('');
  console.log('=== RESULT KEYS ===');
  console.log(Object.keys(result));

  const items = result.items || [];
  console.log('');
  console.log('=== ITEM TYPES ===');
  const typeCount = {};
  for (const item of items) { typeCount[item.type] = (typeCount[item.type] || 0) + 1; }
  console.log(typeCount);

  // ── Paid items ────────────────────────────────────────────────────────────
  const paidItems = items.filter(function(i) { return i.type === EXPECTED_PAID_TYPE; });
  console.log('');
  console.log('Paid items ("' + EXPECTED_PAID_TYPE + '"):', paidItems.length);

  if (paidItems.length === 0) {
    console.warn('WARNING: No paid items found for this query.');
    console.log('This may mean no advertisers for this term right now — try a more commercial query.');
    console.log('');
    console.log('All item types:', Object.keys(typeCount));
    // Still print first organic item to show what "organic" items look like
    const first = items[0];
    if (first) {
      console.log('');
      console.log('=== FIRST ITEM (type: ' + first.type + ') — for reference ===');
      console.log(JSON.stringify(first, null, 2).slice(0, 1000));
    }
  } else {
    const first = paidItems[0];
    console.log('');
    console.log('=== FIRST PAID ITEM — ALL FIELDS ===');
    console.log(JSON.stringify(first, null, 2).slice(0, 2000));

    console.log('');
    console.log('=== FIELD VERIFICATION ===');
    let ok = true;
    for (const field of EXPECTED_PAID_FIELDS) {
      const val     = first[field];
      const present = val !== undefined && val !== null && val !== '';
      console.log('  ' + (present ? '✓' : '✗ MISSING/EMPTY') + '  item.' + field + ':', present ? JSON.stringify(val).slice(0, 80) : '(absent)');
      if (!present) ok = false;
    }

    console.log('');
    console.log('--- Extra fields to note ---');
    console.log('  item.rank_group    :', first.rank_group);
    console.log('  item.rank_absolute :', first.rank_absolute);
    console.log('  item.type          :', first.type);

    // Print all paid items
    console.log('');
    console.log('=== ALL PAID ITEMS ===');
    paidItems.forEach(function(item, i) {
      console.log('  [' + (i + 1) + '] ' + item.title);
      console.log('       domain :', item.domain);
      console.log('       url    :', item.url && item.url.slice(0, 80));
    });

    console.log('');
    if (ok) {
      console.log('✓ All expected fields confirmed. adSpendProvider.js field names are correct.');
    } else {
      console.error('✗ Some fields missing — update extractPaidItems() before wiring into market.js.');
      process.exit(1);
    }
  }

  console.log('');
  console.log('=== RAW RESPONSE (first 2000 chars) ===');
  console.log(JSON.stringify(data, null, 2).slice(0, 2000));
}

test().catch(function(err) {
  console.error('Test failed:', err.message);
  process.exit(1);
});
