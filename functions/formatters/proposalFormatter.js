/**
 * Proposal Formatter
 *
 * Generates comprehensive business proposal documents
 */

const { BaseFormatter } = require('./baseFormatter');
const { formatNarrative } = require('../services/claudeClient');
const { PROPOSAL_PROMPT } = require('../services/prompts/proposalPrompt');

class ProposalFormatter extends BaseFormatter {
    constructor() {
        super('proposal', 'scale');
    }

    getSystemPrompt() {
        return PROPOSAL_PROMPT;
    }

    async format(narrative, options = {}) {
        const result = await formatNarrative(
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
            console.error('Failed to parse proposal response:', error);
            formatted = this.fallbackFormat(narrative, options);
        }

        return {
            ...formatted,
            usage: result.usage
        };
    }

    fallbackFormat(narrative, options = {}) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const businessName = narrative.businessStory?.headline?.split(':')[0] || 'Client Business';
        const proposalNum = `PS-${Date.now().toString().slice(-6)}`;

        return {
            proposal: {
                coverPage: {
                    title: 'Business Growth Proposal',
                    subtitle: 'PathSynch Solutions for Local Business Success',
                    preparedFor: {
                        businessName,
                        contactName: options.contactName || 'Business Owner',
                        address: options.address || ''
                    },
                    preparedBy: {
                        companyName: 'PathSynch',
                        contactName: options.salesRep || 'PathSynch Team',
                        title: 'Solutions Consultant'
                    },
                    date: today,
                    proposalNumber: proposalNum
                },
                executiveSummary: {
                    overview: `This proposal outlines a comprehensive solution to address the growth challenges facing ${businessName}.`,
                    recommendation: `We recommend implementing ${(narrative.solutionFit?.primaryProducts || ['PathSynch solutions']).join(', ')} to achieve measurable improvements in customer acquisition, retention, and online reputation.`,
                    expectedOutcome: narrative.roiStory?.headline || 'Significant improvement in key business metrics within 90 days.'
                },
                aboutPathSynch: {
                    companyOverview: 'PathSynch is a leading platform for local business growth, helping thousands of businesses improve their online presence, manage their reputation, and connect with customers.',
                    missionStatement: 'We empower local businesses to thrive in the digital age through innovative, easy-to-use solutions.',
                    relevantExperience: 'PathSynch has helped businesses across multiple industries achieve measurable growth in visibility, customer engagement, and revenue.'
                },
                businessUnderstanding: {
                    profile: narrative.businessStory?.currentState || `${businessName} operates in a competitive local market.`,
                    currentSituation: narrative.businessStory?.currentState || 'The business has opportunities to strengthen its online presence and customer engagement.',
                    goalsObjectives: [
                        'Increase online visibility',
                        'Improve customer engagement',
                        'Grow revenue through reputation',
                        narrative.businessStory?.desiredState || 'Achieve sustainable growth'
                    ].slice(0, 4)
                },
                challengesIdentified: {
                    painPoints: narrative.painPoints?.slice(0, 4).map(pp => ({
                        challenge: pp.title,
                        impact: pp.impact || pp.description,
                        costOfInaction: 'Continued lost opportunity and competitive disadvantage'
                    })) || []
                },
                proposedSolution: {
                    overview: 'We propose a tailored PathSynch implementation designed specifically for your business needs.',
                    products: narrative.solutionFit?.useCases?.map(uc => ({
                        name: uc.product,
                        description: `Comprehensive ${uc.product} solution`,
                        howItHelps: uc.outcome,
                        keyFeatures: ['Easy setup', 'Dedicated support', 'Measurable results']
                    })) || [],
                    implementationApproach: 'Phased implementation with dedicated onboarding support'
                },
                scopeOfWork: {
                    deliverables: [
                        { item: 'Platform Setup', description: 'Complete configuration of PathSynch products' },
                        { item: 'Integration', description: 'Connect with existing systems and profiles' },
                        { item: 'Training', description: 'Team training on all features' },
                        { item: 'Ongoing Support', description: 'Dedicated success manager' }
                    ],
                    timeline: {
                        totalDuration: '30-60 days',
                        milestones: [
                            { milestone: 'Kickoff', timing: 'Week 1', deliverable: 'Account setup and planning' },
                            { milestone: 'Configuration', timing: 'Week 2-3', deliverable: 'Platform configuration' },
                            { milestone: 'Training', timing: 'Week 4', deliverable: 'Team training completion' },
                            { milestone: 'Go Live', timing: 'Week 5', deliverable: 'Full launch and optimization' }
                        ]
                    }
                },
                investmentAndRoi: {
                    pricing: {
                        summary: 'Custom pricing based on your specific needs',
                        details: [
                            { item: 'Platform Access', price: 'Contact for pricing', frequency: 'Monthly' },
                            { item: 'Implementation', price: 'Included', frequency: 'One-time' },
                            { item: 'Support', price: 'Included', frequency: 'Ongoing' }
                        ],
                        total: 'Contact for custom quote'
                    },
                    roiProjection: {
                        metrics: narrative.roiStory?.keyMetrics?.map(m => ({
                            metric: m.metric,
                            current: m.current,
                            projected: m.projected,
                            value: 'Significant improvement'
                        })) || [],
                        paybackPeriod: '3-6 months',
                        annualizedReturn: 'Positive ROI expected'
                    }
                },
                implementationPlan: {
                    onboardingProcess: 'Dedicated onboarding specialist guides you through setup, configuration, and launch.',
                    trainingIncluded: [
                        'Platform overview and navigation',
                        'Feature-specific training',
                        'Best practices and optimization',
                        'Ongoing education resources'
                    ],
                    supportStructure: {
                        channels: ['Email', 'Phone', 'Chat', 'Knowledge Base'],
                        responseTime: '24-hour response guarantee',
                        dedicatedSupport: 'Named success manager for your account'
                    }
                },
                termsAndConditions: {
                    serviceAgreement: 'Standard PathSynch service agreement applies',
                    commitmentTerms: 'Flexible monthly or annual options available',
                    cancellationPolicy: 'Cancel anytime with 30-day notice',
                    guarantee: 'Satisfaction guarantee on implementation'
                },
                nextSteps: {
                    acceptanceProcess: 'Sign agreement and schedule kickoff call',
                    contactInfo: {
                        name: options.salesRep || 'PathSynch Team',
                        email: options.salesEmail || 'contact@pathsynch.com',
                        phone: options.salesPhone || '',
                        calendlyLink: options.calendlyLink || ''
                    },
                    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                    urgencyNote: 'Pricing and availability guaranteed for 30 days'
                }
            },
            proposalMetadata: {
                version: '1.0',
                pageCount: '8-10 pages',
                customizationNotes: 'Customize pricing and contact details before sending'
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { proposal, proposalMetadata } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        @page {
            size: letter;
            margin: 1in;
        }
        body {
            font-family: 'Georgia', 'Times New Roman', serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            line-height: 1.8;
            color: #333;
        }
        .cover-page {
            text-align: center;
            padding: 100px 0;
            page-break-after: always;
        }
        .cover-page h1 {
            color: {{primaryColor}};
            font-size: 36px;
            margin-bottom: 10px;
        }
        .cover-page .subtitle {
            font-size: 18px;
            color: #666;
            margin-bottom: 60px;
        }
        .cover-details {
            text-align: left;
            max-width: 400px;
            margin: 60px auto;
        }
        .cover-details .section {
            margin-bottom: 30px;
        }
        .cover-details .label {
            font-size: 12px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .section-header {
            color: {{primaryColor}};
            font-size: 24px;
            border-bottom: 2px solid {{primaryColor}};
            padding-bottom: 10px;
            margin: 40px 0 20px 0;
            page-break-after: avoid;
        }
        .subsection-header {
            color: #555;
            font-size: 18px;
            margin: 25px 0 15px 0;
        }
        .highlight-box {
            background: {{primaryColor}}10;
            border-left: 4px solid {{primaryColor}};
            padding: 15px 20px;
            margin: 20px 0;
        }
        .highlight-box.recommendation {
            background: #ecfdf5;
            border-color: #10b981;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        th {
            background: {{primaryColor}};
            color: white;
        }
        .product-card {
            background: #f9fafb;
            padding: 20px;
            border-radius: 8px;
            margin: 15px 0;
            page-break-inside: avoid;
        }
        .product-card h4 {
            color: {{primaryColor}};
            margin: 0 0 10px 0;
        }
        .timeline {
            position: relative;
            padding-left: 30px;
        }
        .timeline::before {
            content: '';
            position: absolute;
            left: 10px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: {{primaryColor}};
        }
        .timeline-item {
            position: relative;
            margin-bottom: 20px;
            padding-left: 20px;
        }
        .timeline-item::before {
            content: '';
            position: absolute;
            left: -24px;
            top: 5px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: {{primaryColor}};
        }
        .timeline-item .timing {
            font-weight: 600;
            color: {{primaryColor}};
        }
        .cta-box {
            background: {{primaryColor}};
            color: white;
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            margin: 40px 0;
        }
        .cta-box h3 {
            margin: 0 0 15px 0;
        }
        .validity {
            background: #fef3c7;
            padding: 15px 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
        }
        .footer {
            text-align: center;
            color: #999;
            font-size: 12px;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }
    </style>
</head>
<body>
    <div class="cover-page">
        {{logoPlaceholder}}
        <h1>${this.escapeHtml(proposal?.coverPage?.title || '')}</h1>
        <div class="subtitle">${this.escapeHtml(proposal?.coverPage?.subtitle || '')}</div>

        <div class="cover-details">
            <div class="section">
                <div class="label">Prepared For</div>
                <div><strong>${this.escapeHtml(proposal?.coverPage?.preparedFor?.businessName || '')}</strong></div>
                <div>${this.escapeHtml(proposal?.coverPage?.preparedFor?.contactName || '')}</div>
                <div>${this.escapeHtml(proposal?.coverPage?.preparedFor?.address || '')}</div>
            </div>
            <div class="section">
                <div class="label">Prepared By</div>
                <div><strong>${this.escapeHtml(proposal?.coverPage?.preparedBy?.companyName || '')}</strong></div>
                <div>${this.escapeHtml(proposal?.coverPage?.preparedBy?.contactName || '')}</div>
                <div>${this.escapeHtml(proposal?.coverPage?.preparedBy?.title || '')}</div>
            </div>
            <div class="section">
                <div class="label">Date</div>
                <div>${this.escapeHtml(proposal?.coverPage?.date || '')}</div>
                <div>Proposal #${this.escapeHtml(proposal?.coverPage?.proposalNumber || '')}</div>
            </div>
        </div>
    </div>

    <h2 class="section-header">Executive Summary</h2>
    <p>${this.escapeHtml(proposal?.executiveSummary?.overview || '')}</p>
    <div class="highlight-box recommendation">
        <strong>Recommendation:</strong> ${this.escapeHtml(proposal?.executiveSummary?.recommendation || '')}
    </div>
    <p><strong>Expected Outcome:</strong> ${this.escapeHtml(proposal?.executiveSummary?.expectedOutcome || '')}</p>

    <h2 class="section-header">About PathSynch</h2>
    <p>${this.escapeHtml(proposal?.aboutPathSynch?.companyOverview || '')}</p>
    <div class="highlight-box">
        <strong>Our Mission:</strong> ${this.escapeHtml(proposal?.aboutPathSynch?.missionStatement || '')}
    </div>
    <p>${this.escapeHtml(proposal?.aboutPathSynch?.relevantExperience || '')}</p>

    <h2 class="section-header">Understanding Your Business</h2>
    <p>${this.escapeHtml(proposal?.businessUnderstanding?.profile || '')}</p>
    <h3 class="subsection-header">Current Situation</h3>
    <p>${this.escapeHtml(proposal?.businessUnderstanding?.currentSituation || '')}</p>
    <h3 class="subsection-header">Goals & Objectives</h3>
    <ul>
        ${(proposal?.businessUnderstanding?.goalsObjectives || []).map(g => `<li>${this.escapeHtml(g)}</li>`).join('')}
    </ul>

    <h2 class="section-header">Challenges Identified</h2>
    ${(proposal?.challengesIdentified?.painPoints || []).map(pp => `
        <div class="product-card">
            <h4>${this.escapeHtml(pp.challenge || '')}</h4>
            <p><strong>Impact:</strong> ${this.escapeHtml(pp.impact || '')}</p>
            <p><strong>Cost of Inaction:</strong> ${this.escapeHtml(pp.costOfInaction || '')}</p>
        </div>
    `).join('')}

    <h2 class="section-header">Proposed Solution</h2>
    <p>${this.escapeHtml(proposal?.proposedSolution?.overview || '')}</p>
    ${(proposal?.proposedSolution?.products || []).map(p => `
        <div class="product-card">
            <h4>${this.escapeHtml(p.name || '')}</h4>
            <p>${this.escapeHtml(p.description || '')}</p>
            <p><strong>How It Helps:</strong> ${this.escapeHtml(p.howItHelps || '')}</p>
            <p><strong>Key Features:</strong> ${(p.keyFeatures || []).map(f => this.escapeHtml(f)).join(', ')}</p>
        </div>
    `).join('')}
    <p><strong>Implementation Approach:</strong> ${this.escapeHtml(proposal?.proposedSolution?.implementationApproach || '')}</p>

    <h2 class="section-header">Scope of Work</h2>
    <h3 class="subsection-header">Deliverables</h3>
    <table>
        <thead>
            <tr><th>Item</th><th>Description</th></tr>
        </thead>
        <tbody>
            ${(proposal?.scopeOfWork?.deliverables || []).map(d => `
                <tr><td><strong>${this.escapeHtml(d.item || '')}</strong></td><td>${this.escapeHtml(d.description || '')}</td></tr>
            `).join('')}
        </tbody>
    </table>

    <h3 class="subsection-header">Timeline (${this.escapeHtml(proposal?.scopeOfWork?.timeline?.totalDuration || '')})</h3>
    <div class="timeline">
        ${(proposal?.scopeOfWork?.timeline?.milestones || []).map(m => `
            <div class="timeline-item">
                <div class="timing">${this.escapeHtml(m.timing || '')}: ${this.escapeHtml(m.milestone || '')}</div>
                <div>${this.escapeHtml(m.deliverable || '')}</div>
            </div>
        `).join('')}
    </div>

    <h2 class="section-header">Investment & ROI</h2>
    <h3 class="subsection-header">Pricing</h3>
    <p>${this.escapeHtml(proposal?.investmentAndRoi?.pricing?.summary || '')}</p>
    <table>
        <thead>
            <tr><th>Item</th><th>Price</th><th>Frequency</th></tr>
        </thead>
        <tbody>
            ${(proposal?.investmentAndRoi?.pricing?.details || []).map(d => `
                <tr><td>${this.escapeHtml(d.item || '')}</td><td>${this.escapeHtml(d.price || '')}</td><td>${this.escapeHtml(d.frequency || '')}</td></tr>
            `).join('')}
        </tbody>
    </table>

    <h3 class="subsection-header">ROI Projection</h3>
    <table>
        <thead>
            <tr><th>Metric</th><th>Current</th><th>Projected</th></tr>
        </thead>
        <tbody>
            ${(proposal?.investmentAndRoi?.roiProjection?.metrics || []).map(m => `
                <tr><td>${this.escapeHtml(m.metric || '')}</td><td>${this.escapeHtml(m.current || '')}</td><td><strong>${this.escapeHtml(m.projected || '')}</strong></td></tr>
            `).join('')}
        </tbody>
    </table>
    <p><strong>Payback Period:</strong> ${this.escapeHtml(proposal?.investmentAndRoi?.roiProjection?.paybackPeriod || '')}</p>

    <h2 class="section-header">Implementation Plan</h2>
    <p>${this.escapeHtml(proposal?.implementationPlan?.onboardingProcess || '')}</p>
    <h3 class="subsection-header">Training Included</h3>
    <ul>
        ${(proposal?.implementationPlan?.trainingIncluded || []).map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}
    </ul>
    <h3 class="subsection-header">Support Structure</h3>
    <p><strong>Channels:</strong> ${(proposal?.implementationPlan?.supportStructure?.channels || []).join(', ')}</p>
    <p><strong>Response Time:</strong> ${this.escapeHtml(proposal?.implementationPlan?.supportStructure?.responseTime || '')}</p>
    <p><strong>Dedicated Support:</strong> ${this.escapeHtml(proposal?.implementationPlan?.supportStructure?.dedicatedSupport || '')}</p>

    <h2 class="section-header">Terms & Conditions</h2>
    <p><strong>Service Agreement:</strong> ${this.escapeHtml(proposal?.termsAndConditions?.serviceAgreement || '')}</p>
    <p><strong>Commitment:</strong> ${this.escapeHtml(proposal?.termsAndConditions?.commitmentTerms || '')}</p>
    <p><strong>Cancellation:</strong> ${this.escapeHtml(proposal?.termsAndConditions?.cancellationPolicy || '')}</p>
    <p><strong>Guarantee:</strong> ${this.escapeHtml(proposal?.termsAndConditions?.guarantee || '')}</p>

    <h2 class="section-header">Next Steps</h2>
    <p>${this.escapeHtml(proposal?.nextSteps?.acceptanceProcess || '')}</p>

    <div class="cta-box">
        <h3>Ready to Get Started?</h3>
        <p>${this.escapeHtml(proposal?.nextSteps?.contactInfo?.name || '')}</p>
        <p>${this.escapeHtml(proposal?.nextSteps?.contactInfo?.email || '')}</p>
        ${proposal?.nextSteps?.contactInfo?.phone ? `<p>${this.escapeHtml(proposal.nextSteps.contactInfo.phone)}</p>` : ''}
        ${proposal?.nextSteps?.contactInfo?.calendlyLink ? `<p><a href="${this.escapeHtml(proposal.nextSteps.contactInfo.calendlyLink)}" style="color: white;">Schedule a Call</a></p>` : ''}
    </div>

    <div class="validity">
        <strong>This proposal is valid until:</strong> ${this.escapeHtml(proposal?.nextSteps?.validUntil || '')}
        <br>${this.escapeHtml(proposal?.nextSteps?.urgencyNote || '')}
    </div>

    <div class="footer">
        Proposal #${this.escapeHtml(proposal?.coverPage?.proposalNumber || '')} | Version ${this.escapeHtml(proposalMetadata?.version || '1.0')}
        {{poweredBy}}
    </div>
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { proposal } = formattedContent;

        return `
${'═'.repeat(60)}
${proposal?.coverPage?.title || 'BUSINESS PROPOSAL'}
${'═'.repeat(60)}
${proposal?.coverPage?.subtitle || ''}

Prepared For: ${proposal?.coverPage?.preparedFor?.businessName || ''}
              ${proposal?.coverPage?.preparedFor?.contactName || ''}
Prepared By:  ${proposal?.coverPage?.preparedBy?.companyName || ''}
              ${proposal?.coverPage?.preparedBy?.contactName || ''}
Date:         ${proposal?.coverPage?.date || ''}
Proposal #:   ${proposal?.coverPage?.proposalNumber || ''}

${'─'.repeat(60)}
EXECUTIVE SUMMARY
${'─'.repeat(60)}

${proposal?.executiveSummary?.overview || ''}

>>> RECOMMENDATION: ${proposal?.executiveSummary?.recommendation || ''} <<<

Expected Outcome: ${proposal?.executiveSummary?.expectedOutcome || ''}

${'─'.repeat(60)}
ABOUT PATHSYNCH
${'─'.repeat(60)}

${proposal?.aboutPathSynch?.companyOverview || ''}

Mission: ${proposal?.aboutPathSynch?.missionStatement || ''}

${proposal?.aboutPathSynch?.relevantExperience || ''}

${'─'.repeat(60)}
UNDERSTANDING YOUR BUSINESS
${'─'.repeat(60)}

${proposal?.businessUnderstanding?.profile || ''}

Current Situation:
${proposal?.businessUnderstanding?.currentSituation || ''}

Goals & Objectives:
${(proposal?.businessUnderstanding?.goalsObjectives || []).map(g => `  • ${g}`).join('\n')}

${'─'.repeat(60)}
CHALLENGES IDENTIFIED
${'─'.repeat(60)}

${(proposal?.challengesIdentified?.painPoints || []).map(pp => `
${pp.challenge}
  Impact: ${pp.impact}
  Cost of Inaction: ${pp.costOfInaction}
`).join('\n')}

${'─'.repeat(60)}
PROPOSED SOLUTION
${'─'.repeat(60)}

${proposal?.proposedSolution?.overview || ''}

${(proposal?.proposedSolution?.products || []).map(p => `
${p.name}
  ${p.description}
  How It Helps: ${p.howItHelps}
  Features: ${(p.keyFeatures || []).join(', ')}
`).join('\n')}

Implementation: ${proposal?.proposedSolution?.implementationApproach || ''}

${'─'.repeat(60)}
INVESTMENT & ROI
${'─'.repeat(60)}

${proposal?.investmentAndRoi?.pricing?.summary || ''}

${(proposal?.investmentAndRoi?.roiProjection?.metrics || []).map(m => `${m.metric}: ${m.current} → ${m.projected}`).join('\n')}

Payback Period: ${proposal?.investmentAndRoi?.roiProjection?.paybackPeriod || ''}

${'─'.repeat(60)}
NEXT STEPS
${'─'.repeat(60)}

${proposal?.nextSteps?.acceptanceProcess || ''}

Contact:
  ${proposal?.nextSteps?.contactInfo?.name || ''}
  ${proposal?.nextSteps?.contactInfo?.email || ''}
  ${proposal?.nextSteps?.contactInfo?.phone || ''}

Valid Until: ${proposal?.nextSteps?.validUntil || ''}
${proposal?.nextSteps?.urgencyNote || ''}
`;
    }

    toMarkdown(formattedContent) {
        const { proposal, proposalMetadata } = formattedContent;

        return `# ${proposal?.coverPage?.title || 'Business Proposal'}

*${proposal?.coverPage?.subtitle || ''}*

---

| | |
|---|---|
| **Prepared For** | ${proposal?.coverPage?.preparedFor?.businessName || ''} |
| **Contact** | ${proposal?.coverPage?.preparedFor?.contactName || ''} |
| **Prepared By** | ${proposal?.coverPage?.preparedBy?.companyName || ''} |
| **Date** | ${proposal?.coverPage?.date || ''} |
| **Proposal #** | ${proposal?.coverPage?.proposalNumber || ''} |

---

## Executive Summary

${proposal?.executiveSummary?.overview || ''}

> **Recommendation:** ${proposal?.executiveSummary?.recommendation || ''}

**Expected Outcome:** ${proposal?.executiveSummary?.expectedOutcome || ''}

---

## About PathSynch

${proposal?.aboutPathSynch?.companyOverview || ''}

> **Our Mission:** ${proposal?.aboutPathSynch?.missionStatement || ''}

${proposal?.aboutPathSynch?.relevantExperience || ''}

---

## Understanding Your Business

${proposal?.businessUnderstanding?.profile || ''}

### Current Situation
${proposal?.businessUnderstanding?.currentSituation || ''}

### Goals & Objectives
${(proposal?.businessUnderstanding?.goalsObjectives || []).map(g => `- ${g}`).join('\n')}

---

## Challenges Identified

${(proposal?.challengesIdentified?.painPoints || []).map(pp => `
### ${pp.challenge}

**Impact:** ${pp.impact}

**Cost of Inaction:** ${pp.costOfInaction}
`).join('\n')}

---

## Proposed Solution

${proposal?.proposedSolution?.overview || ''}

${(proposal?.proposedSolution?.products || []).map(p => `
### ${p.name}

${p.description}

**How It Helps:** ${p.howItHelps}

**Key Features:** ${(p.keyFeatures || []).join(', ')}
`).join('\n')}

**Implementation Approach:** ${proposal?.proposedSolution?.implementationApproach || ''}

---

## Investment & ROI

### Pricing

${proposal?.investmentAndRoi?.pricing?.summary || ''}

| Item | Price | Frequency |
|------|-------|-----------|
${(proposal?.investmentAndRoi?.pricing?.details || []).map(d => `| ${d.item} | ${d.price} | ${d.frequency} |`).join('\n')}

### ROI Projection

| Metric | Current | Projected |
|--------|---------|-----------|
${(proposal?.investmentAndRoi?.roiProjection?.metrics || []).map(m => `| ${m.metric} | ${m.current} | ${m.projected} |`).join('\n')}

**Payback Period:** ${proposal?.investmentAndRoi?.roiProjection?.paybackPeriod || ''}

---

## Next Steps

${proposal?.nextSteps?.acceptanceProcess || ''}

### Contact Information

- **Name:** ${proposal?.nextSteps?.contactInfo?.name || ''}
- **Email:** ${proposal?.nextSteps?.contactInfo?.email || ''}
${proposal?.nextSteps?.contactInfo?.phone ? `- **Phone:** ${proposal.nextSteps.contactInfo.phone}` : ''}
${proposal?.nextSteps?.contactInfo?.calendlyLink ? `- **Schedule:** [Book a call](${proposal.nextSteps.contactInfo.calendlyLink})` : ''}

---

> **Valid Until:** ${proposal?.nextSteps?.validUntil || ''}
>
> ${proposal?.nextSteps?.urgencyNote || ''}

---

*Proposal #${proposal?.coverPage?.proposalNumber || ''} | Version ${proposalMetadata?.version || '1.0'}*
`;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            documentType: 'Business Proposal',
            proposalNumber: formattedContent.proposal?.coverPage?.proposalNumber || '',
            validUntil: formattedContent.proposal?.nextSteps?.validUntil || ''
        };
    }
}

module.exports = { ProposalFormatter };
