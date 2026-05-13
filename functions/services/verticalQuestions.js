/**
 * Vertical-Specific Precision Questions
 * Fallback templates for when AI question generation fails or times out.
 * Used by /api/market/questions endpoint.
 *
 * Two-level lookup: sub-industry first, then industry fallback.
 * Sub-industry questions assume the user already narrowed their vertical —
 * they ask what sub-industry alone cannot answer.
 */

// Sub-industry keyed templates — these fire when a sub-industry is selected
const SUB_INDUSTRY_QUESTIONS = {
    'Accounting & Tax': {
        questions: [
            { id: 'q1', label: 'Solo practitioners or small firms?', options: ['Solo practitioner (1-3 people)', 'Small firm (4-15 people)', 'Either'], default: 'Either', injection: 'business_size_precision' },
            { id: 'q2', label: 'Pitching in what season?', options: ['Tax season (Jan-Apr)', 'Off-season', 'Year-round'], default: 'Year-round', injection: 'seasonal_precision' }
        ]
    },
    'Legal': {
        questions: [
            { id: 'q1', label: 'Practice area focus?', options: ['Personal injury / criminal', 'Business / corporate', 'Family / estate', 'Any'], default: 'Any', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Solo practitioners or small firms?', options: ['Solo practitioner', 'Small firm (2-10 attorneys)', 'Either'], default: 'Either', injection: 'business_size_precision' }
        ]
    },
    'Business Consulting': {
        questions: [
            { id: 'q1', label: 'What type of consulting?', options: ['Management / strategy', 'IT / tech', 'Marketing / branding', 'Any'], default: 'Any', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Pitching B2B or B2C consultants?', options: ['B2B focused', 'B2C focused', 'Both'], default: 'Both', injection: 'market_segment' }
        ]
    },
    'Financial Advisory': {
        questions: [
            { id: 'q1', label: 'Independent or RIA-affiliated?', options: ['Independent advisor', 'RIA / firm-affiliated', 'Either'], default: 'Either', injection: 'business_size_precision' },
            { id: 'q2', label: 'Client focus?', options: ['High net-worth individuals', 'Small business owners', 'General consumers'], default: 'Small business owners', injection: 'market_segment' }
        ]
    },
    'Restaurant / Catering': {
        questions: [
            { id: 'q1', label: 'Dine-in or catering/delivery focused?', options: ['Dine-in focused', 'Catering/delivery focused', 'Both'], default: 'Both', injection: 'business_model_precision' },
            { id: 'q2', label: 'Neighborhood focus or citywide?', options: ['Specific neighborhoods', 'Citywide', 'Suburban focus'], default: 'Citywide', injection: 'geographic_precision' }
        ]
    },
    'Coffee & Cafe': {
        questions: [
            { id: 'q1', label: 'Specialty or standard?', options: ['Specialty / third-wave', 'Standard cafe', 'Drive-thru focused'], default: 'Specialty / third-wave', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Neighborhood focus or citywide?', options: ['Specific neighborhoods', 'Citywide', 'Suburban focus'], default: 'Citywide', injection: 'geographic_precision' }
        ]
    },
    'Hair Salon / Barber': {
        questions: [
            { id: 'q1', label: 'Appointment-based or walk-in?', options: ['Appointment-based', 'Walk-in', 'Both'], default: 'Both', injection: 'business_model_precision' },
            { id: 'q2', label: 'Pitch angle: new clients or retention?', options: ['New client acquisition', 'Client retention', 'Both'], default: 'Both', injection: 'pitch_angle' }
        ]
    },
    'Hair Salon': {
        questions: [
            { id: 'q1', label: 'Appointment-based or walk-in?', options: ['Appointment-based', 'Walk-in', 'Both'], default: 'Both', injection: 'business_model_precision' },
            { id: 'q2', label: 'Pitch angle: new clients or retention?', options: ['New client acquisition', 'Client retention', 'Both'], default: 'Both', injection: 'pitch_angle' }
        ]
    },
    'Nail Salon': {
        questions: [
            { id: 'q1', label: 'Walk-in or appointment-based?', options: ['Walk-in', 'Appointment-based', 'Both'], default: 'Both', injection: 'business_model_precision' },
            { id: 'q2', label: 'Pitch angle?', options: ['New client acquisition', 'Review velocity', 'Local visibility (SEO)'], default: 'Review velocity', injection: 'pitch_angle' }
        ]
    },
    'Med Spa & Aesthetics': {
        questions: [
            { id: 'q1', label: 'Primary service focus?', options: ['Injectables / Botox', 'Skin treatments', 'Body contouring', 'Multiple services'], default: 'Multiple services', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Price segment?', options: ['Premium / luxury', 'Mid-market', 'Value / accessible'], default: 'Mid-market', injection: 'price_segment' }
        ]
    },
    'Auto Repair & Mechanic': {
        questions: [
            { id: 'q1', label: 'General repair or specialty?', options: ['General repair', 'Specialty (detailing/body/tires)', 'Both'], default: 'General repair', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Pitch angle?', options: ['Review velocity', 'Local visibility (SEO)', 'Trust building'], default: 'Review velocity', injection: 'pitch_angle' }
        ]
    },
    'Auto Repair': {
        questions: [
            { id: 'q1', label: 'General repair or specialty?', options: ['General repair', 'Specialty (detailing/body/tires)', 'Both'], default: 'General repair', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Pitch angle?', options: ['Review velocity', 'Local visibility (SEO)', 'Trust building'], default: 'Review velocity', injection: 'pitch_angle' }
        ]
    },
    'HVAC': {
        questions: [
            { id: 'q1', label: 'Residential or commercial?', options: ['Residential', 'Commercial', 'Both'], default: 'Residential', injection: 'market_segment' },
            { id: 'q2', label: 'Pitching in what season?', options: ['Summer (cooling)', 'Winter (heating)', 'Year-round'], default: 'Year-round', injection: 'seasonal_precision' }
        ]
    },
    'Plumbing': {
        questions: [
            { id: 'q1', label: 'Emergency or scheduled service?', options: ['Emergency focused', 'Scheduled service', 'Both'], default: 'Both', injection: 'business_model_precision' },
            { id: 'q2', label: 'Residential or commercial?', options: ['Residential', 'Commercial', 'Both'], default: 'Residential', injection: 'market_segment' }
        ]
    },
    'Real Estate': {
        questions: [
            { id: 'q1', label: 'Individual agents or brokerages?', options: ['Individual agents', 'Small brokerages (2-10 agents)', 'Either'], default: 'Either', injection: 'business_size_precision' },
            { id: 'q2', label: 'Residential or commercial?', options: ['Residential', 'Commercial', 'Both'], default: 'Residential', injection: 'market_segment' }
        ]
    },
    'Dental': {
        questions: [
            { id: 'q1', label: 'General or specialty?', options: ['General dentistry', 'Specialty (ortho/cosmetic/implants)', 'Both'], default: 'General dentistry', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Solo practice or group?', options: ['Solo practice', 'Group practice (2-5 dentists)', 'Either'], default: 'Either', injection: 'business_size_precision' }
        ]
    }
};

// Industry-level fallback templates — these fire when only the top-level industry is selected
const VERTICAL_QUESTIONS = {
    'Food & Beverage': {
        questions: [
            { id: 'q1', label: 'What type of F&B business?', options: ['Restaurant / Catering', 'Coffee & Cafe', 'Craft Beverage (brewery/cidery)', 'Bakery & Artisan', 'Food Manufacturing'], default: 'Restaurant / Catering', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Neighborhood focus or citywide?', options: ['Specific neighborhoods', 'Citywide', 'Suburban focus'], default: 'Citywide', injection: 'geographic_precision' }
        ]
    },
    'Professional Services': {
        questions: [
            { id: 'q1', label: 'Firm / Practice Type', options: ['Legal, Accounting & Financial Services', 'IT Consulting & Cybersecurity (MSP/MSSP)', 'Real Estate & Property Management', 'Architecture, Engineering & Construction (AEC)', 'HR, Staffing & Payroll Services'], default: 'Legal, Accounting & Financial Services', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Primary Pitch Angle', options: ['Client Acquisition & Referral Network', 'Online Reputation & Trust Building', 'Competitive Intelligence & Positioning', 'Website Presence & Digital Authority'], default: 'Client Acquisition & Referral Network', injection: 'pitch_angle' }
        ]
    },
    'Automotive': {
        questions: [
            { id: 'q1', label: 'What automotive service type?', options: ['Auto Repair & Mechanic', 'Detailing & Wash', 'Tire & Alignment', 'Body Shop & Collision', 'Used Car Dealer'], default: 'Auto Repair & Mechanic', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Primary pitch angle?', options: ['Review velocity (more reviews)', 'Review quality (better ratings)', 'Local visibility (SEO)'], default: 'Review velocity (more reviews)', injection: 'pitch_angle' }
        ]
    },
    'Health & Beauty': {
        questions: [
            { id: 'q1', label: 'What service category?', options: ['Med Spa & Aesthetics', 'Hair Salon', 'Nail Salon', 'Massage & Wellness', 'Fitness Studio'], default: 'Hair Salon', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Appointment-based or walk-in?', options: ['Appointment-based', 'Walk-in', 'Both'], default: 'Both', injection: 'business_model_precision' }
        ]
    },
    'Retail': {
        questions: [
            { id: 'q1', label: 'What retail category?', options: ['Boutique Clothing', 'Specialty Food & Gifts', 'Home Goods & Decor', 'Books & Records', 'Sporting & Outdoor'], default: 'Boutique Clothing', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Brick-and-mortar or hybrid?', options: ['Brick-and-mortar only', 'Online + physical', 'Pop-up or market-based'], default: 'Brick-and-mortar only', injection: 'business_model_precision' }
        ]
    },
    'Home Services': {
        questions: [
            { id: 'q1', label: 'What home service type?', options: ['HVAC', 'Plumbing', 'Electrical', 'Landscaping', 'Cleaning', 'General Contractor'], default: 'HVAC', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Residential or commercial focus?', options: ['Residential', 'Commercial', 'Both'], default: 'Residential', injection: 'market_segment' }
        ]
    },
    'Agencies & Marketing Services': {
        questions: [
            { id: 'q1', label: 'Type of Agency', options: ['Creative / Full-Service Agency', 'Digital Marketing / Performance Agency', 'SEO & Content Agency', 'Social Media Agency', 'PR & Communications Firm', 'Branding & Design Studio', 'Staffing & Recruiting Agency', 'Other / Boutique Agency'], default: 'Creative / Full-Service Agency', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Primary Pitch Angle', options: ['Client Acquisition & Lead Generation', 'Client Retention & Upsell', 'Brand Visibility & Thought Leadership', 'Operational Efficiency & Tools'], default: 'Client Acquisition & Lead Generation', injection: 'pitch_angle' }
        ]
    },
    'Government & Public Sector': {
        questions: [
            { id: 'q1', label: 'Government Level / Type', options: ['Municipal / City Government', 'County Government', 'Quasi-Government / Authority', 'Public Education & Library System'], default: 'Municipal / City Government', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Primary Opportunity', options: ['Citizen Engagement & Communications', 'Website Modernization & Digital Presence', 'Reputation & Public Trust', 'Event Visibility & Community Programs'], default: 'Citizen Engagement & Communications', injection: 'pitch_angle' }
        ]
    },
    'Nonprofit & Associations': {
        questions: [
            { id: 'q1', label: 'Organization Type', options: ['Community & Social Services', 'Trade Association / Membership Org', 'Arts, Culture & Religious Org', 'Health & Human Services Nonprofit'], default: 'Community & Social Services', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Growth Angle', options: ['Donor Acquisition & Fundraising', 'Brand Visibility & Awareness', 'Event Promotion & Attendance', 'Volunteer & Member Recruitment'], default: 'Donor Acquisition & Fundraising', injection: 'pitch_angle' }
        ]
    },
    'Construction & Trades': {
        questions: [
            { id: 'q1', label: 'Contractor Type', options: ['General Contractor / Builder', 'Specialty Contractor (Roofing, Flooring, etc.)', 'Remodeling & Renovation', 'Commercial Construction'], default: 'General Contractor / Builder', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Top Priority', options: ['Lead Generation & New Clients', 'Online Reputation & Reviews', 'Competitive Positioning', 'Service Area Expansion'], default: 'Lead Generation & New Clients', injection: 'pitch_angle' }
        ]
    },
    'Hospitality & Lodging': {
        questions: [
            { id: 'q1', label: 'Property Type', options: ['Hotel / Full-Service Property', 'Boutique Hotel / B&B / Inn', 'Vacation Rental / Property Management', 'Event Venue / Banquet Hall'], default: 'Hotel / Full-Service Property', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Primary Opportunity', options: ['Direct Bookings & Reducing OTA Fees', 'Review Score Improvement', 'Discovery & Online Visibility', 'Event & Group Sales'], default: 'Direct Bookings & Reducing OTA Fees', injection: 'pitch_angle' }
        ]
    },
    'Media & Entertainment': {
        questions: [
            { id: 'q1', label: 'Business Type', options: ['Film & Video Production Studio', 'Photography Studio', 'Event Production & AV Company', 'Performing Arts & Theater'], default: 'Film & Video Production Studio', injection: 'sub_type_filter' },
            { id: 'q2', label: 'Pitch Angle', options: ['Client Acquisition & Portfolio Visibility', 'Market Share vs. Competitors', 'Audience & Community Building', 'Online Booking & Inquiry Conversion'], default: 'Client Acquisition & Portfolio Visibility', injection: 'pitch_angle' }
        ]
    }
};

/**
 * Get precision questions — sub-industry first, then industry fallback
 * @param {string} industry - Top-level industry category
 * @param {string} subIndustry - Sub-industry selection (optional)
 * @returns {object} Questions object with .questions array
 */
function getVerticalQuestions(industry, subIndustry) {
    // Try sub-industry match first
    if (subIndustry) {
        const subLower = subIndustry.toLowerCase();
        for (const [key, value] of Object.entries(SUB_INDUSTRY_QUESTIONS)) {
            if (subLower === key.toLowerCase() || subLower.includes(key.toLowerCase()) || key.toLowerCase().includes(subLower)) {
                return value;
            }
        }
    }

    // Fallback to industry-level
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
            { id: 'q1', label: 'What specific business type?', options: ['Small independent', 'Specialty / niche', 'Service-based', 'Product-based'], default: 'Small independent', injection: 'sub_type_filter' },
            { id: 'q2', label: 'What matters most to target?', options: ['More customer reviews', 'Better online visibility', 'Competitive positioning'], default: 'More customer reviews', injection: 'pitch_angle' }
        ]
    };
}

module.exports = { VERTICAL_QUESTIONS, SUB_INDUSTRY_QUESTIONS, getVerticalQuestions };
