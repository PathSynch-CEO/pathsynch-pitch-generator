/**
 * Vertical Configuration Data
 * Auto-detects industry vertical and provides structured context for pitch generation.
 * Aligned with verticalQuestions.js verticals.
 */

const VERTICAL_CONFIGS = {
    'food_beverage': {
        key: 'food_beverage',
        industryName: 'Food & Beverage',
        reviewCountCeiling: 400,
        painPoints: [
            'Inconsistent foot traffic between peak and off-peak hours',
            'High competition from delivery apps reducing margins',
            'Difficulty converting one-time visitors into regulars',
            'Online reputation vulnerability — one bad review amplified'
        ],
        pitchAngle: 'Turn your best customers into your marketing engine. High-rated F&B businesses with low review volume are sitting on untapped word-of-mouth potential.',
        recommendedProducts: ['Review Generation', 'Reputation Management', 'Local SEO', 'Customer Retention'],
        avgTicket: { low: 15, mid: 35, high: 75 },
        customerLifetimeValue: { low: 500, mid: 1500, high: 4000 },
        seasonalTriggers: ['Holiday catering season (Nov-Dec)', 'Summer patio season (May-Aug)', "Valentine's/Mother's Day", 'Back-to-school (Aug-Sep)'],
        icpSignals: ['4.0+ rating with <100 reviews', 'No response to negative reviews', 'Inconsistent Google Business Profile hours', 'No website or outdated website']
    },
    'professional_services': {
        key: 'professional_services',
        industryName: 'Professional Services',
        reviewCountCeiling: 150,
        painPoints: [
            'Long sales cycles with high-value clients',
            'Referral-dependent growth — no systematic lead generation',
            'Difficulty demonstrating expertise online vs. competitors',
            'Client retention pressure from larger firms'
        ],
        pitchAngle: 'Professional services live and die by trust signals. Reviews and online presence are the new referral network — prospects research before they call.',
        recommendedProducts: ['Review Generation', 'Reputation Management', 'SEO', 'Client Retention'],
        avgTicket: { low: 150, mid: 500, high: 2000 },
        customerLifetimeValue: { low: 3000, mid: 10000, high: 50000 },
        seasonalTriggers: ['Tax season (Jan-Apr)', 'Year-end planning (Oct-Dec)', 'Q1 budget cycle (Jan-Mar)', 'Annual review season (Nov-Dec)'],
        icpSignals: ['Established practice with <50 reviews', 'High rating but no GBP optimization', 'No case studies or testimonials on website', 'Competitor has 3x+ more reviews']
    },
    'automotive': {
        key: 'automotive',
        industryName: 'Automotive',
        reviewCountCeiling: 300,
        painPoints: [
            'Trust deficit — consumers skeptical of repair shops',
            'Price comparison shopping before committing',
            'Seasonal demand swings (winter prep, summer road trips)',
            'Difficulty differentiating from chains and dealerships'
        ],
        pitchAngle: 'Auto service is a trust-first purchase. Customers search "mechanic near me" and pick the shop with the best reviews. Review volume = visibility = revenue.',
        recommendedProducts: ['Review Generation', 'Reputation Management', 'Local SEO', 'Google Ads'],
        avgTicket: { low: 75, mid: 250, high: 800 },
        customerLifetimeValue: { low: 1200, mid: 4000, high: 12000 },
        seasonalTriggers: ['Winter prep (Oct-Nov)', 'Spring maintenance (Mar-Apr)', 'Summer road trip season (Jun-Jul)', 'Back-to-school car checks (Aug)'],
        icpSignals: ['Independent shop with <75 reviews', 'High rating but losing to chains in search', 'No online booking capability', 'Competitor within 2 miles has 2x+ reviews']
    },
    'health_beauty': {
        key: 'health_beauty',
        industryName: 'Health & Beauty',
        reviewCountCeiling: 250,
        painPoints: [
            'High client acquisition cost vs. lifetime value',
            'Appointment no-shows and last-minute cancellations',
            'Staff turnover taking clients with them',
            'Visual-first industry but weak online photo presence'
        ],
        pitchAngle: 'Health & beauty is the most review-driven vertical — 97% of consumers read reviews before booking. Your reputation IS your marketing.',
        recommendedProducts: ['Review Generation', 'Reputation Management', 'Social Proof', 'Client Retention'],
        avgTicket: { low: 40, mid: 85, high: 200 },
        customerLifetimeValue: { low: 800, mid: 3000, high: 8000 },
        seasonalTriggers: ['Wedding season (Apr-Jun)', 'Holiday glam (Nov-Dec)', 'New Year resolutions (Jan)', 'Prom season (Apr-May)'],
        icpSignals: ['4.2+ rating with <60 reviews', 'No photos on Google Business Profile', 'Appointment-based with no online booking', 'Active on Instagram but weak Google presence']
    },
    'retail': {
        key: 'retail',
        industryName: 'Retail',
        reviewCountCeiling: 200,
        painPoints: [
            'Foot traffic declining vs. e-commerce convenience',
            'Price pressure from online competitors',
            'Difficulty building community and repeat visits',
            'Inventory management and seasonal overstock'
        ],
        pitchAngle: "Local retail wins on experience, not price. Reviews that highlight unique products, knowledgeable staff, and community feel drive foot traffic that Amazon can't match.",
        recommendedProducts: ['Review Generation', 'Local SEO', 'Social Proof', 'Customer Retention'],
        avgTicket: { low: 25, mid: 60, high: 150 },
        customerLifetimeValue: { low: 400, mid: 1200, high: 3500 },
        seasonalTriggers: ['Holiday shopping (Nov-Dec)', 'Back-to-school (Jul-Aug)', 'Small Business Saturday (Nov)', 'Spring refresh (Mar-Apr)'],
        icpSignals: ['Brick-and-mortar with <40 reviews', 'No e-commerce presence', 'High rating but invisible in local search', 'Competitor in same district has 3x+ reviews']
    },
    'home_services': {
        key: 'home_services',
        industryName: 'Home Services',
        reviewCountCeiling: 350,
        painPoints: [
            'Lead quality issues — tire-kickers vs. ready buyers',
            'Seasonal revenue swings',
            'Trust barrier for letting strangers into homes',
            'Competition from lead-gen platforms (Angi, Thumbtack) eating margins'
        ],
        pitchAngle: 'Home services is "near me" search territory. The plumber with 200 reviews beats the one with 20 — every time. Review volume directly correlates to call volume.',
        recommendedProducts: ['Review Generation', 'Local SEO', 'Reputation Management', 'Google Ads'],
        avgTicket: { low: 150, mid: 400, high: 2500 },
        customerLifetimeValue: { low: 1000, mid: 5000, high: 15000 },
        seasonalTriggers: ['HVAC season changes (Mar-Apr, Sep-Oct)', 'Spring landscaping (Mar-May)', 'Pre-winter weatherproofing (Sep-Nov)', 'Post-storm emergency surge'],
        icpSignals: ['Licensed contractor with <100 reviews', 'Paying for Angi/Thumbtack leads', 'No website or basic template site', 'High rating but low search visibility']
    }
};

