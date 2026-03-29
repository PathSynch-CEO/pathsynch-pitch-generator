/**
 * Vertical-Specific Precision Questions
 * Fallback templates for when AI question generation fails or times out.
 * Used by /api/market/questions endpoint.
 */

const VERTICAL_QUESTIONS = {
    'Food & Beverage': {
        questions: [
            {
                id: 'q1',
                label: 'What type of F&B business?',
                options: ['Restaurant / Catering', 'Coffee & Cafe', 'Craft Beverage (brewery/cidery)', 'Bakery & Artisan', 'Food Manufacturing'],
                default: 'Restaurant / Catering',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Neighborhood focus or citywide?',
                options: ['Specific neighborhoods', 'Citywide', 'Suburban focus'],
                default: 'Citywide',
                injection: 'geographic_precision'
            }
        ]
    },
    'Professional Services': {
        questions: [
            {
                id: 'q1',
                label: 'What service specialization?',
                options: ['Accounting & Tax', 'Legal', 'Business Consulting', 'Financial Advisory', 'HR & Staffing'],
                default: 'Accounting & Tax',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Solo practitioners or small firms?',
                options: ['Solo practitioner (1-3 people)', 'Small firm (4-15 people)', 'Either'],
                default: 'Either',
                injection: 'business_size_precision'
            }
        ]
    },
    'Automotive': {
        questions: [
            {
                id: 'q1',
                label: 'What automotive service type?',
                options: ['Auto Repair & Mechanic', 'Detailing & Wash', 'Tire & Alignment', 'Body Shop & Collision', 'Used Car Dealer'],
                default: 'Auto Repair & Mechanic',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Primary pitch angle?',
                options: ['Review velocity (more reviews)', 'Review quality (better ratings)', 'Local visibility (SEO)'],
                default: 'Review velocity (more reviews)',
                injection: 'pitch_angle'
            }
        ]
    },
    'Health & Beauty': {
        questions: [
            {
                id: 'q1',
                label: 'What service category?',
                options: ['Med Spa & Aesthetics', 'Hair Salon', 'Nail Salon', 'Massage & Wellness', 'Fitness Studio'],
                default: 'Hair Salon',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Appointment-based or walk-in?',
                options: ['Appointment-based', 'Walk-in', 'Both'],
                default: 'Both',
                injection: 'business_model_precision'
            }
        ]
    },
    'Retail': {
        questions: [
            {
                id: 'q1',
                label: 'What retail category?',
                options: ['Boutique Clothing', 'Specialty Food & Gifts', 'Home Goods & Decor', 'Books & Records', 'Sporting & Outdoor'],
                default: 'Boutique Clothing',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Brick-and-mortar or hybrid?',
                options: ['Brick-and-mortar only', 'Online + physical', 'Pop-up or market-based'],
                default: 'Brick-and-mortar only',
                injection: 'business_model_precision'
            }
        ]
    },
    'Home Services': {
        questions: [
            {
                id: 'q1',
                label: 'What home service type?',
                options: ['HVAC', 'Plumbing', 'Electrical', 'Landscaping', 'Cleaning', 'General Contractor'],
                default: 'HVAC',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'Residential or commercial focus?',
                options: ['Residential', 'Commercial', 'Both'],
                default: 'Residential',
                injection: 'market_segment'
            }
        ]
    }
};

/**
 * Fuzzy match industry name to a vertical template
 * @param {string} industry - Industry name from user input
 * @returns {object} Questions object with .questions array
 */
function getVerticalQuestions(industry) {
    if (!industry) return getGenericFallback();
    const lower = industry.toLowerCase();
    for (const [key, value] of Object.entries(VERTICAL_QUESTIONS)) {
        if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
            return value;
        }
    }
    return getGenericFallback();
}

function getGenericFallback() {
    return {
        questions: [
            {
                id: 'q1',
                label: 'What specific business type?',
                options: ['Small independent', 'Specialty / niche', 'Service-based', 'Product-based'],
                default: 'Small independent',
                injection: 'sub_type_filter'
            },
            {
                id: 'q2',
                label: 'What matters most to target?',
                options: ['More customer reviews', 'Better online visibility', 'Competitive positioning'],
                default: 'More customer reviews',
                injection: 'pitch_angle'
            }
        ]
    };
}

module.exports = { VERTICAL_QUESTIONS, getVerticalQuestions };
