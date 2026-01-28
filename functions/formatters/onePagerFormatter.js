/**
 * One-Pager Formatter
 *
 * Generates single-page PDF-ready sales documents
 */

const { BaseFormatter } = require('./baseFormatter');
const { formatNarrative } = require('../services/claudeClient');
const { ONE_PAGER_PROMPT } = require('../services/prompts/onePagerPrompt');

class OnePagerFormatter extends BaseFormatter {
    constructor() {
        super('one_pager', 'starter');
    }

    getSystemPrompt() {
        return ONE_PAGER_PROMPT;
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
            console.error('Failed to parse one-pager response:', error);
            formatted = this.fallbackFormat(narrative);
        }

        return {
            ...formatted,
            usage: result.usage
        };
    }

    fallbackFormat(narrative) {
        return {
            onePager: {
                header: {
                    businessName: narrative.businessStory?.headline?.split(':')[0] || 'Your Business',
                    headline: narrative.businessStory?.headline || 'Growth Opportunity Assessment',
                    subheadline: narrative.businessStory?.valueProposition || 'Unlock your business potential'
                },
                challenge: {
                    intro: 'Key challenges identified:',
                    painPoints: narrative.painPoints?.slice(0, 3).map(pp => ({
                        icon: pp.category === 'discovery' ? '🔍' : pp.category === 'retention' ? '🔄' : '📊',
                        title: pp.title,
                        description: pp.description
                    })) || []
                },
                solution: {
                    intro: 'Recommended PathSynch solutions:',
                    products: narrative.solutionFit?.useCases?.slice(0, 3).map(uc => ({
                        name: uc.product,
                        benefit: uc.outcome,
                        icon: '✓'
                    })) || []
                },
                roi: {
                    headline: narrative.roiStory?.headline || 'Your Growth Potential',
                    metrics: narrative.roiStory?.keyMetrics?.slice(0, 3).map(m => ({
                        label: m.metric,
                        current: m.current,
                        projected: m.projected,
                        improvement: 'Significant'
                    })) || [],
                    bottomLine: 'Measurable results within 90 days'
                },
                proof: {
                    reviewSummary: `${narrative.proofPoints?.sentiment?.positive || 0}% positive sentiment`,
                    highlights: narrative.proofPoints?.differentiators?.slice(0, 3) || []
                },
                cta: {
                    headline: narrative.ctaHooks?.[0]?.headline || 'Ready to Grow?',
                    action: narrative.ctaHooks?.[0]?.action || 'Schedule your free consultation',
                    urgency: 'Limited spots available this month'
                }
            },
            layoutNotes: {
                suggestedSections: 'Header at top, 2-column layout for challenge/solution, ROI centered',
                colorAccents: 'Use brand color for headlines and icons'
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { onePager } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        @page {
            size: letter;
            margin: 0.5in;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 8.5in;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.4;
            color: #333;
            font-size: 11px;
        }
        .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 3px solid {{primaryColor}};
            margin-bottom: 20px;
        }
        .header h1 {
            color: {{primaryColor}};
            margin: 0 0 5px 0;
            font-size: 24px;
        }
        .header .headline {
            font-size: 18px;
            font-weight: 600;
            margin: 10px 0 5px 0;
        }
        .header .subheadline {
            color: #666;
            font-size: 14px;
        }
        .two-column {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        .column {
            flex: 1;
        }
        .section-title {
            font-size: 14px;
            font-weight: 700;
            color: {{primaryColor}};
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 2px solid {{primaryColor}};
        }
        .pain-point {
            display: flex;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: 8px;
            background: #f9fafb;
            border-radius: 4px;
        }
        .pain-point .icon {
            font-size: 16px;
            margin-right: 10px;
            flex-shrink: 0;
        }
        .pain-point .content h4 {
            margin: 0 0 4px 0;
            font-size: 12px;
        }
        .pain-point .content p {
            margin: 0;
            color: #666;
            font-size: 10px;
        }
        .product-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: 8px;
            background: #f0fdf4;
            border-radius: 4px;
            border-left: 3px solid {{primaryColor}};
        }
        .product-item .icon {
            color: {{primaryColor}};
            font-weight: bold;
            margin-right: 10px;
        }
        .product-item h4 {
            margin: 0 0 4px 0;
            font-size: 12px;
        }
        .product-item p {
            margin: 0;
            color: #666;
            font-size: 10px;
        }
        .roi-section {
            background: linear-gradient(135deg, {{primaryColor}}10, {{primaryColor}}05);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .roi-section h3 {
            color: {{primaryColor}};
            margin: 0 0 15px 0;
            font-size: 16px;
            text-align: center;
        }
        .metrics-grid {
            display: flex;
            justify-content: space-around;
            gap: 10px;
        }
        .metric-card {
            text-align: center;
            flex: 1;
            padding: 10px;
            background: white;
            border-radius: 4px;
        }
        .metric-card .label {
            font-size: 10px;
            color: #666;
            margin-bottom: 5px;
        }
        .metric-card .values {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
        }
        .metric-card .current {
            color: #999;
            text-decoration: line-through;
            font-size: 12px;
        }
        .metric-card .projected {
            color: {{primaryColor}};
            font-weight: 700;
            font-size: 16px;
        }
        .metric-card .improvement {
            font-size: 10px;
            color: #10b981;
            font-weight: 600;
        }
        .bottom-line {
            text-align: center;
            font-weight: 600;
            margin-top: 10px;
            color: {{primaryColor}};
        }
        .proof-section {
            background: #f9fafb;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .proof-section p {
            margin: 0 0 8px 0;
        }
        .highlights {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .highlight-tag {
            background: {{primaryColor}};
            color: white;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 10px;
        }
        .cta-section {
            background: {{primaryColor}};
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .cta-section h3 {
            margin: 0 0 10px 0;
            font-size: 18px;
        }
        .cta-section .action {
            font-size: 14px;
            margin-bottom: 8px;
        }
        .cta-section .urgency {
            font-size: 11px;
            opacity: 0.9;
        }
        .footer {
            margin-top: 15px;
            text-align: center;
            color: #999;
            font-size: 9px;
        }
    </style>
</head>
<body>
    <div class="header">
        {{logoPlaceholder}}
        <h1>${this.escapeHtml(onePager?.header?.businessName || '')}</h1>
        <div class="headline">${this.escapeHtml(onePager?.header?.headline || '')}</div>
        <div class="subheadline">${this.escapeHtml(onePager?.header?.subheadline || '')}</div>
    </div>

    <div class="two-column">
        <div class="column">
            <div class="section-title">The Challenge</div>
            <p style="margin-top: 0; font-size: 11px;">${this.escapeHtml(onePager?.challenge?.intro || '')}</p>
            ${(onePager?.challenge?.painPoints || []).map(pp => `
                <div class="pain-point">
                    <span class="icon">${pp.icon || '⚠️'}</span>
                    <div class="content">
                        <h4>${this.escapeHtml(pp.title || '')}</h4>
                        <p>${this.escapeHtml(pp.description || '')}</p>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="column">
            <div class="section-title">The Solution</div>
            <p style="margin-top: 0; font-size: 11px;">${this.escapeHtml(onePager?.solution?.intro || '')}</p>
            ${(onePager?.solution?.products || []).map(p => `
                <div class="product-item">
                    <span class="icon">${p.icon || '✓'}</span>
                    <div>
                        <h4>${this.escapeHtml(p.name || '')}</h4>
                        <p>${this.escapeHtml(p.benefit || '')}</p>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <div class="roi-section">
        <h3>${this.escapeHtml(onePager?.roi?.headline || 'Your Growth Potential')}</h3>
        <div class="metrics-grid">
            ${(onePager?.roi?.metrics || []).map(m => `
                <div class="metric-card">
                    <div class="label">${this.escapeHtml(m.label || '')}</div>
                    <div class="values">
                        <span class="current">${this.escapeHtml(m.current || '')}</span>
                        <span class="projected">${this.escapeHtml(m.projected || '')}</span>
                    </div>
                    <div class="improvement">${this.escapeHtml(m.improvement || '')}</div>
                </div>
            `).join('')}
        </div>
        <div class="bottom-line">${this.escapeHtml(onePager?.roi?.bottomLine || '')}</div>
    </div>

    <div class="proof-section">
        <p><strong>Your Reputation:</strong> ${this.escapeHtml(onePager?.proof?.reviewSummary || '')}</p>
        <div class="highlights">
            ${(onePager?.proof?.highlights || []).map(h => `
                <span class="highlight-tag">${this.escapeHtml(h)}</span>
            `).join('')}
        </div>
    </div>

    <div class="cta-section">
        <h3>${this.escapeHtml(onePager?.cta?.headline || '')}</h3>
        <div class="action">${this.escapeHtml(onePager?.cta?.action || '')}</div>
        <div class="urgency">${this.escapeHtml(onePager?.cta?.urgency || '')}</div>
    </div>

    <div class="footer">
        {{poweredBy}}
    </div>
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { onePager } = formattedContent;

        return `${onePager?.header?.businessName || ''}
${'='.repeat(50)}
${onePager?.header?.headline || ''}
${onePager?.header?.subheadline || ''}

THE CHALLENGE
-------------
${onePager?.challenge?.intro || ''}

${(onePager?.challenge?.painPoints || []).map(pp => `• ${pp.title}: ${pp.description}`).join('\n')}

THE SOLUTION
------------
${onePager?.solution?.intro || ''}

${(onePager?.solution?.products || []).map(p => `✓ ${p.name}: ${p.benefit}`).join('\n')}

YOUR GROWTH POTENTIAL
---------------------
${onePager?.roi?.headline || ''}

${(onePager?.roi?.metrics || []).map(m => `${m.label}: ${m.current} → ${m.projected} (${m.improvement})`).join('\n')}

${onePager?.roi?.bottomLine || ''}

YOUR REPUTATION
---------------
${onePager?.proof?.reviewSummary || ''}
Highlights: ${(onePager?.proof?.highlights || []).join(' | ')}

${onePager?.cta?.headline || ''}
${onePager?.cta?.action || ''}
${onePager?.cta?.urgency || ''}
`;
    }

    toMarkdown(formattedContent) {
        const { onePager } = formattedContent;

        return `# ${onePager?.header?.businessName || ''}

## ${onePager?.header?.headline || ''}

*${onePager?.header?.subheadline || ''}*

---

## The Challenge

${onePager?.challenge?.intro || ''}

${(onePager?.challenge?.painPoints || []).map(pp => `### ${pp.icon || '⚠️'} ${pp.title}

${pp.description}
`).join('\n')}

---

## The Solution

${onePager?.solution?.intro || ''}

${(onePager?.solution?.products || []).map(p => `### ✓ ${p.name}

${p.benefit}
`).join('\n')}

---

## Your Growth Potential

**${onePager?.roi?.headline || ''}**

| Metric | Current | Projected | Change |
|--------|---------|-----------|--------|
${(onePager?.roi?.metrics || []).map(m => `| ${m.label} | ${m.current} | ${m.projected} | ${m.improvement} |`).join('\n')}

**${onePager?.roi?.bottomLine || ''}**

---

## Your Reputation

${onePager?.proof?.reviewSummary || ''}

**Highlights:** ${(onePager?.proof?.highlights || []).join(' | ')}

---

## ${onePager?.cta?.headline || ''}

**${onePager?.cta?.action || ''}**

*${onePager?.cta?.urgency || ''}*
`;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            pageCount: 1,
            format: 'Letter (8.5" x 11")'
        };
    }
}

module.exports = { OnePagerFormatter };
