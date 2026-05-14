'use strict';

/**
 * marketIntelPitchContext.js
 *
 * Builds a structured context object from a Market Intel report for use
 * in pitch generation. This service reads Firestore but does NOT charge
 * any credits — credit deduction happens only during pitch generation.
 */

const admin = require('firebase-admin');
const { findIndustry, findSubIndustry } = require('../config/industryTaxonomy');
const { getReportProfile } = require('../config/reportProfiles');
const { safeNumber } = require('../utils/numericSafety');

// Revenue band helper — mirrors publicDataEnrichmentService.formatRevenueband
function formatRevenuebandLocal(amount) {
    var n = safeNumber(amount);
    if (n <= 0) return 'under $100K';
    if (n < 100000) return 'under $100K';
    if (n < 500000) return '$100K–$500K';
    if (n < 1000000) return '$500K–$1M';
    if (n < 2500000) return '$1M–$2.5M';
    if (n < 5000000) return '$2.5M–$5M';
    if (n < 10000000) return '$5M–$10M';
    if (n < 25000000) return '$10M–$25M';
    if (n < 50000000) return '$25M–$50M';
    if (n < 100000000) return '$50M–$100M';
    return 'over $100M';
}

// ---------------------------------------------------------------------------
// Lead matching — priority chain
// ---------------------------------------------------------------------------
function findSelectedLead(report, { leadId, placeId, leadName, leadWebsite }) {
    const leads = report.qualifiedLeads || report.data?.leads || report.leads || [];

    // Priority 1: ID match
    if (leadId) {
        const match = leads.find(l => l.id === leadId || l._id === leadId);
        if (match) return match;
    }

    // Priority 2: placeId / googlePlaceId
    if (placeId) {
        const match = leads.find(l =>
            l.placeId === placeId || l.googlePlaceId === placeId || l.place_id === placeId
        );
        if (match) return match;
    }

    // Priority 3: exact website match
    if (leadWebsite) {
        const normalizedUrl = leadWebsite.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
        const match = leads.find(l =>
            (l.website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '') === normalizedUrl
        );
        if (match) return match;
    }

    // Priority 4: exact normalized name match
    if (leadName) {
        const normalizedName = leadName.toLowerCase().trim();
        const match = leads.find(l =>
            (l.name || l.businessName || '').toLowerCase().trim() === normalizedName
        );
        if (match) return match;
    }

    // Priority 5: partial name match (last resort)
    if (leadName) {
        const normalizedName = leadName.toLowerCase().trim();
        const match = leads.find(l =>
            (l.name || l.businessName || '').toLowerCase().includes(normalizedName) ||
            normalizedName.includes((l.name || l.businessName || '').toLowerCase())
        );
        if (match) return match;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Language rules — derived from profile key
// ---------------------------------------------------------------------------
function buildLanguageRules(profileKey, reportProfile) {
    const rules = {
        competitorLanguage: reportProfile?.competitorLanguage || 'competitors',
        opportunityLanguage: reportProfile?.opportunityLanguage || 'opportunity gap',
        qualifiedLeadsLanguage: reportProfile?.qualifiedLeadsLanguage || 'qualified leads',
        audienceLanguage: 'customers',
        avoidTerms: []
    };

    if (profileKey === 'government_public_sector') {
        rules.audienceLanguage = 'citizens';
        rules.avoidTerms = ['customers', 'sales funnel', 'promotional offer', 'customer acquisition', 'sales pipeline'];
    } else if (profileKey === 'nonprofit_association') {
        rules.audienceLanguage = 'donors, members, and community';
        rules.avoidTerms = ['revenue optimization', 'sales pipeline', 'customer acquisition', 'promotional offer'];
    } else if (profileKey === 'b2b_services') {
        rules.audienceLanguage = 'qualified prospects';
        rules.avoidTerms = ['get more customers', 'foot traffic', 'walk-ins'];
    }

    return rules;
}

// ---------------------------------------------------------------------------
// Proof points helper
// ---------------------------------------------------------------------------
function buildProofPoints(report, selectedLead) {
    const points = [];
    const mb = report.data?.benchmarks || {};

    if (mb.totalCompetitors) points.push(`${mb.totalCompetitors} competitors mapped in this market`);
    if (mb.avgRating) points.push(`Market avg rating: ${safeNumber(mb.avgRating).toFixed(1)}\u2605`);
    if (selectedLead) {
        const name = selectedLead.name || selectedLead.businessName;
        if (name) points.push(`${name} identified as high-opportunity target`);
        if (selectedLead.opportunityScore) points.push(`Opportunity score: ${selectedLead.opportunityScore}/100`);
    }
    const leads = report.qualifiedLeads || report.data?.leads || report.leads || [];
    if (leads.length) points.push(`${leads.length} qualified leads identified`);
    if (report.strategicMarketThesis?.gapLabel) points.push(`Gap identified: ${report.strategicMarketThesis.gapLabel}`);
    return points;
}

// ---------------------------------------------------------------------------
// Context completeness scoring
// ---------------------------------------------------------------------------
function computeCompleteness(context) {
    const checks = [
        () => !!context.market.city,
        () => !!context.market.industryId,
        () => !!context.thesis.thesis,
        () => !!context.thesis.gapLabel,
        () => !!context.selectedLead,
        () => context.selectedLead?.rating !== null && context.selectedLead?.rating !== undefined,
        () => context.selectedLead?.reviews !== null && context.selectedLead?.reviews !== undefined,
        () => context.benchmarks.marketAvgRating !== null,
        () => !!context.benchmarks.leaderName,
        () => context.roadmap.length >= 4,
        () => context.kpis.length >= 4,
        () => !!context.market.competitorLanguage,
    ];
    let score = 0;
    for (const check of checks) {
        try { if (check()) score++; } catch (e) { /* skip */ }
    }
    return checks.length > 0 ? Math.round((score / checks.length) * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
async function buildMarketIntelPitchContext({
    reportId,
    libraryItemId,
    selectedLeadId,
    selectedLeadPlaceId,
    selectedLeadName,
    selectedLeadWebsite,
    userId
}) {
    if (!reportId) {
        throw new Error('reportId is required');
    }
    if (!userId) {
        throw new Error('Unauthorized');
    }

    const db = admin.firestore();

    // 1. Fetch report from Firestore (NO credit charge — read only)
    const reportDoc = await db.collection('marketReports').doc(reportId).get();
    if (!reportDoc.exists) {
        throw new Error('Report not found');
    }

    const report = { ...reportDoc.data(), id: reportDoc.id };

    // 2. Authorize — same pattern as report viewer (getReport in market.js):
    //    owner OR workspace member
    if (report.userId !== userId) {
        // Check workspace team membership
        const workspaceId = report.workspaceId || report.userId;
        let hasAccess = false;
        if (workspaceId) {
            try {
                const teamDoc = await db.collection('teams').doc(workspaceId).get();
                if (teamDoc.exists) {
                    const memberUids = teamDoc.data().memberUids || [];
                    hasAccess = Array.isArray(memberUids) && memberUids.includes(userId);
                }
            } catch (teamErr) {
                // Non-fatal; access denied below
            }
        }
        if (!hasAccess) {
            throw new Error('Access denied');
        }
    }

    // 3. Resolve taxonomy
    const industryQuery = report.industry?.display || report.industry?.name || report.industry || '';
    const subIndustryQuery = report.industry?.subIndustry || report.subIndustry || '';
    const industryConfig = findIndustry(industryQuery) || null;
    const subIndustryConfig = (industryConfig && subIndustryQuery)
        ? findSubIndustry(industryQuery, subIndustryQuery)
        : null;

    // 4. Resolve effective profile
    const profileKey = report.reportProfile
        || report.industry?.reportProfile
        || industryConfig?.reportProfile
        || subIndustryConfig?.reportProfile
        || 'default_local_business';

    const scoringProfileKey = report.scoringProfile
        || report.industry?.scoringProfile
        || industryConfig?.scoringProfile
        || 'default_local_business';

    const reportProfile = getReportProfile(profileKey);

    const effectiveProfile = {
        scoringProfile: scoringProfileKey,
        reportProfile: profileKey
    };

    // 5. Find selected lead using stable identifier chain
    const selectedLead = findSelectedLead(report, {
        leadId: selectedLeadId || null,
        placeId: selectedLeadPlaceId || null,
        leadName: selectedLeadName || null,
        leadWebsite: selectedLeadWebsite || null
    });

    // 6. Build language rules from profile key
    const languageRules = buildLanguageRules(profileKey, reportProfile);

    // 7. Assemble context object
    const mb = report.data?.benchmarks || {};

    const context = {
        source: 'market_intel',
        reportId,
        libraryItemId: libraryItemId || null,
        creditCost: 0,
        generatedAt: new Date().toISOString(),

        market: {
            city: report.location?.city || report.city || report.market?.city || '',
            state: report.location?.state || report.state || report.market?.state || '',
            industryLabel: report.industry?.display || report.industry?.name || report.industryLabel || industryConfig?.label || '',
            subIndustryLabel: report.industry?.subIndustry || report.subIndustryLabel || subIndustryConfig?.label || '',
            industryId: report.industryId || industryConfig?.id || '',
            subIndustryId: report.subIndustryId || subIndustryConfig?.id || '',
            scoringProfile: effectiveProfile.scoringProfile,
            reportProfile: effectiveProfile.reportProfile,
            competitorLanguage: languageRules.competitorLanguage,
            opportunityLanguage: languageRules.opportunityLanguage
        },

        languageRules,

        thesis: {
            gapLabel: report.strategicMarketThesis?.gapLabel || '',
            thesis: report.strategicMarketThesis?.thesis || '',
            pitchFrame: report.strategicMarketThesis?.title || 'Strategic Market Thesis'
        },

        selectedLead: selectedLead ? {
            businessName: selectedLead.name || selectedLead.businessName || '',
            website: selectedLead.website || '',
            rating: selectedLead.rating !== undefined ? selectedLead.rating : null,
            reviews: selectedLead.reviews !== undefined ? selectedLead.reviews
                : (selectedLead.reviewCount !== undefined ? selectedLead.reviewCount : null),
            voiceShare: selectedLead.voice || selectedLead.shareOfVoice || selectedLead.voiceShare || null,
            opportunityScore: selectedLead.opportunityScore || selectedLead.score || null,
            leadTier: selectedLead.tier || selectedLead.leadTier || null,
            intelSignal: selectedLead.intelSignal || selectedLead.signal || null,
            address: selectedLead.address || selectedLead.vicinity || '',
            phone: selectedLead.phone || selectedLead.phoneNumber || '',
            whyThisBusiness: selectedLead.whyThisBusiness || selectedLead.why || '',
            primaryGap: selectedLead.primaryGap || selectedLead.gap || ''
        } : null,

        benchmarks: {
            marketAvgRating: mb.avgRating !== undefined ? mb.avgRating : null,
            marketAvgReviews: mb.avgReviews !== undefined ? mb.avgReviews : null,
            leaderName: mb.leaderName || mb.marketLeader || null,
            leaderReviewCount: mb.leaderReviewCount || mb.leaderReviews || mb.marketLeaderReviews || null,
            leaderVoiceShare: mb.leaderVoiceShare || null,
            topQuartileRating: mb.topQuartileRating || mb.topQuartileAvg || null,
            totalMarketReviews: mb.totalMarketReviews || null,
            totalCompetitors: mb.totalCompetitors || null,
            saturation: mb.saturation || report.data?.saturation || null
        },

        roadmap: (report.strategicRoadmap || []).slice(0, 4),

        kpis: (report.kpiScorecard || []).slice(0, 6),

        recommendedPitch: {
            primaryAngle: report.strategicMarketThesis?.thesis
                ? `Leverage the ${report.strategicMarketThesis.gapLabel || 'market gap'} in ${report.location?.city || report.city || 'this market'}`
                : `Competitive opportunity in ${report.location?.city || report.city || 'this market'}`,
            secondaryAngle: selectedLead
                ? `Target ${selectedLead.name || selectedLead.businessName} \u2014 ${selectedLead.primaryGap || selectedLead.intelSignal || 'high opportunity score'}`
                : 'Focus on highest-scored qualified leads',
            recommendedProduct: (report.productRecommendations || [])[0]?.name || 'LocalSynch',
            recommendedCTA: 'Book a discovery call',
            proofPoints: buildProofPoints(report, selectedLead).slice(0, 6)
        }
    };

    // 8. Compute completeness
    context.contextCompleteness = computeCompleteness(context);

    // 9. Government pitch context (non-blocking — field may not exist)
    const psi = report.publicSectorIntelligence || (report.data && report.data.publicSectorIntelligence);
    if (psi && psi.federalFunding) {
        context.publicSectorIntelligence = {
            totalFederalAwards: psi.federalFunding.totalAwardsAmount || null,
            awardCount: psi.federalFunding.awardCount || null,
            topAwardingAgencies: (psi.federalFunding.topAwardingAgencies || []).slice(0, 3),
            pitchImplication: psi.pitchImplication || null,
            confidence: psi.confidence || null
        };
    }

    // 10a. Safety context — local operating context (supplementary, non-blocking)
    const sc = report.safetyContext;
    if (sc && sc.status !== 'unavailable') {
        const zl = sc.zipLevel || {};
        let safetyProfile = 'typical urban safety profile';
        if (zl.nationalComparison) {
            const cmp = (zl.nationalComparison || '').toLowerCase();
            if (cmp.includes('below') || cmp.includes('safer') || cmp.includes('lower')) {
                safetyProfile = 'above average safety profile';
            } else if (cmp.includes('above') || cmp.includes('higher') || cmp.includes('more')) {
                safetyProfile = 'below average safety profile';
            }
        }
        context.safetyContext = {
            safetyProfile,
            grade: zl.grade || null,
            nationalComparison: zl.nationalComparison || null,
            confidence: sc.confidence || null
        };
    }

    // 10. Nonprofit financial context — matched to selected lead
    const nfi = report.nonprofitFinancialIntelligence || (report.data && report.data.nonprofitFinancialIntelligence);
    if (nfi && selectedLead) {
        const selectedLeadName = (selectedLead.name || selectedLead.businessName || '').toLowerCase();
        const enrichedLead = (nfi.leadMatches || []).find(function(m) {
            return m.businessName && m.businessName.toLowerCase() === selectedLeadName;
        });
        if (enrichedLead) {
            context.nonprofitFinancialIntelligence = {
                revenue: enrichedLead.revenue || null,
                expenses: enrichedLead.expenses || null,
                netAssets: enrichedLead.netAssets || null,
                filingYear: enrichedLead.latestFilingYear || null,
                nteeCode: enrichedLead.nteeCode || null,
                nteeDescription: enrichedLead.nteeDescription || null,
                financialCapacity: formatRevenuebandLocal(enrichedLead.revenue),
                pitchImplication: enrichedLead.pitchImplication || null,
                matchConfidence: enrichedLead.matchConfidence || null
            };
        }
    }

    return context;
}

module.exports = { buildMarketIntelPitchContext };
