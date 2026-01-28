/**
 * NAICS Industry Configuration
 *
 * Maps NAICS codes to industry definitions with Google Places search terms
 * and industry-specific metrics
 */

/**
 * Core NAICS industry definitions
 * Organized by PathSynch display categories
 */
const NAICS_INDUSTRIES = {
    // Food & Beverage
    '722511': {
        code: '722511',
        level: 6,
        sectorCode: '72',
        title: 'Full-Service Restaurants',
        displayCategory: 'Food & Beverage',
        displaySubcategory: 'Full Service Restaurant',
        placesKeyword: 'restaurant',
        placesTypes: ['restaurant', 'american_restaurant', 'italian_restaurant', 'mexican_restaurant'],
        spendingRate: 0.055,
        baseGrowthRate: 3.5,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 150000 },
        densityBenchmark: { low: 2.0, medium: 5.0, high: 8.0 }
    },
    '722513': {
        code: '722513',
        level: 6,
        sectorCode: '72',
        title: 'Limited-Service Restaurants',
        displayCategory: 'Food & Beverage',
        displaySubcategory: 'Fast Casual',
        placesKeyword: 'fast food OR quick service restaurant',
        placesTypes: ['fast_food_restaurant', 'meal_takeaway'],
        spendingRate: 0.035,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 30000, ideal: 50000, max: 80000 },
        densityBenchmark: { low: 3.0, medium: 8.0, high: 15.0 }
    },
    '722515': {
        code: '722515',
        level: 6,
        sectorCode: '72',
        title: 'Snack and Nonalcoholic Beverage Bars',
        displayCategory: 'Food & Beverage',
        displaySubcategory: 'Coffee & Cafe',
        placesKeyword: 'cafe OR coffee shop',
        placesTypes: ['cafe', 'coffee_shop', 'bakery'],
        spendingRate: 0.025,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 70000, max: 120000 },
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 }
    },
    '722410': {
        code: '722410',
        level: 6,
        sectorCode: '72',
        title: 'Drinking Places (Alcoholic Beverages)',
        displayCategory: 'Food & Beverage',
        displaySubcategory: 'Bar & Nightlife',
        placesKeyword: 'bar OR pub OR nightclub',
        placesTypes: ['bar', 'night_club'],
        spendingRate: 0.020,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'weekend_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 100000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },

    // Automotive
    '811111': {
        code: '811111',
        level: 6,
        sectorCode: '81',
        title: 'General Automotive Repair',
        displayCategory: 'Automotive',
        displaySubcategory: 'Auto Repair',
        placesKeyword: 'auto repair OR car mechanic',
        placesTypes: ['car_repair', 'auto_repair'],
        spendingRate: 0.025,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 35000, ideal: 60000, max: 100000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },
    '811121': {
        code: '811121',
        level: 6,
        sectorCode: '81',
        title: 'Automotive Body, Paint, and Interior Repair',
        displayCategory: 'Automotive',
        displaySubcategory: 'Body Shop',
        placesKeyword: 'auto body shop OR car paint',
        placesTypes: ['car_repair'],
        spendingRate: 0.015,
        baseGrowthRate: 1.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 110000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 }
    },
    '441110': {
        code: '441110',
        level: 6,
        sectorCode: '44',
        title: 'New Car Dealers',
        displayCategory: 'Automotive',
        displaySubcategory: 'Car Dealership',
        placesKeyword: 'car dealer OR auto dealership',
        placesTypes: ['car_dealer'],
        spendingRate: 0.080,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'year_end_peak',
        incomeSweetSpot: { min: 50000, ideal: 85000, max: 150000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 }
    },

    // Health & Wellness
    '713940': {
        code: '713940',
        level: 6,
        sectorCode: '71',
        title: 'Fitness and Recreational Sports Centers',
        displayCategory: 'Health & Wellness',
        displaySubcategory: 'Gym & Fitness',
        placesKeyword: 'gym OR fitness center',
        placesTypes: ['gym', 'fitness_center'],
        spendingRate: 0.012,
        baseGrowthRate: 5.0,
        seasonalityPattern: 'january_peak',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 120000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 }
    },
    '621111': {
        code: '621111',
        level: 6,
        sectorCode: '62',
        title: 'Offices of Physicians',
        displayCategory: 'Health & Wellness',
        displaySubcategory: 'Medical Practice',
        placesKeyword: 'doctor OR medical clinic OR physician',
        placesTypes: ['doctor', 'medical_clinic', 'hospital'],
        spendingRate: 0.040,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 40000, ideal: 70000, max: 150000 },
        densityBenchmark: { low: 2.0, medium: 5.0, high: 10.0 }
    },
    '621210': {
        code: '621210',
        level: 6,
        sectorCode: '62',
        title: 'Offices of Dentists',
        displayCategory: 'Health & Wellness',
        displaySubcategory: 'Dental Practice',
        placesKeyword: 'dentist OR dental clinic',
        placesTypes: ['dentist'],
        spendingRate: 0.015,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 130000 },
        densityBenchmark: { low: 1.0, medium: 2.5, high: 5.0 }
    },
    '621310': {
        code: '621310',
        level: 6,
        sectorCode: '62',
        title: 'Offices of Chiropractors',
        displayCategory: 'Health & Wellness',
        displaySubcategory: 'Chiropractic',
        placesKeyword: 'chiropractor',
        placesTypes: ['chiropractor'],
        spendingRate: 0.008,
        baseGrowthRate: 3.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 130000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 }
    },
    '812199': {
        code: '812199',
        level: 6,
        sectorCode: '81',
        title: 'Other Personal Care Services',
        displayCategory: 'Health & Wellness',
        displaySubcategory: 'Spa & Massage',
        placesKeyword: 'spa OR massage',
        placesTypes: ['spa', 'massage'],
        spendingRate: 0.010,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 55000, ideal: 90000, max: 150000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 }
    },

    // Home Services
    '238220': {
        code: '238220',
        level: 6,
        sectorCode: '23',
        title: 'Plumbing, Heating, and Air-Conditioning Contractors',
        displayCategory: 'Home Services',
        displaySubcategory: 'Plumbing & HVAC',
        placesKeyword: 'plumber OR hvac OR air conditioning',
        placesTypes: ['plumber', 'hvac_contractor'],
        spendingRate: 0.030,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'summer_peak',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 130000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },
    '238210': {
        code: '238210',
        level: 6,
        sectorCode: '23',
        title: 'Electrical Contractors and Other Wiring Installation',
        displayCategory: 'Home Services',
        displaySubcategory: 'Electrical',
        placesKeyword: 'electrician OR electrical contractor',
        placesTypes: ['electrician'],
        spendingRate: 0.020,
        baseGrowthRate: 3.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 140000 },
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 }
    },
    '238160': {
        code: '238160',
        level: 6,
        sectorCode: '23',
        title: 'Roofing Contractors',
        displayCategory: 'Home Services',
        displaySubcategory: 'Roofing',
        placesKeyword: 'roofing contractor OR roof repair',
        placesTypes: ['roofing_contractor'],
        spendingRate: 0.015,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'spring_summer_peak',
        incomeSweetSpot: { min: 55000, ideal: 85000, max: 150000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 }
    },
    '561730': {
        code: '561730',
        level: 6,
        sectorCode: '56',
        title: 'Landscaping Services',
        displayCategory: 'Home Services',
        displaySubcategory: 'Landscaping',
        placesKeyword: 'landscaping OR lawn care OR lawn service',
        placesTypes: ['landscaper'],
        spendingRate: 0.010,
        baseGrowthRate: 4.5,
        seasonalityPattern: 'spring_summer_peak',
        incomeSweetSpot: { min: 60000, ideal: 95000, max: 180000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },

    // Professional Services
    '541110': {
        code: '541110',
        level: 6,
        sectorCode: '54',
        title: 'Offices of Lawyers',
        displayCategory: 'Professional Services',
        displaySubcategory: 'Legal',
        placesKeyword: 'lawyer OR attorney OR law firm',
        placesTypes: ['lawyer', 'law_firm'],
        spendingRate: 0.015,
        baseGrowthRate: 1.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 70000, ideal: 120000, max: 200000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 7.0 }
    },
    '541211': {
        code: '541211',
        level: 6,
        sectorCode: '54',
        title: 'Offices of Certified Public Accountants',
        displayCategory: 'Professional Services',
        displaySubcategory: 'Accounting',
        placesKeyword: 'accountant OR cpa OR tax preparation',
        placesTypes: ['accountant', 'accounting'],
        spendingRate: 0.012,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'tax_season_peak',
        incomeSweetSpot: { min: 60000, ideal: 100000, max: 180000 },
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 }
    },
    '531210': {
        code: '531210',
        level: 6,
        sectorCode: '53',
        title: 'Offices of Real Estate Agents and Brokers',
        displayCategory: 'Professional Services',
        displaySubcategory: 'Real Estate',
        placesKeyword: 'real estate agent OR realtor',
        placesTypes: ['real_estate_agency'],
        spendingRate: 0.050,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'spring_summer_peak',
        incomeSweetSpot: { min: 55000, ideal: 90000, max: 160000 },
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 }
    },
    '524210': {
        code: '524210',
        level: 6,
        sectorCode: '52',
        title: 'Insurance Agencies and Brokerages',
        displayCategory: 'Professional Services',
        displaySubcategory: 'Insurance',
        placesKeyword: 'insurance agent OR insurance agency',
        placesTypes: ['insurance_agency'],
        spendingRate: 0.025,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 130000 },
        densityBenchmark: { low: 1.0, medium: 2.5, high: 5.0 }
    },

    // Salon & Beauty
    '812111': {
        code: '812111',
        level: 6,
        sectorCode: '81',
        title: 'Barber Shops',
        displayCategory: 'Salon & Beauty',
        displaySubcategory: 'Hair Salon',
        placesKeyword: 'hair salon OR barber shop',
        placesTypes: ['hair_salon', 'barber_shop'],
        spendingRate: 0.008,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 35000, ideal: 55000, max: 90000 },
        densityBenchmark: { low: 2.0, medium: 5.0, high: 10.0 }
    },
    '812112': {
        code: '812112',
        level: 6,
        sectorCode: '81',
        title: 'Beauty Salons',
        displayCategory: 'Salon & Beauty',
        displaySubcategory: 'Beauty Salon',
        placesKeyword: 'beauty salon',
        placesTypes: ['beauty_salon'],
        spendingRate: 0.010,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 110000 },
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 }
    },
    '812113': {
        code: '812113',
        level: 6,
        sectorCode: '81',
        title: 'Nail Salons',
        displayCategory: 'Salon & Beauty',
        displaySubcategory: 'Nail Salon',
        placesKeyword: 'nail salon',
        placesTypes: ['nail_salon'],
        spendingRate: 0.006,
        baseGrowthRate: 3.5,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 35000, ideal: 60000, max: 100000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },

    // Retail
    '452319': {
        code: '452319',
        level: 6,
        sectorCode: '45',
        title: 'All Other General Merchandise Stores',
        displayCategory: 'Retail',
        displaySubcategory: 'General Merchandise',
        placesKeyword: 'retail store OR general store',
        placesTypes: ['store', 'department_store'],
        spendingRate: 0.100,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 35000, ideal: 55000, max: 100000 },
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 }
    },
    '448140': {
        code: '448140',
        level: 6,
        sectorCode: '44',
        title: 'Family Clothing Stores',
        displayCategory: 'Retail',
        displaySubcategory: 'Clothing',
        placesKeyword: 'clothing store OR apparel store',
        placesTypes: ['clothing_store'],
        spendingRate: 0.035,
        baseGrowthRate: 1.5,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 40000, ideal: 70000, max: 130000 },
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 }
    },
    '443142': {
        code: '443142',
        level: 6,
        sectorCode: '44',
        title: 'Electronics Stores',
        displayCategory: 'Retail',
        displaySubcategory: 'Electronics',
        placesKeyword: 'electronics store',
        placesTypes: ['electronics_store'],
        spendingRate: 0.025,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 140000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 }
    }
};

