/**
 * Competitor Validator — Three-Layer Validation with Three-State Relevance
 *
 * Classifies each Google Places competitor result as:
 *   direct   — confirmed consumer-facing business in the target sub-industry
 *   adjacent — legitimate business, wrong sub-industry (excluded from benchmarks)
 *   invalid  — non-consumer-facing entity (corporate office, warehouse, B2B, etc.)
 *
 * Layer 1: GBP Category + Name Match (deterministic, no API cost)
 * Layer 2: Gemini Validation Sweep (best-effort, 5s timeout)
 * Layer 3: Geographic State Boundary Check (flag only, not reject)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const validationConfig = require('../config/competitorValidation.json');

const { BLOCKLIST_TYPES, NAME_BLOCKLIST_PATTERNS, CATEGORY_ALLOWLISTS } = validationConfig;

const MIN_DIRECT_COMPETITORS = 10;
const MIN_TOTAL_MARKET_CONTEXT = 15;
const GEMINI_VALIDATION_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Layer 1 — Deterministic category / name classification
// ---------------------------------------------------------------------------

/**
 * Classify a single Places result using blocklists and allowlists.
 *
 * Evaluation order (first match wins):
 *   1A. Type blocklist   → invalid, high confidence
 *   1B. Name blocklist   → invalid, high confidence
 *   1C. Direct type      → direct, high confidence
 *   1D. Direct keyword   → direct, medium confidence  (before adjacent type check)
 *   1E. Adjacent type    → adjacent, medium confidence
 *   1F. No match         → unknown, low confidence   (→ Layer 2)
 *
 * @param {Object} placeResult  - { name, types: string[], formatted_address? }
 * @param {string} industry     - Top-level industry label (e.g. "Retail")
 * @param {string} subIndustry  - Sub-industry label (e.g. "Home Goods & Decor")
 * @returns {{ relevance: string, validationLayer: string, reason: string, confidence: string }}
 */
function classifyLayer1(placeResult, industry, subIndustry) {
    const types = placeResult.types || [];
    const name = (placeResult.name || '').toLowerCase();

    // 1A: Type blocklist → invalid
    const blockedType = types.find(t => BLOCKLIST_TYPES.includes(t));
    if (blockedType) {
        return {
            relevance: 'invalid',
            validationLayer: 'category',
            reason: `Blocklisted type: ${blockedType}`,
            confidence: 'high'
        };
    }

    // 1B: Name blocklist → invalid
    const matchedPattern = NAME_BLOCKLIST_PATTERNS.find(p => name.includes(p));
    if (matchedPattern) {
        return {
            relevance: 'invalid',
            validationLayer: 'category',
            reason: `Name contains blocklisted pattern: "${matchedPattern}"`,
            confidence: 'high'
        };
    }

    // Resolve allowlist — try exact sub-industry match, then _default for that industry
    const allowlist = (CATEGORY_ALLOWLISTS[industry] && CATEGORY_ALLOWLISTS[industry][subIndustry])
        || (CATEGORY_ALLOWLISTS[industry] && CATEGORY_ALLOWLISTS[industry]['_default'])
        || null;

    if (!allowlist) {
        return {
            relevance: 'unknown',
            validationLayer: 'category',
            reason: `No allowlist defined for industry "${industry}"`,
            confidence: 'low'
        };
    }

    // 1C: Direct type match → direct, high confidence
    const directType = types.find(t => allowlist.directTypes.includes(t));
    if (directType) {
        return {
            relevance: 'direct',
            validationLayer: 'category',
            reason: `Direct category match: ${directType}`,
            confidence: 'high'
        };
    }

    // 1D: Direct keyword match → direct, medium confidence (takes priority over adjacent type)
    if (allowlist.directKeywords && allowlist.directKeywords.length > 0) {
        const matchedKw = allowlist.directKeywords.find(kw => name.includes(kw));
        if (matchedKw) {
            return {
                relevance: 'direct',
                validationLayer: 'category',
                reason: `Name keyword match: "${matchedKw}"`,
                confidence: 'medium'
            };
        }
    }

    // 1E: Adjacent type match → adjacent, medium confidence
    const adjacentType = types.find(t => allowlist.adjacentTypes.includes(t));
    if (adjacentType) {
        return {
            relevance: 'adjacent',
            validationLayer: 'category',
            reason: `Adjacent category: ${adjacentType}`,
            confidence: 'medium'
        };
    }

    // 1F: No match → unknown, pass to Layer 2
    return {
        relevance: 'unknown',
        validationLayer: 'category',
        reason: `No category or keyword match. Types: [${types.join(', ')}]`,
        confidence: 'low'
    };
}

