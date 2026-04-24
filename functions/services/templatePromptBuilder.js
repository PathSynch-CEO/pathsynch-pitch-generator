/**
 * Template Batch Prompt Builder
 *
 * Two generation paths:
 *
 * 1. buildAndExecuteTemplatePrompt() — NEW (April 2026)
 *    Used for executive_brief and template-based L2 styles.
 *    Uses generateStructured() with brewhouseResponseSchema for guaranteed schema-compliant output.
 *    No more manual JSON extraction. Field-dropping bugs eliminated.
 *
 * 2. buildAndExecuteBatchPrompt() — LEGACY
 *    Collects all ai_generated and ai_generated_list fields from the template sections,
 *    builds a SINGLE Gemini prompt that generates all fields in one call, and returns
 *    a keyed results map: { fieldId: generatedValue }.
 *    Model: gemini-3-flash-preview with thinkingBudget: 0
 *    JSON extraction: indexOf('{') pattern per SYSTEM_BIBLE
 *    Used for: standard one-pager style (non-executive-brief).
 *
 * Generation rules enforced for both paths:
 *   - Tone: direct, data-driven, respectful
 *   - Perspective: written FOR a salesperson TO hand to a business owner
 *   - No em dashes
 *   - No generic phrases
 *   - At least 3 verbatim review snippets in evidence fields
 *   - Max 1 page of content
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { generateStructured } = require('./structuredGeneration');
const { brewhouseResponseSchema } = require('./templates/brewhouseResponseSchema');

/**
 * Collect all ai_generated and ai_generated_list fields from template sections.
 *
 * @param {Array} sections - Template sections array
 * @returns {Array} Array of { fieldId, type, promptTemplate, sectionId }
 */
function collectAiFields(sections) {
    const aiFields = [];
    for (const section of sections) {
        if (!Array.isArray(section.fields)) continue;
        for (const field of section.fields) {
            if (field.type === 'ai_generated' || field.type === 'ai_generated_list') {
                aiFields.push({
                    fieldId: field.fieldId,
                    type: field.type,
                    promptTemplate: field.promptTemplate || '',
                    sectionId: section.sectionId,
                    sectionCondition: section.condition || null
                });
            }
        }
    }
    return aiFields;
}

/**
 * Interpolate {{variable}} and [[variable]] placeholders in a prompt template.
 * Supports dot-notation paths like {{prospect.businessName}}.
 * Also resolves common shorthand aliases like {{prospectName}} → prospect.businessName.
 * Returns '' (empty string) for unresolved paths — never returns the raw placeholder.
 *
 * @param {string} template
 * @param {Object} prospectData - Merged { prospect, analysis, sellerProfile, ... } object
 * @returns {string}
 */
function interpolatePrompt(template, prospectData) {
    if (!template) return '';

    // Shorthand aliases — flattened names that map to nested paths
    const aliases = {
        prospectName:  () => prospectData?.prospect?.businessName || prospectData?.businessName || '',
        businessName:  () => prospectData?.prospect?.businessName || prospectData?.businessName || '',
        city:          () => prospectData?.prospect?.city  || prospectData?.city  || '',
        state:         () => prospectData?.prospect?.state || prospectData?.state || '',
        rating:        () => prospectData?.prospect?.rating ?? prospectData?.rating ?? '',
        reviewCount:   () => prospectData?.prospect?.reviewCount ?? prospectData?.reviewCount ?? '',
        currentMonth:  () => prospectData?.currentMonth || new Date().toLocaleString('default', { month: 'long' }),
        currentYear:   () => prospectData?.currentYear  || new Date().getFullYear(),
    };

    // Match both {{...}} and [[...]] placeholders
    return template.replace(/\{\{([^}]+)\}\}|\[\[([^\]]+)\]\]/g, (match, p1, p2) => {
        const path = (p1 || p2 || '').trim();

        // 1. Check shorthand aliases first
        if (aliases[path]) return String(aliases[path]());

        // 2. Resolve dot-notation path against the data object
        const parts = path.split('.');
        let value = prospectData;
        for (const part of parts) {
            if (value == null) return '';
            value = value[part];
        }
        if (value === null || value === undefined) return '';
        return String(value);
    });
}

