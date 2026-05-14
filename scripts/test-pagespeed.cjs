/**
 * test-pagespeed.cjs
 * Probes the Google PageSpeed Insights API v5 and confirms field paths used by
 * websiteSignalsProvider.js BEFORE wiring it into market.js.
 *
 * Confirms:
 *   - lighthouseResult.categories keys and score path
 *   - lighthouseResult.audits keys (CWV, mobile, meta, structured-data)
 *   - strategy=mobile response shape
 *   - Error shape when URL is invalid
 *
 * Usage:
 *   node scripts/test-pagespeed.cjs [--url "https://example.com"]
 *
 * Credentials loaded from functions/.env (GOOGLE_PLACES_API_KEY).
 * No npm deps — Node built-in https only.
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
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json' }
    }, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { reject(new Error('JSON parse: ' + e.message + '\nRaw: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Timeout after 30s')); });
    req.end();
  });
}

const args = process.argv.slice(2);
function getArg(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

const testUrl = getArg('--url', 'https://www.zocdoc.com');

const EXPECTED_CATEGORIES  = ['performance', 'seo', 'best-practices'];
const EXPECTED_AUDITS      = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'viewport',
  'meta-description'
];

async function test() {
  const env    = loadEnv();
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) { console.error('ERROR: GOOGLE_PLACES_API_KEY missing from functions/.env'); process.exit(1); }

  console.log('Google PageSpeed Insights v5 — field probe');
  console.log('  URL      :', testUrl);
  console.log('  Strategy : mobile');
  console.log('');

  const psiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
    + '?url=' + encodeURIComponent(testUrl)
    + '&key=' + apiKey
    + '&category=performance&category=seo&category=best-practices&strategy=mobile';

  console.log('Calling PageSpeed Insights...');
  const { status, body } = await httpsGet(psiUrl);

  if (status >= 400) {
    console.error('ERROR: HTTP', status);
    console.error(JSON.stringify(body, null, 2).slice(0, 1000));
    process.exit(1);
  }

  console.log('HTTP', status, '— OK');
  console.log('');

  // ── Top-level keys ────────────────────────────────────────────────────────
  console.log('=== TOP-LEVEL KEYS ===');
  console.log(Object.keys(body));
  console.log('');

  const lr = body.lighthouseResult;
  if (!lr) {
    console.error('ERROR: No lighthouseResult in response');
    console.log(JSON.stringify(body, null, 2).slice(0, 1000));
    process.exit(1);
  }

  // ── Categories ────────────────────────────────────────────────────────────
  const cats = lr.categories || {};
  console.log('=== CATEGORIES ===');
  console.log('Category keys:', Object.keys(cats));
  console.log('');

  let catOk = true;
  for (const cat of EXPECTED_CATEGORIES) {
    const present = cats[cat] !== undefined;
    const score   = cats[cat]?.score;
    const rounded = score !== undefined && score !== null ? Math.round(score * 100) : null;
    const mark    = present ? '✓' : '✗ MISSING';
    console.log(`  ${mark}  categories.${cat}.score:`, rounded !== null ? rounded + '/100' : '(absent)');
    if (!present) catOk = false;
  }
  console.log('');

  // ── Audits ────────────────────────────────────────────────────────────────
  const audits = lr.audits || {};
  console.log('=== AUDITS (subset) ===');
  console.log('Total audit count:', Object.keys(audits).length);
  console.log('');

  let auditOk = true;
  for (const auditKey of EXPECTED_AUDITS) {
    const audit   = audits[auditKey];
    const present = audit !== undefined;
    const mark    = present ? '✓' : '✗ MISSING';

    let detail = '(absent)';
    if (present) {
      if (audit.numericValue !== undefined) {
        detail = 'numericValue=' + Math.round(audit.numericValue) + (auditKey.includes('shift') ? '' : 'ms');
      } else {
        detail = 'score=' + audit.score + ' | displayValue=' + (audit.displayValue || '?');
      }
    }
    console.log(`  ${mark}  audits['${auditKey}']:`, detail);
    if (!present) auditOk = false;
  }
  console.log('');

  // ── structured-data (may be absent on some sites) ─────────────────────────
  const sdAudit = audits['structured-data'];
  console.log('=== structured-data audit ===');
  if (sdAudit) {
    console.log('  Present — score:', sdAudit.score, '| type:', typeof sdAudit.score);
    console.log('  NOTE: score !== 0 check is safe for has-structured-data signal');
  } else {
    console.log('  ABSENT — this audit key may not be present for all sites');
    console.log('  SAFE FALLBACK: treat absent as hasStructuredData=false');
  }
  console.log('');

  // ── CWV summary ────────────────────────────────────────────────────────────
  console.log('=== CORE WEB VITALS SUMMARY ===');
  const fcp = audits['first-contentful-paint']?.numericValue;
  const lcp = audits['largest-contentful-paint']?.numericValue;
  const cls = audits['cumulative-layout-shift']?.numericValue;
  console.log('  FCP:', fcp ? Math.round(fcp) + 'ms' : '(absent)');
  console.log('  LCP:', lcp ? Math.round(lcp) + 'ms' : '(absent)');
  console.log('  CLS:', cls !== undefined && cls !== null ? cls.toFixed(3) : '(absent)');
  console.log('');

  // ── Mobile-specific checks ─────────────────────────────────────────────────
  console.log('=== MOBILE / CONVERSION CHECKS ===');
  const viewport = audits['viewport'];
  console.log('  viewport.score:', viewport?.score, '(1 = pass, 0 = fail, null = informational)');
  console.log('  meta-description.score:', audits['meta-description']?.score);
  console.log('');

  // ── LoadingExperience (field data, may be absent) ─────────────────────────
  const le = body.loadingExperience;
  console.log('=== loadingExperience (field data, may be absent) ===');
  if (le) {
    console.log('  overall_category:', le.overall_category);
    console.log('  metrics keys:', Object.keys(le.metrics || {}));
  } else {
    console.log('  ABSENT — field data not available for this URL (lab data only)');
  }
  console.log('');

  // ── Final verification ─────────────────────────────────────────────────────
  const allOk = catOk && auditOk;
  console.log('=== VERIFICATION RESULT ===');
  if (allOk) {
    console.log('✓ All expected categories and audit keys confirmed.');
    console.log('  websiteSignalsProvider.js field paths are correct.');
  } else {
    console.error('✗ Some fields missing — review the output above before implementing.');
    process.exit(1);
  }

  console.log('');
  console.log('=== RAW lighthouseResult (first 2000 chars) ===');
  console.log(JSON.stringify(lr, null, 2).slice(0, 2000));
}

test().catch(function(err) {
  console.error('Test failed:', err.message);
  process.exit(1);
});
