/**
 * ICP Validation and Match Scoring Tests
 * Tests for ICP template management and validation logic
 */

// ICP Templates (mirroring frontend config)
const ICP_TEMPLATES = [
    {
        id: 'restaurant_owner',
        name: 'Restaurant Owner',
        targetIndustries: ['Restaurant', 'Hospitality'],
        companySizes: ['2-10', '11-50'],
        painPoints: ['High food costs', 'Staff retention', 'Slow weeknights', 'Negative reviews', 'Delivery competition'],
        decisionMakers: ['Owner', 'General Manager', 'Operations Manager']
    },
    {
        id: 'b2b_saas',
        name: 'B2B SaaS Decision Maker',
        targetIndustries: ['Technology'],
        companySizes: ['11-50', '51-200', '201+'],
        painPoints: ['Manual processes', 'Data silos', 'Integration challenges', 'Scaling costs', 'Security compliance'],
        decisionMakers: ['CTO', 'VP of Engineering', 'IT Director', 'Head of Operations']
    }
];

// ICP Validation function (server-side implementation)
function validateICP(icp) {
    const warnings = [];
    const suggestions = [];
    let completenessScore = 0;

    // Check target industries (25 points)
    if (!icp.targetIndustries || icp.targetIndustries.length === 0) {
        warnings.push({
            field: 'targetIndustries',
            severity: 'error',
            message: 'No target industries selected'
        });
    } else {
        completenessScore += 25;
        if (icp.targetIndustries.length > 5) {
            suggestions.push({
                field: 'targetIndustries',
                severity: 'info',
                message: 'Many industries selected'
            });
        }
    }

    // Check company sizes (20 points)
    if (!icp.companySizes || icp.companySizes.length === 0) {
        warnings.push({
            field: 'companySizes',
            severity: 'warning',
            message: 'No company sizes specified'
        });
    } else {
        completenessScore += 20;
    }

    // Check pain points (35 points)
    if (!icp.painPoints || icp.painPoints.length === 0) {
        warnings.push({
            field: 'painPoints',
            severity: 'error',
            message: 'No pain points defined'
        });
    } else if (icp.painPoints.length < 3) {
        completenessScore += 15;
        warnings.push({
            field: 'painPoints',
            severity: 'warning',
            message: `Only ${icp.painPoints.length} pain point(s) defined`
        });
    } else if (icp.painPoints.length >= 3 && icp.painPoints.length < 5) {
        completenessScore += 25;
    } else {
        completenessScore += 35;
    }

    // Check decision makers (20 points)
    if (!icp.decisionMakers || icp.decisionMakers.length === 0) {
        warnings.push({
            field: 'decisionMakers',
            severity: 'warning',
            message: 'No decision maker titles specified'
        });
    } else {
        completenessScore += 20;
    }

    // Determine status
    let status, statusColor;
    if (completenessScore >= 80) {
        status = 'Complete';
        statusColor = '#22c55e';
    } else if (completenessScore >= 50) {
        status = 'Partial';
        statusColor = '#eab308';
    } else if (completenessScore >= 25) {
        status = 'Incomplete';
        statusColor = '#f97316';
    } else {
        status = 'Missing';
        statusColor = '#ef4444';
    }

    const errorCount = warnings.filter(w => w.severity === 'error').length;
    const warningCount = warnings.filter(w => w.severity === 'warning').length;

    return {
        isValid: errorCount === 0,
        completenessScore,
        status,
        statusColor,
        errorCount,
        warningCount,
        suggestionCount: suggestions.length,
        warnings,
        suggestions
    };
}

