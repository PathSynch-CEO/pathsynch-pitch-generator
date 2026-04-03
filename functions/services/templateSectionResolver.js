/**
 * Template Section Resolver
 *
 * Resolves each template section into concrete data for HTML rendering.
 * Never blocks on a single field failure — returns null for any field that fails.
 *
 * Field types handled:
 *   text              - Resolve {{variable}} templates against prospectData/sellerProfile
 *   ai_generated      - Pull string result from aiResults by fieldId
 *   ai_generated_list - Pull structured array from aiResults by fieldId
 *   stat_card         - Format number + label from data source path
 *   metric_cards      - Format projected outcome metrics
 *   product_line_items - Assemble from pitch.recommendedProducts
 *   pricing_block     - Assemble from pitch.pricingLineItems
 *   image             - Resolve from sellerProfile.branding or fallback
 *   icon              - Pass through value
 *
 * Conditional sections: evaluate section.condition against prospectData.
 * Skip (return null) if condition is false.
 */

const { interpolatePrompt } = require('./templatePromptBuilder');

/**
 * Safely resolve a dot-notation path from an object.
 * Returns null (not undefined) on miss.
 */
function resolvePath(obj, path) {
    if (!path || !obj) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current == null) return null;
        current = current[part];
    }
    return current !== undefined ? current : null;
}

/**
 * Evaluate a section's condition string against available data.
 * Supports: "x !== null", "x != null", "x === null", "x == null"
 * Unknown/unparseable conditions default to true (show the section).
 */
function evaluateCondition(conditionStr, dataContext) {
    if (!conditionStr) return true;

    // Extract the path from condition (e.g. "prospect.decisionMaker.name !== null")
    const notNullMatch = conditionStr.match(/^([\w.]+)\s*!==?\s*null$/);
    if (notNullMatch) {
        const value = resolvePath(dataContext, notNullMatch[1]);
        return value !== null && value !== undefined;
    }

    const isNullMatch = conditionStr.match(/^([\w.]+)\s*===?\s*null$/);
    if (isNullMatch) {
        const value = resolvePath(dataContext, isNullMatch[1]);
        return value === null || value === undefined;
    }

    // Default: show the section
    console.warn(`[SectionResolver] Could not evaluate condition "${conditionStr}" — showing section`);
    return true;
}

/**
 * Format a stat card number according to its numberFormat template.
 * e.g. "{{value}} star" with value=4.2 → "4.2 star"
 */
function formatStatNumber(value, numberFormat) {
    if (value === null || value === undefined) return '—';
    if (!numberFormat) return String(value);
    return numberFormat.replace('{{value}}', value);
}

/**
 * Resolve a single field definition to its concrete value.
 *
 * @param {Object} field        - Template field definition
 * @param {Object} dataContext  - { prospect, analysis, pitch, sellerProfile, currentMonth, currentYear }
 * @param {Object} aiResults    - Map of { fieldId: value } from Gemini
 * @returns {Object|null}       - Resolved field object { fieldId, type, value, ... } or null on failure
 */
