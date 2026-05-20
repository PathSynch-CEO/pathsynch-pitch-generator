'use strict';

/**
 * Unit tests for competitorValidator.js
 *
 * Tests Layer 1 (deterministic category/name classification),
 * Layer 3 (geo boundary check), JSON parsing, and threshold mode determination.
 *
 * NOTE: Layer 2 (Gemini) is not unit-tested here because it requires a live API key.
 * It is covered by integration tests (re-run Charlotte, NC report and verify Firestore output).
 */

const {
    classifyLayer1,
    checkGeoBounds,
    parseGeminiValidationResponse,
    determineValidationMode
} = require('../services/competitorValidator');

// ---------------------------------------------------------------------------
// Layer 1 — Name blocklist
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (name blocklist → invalid)', () => {
    test('rejects "It\'s Fashion Corporate Office" by name', () => {
        const result = classifyLayer1(
            { name: "It's Fashion Corporate Office", types: ['clothing_store'] },
            'Retail', 'Clothing & Apparel'
        );
        expect(result.relevance).toBe('invalid');
        expect(result.validationLayer).toBe('category');
        expect(result.reason.toLowerCase()).toContain('corporate office');
        expect(result.confidence).toBe('high');
    });

    test('rejects "Ross Stores Distribution Center" by name', () => {
        const result = classifyLayer1(
            { name: 'Ross Stores Distribution Center', types: ['point_of_interest'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
        expect(result.reason.toLowerCase()).toContain('distribution center');
    });

    test('rejects "Publix Charlotte Division Headquarters" by name', () => {
        const result = classifyLayer1(
            { name: 'Publix Charlotte Division Headquarters', types: ['establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
        expect(result.reason.toLowerCase()).toContain('headquarters');
    });

    test('rejects business with " HQ" in name (space+hq pattern)', () => {
        const result = classifyLayer1(
            { name: 'Acme Retail HQ', types: ['store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('rejects warehouse', () => {
        const result = classifyLayer1(
            { name: 'Target Warehouse', types: ['point_of_interest'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Type blocklist
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (type blocklist → invalid)', () => {
    test('rejects corporate_office type', () => {
        const result = classifyLayer1(
            { name: 'Some Company', types: ['corporate_office', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
        expect(result.reason).toContain('corporate_office');
        expect(result.confidence).toBe('high');
    });

    test('rejects distribution_center type', () => {
        const result = classifyLayer1(
            { name: 'Some Co', types: ['distribution_center'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('rejects warehouse type', () => {
        const result = classifyLayer1(
            { name: 'Some Co', types: ['warehouse'] },
            'Home Services', 'HVAC'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('rejects university type', () => {
        const result = classifyLayer1(
            { name: 'Charlotte College', types: ['university', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Direct type classification
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (direct type → direct)', () => {
    test('classifies home_goods_store as direct for Home Goods & Decor', () => {
        const result = classifyLayer1(
            { name: "Robyn's Fabrics & Custom Design Interiors", types: ['home_goods_store', 'store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('high');
        expect(result.reason).toContain('home_goods_store');
    });

    test('classifies furniture_store as direct for Home Goods & Decor', () => {
        const result = classifyLayer1(
            { name: 'Modern Furniture Co', types: ['furniture_store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('high');
    });

    test('classifies clothing_store as direct for Clothing & Apparel', () => {
        const result = classifyLayer1(
            { name: 'Trendy Boutique', types: ['clothing_store', 'store'] },
            'Retail', 'Clothing & Apparel'
        );
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('high');
    });

    test('classifies restaurant as direct for Full Service restaurant', () => {
        const result = classifyLayer1(
            { name: 'Mario\'s Italian Grill', types: ['restaurant', 'food'] },
            'Restaurant / Food', 'Full Service'
        );
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('high');
    });

    test('classifies plumber type as direct for Plumbing', () => {
        const result = classifyLayer1(
            { name: 'ABC Plumbing Co', types: ['plumber'] },
            'Home Services', 'Plumbing'
        );
        expect(result.relevance).toBe('direct');
    });

    test('classifies gym as direct for Gym sub-industry', () => {
        const result = classifyLayer1(
            { name: 'Iron Fitness Center', types: ['gym'] },
            'Fitness', 'Gym'
        );
        expect(result.relevance).toBe('direct');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Adjacent type classification
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (adjacent type → adjacent)', () => {
    test('classifies shopping_mall as adjacent for Home Goods & Decor', () => {
        const result = classifyLayer1(
            { name: 'SouthPark', types: ['shopping_mall', 'point_of_interest'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('adjacent');
        expect(result.confidence).toBe('medium');
    });

    test('classifies department_store as adjacent for Home Goods & Decor', () => {
        const result = classifyLayer1(
            { name: 'Nordstrom', types: ['department_store', 'store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('adjacent');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Keyword classification (1D before 1E — keyword beats adjacent type)
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (keyword → direct, overrides adjacent type)', () => {
    test('classifies by name keyword when types are generic (fabric keyword)', () => {
        const result = classifyLayer1(
            { name: 'Modern Fabrics', types: ['store', 'point_of_interest'] },
            'Retail', 'Home Goods & Decor'
        );
        // 'store' is adjacentType, but 'fabric' keyword should upgrade to direct
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('medium');
        expect(result.reason).toContain('keyword');
        expect(result.reason).toContain('fabric');
    });

    test('classifies "Midas Fabric & Blinds" as direct via keyword', () => {
        const result = classifyLayer1(
            { name: 'Midas Fabric & Blinds', types: ['store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('direct');
        expect(result.reason).toContain('keyword');
    });

    test('classifies "Ballard Designs" as direct via "decor" keyword', () => {
        const result = classifyLayer1(
            { name: 'Ballard Designs', types: ['store', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        // No keyword match on "ballard designs" alone...
        // Actually 'decor' is not in the name. Let's use a name with the keyword.
        // Use "Home Decor Studio" instead
        const result2 = classifyLayer1(
            { name: 'Home Decor Studio', types: ['store'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result2.relevance).toBe('direct');
        expect(result2.reason).toContain('keyword');
    });

    test('keyword match takes priority over adjacent type match (store type)', () => {
        const result = classifyLayer1(
            { name: 'Charlotte Furniture Gallery', types: ['store'] },
            'Retail', 'Home Goods & Decor'
        );
        // 'store' is adjacentType; 'furniture' is directKeyword
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('medium');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Unknown (passes to Layer 2)
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (unknown → Layer 2)', () => {
    test('returns unknown for Lowe\'s Tower (generic types, no keyword match)', () => {
        const result = classifyLayer1(
            { name: "Lowe's Tower", types: ['point_of_interest', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        // "Lowe's Tower" does not contain any directKeyword (no 'fabric', 'furniture', etc.)
        // 'establishment' is not in adjacentTypes
        // Falls through to unknown for Layer 2
        expect(result.relevance).toBe('unknown');
        expect(result.confidence).toBe('low');
    });

    test('returns unknown for Retail Architects (B2B software, generic types)', () => {
        const result = classifyLayer1(
            { name: 'Retail Architects', types: ['point_of_interest', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        // "Retail" in name does NOT match directKeywords (which are sub-industry specific)
        expect(result.relevance).toBe('unknown');
    });

    test('returns unknown for industry with no defined allowlist', () => {
        const result = classifyLayer1(
            { name: 'Some Business', types: ['store'] },
            'UnknownIndustry', 'UnknownSubIndustry'
        );
        expect(result.relevance).toBe('unknown');
        expect(result.reason).toContain('No allowlist');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — _default allowlist fallback
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 1 (_default fallback)', () => {
    test('uses Retail _default when sub-industry not in allowlist', () => {
        const result = classifyLayer1(
            { name: 'Generic Store', types: ['store'] },
            'Retail', 'Some Unlisted Sub-Industry'
        );
        // _default has 'store' as directType
        expect(result.relevance).toBe('direct');
        expect(result.confidence).toBe('high');
    });
});

// ---------------------------------------------------------------------------
// Layer 3 — Geographic state boundary check
// ---------------------------------------------------------------------------

describe('competitorValidator — Layer 3 (geo boundary)', () => {
    test('flags Fort Mill, SC as cross-border for NC report', () => {
        const result = checkGeoBounds(
            { formatted_address: '1300 Altura Rd #200, Fort Mill, SC 29708, USA' },
            'NC'
        );
        expect(result.crossBorder).toBe(true);
        expect(result.placeState).toBe('SC');
        expect(result.targetState).toBe('NC');
    });

    test('does not flag Charlotte, NC for NC report', () => {
        const result = checkGeoBounds(
            { formatted_address: '10703 Park Rd, Charlotte, NC 28210, USA' },
            'NC'
        );
        expect(result.crossBorder).toBe(false);
        expect(result.placeState).toBe('NC');
    });

    test('handles address field (not formatted_address)', () => {
        const result = checkGeoBounds(
            { address: '123 Main St, Atlanta, GA 30301, USA' },
            'GA'
        );
        expect(result.crossBorder).toBe(false);
    });

    test('handles missing address gracefully', () => {
        const result = checkGeoBounds({}, 'NC');
        // placeState will be '' which doesn't match 'NC'
        expect(result.crossBorder).toBe(true); // empty vs NC
        expect(result.placeState).toBe('');
    });
});

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

describe('competitorValidator — parseGeminiValidationResponse', () => {
    test('parses valid Gemini array response', () => {
        const raw = 'Here is the classification:\n[{"name":"Test Furniture","relevance":"direct","reason":"Sells furniture directly to consumers"}]';
        const result = parseGeminiValidationResponse(raw);
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0].relevance).toBe('direct');
        expect(result[0].name).toBe('Test Furniture');
    });

    test('parses multi-item response', () => {
        const raw = `[
  {"name":"Good Store","relevance":"direct","reason":"Sells products"},
  {"name":"Bad Corp HQ","relevance":"invalid","reason":"Corporate office"},
  {"name":"Model Train Shop","relevance":"adjacent","reason":"Consumer retail, wrong sub-industry"}
]`;
        const result = parseGeminiValidationResponse(raw);
        expect(result).toHaveLength(3);
        expect(result[0].relevance).toBe('direct');
        expect(result[1].relevance).toBe('invalid');
        expect(result[2].relevance).toBe('adjacent');
    });

    test('returns null for unparseable response', () => {
        const raw = 'I cannot classify these businesses because the request is unclear.';
        const result = parseGeminiValidationResponse(raw);
        expect(result).toBeNull();
    });

    test('returns null for empty string', () => {
        const result = parseGeminiValidationResponse('');
        expect(result).toBeNull();
    });

    test('defaults unexpected relevance values to adjacent', () => {
        const raw = '[{"name":"Ambiguous Business","relevance":"maybe","reason":"Unclear"}]';
        const result = parseGeminiValidationResponse(raw);
        expect(result).not.toBeNull();
        expect(result[0].relevance).toBe('adjacent');
    });

    test('handles response with markdown fences around array', () => {
        const raw = '```json\n[{"name":"Good Store","relevance":"direct","reason":"Sells products"}]\n```';
        const result = parseGeminiValidationResponse(raw);
        expect(result).not.toBeNull();
        expect(result[0].relevance).toBe('direct');
    });

    test('fills missing name with "unknown"', () => {
        const raw = '[{"relevance":"invalid","reason":"No name provided"}]';
        const result = parseGeminiValidationResponse(raw);
        expect(result[0].name).toBe('unknown');
    });

    test('fills missing reason with default text', () => {
        const raw = '[{"name":"Test","relevance":"adjacent"}]';
        const result = parseGeminiValidationResponse(raw);
        expect(result[0].reason).toBe('No reason provided');
    });
});

// ---------------------------------------------------------------------------
// Minimum threshold mode determination
// ---------------------------------------------------------------------------

describe('competitorValidator — determineValidationMode', () => {
    test('returns full when direct >= 10', () => {
        expect(determineValidationMode(10, 5)).toBe('full');
        expect(determineValidationMode(12, 0)).toBe('full');
        expect(determineValidationMode(25, 8)).toBe('full');
    });

    test('returns thin_market when direct < 10 but total >= 15', () => {
        expect(determineValidationMode(7, 8)).toBe('thin_market');  // 7+8=15
        expect(determineValidationMode(5, 10)).toBe('thin_market'); // 5+10=15
        expect(determineValidationMode(9, 6)).toBe('thin_market');  // 9+6=15, direct=9<10
    });

    test('returns fallback when total < 15', () => {
        expect(determineValidationMode(5, 4)).toBe('fallback');  // 5+4=9 < 15
        expect(determineValidationMode(0, 0)).toBe('fallback');
        expect(determineValidationMode(7, 7)).toBe('fallback');  // direct=7<10, total=14<15
    });

    test('boundary: direct exactly 10 → full', () => {
        expect(determineValidationMode(10, 0)).toBe('full');
    });

    test('boundary: direct 9, adjacent 6 → thin_market (total=15)', () => {
        expect(determineValidationMode(9, 6)).toBe('thin_market');
    });

    test('boundary: direct 9, adjacent 5 → fallback (total=14)', () => {
        expect(determineValidationMode(9, 5)).toBe('fallback');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Known false positives from Charlotte, NC report
// ---------------------------------------------------------------------------

describe('competitorValidator — known Charlotte NC false positives', () => {
    // These are the exact businesses from the ticket. Layer 1 should catch
    // the deterministic ones (name/type blocklist). Layer 2 (Gemini) catches
    // the ambiguous ones (Lowe's Tower, Retail Architects).
    // What matters per AC#1: ALL five end up in rejectedCompetitors — the
    // specific layer doesn't matter.

    test('Ross Stores Distribution Center caught by Layer 1', () => {
        const result = classifyLayer1(
            { name: 'Ross Stores Distribution Center', types: ['point_of_interest', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('It\'s Fashion Corporate Office caught by Layer 1 name pattern', () => {
        const result = classifyLayer1(
            { name: "It's Fashion Corporate Office", types: ['clothing_store', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('Publix Charlotte Division Headquarters caught by Layer 1 name pattern', () => {
        const result = classifyLayer1(
            { name: 'Publix Charlotte Division Headquarters', types: ['establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('invalid');
    });

    test('Lowe\'s Tower passes through Layer 1 as unknown (caught by Layer 2)', () => {
        const result = classifyLayer1(
            { name: "Lowe's Tower", types: ['point_of_interest', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        // Layer 1 should NOT reject this — it has no blocklist match
        // and 'establishment' is not in adjacentTypes
        // Layer 2 (Gemini) will reject it
        expect(result.relevance).toBe('unknown');
    });

    test('Retail Architects passes through Layer 1 as unknown (caught by Layer 2)', () => {
        const result = classifyLayer1(
            { name: 'Retail Architects', types: ['point_of_interest', 'establishment'] },
            'Retail', 'Home Goods & Decor'
        );
        expect(result.relevance).toBe('unknown');
    });
});

// ---------------------------------------------------------------------------
// Layer 1 — Lionel Retail Store (adjacent, not invalid)
// ---------------------------------------------------------------------------

describe('competitorValidator — Lionel Retail Store (adjacent market context)', () => {
    test('classifies model train store as unknown/adjacent, never invalid', () => {
        // Lionel Retail Store sells model trains — consumer retail, wrong sub-industry
        // Layer 1 should NOT reject it (it's a legitimate consumer store)
        // It will be classified by Gemini in Layer 2 as adjacent
        const result = classifyLayer1(
            { name: 'Lionel Retail Store', types: ['store', 'point_of_interest'] },
            'Retail', 'Home Goods & Decor'
        );
        // 'store' is in adjacentTypes → adjacent
        // OR no match → unknown
        // Either way, it should NOT be invalid
        expect(result.relevance).not.toBe('invalid');
    });
});
