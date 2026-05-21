'use strict';

/**
 * aisynchPromptGenerator.js
 * Auto-generates 10-15 monitoring prompts per merchant using Gemini flash.
 *
 * Prompts span the eight-bucket taxonomy to ensure coverage of all consumer
 * intent patterns for local business AI visibility. Called during AIsynch
 * onboarding; results stored in aiVisibilityPrompts/{merchantId}.
 *
 * Eight-bucket taxonomy:
 *   best-in-city | near-me | service-intent | comparison |
 *   trust-intent | price-value | situation-problem | competitor-comparison
 *
 * Type labels (used for grouping/filtering):
 *   category | service | comparison | recommendation
 */

var admin = require('firebase-admin');
var { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Eight-bucket taxonomy ──────────────────────────────────────────────────────

var INTENT_BUCKETS = {
  'best-in-city':          { type: 'category',       label: 'Discovery, top picks' },
  'near-me':               { type: 'category',       label: 'Location proximity' },
  'service-intent':        { type: 'service',        label: 'Specific service need' },
  'comparison':            { type: 'comparison',     label: 'Head-to-head vs alternative' },
  'trust-intent':          { type: 'recommendation', label: 'Review / reputation driven' },
  'price-value':           { type: 'category',       label: 'Cost-sensitive search' },
  'situation-problem':     { type: 'service',        label: 'Pain / need driven' },
  'competitor-comparison': { type: 'comparison',     label: 'Named competitor vs category' }
};

var VALID_BUCKETS = Object.keys(INTENT_BUCKETS);
var VALID_TYPES   = ['category', 'service', 'comparison', 'recommendation'];

// ── Merchant name alias generation ────────────────────────────────────────────

/**
 * Generate merchant name aliases for mention detection accuracy.
 * AI models may reference a business by abbreviated name, no-suffix name,
 * or no-punctuation variant. All aliases are lowercased.
 *
 * Sources produced:
 *   auto_gbp — derived from GBP display name
 *
 * @param {string} businessName
 * @returns {{ alias: string, source: string, active: boolean }[]}
 */
function generateNameAliases(businessName) {
  if (!businessName || typeof businessName !== 'string') return [];

  var seen    = new Set();
  var aliases = [];

  function addAlias(raw, source) {
    var a = (raw || '').trim();
    if (!a) return;
    var key = a.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    aliases.push({ alias: a.toLowerCase(), source: source || 'auto_gbp', active: true });
  }

  // 1. Lowercase full name
  addAlias(businessName, 'auto_gbp');

  // 2. No-suffix variant (strip legal entity suffixes only — NOT business-type words)
  var noSuffix = businessName
    .replace(/\s+(llc|inc|ltd|corp|co\.?|company|group|associates|partners)\.?$/i, '')
    .trim();
  if (noSuffix !== businessName) addAlias(noSuffix, 'auto_gbp');

  // 3. No-punctuation variant (remove apostrophes, hyphens, periods, etc.)
  var noPunct = businessName.replace(/['''`\-.,!&@]/g, '').replace(/\s+/g, ' ').trim();
  if (noPunct !== businessName) addAlias(noPunct, 'auto_gbp');

  // 4. No-suffix + no-punctuation combined
  var noPunctNoSuffix = noSuffix.replace(/['''`\-.,!&@]/g, '').replace(/\s+/g, ' ').trim();
  if (noPunctNoSuffix !== noSuffix && noPunctNoSuffix !== noPunct) {
    addAlias(noPunctNoSuffix, 'auto_gbp');
  }

  // 5. Common abbreviation — first letter of each word (2-5 char names only)
  var words = noSuffix.replace(/['''`\-.,!&@]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    var abbrev = words.map(function(w) { return w[0].toUpperCase(); }).join('');
    if (abbrev.length >= 2 && abbrev.length <= 5) {
      addAlias(abbrev, 'auto_gbp');
    }
  }

  return aliases;
}

// ── Template-based prompt generation (fallback + supplement) ──────────────────

/**
 * Generate 11 prompts from templates — one per bucket, with extras for
 * best-in-city and trust-intent. Used as fallback when Gemini fails
 * and as supplement when Gemini returns < 10 prompts.
 *
 * @param {string} gbpCategory  e.g. 'dental_office', 'fabric_store'
 * @param {string} city
 * @param {string} [state]
 * @returns {{ text: string, intentBucket: string, type: string }[]}
 */
function generateTemplatePrompts(gbpCategory, city, state) {
  var location = city + (state ? ', ' + state : '');
  var cat = (gbpCategory || '').replace(/_/g, ' ');

  return [
    // best-in-city (2)
    { text: 'best ' + cat + ' in ' + location,              intentBucket: 'best-in-city',          type: 'category' },
    { text: 'top ' + cat + ' in ' + city,                   intentBucket: 'best-in-city',          type: 'category' },
    // near-me (2)
    { text: cat + ' near ' + city,                           intentBucket: 'near-me',               type: 'category' },
    { text: cat + ' near me in ' + location,                 intentBucket: 'near-me',               type: 'category' },
    // service-intent (1)
    { text: 'find a ' + cat + ' in ' + location,            intentBucket: 'service-intent',        type: 'service' },
    // comparison (1)
    { text: 'best place for ' + cat + ' in ' + city,        intentBucket: 'comparison',            type: 'comparison' },
    // trust-intent (2)
    { text: 'top rated ' + cat + ' with great reviews in ' + location, intentBucket: 'trust-intent', type: 'recommendation' },
    { text: 'most reviewed ' + cat + ' in ' + city,         intentBucket: 'trust-intent',          type: 'recommendation' },
    // price-value (1)
    { text: 'affordable ' + cat + ' in ' + location,        intentBucket: 'price-value',           type: 'category' },
    // situation-problem (1)
    { text: 'where should I go for ' + cat + ' in ' + location, intentBucket: 'situation-problem', type: 'service' },
    // competitor-comparison (1)
    { text: 'recommend a ' + cat + ' in ' + city,           intentBucket: 'competitor-comparison', type: 'recommendation' }
  ];
}

// ── Prompt object builder ─────────────────────────────────────────────────────

/**
 * Build a fully-shaped prompt object from raw generation output.
 *
 * @param {string} text
 * @param {string} intentBucket
 * @param {string} type
 * @param {number} index   Used to build the prompt id (prompt_001, etc.)
 * @returns {object}
 */
function buildPrompt(text, intentBucket, type, index) {
  return {
    id:                    'prompt_' + String(index + 1).padStart(3, '0'),
    text:                  (text || '').trim(),
    type:                  type || INTENT_BUCKETS[intentBucket]?.type || 'category',
    intentBucket:          intentBucket,
    source:                'auto_generated',
    active:                true,
    createdAt:             new Date().toISOString(),
    lastRunAt:             null,
    lastMentionedAt:       null,
    historicalMentionRate: null
  };
}

// ── Gemini-based prompt generation ────────────────────────────────────────────

/**
 * Ask Gemini flash to generate 10-15 prompts across the eight buckets.
 * Returns an array of { text, intentBucket, type } objects.
 * Throws on failure — caller falls back to templates.
 *
 * @param {object} config
 * @returns {Promise<{ text: string, intentBucket: string, type: string }[]>}
 */
async function generatePromptListWithGemini(config) {
  var gbpCategory   = config.gbpCategory   || '';
  var city          = config.city          || '';
  var state         = config.state         || '';
  var services      = config.services      || [];
  var subCategories = config.subCategories || [];

  var location     = city + (state ? ', ' + state : '');
  var catDisplay   = gbpCategory.replace(/_/g, ' ');
  var servicesList = services.slice(0, 5).join(', ');
  var subCatList   = subCategories.slice(0, 3).join(', ');

  var systemInstruction = [
    'IMPORTANT: Output ONLY a valid JSON object.',
    'Start your response with { and end with }.',
    'Do not include any explanation or text outside the JSON.'
  ].join('\n');

  var bucketDefs = VALID_BUCKETS.map(function(b, i) {
    return (i + 1) + '. ' + b + ' (type: ' + INTENT_BUCKETS[b].type + ') — ' + INTENT_BUCKETS[b].label;
  }).join('\n');

  var userPrompt = [
    'Generate 10-15 local search prompts that a consumer might type into ChatGPT, Gemini, or Perplexity.',
    '',
    'Business type: ' + catDisplay,
    'Location: ' + location,
    servicesList  ? 'Services: '      + servicesList  : '',
    subCatList    ? 'Sub-categories: ' + subCatList   : '',
    '',
    'Cover all 8 intent buckets (at least 1 prompt per bucket):',
    bucketDefs,
    '',
    'Return ONLY this JSON:',
    '{"prompts": [{"text": "...", "intentBucket": "best-in-city", "type": "category"}]}',
    '',
    'Rules: 10-15 prompts total, natural consumer language, no markdown.'
  ].filter(Boolean).join('\n');

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  var genAI = new GoogleGenerativeAI(apiKey);
  var model = genAI.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    systemInstruction: systemInstruction
  });

  var result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature:    0.7,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  var raw = result.response.text();
  var s = raw.indexOf('{');
  var e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('Gemini returned no JSON');

  var parsed    = JSON.parse(raw.slice(s, e + 1));
  var rawPrompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];

  // Validate — filter out any prompt with an invalid bucket or type
  return rawPrompts
    .filter(function(p) { return p && typeof p.text === 'string' && p.text.trim(); })
    .filter(function(p) { return VALID_BUCKETS.indexOf(p.intentBucket) !== -1; })
    .filter(function(p) { return VALID_TYPES.indexOf(p.type) !== -1; })
    .slice(0, 15);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate prompts and aliases for a merchant, then upsert into Firestore.
 *
 * @param {object} config
 * @param {string} config.merchantId
 * @param {string} config.merchantName
 * @param {string} config.gbpCategory    e.g. 'dental_office'
 * @param {string} config.city
 * @param {string} [config.state]
 * @param {string[]} [config.services]
 * @param {string[]} [config.subCategories]
 * @returns {Promise<{ aliases: object[], prompts: object[] }>}
 */
