/**
 * Executive Summary Formatter
 *
 * Generates formal executive summary documents
 * Now uses modelRouter for intelligent Claude/Gemini selection (premium tier)
 */

const { BaseFormatter } = require('./baseFormatter');
const modelRouter = require('../services/modelRouter');
const { EXECUTIVE_SUMMARY_PROMPT } = require('../services/prompts/executiveSummaryPrompt');

class ExecutiveSummaryFormatter extends BaseFormatter {
    constructor() {
        super('executive_summary', 'growth');
    }

    getSystemPrompt() {
        return EXECUTIVE_SUMMARY_PROMPT;
    }

    async format(narrative, options = {}) {
        const result = await modelRouter.formatNarrative(
            this.getSystemPrompt(),
            narrative,
            this.assetType,
            options
        );

        let formatted;
        try {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                formatted = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (error) {
            console.error('Failed to parse executive summary response:', error);
            formatted = this.fallbackFormat(narrative);
        }

        return {
            ...formatted,
            usage: result.usage,
            provider: result.provider,
            modelId: result.modelId
        };
    }

    fallbackFormat(narrative) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const businessName = narrative.businessStory?.headline?.split(':')[0] || 'Business';

        return {
            executiveSummary: {
                header: {
                    title: 'Executive Summary',
                    preparedFor: businessName,
                    preparedBy: 'PathSynch',
                    date: today
                },
                executiveOverview: {
                    context: narrative.businessStory?.currentState || 'The business operates in a competitive local market.',
                    opportunity: narrative.businessStory?.valueProposition || 'Significant growth opportunity identified.',
                    recommendation: `Implement ${(narrative.solutionFit?.primaryProducts || ['PathSynch solutions']).join(', ')} to address identified challenges.`,
                    expectedImpact: narrative.roiStory?.headline || 'Measurable improvement in key business metrics.'
                },
                currentSituation: {
                    businessProfile: businessName,
                    reputationAssessment: {
                        rating: `${narrative.proofPoints?.sentiment?.positive || 0}% positive`,
                        reviewCount: 'Based on available reviews',
                        sentiment: narrative.proofPoints?.sentiment?.positive >= 70 ? 'Positive' : 'Mixed',
                        analysis: narrative.proofPoints?.topThemes?.[0]?.theme || 'Review analysis pending'
                    },
                    competitivePosition: 'Opportunities exist to strengthen market position',
                    challenges: narrative.painPoints?.map(pp => pp.title) || ['Growth challenges identified']
                },
                opportunityAssessment: {
                    marketOpportunity: 'Local market presents growth opportunities',
                    growthPotential: narrative.businessStory?.desiredState || 'Significant improvement potential',
                    riskOfInaction: 'Continued challenges without intervention',
                    urgencyFactors: narrative.ctaHooks?.filter(c => c.type === 'urgency').map(c => c.headline) || ['Market conditions favor action']
                },
                recommendedSolution: {
                    products: narrative.solutionFit?.useCases?.map(uc => ({
                        name: uc.product,
                        purpose: uc.useCase,
                        keyBenefits: [uc.outcome]
                    })) || [],
                    implementationApproach: 'Phased rollout with dedicated support',
                    timeline: '30-60 days for full implementation',
                    resourceRequirements: 'Minimal internal resources required'
                },
                roiProjection: {
                    currentMetrics: narrative.roiStory?.keyMetrics?.map(m => ({
                        metric: m.metric,
                        value: m.current
                    })) || [],
                    projectedImprovements: narrative.roiStory?.keyMetrics?.map(m => ({
                        metric: m.metric,
                        current: m.current,
                        projected: m.projected,
                        improvement: 'Significant'
                    })) || [],
                    financialImpact: 'Positive ROI expected',
                    paybackPeriod: '3-6 months'
                },
                nextSteps: {
                    immediateActions: [
                        'Review this summary',
                        'Schedule discovery call',
                        'Define implementation timeline'
                    ],
                    decisionTimeline: '2 weeks recommended',
                    contactInfo: {
                        name: 'PathSynch Team',
                        title: 'Solutions Consultant',
                        email: 'contact@pathsynch.com',
                        phone: ''
                    }
                }
            },
            appendix: {
                dataSourceNotes: 'Analysis based on provided business data',
                assumptionsNote: 'Projections assume consistent implementation and market conditions'
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { executiveSummary, appendix } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: 'Georgia', 'Times New Roman', serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            line-height: 1.8;
            color: #333;
        }
        .header {
            text-align: center;
            padding: 40px 0;
            border-bottom: 2px solid {{primaryColor}};
            margin-bottom: 40px;
        }
        .header h1 {
            color: {{primaryColor}};
            margin: 0 0 10px 0;
            font-size: 28px;
        }
        .header .meta {
            font-size: 14px;
            color: #666;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            color: {{primaryColor}};
            font-size: 18px;
            border-bottom: 1px solid {{primaryColor}};
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .subsection {
            margin-bottom: 20px;
        }
        .subsection h4 {
            margin: 0 0 10px 0;
            color: #555;
        }
        .key-point {
            background: #f9fafb;
            padding: 15px 20px;
            border-left: 4px solid {{primaryColor}};
            margin: 15px 0;
        }
        .metrics-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .metrics-table th,
        .metrics-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        .metrics-table th {
            background: {{primaryColor}};
            color: white;
        }
        .metrics-table tr:hover {
            background: #f9fafb;
        }
        .challenge-list {
            list-style: none;
            padding: 0;
        }
        .challenge-list li {
            padding: 8px 0 8px 25px;
            position: relative;
        }
        .challenge-list li::before {
            content: '●';
            color: {{primaryColor}};
            position: absolute;
            left: 0;
        }
        .product-card {
            background: #f9fafb;
            padding: 15px 20px;
            border-radius: 8px;
            margin: 10px 0;
        }
        .product-card h5 {
            margin: 0 0 8px 0;
            color: {{primaryColor}};
        }
        .next-steps-list {
            list-style: decimal;
            padding-left: 20px;
        }
        .next-steps-list li {
            padding: 5px 0;
        }
        .contact-box {
            background: {{primaryColor}};
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
        }
        .contact-box h4 {
            margin: 0 0 10px 0;
        }
        .appendix {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        {{logoPlaceholder}}
        <h1>${this.escapeHtml(executiveSummary?.header?.title || 'Executive Summary')}</h1>
        <div class="meta">
            <div>Prepared for: <strong>${this.escapeHtml(executiveSummary?.header?.preparedFor || '')}</strong></div>
            <div>Prepared by: ${this.escapeHtml(executiveSummary?.header?.preparedBy || '')}</div>
            <div>${this.escapeHtml(executiveSummary?.header?.date || '')}</div>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Executive Overview</h2>
        <div class="key-point">
            <strong>Recommendation:</strong> ${this.escapeHtml(executiveSummary?.executiveOverview?.recommendation || '')}
        </div>
        <p><strong>Context:</strong> ${this.escapeHtml(executiveSummary?.executiveOverview?.context || '')}</p>
        <p><strong>Opportunity:</strong> ${this.escapeHtml(executiveSummary?.executiveOverview?.opportunity || '')}</p>
        <p><strong>Expected Impact:</strong> ${this.escapeHtml(executiveSummary?.executiveOverview?.expectedImpact || '')}</p>
    </div>

    <div class="section">
        <h2 class="section-title">Current Situation Analysis</h2>
        <div class="subsection">
            <h4>Business Profile</h4>
            <p>${this.escapeHtml(executiveSummary?.currentSituation?.businessProfile || '')}</p>
        </div>
        <div class="subsection">
            <h4>Online Reputation Assessment</h4>
            <table class="metrics-table">
                <tr><td><strong>Rating</strong></td><td>${this.escapeHtml(executiveSummary?.currentSituation?.reputationAssessment?.rating || '')}</td></tr>
                <tr><td><strong>Review Volume</strong></td><td>${this.escapeHtml(executiveSummary?.currentSituation?.reputationAssessment?.reviewCount || '')}</td></tr>
                <tr><td><strong>Overall Sentiment</strong></td><td>${this.escapeHtml(executiveSummary?.currentSituation?.reputationAssessment?.sentiment || '')}</td></tr>
                <tr><td><strong>Analysis</strong></td><td>${this.escapeHtml(executiveSummary?.currentSituation?.reputationAssessment?.analysis || '')}</td></tr>
            </table>
        </div>
        <div class="subsection">
            <h4>Key Challenges Identified</h4>
            <ul class="challenge-list">
                ${(executiveSummary?.currentSituation?.challenges || []).map(c => `<li>${this.escapeHtml(c)}</li>`).join('')}
            </ul>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Opportunity Assessment</h2>
        <p><strong>Market Opportunity:</strong> ${this.escapeHtml(executiveSummary?.opportunityAssessment?.marketOpportunity || '')}</p>
        <p><strong>Growth Potential:</strong> ${this.escapeHtml(executiveSummary?.opportunityAssessment?.growthPotential || '')}</p>
        <p><strong>Risk of Inaction:</strong> ${this.escapeHtml(executiveSummary?.opportunityAssessment?.riskOfInaction || '')}</p>
        <div class="subsection">
            <h4>Urgency Factors</h4>
            <ul class="challenge-list">
                ${(executiveSummary?.opportunityAssessment?.urgencyFactors || []).map(f => `<li>${this.escapeHtml(f)}</li>`).join('')}
            </ul>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Recommended Solution</h2>
        ${(executiveSummary?.recommendedSolution?.products || []).map(p => `
            <div class="product-card">
                <h5>${this.escapeHtml(p.name || '')}</h5>
                <p><strong>Purpose:</strong> ${this.escapeHtml(p.purpose || '')}</p>
                <p><strong>Key Benefits:</strong> ${(p.keyBenefits || []).map(b => this.escapeHtml(b)).join(', ')}</p>
            </div>
        `).join('')}
        <p><strong>Implementation Approach:</strong> ${this.escapeHtml(executiveSummary?.recommendedSolution?.implementationApproach || '')}</p>
        <p><strong>Timeline:</strong> ${this.escapeHtml(executiveSummary?.recommendedSolution?.timeline || '')}</p>
    </div>

    <div class="section">
        <h2 class="section-title">ROI Projection</h2>
        <table class="metrics-table">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th>Current</th>
                    <th>Projected</th>
                    <th>Improvement</th>
                </tr>
            </thead>
            <tbody>
                ${(executiveSummary?.roiProjection?.projectedImprovements || []).map(m => `
                    <tr>
                        <td>${this.escapeHtml(m.metric || '')}</td>
                        <td>${this.escapeHtml(m.current || '')}</td>
                        <td><strong>${this.escapeHtml(m.projected || '')}</strong></td>
                        <td style="color: #10b981;">${this.escapeHtml(m.improvement || '')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <p><strong>Financial Impact:</strong> ${this.escapeHtml(executiveSummary?.roiProjection?.financialImpact || '')}</p>
        <p><strong>Expected Payback Period:</strong> ${this.escapeHtml(executiveSummary?.roiProjection?.paybackPeriod || '')}</p>
    </div>

    <div class="section">
        <h2 class="section-title">Next Steps</h2>
        <ol class="next-steps-list">
            ${(executiveSummary?.nextSteps?.immediateActions || []).map(a => `<li>${this.escapeHtml(a)}</li>`).join('')}
        </ol>
        <p><strong>Decision Timeline:</strong> ${this.escapeHtml(executiveSummary?.nextSteps?.decisionTimeline || '')}</p>

        <div class="contact-box">
            <h4>Contact Information</h4>
            <p>${this.escapeHtml(executiveSummary?.nextSteps?.contactInfo?.name || '')}</p>
            <p>${this.escapeHtml(executiveSummary?.nextSteps?.contactInfo?.title || '')}</p>
            <p>${this.escapeHtml(executiveSummary?.nextSteps?.contactInfo?.email || '')}</p>
            ${executiveSummary?.nextSteps?.contactInfo?.phone ? `<p>${this.escapeHtml(executiveSummary.nextSteps.contactInfo.phone)}</p>` : ''}
        </div>
    </div>

    <div class="appendix">
        <h3>Appendix</h3>
        <p><strong>Data Sources:</strong> ${this.escapeHtml(appendix?.dataSourceNotes || '')}</p>
        <p><strong>Assumptions:</strong> ${this.escapeHtml(appendix?.assumptionsNote || '')}</p>
    </div>

    {{poweredBy}}
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { executiveSummary, appendix } = formattedContent;

        return `
${'='.repeat(60)}
EXECUTIVE SUMMARY
${'='.repeat(60)}

Prepared for: ${executiveSummary?.header?.preparedFor || ''}
Prepared by: ${executiveSummary?.header?.preparedBy || ''}
Date: ${executiveSummary?.header?.date || ''}

${'─'.repeat(60)}
EXECUTIVE OVERVIEW
${'─'.repeat(60)}

Context: ${executiveSummary?.executiveOverview?.context || ''}

Opportunity: ${executiveSummary?.executiveOverview?.opportunity || ''}

>>> RECOMMENDATION: ${executiveSummary?.executiveOverview?.recommendation || ''} <<<

Expected Impact: ${executiveSummary?.executiveOverview?.expectedImpact || ''}

${'─'.repeat(60)}
CURRENT SITUATION ANALYSIS
${'─'.repeat(60)}

Business Profile: ${executiveSummary?.currentSituation?.businessProfile || ''}

Reputation Assessment:
  - Rating: ${executiveSummary?.currentSituation?.reputationAssessment?.rating || ''}
  - Review Volume: ${executiveSummary?.currentSituation?.reputationAssessment?.reviewCount || ''}
  - Sentiment: ${executiveSummary?.currentSituation?.reputationAssessment?.sentiment || ''}
  - Analysis: ${executiveSummary?.currentSituation?.reputationAssessment?.analysis || ''}

Key Challenges:
${(executiveSummary?.currentSituation?.challenges || []).map(c => `  • ${c}`).join('\n')}

${'─'.repeat(60)}
OPPORTUNITY ASSESSMENT
${'─'.repeat(60)}

Market Opportunity: ${executiveSummary?.opportunityAssessment?.marketOpportunity || ''}
Growth Potential: ${executiveSummary?.opportunityAssessment?.growthPotential || ''}
Risk of Inaction: ${executiveSummary?.opportunityAssessment?.riskOfInaction || ''}

Urgency Factors:
${(executiveSummary?.opportunityAssessment?.urgencyFactors || []).map(f => `  • ${f}`).join('\n')}

${'─'.repeat(60)}
RECOMMENDED SOLUTION
${'─'.repeat(60)}

${(executiveSummary?.recommendedSolution?.products || []).map(p => `
${p.name}
  Purpose: ${p.purpose}
  Benefits: ${(p.keyBenefits || []).join(', ')}
`).join('\n')}

Implementation: ${executiveSummary?.recommendedSolution?.implementationApproach || ''}
Timeline: ${executiveSummary?.recommendedSolution?.timeline || ''}

${'─'.repeat(60)}
ROI PROJECTION
${'─'.repeat(60)}

${(executiveSummary?.roiProjection?.projectedImprovements || []).map(m => `${m.metric}: ${m.current} → ${m.projected} (${m.improvement})`).join('\n')}

Financial Impact: ${executiveSummary?.roiProjection?.financialImpact || ''}
Payback Period: ${executiveSummary?.roiProjection?.paybackPeriod || ''}

${'─'.repeat(60)}
NEXT STEPS
${'─'.repeat(60)}

${(executiveSummary?.nextSteps?.immediateActions || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

Decision Timeline: ${executiveSummary?.nextSteps?.decisionTimeline || ''}

Contact:
  ${executiveSummary?.nextSteps?.contactInfo?.name || ''}
  ${executiveSummary?.nextSteps?.contactInfo?.title || ''}
  ${executiveSummary?.nextSteps?.contactInfo?.email || ''}
  ${executiveSummary?.nextSteps?.contactInfo?.phone || ''}

${'─'.repeat(60)}
APPENDIX
${'─'.repeat(60)}

Data Sources: ${appendix?.dataSourceNotes || ''}
Assumptions: ${appendix?.assumptionsNote || ''}
`;
    }

    toMarkdown(formattedContent) {
        const { executiveSummary, appendix } = formattedContent;

        return `# Executive Summary

**Prepared for:** ${executiveSummary?.header?.preparedFor || ''}
**Prepared by:** ${executiveSummary?.header?.preparedBy || ''}
**Date:** ${executiveSummary?.header?.date || ''}

---

## Executive Overview

> **Recommendation:** ${executiveSummary?.executiveOverview?.recommendation || ''}

**Context:** ${executiveSummary?.executiveOverview?.context || ''}

**Opportunity:** ${executiveSummary?.executiveOverview?.opportunity || ''}

**Expected Impact:** ${executiveSummary?.executiveOverview?.expectedImpact || ''}

---

## Current Situation Analysis

### Business Profile
${executiveSummary?.currentSituation?.businessProfile || ''}

### Online Reputation Assessment

| Aspect | Assessment |
|--------|------------|
| Rating | ${executiveSummary?.currentSituation?.reputationAssessment?.rating || ''} |
| Review Volume | ${executiveSummary?.currentSituation?.reputationAssessment?.reviewCount || ''} |
| Sentiment | ${executiveSummary?.currentSituation?.reputationAssessment?.sentiment || ''} |
| Analysis | ${executiveSummary?.currentSituation?.reputationAssessment?.analysis || ''} |

### Key Challenges Identified
${(executiveSummary?.currentSituation?.challenges || []).map(c => `- ${c}`).join('\n')}

---

## Opportunity Assessment

**Market Opportunity:** ${executiveSummary?.opportunityAssessment?.marketOpportunity || ''}

**Growth Potential:** ${executiveSummary?.opportunityAssessment?.growthPotential || ''}

**Risk of Inaction:** ${executiveSummary?.opportunityAssessment?.riskOfInaction || ''}

### Urgency Factors
${(executiveSummary?.opportunityAssessment?.urgencyFactors || []).map(f => `- ${f}`).join('\n')}

---

## Recommended Solution

${(executiveSummary?.recommendedSolution?.products || []).map(p => `
### ${p.name}

**Purpose:** ${p.purpose}

**Key Benefits:**
${(p.keyBenefits || []).map(b => `- ${b}`).join('\n')}
`).join('\n')}

**Implementation Approach:** ${executiveSummary?.recommendedSolution?.implementationApproach || ''}

**Timeline:** ${executiveSummary?.recommendedSolution?.timeline || ''}

---

## ROI Projection

| Metric | Current | Projected | Improvement |
|--------|---------|-----------|-------------|
${(executiveSummary?.roiProjection?.projectedImprovements || []).map(m => `| ${m.metric} | ${m.current} | ${m.projected} | ${m.improvement} |`).join('\n')}

**Financial Impact:** ${executiveSummary?.roiProjection?.financialImpact || ''}

**Payback Period:** ${executiveSummary?.roiProjection?.paybackPeriod || ''}

---

## Next Steps

${(executiveSummary?.nextSteps?.immediateActions || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

**Decision Timeline:** ${executiveSummary?.nextSteps?.decisionTimeline || ''}

### Contact Information

- **Name:** ${executiveSummary?.nextSteps?.contactInfo?.name || ''}
- **Title:** ${executiveSummary?.nextSteps?.contactInfo?.title || ''}
- **Email:** ${executiveSummary?.nextSteps?.contactInfo?.email || ''}
${executiveSummary?.nextSteps?.contactInfo?.phone ? `- **Phone:** ${executiveSummary.nextSteps.contactInfo.phone}` : ''}

---

## Appendix

**Data Sources:** ${appendix?.dataSourceNotes || ''}

**Assumptions:** ${appendix?.assumptionsNote || ''}
`;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            documentType: 'Executive Summary',
            sectionCount: 6
        };
    }
}

module.exports = { ExecutiveSummaryFormatter };
