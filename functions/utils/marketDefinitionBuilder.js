'use strict';

/**
 * marketDefinitionBuilder.js — S1: Market Definition & Query Transparency
 *
 * Builds the marketDefinition object stored on reportData.data.marketDefinition.
 * No Gemini calls. All data is deterministic: lookup table + computed confidence.
 *
 * @param {object} opts
 * @param {string} opts.industryLabel     - Display industry name (e.g. "Real Estate")
 * @param {string} opts.subIndustryLabel  - Sub-industry label (e.g. "Dental Practice")
 * @param {string} opts.subIndustryId     - Sub-industry taxonomy ID (e.g. "dental_practice")
 * @param {string} opts.city
 * @param {string} opts.state
 * @param {string[]} opts.taxonomyQueries - Queries from buildSearchQueries()
 * @param {Array}  opts.competitors       - Google Places competitor results
 * @param {Array}  opts.leads             - Qualified Serper leads
 * @returns {object} marketDefinition
 */

// ── Lookup table ──────────────────────────────────────────────────────────────
// Keys are normalized sub-industry IDs from industryTaxonomy.json.
// Fallback chain: subIndustryId → normalized subIndustryLabel → industryLabel → generic
const MARKET_DEFINITION_LOOKUP = {
    // Dental & Medical
    dental_practice: {
        sentence: 'general and cosmetic dentistry providers',
        includedBusinessTypes: ['general dentistry', 'cosmetic dentistry', 'family dentistry', 'dental clinic', 'orthodontics', 'pediatric dentistry'],
        excludedBusinessTypes: ['dental lab', 'dental supply', 'oral surgery center', 'dental school', 'dental equipment']
    },
    urgent_care: {
        sentence: 'urgent care and walk-in medical clinics',
        includedBusinessTypes: ['urgent care', 'walk-in clinic', 'immediate care', 'emergency care clinic'],
        excludedBusinessTypes: ['hospital', 'emergency room', 'dental office', 'pharmacy', 'imaging center']
    },
    chiropractic: {
        sentence: 'chiropractic and spinal care providers',
        includedBusinessTypes: ['chiropractic', 'spine care', 'chiro clinic', 'spinal adjustment'],
        excludedBusinessTypes: ['physical therapy', 'massage spa', 'acupuncture', 'orthopedic surgery']
    },
    // Real Estate
    commercial_real_estate_office: {
        sentence: 'office leasing, tenant representation, commercial brokerage, and CRE advisory services',
        includedBusinessTypes: ['commercial brokerage', 'office leasing', 'tenant representation', 'commercial property advisory', 'commercial property management'],
        excludedBusinessTypes: ['residential realtors', 'transaction coordinators', 'government buildings', 'property inspection', 'unrelated property services']
    },
    residential_real_estate: {
        sentence: 'residential real estate sales, buyer representation, and home listing services',
        includedBusinessTypes: ['residential realtor', 'home buyer representation', 'home seller services', 'real estate agent'],
        excludedBusinessTypes: ['commercial brokers', 'property management only', 'appraisers', 'mortgage lenders', 'title companies']
    },
    property_management: {
        sentence: 'residential and commercial property management services',
        includedBusinessTypes: ['property management', 'residential property manager', 'commercial property manager', 'HOA management'],
        excludedBusinessTypes: ['real estate sales', 'mortgage services', 'insurance brokers', 'construction']
    },
    // Automotive
    auto_repair_general_service: {
        sentence: 'general automotive repair, maintenance, and service providers',
        includedBusinessTypes: ['auto repair', 'car service', 'mechanic', 'auto maintenance', 'brake and tire service'],
        excludedBusinessTypes: ['auto dealership', 'car wash', 'auto parts store', 'towing service', 'body shop']
    },
    auto_body_collision: {
        sentence: 'auto body repair and collision restoration providers',
        includedBusinessTypes: ['auto body', 'collision repair', 'body shop', 'dent repair', 'paint and body'],
        excludedBusinessTypes: ['mechanical repair', 'car dealership', 'car wash', 'towing service', 'tire shop']
    },
    tire_wheel_service: {
        sentence: 'tire sales, installation, and wheel service providers',
        includedBusinessTypes: ['tire shop', 'wheel alignment', 'tire installation', 'tire rotation'],
        excludedBusinessTypes: ['full-service auto repair', 'body shop', 'car dealership', 'towing']
    },
    // Food & Beverage
    full_service_restaurant: {
        sentence: 'full-service dine-in restaurants and eateries',
        includedBusinessTypes: ['restaurant', 'dine-in eatery', 'casual dining', 'fine dining', 'bistro', 'diner'],
        excludedBusinessTypes: ['fast food chain', 'food truck', 'catering company', 'bar only', 'ghost kitchen']
    },
    fast_casual_restaurant: {
        sentence: 'fast casual and counter-service restaurants',
        includedBusinessTypes: ['fast casual', 'counter service', 'quick service restaurant', 'sandwich shop', 'burrito bowl'],
        excludedBusinessTypes: ['full-service dine-in', 'fast food drive-through chain', 'catering', 'food delivery only']
    },
    coffee_cafe: {
        sentence: 'specialty coffee shops, cafés, and espresso bars',
        includedBusinessTypes: ['coffee shop', 'café', 'espresso bar', 'tea house', 'bakery café'],
        excludedBusinessTypes: ['chain coffee (Starbucks/Dunkin)', 'restaurant with coffee', 'convenience store', 'donut shop']
    },
    bar_nightclub: {
        sentence: 'bars, lounges, and nightlife entertainment venues',
        includedBusinessTypes: ['bar', 'lounge', 'nightclub', 'sports bar', 'cocktail bar', 'dive bar'],
        excludedBusinessTypes: ['restaurant with bar', 'event venue', 'hotel bar', 'liquor store', 'brewery tap room']
    },
    brewery_winery_distillery: {
        sentence: 'craft brewery, winery, and distillery taproom operators',
        includedBusinessTypes: ['brewery', 'winery', 'distillery', 'taproom', 'craft beer producer'],
        excludedBusinessTypes: ['liquor store', 'wine retailer', 'bar', 'restaurant only', 'beverage distributor']
    },
    // Health & Wellness / Salon & Beauty
    hair_salon: {
        sentence: 'hair salons and professional styling services',
        includedBusinessTypes: ['hair salon', 'hair stylist', 'barbershop', 'color specialist', 'blowout bar'],
        excludedBusinessTypes: ['nail salon', 'spa only', 'beauty school', 'cosmetology supply', 'waxing studio']
    },
    nail_salon: {
        sentence: 'nail salons and nail care service providers',
        includedBusinessTypes: ['nail salon', 'nail spa', 'nail technician', 'gel nails', 'manicure and pedicure'],
        excludedBusinessTypes: ['hair salon', 'full-service spa', 'beauty school', 'waxing studio']
    },
    med_spa: {
        sentence: 'medical spa and aesthetics treatment providers',
        includedBusinessTypes: ['med spa', 'medical aesthetics', 'laser clinic', 'botox and filler provider', 'skincare clinic'],
        excludedBusinessTypes: ['day spa only', 'massage only', 'hair salon', 'plastic surgery center', 'dermatology office']
    },
    fitness_gym: {
        sentence: 'fitness gyms, studios, and training facilities',
        includedBusinessTypes: ['gym', 'fitness center', 'personal training studio', 'group fitness', 'CrossFit'],
        excludedBusinessTypes: ['physical therapy', 'sports complex', 'yoga studio only', 'martial arts school', 'swimming club']
    },
    yoga_pilates: {
        sentence: 'yoga studios and Pilates training providers',
        includedBusinessTypes: ['yoga studio', 'Pilates studio', 'hot yoga', 'barre studio', 'mind-body fitness'],
        excludedBusinessTypes: ['general gym', 'personal training only', 'martial arts', 'dance studio', 'crossfit']
    },
    // Agencies & Marketing Services
    digital_marketing_agency: {
        sentence: 'digital marketing agencies providing SEO, PPC, and online growth services',
        includedBusinessTypes: ['digital marketing agency', 'SEO agency', 'PPC management', 'content marketing', 'social media agency'],
        excludedBusinessTypes: ['web hosting company', 'print shop', 'staffing agency', 'IT services', 'PR firm']
    },
    advertising_creative_agency: {
        sentence: 'full-service advertising and creative agencies',
        includedBusinessTypes: ['advertising agency', 'creative agency', 'brand strategy', 'media buying', 'full-service marketing'],
        excludedBusinessTypes: ['freelance designer', 'print shop', 'staffing agency', 'IT consulting', 'web hosting']
    },
    seo_content_agency: {
        sentence: 'SEO and content marketing agencies',
        includedBusinessTypes: ['SEO agency', 'content marketing', 'inbound marketing', 'link building', 'content strategy'],
        excludedBusinessTypes: ['paid media only', 'social media only', 'PR firm', 'web development only', 'staffing']
    },
    web_development_agency: {
        sentence: 'web design and development agencies',
        includedBusinessTypes: ['web development', 'web design', 'website design', 'e-commerce development', 'app development'],
        excludedBusinessTypes: ['SEO only', 'digital marketing only', 'IT support', 'hosting provider', 'logo design only']
    },
    // Home Services
    plumbing: {
        sentence: 'plumbing installation, repair, and maintenance providers',
        includedBusinessTypes: ['plumber', 'plumbing contractor', 'drain service', 'water heater service', 'pipe repair'],
        excludedBusinessTypes: ['HVAC only', 'electrical contractor', 'general handyman', 'home inspector', 'remodeling']
    },
    hvac: {
        sentence: 'HVAC installation, repair, and climate control service providers',
        includedBusinessTypes: ['HVAC', 'heating and cooling', 'air conditioning repair', 'furnace service', 'duct cleaning'],
        excludedBusinessTypes: ['plumber', 'electrician', 'general contractor', 'appliance repair', 'roofing']
    },
    landscaping_lawn_care: {
        sentence: 'landscaping, lawn care, and outdoor maintenance service providers',
        includedBusinessTypes: ['landscaping', 'lawn care', 'lawn mowing', 'landscape design', 'irrigation'],
        excludedBusinessTypes: ['tree removal only', 'pest control', 'pool service', 'snow removal only', 'pressure washing']
    },
    cleaning_service: {
        sentence: 'residential and commercial cleaning service providers',
        includedBusinessTypes: ['cleaning service', 'house cleaning', 'maid service', 'commercial cleaning', 'janitorial'],
        excludedBusinessTypes: ['carpet cleaning only', 'pressure washing', 'window cleaning only', 'restoration service', 'pest control']
    },
    roofing: {
        sentence: 'roofing installation, repair, and inspection services',
        includedBusinessTypes: ['roofing contractor', 'roof repair', 'roof replacement', 'roof inspection', 'gutter service'],
        excludedBusinessTypes: ['general contractor', 'siding contractor', 'window installation', 'painting', 'HVAC']
    },
    // Professional Services
    accounting_cpa: {
        sentence: 'accounting, tax preparation, and CPA firms',
        includedBusinessTypes: ['CPA firm', 'accounting firm', 'tax preparer', 'bookkeeping', 'financial accounting'],
        excludedBusinessTypes: ['financial advisor', 'insurance broker', 'payroll software', 'law firm', 'business consultant']
    },
    law_firm: {
        sentence: 'law firms and legal service providers',
        includedBusinessTypes: ['law firm', 'attorney', 'lawyer', 'legal services', 'law office'],
        excludedBusinessTypes: ['paralegal service', 'legal document filing service', 'notary only', 'bail bonds', 'court reporting']
    },
    financial_advisor: {
        sentence: 'financial advisory, wealth management, and investment planning services',
        includedBusinessTypes: ['financial advisor', 'wealth management', 'investment advisor', 'financial planner', 'retirement planning'],
        excludedBusinessTypes: ['insurance broker', 'bank branch', 'mortgage lender', 'CPA firm', 'tax preparer']
    },
    insurance_agency: {
        sentence: 'independent insurance agencies and brokerage services',
        includedBusinessTypes: ['insurance agency', 'independent insurance broker', 'commercial insurance', 'personal lines insurance'],
        excludedBusinessTypes: ['captive insurance agent (State Farm/Allstate)', 'title insurance only', 'health insurance only', 'workers comp only']
    },
    // Construction & Trades
    general_contractor: {
        sentence: 'general contracting and construction management services',
        includedBusinessTypes: ['general contractor', 'construction company', 'commercial construction', 'residential builder', 'project management'],
        excludedBusinessTypes: ['subcontractor only', 'material supplier', 'architect', 'engineer', 'home inspector']
    },
    // Technology & SaaS
    it_services_managed_services: {
        sentence: 'IT services, managed service providers, and technology support firms',
        includedBusinessTypes: ['IT services', 'managed service provider', 'IT support', 'network services', 'cybersecurity'],
        excludedBusinessTypes: ['software vendor only', 'hardware reseller', 'telecom provider', 'cloud hosting only', 'staffing']
    },
    // Retail
    specialty_retail: {
        sentence: 'specialty retail stores and boutique product providers',
        includedBusinessTypes: ['specialty retail', 'boutique', 'specialty shop', 'independent retailer'],
        excludedBusinessTypes: ['big box retail', 'chain store', 'online retailer only', 'wholesale distributor', 'marketplace seller']
    }
};

