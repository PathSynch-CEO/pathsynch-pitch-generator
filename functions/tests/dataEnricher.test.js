/**
 * Unit Tests for pitch/dataEnricher.js
 *
 * Tests seller context building, pre-call form enhancement, and input enrichment.
 */

// Mock firebase-admin before requiring the module
let mockDb;

jest.mock('firebase-admin', () => {
    mockDb = {
        collection: jest.fn(function() { return this; }),
        doc: jest.fn(function() { return this; }),
        get: jest.fn(),
    };

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

// Mock precallForm service (path is relative to the module being tested)
jest.mock('../services/precallForm', () => ({
    mapResponsesToPitchData: jest.fn((responses) => ({
        urgency: responses.timeline === 'immediately' ? 'high' : 'medium',
        stakeholders: ['Owner'],
    })),
}));

const {
    buildSellerContext,
    getPrecallFormEnhancement,
    enhanceInputsWithPrecallData
} = require('../api/pitch/dataEnricher');

describe('pitch/dataEnricher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('buildSellerContext', () => {
        test('returns PathSynch defaults when no seller profile', () => {
            const context = buildSellerContext(null);

            expect(context.companyName).toBe('PathSynch');
            expect(context.isDefault).toBe(true);
            expect(context.primaryColor).toBe('#3A6746');
            expect(context.accentColor).toBe('#D4A847');
            expect(context.products.length).toBe(6);
            expect(context.products[0].name).toBe('PathConnect');
        });

        test('returns PathSynch defaults when seller profile missing companyName', () => {
            const context = buildSellerContext({
                companyProfile: {},
            });

            expect(context.companyName).toBe('PathSynch');
            expect(context.isDefault).toBe(true);
        });

        test('builds context from valid seller profile', () => {
            const sellerProfile = {
                companyProfile: {
                    companyName: 'Acme Corp',
                    industry: 'SaaS',
                    companySize: '50-100',
                    websiteUrl: 'https://acme.com',
                },
                products: [
                    { name: 'Product A', description: 'First product', pricing: '$99/mo', isPrimary: true },
                    { name: 'Product B', description: 'Second product', pricing: '$49/mo' },
                ],
                branding: {
                    primaryColor: '#FF0000',
                    accentColor: '#00FF00',
                    logoUrl: 'https://acme.com/logo.png',
                    tone: 'casual',
                },
                valueProposition: {
                    uniqueSellingPoints: ['Fast', 'Reliable'],
                    keyBenefits: ['Save time', 'Save money'],
                    differentiator: 'Best in class',
                },
                icp: {
                    painPoints: ['Manual processes', 'High costs'],
                    targetIndustries: ['Tech', 'Finance'],
                },
            };

            const context = buildSellerContext(sellerProfile);

            expect(context.companyName).toBe('Acme Corp');
            expect(context.isDefault).toBe(false);
            expect(context.primaryColor).toBe('#FF0000');
            expect(context.accentColor).toBe('#00FF00');
            expect(context.products.length).toBe(2);
            expect(context.products[0].name).toBe('Product A');
            expect(context.pricing).toBe('$148'); // 99 + 49
            expect(context.uniqueSellingPoints).toEqual(['Fast', 'Reliable']);
            expect(context.targetPainPoints).toEqual(['Manual processes', 'High costs']);
            expect(context.logoUrl).toBe('https://acme.com/logo.png');
        });

        test('handles multi-ICP structure with icpId', () => {
            const sellerProfile = {
                companyProfile: {
                    companyName: 'Multi ICP Corp',
                },
                icps: [
                    { id: 'icp-1', name: 'Small Business', painPoints: ['Cost'], isDefault: false },
                    { id: 'icp-2', name: 'Enterprise', painPoints: ['Scale'], isDefault: true },
                ],
            };

            // Without icpId - should use default
            const contextDefault = buildSellerContext(sellerProfile);
            expect(contextDefault.icpName).toBe('Enterprise');
            expect(contextDefault.targetPainPoints).toEqual(['Scale']);

            // With specific icpId
            const contextSpecific = buildSellerContext(sellerProfile, 'icp-1');
            expect(contextSpecific.icpName).toBe('Small Business');
            expect(contextSpecific.targetPainPoints).toEqual(['Cost']);
        });

        test('falls back to first ICP if no default and no icpId match', () => {
            const sellerProfile = {
                companyProfile: {
                    companyName: 'Test Corp',
                },
                icps: [
                    { id: 'icp-1', name: 'First ICP', painPoints: ['Issue 1'] },
                    { id: 'icp-2', name: 'Second ICP', painPoints: ['Issue 2'] },
                ],
            };

            const context = buildSellerContext(sellerProfile, 'non-existent-id');
            expect(context.icpName).toBe('First ICP');
        });

        test('calculates pricing from products correctly', () => {
            const sellerProfile = {
                companyProfile: { companyName: 'Test' },
                products: [
                    { name: 'A', pricing: '$100' },
                    { name: 'B', pricing: '$50.50' },
                    { name: 'C', pricing: null },
                ],
            };

            const context = buildSellerContext(sellerProfile);
            expect(context.pricing).toBe('$150.5');
        });

        test('uses "Contact for pricing" when no valid pricing', () => {
            const sellerProfile = {
                companyProfile: { companyName: 'Test' },
                products: [
                    { name: 'A', pricing: null },
                    { name: 'B', pricing: '$0' },
                ],
            };

            const context = buildSellerContext(sellerProfile);
            expect(context.pricing).toBe('Contact for pricing');
        });
    });

    describe('getPrecallFormEnhancement', () => {
        test('returns null for null precallFormId', async () => {
            const result = await getPrecallFormEnhancement(null, 'user-123');
            expect(result).toBeNull();
        });

        test('returns null when form not found', async () => {
            mockDb.get.mockResolvedValueOnce({ exists: false });

            const result = await getPrecallFormEnhancement('form-123', 'user-123');
            expect(result).toBeNull();
        });

        test('returns null for ownership mismatch', async () => {
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    userId: 'different-user',
                    status: 'completed',
                    responses: {},
                }),
            });

            const result = await getPrecallFormEnhancement('form-123', 'user-123');
            expect(result).toBeNull();
        });

        test('returns null for incomplete form', async () => {
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    userId: 'user-123',
                    status: 'pending',
                    responses: null,
                }),
            });

            const result = await getPrecallFormEnhancement('form-123', 'user-123');
            expect(result).toBeNull();
        });

        test('returns enhancement data for valid completed form', async () => {
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    userId: 'user-123',
                    status: 'completed',
                    prospectName: 'John Doe',
                    prospectEmail: 'john@example.com',
                    completedAt: new Date(),
                    responses: {
                        challenge: 'Need more customers',
                        timeline: 'immediately',
                        budget: '$500-1000',
                        current_solution: ['Manual outreach'],
                        priority_features: ['Automation', 'Analytics'],
                    },
                }),
            });

            const result = await getPrecallFormEnhancement('form-123', 'user-123');

            expect(result).not.toBeNull();
            expect(result.formId).toBe('form-123');
            expect(result.prospectName).toBe('John Doe');
            expect(result.prospectChallenge).toBe('Need more customers');
            expect(result.prospectCurrentSolution).toEqual(['Manual outreach']);
            expect(result.prospectPriorityFeatures).toEqual(['Automation', 'Analytics']);
            expect(result.enhancement.urgency).toBe('high');
        });

        test('handles errors gracefully', async () => {
            mockDb.get.mockRejectedValueOnce(new Error('Firestore error'));

            const result = await getPrecallFormEnhancement('form-123', 'user-123');
            expect(result).toBeNull();
        });
    });

    describe('enhanceInputsWithPrecallData', () => {
        test('returns original inputs when no precall data', () => {
            const inputs = { businessName: 'Test', statedProblem: 'Original problem' };
            const result = enhanceInputsWithPrecallData(inputs, null);

            expect(result).toEqual(inputs);
        });

        test('does not modify original inputs object', () => {
            const inputs = { businessName: 'Test' };
            const precallData = { prospectChallenge: 'New challenge' };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(inputs.statedProblem).toBeUndefined();
            expect(result.statedProblem).toBe('New challenge');
        });

        test('uses prospect challenge as stated problem', () => {
            const inputs = { businessName: 'Test', statedProblem: 'Generic problem' };
            const precallData = {
                prospectChallenge: 'Their specific challenge',
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.statedProblem).toBe('Their specific challenge');
            expect(result.prospectExactWords).toBe(true);
        });

        test('adds urgency level from enhancement', () => {
            const inputs = { businessName: 'Test' };
            const precallData = {
                enhancement: { urgency: 'high' },
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.urgencyLevel).toBe('high');
        });

        test('adds current solutions', () => {
            const inputs = { businessName: 'Test' };
            const precallData = {
                prospectCurrentSolution: ['Competitor A', 'Manual process'],
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.currentSolutions).toEqual(['Competitor A', 'Manual process']);
        });

        test('adds priority features', () => {
            const inputs = { businessName: 'Test' };
            const precallData = {
                prospectPriorityFeatures: ['Feature 1', 'Feature 2'],
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.priorityFeatures).toEqual(['Feature 1', 'Feature 2']);
        });

        test('adds stakeholders from enhancement', () => {
            const inputs = { businessName: 'Test' };
            const precallData = {
                enhancement: {
                    stakeholders: ['CEO', 'CTO'],
                },
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.stakeholders).toEqual(['CEO', 'CTO']);
        });

        test('combines all enhancements', () => {
            const inputs = { businessName: 'Test', industry: 'Tech' };
            const precallData = {
                prospectChallenge: 'Complex challenge',
                prospectCurrentSolution: ['Old system'],
                prospectPriorityFeatures: ['Speed'],
                enhancement: {
                    urgency: 'medium',
                    stakeholders: ['Owner'],
                },
            };

            const result = enhanceInputsWithPrecallData(inputs, precallData);

            expect(result.businessName).toBe('Test');
            expect(result.industry).toBe('Tech');
            expect(result.statedProblem).toBe('Complex challenge');
            expect(result.prospectExactWords).toBe(true);
            expect(result.currentSolutions).toEqual(['Old system']);
            expect(result.priorityFeatures).toEqual(['Speed']);
            expect(result.urgencyLevel).toBe('medium');
            expect(result.stakeholders).toEqual(['Owner']);
        });
    });
});