// Explicit JSON schemas for fields that return non-string values.
// This prevents Gemini from guessing the shape and omitting required keys.
const FIELD_SCHEMAS = {
    patterns: `"patterns": [
    { "count": "6+", "category": "SLOW SERVICE / IGNORED", "snippets": ["quote under 12 words", "another short quote", "third short quote"] },
    { "count": "4+", "category": "WAIT TIMES / SLOW KITCHEN", "snippets": ["quote", "quote", "quote"] },
    { "count": "3+", "category": "RUDE STAFF / ATTITUDE", "snippets": ["quote", "quote", "quote"] }
  ]`,
    lovePoints: `"lovePoints": [
    { "label": "CATEGORY LABEL IN CAPS", "detail": "supporting detail with a short review quote" },
    { "label": "CATEGORY LABEL", "detail": "detail with quote" },
    { "label": "CATEGORY LABEL", "detail": "detail with quote" },
    { "label": "CATEGORY LABEL", "detail": "detail with quote" }
  ]`,
    solutionPackage: `"solutionPackage": {
    "packageName": "Business Name Package",
    "products": ["PathConnect Starter $149/mo", "Review Response AI $99/mo"],
    "setupFee": "Setup: $299 one-time",
    "monthlyTotal": "$248/mo"
  }`
};

/**
 * Build the expected JSON schema description for each AI field
 * so Gemini knows exactly what structure to return.
 */
function buildFieldSchema(field) {
    // Use explicit schema if available for this fieldId
    if (FIELD_SCHEMAS[field.fieldId]) {
        return FIELD_SCHEMAS[field.fieldId];
    }
    if (field.type === 'ai_generated_list') {
        return `"${field.fieldId}": [ /* array of objects — see field instructions */ ]`;
    }
    return `"${field.fieldId}": "<string>"`;
}

/**
 * Build the per-field prompt block to include in the batch prompt.
 */
function buildFieldBlock(field, prospectData) {
    const interpolated = interpolatePrompt(field.promptTemplate, prospectData);
    return [
        `### FIELD: ${field.fieldId} (${field.type})`,
        interpolated
    ].join('\n');
}

/**
 * Build the full batch system + user prompt.
 *
 * @param {Array}  aiFields        - Output of collectAiFields()
 * @param {Object} prospectData    - { prospect: {...}, analysis: {...} }
 * @param {Object} generationRules - template.generationRules
 * @returns {string} Full Gemini prompt string
 */
