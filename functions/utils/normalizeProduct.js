/**
 * normalizeProduct — backward-compatible product schema normalizer
 *
 * Maps old schema (name, pricing/price) to new structured schema
 * (productName, pricingStructure, monthlyPrice, etc.).
 * Safe to call on both old and new records — idempotent.
 */

const VALID_PRICING_STRUCTURES = ['monthly', 'one_time', 'per_unit', 'tiered', 'custom'];

/**
 * Derive a human-readable pricing string from new schema fields.
 * Falls back to the legacy `pricing` free-text field.
 */
function derivePricingString(p) {
    if (p.pricing) return p.pricing;
    if (p.pricingStructure === 'monthly' || p.pricingStructure === 'tiered') {
        if (p.monthlyPrice) return `$${p.monthlyPrice}/mo`;
    }
    if (p.pricingStructure === 'one_time') {
        if (p.oneTimeFee) return `$${p.oneTimeFee}`;
    }
    if (p.pricingStructure === 'per_unit') {
        if (p.perUnitPrice) return `$${p.perUnitPrice}${p.perUnitLabel ? `/${p.perUnitLabel}` : ''}`;
    }
    return '';
}

/**
 * Normalize a single product object to the current schema.
 * Preserves all existing fields and fills in missing ones with defaults.
 *
 * @param {Object} p - Raw product from Firestore (old or new schema)
 * @returns {Object} Normalized product with all schema fields present
 */
function normalizeProduct(p) {
    if (!p || typeof p !== 'object') return p;

    const productName = p.productName || p.name || '';
    const pricingStructure = VALID_PRICING_STRUCTURES.includes(p.pricingStructure)
        ? p.pricingStructure
        : 'custom';

    const normalized = {
        ...p,
        // Identity
        productId: p.productId || p.id || null,
        productBrand: p.productBrand || '',
        productName,
        name: p.name || productName,           // backward compat — renderers still read p.name
        category: p.category || '',
        // Pricing
        pricingStructure,
        monthlyPrice: p.monthlyPrice || null,
        oneTimeFee: p.oneTimeFee || null,
        setupFee: p.setupFee || null,
        perUnitPrice: p.perUnitPrice || null,
        perUnitLabel: p.perUnitLabel || '',
        pricing: derivePricingString(p),       // backward compat — renderers read p.pricing
        // Content
        description: p.description || '',
        specifications: p.specifications || '',
        productKeywords: Array.isArray(p.productKeywords) ? p.productKeywords : [],
        painPointsAddressed: Array.isArray(p.painPointsAddressed) ? p.painPointsAddressed : [],
        // Status
        isPrimary: !!p.isPrimary,
        isActive: p.isActive !== false,
    };

    return normalized;
}

/**
 * Match products to prospect gaps using painPointsAddressed.
 * Returns products sorted: primary first, then by pain-point overlap (desc).
 *
 * @param {Object[]} products - Normalized product objects
 * @param {string[]} prospectGaps - Array of gap/pain-point strings from prospect analysis
 * @returns {Object[]} Same products array, re-ordered by relevance
 */
function matchProductsToGaps(products, prospectGaps) {
    if (!Array.isArray(products) || products.length === 0) return products || [];
    if (!Array.isArray(prospectGaps) || prospectGaps.length === 0) return products;

    const gapTokens = prospectGaps.map(g => g.toLowerCase());

    const scored = products.map(p => {
        const pains = (p.painPointsAddressed || []).map(pain => pain.toLowerCase());
        const keywords = (p.productKeywords || []).map(kw => kw.toLowerCase());
        const allSignals = [...pains, ...keywords];

        const matchScore = allSignals.reduce((sum, signal) => {
            const hit = gapTokens.some(g => g.includes(signal) || signal.includes(g));
            return sum + (hit ? 1 : 0);
        }, 0);

        return { ...p, _matchScore: matchScore };
    });

    return scored.sort((a, b) => {
        // Primary product always first
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        // Then by match score descending
        return b._matchScore - a._matchScore;
    });
}

module.exports = { normalizeProduct, matchProductsToGaps, VALID_PRICING_STRUCTURES };
