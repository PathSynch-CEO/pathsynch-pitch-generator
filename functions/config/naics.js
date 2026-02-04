/**
 * NAICS Industry Configuration
 *
 * Maps NAICS codes to industry definitions with Google Places search terms
 * and industry-specific metrics.
 *
 * Data Source Types:
 * - 'places': Full Google Places support (local businesses)
 * - 'limited': Partial Places support (may not return competitors)
 * - 'manual': No Places support (B2B/enterprise - requires manual competitor input)
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
        densityBenchmark: { low: 2.0, medium: 5.0, high: 8.0 },
        avgTransaction: 55,
        monthlyCustomers: 3000
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
        densityBenchmark: { low: 3.0, medium: 8.0, high: 15.0 },
        avgTransaction: 15,
        monthlyCustomers: 8000
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
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 },
        avgTransaction: 8,
        monthlyCustomers: 4500
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 35,
        monthlyCustomers: 2000
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 450,
        monthlyCustomers: 200
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
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 2500,
        monthlyCustomers: 40
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
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 35000,
        monthlyCustomers: 80
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
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 50,
        monthlyCustomers: 500
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
        densityBenchmark: { low: 2.0, medium: 5.0, high: 10.0 },
        avgTransaction: 250,
        monthlyCustomers: 400
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
        densityBenchmark: { low: 1.0, medium: 2.5, high: 5.0 },
        avgTransaction: 350,
        monthlyCustomers: 300
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
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 75,
        monthlyCustomers: 200
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
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 120,
        monthlyCustomers: 250
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 450,
        monthlyCustomers: 120
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
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 },
        avgTransaction: 350,
        monthlyCustomers: 100
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
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 10000,
        monthlyCustomers: 20
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 250,
        monthlyCustomers: 80
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 7.0 },
        avgTransaction: 3500,
        monthlyCustomers: 25
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
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 },
        avgTransaction: 800,
        monthlyCustomers: 50
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
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 },
        avgTransaction: 12000,
        monthlyCustomers: 8
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
        densityBenchmark: { low: 1.0, medium: 2.5, high: 5.0 },
        avgTransaction: 1500,
        monthlyCustomers: 40
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
        densityBenchmark: { low: 2.0, medium: 5.0, high: 10.0 },
        avgTransaction: 35,
        monthlyCustomers: 400
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
        densityBenchmark: { low: 1.5, medium: 4.0, high: 8.0 },
        avgTransaction: 85,
        monthlyCustomers: 300
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 45,
        monthlyCustomers: 500
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
        densityBenchmark: { low: 1.0, medium: 3.0, high: 6.0 },
        avgTransaction: 45,
        monthlyCustomers: 2000
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
        densityBenchmark: { low: 0.8, medium: 2.0, high: 4.0 },
        avgTransaction: 75,
        monthlyCustomers: 800
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
        dataSourceType: 'places',
        spendingRate: 0.025,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 140000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 250,
        monthlyCustomers: 400
    },

    // ============================================
    // TECHNOLOGY & SAAS
    // ============================================
    '541511': {
        code: '541511',
        level: 6,
        sectorCode: '54',
        title: 'Custom Computer Programming Services',
        displayCategory: 'Technology & SaaS',
        displaySubcategory: 'Software Development',
        placesKeyword: 'software company',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.02,
        baseGrowthRate: 8.0,
        seasonalityPattern: 'q4_budget_peak',
        incomeSweetSpot: { min: 80000, ideal: 150000, max: 300000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 50000,
        monthlyCustomers: 10
    },
    '541512': {
        code: '541512',
        level: 6,
        sectorCode: '54',
        title: 'Computer Systems Design Services',
        displayCategory: 'Technology & SaaS',
        displaySubcategory: 'IT Services',
        placesKeyword: 'IT services',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.025,
        baseGrowthRate: 6.0,
        seasonalityPattern: 'q4_budget_peak',
        incomeSweetSpot: { min: 75000, ideal: 120000, max: 250000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 15000,
        monthlyCustomers: 20
    },
    '518210': {
        code: '518210',
        level: 6,
        sectorCode: '51',
        title: 'Data Processing, Hosting, and Related Services',
        displayCategory: 'Technology & SaaS',
        displaySubcategory: 'Cloud & Hosting',
        placesKeyword: 'cloud services',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.03,
        baseGrowthRate: 12.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 100000, ideal: 200000, max: 500000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 5000,
        monthlyCustomers: 50
    },
    '541519': {
        code: '541519',
        level: 6,
        sectorCode: '54',
        title: 'Other Computer Related Services',
        displayCategory: 'Technology & SaaS',
        displaySubcategory: 'SaaS Products',
        placesKeyword: 'saas company',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.02,
        baseGrowthRate: 15.0,
        seasonalityPattern: 'q4_budget_peak',
        incomeSweetSpot: { min: 60000, ideal: 120000, max: 300000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.8 },
        avgTransaction: 2000,
        monthlyCustomers: 100
    },
    '541690': {
        code: '541690',
        level: 6,
        sectorCode: '54',
        title: 'Other Scientific and Technical Consulting',
        displayCategory: 'Technology & SaaS',
        displaySubcategory: 'Tech Consulting',
        placesKeyword: 'technology consulting',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.015,
        baseGrowthRate: 5.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 90000, ideal: 175000, max: 350000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 25000,
        monthlyCustomers: 8
    },

    // ============================================
    // FINANCE & BANKING
    // ============================================
    '522110': {
        code: '522110',
        level: 6,
        sectorCode: '52',
        title: 'Commercial Banking',
        displayCategory: 'Finance & Banking',
        displaySubcategory: 'Commercial Banking',
        placesKeyword: 'bank',
        placesTypes: ['bank'],
        dataSourceType: 'limited',
        spendingRate: 0.01,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 50000, ideal: 100000, max: 250000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 500,
        monthlyCustomers: 5000
    },
    '522130': {
        code: '522130',
        level: 6,
        sectorCode: '52',
        title: 'Credit Unions',
        displayCategory: 'Finance & Banking',
        displaySubcategory: 'Credit Union',
        placesKeyword: 'credit union',
        placesTypes: ['bank'],
        dataSourceType: 'limited',
        spendingRate: 0.008,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 40000, ideal: 75000, max: 150000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 300,
        monthlyCustomers: 3000
    },
    '523110': {
        code: '523110',
        level: 6,
        sectorCode: '52',
        title: 'Investment Banking and Securities Dealing',
        displayCategory: 'Finance & Banking',
        displaySubcategory: 'Investment Banking',
        placesKeyword: 'investment bank',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.005,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'q4_year_end',
        incomeSweetSpot: { min: 150000, ideal: 300000, max: 750000 },
        densityBenchmark: { low: 0.05, medium: 0.15, high: 0.3 },
        avgTransaction: 100000,
        monthlyCustomers: 5
    },
    '523930': {
        code: '523930',
        level: 6,
        sectorCode: '52',
        title: 'Investment Advice',
        displayCategory: 'Finance & Banking',
        displaySubcategory: 'Financial Advisory',
        placesKeyword: 'financial advisor',
        placesTypes: ['financial_advisor'],
        dataSourceType: 'limited',
        spendingRate: 0.01,
        baseGrowthRate: 4.5,
        seasonalityPattern: 'q1_tax_season',
        incomeSweetSpot: { min: 100000, ideal: 200000, max: 500000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 5000,
        monthlyCustomers: 50
    },
    '522320': {
        code: '522320',
        level: 6,
        sectorCode: '52',
        title: 'Financial Transactions Processing',
        displayCategory: 'Finance & Banking',
        displaySubcategory: 'Payment Processing',
        placesKeyword: 'payment processing',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.025,
        baseGrowthRate: 8.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 80000, ideal: 150000, max: 350000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 25000,
        monthlyCustomers: 30
    },

    // ============================================
    // MANUFACTURING
    // ============================================
    '332710': {
        code: '332710',
        level: 6,
        sectorCode: '33',
        title: 'Machine Shops',
        displayCategory: 'Manufacturing',
        displaySubcategory: 'Machine Shop',
        placesKeyword: 'machine shop',
        placesTypes: [],
        dataSourceType: 'limited',
        spendingRate: 0.02,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 70000, max: 120000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 8000,
        monthlyCustomers: 25
    },
    '333249': {
        code: '333249',
        level: 6,
        sectorCode: '33',
        title: 'Other Industrial Machinery Manufacturing',
        displayCategory: 'Manufacturing',
        displaySubcategory: 'Industrial Equipment',
        placesKeyword: 'industrial manufacturing',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.015,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'q4_budget_peak',
        incomeSweetSpot: { min: 55000, ideal: 85000, max: 150000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 75000,
        monthlyCustomers: 8
    },
    '311999': {
        code: '311999',
        level: 6,
        sectorCode: '31',
        title: 'All Other Miscellaneous Food Manufacturing',
        displayCategory: 'Manufacturing',
        displaySubcategory: 'Food Manufacturing',
        placesKeyword: 'food manufacturer',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.04,
        baseGrowthRate: 3.5,
        seasonalityPattern: 'holiday_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 110000 },
        densityBenchmark: { low: 0.15, medium: 0.4, high: 0.8 },
        avgTransaction: 15000,
        monthlyCustomers: 40
    },
    '339999': {
        code: '339999',
        level: 6,
        sectorCode: '33',
        title: 'All Other Miscellaneous Manufacturing',
        displayCategory: 'Manufacturing',
        displaySubcategory: 'General Manufacturing',
        placesKeyword: 'manufacturing',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.02,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 70000, max: 120000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 20000,
        monthlyCustomers: 20
    },

    // ============================================
    // TRANSPORTATION & LOGISTICS
    // ============================================
    '481111': {
        code: '481111',
        level: 6,
        sectorCode: '48',
        title: 'Scheduled Passenger Air Transportation',
        displayCategory: 'Transportation & Logistics',
        displaySubcategory: 'Commercial Aviation',
        placesKeyword: 'airline',
        placesTypes: ['airport'],
        dataSourceType: 'manual',
        spendingRate: 0.03,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'summer_holiday_peak',
        incomeSweetSpot: { min: 60000, ideal: 100000, max: 200000 },
        densityBenchmark: { low: 0.01, medium: 0.03, high: 0.05 },
        avgTransaction: 350,
        monthlyCustomers: 50000
    },
    '481211': {
        code: '481211',
        level: 6,
        sectorCode: '48',
        title: 'Nonscheduled Chartered Passenger Air Transportation',
        displayCategory: 'Transportation & Logistics',
        displaySubcategory: 'Charter Aviation',
        placesKeyword: 'charter flight',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.005,
        baseGrowthRate: 5.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 150000, ideal: 300000, max: 750000 },
        densityBenchmark: { low: 0.02, medium: 0.05, high: 0.1 },
        avgTransaction: 15000,
        monthlyCustomers: 50
    },
    '488190': {
        code: '488190',
        level: 6,
        sectorCode: '48',
        title: 'Other Support Activities for Air Transportation',
        displayCategory: 'Transportation & Logistics',
        displaySubcategory: 'Aviation Services',
        placesKeyword: 'aviation services',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.015,
        baseGrowthRate: 4.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 70000, ideal: 120000, max: 200000 },
        densityBenchmark: { low: 0.05, medium: 0.15, high: 0.3 },
        avgTransaction: 5000,
        monthlyCustomers: 100
    },
    '484110': {
        code: '484110',
        level: 6,
        sectorCode: '48',
        title: 'General Freight Trucking, Local',
        displayCategory: 'Transportation & Logistics',
        displaySubcategory: 'Freight & Trucking',
        placesKeyword: 'trucking company',
        placesTypes: [],
        dataSourceType: 'limited',
        spendingRate: 0.02,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'q4_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 110000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 2500,
        monthlyCustomers: 100
    },
    '493110': {
        code: '493110',
        level: 6,
        sectorCode: '49',
        title: 'General Warehousing and Storage',
        displayCategory: 'Transportation & Logistics',
        displaySubcategory: 'Warehousing',
        placesKeyword: 'warehouse',
        placesTypes: [],
        dataSourceType: 'limited',
        spendingRate: 0.015,
        baseGrowthRate: 6.0,
        seasonalityPattern: 'q4_peak',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 140000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 8000,
        monthlyCustomers: 50
    },

    // ============================================
    // ENERGY & UTILITIES
    // ============================================
    '221111': {
        code: '221111',
        level: 6,
        sectorCode: '22',
        title: 'Hydroelectric Power Generation',
        displayCategory: 'Energy & Utilities',
        displaySubcategory: 'Power Generation',
        placesKeyword: 'power plant',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.05,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'summer_winter_peak',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 150000 },
        densityBenchmark: { low: 0.01, medium: 0.03, high: 0.05 },
        avgTransaction: 150,
        monthlyCustomers: 100000
    },
    '237130': {
        code: '237130',
        level: 6,
        sectorCode: '23',
        title: 'Power and Communication Line Construction',
        displayCategory: 'Energy & Utilities',
        displaySubcategory: 'Utility Construction',
        placesKeyword: 'utility contractor',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.02,
        baseGrowthRate: 5.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 55000, ideal: 85000, max: 150000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 250000,
        monthlyCustomers: 5
    },
    '221310': {
        code: '221310',
        level: 6,
        sectorCode: '22',
        title: 'Water Supply and Irrigation Systems',
        displayCategory: 'Energy & Utilities',
        displaySubcategory: 'Water Utilities',
        placesKeyword: 'water utility',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.01,
        baseGrowthRate: 1.5,
        seasonalityPattern: 'summer_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 120000 },
        densityBenchmark: { low: 0.02, medium: 0.05, high: 0.1 },
        avgTransaction: 75,
        monthlyCustomers: 50000
    },

    // ============================================
    // AGRICULTURE
    // ============================================
    '111998': {
        code: '111998',
        level: 6,
        sectorCode: '11',
        title: 'All Other Miscellaneous Crop Farming',
        displayCategory: 'Agriculture',
        displaySubcategory: 'Crop Farming',
        placesKeyword: 'farm',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.03,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'harvest_peak',
        incomeSweetSpot: { min: 35000, ideal: 60000, max: 120000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 25000,
        monthlyCustomers: 10
    },
    '112990': {
        code: '112990',
        level: 6,
        sectorCode: '11',
        title: 'All Other Animal Production',
        displayCategory: 'Agriculture',
        displaySubcategory: 'Livestock',
        placesKeyword: 'livestock farm',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.025,
        baseGrowthRate: 1.5,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 35000, ideal: 55000, max: 100000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 15000,
        monthlyCustomers: 15
    },
    '115310': {
        code: '115310',
        level: 6,
        sectorCode: '11',
        title: 'Support Activities for Forestry',
        displayCategory: 'Agriculture',
        displaySubcategory: 'Forestry',
        placesKeyword: 'forestry services',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.015,
        baseGrowthRate: 2.5,
        seasonalityPattern: 'spring_fall_peak',
        incomeSweetSpot: { min: 40000, ideal: 65000, max: 110000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 10000,
        monthlyCustomers: 20
    },

    // ============================================
    // COMMERCIAL REAL ESTATE
    // ============================================
    '531120': {
        code: '531120',
        level: 6,
        sectorCode: '53',
        title: 'Lessors of Nonresidential Buildings',
        displayCategory: 'Commercial Real Estate',
        displaySubcategory: 'Commercial Property',
        placesKeyword: 'commercial real estate',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.01,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 100000, ideal: 200000, max: 500000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 50000,
        monthlyCustomers: 5
    },
    '531311': {
        code: '531311',
        level: 6,
        sectorCode: '53',
        title: 'Residential Property Managers',
        displayCategory: 'Commercial Real Estate',
        displaySubcategory: 'Property Management',
        placesKeyword: 'property management',
        placesTypes: ['property_management'],
        dataSourceType: 'limited',
        spendingRate: 0.008,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'summer_peak',
        incomeSweetSpot: { min: 60000, ideal: 100000, max: 180000 },
        densityBenchmark: { low: 0.3, medium: 0.8, high: 1.5 },
        avgTransaction: 2000,
        monthlyCustomers: 100
    },

    // ============================================
    // EDUCATION & TRAINING
    // ============================================
    '611310': {
        code: '611310',
        level: 6,
        sectorCode: '61',
        title: 'Colleges, Universities, and Professional Schools',
        displayCategory: 'Education & Training',
        displaySubcategory: 'Higher Education',
        placesKeyword: 'university',
        placesTypes: ['university'],
        dataSourceType: 'limited',
        spendingRate: 0.02,
        baseGrowthRate: 2.0,
        seasonalityPattern: 'fall_enrollment',
        incomeSweetSpot: { min: 50000, ideal: 90000, max: 180000 },
        densityBenchmark: { low: 0.05, medium: 0.15, high: 0.3 },
        avgTransaction: 25000,
        monthlyCustomers: 5000
    },
    '611430': {
        code: '611430',
        level: 6,
        sectorCode: '61',
        title: 'Professional and Management Development Training',
        displayCategory: 'Education & Training',
        displaySubcategory: 'Corporate Training',
        placesKeyword: 'corporate training',
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.015,
        baseGrowthRate: 5.0,
        seasonalityPattern: 'q1_q4_peak',
        incomeSweetSpot: { min: 70000, ideal: 120000, max: 200000 },
        densityBenchmark: { low: 0.1, medium: 0.3, high: 0.6 },
        avgTransaction: 5000,
        monthlyCustomers: 50
    },
    '611699': {
        code: '611699',
        level: 6,
        sectorCode: '61',
        title: 'All Other Miscellaneous Schools and Instruction',
        displayCategory: 'Education & Training',
        displaySubcategory: 'Specialty Training',
        placesKeyword: 'training school',
        placesTypes: ['school'],
        dataSourceType: 'limited',
        spendingRate: 0.01,
        baseGrowthRate: 4.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 45000, ideal: 75000, max: 140000 },
        densityBenchmark: { low: 0.2, medium: 0.5, high: 1.0 },
        avgTransaction: 1500,
        monthlyCustomers: 100
    },

    // ============================================
    // OTHER (Custom Industry Entry)
    // ============================================
    '999999': {
        code: '999999',
        level: 6,
        sectorCode: '99',
        title: 'Other Industries (Custom)',
        displayCategory: 'Other',
        displaySubcategory: 'Custom Industry',
        placesKeyword: null,
        placesTypes: [],
        dataSourceType: 'manual',
        spendingRate: 0.02,
        baseGrowthRate: 3.0,
        seasonalityPattern: 'stable',
        incomeSweetSpot: { min: 50000, ideal: 80000, max: 150000 },
        densityBenchmark: { low: 0.5, medium: 1.5, high: 3.0 },
        avgTransaction: 500,
        monthlyCustomers: 200
    }
};

/**
 * Reverse mapping from display names to NAICS codes
 */