function buildBatchPrompt(aiFields, prospectData, generationRules) {
    const { prospect, analysis } = prospectData;

    // Build review evidence block
    const reviewSnippets = (analysis?.reviewSnippets || [])
        .slice(0, 15)
        .map((r, i) => {
            const text = typeof r === 'string' ? r : r.text;
            const rating = typeof r === 'object' ? ` [${r.rating}★]` : '';
            return `${i + 1}.${rating} "${text}"`;
        })
        .join('\n');

    const negativeSnippets = (analysis?.negativeSnippets || [])
        .slice(0, 8)
        .map((s, i) => `${i + 1}. "${s}"`)
        .join('\n');

    const positiveSnippets = (analysis?.positiveSnippets || [])
        .slice(0, 6)
        .map((s, i) => `${i + 1}. "${s}"`)
        .join('\n');

    // Build generation constraints from template rules
    const constraints = (generationRules?.constraints || [])
        .map(c => `- ${c}`)
        .join('\n');

    // Build the JSON schema for the response
    const schemaLines = aiFields.map(f => `  ${buildFieldSchema(f)}`).join(',\n');

    // Build per-field instruction blocks
    const fieldBlocks = aiFields
        .map(f => buildFieldBlock(f, { prospect, analysis }))
        .join('\n\n');

    const systemPrompt = [
        '## GENERATION RULES',
        `Tone: ${generationRules?.tone || 'Direct, data-driven, respectful.'}`,
        `Perspective: ${generationRules?.perspective || 'Written FOR a salesperson TO hand to a business owner.'}`,
        '',
        '## CONSTRAINTS (follow strictly)',
        constraints,
        '',
        '## EVIDENCE — USE THIS DATA',
        `Business: ${prospect?.businessName || 'Unknown'}`,
        `Location: ${prospect?.city || ''}${prospect?.state ? ', ' + prospect.state : ''}`,
        `Google Rating: ${prospect?.rating || 'N/A'} stars`,
        `Total Reviews: ${prospect?.reviewCount || 'N/A'}`,
        `Owner Response Count (to negatives): ${prospect?.ownerResponseCount || 0}`,
        `Top Complaint Pattern: ${analysis?.topComplaintPattern || 'N/A'}`,
        `Complaint Frequency: ~${Math.abs(analysis?.complaintFrequency || 0)}/month`,
        `Review Volume: ${analysis?.reviewVolumeAssessment || 'N/A'}`,
        `Urgency Hook: ${analysis?.urgencyHook || 'None identified'}`,
        '',
        '### NEGATIVE REVIEWS (complaint evidence)',
        negativeSnippets || 'None available',
        '',
        '### POSITIVE REVIEWS (love section evidence)',
        positiveSnippets || 'None available',
        '',
        '### FULL REVIEW SAMPLE (most recent)',
        reviewSnippets || 'None available'
    ].join('\n');

    const userPrompt = [
        '## TASK',
        'Generate content for ALL of the following fields in a single JSON response.',
        'Return ONLY a valid JSON object with fieldId as keys. No markdown fences. No preamble.',
        '',
        '## EXPECTED JSON SHAPE',
        '{',
        schemaLines,
        '}',
        '',
        '## FIELD INSTRUCTIONS',
        fieldBlocks,
        '',
        '## CRITICAL RULES (violations will make the report unusable)',
        '- No em dashes (use -- instead if needed)',
        '- No generic phrases like "high level of customer satisfaction" or "room for improvement"',
        '- Use specific data and verbatim review quotes wherever the field calls for evidence',
        '- COMPLAINT COUNTS: Count only DISTINCT reviews where that complaint is the PRIMARY theme.',
        '  Do NOT count keyword occurrences. For a 4.0-4.5 star business, realistic counts are 3-15 per pattern.',
        '  Example correct: "6+" not "24+". Inflated counts destroy credibility with business owners.',
        '- URGENCY: The urgencyHook, urgencyLabel, and urgencyDetail fields MUST be non-null.',
        '  Every business has a time-sensitive context (seasonal peak, local event, new competitor, upcoming holiday).',
        '  If nothing obvious, use the nearest seasonal spike for their business type (e.g. summer, holidays, sports season).',
        '- "patterns" array MUST include all three fields per item: count, category (ALL CAPS), and snippets (array of 3 strings).',
        '- Return ONLY valid JSON'
    ].join('\n');

    return { systemPrompt, userPrompt };
}

/**
 * Call Gemini with the batch prompt and extract the JSON result map.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<Object>} Map of { fieldId: value }
 */
async function geminiGenerateBatch(systemPrompt, userPrompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 }
        }
    });

    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
    });

    const text = result.response.text();

    // Extract JSON using indexOf('{') pattern per SYSTEM_BIBLE
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end <= start) {
        console.error('[TemplatePromptBuilder] No JSON found in Gemini response:', text.substring(0, 200));
        throw new Error('Gemini batch response contained no JSON object');
    }

    const jsonStr = text.substring(start, end);
    return JSON.parse(jsonStr);
}

/**
 * Main entry: collect AI fields, build prompt, call Gemini, return keyed results.
 *
 * @param {Array}  sections        - template.sections
 * @param {Object} prospectData    - { prospect: {...}, analysis: {...} }
 * @param {Object} generationRules - template.generationRules
 * @param {Object} sellerProfile   - Seller profile for context
 * @returns {Promise<Object>} Map of { fieldId: value }
 */
