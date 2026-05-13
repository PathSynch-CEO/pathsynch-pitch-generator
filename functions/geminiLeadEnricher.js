'use strict';

/**
 * Gemini Lead Enricher — v2 Hardened
 *
 * Batch lead enrichment using Gemini 2.5 Flash with Google Search grounding.
 * Enriches: company_description, subindustry, job_listings, hiring_signal, headcount_range
 *
 * Authorization: Firestore-based (config/enrichmentAuth.authorizedUids)
 * Max batch size: 100 leads (sync endpoints)
 *
 * Modification 1: Insurance is a standalone top-level taxonomy category.
 * Modification 2: Authorization reads from Firestore config/enrichmentAuth (no hardcoded UIDs).
 */

const { z } = require('zod');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');

// ─── Gemini client ────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── PathSynch Industry Taxonomy ──────────────────────────────────────────────
//
// Modification 1: Insurance moved from Professional Services to its own
// top-level category. "Insurance Agencies" removed from Professional Services.
// This ensures "State Farm Insurance Agent" → Insurance > Captive Insurance Agents
// instead of Professional Services > Insurance Agencies.

const PATHSYNCH_INDUSTRY_TAXONOMY = {
    'Automotive': [
        'Auto Repair Shops', 'Auto Body & Collision Repair', 'Car Dealerships',
        'Auto Parts & Accessories', 'Tire Shops', 'Oil Change & Lube Services',
        'Car Washes', 'Auto Detailing', 'Transmission Repair', 'Towing Services'
    ],
    'Healthcare': [
        'Dental Practices', 'Medical Practices', 'Optometry', 'Chiropractic',
        'Physical Therapy', 'Mental Health & Counseling', 'Veterinary',
        'Urgent Care', 'Pharmacies', 'Medical Spas'
    ],
    'Food & Beverage': [
        'Full-Service Restaurants', 'Fast Food & Quick Service', 'Cafes & Coffee Shops',
        'Bars & Nightclubs', 'Catering Services', 'Food Trucks', 'Bakeries',
        'Specialty Food Stores', 'Breweries & Wineries', 'Meal Prep & Delivery'
    ],
    'Home Services': [
        'HVAC Services', 'Plumbing', 'Electrical Services', 'Roofing',
        'Landscaping & Lawn Care', 'Cleaning Services', 'General Contractors',
        'Pest Control', 'Moving Services', 'Interior Design'
    ],
    'Professional Services': [
        // NOTE: Insurance Agencies intentionally removed (Modification 1).
        // Insurance is now its own top-level category below.
        'Accounting & CPA Firms', 'Law Firms', 'Marketing Agencies',
        'Consulting Firms', 'Real Estate Agencies', 'Financial Planning',
        'HR & Staffing Agencies', 'IT Services & MSPs', 'Business Coaching'
    ],
    'Insurance': [
        'Independent Insurance Agents', 'Captive Insurance Agents',
        'Insurance Brokerages', 'Insurance Adjusters', 'Insurance Underwriters',
        'Life Insurance Agencies', 'Property & Casualty Insurance',
        'Health Insurance Agencies', 'Auto Insurance Agencies',
        'Commercial Insurance Agencies', 'Multi-Line Insurance Agencies'
    ],
    'Retail': [
        'Clothing & Apparel', 'Electronics & Technology', 'Sporting Goods',
        'Furniture & Home Goods', 'Jewelry & Accessories', 'Grocery & Specialty Foods',
        'Health & Beauty Retail', 'Toy & Gift Shops', 'Book & Music Stores',
        'Pet Supply Stores'
    ],
    'Beauty & Wellness': [
        'Hair Salons', 'Nail Salons', 'Day Spas & Massage', 'Barbershops',
        'Fitness Centers & Gyms', 'Personal Training', 'Yoga & Pilates Studios',
        'Estheticians & Skin Care', 'Tanning Salons', 'Tattoo & Piercing Studios'
    ],
    'Education': [
        'Tutoring Centers', 'Private Schools', 'Music Lessons',
        'Dance Studios', 'Martial Arts Schools', 'Test Prep Centers',
        'Language Schools', 'Trade Schools', 'Early Childhood Education'
    ],
    'Real Estate': [
        'Residential Real Estate Agencies', 'Commercial Real Estate',
        'Property Management', 'Real Estate Investment', 'Mortgage Brokers',
        'Home Inspection Services', 'Title & Escrow Companies'
    ],
    'Financial Services': [
        'Banks & Credit Unions', 'Investment Advisors', 'Tax Preparation',
        'Payroll Services', 'Bookkeeping Services', 'Wealth Management',
        'Mortgage Lending', 'Business Lending'
    ],
    'Other': []
};

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const LeadInputSchema = z.object({
    company_name: z.string().min(1).optional(),
    domain:       z.string().optional(),
    city:         z.string().optional(),
    state:        z.string().optional(),
    industry:     z.string().optional(),
    contact_name:  z.string().optional(),
    contact_email: z.string().email().optional().or(z.literal('')),
    contact_title: z.string().optional()
}).refine(data => data.company_name || data.domain, {
    message: 'Each lead must have either company_name or domain'
});

