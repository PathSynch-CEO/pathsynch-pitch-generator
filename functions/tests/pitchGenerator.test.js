/**
 * Integration Tests for pitchGenerator.js
 *
 * These tests serve as a regression baseline for the refactoring effort.
 * They must pass BEFORE any refactoring begins and after every step.
 *
 * Run with: npm test
 * Run specific file: npm test -- pitchGenerator.test.js
 */

// Mock firebase-admin before requiring the module
const createMockFirestore = () => {
    const mockFirestore = {
        collection: jest.fn(function() { return this; }),
        doc: jest.fn(function() { return this; }),
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        where: jest.fn(function() { return this; }),
        limit: jest.fn(function() { return this; }),
    };
    return mockFirestore;
};

let mockDb;

jest.mock('firebase-admin', () => {
    mockDb = createMockFirestore();

    const firestoreFn = jest.fn(() => mockDb);
    firestoreFn.FieldValue = {
        serverTimestamp: jest.fn(() => new Date()),
        increment: jest.fn((n) => n),
    };

    return {
        firestore: firestoreFn,
        initializeApp: jest.fn(),
        credential: {
            applicationDefault: jest.fn(),
        },
    };
});

// Mock precallForm service
jest.mock('../services/precallForm', () => ({
    mapResponsesToPitchData: jest.fn((responses) => ({
        urgency: 'high',
        stakeholders: ['Owner', 'Manager'],
    })),
}));

const admin = require('firebase-admin');
const pitchGenerator = require('../api/pitchGenerator');

// ============================================
// TEST DATA FIXTURES
// ============================================

const TYPICAL_BUSINESS_INPUTS = {
    businessName: 'Acme Auto Repair',
    contactName: 'John Smith',
    address: '123 Main St, Springfield, IL 62701',
    websiteUrl: 'https://acmeautorepair.com',
    googleRating: 4.5,
    numReviews: 127,
    industry: 'Automotive',
    subIndustry: 'Auto Repair',
    statedProblem: 'getting more customers from online searches',
    monthlyVisits: 200,
    avgTransaction: 450,
    repeatRate: 0.2,
};

const TYPICAL_REVIEW_DATA = {
    sentiment: { positive: 78, neutral: 15, negative: 7 },
    topThemes: ['Quick service', 'Fair pricing', 'Honest mechanics', 'Clean facility'],
    staffMentions: ['Mike', 'Sarah'],
    differentiators: ['Family-owned since 1985', 'Same-day service'],
    analytics: null,
    pitchMetrics: null,
};

const TYPICAL_ROI_DATA = {
    monthlyVisits: 200,
    monthlyCustomers: 200,
    newCustomers: 40,
    improvedVisits: 240,
    improvedCustomers: 240,
    avgTicket: 450,
    monthlyIncrementalRevenue: 21600,
    sixMonthRevenue: 129600,
    roi: 1186,
    growthRate: 20,
    industryName: 'Automotive Services',
};

const TYPICAL_SELLER_PROFILE = {
    companyProfile: {
        companyName: 'GrowthTech Solutions',
        industry: 'SaaS',
        companySize: '10-50',
        websiteUrl: 'https://growthtech.io',
    },
    products: [
        { name: 'ReviewBoost', description: 'Automated review collection', pricing: '$99/mo', isPrimary: true },
        { name: 'LocalRank', description: 'SEO optimization suite', pricing: '$79/mo', isPrimary: false },
        { name: 'ChatAssist', description: 'AI customer support', pricing: '$149/mo', isPrimary: false },
    ],
    branding: {
        primaryColor: '#2563EB',
        accentColor: '#F59E0B',
        logoUrl: 'https://growthtech.io/logo.png',
        tone: 'professional',
    },
    valueProposition: {
        uniqueSellingPoints: [
            'Increase reviews by 300% in 90 days',
            'AI-powered response suggestions',
            'Real-time competitor monitoring',
        ],
        keyBenefits: [
            'More 5-star reviews',
            'Higher search rankings',
            'Reduced response time',
        ],
        differentiator: 'The only platform with patented sentiment analysis',
    },
    icp: {
        painPoints: [
            'Low online visibility',
            'Few customer reviews',
            'Manual follow-up processes',
        ],
        targetIndustries: ['Automotive', 'Healthcare', 'Home Services'],
        companySizes: ['1-10', '10-50'],
        decisionMakers: ['Owner', 'Marketing Manager'],
    },
};