// Industry-level fallbacks when no sub-industry match is found
const INDUSTRY_FALLBACK_LOOKUP = {
    'Automotive': {
        sentence: 'automotive services and repair providers',
        includedBusinessTypes: ['auto repair', 'car service', 'mechanic', 'auto dealership', 'tire shop'],
        excludedBusinessTypes: ['car wash', 'auto parts retail', 'gas station', 'parking garage']
    },
    'Food & Beverage': {
        sentence: 'food service establishments and dining venues',
        includedBusinessTypes: ['restaurant', 'café', 'bar', 'food service business', 'eatery'],
        excludedBusinessTypes: ['grocery store', 'food truck commissary', 'catering warehouse', 'food distributor']
    },
    'Health & Wellness': {
        sentence: 'health and wellness service providers',
        includedBusinessTypes: ['health clinic', 'wellness center', 'medical provider', 'health service'],
        excludedBusinessTypes: ['pharmacy', 'hospital', 'medical equipment supplier', 'health insurance']
    },
    'Salon & Beauty': {
        sentence: 'salon and personal beauty care providers',
        includedBusinessTypes: ['hair salon', 'nail salon', 'spa', 'barber', 'beauty service'],
        excludedBusinessTypes: ['beauty school', 'supply store', 'cosmetics retailer', 'department store salon']
    },
    'Real Estate': {
        sentence: 'real estate brokerage and property services',
        includedBusinessTypes: ['real estate agent', 'property broker', 'real estate office'],
        excludedBusinessTypes: ['mortgage lender', 'title company', 'appraiser', 'property inspector']
    },
    'Home Services': {
        sentence: 'home maintenance, repair, and improvement service providers',
        includedBusinessTypes: ['home services contractor', 'repair service', 'maintenance provider'],
        excludedBusinessTypes: ['home goods retail', 'hardware store', 'building materials supplier']
    },
    'Professional Services': {
        sentence: 'professional services and business advisory firms',
        includedBusinessTypes: ['professional services firm', 'consulting firm', 'advisory service'],
        excludedBusinessTypes: ['staffing agency', 'recruiting firm', 'training provider', 'software vendor']
    },
    'Agencies & Marketing Services': {
        sentence: 'marketing, advertising, and creative agencies',
        includedBusinessTypes: ['marketing agency', 'advertising agency', 'creative agency', 'digital agency'],
        excludedBusinessTypes: ['freelancer', 'PR news wire', 'print shop', 'media company', 'IT services']
    },
    'Fitness & Wellness': {
        sentence: 'fitness studios, gyms, and wellness training providers',
        includedBusinessTypes: ['gym', 'fitness studio', 'personal trainer', 'wellness center'],
        excludedBusinessTypes: ['physical therapy clinic', 'sports complex', 'recreational sports league']
    },
    'Legal Services': {
        sentence: 'legal services and law firm providers',
        includedBusinessTypes: ['law firm', 'attorney', 'legal services provider'],
        excludedBusinessTypes: ['court', 'government legal office', 'paralegal service', 'notary only']
    },
    'Financial Services': {
        sentence: 'financial services and advisory providers',
        includedBusinessTypes: ['financial advisor', 'wealth management', 'financial planning', 'investment firm'],
        excludedBusinessTypes: ['bank branch', 'ATM', 'payday loan', 'pawn shop', 'cryptocurrency exchange']
    },
    'Construction & Trades': {
        sentence: 'construction, contracting, and skilled trade service providers',
        includedBusinessTypes: ['contractor', 'construction company', 'trade service', 'builder'],
        excludedBusinessTypes: ['building materials supplier', 'equipment rental', 'architect firm', 'engineer']
    },
    'Technology & SaaS': {
        sentence: 'technology services, software, and IT solutions providers',
        includedBusinessTypes: ['IT services', 'technology firm', 'software company', 'tech consultant'],
        excludedBusinessTypes: ['hardware retailer', 'electronics store', 'telecom provider', 'cable company']
    },
    'Education': {
        sentence: 'educational institutions and learning service providers',
        includedBusinessTypes: ['school', 'tutoring center', 'training provider', 'educational service'],
        excludedBusinessTypes: ['book store', 'testing center', 'educational software only', 'university (not private)']
    },
    'Retail': {
        sentence: 'independent retail and specialty product providers',
        includedBusinessTypes: ['retail store', 'specialty shop', 'boutique', 'independent retailer'],
        excludedBusinessTypes: ['chain retailer', 'big box store', 'online only', 'wholesale supplier']
    },
    'Hospitality & Lodging': {
        sentence: 'lodging, hotel, and hospitality accommodation providers',
        includedBusinessTypes: ['hotel', 'motel', 'inn', 'bed and breakfast', 'short-term rental management'],
        excludedBusinessTypes: ['vacation rental platform', 'travel agency', 'tour operator', 'event venue only']
    },
    'Media & Entertainment': {
        sentence: 'media production, entertainment, and content creation providers',
        includedBusinessTypes: ['media company', 'entertainment venue', 'content creator', 'production studio'],
        excludedBusinessTypes: ['streaming platform', 'news outlet', 'sports team', 'government broadcaster']
    },
    'Nonprofit & Associations': {
        sentence: 'nonprofit organizations, associations, and community service providers',
        includedBusinessTypes: ['nonprofit', 'association', 'charitable organization', 'community foundation', 'advocacy group'],
        excludedBusinessTypes: ['government agency', 'for-profit company', 'political campaign', 'church only']
    },
    'Government & Public Sector': {
        sentence: 'government agencies and public sector service entities',
        includedBusinessTypes: ['government agency', 'public institution', 'municipality', 'public authority'],
        excludedBusinessTypes: ['private contractor', 'for-profit company', 'nonprofit', 'political campaign']
    }
};