const EnrichRequestSchema = z.object({
    leads: z.array(LeadInputSchema).min(1).max(100),
    options: z.object({
        includeGrounding: z.boolean().default(true),
        timeoutMs: z.number().min(5000).max(30000).default(15000)
    }).optional().default({})
});

// Gemini response schema — used for strict + lenient parse modes
const GeminiResponseSchema = z.object({
    company_description: z.string().min(10),
    subindustry:         z.string(),
    job_listings: z.array(z.object({
        title:  z.string(),
        source: z.string().optional()
    })),
    hiring_signal:   z.enum(['none', 'moderate', 'active']),
    headcount_range: z.string()
});

// ─── Authorization (Firestore-based) — Modification 2 ────────────────────────

/**
 * Check if the authenticated user is authorized for enrichment.
 * Reads from Firestore doc: config/enrichmentAuth
 * Document schema: { authorizedUids: ['uid1', 'uid2', ...], updatedAt: timestamp }
 *
 * This allows adding/removing authorized users without redeploying code.
 * To add Joseph: Firestore Console → config/enrichmentAuth → add his UID to authorizedUids[].
 */
async function checkAuthorization(req) {
    if (!req.user || !req.user.uid) {
        return { authorized: false, uid: null, error: 'Authentication required. No valid Firebase token found.' };
    }

    const uid = req.user.uid;

    try {
        const authDoc = await admin.firestore().collection('config').doc('enrichmentAuth').get();

        if (!authDoc.exists) {
            // Config doc missing — allow Charles only (bootstrap safety)
            const BOOTSTRAP_UID = 'dehiyRBCXcUUM72O211S27lfXbl1';
            if (uid === BOOTSTRAP_UID) {
                return { authorized: true, uid, error: null };
            }
            console.warn(`[LeadEnricher] No enrichmentAuth config doc found. Rejecting UID: ${uid}`);
            return { authorized: false, uid, error: 'Enrichment authorization not configured.' };
        }

        const { authorizedUids } = authDoc.data();
        if (!Array.isArray(authorizedUids) || !authorizedUids.includes(uid)) {
            console.warn(`[LeadEnricher] Unauthorized access attempt by UID: ${uid}`);
            return { authorized: false, uid, error: 'You are not authorized to use the lead enrichment endpoint.' };
        }

        return { authorized: true, uid, error: null };
    } catch (err) {
        console.error(`[LeadEnricher] Auth check failed:`, err.message);
        // Fail closed — deny access if Firestore read fails
        return { authorized: false, uid, error: 'Authorization check failed. Please try again.' };
    }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Word overlap score (Jaccard index) between two strings.
 * Returns 0-1; used for fuzzy subindustry matching within a taxonomy category.
 */
function wordOverlapScore(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Exact (case-insensitive) cross-category subindustry search.
 * Returns "Category > SubIndustry" or null.
 */
function crossCategoryExactSearch(subIndustry) {
    for (const [category, subs] of Object.entries(PATHSYNCH_INDUSTRY_TAXONOMY)) {
        if (category === 'Other') continue;
        const match = subs.find(sub => sub.toLowerCase() === subIndustry.toLowerCase());
        if (match) return `${category} > ${match}`;
    }
    return null;
}

/**
 * Validate and normalize a Gemini-produced subindustry string against
 * the PathSynch taxonomy.
 *
 * Algorithm:
 *  1. null/empty → 'Other > Uncategorized'
 *  2. Parse "Category > SubIndustry" parts
 *  3. "Other" category → passthrough as-is
 *  4. Category found: exact match (case-insensitive) → return normalized
 *  5. Category found: fuzzy match within category (Jaccard ≥ 0.4) → best match
 *  6. Category missing or no match: cross-category exact search
 *  7. Fallback: 'Other > {subIndustry}'
 */
function validateSubindustry(raw) {
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
        return 'Other > Uncategorized';
    }

    const parts = raw.split('>').map(s => s.trim());

    if (parts.length < 2) {
        return crossCategoryExactSearch(raw.trim()) || `Other > ${raw.trim()}`;
    }

    const inputCategory    = parts[0];
    const inputSubIndustry = parts.slice(1).join(' > ').trim();

    // 'Other' category — accept any subindustry without lookup
    if (inputCategory.toLowerCase() === 'other') {
        return `Other > ${inputSubIndustry}`;
    }

    // Find matching taxonomy category (case-insensitive)
    const matchedCategory = Object.keys(PATHSYNCH_INDUSTRY_TAXONOMY)
        .find(cat => cat.toLowerCase() === inputCategory.toLowerCase());

    if (matchedCategory) {
        const subcategories = PATHSYNCH_INDUSTRY_TAXONOMY[matchedCategory];

        // Exact match (case-insensitive)
        const exactMatch = subcategories.find(
            sub => sub.toLowerCase() === inputSubIndustry.toLowerCase()
        );
        if (exactMatch) return `${matchedCategory} > ${exactMatch}`;

        // Fuzzy match within category (Jaccard threshold 0.4)
        const bestFuzzy = subcategories
            .map(sub => ({ sub, score: wordOverlapScore(sub, inputSubIndustry) }))
            .filter(({ score }) => score >= 0.4)
            .sort((a, b) => b.score - a.score)[0];

        if (bestFuzzy) return `${matchedCategory} > ${bestFuzzy.sub}`;
    }

    // Category not found or no subindustry match — cross-category exact search
    const crossMatch = crossCategoryExactSearch(inputSubIndustry);
    if (crossMatch) return crossMatch;

    return `Other > ${inputSubIndustry}`;
}

const HEADCOUNT_BUCKETS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

/**
 * Normalize a headcount string (e.g. "75", "about 250 employees") into a
 * standard PathSynch bucket.
 */
function normalizeHeadcount(raw) {
    if (!raw || typeof raw !== 'string') return 'unknown';
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'unknown' || trimmed === '' || trimmed === 'n/a') return 'unknown';

    // Already a valid bucket
    if (HEADCOUNT_BUCKETS.includes(raw.trim())) return raw.trim();

    // Extract the first numeric value from the string
    const numbers = raw.match(/\d[\d,]*/g);
    if (!numbers) return 'unknown';

    const num = parseInt(numbers[0].replace(/,/g, ''), 10);
    if (isNaN(num)) return 'unknown';

    if (num <= 10)   return '1-10';
    if (num <= 50)   return '11-50';
    if (num <= 200)  return '51-200';
    if (num <= 500)  return '201-500';
    if (num <= 1000) return '501-1000';
    return '1000+';
}