/**
 * Reverse mapping from display names to NAICS codes
 */
const DISPLAY_TO_NAICS = {
    // Food & Beverage
    'Food & Bev': ['722511', '722513', '722515'],
    'Food & Beverage': ['722511', '722513', '722515'],
    'Restaurant': ['722511'],
    'Full Service Restaurant': ['722511'],
    'Fast Casual': ['722513'],
    'Coffee & Cafe': ['722515'],
    'Bar & Nightlife': ['722410'],

    // Automotive
    'Automotive': ['811111', '811121', '441110'],
    'Auto Repair': ['811111'],
    'Body Shop': ['811121'],
    'Car Dealership': ['441110'],

    // Health & Wellness
    'Health & Wellness': ['713940', '621111', '621210', '621310', '812199'],
    'Gym & Fitness': ['713940'],
    'Medical Practice': ['621111'],
    'Dental Practice': ['621210'],
    'Chiropractic': ['621310'],
    'Spa & Massage': ['812199'],

    // Home Services
    'Home Services': ['238220', '238210', '238160', '561730'],
    'Plumbing & HVAC': ['238220'],
    'Electrical': ['238210'],
    'Roofing': ['238160'],
    'Landscaping': ['561730'],
    'Lawn Care': ['561730'],

    // Professional Services
    'Professional Services': ['541110', '541211', '531210', '524210'],
    'Legal': ['541110'],
    'Accounting': ['541211'],
    'Real Estate': ['531210'],
    'Insurance': ['524210'],

    // Salon & Beauty
    'Salon': ['812111', '812112', '812113'],
    'Salon & Beauty': ['812111', '812112', '812113'],
    'Hair Salon': ['812111'],
    'Beauty Salon': ['812112'],
    'Nail Salon': ['812113'],

    // Retail
    'Retail': ['452319', '448140', '443142'],
    'General Merchandise': ['452319'],
    'Clothing': ['448140'],
    'Electronics': ['443142']
};