// ICP Match Score calculation (server-side implementation)
function calculateICPMatchScore(prospect, icp) {
    let score = 0;
    const matchedFactors = [];
    const unmatchedFactors = [];

    // Industry Match (35%)
    if (icp.targetIndustries?.length > 0) {
        if (icp.targetIndustries.includes(prospect.industry)) {
            score += 35;
            matchedFactors.push({ factor: 'Industry', value: prospect.industry });
        } else {
            unmatchedFactors.push({
                factor: 'Industry',
                expected: icp.targetIndustries.join(', '),
                actual: prospect.industry
            });
        }
    } else {
        score += 35; // No restriction
    }

    // Company Size Match (25%)
    if (icp.companySizes?.length > 0) {
        if (prospect.companySize && icp.companySizes.includes(prospect.companySize)) {
            score += 25;
            matchedFactors.push({ factor: 'Company Size', value: prospect.companySize });
        } else if (!prospect.companySize) {
            score += 12.5; // Partial credit
            unmatchedFactors.push({ factor: 'Company Size', expected: icp.companySizes.join(', '), actual: 'Unknown' });
        } else {
            unmatchedFactors.push({ factor: 'Company Size', expected: icp.companySizes.join(', '), actual: prospect.companySize });
        }
    } else {
        score += 25; // No restriction
    }

    // Decision Maker Match (15%)
    if (icp.decisionMakers?.length > 0 && prospect.contactTitle) {
        const titleMatch = icp.decisionMakers.some(dm =>
            prospect.contactTitle.toLowerCase().includes(dm.toLowerCase()) ||
            dm.toLowerCase().includes(prospect.contactTitle.toLowerCase())
        );
        if (titleMatch) {
            score += 15;
            matchedFactors.push({ factor: 'Decision Maker', value: prospect.contactTitle });
        } else {
            unmatchedFactors.push({ factor: 'Decision Maker', expected: icp.decisionMakers.join(', '), actual: prospect.contactTitle });
        }
    } else if (!prospect.contactTitle) {
        score += 7.5; // Partial credit
    } else {
        score += 15; // No restriction
    }

    // Pain Points Match (25%)
    if (icp.painPoints?.length > 0 && prospect.googleReviews) {
        const reviewText = prospect.googleReviews.toLowerCase();
        const matchedPainPoints = icp.painPoints.filter(pp =>
            reviewText.includes(pp.toLowerCase().split(' ')[0])
        );
        const painPointScore = (matchedPainPoints.length / icp.painPoints.length) * 25;
        score += painPointScore;
        if (matchedPainPoints.length > 0) {
            matchedFactors.push({ factor: 'Pain Points', value: `${matchedPainPoints.length}/${icp.painPoints.length} matched` });
        }
    } else {
        score += 12.5; // Partial credit if no reviews
    }

    // Determine rating
    const roundedScore = Math.round(score);
    let rating, color;
    if (roundedScore >= 75) {
        rating = 'Excellent';
        color = '#22c55e';
    } else if (roundedScore >= 50) {
        rating = 'Good';
        color = '#eab308';
    } else if (roundedScore >= 25) {
        rating = 'Fair';
        color = '#f97316';
    } else {
        rating = 'Low';
        color = '#ef4444';
    }

    return {
        score: roundedScore,
        rating,
        color,
        matchedFactors,
        unmatchedFactors
    };
}

describe('ICP Templates', () => {
    describe('Template Structure', () => {
        it('should have valid template IDs', () => {
            ICP_TEMPLATES.forEach(template => {
                expect(template.id).toBeDefined();
                expect(typeof template.id).toBe('string');
                expect(template.id.length).toBeGreaterThan(0);
            });
        });

        it('should have required fields', () => {
            ICP_TEMPLATES.forEach(template => {
                expect(template.name).toBeDefined();
                expect(template.targetIndustries).toBeDefined();
                expect(template.companySizes).toBeDefined();
                expect(template.painPoints).toBeDefined();
                expect(template.decisionMakers).toBeDefined();
            });
        });

        it('should have at least 3 pain points per template', () => {
            ICP_TEMPLATES.forEach(template => {
                expect(template.painPoints.length).toBeGreaterThanOrEqual(3);
            });
        });

        it('should have at least 1 target industry', () => {
            ICP_TEMPLATES.forEach(template => {
                expect(template.targetIndustries.length).toBeGreaterThanOrEqual(1);
            });
        });
    });
});

describe('ICP Validation', () => {
    describe('validateICP', () => {
        it('should return 100% for complete ICP', () => {
            const completeICP = {
                targetIndustries: ['Restaurant', 'Hospitality'],
                companySizes: ['2-10', '11-50'],
                painPoints: ['Pain 1', 'Pain 2', 'Pain 3', 'Pain 4', 'Pain 5'],
                decisionMakers: ['Owner', 'Manager']
            };
            const result = validateICP(completeICP);
            expect(result.completenessScore).toBe(100);
            expect(result.status).toBe('Complete');
            expect(result.isValid).toBe(true);
            expect(result.errorCount).toBe(0);
        });

        it('should return error for missing industries', () => {
            const icp = {
                targetIndustries: [],
                companySizes: ['2-10'],
                painPoints: ['Pain 1', 'Pain 2', 'Pain 3'],
                decisionMakers: ['Owner']
            };
            const result = validateICP(icp);
            expect(result.errorCount).toBe(1);
            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.field === 'targetIndustries')).toBe(true);
        });

        it('should return error for missing pain points', () => {
            const icp = {
                targetIndustries: ['Restaurant'],
                companySizes: ['2-10'],
                painPoints: [],
                decisionMakers: ['Owner']
            };
            const result = validateICP(icp);
            expect(result.errorCount).toBe(1);
            expect(result.warnings.some(w => w.field === 'painPoints' && w.severity === 'error')).toBe(true);
        });

        it('should return warning for few pain points', () => {
            const icp = {
                targetIndustries: ['Restaurant'],
                companySizes: ['2-10'],
                painPoints: ['Pain 1', 'Pain 2'],
                decisionMakers: ['Owner']
            };
            const result = validateICP(icp);
            expect(result.warningCount).toBeGreaterThan(0);
            expect(result.warnings.some(w => w.field === 'painPoints' && w.severity === 'warning')).toBe(true);
        });

        it('should return warning for missing company sizes', () => {
            const icp = {
                targetIndustries: ['Restaurant'],
                companySizes: [],
                painPoints: ['Pain 1', 'Pain 2', 'Pain 3'],
                decisionMakers: ['Owner']
            };
            const result = validateICP(icp);
            expect(result.warnings.some(w => w.field === 'companySizes' && w.severity === 'warning')).toBe(true);
        });

        it('should return warning for missing decision makers', () => {
            const icp = {
                targetIndustries: ['Restaurant'],
                companySizes: ['2-10'],
                painPoints: ['Pain 1', 'Pain 2', 'Pain 3'],
                decisionMakers: []
            };
            const result = validateICP(icp);
            expect(result.warnings.some(w => w.field === 'decisionMakers' && w.severity === 'warning')).toBe(true);
        });

        it('should handle empty ICP', () => {
            const emptyICP = {};
            const result = validateICP(emptyICP);
            expect(result.completenessScore).toBe(0);
            expect(result.status).toBe('Missing');
            expect(result.isValid).toBe(false);
        });

        it('should return correct status colors', () => {
            const completeICP = {
                targetIndustries: ['Restaurant'],
                companySizes: ['2-10'],
                painPoints: ['Pain 1', 'Pain 2', 'Pain 3', 'Pain 4', 'Pain 5'],
                decisionMakers: ['Owner']
            };
            const result = validateICP(completeICP);
            expect(result.statusColor).toBe('#22c55e'); // Green for complete
        });
    });
});