/**
 * Infer hiring signal from job listings array length.
 * none: 0 listings, moderate: 1-2, active: 3+
 */
function inferHiringSignal(jobListings) {
    if (!jobListings || !Array.isArray(jobListings) || jobListings.length === 0) return 'none';
    if (jobListings.length >= 3) return 'active';
    return 'moderate';
}

/**
 * Parse and validate a Gemini JSON response.
 *
 * Returns:
 *   { parseMode: 'strict', data }  — exact schema match, no extra fields
 *   { parseMode: 'lenient', data } — extra fields present, key fields valid
 *   { parseMode: 'failed',  data: null, error } — parse or schema failure
 *
 * Handles markdown fences and thinking-token prefixes.
 */
function parseGeminiResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { parseMode: 'failed', data: null, error: 'Empty response' };
    }

    try {
        let text = rawText;

        // Strip markdown code fences
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) text = fenceMatch[1];

        // Extract JSON object boundaries (handles thinking-token prefix)
        const start = text.indexOf('{');
        const end   = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) {
            return { parseMode: 'failed', data: null, error: 'No JSON object found in response' };
        }

        const parsed = JSON.parse(text.slice(start, end + 1));

        // Try strict parse first (z.object().strict() fails on unknown keys)
        const strictResult = GeminiResponseSchema.strict().safeParse(parsed);
        if (strictResult.success) {
            return { parseMode: 'strict', data: strictResult.data };
        }

        // Lenient parse — strips extra fields, keeps valid ones
        const lenientResult = GeminiResponseSchema.safeParse(parsed);
        if (lenientResult.success) {
            return { parseMode: 'lenient', data: lenientResult.data };
        }

        return {
            parseMode: 'failed',
            data: null,
            error: lenientResult.error.issues.map(i => i.message).join('; ')
        };
    } catch (err) {
        return { parseMode: 'failed', data: null, error: err.message };
    }
}

