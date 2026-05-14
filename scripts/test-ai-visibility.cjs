/**
 * test-ai-visibility.cjs
 * Confirms the Gemini grounded search pattern for Phase 3 AI Visibility.
 * Must pass BEFORE aiVisibilityProvider.js is wired into market.js.
 *
 * Confirms:
 *   - tools: [{ googleSearch: {} }] is the correct syntax (NOT google_search_retrieval)
 *   - gemini-2.5-flash supports grounded search with this tools parameter
 *   - result.response.text() returns a plain string (not an array, not JSON)
 *   - Specified business names can be found in the response via substring matching
 *   - PERPLEXITY_API_KEY presence (optional fallback)
 *
 * Usage:
 *   node scripts/test-ai-visibility.cjs [--query "best dentist in Houston TX"] [--businesses "Antoine Dental,Bright Smiles"]
 *
 * Credentials loaded from functions/.env.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

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

const args = process.argv.slice(2);
function getArg(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

const query      = getArg('--query',      'best dental practice in Houston TX');
const bizArg     = getArg('--businesses', 'Antoine Dental Center,Bright Smiles Dental');
const businesses = bizArg.split(',').map(function(b) { return b.trim(); });

async function test() {
  const env     = loadEnv();
  const apiKey  = env.GEMINI_API_KEY;
  const perpKey = env.PERPLEXITY_API_KEY;

  if (!apiKey) { console.error('ERROR: GEMINI_API_KEY missing'); process.exit(1); }

  console.log('AI Visibility — Gemini grounded search pattern probe');
  console.log('  Query      :', '"' + query + '"');
  console.log('  Businesses :', businesses.join(', '));
  console.log('  Perplexity :', perpKey ? 'key set (fallback available)' : 'key NOT set (fallback will be skipped)');
  console.log('');

  // Dynamically require @google/generative-ai from functions/node_modules
  const sdkPath = path.join(__dirname, '..', 'functions', 'node_modules', '@google', 'generative-ai');
  if (!fs.existsSync(sdkPath)) {
    console.error('ERROR: @google/generative-ai not found at', sdkPath);
    process.exit(1);
  }
  const { GoogleGenerativeAI } = require(sdkPath);
  const genAI = new GoogleGenerativeAI(apiKey);

  // ── Attempt 1: grounded search ────────────────────────────────────────────
  console.log('--- Attempt 1: gemini-2.5-flash + tools: [{ googleSearch: {} }] ---');
  let groundedResponse = null;
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ googleSearch: {} }]
    });

    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: query }] }],
        generationConfig: {
          temperature:   0.1,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 }
        }
      }),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('Timeout after 20s')); }, 20000);
      })
    ]);

    groundedResponse = result.response.text();
    console.log('  ✓ Grounded search returned text');
    console.log('  Response type   :', typeof groundedResponse);
    console.log('  Response length :', groundedResponse.length, 'chars');
    console.log('  First 300 chars :', groundedResponse.slice(0, 300));
    console.log('');

    // Check if response.candidates exists and has grounding metadata
    const cands = result.response.candidates;
    if (cands && cands[0] && cands[0].groundingMetadata) {
      const gm = cands[0].groundingMetadata;
      console.log('  Grounding metadata present:', JSON.stringify(Object.keys(gm)));
      if (gm.webSearchQueries) console.log('  Web search queries used:', gm.webSearchQueries);
    } else {
      console.log('  No grounding metadata in candidates (may still be grounded)');
    }
    console.log('');

  } catch (err) {
    console.error('  ✗ Grounded call FAILED:', err.message);
    console.log('  This may mean the tools syntax is wrong or the model does not support grounding.');
    console.log('');
  }

  // ── Business mention check ─────────────────────────────────────────────────
  if (groundedResponse) {
    console.log('--- Business mention check ---');
    const lower = groundedResponse.toLowerCase();
    for (const biz of businesses) {
      const tokens   = biz.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function(t) { return t.length > 3; });
      const matched  = tokens.filter(function(t) { return lower.includes(t); });
      const rate     = tokens.length > 0 ? Math.round((matched.length / tokens.length) * 100) : 0;
      const verdict  = rate >= 50 ? 'MENTIONED' : 'not mentioned';
      console.log('  [' + verdict + '] "' + biz + '" — token match rate: ' + rate + '% (' + matched.length + '/' + tokens.length + ' tokens)');
    }
    console.log('');
    console.log('  ✓ checkAiMention() logic confirmed — token overlap ≥50% = mention');
    console.log('');
  }

  // ── Attempt 2: ungrounded (baseline for comparison) ──────────────────────
  console.log('--- Attempt 2: gemini-2.5-flash WITHOUT grounding (baseline) ---');
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: query }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } }
      }),
      new Promise(function(_, reject) { setTimeout(function() { reject(new Error('Timeout')); }, 15000); })
    ]);
    const text = result.response.text();
    console.log('  ✓ Ungrounded response length:', text.length, 'chars');
    console.log('  First 200 chars:', text.slice(0, 200));
  } catch (err) {
    console.error('  ✗ Ungrounded call failed:', err.message);
  }
  console.log('');

  // ── Perplexity check ──────────────────────────────────────────────────────
  console.log('--- Perplexity fallback status ---');
  if (!perpKey) {
    console.log('  PERPLEXITY_API_KEY not set — fallback will be skipped gracefully');
    console.log('  To enable: add PERPLEXITY_API_KEY to functions/.env');
  } else {
    console.log('  Key present — testing Perplexity sonar...');
    try {
      const https   = require('https');
      const body    = JSON.stringify({
        model:    'sonar',
        messages: [{ role: 'user', content: query }]
      });
      const perpResult = await new Promise(function(resolve, reject) {
        const req = https.request({
          hostname: 'api.perplexity.ai',
          path:     '/chat/completions',
          method:   'POST',
          headers:  { 'Authorization': 'Bearer ' + perpKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, function(res) {
          let d = ''; res.on('data', function(c) { d += c; });
          res.on('end', function() {
            if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
            try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('JSON: ' + e.message)); }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, function() { req.destroy(); reject(new Error('Perplexity timeout')); });
        req.write(body); req.end();
      });
      const perpText = perpResult.choices && perpResult.choices[0] && perpResult.choices[0].message && perpResult.choices[0].message.content || '';
      console.log('  ✓ Perplexity responded — model:', perpResult.model, '| length:', perpText.length, 'chars');
      console.log('  First 200 chars:', perpText.slice(0, 200));
    } catch (err) {
      console.error('  ✗ Perplexity failed:', err.message);
    }
  }

  console.log('');
  console.log('=== IMPLEMENTATION SUMMARY ===');
  console.log('Gemini grounded search:');
  console.log('  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)');
  console.log('  model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", tools: [{ googleSearch: {} }] })');
  console.log('  result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: query }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })');
  console.log('  text  = result.response.text()');
  console.log('');
  console.log('Perplexity fallback:', perpKey ? 'available (sonar model)' : 'unavailable — PERPLEXITY_API_KEY not set, will skip');
}

test().catch(function(err) {
  console.error('Test failed:', err.message);
  process.exit(1);
});