const DISPLAY_TO_NAICS = {
    // Food & Beverage
    'Food & Bev': ['722511', '722513', '722515'],
    'Food & Beverage': ['722511', '722513', '722515', '722410'],
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
    'Electronics': ['443142'],

    // Technology & SaaS
    'Technology & SaaS': ['541511', '541512', '518210', '541519', '541690'],
    'Technology': ['541511', '541512', '518210', '541519', '541690'],
    'SaaS': ['541519'],
    'Software Development': ['541511'],
    'IT Services': ['541512'],
    'Cloud & Hosting': ['518210'],
    'SaaS Products': ['541519'],
    'Tech Consulting': ['541690'],

    // Finance & Banking
    'Finance & Banking': ['522110', '522130', '523110', '523930', '522320'],
    'Finance': ['522110', '522130', '523110', '523930', '522320'],
    'Banking': ['522110', '522130'],
    'Commercial Banking': ['522110'],
    'Credit Union': ['522130'],
    'Investment Banking': ['523110'],
    'Financial Advisory': ['523930'],
    'Payment Processing': ['522320'],

    // Manufacturing
    'Manufacturing': ['332710', '333249', '311999', '339999'],
    'Machine Shop': ['332710'],
    'Industrial Equipment': ['333249'],
    'Food Manufacturing': ['311999'],
    'General Manufacturing': ['339999'],

    // Transportation & Logistics
    'Transportation & Logistics': ['481111', '481211', '488190', '484110', '493110'],
    'Transportation': ['481111', '481211', '488190', '484110', '493110'],
    'Logistics': ['484110', '493110'],
    'Aviation': ['481111', '481211', '488190'],
    'Commercial Aviation': ['481111'],
    'Charter Aviation': ['481211'],
    'Aviation Services': ['488190'],
    'Freight & Trucking': ['484110'],
    'Warehousing': ['493110'],

    // Energy & Utilities
    'Energy & Utilities': ['221111', '237130', '221310'],
    'Energy': ['221111', '237130'],
    'Utilities': ['221111', '221310'],
    'Power Generation': ['221111'],
    'Utility Construction': ['237130'],
    'Water Utilities': ['221310'],

    // Agriculture
    'Agriculture': ['111998', '112990', '115310'],
    'Farming': ['111998', '112990'],
    'Crop Farming': ['111998'],
    'Livestock': ['112990'],
    'Forestry': ['115310'],

    // Commercial Real Estate
    'Commercial Real Estate': ['531120', '531311'],
    'Commercial Property': ['531120'],
    'Property Management': ['531311'],

    // Education & Training
    'Education & Training': ['611310', '611430', '611699'],
    'Education': ['611310', '611430', '611699'],
    'Higher Education': ['611310'],
    'Corporate Training': ['611430'],
    'Specialty Training': ['611699'],

    // Other
    'Other': ['999999'],
    'Custom Industry': ['999999']
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
 * Get average transaction value for an industry
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {number} Average transaction value in dollars
 */
function getAvgTransaction(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry?.avgTransaction || 50; // Default $50
}

/**
 * Get typical monthly customer count for an industry
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {number} Typical monthly customer count for a single business
 */
function getMonthlyCustomers(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry?.monthlyCustomers || 200; // Default 200
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
 * @returns {Object[]} Array of { name, naicsCode, dataSourceType } objects
 */
function getSubcategories(category) {
    const subcategories = [];
    for (const [code, industry] of Object.entries(NAICS_INDUSTRIES)) {
        if (industry.displayCategory === category) {
            subcategories.push({
                name: industry.displaySubcategory,
                naicsCode: code,
                title: industry.title,
                dataSourceType: industry.dataSourceType || 'places'
            });
        }
    }
    return subcategories;
}

/**
 * Get data source type for an industry
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {string} 'places', 'limited', or 'manual'
 */
function getDataSourceType(naicsCode) {
    const industry = NAICS_INDUSTRIES[naicsCode];
    return industry?.dataSourceType || 'places';
}

/**
 * Check if industry supports Google Places competitor discovery
 * @param {string} naicsCode - 6-digit NAICS code
 * @returns {boolean} True if Places can find competitors
 */
function supportsCompetitorDiscovery(naicsCode) {
    const sourceType = getDataSourceType(naicsCode);
    return sourceType === 'places';
}

/**
 * Get all industries organized by category for dropdown population
 * Includes metadata about data source availability
 * @returns {Object[]} Array of { category, subcategories, dataSourceInfo }
 */
function getIndustriesForDropdown() {
    const categories = getDisplayCategories();
    return categories.map(category => {
        const subcategories = getSubcategories(category);
        const hasPlacesSupport = subcategories.some(sub => sub.dataSourceType === 'places');
        const hasLimitedSupport = subcategories.some(sub => sub.dataSourceType === 'limited');
        const isFullyManual = subcategories.every(sub => sub.dataSourceType === 'manual');

        return {
            category,
            subcategories,
            dataSourceInfo: {
                hasPlacesSupport,
                hasLimitedSupport,
                isFullyManual,
                description: isFullyManual
                    ? 'Competitor data requires manual entry'
                    : hasLimitedSupport && !hasPlacesSupport
                        ? 'Limited competitor data available'
                        : 'Full competitor discovery available'
            }
        };
    });
}

/**
 * Check if a category is primarily B2B (manual data source)
 * @param {string} category - Display category name
 * @returns {boolean}
 */
function isB2BCategory(category) {
    const b2bCategories = [
        'Technology & SaaS',
        'Finance & Banking',
        'Manufacturing',
        'Transportation & Logistics',
        'Energy & Utilities',
        'Agriculture',
        'Commercial Real Estate'
    ];
    return b2bCategories.includes(category);
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
    getAvgTransaction,
    getMonthlyCustomers,
    getDisplayCategories,
    getSubcategories,
    getDataSourceType,
    supportsCompetitorDiscovery,
    getIndustriesForDropdown,
    isB2BCategory
};