/**
 * Escape a value for RFC 4180 CSV output.
 * All fields are double-quoted; internal double quotes are doubled.
 */
function escapeCSVField(value) {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// ─── Gemini Enrichment ────────────────────────────────────────────────────────

function buildEnrichmentPrompt(lead) {
    const taxonomyLines = Object.entries(PATHSYNCH_INDUSTRY_TAXONOMY)
        .filter(([cat]) => cat !== 'Other')
        .map(([cat, subs]) => `  ${cat}: ${subs.join(', ')}`)
        .join('\n');

    return `You are a B2B lead research assistant. Research the following company and return enrichment data as a JSON object.

Company: ${lead.company_name || '(unknown)'}
${lead.domain    ? `Website: ${lead.domain}` : ''}
${lead.city      ? `Location: ${[lead.city, lead.state].filter(Boolean).join(', ')}` : ''}
${lead.industry  ? `Industry hint: ${lead.industry}` : ''}

IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. No markdown. No explanation. No text before or after the JSON.

Return exactly this JSON structure:

{
  "company_description": "<2-3 sentence description: what they do, who they serve, what makes them different>",
  "subindustry": "<Category> > <SubIndustry>",
  "job_listings": [{"title": "<job title>", "source": "<indeed|linkedin|company_site|other>"}],
  "hiring_signal": "<none|moderate|active>",
  "headcount_range": "<1-10|11-50|51-200|201-500|501-1000|1000+|unknown>"
}

Valid taxonomy categories and their subcategories (you MUST use one of these):
${taxonomyLines}

Rules:
- company_description: at least 2 sentences (50+ characters)
- subindustry: MUST use format "Category > SubIndustry" from the taxonomy above. Pick the closest match. Examples: restaurants/diners/cafes → "Food & Beverage > Full-Service Restaurants", clinics/medical offices → "Healthcare > Medical Practices", insurance agencies/agents → "Insurance > Independent Insurance Agents" or "Insurance > Captive Insurance Agents"
- job_listings: up to 5 current open positions; empty array [] if none found
- hiring_signal: "none" (0 listings), "moderate" (1-2), "active" (3+)
- headcount_range: estimate from LinkedIn, website, or other public source`;
}

function failedEnrichment(lead, error) {
    return {
        ...lead,
        enrichment_status: 'failed',
        enrichment_error:  error,
        company_description: null,
        subindustry:         null,
        job_listings:        [],
        hiring_signal:       'none',
        headcount_range:     'unknown'
    };
}

/**
 * Enrich a single lead via Gemini 2.5 Flash.
 * Attempts with Google Search grounding; falls back to ungrounded on tool error.
 */
async function enrichSingleLead(lead, timeoutMs = 15000) {
    const prompt = buildEnrichmentPrompt(lead);

    // Try grounded first, fall back to ungrounded
    for (const useGrounding of [true, false]) {
        try {
            const modelConfig = { model: 'gemini-2.5-flash' };
            if (useGrounding) modelConfig.tools = [{ googleSearch: {} }];

            const model = genAI.getGenerativeModel(modelConfig);

            const result = await Promise.race([
                model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 1024,
                            thinkingConfig: { thinkingBudget: 0 }
                        }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
                )
            ]);

            const rawText = result.response.text();
            const parsed  = parseGeminiResponse(rawText);

            if (parsed.parseMode === 'failed') {
                // If grounded attempt produces unparseable output, try ungrounded
                if (useGrounding) {
                    console.warn(`[LeadEnricher] Grounded parse failed for "${lead.company_name}", retrying ungrounded`);
                    continue;
                }
                return failedEnrichment(lead, parsed.error);
            }

            const { data }    = parsed;
            const jobListings = Array.isArray(data.job_listings) ? data.job_listings : [];

            return {
                ...lead,
                enrichment_status:     'enriched',
                enrichment_parse_mode: parsed.parseMode,
                enrichment_grounded:   useGrounding,
                company_description:   data.company_description,
                subindustry:           validateSubindustry(data.subindustry),
                job_listings:          jobListings,
                hiring_signal:         inferHiringSignal(jobListings),
                headcount_range:       normalizeHeadcount(data.headcount_range)
            };
        } catch (err) {
            if (useGrounding) {
                console.warn(`[LeadEnricher] Grounded call failed for "${lead.company_name}" (${err.message}), retrying ungrounded`);
                continue;
            }
            return failedEnrichment(lead, err.message);
        }
    }

    return failedEnrichment(lead, 'All enrichment attempts failed');
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * POST /enrich-leads
 * Sync batch enrichment. Returns JSON results. Max 100 leads.
 */
