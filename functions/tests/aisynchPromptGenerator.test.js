'use strict';

/**
 * Unit tests for services/aisynchPromptGenerator.js
 *
 * Tests cover:
 * - generateNameAliases: alias variants, edge cases
 * - generateTemplatePrompts: 8-bucket coverage, structure
 * - buildPrompt: field shape and ID formatting
 * - generatePromptsForMerchant: 10-15 range, full flow
 * - INTENT_BUCKETS constant validation
 */

// ── Mock hoisting ─────────────────────────────────────────────────────────────

jest.mock('firebase-admin');
jest.mock('@google/generative-ai');

// ── Imports ───────────────────────────────────────────────────────────────────

var admin  = require('firebase-admin');
var { GoogleGenerativeAI } = require('@google/generative-ai');
var {
  generateNameAliases,
  generateTemplatePrompts,
  buildPrompt,
  generatePromptsForMerchant,
  INTENT_BUCKETS,
  VALID_BUCKETS,
  VALID_TYPES
} = require('../services/aisynchPromptGenerator');

// ── Fixtures ──────────────────────────────────────────────────────────────────

var MOCK_MERCHANT_ID   = 'merchant_test_001';
var MOCK_MERCHANT_NAME = "Brilliant Smiles Dental LLC";
var MOCK_GBP_CATEGORY  = 'dental_office';
var MOCK_CITY          = 'Atlanta';
var MOCK_STATE         = 'GA';

// Gemini mock response (10 prompts covering all 8 buckets)
var MOCK_GEMINI_PROMPTS = [
  { text: 'best dental office in Atlanta GA',              intentBucket: 'best-in-city',          type: 'category' },
  { text: 'top dentist in Atlanta',                        intentBucket: 'best-in-city',          type: 'category' },
  { text: 'dental office near Atlanta',                    intentBucket: 'near-me',               type: 'category' },
  { text: 'emergency dentist open Saturday Atlanta',        intentBucket: 'service-intent',        type: 'service' },
  { text: 'Brilliant Smiles vs competitor Atlanta',        intentBucket: 'comparison',            type: 'comparison' },
  { text: 'top rated dentist with great reviews Atlanta',  intentBucket: 'trust-intent',          type: 'recommendation' },
  { text: 'affordable dental care Atlanta GA',             intentBucket: 'price-value',           type: 'category' },
  { text: 'where should I go for tooth pain in Atlanta',   intentBucket: 'situation-problem',     type: 'service' },
  { text: 'best Invisalign provider in Atlanta',           intentBucket: 'competitor-comparison', type: 'comparison' },
  { text: 'recommend a dentist in Atlanta',                intentBucket: 'competitor-comparison', type: 'recommendation' }
];

// ── Firebase-admin mock ───────────────────────────────────────────────────────

var mockSet;
var mockGet;
var mockDoc;
var mockCollection;

beforeEach(function() {
  mockSet = jest.fn().mockResolvedValue({});
  mockGet = jest.fn().mockResolvedValue({ exists: false, data: function() { return null; } });
  mockDoc        = jest.fn().mockReturnValue({ set: mockSet, get: mockGet });
  mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });

  admin.firestore.mockReturnValue({ collection: mockCollection });
  admin.firestore.FieldValue = {
    serverTimestamp: jest.fn().mockReturnValue('__serverTimestamp__'),
    increment:       jest.fn(function(v) { return { _increment: v }; })
  };
});

// ── Gemini mock setup ─────────────────────────────────────────────────────────

function mockGeminiResponse(prompts) {
  var mockGenerateContent = jest.fn().mockResolvedValue({
    response: {
      text: function() {
        return JSON.stringify({ prompts: prompts });
      }
    }
  });

  var mockModelInstance = { generateContent: mockGenerateContent };
  GoogleGenerativeAI.mockImplementation(function() {
    return { getGenerativeModel: jest.fn().mockReturnValue(mockModelInstance) };
  });

  return mockGenerateContent;
}

// ── generateNameAliases tests ─────────────────────────────────────────────────