describe('ICP Match Scoring', () => {
    const restaurantICP = {
        targetIndustries: ['Restaurant', 'Hospitality'],
        companySizes: ['2-10', '11-50'],
        painPoints: ['food costs', 'staff retention', 'slow weeknights'],
        decisionMakers: ['Owner', 'General Manager']
    };

    describe('calculateICPMatchScore', () => {
        it('should return high score for perfect match', () => {
            const prospect = {
                industry: 'Restaurant',
                companySize: '11-50',
                contactTitle: 'Owner',
                googleReviews: 'Great food but high costs. Staff is excellent but retention is hard.'
            };
            const result = calculateICPMatchScore(prospect, restaurantICP);
            expect(result.score).toBeGreaterThanOrEqual(75);
            expect(result.rating).toBe('Excellent');
        });

        it('should return lower score for industry mismatch', () => {
            const prospect = {
                industry: 'Technology',
                companySize: '11-50',
                contactTitle: 'Owner',
                googleReviews: 'Great service'
            };
            const result = calculateICPMatchScore(prospect, restaurantICP);
            expect(result.score).toBeLessThan(75);
            expect(result.unmatchedFactors.some(f => f.factor === 'Industry')).toBe(true);
        });

        it('should give partial credit for unknown company size', () => {
            const prospect = {
                industry: 'Restaurant',
                companySize: '',
                contactTitle: 'Owner',
                googleReviews: 'food costs are high'
            };
            const result = calculateICPMatchScore(prospect, restaurantICP);
            expect(result.score).toBeGreaterThan(50);
        });

        it('should match decision maker titles case-insensitively', () => {
            const prospect = {
                industry: 'Restaurant',
                companySize: '11-50',
                contactTitle: 'general manager',
                googleReviews: ''
            };
            const result = calculateICPMatchScore(prospect, restaurantICP);
            expect(result.matchedFactors.some(f => f.factor === 'Decision Maker')).toBe(true);
        });

        it('should match pain points from reviews', () => {
            const prospect = {
                industry: 'Restaurant',
                companySize: '11-50',
                contactTitle: 'Owner',
                googleReviews: 'The food here is great but costs seem high. Staff retention seems to be a challenge.'
            };
            const result = calculateICPMatchScore(prospect, restaurantICP);
            expect(result.matchedFactors.some(f => f.factor === 'Pain Points')).toBe(true);
        });

        it('should return correct color codes', () => {
            const excellentProspect = {
                industry: 'Restaurant',
                companySize: '11-50',
                contactTitle: 'Owner',
                googleReviews: 'food costs staff retention slow'
            };
            const result = calculateICPMatchScore(excellentProspect, restaurantICP);
            if (result.score >= 75) {
                expect(result.color).toBe('#22c55e'); // Green
            } else if (result.score >= 50) {
                expect(result.color).toBe('#eab308'); // Yellow
            }
        });

        it('should handle empty ICP gracefully', () => {
            const prospect = {
                industry: 'Restaurant',
                companySize: '11-50',
                contactTitle: 'Owner',
                googleReviews: 'Great place'
            };
            const emptyICP = {};
            const result = calculateICPMatchScore(prospect, emptyICP);
            // Should get high score when no restrictions (partial credit for pain points without matching)
            expect(result.score).toBeGreaterThanOrEqual(75);
            expect(result.rating).toBe('Excellent');
        });

        it('should handle empty prospect gracefully', () => {
            const emptyProspect = {};
            const result = calculateICPMatchScore(emptyProspect, restaurantICP);
            expect(result.score).toBeDefined();
            expect(result.rating).toBeDefined();
        });
    });
});