async function enrichLeadsHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const auth = await checkAuthorization(req);
    if (!auth.authorized) {
        return res.status(403).json({ success: false, error: auth.error });
    }

    const validation = EnrichRequestSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error:   'Invalid request',
            details: validation.error.issues.map(i => ({
                path:    i.path.join('.'),
                message: i.message
            }))
        });
    }

    const { leads, options } = validation.data;
    const timeoutMs = options?.timeoutMs || 15000;

    console.log(`[LeadEnricher] Enriching ${leads.length} leads for UID: ${auth.uid}`);
    const startTime = Date.now();

    const results = [];
    for (const lead of leads) {
        results.push(await enrichSingleLead(lead, timeoutMs));
    }

    const elapsed      = Date.now() - startTime;
    const enrichedCount = results.filter(r => r.enrichment_status === 'enriched').length;
    const failedCount   = results.filter(r => r.enrichment_status === 'failed').length;

    console.log(`[LeadEnricher] Done: ${enrichedCount} enriched, ${failedCount} failed in ${elapsed}ms`);

    return res.status(200).json({
        success: true,
        data: {
            results,
            summary: { total: leads.length, enriched: enrichedCount, failed: failedCount, elapsedMs: elapsed }
        }
    });
}

/**
 * POST /enrich-leads/export-csv
 * Sync batch enrichment with RFC 4180 CSV response for Instantly import.
 * Max 100 leads.
 */
async function enrichLeadsCSVHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const auth = await checkAuthorization(req);
    if (!auth.authorized) {
        return res.status(403).json({ success: false, error: auth.error });
    }

    const validation = EnrichRequestSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error:   'Invalid request',
            details: validation.error.issues.map(i => ({
                path:    i.path.join('.'),
                message: i.message
            }))
        });
    }

    const { leads, options } = validation.data;
    const timeoutMs = options?.timeoutMs || 15000;

    console.log(`[LeadEnricher] CSV export: enriching ${leads.length} leads for UID: ${auth.uid}`);

    const results = [];
    for (const lead of leads) {
        results.push(await enrichSingleLead(lead, timeoutMs));
    }

    const CSV_COLUMNS = [
        'company_name', 'domain', 'city', 'state', 'industry',
        'contact_name', 'contact_email', 'contact_title',
        'company_description', 'subindustry', 'hiring_signal',
        'headcount_range', 'enrichment_status'
    ];

    const header = CSV_COLUMNS.map(escapeCSVField).join(',');
    const rows   = results.map(r =>
        CSV_COLUMNS.map(col => escapeCSVField(r[col] ?? null)).join(',')
    );
    const csv = [header, ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enriched_leads_${Date.now()}.csv"`);
    return res.status(200).send(csv);
}