const TYPICAL_MARKET_DATA = {
    opportunityScore: 78,
    opportunityLevel: 'High',
    saturation: 'Medium',
    competitorCount: 23,
    marketSize: '$4.2M annually',
    growthRate: '8.5% YoY',
    demographics: {
        medianIncome: 62000,
        population: 125000,
        medianAge: 38,
    },
    recommendations: [
        'Focus on mobile-friendly presence',
        'Target homeowners aged 35-55',
        'Emphasize same-day service',
    ],
    seasonality: {
        peakMonths: ['March', 'April', 'October'],
        slowMonths: ['December', 'January'],
    },
    industry: {
        naicsCode: '811111',
        avgTransaction: 450,
        monthlyCustomers: 200,
    },
};

const TYPICAL_TRIGGER_EVENT = {
    headline: 'Acme Auto Repair Wins "Best of Springfield" Award',
    summary: 'Local auto shop recognized for exceptional customer service and community involvement.',
    source: 'Springfield Business Journal',
    url: 'https://example.com/news/acme-award',
    eventType: 'award',
    keyPoints: [
        'Voted #1 by local residents',
        'Known for transparent pricing',
        'Supports local charity events',
    ],
    usage: {
        email: 'congratulatory',
        linkedin: 'celebratory',
        pitch: 'credibility_boost',
    },
};