// ---------------------------------------------------------------------------
// Layer 2 — Gemini Validation Sweep
// ---------------------------------------------------------------------------

/**
 * Parse the raw Gemini validation response into a structured array.
 * Uses array extraction (find first [ and last ]) rather than full JSON parse.
 *
 * @param {string} rawText
 * @returns {Array<{name, relevance, reason}>|null} null on parse failure
 */
function parseGeminiValidationResponse(rawText) {
    try {
        const startIdx = rawText.indexOf('[');
        const endIdx = rawText.lastIndexOf(']');

        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
            throw new Error('No JSON array found in response');
        }

        const jsonStr = rawText.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonStr);

        if (!Array.isArray(parsed)) {
            throw new Error('Parsed value is not an array');
        }

        return parsed.map(item => ({
            name: item.name || 'unknown',
            relevance: ['direct', 'adjacent', 'invalid'].includes(item.relevance)
                ? item.relevance
                : 'adjacent', // default to adjacent if unexpected value
            reason: item.reason || 'No reason provided'
        }));
    } catch (err) {
        console.error('[CompetitorValidation] Gemini JSON parse failed:', err.message);
        return null;
    }
}

/**
 * Run Gemini validation on ambiguous candidates.
 *
 * @param {Array} candidates - competitor objects with name, types, formatted_address
 * @param {Object} context   - { city, state, industry, subIndustry }
 * @returns {Array<{name, relevance, reason}>|null}
 */
async function runGeminiValidation(candidates, { city, state, industry, subIndustry }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('[CompetitorValidation] GEMINI_API_KEY not set — skipping Layer 2');
        return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
    });

    const candidateData = candidates.map(c => ({
        name: c.name,
        address: c.address || c.formatted_address || '',
        types: c.types || [],
        primaryType: (c.types || [])[0] || 'unknown'
    }));

    const prompt = `You are validating business competitors for a market intelligence report.

REPORT CONTEXT:
- Industry: ${industry}
- Sub-Industry: ${subIndustry}
- City: ${city}, ${state}
- Target: Consumer-facing businesses that SELL ${subIndustry} products/services directly to end customers

CANDIDATE BUSINESSES TO EVALUATE:
${JSON.stringify(candidateData, null, 2)}

For EACH candidate, classify as one of three relevance levels:

- "direct": This business sells ${subIndustry} products/services directly to consumers. It is a direct competitor in this market.
- "adjacent": This is a legitimate consumer-facing retail/service business, but it operates in a DIFFERENT sub-industry (e.g., a model train store in a Home Goods & Decor report). It provides useful market context but is not a direct competitor.
- "invalid": This is NOT a consumer-facing business at all. It is a corporate office, warehouse, distribution center, B2B software company, government building, or other non-retail entity.

Respond with ONLY a valid JSON array, no markdown, no preamble:
[
  { "name": "Business Name", "relevance": "direct|adjacent|invalid", "reason": "1 sentence" }
]

CLASSIFICATION RULES:
- A business that sells TO the ${subIndustry} industry (e.g., POS software for furniture stores) is "invalid" — it is a vendor, not a competitor.
- A named building or tower (e.g., "Lowe's Tower") is "invalid" unless it is itself a retail storefront.
- A business that sells consumer products but in a different category (e.g., model trains in a Home Goods report) is "adjacent".
- Shopping malls and department stores that CONTAIN ${subIndustry} retailers are "adjacent" unless the report is specifically about malls.
- When in doubt, classify as "adjacent" rather than "invalid" — preserving market context is better than over-filtering.`;

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const text = result.response.text();
    return parseGeminiValidationResponse(text);
}