// ─── Async Job Processing ─────────────────────────────────────────────────────

const MAX_CONCURRENCY             = 10;
const DEFAULT_CONCURRENCY         = 5;
const DEFAULT_DELAY_BETWEEN_BATCHES = 1000;
const MAX_DELAY_BETWEEN_BATCHES   = 5000;
const MAX_ASYNC_LEADS             = 1000;

const AsyncEnrichRequestSchema = z.object({
    leads: z.array(LeadInputSchema).min(1).max(MAX_ASYNC_LEADS),
    concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional().default(DEFAULT_CONCURRENCY),
    delay_between_batches: z.number().int().min(100).max(MAX_DELAY_BETWEEN_BATCHES).optional().default(DEFAULT_DELAY_BETWEEN_BATCHES)
});

/**
 * Enrich an array of leads with concurrency control and inter-batch delay.
 * Used by enrichmentJobProcessor.js to process large async jobs in chunks.
 *
 * @param {object[]} leads — input lead objects
 * @param {number} concurrency — max parallel Gemini calls
 * @param {number} delayMs — ms to wait between batches
 * @returns {{ results: object[] }}
 */
async function batchEnrichLeads(leads, concurrency = DEFAULT_CONCURRENCY, delayMs = DEFAULT_DELAY_BETWEEN_BATCHES) {
    const results = [];
    for (let i = 0; i < leads.length; i += concurrency) {
        const batch = leads.slice(i, i + concurrency);
        const settled = await Promise.allSettled(batch.map(lead => enrichSingleLead(lead)));
        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
                results.push(outcome.value);
            } else {
                // Promise.allSettled shouldn't reject since enrichSingleLead catches internally,
                // but handle defensively
                results.push(failedEnrichment(batch[settled.indexOf(outcome)], outcome.reason?.message || 'Unknown error'));
            }
        }
        if (i + concurrency < leads.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return { results };
}

/**
 * Convert an array of enriched lead results to Instantly-compatible RFC 4180 CSV.
 */
function resultsToInstantlyCSV(results) {
    const CSV_COLUMNS = [
        'company_name', 'domain', 'city', 'state', 'industry',
        'contact_name', 'contact_email', 'contact_title',
        'company_description', 'subindustry', 'hiring_signal',
        'headcount_range', 'enrichment_status'
    ];
    const header = CSV_COLUMNS.map(escapeCSVField).join(',');
    const rows   = results.map(r =>
        CSV_COLUMNS.map(col => escapeCSVField(r[col] ?? null)).join(',')
    );
    return [header, ...rows].join('\r\n');
}

/**
 * POST /enrich-leads/async
 * Creates an async enrichment job for large batches (up to 1,000 leads).
 * Returns jobId immediately; processing runs via Firestore trigger.
 */
async function asyncEnrichLeadsHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
    }

    const auth = await checkAuthorization(req);
    if (!auth.authorized) {
        return res.status(403).json({ success: false, error: auth.error });
    }

    const parseResult = AsyncEnrichRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
        return res.status(400).json({
            success: false,
            error:   'Invalid request body',
            details: issues,
            limits:  { max_leads: MAX_ASYNC_LEADS, max_concurrency: MAX_CONCURRENCY }
        });
    }

    const { leads, concurrency, delay_between_batches } = parseResult.data;

    try {
        const jobRef = await admin.firestore().collection('enrichmentJobs').add({
            userId:               auth.uid,
            status:               'queued',
            totalLeads:           leads.length,
            processedCount:       0,
            enrichedCount:        0,
            failedCount:          0,
            leads:                leads,
            results:              [],
            concurrency,
            delayBetweenBatches:  delay_between_batches,
            createdAt:            admin.firestore.FieldValue.serverTimestamp(),
            startedAt:            null,
            completedAt:          null,
            error:                null
        });

        console.log(`[LeadEnricher] Async job created: ${jobRef.id} — ${leads.length} leads by UID ${auth.uid}`);

        return res.status(202).json({
            success:    true,
            jobId:      jobRef.id,
            status:     'queued',
            totalLeads: leads.length,
            message:    `Job queued. Poll GET /api/v1/enrich-leads/jobs/${jobRef.id} for status.`
        });
    } catch (err) {
        console.error('[LeadEnricher] Async job creation failed:', err);
        return res.status(500).json({ success: false, error: 'Failed to create enrichment job', message: err.message });
    }
}

