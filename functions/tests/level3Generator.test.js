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
});