// ---------------------------------------------------------------------------
// Layer 3 — Geographic state boundary check
// ---------------------------------------------------------------------------

/**
 * Check whether a place result is in the target state.
 * Returns metadata — does NOT change relevance classification.
 *
 * @param {Object} placeResult
 * @param {string} targetState - 2-letter state abbreviation (e.g. "NC")
 * @returns {{ crossBorder: boolean, placeState: string, targetState: string }}
 */
function checkGeoBounds(placeResult, targetState) {
    const address = (placeResult.address || placeResult.formatted_address || '').toUpperCase();
    const parts = address.split(',').map(s => s.trim());
    const stateZip = parts[parts.length - 2] || '';
    const placeState = stateZip.split(' ')[0];

    return {
        crossBorder: placeState !== (targetState || '').toUpperCase(),
        placeState: placeState,
        targetState: (targetState || '').toUpperCase()
    };
}

// ---------------------------------------------------------------------------
// Threshold mode determination
// ---------------------------------------------------------------------------

/**
 * Determine validation mode based on direct/adjacent counts.
 *
 * @param {number} directCount
 * @param {number} adjacentCount
 * @returns {'full'|'thin_market'|'fallback'}
 */
function determineValidationMode(directCount, adjacentCount) {
    if (directCount >= MIN_DIRECT_COMPETITORS) return 'full';
    if (directCount + adjacentCount >= MIN_TOTAL_MARKET_CONTEXT) return 'thin_market';
    return 'fallback';
}

// ---------------------------------------------------------------------------
// Main validation pipeline
// ---------------------------------------------------------------------------

/**
 * Run the three-layer validation pipeline on raw competitor results.
 *
 * @param {Array} rawCompetitors - Array of competitor objects from Google Places
 * @param {Object} context - { city, state, industry, subIndustry }
 * @returns {Promise<{
 *   direct: Array,
 *   adjacent: Array,
 *   rejected: Array,
 *   validationMetadata: Object
 * }>}
 */