describe('generateNameAliases', function() {
  it('returns array of alias objects with alias, source, active fields', function() {
    var aliases = generateNameAliases("Smith's Auto Repair");
    expect(Array.isArray(aliases)).toBe(true);
    aliases.forEach(function(a) {
      expect(a).toHaveProperty('alias');
      expect(a).toHaveProperty('source', 'auto_gbp');
      expect(a).toHaveProperty('active', true);
    });
  });

  it('generates lowercase alias', function() {
    var aliases = generateNameAliases('ABC Dental');
    var texts = aliases.map(function(a) { return a.alias; });
    expect(texts).toContain('abc dental');
  });

  it('strips LLC suffix to produce no-suffix variant', function() {
    var aliases = generateNameAliases('Brilliant Smiles Dental LLC');
    var texts = aliases.map(function(a) { return a.alias; });
    expect(texts).toContain('brilliant smiles dental');
  });

  it('strips Inc suffix', function() {
    var aliases = generateNameAliases('Fast Auto Inc');
    var texts = aliases.map(function(a) { return a.alias; });
    expect(texts).toContain('fast auto');
  });

  it('removes punctuation to produce no-punctuation variant', function() {
    var aliases = generateNameAliases("Robyn's Fabrics");
    var texts = aliases.map(function(a) { return a.alias; });
    var hasPunctFree = texts.some(function(t) { return t.includes('robyns'); });
    expect(hasPunctFree).toBe(true);
  });

  it('generates abbreviation from multi-word name', function() {
    var aliases = generateNameAliases('Brilliant Smiles Dental');
    var texts = aliases.map(function(a) { return a.alias; });
    // abbreviation: b, s, d → "BSD" (3 chars, within 2-5 limit)
    var hasBsd = texts.some(function(t) { return t === 'bsd'; });
    expect(hasBsd).toBe(true);
  });

  it('does not generate abbreviation for single-word name', function() {
    var aliases = generateNameAliases('Walmart');
    var texts = aliases.map(function(a) { return a.alias; });
    // Single word — no abbreviation (W is 1 char, below minimum of 2)
    var hasW = texts.some(function(t) { return t === 'w'; });
    expect(hasW).toBe(false);
  });

  it('returns empty array for null input', function() {
    expect(generateNameAliases(null)).toEqual([]);
    expect(generateNameAliases('')).toEqual([]);
  });

  it('deduplicates aliases', function() {
    // "ABC LLC" → "ABC LLC" (lowercase) and "ABC" (no-suffix) — no duplicates
    var aliases = generateNameAliases('ABC LLC');
    var texts = aliases.map(function(a) { return a.alias; });
    var uniqueTexts = [...new Set(texts)];
    expect(texts.length).toBe(uniqueTexts.length);
  });
});

// ── generateTemplatePrompts tests ─────────────────────────────────────────────

describe('generateTemplatePrompts', function() {
  var prompts;
  beforeEach(function() {
    prompts = generateTemplatePrompts('dental_office', 'Atlanta', 'GA');
  });

  it('generates at least 10 prompts', function() {
    expect(prompts.length).toBeGreaterThanOrEqual(10);
  });

  it('each prompt has text, intentBucket, type fields', function() {
    prompts.forEach(function(p) {
      expect(p).toHaveProperty('text');
      expect(p).toHaveProperty('intentBucket');
      expect(p).toHaveProperty('type');
      expect(typeof p.text).toBe('string');
      expect(p.text.length).toBeGreaterThan(0);
    });
  });

  it('each intentBucket is from the eight-bucket taxonomy', function() {
    prompts.forEach(function(p) {
      expect(VALID_BUCKETS).toContain(p.intentBucket);
    });
  });

  it('each type is one of the four valid types', function() {
    prompts.forEach(function(p) {
      expect(VALID_TYPES).toContain(p.type);
    });
  });

  it('covers all 8 intent buckets', function() {
    var covered = new Set(prompts.map(function(p) { return p.intentBucket; }));
    VALID_BUCKETS.forEach(function(bucket) {
      expect(covered.has(bucket)).toBe(true);
    });
  });

  it('includes city name in prompt text', function() {
    var hasCity = prompts.some(function(p) { return p.text.includes('Atlanta'); });
    expect(hasCity).toBe(true);
  });
});

// ── buildPrompt tests ─────────────────────────────────────────────────────────

describe('buildPrompt', function() {
  it('builds a fully-shaped prompt object', function() {
    var p = buildPrompt('best dentist in Atlanta', 'best-in-city', 'category', 0);
    expect(p.id).toBe('prompt_001');
    expect(p.text).toBe('best dentist in Atlanta');
    expect(p.intentBucket).toBe('best-in-city');
    expect(p.type).toBe('category');
    expect(p.source).toBe('auto_generated');
    expect(p.active).toBe(true);
    expect(p.lastRunAt).toBeNull();
    expect(p.lastMentionedAt).toBeNull();
    expect(p.historicalMentionRate).toBeNull();
  });

  it('generates padded IDs (prompt_001 through prompt_015)', function() {
    var p1  = buildPrompt('text', 'best-in-city', 'category', 0);
    var p10 = buildPrompt('text', 'near-me',      'category', 9);
    var p15 = buildPrompt('text', 'trust-intent', 'recommendation', 14);
    expect(p1.id).toBe('prompt_001');
    expect(p10.id).toBe('prompt_010');
    expect(p15.id).toBe('prompt_015');
  });

  it('falls back to INTENT_BUCKETS type when type arg is falsy', function() {
    var p = buildPrompt('text', 'trust-intent', '', 0);
    expect(p.type).toBe('recommendation');
  });
});