async function buildAndExecuteBatchPrompt(sections, prospectData, generationRules, sellerProfile) {
    const aiFields = collectAiFields(sections);
    if (aiFields.length === 0) {
        console.log('[TemplatePromptBuilder] No AI fields found in template sections');
        return {};
    }

    // Inject synthetic solutionPackage field so the batch Gemini call generates
    // prospect-specific pricing even when no pitch.pricingLineItems are configured.
    // The resolver uses this as fallback for pricing_block and product_line_items.
    const hasSolutionPackageField = aiFields.some(f => f.fieldId === 'solutionPackage');
    if (!hasSolutionPackageField) {
        const businessName = prospectData?.prospect?.businessName || 'this business';
        aiFields.push({
            fieldId: 'solutionPackage',
            type: 'ai_generated',
            promptTemplate: `Based on ${businessName}'s complaint patterns, recommend EXACTLY 2-3 PathSynch products. AVAILABLE PRODUCTS (use only these exact names and prices): PathConnect Starter $149/mo (automated SMS/email review requests after every visit), Review Response AI $99/mo (AI-drafted responses to every review within 2 hours), PathManager $199/mo (unified reputation dashboard across all platforms), Local Presence $99/mo (GBP posts, photos, Q&A managed monthly), QRsynch $29/mo (table tent + receipt QR codes for in-person review collection). Pick the 2-3 most relevant for their specific complaint patterns. Always include a $299 one-time setup fee. Calculate the correct monthlyTotal. Return ONLY a solutionPackage JSON object (no strings, no wrapper).`,
            sectionId: 'solution',
            sectionCondition: null
        });
    }

    console.log(`[TemplatePromptBuilder] Building batch prompt for ${aiFields.length} AI fields: ${aiFields.map(f => f.fieldId).join(', ')}`);

    // Merge sellerProfile into prospectData for interpolation
    const enrichedData = {
        ...prospectData,
        sellerProfile: sellerProfile || {},
        currentMonth: new Date().toLocaleString('default', { month: 'long' }),
        currentYear: new Date().getFullYear()
    };

    const { systemPrompt, userPrompt } = buildBatchPrompt(aiFields, enrichedData, generationRules);
    const aiResults = await geminiGenerateBatch(systemPrompt, userPrompt);

    console.log(`[TemplatePromptBuilder] Received ${Object.keys(aiResults).length} AI field results`);
    return aiResults;
}

/**
 * Template-based structured generation for executive_brief and similar L2 styles.
 *
 * Replaces the "build a big prompt and hope Gemini returns JSON" approach with
 * Gemini controlled generation using responseSchema. The model CANNOT drop fields
 * or return non-JSON — the API enforces the schema contract.
 *
 * Returns an aiResults map (fieldId → value) compatible with resolveAllSections().
 * The 'complaintPatterns' schema key is aliased to 'patterns' to match template field IDs.
 *
 * @param {Object} template       - Template document from Firestore
 * @param {Object} prospectData   - { businessName, city, state, rating, reviewCount, ... }
 * @param {Object} sellerProfile  - Seller context (name, email, branding, etc.)
 * @param {Object} analysis       - Enriched analysis { positiveSnippets, negativeSnippets,
 *                                    complaintThemes, loveThemes, topComplaintPattern,
 *                                    urgencyHook, ... }
 * @returns {Promise<Object>} Map of { fieldId: value } for resolveAllSections()
 */
