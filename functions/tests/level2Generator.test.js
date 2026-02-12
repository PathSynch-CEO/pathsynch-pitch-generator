/**
 * Unit Tests for pitch/level2Generator.js
 *
 * Tests Level 2 One-Pager HTML generation.
 */

const { generateLevel2 } = require('../api/pitch/level2Generator');

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
    formatCurrency: jest.fn((val) => val.toLocaleString())
}));

describe('pitch/level2Generator', () => {
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
        staffMentions: ['Maria', 'Carlos']
    };

    const mockRoiData = {
        growthRate: 25,
        newCustomers: 45,
        monthlyIncrementalRevenue: 8500,
        sixMonthRevenue: 51000,
        roi: 340
    };

    describe('generateLevel2', () => {
        test('generates valid HTML document', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html lang="en">');
            expect(html).toContain('</html>');
        });

        test('includes business name in title and header', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<title>Test Business');
            expect(html).toContain('<h1>Test Business</h1>');
        });

        test('includes industry information', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Restaurants');
        });

        test('includes Google rating and review count', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('4.5');
            expect(html).toContain('150');
        });

        test('includes ROI data in stats row', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('+45'); // new customers
            expect(html).toContain('340%'); // ROI
        });

        test('includes top themes from review data', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Great food');
            expect(html).toContain('Fast service');
        });

        test('includes staff mentions when provided', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Maria');
            expect(html).toContain('Carlos');
        });

        test('includes CTA tracking script', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, {}, null, 'test-pitch-123');

            expect(html).toContain('window.trackCTA');
            expect(html).toContain('test-pitch-123');
        });

        test('uses default branding when no options provided', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch');
            expect(html).toContain('#3A6746'); // default primary color
        });

        test('uses custom branding colors', () => {
            const options = {
                primaryColor: '#FF0000',
                accentColor: '#00FF00'
            };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('#FF0000');
            expect(html).toContain('#00FF00');
        });

        test('hides branding when hideBranding is true', () => {
            const options = { hideBranding: true };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).not.toContain('Powered by');
            // Note: analytics URL (cloudfunctions.net) is always present, only the footer branding is hidden
        });

        test('includes booking URL when provided', () => {
            const options = { bookingUrl: 'https://calendly.com/test' };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('https://calendly.com/test');
            expect(html).toContain('Book a Demo');
        });

        test('uses mailto fallback when no booking URL', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('mailto:');
            expect(html).toContain('Schedule Your Demo');
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
            const html = generateLevel2(inputsWithTrigger, mockReviewData, mockRoiData);

            expect(html).toContain('New Location Opening');
            expect(html).toContain('Expanding to downtown area');
            expect(html).toContain("Why We're Reaching Out");
        });

        test('uses sellerContext for custom company name', () => {
            const options = {
                sellerContext: {
                    companyName: 'Acme Corp',
                    primaryColor: '#123456'
                }
            };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Acme Corp');
        });

        test('uses sellerContext products when available', () => {
            const options = {
                sellerContext: {
                    companyName: 'Custom Co',
                    products: [
                        { name: 'Product A', desc: 'Description A', icon: '🎯' },
                        { name: 'Product B', desc: 'Description B', icon: '📊' }
                    ]
                }
            };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Product A');
            expect(html).toContain('Description A');
        });

        test('includes custom footer text when provided', () => {
            const options = { footerText: 'Custom footer message here' };
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Custom footer message here');
        });

        test('includes print styles', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('@media print');
            expect(html).toContain('print-color-adjust');
        });

        test('includes responsive styles', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('@media (max-width: 768px)');
        });

        test('uses default values for missing inputs', () => {
            const minimalInputs = {};
            const html = generateLevel2(minimalInputs, null, mockRoiData);

            expect(html).toContain('Your Business');
            expect(html).toContain('local business');
        });

        test('handles missing review data gracefully', () => {
            const html = generateLevel2(mockInputs, null, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            // Should use default themes
            expect(html).toContain('Quality service');
        });

        test('includes pain points from industry intelligence', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Customer acquisition');
            expect(html).toContain('Online visibility');
        });

        test('includes KPIs from industry intelligence', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Customer growth');
        });

        test('sets correct pitch level for CTA tracking', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('data-pitch-level="2"');
        });

        test('includes top bar with download and CTA buttons', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('class="top-bar"');
            expect(html).toContain('Download PDF');
        });

        test('generates opportunity analysis based on rating', () => {
            const html = generateLevel2(mockInputs, mockReviewData, mockRoiData);

            // 4.5 rating should show positive message
            expect(html).toContain('customers love you');
        });

        test('generates different opportunity message for lower ratings', () => {
            const lowRatingInputs = { ...mockInputs, googleRating: 3.2 };
            const html = generateLevel2(lowRatingInputs, mockReviewData, mockRoiData);

            expect(html).toContain('room for improvement');
        });
    });
});