// Keyword → vertical key mapping for fuzzy matching
const KEYWORD_MAP = {
    // Food & Beverage
    'restaurant': 'food_beverage', 'cafe': 'food_beverage', 'coffee': 'food_beverage',
    'bakery': 'food_beverage', 'brewery': 'food_beverage', 'bar ': 'food_beverage',
    'catering': 'food_beverage', 'food': 'food_beverage', 'beverage': 'food_beverage',
    'pizza': 'food_beverage', 'sushi': 'food_beverage', 'diner': 'food_beverage',
    'bistro': 'food_beverage', 'grill': 'food_beverage', 'kitchen': 'food_beverage',
    'eatery': 'food_beverage', 'taco': 'food_beverage', 'burger': 'food_beverage',
    'winery': 'food_beverage', 'distillery': 'food_beverage', 'juice': 'food_beverage',
    'ice cream': 'food_beverage', 'donut': 'food_beverage', 'deli': 'food_beverage',

    // Professional Services
    'accounting': 'professional_services', 'legal': 'professional_services', 'law firm': 'professional_services',
    'consulting': 'professional_services', 'financial': 'professional_services', 'tax': 'professional_services',
    'attorney': 'professional_services', 'lawyer': 'professional_services', 'cpa': 'professional_services',
    'advisor': 'professional_services', 'staffing': 'professional_services', 'insurance': 'professional_services',
    'real estate': 'professional_services', 'realtor': 'professional_services', 'mortgage': 'professional_services',
    'professional service': 'professional_services',

    // Automotive
    'auto repair': 'automotive', 'automotive': 'automotive', 'mechanic': 'automotive',
    'detailing': 'automotive', 'tire': 'automotive',
    'body shop': 'automotive', 'collision': 'automotive', 'car wash': 'automotive',
    'car dealer': 'automotive', 'oil change': 'automotive', 'transmission': 'automotive',
    'brake': 'automotive', 'muffler': 'automotive',

    // Health & Beauty
    'salon': 'health_beauty', 'spa': 'health_beauty', 'beauty': 'health_beauty',
    'hair': 'health_beauty', 'nail': 'health_beauty', 'massage': 'health_beauty',
    'wellness': 'health_beauty', 'fitness': 'health_beauty', 'gym': 'health_beauty',
    'aesthetics': 'health_beauty', 'med spa': 'health_beauty', 'barber': 'health_beauty',
    'skincare': 'health_beauty', 'cosmetic': 'health_beauty', 'yoga': 'health_beauty',
    'pilates': 'health_beauty', 'dental': 'health_beauty', 'dentist': 'health_beauty',
    'chiropract': 'health_beauty', 'optom': 'health_beauty',

    // Retail
    'retail': 'retail', 'boutique': 'retail', 'clothing': 'retail',
    'apparel': 'retail', 'jewelry': 'retail', 'gift shop': 'retail',
    'furniture': 'retail', 'home decor': 'retail', 'bookstore': 'retail',
    'sporting goods': 'retail', 'pet store': 'retail', 'florist': 'retail',
    'flower shop': 'retail', 'antique': 'retail', 'thrift': 'retail',

    // Home Services
    'hvac': 'home_services', 'plumbing': 'home_services', 'plumber': 'home_services',
    'electrical': 'home_services', 'electrician': 'home_services',
    'landscaping': 'home_services', 'lawn': 'home_services', 'roofing': 'home_services',
    'roofer': 'home_services', 'cleaning service': 'home_services', 'contractor': 'home_services',
    'painting': 'home_services', 'painter': 'home_services', 'pest control': 'home_services',
    'remodel': 'home_services', 'renovation': 'home_services', 'handyman': 'home_services',
    'garage door': 'home_services', 'fencing': 'home_services', 'moving': 'home_services',
    'mover': 'home_services', 'carpet': 'home_services', 'gutter': 'home_services',
    'tree service': 'home_services', 'pool': 'home_services', 'locksmith': 'home_services',
    'home service': 'home_services'
};

