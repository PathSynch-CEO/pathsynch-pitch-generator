/**
 * Unit Tests for pitch/level3/slides.js
 *
 * Tests individual slide builder functions for Level 3 Enterprise Deck.
 */

const {
    getTotalSlides,
    getSlideNumber,
    buildTitleSlide,
    buildTriggerEventSlide,
    buildWhatMakesThemSpecialSlide,
    buildReviewHealthSlide,
    buildGrowthChallengesSlide,
    buildSolutionSlide,
    buildProjectedRoiSlide,
    buildMarketIntelligenceSlide,
    buildProductStrategySlide,
    buildRolloutSlide,
    buildInvestmentSlide,
    buildNextStepsSlide,
    buildClosingCtaSlide
} = require('../api/pitch/level3/slides');

// Helper to create minimal context object
function createMockContext(overrides = {}) {
    return {
        businessName: 'Test Business',
        industry: 'Restaurants',
        googleRating: 4.5,
        numReviews: 150,
        companyName: 'PathSynch',
        statedProblem: 'getting more customers',
        inputs: {
            triggerEvent: null,
            address: '123 Main St'
        },
        options: {
            sellerContext: {
                isDefault: true,
                products: [
                    { name: 'Product A', desc: 'Description A', price: '$99' },
                    { name: 'Product B', desc: 'Description B', price: '$149' }
                ]
            }
        },
        hasReviewAnalytics: false,
        hasMarketData: false,
        sentiment: { positive: 75, neutral: 15, negative: 10 },
        topThemes: ['Great food', 'Fast service', 'Friendly staff', 'Good value'],
        staffMentions: ['Maria', 'Carlos'],
        differentiators: ['Quality ingredients', 'Fast delivery', 'Great prices'],
        salesIntel: {
            painPoints: ['Customer acquisition', 'Online visibility', 'Review management', 'Local competition'],
            primaryKPIs: ['Customer growth', 'Revenue per customer', 'Review count', 'Repeat rate'],
            decisionMakers: ['Owner', 'Manager'],
            topChannels: ['Google Business Profile', 'Yelp', 'Facebook']
        },
        roiData: {
            monthlyVisits: 200,
            avgTicket: 50,
            newCustomers: 40,
            growthRate: 20,
            repeatRate: 25,
            monthlyIncrementalRevenue: 2500,
            sixMonthRevenue: 15000,
            sixMonthCost: 1008,
            roi: 340
        },
        truncateText: (text, limit) => text ? text.substring(0, limit) : '',
        CONTENT_LIMITS: {
            differentiator: 100,
            uspItem: 50,
            productName: 30,
            productDesc: 60,
            benefitItem: 50
        },
        formatCurrency: (val) => (val || 0).toLocaleString(),
        hideBranding: false,
        contactEmail: 'hello@pathsynch.com',
        customFooterText: '',
        bookingUrl: null,
        ctaUrl: 'mailto:hello@pathsynch.com',
        ctaText: 'Get Started',
        pitchId: 'test-pitch-123',
        // Review health fields
        volumeData: { totalReviews: 150, last7Days: 5, last30Days: 20, reviewsPerMonth: 15, velocityTrend: 'stable' },
        reviewHealthScore: 75,
        reviewHealthLabel: 'Good',
        reviewKeyMetrics: [{ label: 'Average Rating', value: '4.5', trend: true, trendValue: 0.2 }],
        reviewCriticalIssues: [],
        reviewOpportunities: [{ title: 'Response Time', message: 'Could improve' }],
        reviewStrengths: [{ title: 'Food Quality', message: 'Consistently praised' }],
        reviewRecommendation: 'Focus on review velocity',
        // Market data fields
        opportunityScore: 85,
        saturation: 'medium',
        competitorCount: 12,
        marketSize: 5000000,
        growthRate: 8,
        demographics: { medianIncome: 75000 },
        opportunityLevel: 'high',
        marketRecommendations: { targetCustomer: 'Young professionals' },
        seasonality: { isInPeakSeason: false, pattern: 'Weekend peak' },
        companySizeInfo: { planningHorizon: 'Quarterly' },
        ...overrides
    };
}