// ── INTENT_BUCKETS constant tests ─────────────────────────────────────────────

describe('INTENT_BUCKETS', function() {
  it('contains exactly 8 buckets', function() {
    expect(Object.keys(INTENT_BUCKETS).length).toBe(8);
  });

  it('has the eight expected bucket keys', function() {
    var expectedBuckets = [
      'best-in-city', 'near-me', 'service-intent', 'comparison',
      'trust-intent', 'price-value', 'situation-problem', 'competitor-comparison'
    ];
    expectedBuckets.forEach(function(b) {
      expect(INTENT_BUCKETS).toHaveProperty(b);
    });
  });

  it('each bucket has type and label', function() {
    Object.values(INTENT_BUCKETS).forEach(function(b) {
      expect(b).toHaveProperty('type');
      expect(b).toHaveProperty('label');
      expect(VALID_TYPES).toContain(b.type);
    });
  });
});

// ── generatePromptsForMerchant tests ──────────────────────────────────────────

describe('generatePromptsForMerchant', function() {
  it('generates 10-15 prompts (with Gemini returning 10)', async function() {
    mockGeminiResponse(MOCK_GEMINI_PROMPTS);
    process.env.GEMINI_API_KEY = 'test-key';

    var result = await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY,
      state:        MOCK_STATE
    });

    expect(result.prompts.length).toBeGreaterThanOrEqual(10);
    expect(result.prompts.length).toBeLessThanOrEqual(15);
  });

  it('returns aliases alongside prompts', async function() {
    mockGeminiResponse(MOCK_GEMINI_PROMPTS);
    process.env.GEMINI_API_KEY = 'test-key';

    var result = await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY
    });

    expect(Array.isArray(result.aliases)).toBe(true);
    expect(result.aliases.length).toBeGreaterThan(0);
  });

  it('falls back to templates when Gemini throws', async function() {
    GoogleGenerativeAI.mockImplementation(function() {
      return {
        getGenerativeModel: jest.fn().mockReturnValue({
          generateContent: jest.fn().mockRejectedValue(new Error('API error'))
        })
      };
    });
    process.env.GEMINI_API_KEY = 'test-key';

    var result = await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY,
      state:        MOCK_STATE
    });

    expect(result.prompts.length).toBeGreaterThanOrEqual(10);
    expect(result.prompts.length).toBeLessThanOrEqual(15);
  });

  it('saves document to Firestore with correct structure', async function() {
    mockGeminiResponse(MOCK_GEMINI_PROMPTS);
    process.env.GEMINI_API_KEY = 'test-key';

    await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY,
      state:        MOCK_STATE
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId:          MOCK_MERCHANT_ID,
        gbpCategory:         MOCK_GBP_CATEGORY,
        merchantNameAliases: expect.any(Array),
        prompts:             expect.any(Array),
        autoGenVersion:      '1.0'
      }),
      { merge: true }
    );
  });

  it('throws if required fields are missing', async function() {
    await expect(generatePromptsForMerchant({ merchantId: 'x' })).rejects.toThrow();
  });

  it('each returned prompt has intentBucket from eight-bucket taxonomy', async function() {
    mockGeminiResponse(MOCK_GEMINI_PROMPTS);
    process.env.GEMINI_API_KEY = 'test-key';

    var result = await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY,
      state:        MOCK_STATE
    });

    result.prompts.forEach(function(p) {
      expect(VALID_BUCKETS).toContain(p.intentBucket);
    });
  });

  it('each returned prompt has type from valid types', async function() {
    mockGeminiResponse(MOCK_GEMINI_PROMPTS);
    process.env.GEMINI_API_KEY = 'test-key';

    var result = await generatePromptsForMerchant({
      merchantId:   MOCK_MERCHANT_ID,
      merchantName: MOCK_MERCHANT_NAME,
      gbpCategory:  MOCK_GBP_CATEGORY,
      city:         MOCK_CITY,
      state:        MOCK_STATE
    });

    result.prompts.forEach(function(p) {
      expect(VALID_TYPES).toContain(p.type);
    });
  });
});