/**
 * Get NAICS codes for a display name
 * @param {string} displayName - UI display name (e.g., "Food & Bev", "Automotive")
 * @returns {string[]} Array of matching NAICS codes
 */
function getNaicsByDisplay(displayName) {
    if (!displayName) return [];

    // Direct lookup
    const codes = DISPLAY_TO_NAICS[displayName];
    if (codes) return codes;

    // Case-insensitive search
    const normalizedInput = displayName.toLowerCase().trim();
    for (const [key, value] of Object.entries(DISPLAY_TO_NAICS)) {
        if (key.toLowerCase() === normalizedInput) {
            return value;
        }
    }

    // Partial match fallback
    for (const [key, value] of Object.entries(DISPLAY_TO_NAICS)) {
        if (key.toLowerCase().includes(normalizedInput) ||
            normalizedInput.includes(key.toLowerCase())) {
            return value;
        }
    }

    return [];
}

/**
 * Get full industry details for a NAICS code
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {Object|null} Industry definition object
 */
function getNaicsDetails(naicsCode) {
    return NAICS_INDUSTRIES[naicsCode] || null;
}

/**
 * Get industry spending rate for market size calculations
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {number} Spending rate as decimal (e.g., 0.055 for 5.5%)
 */
function getIndustrySpendRate(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry ? industry.spendingRate : 0.02; // Default 2%
}

