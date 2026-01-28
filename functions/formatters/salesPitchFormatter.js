/**
 * Sales Pitch Formatter
 *
 * Generates verbal pitch scripts for sales conversations
 */

const { BaseFormatter } = require('./baseFormatter');
const { formatNarrative } = require('../services/claudeClient');
const { SALES_PITCH_PROMPT } = require('../services/prompts/salesPitchPrompt');

class SalesPitchFormatter extends BaseFormatter {
    constructor() {
        super('sales_pitch', 'starter');
    }

    getSystemPrompt() {
        return SALES_PITCH_PROMPT;
    }

    async format(narrative, options = {}) {
        const result = await formatNarrative(
            this.getSystemPrompt(),
            narrative,
            this.assetType,
            options
        );

        // Parse the JSON response
        let formatted;
        try {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                formatted = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (error) {
            console.error('Failed to parse sales pitch response:', error);
            // Return a basic structure from narrative
            formatted = this.fallbackFormat(narrative);
        }

        return {
            ...formatted,
            usage: result.usage
        };
    }

    fallbackFormat(narrative) {
        return {
            pitch: {
                opener: {
                    greeting: `Hi, is this the owner of ${narrative.businessStory?.headline?.split(' ')[0] || 'the business'}?`,
                    hook: narrative.businessStory?.valueProposition || 'I noticed your business online and wanted to share something with you.',
                    transition: 'I have some ideas that could help your business grow.'
                },
                discoveryBridge: {
                    acknowledgment: narrative.businessStory?.currentState || 'I understand running a local business comes with challenges.',
                    painPointsHighlight: narrative.painPoints?.[0]?.description || 'Many businesses struggle with online visibility.',
                    empathyStatement: 'I work with businesses just like yours every day.'
                },
                valuePresentation: {
                    benefits: narrative.valueProps?.slice(0, 3).map(vp => ({
                        title: vp.title,
                        explanation: vp.benefit,
                        businessSpecificExample: vp.proof
                    })) || []
                },
                proofPoints: {
                    dataPoints: narrative.proofPoints?.differentiators || [],
                    roiHighlight: narrative.roiStory?.headline || 'We help businesses grow their revenue.'
                },
                solutionFit: {
                    recommendedProducts: narrative.solutionFit?.primaryProducts || [],
                    implementationVision: narrative.businessStory?.desiredState || 'Imagine having more customers finding you online.'
                },
                callToAction: {
                    primaryAsk: narrative.ctaHooks?.[0]?.action || 'Can we schedule a quick call to discuss?',
                    urgencyHook: narrative.ctaHooks?.[0]?.headline || 'The sooner we start, the sooner you see results.',
                    closeQuestion: 'Does that sound like something worth exploring?'
                }
            },
            metadata: {
                estimatedDuration: '3-4 minutes',
                toneNotes: 'Keep it conversational and focus on their specific situation',
                objectionsToAnticipate: ['Budget concerns', 'Time constraints', 'Previous bad experiences']
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { pitch, metadata } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid {{primaryColor}};
        }
        .section {
            margin-bottom: 30px;
            padding: 20px;
            background: #f9fafb;
            border-radius: 8px;
            border-left: 4px solid {{primaryColor}};
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: {{primaryColor}};
            text-transform: uppercase;
            margin-bottom: 15px;
            letter-spacing: 1px;
        }
        .script-text {
            font-style: italic;
            color: #555;
            margin: 10px 0;
            padding: 10px;
            background: white;
            border-radius: 4px;
        }
        .benefits-list {
            list-style: none;
            padding: 0;
        }
        .benefits-list li {
            margin: 15px 0;
            padding: 15px;
            background: white;
            border-radius: 4px;
        }
        .benefit-title {
            font-weight: 600;
            color: {{primaryColor}};
        }
        .metadata {
            margin-top: 40px;
            padding: 20px;
            background: #e5e7eb;
            border-radius: 8px;
        }
        .metadata-title {
            font-weight: 600;
            margin-bottom: 10px;
        }
        .objections {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
        }
        .objection-tag {
            background: {{primaryColor}};
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        {{logoPlaceholder}}
        <h1>Sales Pitch Script</h1>
        <p>Estimated Duration: ${this.escapeHtml(metadata?.estimatedDuration || '3-4 minutes')}</p>
    </div>

    <div class="section">
        <div class="section-title">1. Opener (30 seconds)</div>
        <div class="script-text">"${this.escapeHtml(pitch?.opener?.greeting || '')}"</div>
        <div class="script-text">"${this.escapeHtml(pitch?.opener?.hook || '')}"</div>
        <div class="script-text">"${this.escapeHtml(pitch?.opener?.transition || '')}"</div>
    </div>

    <div class="section">
        <div class="section-title">2. Discovery Bridge (30 seconds)</div>
        <div class="script-text">"${this.escapeHtml(pitch?.discoveryBridge?.acknowledgment || '')}"</div>
        <div class="script-text">"${this.escapeHtml(pitch?.discoveryBridge?.painPointsHighlight || '')}"</div>
        <div class="script-text">"${this.escapeHtml(pitch?.discoveryBridge?.empathyStatement || '')}"</div>
    </div>

    <div class="section">
        <div class="section-title">3. Value Presentation (60 seconds)</div>
        <ul class="benefits-list">
            ${(pitch?.valuePresentation?.benefits || []).map(b => `
                <li>
                    <div class="benefit-title">${this.escapeHtml(b.title || '')}</div>
                    <div>${this.escapeHtml(b.explanation || '')}</div>
                    <div class="script-text">"${this.escapeHtml(b.businessSpecificExample || '')}"</div>
                </li>
            `).join('')}
        </ul>
    </div>

    <div class="section">
        <div class="section-title">4. Proof Points (30 seconds)</div>
        <ul>
            ${(pitch?.proofPoints?.dataPoints || []).map(dp => `
                <li>${this.escapeHtml(dp)}</li>
            `).join('')}
        </ul>
        <div class="script-text">"${this.escapeHtml(pitch?.proofPoints?.roiHighlight || '')}"</div>
    </div>

    <div class="section">
        <div class="section-title">5. Solution Fit (30 seconds)</div>
        <p><strong>Recommended Products:</strong> ${(pitch?.solutionFit?.recommendedProducts || []).join(', ')}</p>
        <div class="script-text">"${this.escapeHtml(pitch?.solutionFit?.implementationVision || '')}"</div>
    </div>

    <div class="section">
        <div class="section-title">6. Call to Action (30 seconds)</div>
        <div class="script-text">"${this.escapeHtml(pitch?.callToAction?.primaryAsk || '')}"</div>
        <div class="script-text">"${this.escapeHtml(pitch?.callToAction?.urgencyHook || '')}"</div>
        <div class="script-text"><strong>"${this.escapeHtml(pitch?.callToAction?.closeQuestion || '')}"</strong></div>
    </div>

    <div class="metadata">
        <div class="metadata-title">Presenter Notes</div>
        <p><strong>Tone:</strong> ${this.escapeHtml(metadata?.toneNotes || '')}</p>
        <p><strong>Be Prepared For:</strong></p>
        <div class="objections">
            ${(metadata?.objectionsToAnticipate || []).map(o => `
                <span class="objection-tag">${this.escapeHtml(o)}</span>
            `).join('')}
        </div>
    </div>

    {{poweredBy}}
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { pitch, metadata } = formattedContent;

        return `SALES PITCH SCRIPT
==================
Estimated Duration: ${metadata?.estimatedDuration || '3-4 minutes'}

1. OPENER (30 seconds)
----------------------
"${pitch?.opener?.greeting || ''}"
"${pitch?.opener?.hook || ''}"
"${pitch?.opener?.transition || ''}"

2. DISCOVERY BRIDGE (30 seconds)
--------------------------------
"${pitch?.discoveryBridge?.acknowledgment || ''}"
"${pitch?.discoveryBridge?.painPointsHighlight || ''}"
"${pitch?.discoveryBridge?.empathyStatement || ''}"

3. VALUE PRESENTATION (60 seconds)
----------------------------------
${(pitch?.valuePresentation?.benefits || []).map(b => `
• ${b.title}
  ${b.explanation}
  "${b.businessSpecificExample}"
`).join('\n')}

4. PROOF POINTS (30 seconds)
----------------------------
${(pitch?.proofPoints?.dataPoints || []).map(dp => `• ${dp}`).join('\n')}
"${pitch?.proofPoints?.roiHighlight || ''}"

5. SOLUTION FIT (30 seconds)
----------------------------
Recommended Products: ${(pitch?.solutionFit?.recommendedProducts || []).join(', ')}
"${pitch?.solutionFit?.implementationVision || ''}"

6. CALL TO ACTION (30 seconds)
------------------------------
"${pitch?.callToAction?.primaryAsk || ''}"
"${pitch?.callToAction?.urgencyHook || ''}"
"${pitch?.callToAction?.closeQuestion || ''}"

PRESENTER NOTES
---------------
Tone: ${metadata?.toneNotes || ''}
Be Prepared For: ${(metadata?.objectionsToAnticipate || []).join(', ')}
`;
    }

    toMarkdown(formattedContent) {
        const { pitch, metadata } = formattedContent;

        return `# Sales Pitch Script

**Estimated Duration:** ${metadata?.estimatedDuration || '3-4 minutes'}

---

## 1. Opener (30 seconds)

> "${pitch?.opener?.greeting || ''}"

> "${pitch?.opener?.hook || ''}"

> "${pitch?.opener?.transition || ''}"

---

## 2. Discovery Bridge (30 seconds)

> "${pitch?.discoveryBridge?.acknowledgment || ''}"

> "${pitch?.discoveryBridge?.painPointsHighlight || ''}"

> "${pitch?.discoveryBridge?.empathyStatement || ''}"

---

## 3. Value Presentation (60 seconds)

${(pitch?.valuePresentation?.benefits || []).map(b => `
### ${b.title}

${b.explanation}

> "${b.businessSpecificExample}"
`).join('\n')}

---

## 4. Proof Points (30 seconds)

${(pitch?.proofPoints?.dataPoints || []).map(dp => `- ${dp}`).join('\n')}

> "${pitch?.proofPoints?.roiHighlight || ''}"

---

## 5. Solution Fit (30 seconds)

**Recommended Products:** ${(pitch?.solutionFit?.recommendedProducts || []).join(', ')}

> "${pitch?.solutionFit?.implementationVision || ''}"

---

## 6. Call to Action (30 seconds)

> "${pitch?.callToAction?.primaryAsk || ''}"

> "${pitch?.callToAction?.urgencyHook || ''}"

> **"${pitch?.callToAction?.closeQuestion || ''}"**

---

## Presenter Notes

**Tone:** ${metadata?.toneNotes || ''}

**Be Prepared For:**
${(metadata?.objectionsToAnticipate || []).map(o => `- ${o}`).join('\n')}
`;
    }
}

module.exports = { SalesPitchFormatter };