function resolveField(field, dataContext, aiResults) {
    try {
        const { fieldId, type } = field;
        const base = { fieldId, type, style: field.style || null };

        switch (type) {
            case 'text': {
                // Static value
                if (field.value !== undefined) {
                    return { ...base, value: field.value };
                }
                // Template with {{variable}} interpolation
                if (field.template) {
                    const resolved = interpolatePrompt(field.template, dataContext);
                    return { ...base, value: resolved };
                }
                // Direct source path
                if (field.source) {
                    const value = resolvePath(dataContext, field.source) ?? field.fallback ?? null;
                    return { ...base, value };
                }
                return null;
            }

            case 'icon': {
                return { ...base, value: field.value || null };
            }

            case 'image': {
                const imgValue = resolvePath(dataContext, field.source) ?? field.fallback ?? null;
                return { ...base, value: imgValue, fallback: field.fallback || null, position: field.position || null };
            }

            case 'ai_generated': {
                const aiValue = aiResults[fieldId] ?? null;
                return { ...base, value: aiValue };
            }

            case 'ai_generated_list': {
                let listValue = aiResults[fieldId] ?? null;
                // Ensure it's an array
                if (listValue && !Array.isArray(listValue)) {
                    listValue = Array.isArray(Object.values(listValue)) ? Object.values(listValue) : null;
                }
                return { ...base, value: listValue, itemLayout: field.itemLayout || null };
            }

            case 'stat_card': {
                const numValue = resolvePath(dataContext, field.numberSource);
                const formattedNumber = formatStatNumber(numValue, field.numberFormat);

                let label = field.label || '';
                // Handle template in label (e.g. "{{analysis.topComplaintCategory | uppercase}} COMPLAINTS")
                label = label.replace(/\{\{([^}|]+)(?:\s*\|\s*uppercase)?\}\}/g, (match, path) => {
                    const v = resolvePath(dataContext, path.trim());
                    if (v === null || v === undefined) return '';
                    return match.includes('| uppercase') ? String(v).toUpperCase() : String(v);
                });

                let sublabel = field.sublabel || '';
                if (field.sublabelSource) {
                    sublabel = resolvePath(dataContext, field.sublabelSource) || '';
                } else if (sublabel && sublabel.includes('{{')) {
                    sublabel = interpolatePrompt(sublabel, dataContext);
                }

                return { ...base, number: formattedNumber, label, sublabel };
            }

            case 'metric_cards': {
                // Pull projected outcomes from analysis
                const metrics = resolvePath(dataContext, field.metricsSource) || [];
                return {
                    ...base,
                    metrics: Array.isArray(metrics) ? metrics.slice(0, field.cardCount || 4) : [],
                    cardCount: field.cardCount || 4
                };
            }

            case 'product_line_items': {
                let products = resolvePath(dataContext, field.source) || [];
                // Fallback: use AI-generated solutionPackage products if pitch has none
                if ((!products || products.length === 0) && aiResults?.solutionPackage?.products) {
                    const pkgProducts = aiResults.solutionPackage.products;
                    products = Array.isArray(pkgProducts)
                        ? pkgProducts.map(p =>
                            typeof p === 'string'
                                ? { name: p.replace(/\s*\$[\d,]+\/mo$/, '').trim(), description: p.match(/\$[\d,]+\/mo$/)?.[ 0] || '' }
                                : p
                          )
                        : [];
                }
                return { ...base, products };
            }

            case 'pricing_block': {
                // Priority 1: AI-generated solutionPackage (always has prospect-specific pricing)
                const aiPackage = aiResults?.solutionPackage;
                if (aiPackage && typeof aiPackage === 'object' && (aiPackage.monthlyTotal || aiPackage.packageName)) {
                    return {
                        ...base,
                        pricing: {
                            packageName: aiPackage.packageName || `${dataContext.prospect.businessName || ''} Package`,
                            lineItems:   Array.isArray(aiPackage.products) ? aiPackage.products : [],
                            setupFee:    aiPackage.setupFee || null,
                            monthlyTotal: aiPackage.monthlyTotal || null,
                            highlight:   null
                        },
                        pricingLayout: field.layout || 'package_card'
                    };
                }
                // Priority 2: Explicit pitch pricing from request body / pitch config
                if (!field.fields) return { ...base, pricing: null };
                const pricing = {};
                for (const [key, pathOrTemplate] of Object.entries(field.fields)) {
                    if (typeof pathOrTemplate === 'string' && pathOrTemplate.includes('{{')) {
                        pricing[key] = interpolatePrompt(pathOrTemplate, dataContext);
                    } else {
                        pricing[key] = resolvePath(dataContext, pathOrTemplate) || pathOrTemplate;
                    }
                }
                return { ...base, pricing, pricingLayout: field.layout || 'package_card' };
            }

            default:
                console.warn(`[SectionResolver] Unknown field type "${type}" for fieldId "${fieldId}"`);
                return null;
        }
    } catch (err) {
        console.warn(`[SectionResolver] Field "${field.fieldId}" resolution failed:`, err.message);
        return null;
    }
}

/**
 * Resolve a single section.
 *
 * @param {Object} section      - Template section definition
 * @param {Object} prospectData - { prospect, analysis }
 * @param {Object} aiResults    - Map of { fieldId: value }
 * @param {Object} sellerProfile - Seller profile from user doc
 * @param {Object} pitch        - Optional pitch-level data (products, pricing)
 * @returns {Object|null}       - Resolved section or null if skipped
 */
function resolveSection(section, prospectData, aiResults, sellerProfile, pitch) {
    const dataContext = {
        prospect: prospectData.prospect || {},
        analysis: prospectData.analysis || {},
        pitch: pitch || {},
        sellerProfile: sellerProfile || {},
        currentMonth: new Date().toLocaleString('default', { month: 'long' }),
        currentYear: new Date().getFullYear()
    };

    // Conditional sections — skip if condition fails
    if (section.condition) {
        const show = evaluateCondition(section.condition, dataContext);
        if (!show) {
            console.log(`[SectionResolver] Skipping section "${section.sectionId}" (condition: ${section.condition})`);
            return null;
        }
    }

    // Special hard-skip rules from task spec
    if (section.sectionId === 'decisionMaker') {
        if (!dataContext.prospect.decisionMaker?.name) {
            console.log('[SectionResolver] Skipping decisionMaker — no owner name found');
            return null;
        }
    }
    // Resolve all fields
    const resolvedFields = [];
    for (const field of (section.fields || [])) {
        const resolved = resolveField(field, dataContext, aiResults);
        if (resolved !== null) {
            resolvedFields.push(resolved);
        }
        // null fields silently dropped — section continues
    }

    return {
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        order: section.order,
        layout: section.layout,
        required: section.required || false,
        maxItems: section.maxItems || null,
        cardCount: section.cardCount || null,
        fields: resolvedFields
    };
}

/**
 * Resolve all sections from a template, returning only non-null results in order.
 *
 * @param {Array}  sections     - template.sections
 * @param {Object} prospectData - { prospect, analysis }
 * @param {Object} aiResults    - Map of { fieldId: value }
 * @param {Object} sellerProfile
 * @param {Object} pitch        - Optional: { recommendedProducts, pricingLineItems, ... }
 * @returns {Array} Resolved sections array (sorted by order)
 */
function resolveAllSections(sections, prospectData, aiResults, sellerProfile, pitch) {
    const sorted = [...sections].sort((a, b) => (a.order || 0) - (b.order || 0));
    const resolved = [];

    for (const section of sorted) {
        const result = resolveSection(section, prospectData, aiResults, sellerProfile, pitch);
        if (result !== null) {
            resolved.push(result);
        }
    }

    console.log(`[SectionResolver] Resolved ${resolved.length}/${sections.length} sections`);
    return resolved;
}

module.exports = { resolveSection, resolveAllSections, resolvePath, evaluateCondition };
