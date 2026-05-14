/**
 * test-dataforseo-maps.cjs
 * Probes the DataForSEO Google Maps SERP API and prints the actual response structure.
 * Run BEFORE wiring mapPackProvider.js into market.js.
 *
 * KEY FINDING (confirmed May 14, 2026):
 *   - `location_name` is INVALID for this endpoint — use `location_coordinate` instead
 *   - Format: "lat,lng,radius_meters" (e.g. "29.7604267,-95.3698028,10000")
 *   - The provider must geocode city+state → lat/lng (Google Geocoding API or static lookup)
 *   - `rank_group` is the actual position (1-based); `rank_absolute` is the global position
 *
 * Confirms:
 *   - Item type: "maps_search" ✓
 *   - Field names: title, rating.value, rating.votes_count, address, place_id, domain ✓
 *   - Response path: tasks[0].result[0].items ✓
 *
 * Usage:
 *   node scripts/test-dataforseo-maps.cjs [--query "restaurant near me"] [--lat 29.76] [--lng -95.37] [--radius 10000]
 *
 * Credentials loaded from functions/.env. No npm deps — Node built-in https only.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Load credentials from functions/.env ─────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', 'functions', '.env');
  if (!fs.existsSync(envPath)) { console.error('ERROR: functions/.env not found'); process.exit(1); }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

// ── HTTPS POST (no deps) ──────────────────────────────────────────────────────
function httpsPost(url, body, headers) {
  return new Promise(function(resolve, reject) {
    const parsed  = new URL(url);
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
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
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

const query  = getArg('--query',  'dental practice near me');
const lat    = getArg('--lat',    '29.7604267');   // Houston, TX center
const lng    = getArg('--lng',    '-95.3698028');
const radius = getArg('--radius', '10000');        // 10km radius

const EXPECTED_ITEM_TYPE   = 'maps_search';
const EXPECTED_ITEM_FIELDS = ['title', 'rating', 'address', 'place_id', 'domain'];

async function test() {
  const env      = loadEnv();
  const login    = env.DATAFORSEO_LOGIN;
  const password = env.DATAFORSEO_PASSWORD;
  if (!login || !password) { console.error('ERROR: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD missing'); process.exit(1); }

  const locationCoordinate = lat + ',' + lng + ',' + radius;
  console.log('DataForSEO Google Maps SERP — field probe');
  console.log('  Login              :', login);
  console.log('  Query              :', '"' + query + '"');
  console.log('  location_coordinate:', locationCoordinate, '(Houston TX default)');
  console.log('  NOTE: location_name is INVALID for this endpoint — use location_coordinate');
  console.log('');

  const auth    = Buffer.from(login + ':' + password).toString('base64');
  const payload = [{
    keyword: query,
    location_coordinate: locationCoordinate,
    language_code: 'en',
    depth: 10
  }];

  let data;
  try {
    data = await httpsPost(
      'https://api.dataforseo.com/v3/serp/google/maps/live/advanced',
      payload,
      { 'Authorization': 'Basic ' + auth }
    );
  } catch (err) {
    console.error('Request failed:', err.message);
    process.exit(1);
  }

  // ── 1. Top-level shape ────────────────────────────────────────────────────
  console.log('=== TOP-LEVEL RESPONSE KEYS ===');
  console.log(Object.keys(data));
  console.log('status_code:', data.status_code, '|', data.status_message);
  console.log('tasks_error:', data.tasks_error);
  console.log('');

  const task = data.tasks && data.tasks[0];
  if (!task) { console.error('ERROR: No task'); process.exit(1); }
  if (task.status_code !== 20000) {
    console.error('TASK ERROR:', task.status_code, task.status_message);
    process.exit(1);
  }

  const result = task.result && task.result[0];
  if (!result) { console.error('ERROR: No result'); process.exit(1); }

  console.log('=== RESULT KEYS ===');
  console.log(Object.keys(result));
  console.log('item_types reported:', result.item_types);
  console.log('items_count:', result.items_count);
  console.log('');

  // ── 2. Items ──────────────────────────────────────────────────────────────
  const items = result.items || [];
  const typeCount = {};
  for (const item of items) { typeCount[item.type] = (typeCount[item.type] || 0) + 1; }
  console.log('=== ITEM TYPES ===');
  console.log(typeCount);
  console.log('');

  const mapsItems = items.filter(function(i) { return i.type === EXPECTED_ITEM_TYPE; });
  console.log('Items of type "' + EXPECTED_ITEM_TYPE + '":', mapsItems.length);
  if (mapsItems.length === 0) {
    console.error('ERROR: No maps_search items. Actual types:', Object.keys(typeCount));
    process.exit(1);
  }
  console.log('');

  // ── 3. All fields on first item ───────────────────────────────────────────
  const first = mapsItems[0];
  console.log('=== FIRST maps_search ITEM — ALL KEYS ===');
  console.log(Object.keys(first));
  console.log('');
  console.log('=== FIRST ITEM FULL ===');
  console.log(JSON.stringify(first, null, 2).slice(0, 2000));
  console.log('');

  // ── 4. Field verification ─────────────────────────────────────────────────
  console.log('=== FIELD VERIFICATION (provider fields) ===');
  let ok = true;
  for (const field of EXPECTED_ITEM_FIELDS) {
    const val     = first[field];
    const present = val !== undefined && val !== null;
    console.log('  ' + (present ? '✓' : '✗ MISSING') + '  item.' + field + ':', present ? JSON.stringify(val).slice(0, 80) : '(absent)');
    if (!present) ok = false;
  }

  console.log('');
  console.log('--- rating sub-fields ---');
  const r = first.rating;
  console.log('  item.rating.value       :', r && r.value);
  console.log('  item.rating.votes_count :', r && r.votes_count);
  console.log('  item.rating.rating_type :', r && r.rating_type);

  console.log('');
  console.log('--- place_id (snake_case confirmed) ---');
  console.log('  item.place_id :', first.place_id, '← use this');
  console.log('  item.placeId  :', first.placeId, '← does NOT exist');

  console.log('');
  console.log('--- position fields ---');
  console.log('  item.rank_group    :', first.rank_group, '← actual position (1-based) — USE THIS');
  console.log('  item.rank_absolute :', first.rank_absolute, '← global position');
  console.log('  NOTE: spec uses array index (idx+1) but rank_group is more accurate');

  console.log('');
  console.log('--- domain ---');
  console.log('  item.domain :', first.domain, '← present');
  console.log('  item.url    :', first.url, '← also available');

  // ── 5. Top 3 ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('=== TOP 3 MAP RESULTS ===');
  mapsItems.slice(0, 3).forEach(function(item, i) {
    console.log('  [' + (i + 1) + '] ' + item.title);
    console.log('       rank_group : ' + item.rank_group);
    console.log('       rating     : ' + (item.rating && item.rating.value) + ' (' + (item.rating && item.rating.votes_count) + ' votes)');
    console.log('       address    : ' + item.address);
    console.log('       place_id   : ' + item.place_id);
    console.log('       domain     : ' + item.domain);
  });

  console.log('');
  if (ok) {
    console.log('✓ All expected fields confirmed.');
    console.log('');
    console.log('=== PROVIDER UPDATE REQUIRED ===');
    console.log('  mapPackProvider.js callMapsSERP() must use location_coordinate NOT location_name');
    console.log('  Format: "lat,lng,radius_meters"');
    console.log('  Requires geocoding city+state → lat/lng (use Google Geocoding API or static lookup)');
    console.log('  Position field: rank_group (1-based) preferred over array index');
  } else {
    console.error('✗ Some fields missing — update extractMapResults() before wiring into market.js.');
    process.exit(1);
  }

  // ── 6. Raw response (truncated) ───────────────────────────────────────────
  console.log('');
  console.log('=== RAW RESPONSE (first 2000 chars) ===');
  console.log(JSON.stringify(data, null, 2).slice(0, 2000));
}

test().catch(function(err) {
  console.error('Test failed:', err.message);
  process.exit(1);
});