async function generatePromptsForMerchant(config) {
  var merchantId   = config.merchantId;
  var merchantName = config.merchantName;
  var gbpCategory  = config.gbpCategory;
  var city         = config.city;
  var state        = config.state || '';

  if (!merchantId || !merchantName || !gbpCategory || !city) {
    throw new Error('generatePromptsForMerchant: merchantId, merchantName, gbpCategory, city are required');
  }

  // 1. Generate aliases
  var aliases = generateNameAliases(merchantName);

  // 2. Generate prompts via Gemini, supplement with templates if needed
  var rawPrompts;
  try {
    rawPrompts = await generatePromptListWithGemini(config);

    if (rawPrompts.length < 10) {
      var coveredBuckets = new Set(rawPrompts.map(function(p) { return p.intentBucket; }));
      var extras = generateTemplatePrompts(gbpCategory, city, state)
        .filter(function(t) { return !coveredBuckets.has(t.intentBucket); });
      rawPrompts = rawPrompts.concat(extras);
    }
  } catch (err) {
    console.warn('[PromptGenerator] Gemini failed, using templates:', err.message);
    rawPrompts = generateTemplatePrompts(gbpCategory, city, state);
  }

  // Cap at 15
  rawPrompts = rawPrompts.slice(0, 15);

  // 3. Build prompt objects with IDs and tracking fields
  var prompts = rawPrompts.map(function(p, i) {
    return buildPrompt(p.text, p.intentBucket, p.type, i);
  });

  // 4. Upsert Firestore document
  var doc = {
    merchantId:           merchantId,
    city:                 city,
    state:                state,
    gbpCategory:          gbpCategory,
    gbpSubCategories:     config.subCategories || [],
    merchantNameAliases:  aliases,
    prompts:              prompts,
    lastAutoGenerated:    admin.firestore.FieldValue.serverTimestamp(),
    autoGenVersion:       '1.0',
    customPromptsCount:   0,
    createdAt:            admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:            admin.firestore.FieldValue.serverTimestamp()
  };

  var db = admin.firestore();
  await db.collection('aiVisibilityPrompts').doc(merchantId).set(doc, { merge: true });

  return { aliases: aliases, prompts: prompts };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generatePromptsForMerchant:    generatePromptsForMerchant,
  generateNameAliases:           generateNameAliases,
  generateTemplatePrompts:       generateTemplatePrompts,
  buildPrompt:                   buildPrompt,
  generatePromptListWithGemini:  generatePromptListWithGemini,
  INTENT_BUCKETS:                INTENT_BUCKETS,
  VALID_BUCKETS:                 VALID_BUCKETS,
  VALID_TYPES:                   VALID_TYPES
};
