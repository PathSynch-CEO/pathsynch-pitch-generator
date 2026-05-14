'use strict';

/**
 * pitchCompanionMd.js
 *
 * Pure deterministic function (NO Gemini call) that converts a
 * marketIntelPitchContext object to a Markdown string for download.
 */

function formatCurrencyMd(amount) {
    if (!amount && amount !== 0) return null;
    var n = Number(amount);
    if (!isFinite(n)) return null;
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
}

function generatePitchCompanionMd(context) {
    const mic = context;
    let md = '';

    md += `# Pitch Companion\n`;
    md += `**${mic.market.industryLabel}${mic.market.subIndustryLabel ? ' \u2014 ' + mic.market.subIndustryLabel : ''}** \u00B7 ${mic.market.city}, ${mic.market.state}\n\n`;
    md += `_Generated: ${new Date(mic.generatedAt).toLocaleDateString()}_\n\n`;

    if (mic.thesis.thesis) {
        md += `## Strategic Frame\n`;
        md += `**Gap:** ${mic.thesis.gapLabel || 'Opportunity Zone'}\n\n`;
        md += mic.thesis.thesis + '\n\n';
    }

    if (mic.selectedLead) {
        md += `## Prospect Profile\n`;
        md += `**${mic.selectedLead.businessName}**\n`;
        if (mic.selectedLead.website) md += `Website: ${mic.selectedLead.website}\n`;
        if (mic.selectedLead.rating !== null && mic.selectedLead.rating !== undefined)
            md += `Rating: ${mic.selectedLead.rating}\u2605\n`;
        if (mic.selectedLead.reviews !== null && mic.selectedLead.reviews !== undefined)
            md += `Reviews: ${mic.selectedLead.reviews}\n`;
        if (mic.selectedLead.opportunityScore)
            md += `Opportunity Score: ${mic.selectedLead.opportunityScore}/100\n`;
        if (mic.selectedLead.whyThisBusiness)
            md += `\n_Why this business:_ ${mic.selectedLead.whyThisBusiness}\n`;
        if (mic.selectedLead.primaryGap)
            md += `_Primary gap:_ ${mic.selectedLead.primaryGap}\n`;
        md += '\n';
    }

    if (mic.benchmarks.marketAvgRating !== null) {
        md += `## Market Benchmarks\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        if (mic.benchmarks.marketAvgRating !== null) md += `| Market Avg Rating | ${mic.benchmarks.marketAvgRating}\u2605 |\n`;
        if (mic.benchmarks.marketAvgReviews !== null) md += `| Market Avg Reviews | ${mic.benchmarks.marketAvgReviews} |\n`;
        if (mic.benchmarks.leaderName) md += `| Market Leader | ${mic.benchmarks.leaderName} (${mic.benchmarks.leaderReviewCount || 'N/A'} reviews) |\n`;
        if (mic.benchmarks.totalCompetitors) md += `| Total Competitors | ${mic.benchmarks.totalCompetitors} |\n`;
        md += '\n';
    }

    md += `## Pitch Angle\n`;
    md += `**Primary:** ${mic.recommendedPitch.primaryAngle}\n`;
    md += `**CTA:** ${mic.recommendedPitch.recommendedCTA}\n\n`;

    if (mic.recommendedPitch.proofPoints && mic.recommendedPitch.proofPoints.length > 0) {
        md += `### Proof Points\n`;
        for (const pt of mic.recommendedPitch.proofPoints) {
            md += `- ${pt}\n`;
        }
        md += '\n';
    }

    if (mic.languageRules.avoidTerms && mic.languageRules.avoidTerms.length > 0) {
        md += `## Language Rules\n`;
        md += `- Use **"${mic.languageRules.competitorLanguage}"** instead of "competitors"\n`;
        md += `- Use **"${mic.languageRules.audienceLanguage}"** instead of "customers"\n`;
        md += `- Avoid: ${mic.languageRules.avoidTerms.join(', ')}\n\n`;
    }

    if (mic.roadmap && mic.roadmap.length > 0) {
        md += `## Strategic Roadmap\n`;
        for (const phase of mic.roadmap) {
            md += `### Phase ${phase.phase}: ${phase.name} (${phase.timeframe})\n`;
            md += `**Focus:** ${phase.focus}\n`;
            if (phase.actions && phase.actions.length > 0) {
                for (const action of phase.actions) md += `- ${action}\n`;
            }
            if (phase.milestone) md += `**Milestone:** ${phase.milestone}\n`;
            if (phase.pathsynchProduct) md += `**Product:** ${phase.pathsynchProduct}\n`;
            md += '\n';
        }
    }

    if (mic.kpis && mic.kpis.length > 0) {
        md += `## KPI Targets\n`;
        md += `| KPI | Current | Target |\n|-----|---------|--------|\n`;
        for (const kpi of mic.kpis) {
            md += `| ${kpi.kpi} | ${kpi.currentValue} | ${kpi.target || 'See roadmap'} |\n`;
        }
        md += '\n';
    }

    // Government section — Public Funding Context
    if (mic.publicSectorIntelligence) {
        var psi = mic.publicSectorIntelligence;
        md += '\n## Public Funding Context\n\n';
        if (psi.totalFederalAwards) md += '- Total federal awards in area: ' + (formatCurrencyMd(psi.totalFederalAwards) || psi.totalFederalAwards) + '\n';
        if (psi.awardCount) md += '- Award count: ' + psi.awardCount + '\n';
        if (psi.topAwardingAgencies && psi.topAwardingAgencies.length > 0) {
            md += '- Top agencies: ' + psi.topAwardingAgencies.map(function(a) { return a.agency; }).join(', ') + '\n';
        }
        if (psi.pitchImplication) md += '\n**Pitch angle:** ' + psi.pitchImplication + '\n';
    }

    // Safety section — local operating context
    if (mic.safetyContext) {
        var sc = mic.safetyContext;
        md += '\n## Community Safety Profile\n\n';
        md += '- Safety profile: ' + sc.safetyProfile + '\n';
        if (sc.grade) md += '- Grade: ' + sc.grade + '\n';
        if (sc.nationalComparison) md += '- vs. national: ' + sc.nationalComparison + '\n';
        md += '\n_Note: Safety data is for operating context only. Do not reference crime data directly in pitch copy._\n';
    }

    // Nonprofit section — Financial Profile
    if (mic.nonprofitFinancialIntelligence) {
        var nfi = mic.nonprofitFinancialIntelligence;
        md += '\n## Nonprofit Financial Profile\n\n';
        if (nfi.financialCapacity) md += '- Financial capacity: ' + nfi.financialCapacity + ' annual revenue\n';
        if (nfi.nteeDescription) md += '- Category: ' + nfi.nteeDescription + '\n';
        if (nfi.filingYear) md += '- Latest filing: ' + nfi.filingYear + '\n';
        if (nfi.pitchImplication) md += '\n**Pitch angle:** ' + nfi.pitchImplication + '\n';
    }

    return md;
}

module.exports = { generatePitchCompanionMd };
