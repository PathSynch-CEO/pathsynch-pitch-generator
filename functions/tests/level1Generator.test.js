/**
 * Unit Tests for pitch/level1Generator.js
 *
 * Tests Level 1 Outreach Sequences HTML generation.
 */

const { generateLevel1 } = require('../api/pitch/level1Generator');

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

describe('pitch/level1Generator', () => {
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

    describe('generateLevel1', () => {
        test('generates valid HTML document', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html lang="en">');
            expect(html).toContain('</html>');
        });

        test('includes business name in title and header', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('<title>Outreach Sequence: Test Business</title>');
            expect(html).toContain('Outreach Sequence: Test Business');
        });

        test('includes contact name', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Multi-channel approach for John Doe');
            expect(html).toContain('Hi John Doe');
        });

        test('includes industry information', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Restaurants');
            expect(html).toContain('Sales Intelligence: Restaurants - Fast Casual');
        });

        test('includes Google rating and review count', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('4.5');
            expect(html).toContain('150');
        });

        test('includes ROI data in email content', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('+25%'); // growth rate
            expect(html).toContain('340%'); // ROI
            expect(html).toContain('45'); // new customers
        });

        test('includes Email Sequence section with 3 emails', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Email Sequence');
            expect(html).toContain('3 emails over 8 days');
            expect(html).toContain('Day 1');
            expect(html).toContain('Day 4');
            expect(html).toContain('Day 8');
            expect(html).toContain('Initial Outreach');
            expect(html).toContain('Value-Add Follow-up');
            expect(html).toContain('Final Touch');
        });

        test('includes LinkedIn Sequence section with 3 messages', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('LinkedIn Sequence');
            expect(html).toContain('Connection + 2 follow-ups');
            expect(html).toContain('Day 2');
            expect(html).toContain('Day 5');
            expect(html).toContain('Day 9');
            expect(html).toContain('Connection Request');
            expect(html).toContain('Post-Connection Message');
            expect(html).toContain('Insight Share');
        });

        test('includes Sales Intelligence section', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Sales Intelligence');
            expect(html).toContain('Decision Makers:');
            expect(html).toContain('Owner, Manager');
            expect(html).toContain('Key Pain Points:');
            expect(html).toContain('Customer acquisition');
            expect(html).toContain('KPIs They Track:');
            expect(html).toContain('Top Channels:');
        });

        test('includes Personalization Notes section', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Personalization Notes');
            expect(html).toContain('Review highlights:');
            expect(html).toContain('Stated problem:');
            expect(html).toContain('ROI hook:');
        });

        test('includes top themes from review data', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Great food');
            expect(html).toContain('Fast service');
        });

        test('includes staff mentions when provided', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Staff mentions:');
            expect(html).toContain('Maria');
            expect(html).toContain('Carlos');
        });

        test('uses default branding when no options provided', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('PathSynch');
            expect(html).toContain('#3A6746'); // default primary color
            expect(html).toContain('Powered by');
        });

        test('uses custom branding colors', () => {
            const options = {
                primaryColor: '#FF0000',
                accentColor: '#00FF00'
            };
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('#FF0000');
            expect(html).toContain('#00FF00');
        });

        test('hides branding when hideBranding is true', () => {
            const options = { hideBranding: true };
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).not.toContain('Powered by');
        });

        test('includes trigger event when provided', () => {
            const inputsWithTrigger = {
                ...mockInputs,
                triggerEvent: {
                    headline: 'New Location Opening',
                    summary: 'Expanding to downtown area'
                }
            };
            const html = generateLevel1(inputsWithTrigger, mockReviewData, mockRoiData);

            expect(html).toContain('Initial Outreach (Trigger-Based)');
            expect(html).toContain('New Location Opening');
            expect(html).toContain('Expanding to downtown area');
            expect(html).toContain('congratulations');
        });

        test('uses sellerContext for custom company name', () => {
            const options = {
                sellerContext: {
                    companyName: 'Acme Corp',
                    primaryColor: '#123456'
                }
            };
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Acme Corp');
        });

        test('includes custom footer text when provided', () => {
            const options = { footerText: 'Custom footer message here' };
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData, options);

            expect(html).toContain('Custom footer message here');
        });

        test('includes print styles', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('@media print');
        });

        test('uses default values for missing inputs', () => {
            const minimalInputs = {};
            const html = generateLevel1(minimalInputs, null, mockRoiData);

            expect(html).toContain('Your Business');
            expect(html).toContain('local business');
            expect(html).toContain('Hi there'); // default contactName
        });

        test('handles missing review data gracefully', () => {
            const html = generateLevel1(mockInputs, null, mockRoiData);

            expect(html).toContain('<!DOCTYPE html>');
            // Should show fallback message for review highlights
            expect(html).toContain('Mention specific positive feedback from their reviews');
        });

        test('includes pain points from industry intelligence', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Customer acquisition');
            expect(html).toContain('Online visibility');
        });

        test('includes KPIs from industry intelligence', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Customer growth');
        });

        test('includes stated problem in final email', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('getting more customers');
        });

        test('handles subIndustry display correctly', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('Fast Casual');
        });

        test('omits subIndustry when not provided', () => {
            const inputsNoSub = { ...mockInputs, subIndustry: null };
            const html = generateLevel1(inputsNoSub, mockReviewData, mockRoiData);

            expect(html).toContain('Sales Intelligence: Restaurants');
            expect(html).not.toContain('Sales Intelligence: Restaurants -');
        });

        test('omits staff mentions section when not provided', () => {
            const reviewDataNoStaff = { ...mockReviewData, staffMentions: [] };
            const html = generateLevel1(mockInputs, reviewDataNoStaff, mockRoiData);

            expect(html).not.toContain('Staff mentions:');
        });

        test('uses industry-specific pain points in email copy', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            // keyPainPoint is used in email body
            expect(html).toContain('customer acquisition');
        });

        test('includes six month revenue in personalization notes', () => {
            const html = generateLevel1(mockInputs, mockReviewData, mockRoiData);

            expect(html).toContain('51,000'); // formatted sixMonthRevenue
        });
    });
});