/**
 * GET /enrich-leads/jobs/:jobId
 * Returns job status, progress counters, and results (when completed).
 */
async function getJobStatusHandler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
    }

    const auth = await checkAuthorization(req);
    if (!auth.authorized) {
        return res.status(403).json({ success: false, error: auth.error });
    }

    const jobId = req.params && req.params.jobId;
    if (!jobId) {
        return res.status(400).json({ success: false, error: 'Missing jobId parameter' });
    }

    try {
        const jobDoc = await admin.firestore().collection('enrichmentJobs').doc(jobId).get();
        if (!jobDoc.exists) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        const job = jobDoc.data();
        if (job.userId !== auth.uid) {
            return res.status(403).json({ success: false, error: 'You do not have access to this job.' });
        }

        const response = {
            success:        true,
            jobId,
            status:         job.status,
            totalLeads:     job.totalLeads,
            processedCount: job.processedCount,
            enrichedCount:  job.enrichedCount,
            failedCount:    job.failedCount,
            createdAt:      job.createdAt,
            startedAt:      job.startedAt,
            completedAt:    job.completedAt,
            error:          job.error
        };

        if (job.status === 'completed' || job.status === 'failed') {
            response.results = job.results;
            response.summary = {
                total:                    job.totalLeads,
                enriched:                 job.enrichedCount,
                failed:                   job.failedCount,
                instantly_credits_saved:  job.enrichedCount * 2,
                estimated_dollars_saved:  `$${(job.enrichedCount * 0.1257).toFixed(2)}`,
                estimated_gemini_cost:    `$${(job.enrichedCount * 0.0003).toFixed(4)}`
            };
        }

        return res.status(200).json(response);
    } catch (err) {
        console.error('[LeadEnricher] Job status check failed:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve job status', message: err.message });
    }
}

/**
 * GET /enrich-leads/jobs/:jobId/csv
 * Downloads completed job results as Instantly-compatible CSV.
 */
async function downloadJobCSVHandler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
    }

    const auth = await checkAuthorization(req);
    if (!auth.authorized) {
        return res.status(403).json({ success: false, error: auth.error });
    }

    const jobId = req.params && req.params.jobId;
    if (!jobId) {
        return res.status(400).json({ success: false, error: 'Missing jobId parameter' });
    }

    try {
        const jobDoc = await admin.firestore().collection('enrichmentJobs').doc(jobId).get();
        if (!jobDoc.exists) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        const job = jobDoc.data();
        if (job.userId !== auth.uid) {
            return res.status(403).json({ success: false, error: 'You do not have access to this job.' });
        }

        if (job.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: `Job is ${job.status}. CSV download is only available for completed jobs.`
            });
        }

        const csv = resultsToInstantlyCSV(job.results || []);
        const timestamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="enriched_leads_${jobId}_${timestamp}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        console.error('[LeadEnricher] CSV download failed:', err);
        return res.status(500).json({ success: false, error: 'CSV download failed', message: err.message });
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    enrichLeadsHandler,
    enrichLeadsCSVHandler,
    asyncEnrichLeadsHandler,
    getJobStatusHandler,
    downloadJobCSVHandler,
    batchEnrichLeads,
    checkAuthorization,
    // Exported for unit tests
    validateSubindustry,
    normalizeHeadcount,
    inferHiringSignal,
    parseGeminiResponse,
    escapeCSVField,
    resultsToInstantlyCSV,
    EnrichRequestSchema,
    AsyncEnrichRequestSchema,
    GeminiResponseSchema,
    PATHSYNCH_INDUSTRY_TAXONOMY,
    MAX_ASYNC_LEADS
};