async function validateCompetitors(rawCompetitors, { city, state, industry, subIndustry }) {
    const totalFetched = rawCompetitors.length;
    const direct = [];
    const adjacent = [];
    const rejected = [];
    const ambiguous = [];

    const rejectionBreakdown = {
        category_type: 0,
        category_name: 0,
        gemini: 0,
        geo_flagged: 0
    };

    let geminiValidationStatus = 'skipped';

    // --- Layer 1: Deterministic classification ---
    for (const comp of rawCompetitors) {
        const l1 = classifyLayer1(comp, industry, subIndustry);

        if (l1.relevance === 'invalid') {
            // Track which sub-check caught it
            if (l1.reason.startsWith('Blocklisted type')) {
                rejectionBreakdown.category_type++;
            } else {
                rejectionBreakdown.category_name++;
            }
            rejected.push({
                ...comp,
                validation: l1
            });
        } else if (l1.relevance === 'direct' && l1.confidence === 'high') {
            // High-confidence direct — skip Layer 2
            direct.push({ ...comp, validation: l1 });
        } else if (l1.relevance === 'adjacent' && l1.confidence === 'high') {
            // High-confidence adjacent — skip Layer 2
            adjacent.push({ ...comp, validation: l1 });
        } else {
            // unknown, or direct/adjacent with lower confidence — send to Layer 2
            ambiguous.push({ ...comp, validation: l1 });
        }
    }

    console.log(`[CompetitorValidation] Layer 1: ${direct.length} direct, ${adjacent.length} adjacent, ${rejected.length} rejected, ${ambiguous.length} ambiguous`);

    // --- Layer 2: Gemini sweep on ambiguous candidates ---
    if (ambiguous.length > 0) {
        let geminiResults = null;

        try {
            geminiResults = await Promise.race([
                runGeminiValidation(ambiguous, { city, state, industry, subIndustry }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Gemini validation timeout')), GEMINI_VALIDATION_TIMEOUT_MS)
                )
            ]);
            geminiValidationStatus = geminiResults ? 'success' : 'parse_failed';
        } catch (err) {
            console.error('[CompetitorValidation] Layer 2 error (non-blocking):', err.message);
            geminiValidationStatus = err.message.includes('timeout') ? 'timeout' : 'error';
        }

        if (geminiResults) {
            // Build a lookup map by normalized name
            const geminiMap = new Map(
                geminiResults.map(r => [(r.name || '').toLowerCase().trim(), r])
            );

            for (const comp of ambiguous) {
                const compNameKey = (comp.name || '').toLowerCase().trim();
                const geminiMatch = geminiMap.get(compNameKey);

                if (geminiMatch) {
                    const validation = {
                        relevance: geminiMatch.relevance,
                        validationLayer: 'gemini',
                        reason: geminiMatch.reason,
                        confidence: 'medium'
                    };

                    if (geminiMatch.relevance === 'invalid') {
                        rejectionBreakdown.gemini++;
                        rejected.push({ ...comp, validation });
                    } else if (geminiMatch.relevance === 'adjacent') {
                        adjacent.push({ ...comp, validation });
                    } else {
                        direct.push({ ...comp, validation });
                    }
                } else {
                    // Gemini didn't return a result for this candidate — default to adjacent
                    adjacent.push({
                        ...comp,
                        validation: {
                            relevance: 'adjacent',
                            validationLayer: 'fallback',
                            reason: 'Gemini result not found for this candidate — defaulted to adjacent',
                            confidence: 'low'
                        }
                    });
                }
            }
        } else {
            // Gemini failed entirely — default all ambiguous to adjacent
            for (const comp of ambiguous) {
                adjacent.push({
                    ...comp,
                    validation: {
                        relevance: 'adjacent',
                        validationLayer: 'fallback',
                        reason: 'Gemini validation unavailable — defaulted to adjacent',
                        confidence: 'low'
                    }
                });
            }
        }

        console.log(`[CompetitorValidation] After Layer 2 (${geminiValidationStatus}): ${direct.length} direct, ${adjacent.length} adjacent, ${rejected.length} rejected`);
    }

    // --- Layer 3: Geographic flag (informational only) ---
    if (state) {
        let geoCrossCount = 0;
        for (const comp of [...direct, ...adjacent]) {
            const geo = checkGeoBounds(comp, state);
            if (geo.crossBorder) {
                comp.crossBorderState = geo.placeState;
                geoCrossCount++;
            }
        }
        rejectionBreakdown.geo_flagged = geoCrossCount;
        if (geoCrossCount > 0) {
            console.log(`[CompetitorValidation] Layer 3: ${geoCrossCount} cross-border businesses flagged (not rejected)`);
        }
    }

    // --- Minimum threshold protection ---
    const validationMode = determineValidationMode(direct.length, adjacent.length);

    // Red flag: pre-validation count was 30+ but direct is below 10
    if (totalFetched >= 30 && direct.length < MIN_DIRECT_COMPETITORS) {
        console.warn(`[CompetitorValidation] RED FLAG: ${totalFetched} raw results but only ${direct.length} direct competitors — allowlist for "${industry} / ${subIndustry}" may be too narrow`);
    }

    const validationMetadata = {
        validationMode,
        geminiValidationUsed: geminiValidationStatus !== 'skipped',
        geminiValidationStatus,
        totalFetched,
        directCompetitorCount: direct.length,
        adjacentCompetitorCount: adjacent.length,
        rejectedCompetitorCount: rejected.length,
        rejectionBreakdown,
        minimumThresholdTriggered: validationMode !== 'full',
        validatedAt: new Date().toISOString()
    };

    console.log(`[CompetitorValidation] Complete: mode=${validationMode}, direct=${direct.length}, adjacent=${adjacent.length}, rejected=${rejected.length}`);

    return { direct, adjacent, rejected, validationMetadata };
}

module.exports = {
    classifyLayer1,
    checkGeoBounds,
    parseGeminiValidationResponse,
    runGeminiValidation,
    validateCompetitors,
    determineValidationMode,
    MIN_DIRECT_COMPETITORS,
    MIN_TOTAL_MARKET_CONTEXT
};
