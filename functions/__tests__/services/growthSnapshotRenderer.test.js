'use strict';

const { renderGrowthSnapshot } = require('../../services/growthSnapshotRenderer');

describe('growthSnapshotRenderer', () => {
    const basePitchContext = {
        sections: [],
        inputs: {
            businessName: 'The C Bar',
            city: 'Atlanta',
            state: 'GA',
            industry: 'THC Beverage Bar',
            websiteUrl: 'https://thecbar.net',
            googleRating: '0',
            numReviews: '0'
        },
        prospect: { businessName: 'The C Bar', city: 'Atlanta', state: 'GA' },
        analysis: {
            websiteAudit: { hasWebsite: true, isPlaceholder: true, hasFacebook: false, hasInstagram: false },
            gbpStatus: 'not_found'
        },
        aiResults: {}
    };

    const sellerProfile = {
        companyName: 'PathSynch',
        name: 'PathSynch Labs'
    };

    it('renders complete HTML with both pages', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('The C Bar');
        expect(html).toContain('Page 1 of 2');
        expect(html).toContain('Page 2 of 2');
    });

    it('renders THC-specific ICPs when business matches', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Controlled Premium Relaxer');
        expect(html).toContain('Social Alternative Seeker');
        expect(html).toContain('Music-Led Explorer');
    });

    it('does NOT contain health claims for THC businesses', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).not.toContain('sacrificing the next morning');
        expect(html).not.toContain('no hangover');
        expect(html).not.toContain('health benefit');
    });

    it('renders audit channels with SVG icons not emoji', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('<svg');
        expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u); // no emoji
    });

    it('renders placeholder status when website is placeholder', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Placeholder Only');
    });

    it('renders diagnostics section on page 2', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Diagnostic Questions');
        expect(html).toContain('near-term revenue potential');
    });

    it('renders 90-day roadmap with three phases', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Days 1');
        expect(html).toContain('Days 31');
        expect(html).toContain('Days 61');
    });

    it('renders pricing section with breakdown', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('$477/mo');
        expect(html).toContain('PathConnect Growth');
        expect(html).toContain('LocalSynch Growth');
        expect(html).toContain('Managed Website');
    });

    it('uses generic competitor name by default', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Typical Agency');
        expect(html).not.toContain('Popmenu');
    });

    it('uses custom competitor name when provided in inputs', () => {
        const ctx = {
            ...basePitchContext,
            inputs: { ...basePitchContext.inputs, competitorName: 'Popmenu' }
        };
        const html = renderGrowthSnapshot(ctx, sellerProfile);
        expect(html).toContain('Popmenu');
    });

    it('includes website in roadmap when website is missing/placeholder', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Build and launch website');
        expect(html).toContain('Managed Website');
    });

    it('includes GBP in roadmap when GBP is not found', () => {
        const html = renderGrowthSnapshot(basePitchContext, sellerProfile);
        expect(html).toContain('Claim and optimize Google Business Profile');
    });

    it('renders generic ICPs for unknown industries', () => {
        const ctx = {
            ...basePitchContext,
            inputs: { ...basePitchContext.inputs, businessName: 'Joes Plumbing', industry: 'plumbing', websiteUrl: '' }
        };
        const html = renderGrowthSnapshot(ctx, sellerProfile);
        expect(html).toContain('High-Value Regular');
        expect(html).not.toContain('Premium Relaxer');
    });
});