describe('pitch/level3/slides', () => {
    describe('getTotalSlides', () => {
        test('returns 10 for base slides without conditionals', () => {
            const ctx = createMockContext();
            expect(getTotalSlides(ctx)).toBe(10);
        });

        test('returns 11 when hasReviewAnalytics is true', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            expect(getTotalSlides(ctx)).toBe(11);
        });

        test('returns 11 when hasMarketData is true', () => {
            const ctx = createMockContext({ hasMarketData: true });
            expect(getTotalSlides(ctx)).toBe(11);
        });

        test('returns 11 when triggerEvent exists', () => {
            const ctx = createMockContext({
                inputs: { triggerEvent: { headline: 'News' } }
            });
            expect(getTotalSlides(ctx)).toBe(11);
        });

        test('returns 12 when two conditionals are true', () => {
            const ctx = createMockContext({
                hasReviewAnalytics: true,
                hasMarketData: true
            });
            expect(getTotalSlides(ctx)).toBe(12);
        });

        test('returns 13 when all conditionals are true', () => {
            const ctx = createMockContext({
                hasReviewAnalytics: true,
                hasMarketData: true,
                inputs: { triggerEvent: { headline: 'News' } }
            });
            expect(getTotalSlides(ctx)).toBe(13);
        });
    });

    describe('getSlideNumber', () => {
        test('title slide is always 1', () => {
            const ctx = createMockContext();
            expect(getSlideNumber(ctx, 'title')).toBe(1);
        });

        test('trigger slide is always 2', () => {
            const ctx = createMockContext();
            expect(getSlideNumber(ctx, 'trigger')).toBe(2);
        });

        test('whatMakesSpecial is 2 without trigger, 3 with trigger', () => {
            const ctxNoTrigger = createMockContext();
            expect(getSlideNumber(ctxNoTrigger, 'whatMakesSpecial')).toBe(2);

            const ctxWithTrigger = createMockContext({
                inputs: { triggerEvent: { headline: 'News' } }
            });
            expect(getSlideNumber(ctxWithTrigger, 'whatMakesSpecial')).toBe(3);
        });

        test('growthChallenges accounts for trigger and reviewAnalytics', () => {
            // No conditionals: 3
            expect(getSlideNumber(createMockContext(), 'growthChallenges')).toBe(3);

            // With trigger: 4
            expect(getSlideNumber(createMockContext({
                inputs: { triggerEvent: { headline: 'News' } }
            }), 'growthChallenges')).toBe(4);

            // With review analytics: 4
            expect(getSlideNumber(createMockContext({
                hasReviewAnalytics: true
            }), 'growthChallenges')).toBe(4);

            // With both: 5
            expect(getSlideNumber(createMockContext({
                inputs: { triggerEvent: { headline: 'News' } },
                hasReviewAnalytics: true
            }), 'growthChallenges')).toBe(5);
        });

        test('closing slide accounts for all conditionals', () => {
            // Base: 10
            expect(getSlideNumber(createMockContext(), 'closing')).toBe(10);

            // All conditionals: 13
            expect(getSlideNumber(createMockContext({
                inputs: { triggerEvent: { headline: 'News' } },
                hasReviewAnalytics: true,
                hasMarketData: true
            }), 'closing')).toBe(13);
        });

        test('returns 1 for unknown slide ID', () => {
            const ctx = createMockContext();
            expect(getSlideNumber(ctx, 'unknownSlide')).toBe(1);
        });
    });

    describe('buildTitleSlide', () => {
        test('includes business name in h1', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('<h1>Test Business</h1>');
        });

        test('shows default subtitle without trigger event', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('Customer Engagement & Growth Strategy');
        });

        test('shows timely opportunity subtitle with trigger event', () => {
            const ctx = createMockContext({
                inputs: { triggerEvent: { headline: 'News' } }
            });
            const html = buildTitleSlide(ctx);
            expect(html).toContain('Timely Opportunity Brief');
        });

        test('includes Google rating and review count', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('4.5 Google Rating');
            expect(html).toContain('150 Reviews');
        });

        test('includes industry in meta', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('Restaurants');
        });

        test('includes company name', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('PathSynch');
        });

        test('includes correct slide number', () => {
            const ctx = createMockContext();
            const html = buildTitleSlide(ctx);
            expect(html).toContain('1 / 10');
        });

        test('shows logo image when logoUrl provided', () => {
            const ctx = createMockContext({
                options: {
                    sellerContext: {
                        logoUrl: 'https://example.com/logo.png',
                        isDefault: true
                    }
                }
            });
            const html = buildTitleSlide(ctx);
            expect(html).toContain('<img src="https://example.com/logo.png"');
        });
    });

    describe('buildTriggerEventSlide', () => {
        test('returns empty string when no trigger event', () => {
            const ctx = createMockContext();
            const html = buildTriggerEventSlide(ctx);
            expect(html).toBe('');
        });

        test('renders slide when trigger event exists', () => {
            const ctx = createMockContext({
                inputs: {
                    triggerEvent: {
                        headline: 'Company Expansion',
                        summary: 'Opening new location downtown'
                    }
                }
            });
            const html = buildTriggerEventSlide(ctx);
            expect(html).toContain('Why We\'re Reaching Out Now');
            expect(html).toContain('Company Expansion');
            expect(html).toContain('Opening new location downtown');
        });

        test('includes key points when provided', () => {
            const ctx = createMockContext({
                inputs: {
                    triggerEvent: {
                        headline: 'News',
                        keyPoints: ['Increase visibility', 'Capture new market']
                    }
                }
            });
            const html = buildTriggerEventSlide(ctx);
            expect(html).toContain('Increase visibility');
            expect(html).toContain('Capture new market');
        });

        test('includes source when provided', () => {
            const ctx = createMockContext({
                inputs: {
                    triggerEvent: {
                        headline: 'News',
                        source: 'Local Business Journal'
                    }
                }
            });
            const html = buildTriggerEventSlide(ctx);
            expect(html).toContain('Source: Local Business Journal');
        });

        test('uses default headline when not provided', () => {
            const ctx = createMockContext({
                inputs: {
                    triggerEvent: { summary: 'Just the summary' }
                }
            });
            const html = buildTriggerEventSlide(ctx);
            expect(html).toContain('Recent News');
        });
    });

    describe('buildWhatMakesThemSpecialSlide', () => {
        test('includes business name', () => {
            const ctx = createMockContext();
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('What Makes Test Business Special');
        });

        test('includes sentiment percentages', () => {
            const ctx = createMockContext();
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('75%');
            expect(html).toContain('15%');
            expect(html).toContain('10%');
        });

        test('includes top themes', () => {
            const ctx = createMockContext();
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('Great food');
            expect(html).toContain('Fast service');
        });

        test('shows staff highlights when staffMentions provided', () => {
            const ctx = createMockContext();
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('Staff Highlights');
            expect(html).toContain('Maria');
            expect(html).toContain('Carlos');
        });

        test('shows differentiators when no staff mentions', () => {
            const ctx = createMockContext({ staffMentions: [] });
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('Key Differentiators');
            expect(html).toContain('Quality ingredients');
        });

        test('includes review count in intro', () => {
            const ctx = createMockContext();
            const html = buildWhatMakesThemSpecialSlide(ctx);
            expect(html).toContain('150 Google reviews');
        });
    });

    describe('buildReviewHealthSlide', () => {
        test('returns empty string when no review analytics', () => {
            const ctx = createMockContext({ hasReviewAnalytics: false });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toBe('');
        });

        test('renders slide when review analytics available', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('Review Health Analysis');
        });

        test('includes health score', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('75');
            expect(html).toContain('Review Health Score');
        });

        test('uses green gradient for high score (>=70)', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true, reviewHealthScore: 80 });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('#22c55e');
        });

        test('uses yellow gradient for medium score (50-69)', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true, reviewHealthScore: 60 });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('#f59e0b');
        });

        test('uses red gradient for low score (<50)', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true, reviewHealthScore: 40 });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('#ef4444');
        });

        test('includes key metrics', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('Average Rating');
            expect(html).toContain('4.5');
        });

        test('shows strengths when available', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('Strengths');
            expect(html).toContain('Food Quality');
        });

        test('shows review velocity when no strengths', () => {
            const ctx = createMockContext({
                hasReviewAnalytics: true,
                reviewStrengths: []
            });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('Review Velocity');
            expect(html).toContain('Last 7 days');
        });

        test('includes recommendation when provided', () => {
            const ctx = createMockContext({ hasReviewAnalytics: true });
            const html = buildReviewHealthSlide(ctx);
            expect(html).toContain('Focus on review velocity');
        });
    });

    describe('buildGrowthChallengesSlide', () => {
        test('includes industry in intro', () => {
            const ctx = createMockContext();
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('Restaurants businesses today');
        });

        test('includes discovery challenges', () => {
            const ctx = createMockContext();
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('Limited online visibility');
            expect(html).toContain('Competitors outranking in search');
        });

        test('includes industry pain points from salesIntel', () => {
            const ctx = createMockContext();
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('Customer acquisition');
            expect(html).toContain('Online visibility');
        });

        test('includes KPIs from salesIntel', () => {
            const ctx = createMockContext();
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('Customer growth');
            expect(html).toContain('Revenue per customer');
        });

        test('includes stated problem in core issue box', () => {
            const ctx = createMockContext();
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('getting more customers');
        });

        test('uses default problem text when not provided', () => {
            const ctx = createMockContext({ statedProblem: '' });
            const html = buildGrowthChallengesSlide(ctx);
            expect(html).toContain('Great businesses often struggle with visibility');
        });
    });

    describe('buildSolutionSlide', () => {
        test('includes company name', () => {
            const ctx = createMockContext();
            const html = buildSolutionSlide(ctx);
            expect(html).toContain('PathSynch: The Solution');
        });

        test('shows Ecosystem suffix for default seller', () => {
            const ctx = createMockContext();
            const html = buildSolutionSlide(ctx);
            expect(html).toContain('The Solution Ecosystem');
        });

        test('shows default PathSynch modules when isDefault', () => {
            const ctx = createMockContext();
            const html = buildSolutionSlide(ctx);
            expect(html).toContain('What It Does');
            expect(html).toContain('Captures reviews & feedback');
            expect(html).toContain('Key Modules');
        });

        test('shows custom seller content when not default', () => {
            const ctx = createMockContext({
                options: {
                    sellerContext: {
                        isDefault: false,
                        uniqueSellingPoints: ['Custom USP 1', 'Custom USP 2'],
                        products: [{ name: 'Custom Product', desc: 'Custom desc' }],
                        keyBenefits: ['Benefit 1', 'Benefit 2']
                    }
                }
            });
            const html = buildSolutionSlide(ctx);
            expect(html).toContain('Unique Value');
            expect(html).toContain('Custom USP 1');
        });
    });

    describe('buildProjectedRoiSlide', () => {
        test('includes business name', () => {
            const ctx = createMockContext();
            const html = buildProjectedRoiSlide(ctx);
            expect(html).toContain('Test Business: Projected ROI');
        });

        test('includes baseline metrics', () => {
            const ctx = createMockContext();
            const html = buildProjectedRoiSlide(ctx);
            expect(html).toContain('200 monthly customers');
            expect(html).toContain('$50 average transaction');
            expect(html).toContain('150 existing Google reviews');
        });

        test('includes growth projections', () => {
            const ctx = createMockContext();
            const html = buildProjectedRoiSlide(ctx);
            expect(html).toContain('+40 new customers/month');
            expect(html).toContain('(+20%)');
            expect(html).toContain('25% of new customers return');
        });

        test('includes ROI calculation', () => {
            const ctx = createMockContext();
            const html = buildProjectedRoiSlide(ctx);
            expect(html).toContain('ROI: 340%');
            expect(html).toContain('6-Month Revenue');
        });

        test('formats currency values', () => {
            const ctx = createMockContext();
            const html = buildProjectedRoiSlide(ctx);
            expect(html).toContain('2,500');
        });
    });

    describe('buildMarketIntelligenceSlide', () => {
        test('returns empty string when no market data', () => {
            const ctx = createMockContext({ hasMarketData: false });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toBe('');
        });

        test('renders slide when market data available', () => {
            const ctx = createMockContext({ hasMarketData: true });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('Market Intelligence');
        });

        test('includes opportunity score', () => {
            const ctx = createMockContext({ hasMarketData: true });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('85');
            expect(html).toContain('Opportunity Score');
        });

        test('includes market snapshot metrics', () => {
            const ctx = createMockContext({ hasMarketData: true });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('Medium');
            expect(html).toContain('12 competitors');
            expect(html).toContain('$5.0M');
            expect(html).toContain('8%');
        });

        test('includes median income when available', () => {
            const ctx = createMockContext({ hasMarketData: true });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('$75K');
        });

        test('shows high opportunity message', () => {
            const ctx = createMockContext({ hasMarketData: true, opportunityLevel: 'high' });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('High opportunity market with room for growth');
        });

        test('includes seasonality when available', () => {
            const ctx = createMockContext({ hasMarketData: true });
            const html = buildMarketIntelligenceSlide(ctx);
            expect(html).toContain('Seasonality');
            expect(html).toContain('Weekend peak');
        });
    });

    describe('buildProductStrategySlide', () => {
        test('shows Product Strategy title for default seller', () => {
            const ctx = createMockContext();
            const html = buildProductStrategySlide(ctx);
            expect(html).toContain('Product Strategy: Integrated Approach');
        });

        test('shows Implementation Strategy for custom seller', () => {
            const ctx = createMockContext({
                options: { sellerContext: { isDefault: false } }
            });
            const html = buildProductStrategySlide(ctx);
            expect(html).toContain('PathSynch Implementation Strategy');
        });

        test('shows three pillars for default seller', () => {
            const ctx = createMockContext();
            const html = buildProductStrategySlide(ctx);
            expect(html).toContain('Pillar 1: Discovery');
            expect(html).toContain('Pillar 2: Engagement');
            expect(html).toContain('Pillar 3: Retention');
        });

        test('includes PathSynch product names for default', () => {
            const ctx = createMockContext();
            const html = buildProductStrategySlide(ctx);
            expect(html).toContain('PathConnect');
            expect(html).toContain('LocalSynch');
            expect(html).toContain('QRSynch');
        });
    });

    describe('buildRolloutSlide', () => {
        test('includes Recommended title', () => {
            const ctx = createMockContext();
            const html = buildRolloutSlide(ctx);
            expect(html).toContain('Recommended 90-Day Rollout');
        });

        test('shows three phases', () => {
            const ctx = createMockContext();
            const html = buildRolloutSlide(ctx);
            expect(html).toContain('Phase 1: Days 1-30');
            expect(html).toContain('Phase 2: Days 31-60');
            expect(html).toContain('Phase 3: Days 61-90');
        });

        test('includes phase titles', () => {
            const ctx = createMockContext();
            const html = buildRolloutSlide(ctx);
            expect(html).toContain('Foundation');
            expect(html).toContain('Expansion');
            expect(html).toContain('Optimization');
        });

        test('shows PathSynch products for default seller', () => {
            const ctx = createMockContext();
            const html = buildRolloutSlide(ctx);
            expect(html).toContain('PathConnect setup');
            expect(html).toContain('QRSynch campaigns');
            expect(html).toContain('PathManager analytics');
        });
    });

    describe('buildInvestmentSlide', () => {
        test('includes business name', () => {
            const ctx = createMockContext();
            const html = buildInvestmentSlide(ctx);
            expect(html).toContain('PathSynch Package for Test Business');
        });

        test('includes default pricing', () => {
            const ctx = createMockContext();
            const html = buildInvestmentSlide(ctx);
            expect(html).toContain('$168');
            expect(html).toContain('per month');
        });

        test('uses custom pricing when provided', () => {
            const ctx = createMockContext({
                options: {
                    sellerContext: {
                        isDefault: true,
                        pricing: '$299',
                        pricingPeriod: 'per year'
                    }
                }
            });
            const html = buildInvestmentSlide(ctx);
            expect(html).toContain('$299');
            expect(html).toContain('per year');
        });

        test('includes benefit list for default seller', () => {
            const ctx = createMockContext();
            const html = buildInvestmentSlide(ctx);
            expect(html).toContain('All core modules included');
            expect(html).toContain('Dedicated onboarding');
            expect(html).toContain('Priority support');
        });

        test('shows Complete Platform Bundle for default', () => {
            const ctx = createMockContext();
            const html = buildInvestmentSlide(ctx);
            expect(html).toContain('Complete Platform Bundle');
        });
    });

    describe('buildNextStepsSlide', () => {
        test('includes section title', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('Recommended Next Steps');
        });

        test('shows immediate and short-term columns', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('Immediate (This Week)');
            expect(html).toContain('Short-Term (Next 2-4 Weeks)');
        });

        test('includes 6 step boxes', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('1. Schedule');
            expect(html).toContain('2. Review pricing');
            expect(html).toContain('3. Connect with decision maker');
            expect(html).toContain('4. Pilot period');
            expect(html).toContain('5. Staff training');
            expect(html).toContain('6. Top channels');
        });

        test('includes decision makers from salesIntel', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('Owner');
            expect(html).toContain('Manager');
        });

        test('includes top channels from salesIntel', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('Google Business Profile');
            expect(html).toContain('Yelp');
        });

        test('includes 30-day goal', () => {
            const ctx = createMockContext();
            const html = buildNextStepsSlide(ctx);
            expect(html).toContain('By Day 30');
        });
    });

    describe('buildClosingCtaSlide', () => {
        test('includes business name', () => {
            const ctx = createMockContext();
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('Let\'s Unlock Test Business\'s Potential');
        });

        test('includes CTA button with correct URL', () => {
            const ctx = createMockContext();
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('href="mailto:hello@pathsynch.com"');
            expect(html).toContain('Get Started');
        });

        test('uses booking URL when provided', () => {
            const ctx = createMockContext({
                bookingUrl: 'https://calendly.com/test',
                ctaUrl: 'https://calendly.com/test',
                ctaText: 'Book a Demo'
            });
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('href="https://calendly.com/test"');
            expect(html).toContain('Book a Demo');
            expect(html).toContain('data-cta-type="book_demo"');
        });

        test('shows contact CTA type when no booking URL', () => {
            const ctx = createMockContext();
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('data-cta-type="contact"');
        });

        test('includes company name and email when branding shown', () => {
            const ctx = createMockContext({ hideBranding: false });
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('PathSynch');
            expect(html).toContain('hello@pathsynch.com');
        });

        test('hides company info when hideBranding is true', () => {
            const ctx = createMockContext({ hideBranding: true });
            const html = buildClosingCtaSlide(ctx);
            // Email still appears in mailto ctaUrl, but branding paragraph should be hidden
            expect(html).not.toContain('<strong>PathSynch</strong>');
            expect(html).not.toContain('opacity: 0.9;">hello@pathsynch.com</span>');
        });

        test('includes custom footer text when provided', () => {
            const ctx = createMockContext({ customFooterText: 'Custom footer here' });
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('Custom footer here');
        });

        test('includes tracking attributes', () => {
            const ctx = createMockContext();
            const html = buildClosingCtaSlide(ctx);
            expect(html).toContain('data-pitch-level="3"');
            expect(html).toContain('data-segment="Restaurants"');
            expect(html).toContain('onclick="window.trackCTA');
        });
    });
});