/**
 * Normalize a string to a likely taxonomy ID key for lookup
 */
function _normalizeToId(str) {
    return (str || '').toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Compute categoryConfidence by checking what fraction of the combined
 * competitors + leads do NOT look like excluded business types.
 *
 * Confidence: ≥75% clean → 'high'; 50-74% → 'medium'; <50% → 'low'
 * Falls back to 'medium' when there's insufficient data (< 3 businesses).
 */
function _computeCategoryConfidence(competitors, leads, excludedBusinessTypes) {
    const allBiz = [...(competitors || []), ...(leads || [])];
    if (allBiz.length < 3) return 'medium';

    const excludedNormalized = (excludedBusinessTypes || []).map(e => e.toLowerCase());
    if (excludedNormalized.length === 0) return 'high';

    let mismatches = 0;
    allBiz.forEach(function(biz) {
        const name = (biz.name || '').toLowerCase();
        const type = (biz.type || biz.primaryType || '').toLowerCase();
        const category = (biz.category || '').toLowerCase();
        const combined = name + ' ' + type + ' ' + category;
        const isMismatch = excludedNormalized.some(function(ex) {
            // Match at word boundary to avoid false positives (e.g. "real" matching "real estate")
            return ex.split(' ').every(function(word) { return combined.includes(word); });
        });
        if (isMismatch) mismatches++;
    });

    const cleanPct = ((allBiz.length - mismatches) / allBiz.length) * 100;
    if (cleanPct >= 75) return 'high';
    if (cleanPct >= 50) return 'medium';
    return 'low';
}

/**
 * Build the marketDefinition object.
 */
function buildMarketDefinition(opts) {
    const {
        industryLabel = '',
        subIndustryLabel = '',
        subIndustryId = '',
        city = '',
        state = '',
        taxonomyQueries = [],
        competitors = [],
        leads = []
    } = opts;

    // ── Lookup entry ───────────────────────────────────────────────────────────
    const subIdNorm   = _normalizeToId(subIndustryId);
    const subLblNorm  = _normalizeToId(subIndustryLabel);
    const indLblNorm  = _normalizeToId(industryLabel);

    const entry = (
        MARKET_DEFINITION_LOOKUP[subIdNorm] ||
        MARKET_DEFINITION_LOOKUP[subLblNorm] ||
        INDUSTRY_FALLBACK_LOOKUP[industryLabel] ||
        INDUSTRY_FALLBACK_LOOKUP[_normalizeToId(industryLabel)] ||
        null
    );

    // ── Plain-English sentence ─────────────────────────────────────────────────
    const descPhrase = entry
        ? entry.sentence
        : (subIndustryLabel
            ? (_normalizeToId(subIndustryLabel) !== _normalizeToId(industryLabel)
                ? `${subIndustryLabel} providers and related services`
                : `${industryLabel} providers and related services`)
            : `${industryLabel} providers`);

    const cityState = [city, state].filter(Boolean).join(', ');
    const sentence = `This report defines the market as: ${descPhrase} serving ${cityState || 'the target area'}.`;

    // ── Queries ────────────────────────────────────────────────────────────────
    // Start with taxonomy queries. Supplement with additional standard variations
    // to reach 4-8 queries, stripping any accidental internal params.
    const baseQueries = (taxonomyQueries || []).map(function(q) {
        return String(q).trim();
    }).filter(Boolean);

    // Add supplemental queries if we have < 4
    const supplemental = [];
    const subLabel = subIndustryLabel || industryLabel;
    if (city) {
        supplemental.push(`top ${subLabel} in ${city}`);
        supplemental.push(`best ${subLabel} ${city} ${state}`.trim());
        supplemental.push(`${subLabel} reviews ${city}`);
        supplemental.push(`${subLabel} ${city} competitors`);
    }

    const allQueries = baseQueries.concat(supplemental);
    // Deduplicate, cap at 8
    const seen = new Set();
    const queries = [];
    for (var i = 0; i < allQueries.length && queries.length < 8; i++) {
        const q = allQueries[i];
        const key = q.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) {
            seen.add(key);
            queries.push(q);
        }
    }
    // Ensure minimum 4
    while (queries.length < 4 && subLabel) {
        const fallback = `${subLabel} ${['services', 'providers', 'near me', 'local'][queries.length]}`;
        queries.push(fallback);
    }

    // ── categoryConfidence ────────────────────────────────────────────────────
    const excluded = entry ? entry.excludedBusinessTypes : [];
    const categoryConfidence = _computeCategoryConfidence(competitors, leads, excluded);

    return {
        sentence: sentence,
        queries: queries,
        categoryConfidence: categoryConfidence,
        includedBusinessTypes: entry ? entry.includedBusinessTypes : [],
        excludedBusinessTypes: excluded
    };
}

module.exports = { buildMarketDefinition };