/**
 * Get Google Places search terms for an industry
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {string} Search keyword string for Google Places
 */
function getPlacesSearchTerms(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry ? industry.placesKeyword : naicsCode;
}

/**
 * Get industry density benchmarks for saturation calculations
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {Object} Density thresholds { low, medium, high } per 10K population
 */
function getIndustryBenchmarks(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry?.densityBenchmark || { low: 1.5, medium: 4.0, high: 8.0 };
}

/**
 * Get industry base growth rate
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {number} Base annual growth rate percentage
 */
function getBaseGrowthRate(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry ? industry.baseGrowthRate : 2.5;
}

/**
 * Get income sweet spot for opportunity scoring
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {Object} Income range { min, ideal, max }
 */
function getIncomeSweetSpot(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry?.incomeSweetSpot || { min: 40000, ideal: 65000, max: 120000 };
}

/**
 * Get all display categories for UI dropdown
 * @returns {string[]} Array of display category names
 */
function getDisplayCategories() {
    const categories = new Set();
    for (const industry of Object.values(NAICS_INDUSTRIES)) {
        categories.add(industry.displayCategory);
    }
    return Array.from(categories).sort();
}

/**
 * Get subcategories for a display category
 * @param {string} category - Display category name
 * @returns {Object[]} Array of { name, naicsCode } objects
 */
function getSubcategories(category) {
    const subcategories = [];
    for (const [code, industry] of Object.entries(NAICS_INDUSTRIES)) {
        if (industry.displayCategory === category) {
            subcategories.push({
                name: industry.displaySubcategory,
                naicsCode: code,
                title: industry.title
            });
        }
    }
    return subcategories;
}

module.exports = {
    NAICS_INDUSTRIES,
    DISPLAY_TO_NAICS,
    getNaicsByDisplay,
    getNaicsDetails,
    getIndustrySpendRate,
    getPlacesSearchTerms,
    getIndustryBenchmarks,
    getBaseGrowthRate,
    getIncomeSweetSpot,
    getDisplayCategories,
    getSubcategories
};