const DEFAULT_OPTIONS = {
    bookingUrl: null,
    hideBranding: false,
    primaryColor: '#3A6746',
    accentColor: '#D4A847',
    companyName: 'PathSynch',
    contactEmail: 'hello@pathsynch.com',
    logoUrl: null,
    sellerContext: null,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function createMockRequest(body, params = {}, userId = 'test-user-123') {
    return {
        body,
        params,
        userId,
    };
}

function createMockResponse() {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
    return res;
}

function setupFirestoreMocks(options = {}) {
    const {
        userExists = true,
        userTier = 'growth',
        pitchCount = 0, // Default to 0 so tests pass limit check
        sellerProfile = null,
    } = options;

    // Reset all mock implementations
    mockDb.get.mockReset();
    mockDb.set.mockReset();
    mockDb.update.mockReset();
    mockDb.collection.mockReset();
    mockDb.doc.mockReset();
    mockDb.where.mockReset();
    mockDb.limit.mockReset();

    // Track collection calls to differentiate between 'users' and 'pitches'
    let currentCollection = null;
    let isWhereQuery = false;

    mockDb.collection.mockImplementation((collectionName) => {
        currentCollection = collectionName;
        isWhereQuery = false;
        return mockDb;
    });

    mockDb.doc.mockImplementation(() => mockDb);

    mockDb.where.mockImplementation(() => {
        isWhereQuery = true;
        return mockDb;
    });

    mockDb.limit.mockImplementation(() => mockDb);

    // Mock get based on context
    mockDb.get.mockImplementation(() => {
        // If this was a where query on pitches collection, return pitch count
        if (isWhereQuery && currentCollection === 'pitches') {
            return Promise.resolve({
                size: pitchCount,
                empty: pitchCount === 0,
                docs: [],
            });
        }

        // Otherwise it's a user document query
        if (!userExists) {
            return Promise.resolve({ exists: false });
        }
        return Promise.resolve({
            exists: true,
            data: () => ({
                email: 'test@example.com',
                displayName: 'Test User',
                subscription: { plan: userTier },
                sellerProfile: sellerProfile,
            }),
        });
    });

    // Mock write operations
    mockDb.set.mockResolvedValue({});
    mockDb.update.mockResolvedValue({});

    return mockDb;
}

// ============================================
// TEST SUITES
// ============================================

describe('pitchGenerator.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ----------------------------------------
    // LEVEL 1: OUTREACH SEQUENCES
    // ----------------------------------------
    describe('generateLevel1', () => {
        test('generates valid HTML with typical inputs', () => {
            const html = pitchGenerator.generateLevel1(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify it's valid HTML
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('</html>');

            // Verify business name appears
            expect(html).toContain('Acme Auto Repair');

            // Verify contact name appears
            expect(html).toContain('John Smith');

            // Verify industry context
            expect(html).toContain('Automotive');

            // Verify email sequence structure
            expect(html).toContain('Email Sequence');
            expect(html).toContain('Day 1');
            expect(html).toContain('Day 4');
            expect(html).toContain('Day 8');

            // Verify LinkedIn sequence structure
            expect(html).toContain('LinkedIn Sequence');
            expect(html).toContain('Day 2');
            expect(html).toContain('Day 5');
            expect(html).toContain('Day 9');

            // Verify Google rating appears
            expect(html).toContain('4.5');

            // Verify ROI data is used
            expect(html).toContain('20%'); // growth rate
        });

        test('generates Level 1 with trigger event data', () => {
            const inputsWithTrigger = {
                ...TYPICAL_BUSINESS_INPUTS,
                triggerEvent: TYPICAL_TRIGGER_EVENT,
            };

            const html = pitchGenerator.generateLevel1(
                inputsWithTrigger,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify trigger event is incorporated in email
            expect(html).toContain('Trigger-Based');
            expect(html).toContain('Best of Springfield');
            expect(html).toContain('congratulations');
        });

        test('uses custom branding colors', () => {
            const customOptions = {
                ...DEFAULT_OPTIONS,
                primaryColor: '#FF5733',
                accentColor: '#33FF57',
            };

            const html = pitchGenerator.generateLevel1(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                customOptions,
                null,
                'test-pitch-id'
            );

            expect(html).toContain('#FF5733');
            expect(html).toContain('#33FF57');
        });

        test('hides branding when hideBranding is true', () => {
            const options = {
                ...DEFAULT_OPTIONS,
                hideBranding: true,
            };

            const html = pitchGenerator.generateLevel1(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                options,
                null,
                'test-pitch-id'
            );

            // Should not contain "Powered by PathSynch"
            expect(html).not.toContain('Powered by PathSynch');
        });
    });

    // ----------------------------------------
    // LEVEL 2: ONE-PAGER
    // ----------------------------------------
    describe('generateLevel2', () => {
        test('generates valid HTML with typical inputs', () => {
            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify it's valid HTML
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('</html>');

            // Verify business name appears
            expect(html).toContain('Acme Auto Repair');

            // Verify one-pager specific elements
            expect(html).toContain('Opportunity Brief');
            expect(html).toContain('The Opportunity');
            expect(html).toContain('What Customers Love');

            // Verify stats row
            expect(html).toContain('Google Rating');
            expect(html).toContain('New Customers/Mo');
            expect(html).toContain('Monthly Revenue');
            expect(html).toContain('Projected ROI');

            // Verify CTA section
            expect(html).toContain('Ready to Grow');
        });

        test('generates Level 2 with seller profile (custom products)', () => {
            const optionsWithSeller = {
                ...DEFAULT_OPTIONS,
                sellerContext: {
                    companyName: 'GrowthTech Solutions',
                    primaryColor: '#2563EB',
                    accentColor: '#F59E0B',
                    products: [
                        { name: 'ReviewBoost', desc: 'Automated review collection', icon: '⭐' },
                        { name: 'LocalRank', desc: 'SEO optimization suite', icon: '📍' },
                    ],
                    uniqueSellingPoints: ['Increase reviews by 300%'],
                    keyBenefits: ['More 5-star reviews'],
                    isDefault: false,
                },
            };

            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                optionsWithSeller,
                null,
                'test-pitch-id'
            );

            // Verify custom company name
            expect(html).toContain('GrowthTech Solutions');

            // Verify custom products
            expect(html).toContain('ReviewBoost');
            expect(html).toContain('LocalRank');

            // Verify custom colors
            expect(html).toContain('#2563EB');
            expect(html).toContain('#F59E0B');
        });

        test('generates Level 2 with trigger event (green card injection)', () => {
            const inputsWithTrigger = {
                ...TYPICAL_BUSINESS_INPUTS,
                triggerEvent: TYPICAL_TRIGGER_EVENT,
            };

            const html = pitchGenerator.generateLevel2(
                inputsWithTrigger,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify trigger event card is injected
            expect(html).toContain('Why We\'re Reaching Out');
            expect(html).toContain('Best of Springfield');
            expect(html).toContain('Congratulations');

            // Verify it has the green styling
            expect(html).toContain('#f0fdf4'); // Light green background
            expect(html).toContain('#166534'); // Dark green text
        });

        test('uses booking URL for CTA when provided', () => {
            const optionsWithBooking = {
                ...DEFAULT_OPTIONS,
                bookingUrl: 'https://calendly.com/growthtech/demo',
            };

            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                optionsWithBooking,
                null,
                'test-pitch-id'
            );

            expect(html).toContain('https://calendly.com/growthtech/demo');
            expect(html).toContain('Book a Demo');
        });

        test('generates Level 2 with review analytics data', () => {
            const enrichedReviewData = {
                ...TYPICAL_REVIEW_DATA,
                analytics: {
                    volume: { total: 127, monthly: 8 },
                    quality: { avgRating: 4.5, distributionPct: { 5: 65, 4: 20, 3: 10, 2: 3, 1: 2 } },
                },
                pitchMetrics: {
                    headline: { score: 85, label: 'Excellent' },
                    keyMetrics: ['127 reviews', '4.5 avg rating'],
                },
            };

            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                enrichedReviewData,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Should still generate valid HTML with enhanced data
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Acme Auto Repair');
        });
    });

    // ----------------------------------------
    // LEVEL 3: ENTERPRISE DECK
    // ----------------------------------------
    describe('generateLevel3', () => {
        test('generates valid HTML with typical inputs', () => {
            const html = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify it's valid HTML
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('</html>');

            // Verify business name appears
            expect(html).toContain('Acme Auto Repair');

            // Verify slide structure (look for slide sections)
            // Note: slides have classes like "slide title-slide" or "slide closing-slide"
            expect(html).toMatch(/class="slide[\s\w-]*"/);
            expect(html).toContain('title-slide');

            // Verify key slides exist (actual slide titles from generator)
            expect(html).toContain('Growth Challenges');
            expect(html).toContain('Projected ROI');
            expect(html).toContain('Recommended Next Steps');

            // Verify enterprise-specific elements
            expect(html).toContain('Enterprise Pitch');
        });

        test('generates Level 3 with full market intelligence', () => {
            const html = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                TYPICAL_MARKET_DATA,
                'test-pitch-id'
            );

            // Verify market data is incorporated
            expect(html).toContain('Market Intelligence');
            expect(html).toContain('Opportunity Score');
            expect(html).toContain('78'); // opportunity score

            // Verify competitor data
            expect(html).toContain('23'); // competitor count

            // Verify demographics if shown
            expect(html).toMatch(/62[,\s]*000|median.*income/i);
        });

        test('generates Level 3 with trigger event (dedicated slide)', () => {
            const inputsWithTrigger = {
                ...TYPICAL_BUSINESS_INPUTS,
                triggerEvent: TYPICAL_TRIGGER_EVENT,
            };

            const html = pitchGenerator.generateLevel3(
                inputsWithTrigger,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify trigger event appears in the deck
            expect(html).toContain('Best of Springfield');
            expect(html).toContain('Springfield Business Journal');
        });

        test('generates Level 3 with seller context', () => {
            const optionsWithSeller = {
                ...DEFAULT_OPTIONS,
                sellerContext: {
                    companyName: 'GrowthTech Solutions',
                    primaryColor: '#2563EB',
                    accentColor: '#F59E0B',
                    products: [
                        { name: 'ReviewBoost', desc: 'Automated review collection', icon: '⭐' },
                        { name: 'LocalRank', desc: 'SEO optimization suite', icon: '📍' },
                        { name: 'ChatAssist', desc: 'AI customer support', icon: '🤖' },
                    ],
                    uniqueSellingPoints: ['Increase reviews by 300%', 'AI-powered insights'],
                    keyBenefits: ['More 5-star reviews', 'Higher rankings'],
                    isDefault: false,
                },
            };

            const html = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                optionsWithSeller,
                null,
                'test-pitch-id'
            );

            // Verify custom company branding
            expect(html).toContain('GrowthTech Solutions');
            expect(html).toContain('#2563EB');

            // Verify custom products appear
            expect(html).toContain('ReviewBoost');
            expect(html).toContain('LocalRank');
            expect(html).toContain('ChatAssist');
        });

        test('generates correct slide count based on data availability', () => {
            // Without market data or review analytics - base 10 slides
            const htmlBasic = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // With market data - should have 11 slides
            const htmlWithMarket = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                TYPICAL_MARKET_DATA,
                'test-pitch-id'
            );

            // Count slide numbers in the output
            const basicSlideCount = (htmlBasic.match(/class="slide-number"/g) || []).length;
            const marketSlideCount = (htmlWithMarket.match(/class="slide-number"/g) || []).length;

            expect(marketSlideCount).toBeGreaterThanOrEqual(basicSlideCount);
        });

        test('includes donut chart for sentiment visualization', () => {
            const html = pitchGenerator.generateLevel3(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Verify donut chart CSS is present
            expect(html).toContain('donut');
            expect(html).toContain('conic-gradient');
        });
    });

    // ----------------------------------------
    // EDGE CASES
    // ----------------------------------------
    describe('Edge Cases', () => {
        test('handles missing optional fields gracefully', () => {
            const minimalInputs = {
                businessName: 'Test Business',
                industry: 'Retail',
                // All other fields missing
            };

            const minimalReviewData = {
                sentiment: { positive: 65, neutral: 25, negative: 10 },
                topThemes: [],
                staffMentions: [],
                differentiators: [],
            };

            const minimalRoiData = {
                monthlyVisits: 200,
                newCustomers: 40,
                avgTicket: 50,
                monthlyIncrementalRevenue: 2400,
                sixMonthRevenue: 14400,
                roi: 100,
                growthRate: 20,
            };

            // All three levels should generate without throwing
            expect(() => {
                pitchGenerator.generateLevel1(minimalInputs, minimalReviewData, minimalRoiData, DEFAULT_OPTIONS);
            }).not.toThrow();

            expect(() => {
                pitchGenerator.generateLevel2(minimalInputs, minimalReviewData, minimalRoiData, DEFAULT_OPTIONS);
            }).not.toThrow();

            expect(() => {
                pitchGenerator.generateLevel3(minimalInputs, minimalReviewData, minimalRoiData, DEFAULT_OPTIONS);
            }).not.toThrow();
        });

        test('handles empty seller profile (uses defaults)', () => {
            const optionsWithEmptySeller = {
                ...DEFAULT_OPTIONS,
                sellerContext: null,
            };

            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                optionsWithEmptySeller,
                null,
                'test-pitch-id'
            );

            // Should fall back to PathSynch defaults
            expect(html).toContain('PathSynch');
        });

        test('handles null review data', () => {
            const html = pitchGenerator.generateLevel2(
                TYPICAL_BUSINESS_INPUTS,
                null, // null review data
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Should still generate valid HTML with defaults
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Acme Auto Repair');
        });

        test('handles extreme values (very high rating)', () => {
            const extremeInputs = {
                ...TYPICAL_BUSINESS_INPUTS,
                googleRating: 5.0,
                numReviews: 10000,
            };

            const html = pitchGenerator.generateLevel2(
                extremeInputs,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            expect(html).toContain('5');
            expect(html).toContain('10000');
        });

        test('handles extreme values (very low rating)', () => {
            const extremeInputs = {
                ...TYPICAL_BUSINESS_INPUTS,
                googleRating: 2.1,
                numReviews: 3,
            };

            const lowRatingReviewData = {
                ...TYPICAL_REVIEW_DATA,
                sentiment: { positive: 30, neutral: 25, negative: 45 },
            };

            const html = pitchGenerator.generateLevel2(
                extremeInputs,
                lowRatingReviewData,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Should adapt messaging for low rating
            expect(html).toContain('2.1');
            expect(html).toContain('growth opportunity');
        });

        test('handles special characters in business name', () => {
            const specialInputs = {
                ...TYPICAL_BUSINESS_INPUTS,
                businessName: 'Joe\'s "Best" Auto & Repair <Shop>',
            };

            const html = pitchGenerator.generateLevel1(
                specialInputs,
                TYPICAL_REVIEW_DATA,
                TYPICAL_ROI_DATA,
                DEFAULT_OPTIONS,
                null,
                'test-pitch-id'
            );

            // Should contain the business name (may be escaped)
            expect(html).toContain('Joe');
            expect(html).toContain('Auto');
        });

        test('handles empty trigger event gracefully', () => {
            const inputsWithEmptyTrigger = {
                ...TYPICAL_BUSINESS_INPUTS,
                triggerEvent: {
                    headline: '',
                    summary: '',
                    keyPoints: [],
                },
            };

            // Should not throw
            expect(() => {
                pitchGenerator.generateLevel2(
                    inputsWithEmptyTrigger,
                    TYPICAL_REVIEW_DATA,
                    TYPICAL_ROI_DATA,
                    DEFAULT_OPTIONS,
                    null,
                    'test-pitch-id'
                );
            }).not.toThrow();
        });
    });

    // ----------------------------------------
    // API HANDLERS (with mocked Firestore)
    // ----------------------------------------
    describe('API Handlers', () => {
        describe('generatePitch', () => {
            test('creates pitch and returns pitchId', async () => {
                setupFirestoreMocks({ userTier: 'growth', pitchCount: 5 });

                const req = createMockRequest({
                    businessName: 'Test Business',
                    industry: 'Retail',
                    googleRating: 4.5,
                    numReviews: 100,
                    pitchLevel: 2,
                });
                const res = createMockResponse();

                await pitchGenerator.generatePitch(req, res);

                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        pitchId: expect.any(String),
                        shareId: expect.any(String),
                        level: 2,
                    })
                );
            });

            test('enforces pitch limit for free tier', async () => {
                setupFirestoreMocks({ userTier: 'free', pitchCount: 5 });

                const req = createMockRequest({
                    businessName: 'Test Business',
                    industry: 'Retail',
                    pitchLevel: 2,
                });
                const res = createMockResponse();

                await pitchGenerator.generatePitch(req, res);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: 'PITCH_LIMIT_REACHED',
                    })
                );
            });

            test('allows unlimited pitches for scale tier', async () => {
                setupFirestoreMocks({ userTier: 'scale', pitchCount: 1000 });

                const req = createMockRequest({
                    businessName: 'Test Business',
                    industry: 'Retail',
                    pitchLevel: 2,
                });
                const res = createMockResponse();

                await pitchGenerator.generatePitch(req, res);

                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                    })
                );
            });

            test('uses seller profile from user document', async () => {
                setupFirestoreMocks({
                    userTier: 'growth',
                    pitchCount: 5,
                    sellerProfile: TYPICAL_SELLER_PROFILE,
                });

                const req = createMockRequest({
                    businessName: 'Test Business',
                    industry: 'Retail',
                    pitchLevel: 2,
                });
                const res = createMockResponse();

                await pitchGenerator.generatePitch(req, res);

                expect(res.status).toHaveBeenCalledWith(200);
            });
        });

        describe('getPitch', () => {
            test('returns pitch data for valid pitchId', async () => {
                const mockDb = admin.firestore();
                mockDb.get.mockResolvedValueOnce({
                    exists: true,
                    data: () => ({
                        pitchId: 'test-pitch-123',
                        businessName: 'Test Business',
                        html: '<html>...</html>',
                    }),
                });

                const req = createMockRequest({}, { pitchId: 'test-pitch-123' });
                const res = createMockResponse();

                await pitchGenerator.getPitch(req, res);

                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        data: expect.objectContaining({
                            businessName: 'Test Business',
                        }),
                    })
                );
            });

            test('returns 404 for non-existent pitch', async () => {
                const mockDb = admin.firestore();
                mockDb.get.mockResolvedValueOnce({
                    exists: false,
                });

                const req = createMockRequest({}, { pitchId: 'non-existent' });
                const res = createMockResponse();

                await pitchGenerator.getPitch(req, res);

                expect(res.status).toHaveBeenCalledWith(404);
            });

            test('returns 400 for missing pitchId', async () => {
                const req = createMockRequest({}, {});
                const res = createMockResponse();

                await pitchGenerator.getPitch(req, res);

                expect(res.status).toHaveBeenCalledWith(400);
            });
        });

        describe('getSharedPitch', () => {
            test('returns pitch data for valid shareId', async () => {
                const mockDb = admin.firestore();
                mockDb.limit.mockReturnValueOnce({
                    get: () => Promise.resolve({
                        empty: false,
                        docs: [{
                            id: 'test-pitch-123',
                            data: () => ({
                                shareId: 'share-abc',
                                businessName: 'Shared Business',
                                html: '<html>...</html>',
                            }),
                        }],
                    }),
                });

                const req = createMockRequest({}, { shareId: 'share-abc' });
                const res = createMockResponse();

                await pitchGenerator.getSharedPitch(req, res);

                expect(res.status).toHaveBeenCalledWith(200);
            });

            test('returns 404 for non-existent shareId', async () => {
                const mockDb = admin.firestore();
                mockDb.limit.mockReturnValueOnce({
                    get: () => Promise.resolve({
                        empty: true,
                        docs: [],
                    }),
                });

                const req = createMockRequest({}, { shareId: 'non-existent' });
                const res = createMockResponse();

                await pitchGenerator.getSharedPitch(req, res);

                expect(res.status).toHaveBeenCalledWith(404);
            });
        });

        describe('generatePitchDirect', () => {
            test('generates pitch without HTTP response', async () => {
                setupFirestoreMocks({ userTier: 'growth' });

                const result = await pitchGenerator.generatePitchDirect(
                    {
                        businessName: 'Bulk Business',
                        industry: 'Retail',
                        googleRating: 4.2,
                        numReviews: 50,
                        pitchLevel: 2,
                    },
                    'bulk-user-123'
                );

                expect(result.success).toBe(true);
                expect(result.pitchId).toBeDefined();
                expect(result.shareId).toBeDefined();
            });
        });
    });

    // ----------------------------------------
    // ROI CALCULATOR
    // ----------------------------------------
    describe('calculateROI', () => {
        test('calculates ROI correctly', () => {
            const roi = pitchGenerator.calculateROI({
                monthlyVisits: 200,
                avgTransaction: 100,
            });

            expect(roi).toHaveProperty('monthlyIncrementalRevenue');
            expect(roi).toHaveProperty('sixMonthRevenue');
            expect(roi).toHaveProperty('roi');
            expect(roi).toHaveProperty('newCustomers');

            // Basic sanity checks
            expect(roi.monthlyIncrementalRevenue).toBeGreaterThan(0);
            expect(roi.sixMonthRevenue).toBe(roi.monthlyIncrementalRevenue * 6);
            expect(roi.roi).toBeGreaterThan(0);
        });
    });

    // ----------------------------------------
    // MODULE EXPORTS
    // ----------------------------------------
    describe('Module Exports', () => {
        test('exports all required functions', () => {
            expect(typeof pitchGenerator.generatePitch).toBe('function');
            expect(typeof pitchGenerator.generatePitchDirect).toBe('function');
            expect(typeof pitchGenerator.getPitch).toBe('function');
            expect(typeof pitchGenerator.getSharedPitch).toBe('function');
            expect(typeof pitchGenerator.generateLevel1).toBe('function');
            expect(typeof pitchGenerator.generateLevel2).toBe('function');
            expect(typeof pitchGenerator.generateLevel3).toBe('function');
            expect(typeof pitchGenerator.calculateROI).toBe('function');
        });
    });
});