/**
 * Detect vertical from industry, subIndustry, and/or businessName
 * @param {string} industry - Industry category
 * @param {string} subIndustry - Sub-industry or specialization
 * @param {string} businessName - Business name (optional, for keyword matching)
 * @returns {Object|null} Vertical config or null if no match
 */
function detectVertical(industry, subIndustry, businessName) {
    const searchTerms = [subIndustry, industry, businessName].filter(Boolean).join(' ').toLowerCase();

    if (!searchTerms.trim()) return null;

    // Try exact vertical name match first
    for (const config of Object.values(VERTICAL_CONFIGS)) {
        if (searchTerms.includes(config.industryName.toLowerCase())) {
            return config;
        }
    }

    // Try keyword matching — longer keywords first to avoid false positives
    const sortedKeywords = Object.keys(KEYWORD_MAP).sort((a, b) => b.length - a.length);
    for (const keyword of sortedKeywords) {
        if (searchTerms.includes(keyword)) {
            return VERTICAL_CONFIGS[KEYWORD_MAP[keyword]];
        }
    }

    return null;
}

/**
 * Build a vertical context string for injection into AI prompts
 * @param {Object} config - Vertical config from detectVertical()
 * @returns {string} Formatted context block
 */
function buildVerticalContext(config) {
    if (!config) return '';

    return `
VERTICAL CONTEXT — ${config.industryName}:
- Key Pain Points: ${config.painPoints.join('; ')}
- Pitch Angle: ${config.pitchAngle}
- Recommended Products: ${config.recommendedProducts.join(', ')}
- Avg Ticket Range: $${config.avgTicket.low}-$${config.avgTicket.high} (mid: $${config.avgTicket.mid})
- Customer Lifetime Value: $${config.customerLifetimeValue.low}-$${config.customerLifetimeValue.high} (mid: $${config.customerLifetimeValue.mid})
- Seasonal Triggers: ${config.seasonalTriggers.join('; ')}
- ICP Signals: ${config.icpSignals.join('; ')}

Use this vertical intelligence to make the pitch specific to ${config.industryName}. Reference actual pain points, use realistic ticket/CLV numbers, and align recommendations with seasonal timing where relevant.
`;
}

module.exports = { VERTICAL_CONFIGS, detectVertical, buildVerticalContext };
