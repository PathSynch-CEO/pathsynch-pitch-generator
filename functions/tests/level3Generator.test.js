/**
 * Unit Tests for pitch/level3Generator.js
 *
 * Tests Level 3 Enterprise Deck HTML generation.
 */

const { generateLevel3 } = require('../api/pitch/level3Generator');

// Mock dependencies
jest.mock('../config/industryIntelligence', () => ({
    getIndustryIntelligence: jest.fn(() => ({
        decisionMakers: ['Owner', 'Manager'],
        painPoints: ['Customer acquisition', 'Online visibility', 'Review management', 'Local competition'],
        primaryKPIs: ['Customer growth', 'Revenue per customer', 'Review count'],
        topChannels: ['Google Business Profile', 'Yelp', 'Facebook']
    }))
}));

jest.mock('../utils/roiCalculator', () => ({
    formatCurrency: jest.fn((val) => (val || 0).toLocaleString())
}));

describe('pitch/level3Generator', () => {
    const mockInputs = {
        businessName: 'Test Business',
        contactName: 'John Doe',
        industry: 'Restaurants',
        subIndustry: 'Fast Casual',
        statedProblem: 'getting more customers',
        numReviews: 150,
        googleRating: 4.5
    };

    const mockReviewData = {
        sentiment: { positive: 75, neutral: 15, negative: 10 },
        topThemes: ['Great food', 'Fast service', 'Friendly staff', 'Good value'],
        staffMentions: ['Maria', 'Carlos'],
        differentiators: ['Fresh ingredients', 'Fast service'],
        analytics: {
            volume: { totalReviews: 150, reviewsPerMonth: 15 },
            quality: { avgRating: 4.5, distributionPct: { 5: 60, 4: 25, 3: 10, 2: 3, 1: 2 } },
            response: { responseRate: 0.45, avgResponseTime: 24 }
        },
        pitchMetrics: {
            headline: { score: 85, label: 'Strong' },
            keyMetrics: [{ label: 'Review Growth', value: '+15/mo' }],
            criticalIssues: [],
            opportunities: ['Increase response rate'],
            strengths: ['High rating', 'Good volume'],
            recommendation: 'Focus on review responses'
        }
    };

    const mockRoiData = {
        growthRate: 25,
        newCustomers: 45,
        monthlyIncrementalRevenue: 8500,
        sixMonthRevenue: 51000,
        roi: 340
    };

    describe('generateLevel3', () => {
        test('generates valid HTML document', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html lang="en">');
            expect(html).toContain('</html>');
        });

        test('includes business name in title and content', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<title>Test Business');
            expect(html).toContain('Test Business');
        });

        test('includes industry information', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Restaurants');
        });

        test('includes Google rating and review count', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('4.5');
            expect(html).toContain('150');
        });

        test('includes ROI data', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('340'); // ROI percentage
        });

        test('includes top themes from review data', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Great food');
            expect(html).toContain('Fast service');
        });

        test('includes CTA tracking script', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, {}, null, 'test-pitch-123');

            expect(html).toContain('window.trackCTA');
            expect(html).toContain('test-pitch-123');
        });

        test('uses default branding when no options provided', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch');
            expect(html).toContain('#3A6746'); // default primary color
        });

        test('uses custom branding colors', () => {
            const options = {
                primaryColor: '#FF0000',
                accentColor: '#00FF00'
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('#FF0000');
            expect(html).toContain('#00FF00');
        });

        test('hides branding when hideBranding is true', () => {
            const options = { hideBranding: true };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).not.toContain('Powered by');
        });

        test('includes booking URL when provided', () => {
            const options = { bookingUrl: 'https://calendly.com/test' };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('https://calendly.com/test');
            expect(html).toContain('Book a Demo');
        });

        test('uses mailto fallback when no booking URL', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('mailto:');
            expect(html).toContain('Schedule Demo');
        });

        test('includes trigger event when provided', () => {
            const inputsWithTrigger = {
                ...mockInputs,
                triggerEvent: {
                    headline: 'New Location Opening',
                    summary: 'Expanding to downtown area',
                    keyPoints: ['Increase visibility', 'Build local presence'],
                    source: 'Local News'
                }
            };
            const html = generateLevel3(inputsWithTrigger, mockReviewData, mockRoiData);

            expect(html).toContain('New Location Opening');
            expect(html).toContain('Expanding to downtown area');
        });

        test('uses sellerContext for custom company name', () => {
            const options = {
                sellerContext: {
                    companyName: 'Acme Corp',
                    primaryColor: '#123456'
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Acme Corp');
        });

        test('uses sellerContext products when available', () => {
            const options = {
                sellerContext: {
                    companyName: 'Custom Co',
                    products: [
                        { name: 'Product A', desc: 'Description A', icon: 'icon-a' },
                        { name: 'Product B', desc: 'Description B', icon: 'icon-b' }
                    ]
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Product A');
            expect(html).toContain('Description A');
        });

        test('includes print styles', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('@media print');
        });

        test('uses default values for missing inputs', () => {
            const minimalInputs = {};
            const html = generateLevel3(minimalInputs, null, mockRoiData);

            expect(html).toContain('Your Business');
            expect(html).toContain('local business');
        });

        test('handles missing review data gracefully', () => {
            const html = generateLevel3(mockInputs, null, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            // Should use default themes
            expect(html).toContain('Quality products');
        });

        test('includes pain points from industry intelligence', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Customer acquisition');
            expect(html).toContain('Online visibility');
        });

        test('includes donut chart for sentiment visualization', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('donut-chart');
            // Check for sentiment percentages
            expect(html).toContain('75%'); // positive
        });

        test('includes market intelligence when provided', () => {
            const marketData = {
                opportunityScore: 85,
                opportunityLevel: 'High',
                saturation: 'Moderate',
                competitorCount: 12,
                marketSize: 500000,
                growthRate: 5.2
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, {}, marketData);

            expect(html).toContain('85');
            expect(html).toContain('Market Intelligence');
        });

        test('includes multiple slides', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // Should have multiple slides for enterprise deck
            // Slides have class="slide" with potential modifiers like "slide content-slide"
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBeGreaterThanOrEqual(8);
        });

        test('includes 90-Day Rollout section', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('90-Day Rollout');
        });

        test('includes ROI projection section', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('ROI');
        });

        test('sets correct pitch level for CTA tracking', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('data-pitch-level="3"');
        });

        test('generates opportunity analysis based on rating', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // High rating should have positive messaging
            expect(html.toLowerCase()).toContain('review');
        });

        test('includes review health section when analytics available', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // With review analytics, should show health metrics
            expect(html).toContain('Review Health');
        });

        test('includes next steps section', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Next Steps');
        });

        test('includes packages or pricing section', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Package');
        });
    });

    // ============================================
    // SLIDE-SPECIFIC INTEGRATION TESTS
    // These tests verify each slide type renders correctly
    // ============================================
    describe('Slide 1: Title Slide', () => {
        test('renders title slide with business name', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('class="slide title-slide"');
            expect(html).toContain('<h1>Test Business</h1>');
        });

        test('shows subtitle based on trigger event presence', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);
            expect(html).toContain('Customer Engagement & Growth Strategy');

            const inputsWithTrigger = {
                ...mockInputs,
                triggerEvent: { headline: 'News', summary: 'Summary' }
            };
            const htmlWithTrigger = generateLevel3(inputsWithTrigger, mockReviewData, mockRoiData);
            expect(htmlWithTrigger).toContain('Timely Opportunity Brief');
        });

        test('displays Google rating and review count in meta', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('⭐ 4.5 Google Rating');
            expect(html).toContain('📝 150 Reviews');
            expect(html).toContain('🏢 Restaurants');
        });

        test('shows company logo when provided', () => {
            const options = {
                sellerContext: {
                    logoUrl: 'https://example.com/logo.png',
                    companyName: 'TestCo'
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('https://example.com/logo.png');
        });
    });

    describe('Slide 2: Trigger Event (conditional)', () => {
        test('does not render when no trigger event', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).not.toContain("Why We're Reaching Out Now");
        });

        test('renders trigger event slide when provided', () => {
            const inputsWithTrigger = {
                ...mockInputs,
                triggerEvent: {
                    headline: 'Grand Opening Announcement',
                    summary: 'New flagship store opening next month',
                    keyPoints: ['Expand market presence', 'Build brand awareness'],
                    source: 'Business Journal'
                }
            };
            const html = generateLevel3(inputsWithTrigger, mockReviewData, mockRoiData);

            expect(html).toContain("Why We're Reaching Out Now");
            expect(html).toContain('Grand Opening Announcement');
            expect(html).toContain('New flagship store opening next month');
            expect(html).toContain('Expand market presence');
            expect(html).toContain('Build brand awareness');
            expect(html).toContain('Source: Business Journal');
        });

        test('handles trigger event with missing optional fields', () => {
            const inputsWithMinimalTrigger = {
                ...mockInputs,
                triggerEvent: {
                    headline: 'Simple News'
                }
            };
            const html = generateLevel3(inputsWithMinimalTrigger, mockReviewData, mockRoiData);

            expect(html).toContain('Simple News');
            expect(html).toContain("Why We're Reaching Out Now");
        });
    });

    describe('Slide 3: What Makes Them Special', () => {
        test('renders sentiment donut chart', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('What Makes Test Business Special');
            expect(html).toContain('donut-chart');
            expect(html).toContain('75%'); // positive sentiment
        });

        test('displays sentiment legend with all three categories', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Positive 75%');
            expect(html).toContain('Neutral 15%');
            expect(html).toContain('Negative 10%');
        });

        test('shows customer themes', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('What Customers Say');
            expect(html).toContain('Great food');
            expect(html).toContain('Fast service');
        });

        test('shows staff highlights when provided', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Staff Highlights');
            expect(html).toContain('Maria');
            expect(html).toContain('Carlos');
        });

        test('shows differentiators when no staff mentions', () => {
            const reviewDataNoStaff = {
                ...mockReviewData,
                staffMentions: []
            };
            const html = generateLevel3(mockInputs, reviewDataNoStaff, mockRoiData);

            expect(html).toContain('Key Differentiators');
            expect(html).toContain('Fresh ingredients');
        });
    });

    describe('Slide 4: Review Health (conditional)', () => {
        test('renders when review analytics available', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Review Health Analysis');
            expect(html).toContain('Review Health Score');
            expect(html).toContain('85'); // health score
            expect(html).toContain('Strong'); // health label
        });

        test('shows key metrics', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Key Metrics');
            expect(html).toContain('Review Growth');
        });

        test('does not render when no review analytics', () => {
            const reviewDataBasic = {
                sentiment: { positive: 70, neutral: 20, negative: 10 },
                topThemes: ['Good service']
            };
            const html = generateLevel3(mockInputs, reviewDataBasic, mockRoiData);

            expect(html).not.toContain('Review Health Analysis');
        });
    });

    describe('Slide 5: Growth Challenges', () => {
        test('renders growth challenges section', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Growth Challenges');
            expect(html).toContain('Common barriers facing Restaurants businesses');
        });

        test('shows discovery challenges', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Discovery');
            expect(html).toContain('Limited online visibility');
            expect(html).toContain('Competitors outranking in search');
        });

        test('shows industry pain points from sales intelligence', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Industry Pain Points');
            expect(html).toContain('Customer acquisition');
            expect(html).toContain('Online visibility');
        });

        test('shows KPIs from sales intelligence', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Key KPIs to Track');
            expect(html).toContain('Customer growth');
        });

        test('displays stated problem in core issue box', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('The Core Issue:');
            expect(html).toContain('getting more customers');
        });
    });

    describe('Slide 6: Solution', () => {
        test('renders solution slide with company name', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch: The Solution');
        });

        test('shows default PathSynch modules when isDefault is true', () => {
            const options = {
                sellerContext: {
                    isDefault: true,
                    companyName: 'PathSynch'
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Captures reviews & feedback');
            expect(html).toContain('Builds Google Business Profile');
        });

        test('uses custom seller products when provided', () => {
            const options = {
                sellerContext: {
                    companyName: 'CustomCo',
                    products: [
                        { name: 'Widget Pro', desc: 'Advanced widget solution' },
                        { name: 'Service Plus', desc: 'Premium support package' }
                    ]
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Widget Pro');
            expect(html).toContain('Advanced widget solution');
        });
    });

    describe('Slide 7: Projected ROI', () => {
        test('renders ROI projection with business name', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Test Business: Projected ROI');
            expect(html).toContain('Conservative 6-month scenario');
        });

        test('shows current baseline assumptions', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Conservative Assumptions');
            expect(html).toContain('Current baseline');
        });

        test('displays ROI metrics', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Monthly Revenue from New Customers');
            expect(html).toContain('6-Month Revenue');
            expect(html).toContain('ROI: 340%');
        });

        test('shows new customer projections', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('+45 new customers/month');
            expect(html).toContain('+25%');
        });
    });

    describe('Slide 8: Market Intelligence (conditional)', () => {
        const mockMarketData = {
            opportunityScore: 78,
            opportunityLevel: 'High',
            saturation: 'moderate',
            competitorCount: 15,
            marketSize: 2500000,
            growthRate: 4.5,
            demographics: { medianIncome: 65000 },
            recommendations: ['Focus on reviews', 'Improve visibility']
        };

        test('does not render when no market data', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).not.toContain('Market Intelligence:');
        });

        test('renders market intelligence when data provided', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, {}, mockMarketData);

            expect(html).toContain('Market Intelligence');
            expect(html).toContain('Opportunity Score');
            expect(html).toContain('78');
        });

        test('shows market snapshot metrics', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, {}, mockMarketData);

            expect(html).toContain('Market Snapshot');
            expect(html).toContain('Competition');
            expect(html).toContain('15 competitors');
            expect(html).toContain('Market Size');
            expect(html).toContain('Growth Rate');
        });
    });

    describe('Slide 9: Product Strategy', () => {
        test('renders product strategy slide with default content', () => {
            const options = {
                sellerContext: {
                    isDefault: true,
                    companyName: 'PathSynch'
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Product Strategy: Integrated Approach');
        });

        test('renders implementation strategy for custom sellers', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // Without isDefault, shows Implementation Strategy
            expect(html).toContain('Implementation Strategy');
        });

        test('shows three pillars when isDefault is true', () => {
            const options = {
                sellerContext: {
                    isDefault: true,
                    companyName: 'PathSynch'
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Pillar 1: Discovery');
            expect(html).toContain('Pillar 2: Engagement');
            expect(html).toContain('Pillar 3: Retention');
        });

        test('uses custom products from seller context', () => {
            const options = {
                sellerContext: {
                    products: [
                        { name: 'Custom Product 1', desc: 'Description 1', icon: '🎯' },
                        { name: 'Custom Product 2', desc: 'Description 2', icon: '📊' }
                    ]
                }
            };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Custom Product 1');
            expect(html).toContain('Description 1');
        });
    });

    describe('Slide 10: 90-Day Rollout', () => {
        test('renders rollout slide with Recommended label', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Recommended');
            expect(html).toContain('90-Day Rollout');
        });

        test('shows three phases', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Days 1-30');
            expect(html).toContain('Days 31-60');
            expect(html).toContain('Days 61-90');
        });

        test('includes phase descriptions', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Foundation');
            expect(html).toContain('Growth');
            expect(html).toContain('Optimization');
        });
    });

    describe('Slide 11: Investment/Pricing', () => {
        test('renders investment slide with business name', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch Package for Test Business');
        });

        test('shows yellow line styling', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // Investment slide should have yellow-line class
            expect(html).toContain('class="yellow-line"');
        });

        test('displays pricing or package information', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Complete Package');
        });
    });

    describe('Slide 12: Next Steps', () => {
        test('renders next steps slide', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Recommended Next Steps');
        });

        test('shows immediate and short-term columns', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Immediate (This Week)');
            expect(html).toContain('Short-Term (Next 2-4 Weeks)');
        });

        test('includes specific action items', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Schedule');
            expect(html).toContain('demo');
        });

        test('shows 30-day goal statement', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Goal:');
            expect(html).toContain('Day 30');
        });
    });

    describe('Slide 13: Closing CTA', () => {
        test('renders closing slide with CTA', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('closing-slide');
            expect(html).toContain("Let's Unlock Test Business's Potential");
        });

        test('shows default mailto CTA when no booking URL', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('mailto:');
            expect(html).toContain('Schedule Demo');
        });

        test('shows booking URL when provided', () => {
            const options = { bookingUrl: 'https://calendly.com/testbiz' };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('https://calendly.com/testbiz');
            expect(html).toContain('Book a Demo');
        });

        test('includes CTA tracking attributes', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('data-cta-type="contact"');
            expect(html).toContain('data-pitch-level="3"');
            expect(html).toContain('onclick="window.trackCTA');
        });

        test('displays company contact info', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch');
            expect(html).toContain('hello@pathsynch.com');
        });
    });

    describe('Slide count and numbering', () => {
        test('has correct slide count without conditionals', () => {
            const reviewDataBasic = {
                sentiment: { positive: 70, neutral: 20, negative: 10 },
                topThemes: ['Good']
            };
            const html = generateLevel3(mockInputs, reviewDataBasic, mockRoiData);

            // Without review analytics or market data: 10 slides
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBe(10);
        });

        test('has correct slide count with review analytics', () => {
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData);

            // With review analytics but no market data: 11 slides
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBe(11);
        });

        test('has correct slide count with market data', () => {
            const reviewDataBasic = {
                sentiment: { positive: 70, neutral: 20, negative: 10 },
                topThemes: ['Good']
            };
            const marketData = { opportunityScore: 80 };
            const html = generateLevel3(mockInputs, reviewDataBasic, mockRoiData, {}, marketData);

            // Without review analytics but with market data: 11 slides
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBe(11);
        });

        test('has correct slide count with all conditionals', () => {
            const marketData = { opportunityScore: 80 };
            const html = generateLevel3(mockInputs, mockReviewData, mockRoiData, {}, marketData);

            // With review analytics AND market data: 12 slides
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBe(12);
        });

        test('has correct slide count with trigger event', () => {
            const inputsWithTrigger = {
                ...mockInputs,
                triggerEvent: { headline: 'News', summary: 'Details' }
            };
            const marketData = { opportunityScore: 80 };
            const html = generateLevel3(inputsWithTrigger, mockReviewData, mockRoiData, {}, marketData);

            // With trigger event, review analytics, AND market data: 13 slides
            const slideCount = (html.match(/<section class="slide/g) || []).length;
            expect(slideCount).toBe(13);
        });
    });
});