async function buildAndExecuteTemplatePrompt(template, prospectData, sellerProfile, analysis) {
    const businessName = prospectData.businessName || 'this business';
    const city         = prospectData.city  || '';
    const state        = prospectData.state || '';
    const rating       = prospectData.rating ?? 'unknown';
    const reviewCount  = prospectData.reviewCount ?? 'unknown';
    const ownerResponseCount = prospectData.ownerResponseCount || 0;
    const industry     = prospectData.industry || 'local business';

    // Review samples — support both old (positiveSnippets) and new (positiveReviews) field names
    const positiveReviews = (analysis.positiveReviews || analysis.positiveSnippets || [])
        .slice(0, 10)
        .map(r => (typeof r === 'string' ? r : r.text || ''))
        .filter(Boolean);

    const negativeReviews = (analysis.negativeReviews || analysis.negativeSnippets || [])
        .slice(0, 10)
        .map(r => (typeof r === 'string' ? r : r.text || ''))
        .filter(Boolean);

    const complaintThemes = analysis.complaintThemes || [];
    const loveThemes      = analysis.loveThemes      || [];

    const systemInstruction = `You are a sales strategist generating fields for a one-pager pitch about a local business.
Tone: direct, data-driven, respectful.
Lead with what customers genuinely celebrate before revealing the gap.
Always use verbatim review snippets as evidence — quote exact phrases in quotation marks.
Never use generic phrases like "high level of customer satisfaction", "room for improvement", or "trusted local provider."
No em dashes. No preamble. No markdown in your response.`;

    const positiveBlock = positiveReviews.length
        ? positiveReviews.map(r => `- "${r}"`).join('\n')
        : '(no positive reviews available)';

    const negativeBlock = negativeReviews.length
        ? negativeReviews.map(r => `- "${r}"`).join('\n')
        : '(no negative reviews available)';

    // Format seller products so the AI can select the right ones and calculate the correct total
    const sellerProducts = sellerProfile?.products || [];
    const productsBlock = sellerProducts.length > 0
        ? sellerProducts.map(p => {
            const name = p.productName || p.name || 'Unnamed';
            const monthly = p.monthlyPrice ? `$${p.monthlyPrice}/mo` : null;
            const oneTime = p.oneTimeFee ? `$${p.oneTimeFee} one-time` : null;
            const setup = p.setupFee ? `$${p.setupFee} setup fee` : null;
            const bundled = p.bundledProducts ? ` (includes: ${p.bundledProducts})` : '';
            const price = monthly || oneTime || p.pricing || 'included in plan';
            const extras = [setup].filter(Boolean).join(', ');
            return `- ${name}: ${price}${extras ? ' + ' + extras : ''}${bundled}${p.description ? ' — ' + p.description.slice(0, 80) : ''}`;
          }).join('\n')
        : '- PathConnect Starter: $149/mo — automated review requests\n- Review Response AI: $99/mo — AI-drafted review responses';

    const userPrompt = `Generate pitch fields for ${businessName} in ${city}${state ? ', ' + state : ''}.

BUSINESS DATA:
- Google Rating: ${rating} stars
- Total Reviews: ${reviewCount}
- Owner responses to negative reviews: ${ownerResponseCount}
- Industry: ${industry}

POSITIVE REVIEW SAMPLES (5-star):
${positiveBlock}

NEGATIVE REVIEW SAMPLES (1-3 star):
${negativeBlock}

DETECTED COMPLAINT THEMES: ${complaintThemes.length ? complaintThemes.join(', ') : 'analyze from negative reviews above'}
DETECTED LOVE THEMES: ${loveThemes.length ? loveThemes.join(', ') : 'analyze from positive reviews above'}

TOP COMPLAINT PATTERN: ${analysis.topComplaintPattern || 'analyze from reviews'}
URGENCY HOOK: ${analysis.urgencyHook || 'use nearest seasonal peak for this industry and city'}

SELLER'S AVAILABLE PRODUCTS:
${productsBlock}

Generate all required fields per the schema.

For complaintPatterns:
- Identify the top 3 distinct complaint clusters from the negative reviews
- For each cluster, provide 3 verbatim quotes (under 12 words each) pulled from the reviews above
- Count = distinct reviews with that as primary complaint (not keyword frequency)
- For a ${rating}-star business with ${reviewCount} reviews, realistic counts are 3-20 per pattern

For lovePoints:
- Identify what customers specifically praise in the positive reviews
- Include minimum 4 items, each with a specific verbatim quote or observation
- Label names should be specific, not generic

For headlineLine1 and headlineLine2:
- Line 1: reference a SPECIFIC thing this business's customers celebrate (from positive reviews)
- Line 2: the contrast — the gap or blind spot revealed by the negative reviews

For ctaLine:
- Reference the actual review count (${reviewCount}) and make it feel personal and specific

For solutionPackage:
- Select 2-3 products from SELLER'S AVAILABLE PRODUCTS above that best address ${businessName}'s complaint patterns
- Products listed as "included in plan" cost $0 — do NOT add them to monthlyTotal
- monthlyTotal = sum of ONLY the products with explicit monthly prices (e.g. $149/mo) — format as "$X/mo"
- setupFee = sum of any setup fees from selected products — use "$0 setup" if none
- packageName = "${businessName} Package"`;

    console.log(`[TemplatePromptBuilder] buildAndExecuteTemplatePrompt — ${businessName}, ${positiveReviews.length} pos / ${negativeReviews.length} neg reviews`);

    const result = await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: brewhouseResponseSchema,
        model:          'gemini-3.1-pro-preview',
        temperature:    0.7,
        maxOutputTokens: 4096
    });

    console.log(`[TemplatePromptBuilder] Structured generation complete — fields: ${Object.keys(result).join(', ')}`);

    // Map 'complaintPatterns' (schema name) → 'patterns' (template field ID for section resolver)
    return {
        ...result,
        patterns: result.complaintPatterns
    };
}

module.exports = {
    collectAiFields,
    buildBatchPrompt,
    geminiGenerateBatch,
    buildAndExecuteBatchPrompt,
    buildAndExecuteTemplatePrompt,
    interpolatePrompt
};
