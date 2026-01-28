/**
 * Deck Formatter
 *
 * Generates 10-slide presentation structures
 */

const { BaseFormatter } = require('./baseFormatter');
const { formatNarrative } = require('../services/claudeClient');
const { DECK_PROMPT } = require('../services/prompts/deckPrompt');

class DeckFormatter extends BaseFormatter {
    constructor() {
        super('deck', 'scale');
    }

    getSystemPrompt() {
        return DECK_PROMPT;
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
            console.error('Failed to parse deck response:', error);
            formatted = this.fallbackFormat(narrative);
        }

        return {
            ...formatted,
            usage: result.usage
        };
    }

    fallbackFormat(narrative) {
        const businessName = narrative.businessStory?.headline?.split(':')[0] || 'Your Business';
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        return {
            deck: {
                metadata: {
                    title: `Growth Opportunity: ${businessName}`,
                    subtitle: 'PathSynch Solutions Overview',
                    presenter: 'PathSynch Team',
                    date: today,
                    slideCount: 10
                },
                slides: [
                    {
                        slideNumber: 1,
                        slideType: 'title',
                        title: `Growth Opportunity: ${businessName}`,
                        content: {
                            mainPoint: narrative.businessStory?.valueProposition || 'Unlock your business potential',
                            bullets: [],
                            dataPoints: []
                        },
                        visualSuggestion: 'Company logo centered, gradient background',
                        speakerNotes: 'Introduce yourself and thank them for their time',
                        transitionNote: 'Lead into the challenges they may be facing'
                    },
                    {
                        slideNumber: 2,
                        slideType: 'content',
                        title: 'The Challenge',
                        content: {
                            mainPoint: 'Local businesses face unique challenges in today\'s digital landscape',
                            bullets: narrative.painPoints?.slice(0, 4).map(pp => pp.title) || ['Finding new customers', 'Managing online reputation', 'Standing out from competitors'],
                            dataPoints: []
                        },
                        visualSuggestion: 'Icons for each challenge point',
                        speakerNotes: 'Validate their challenges - show you understand their situation',
                        transitionNote: 'But there\'s significant opportunity here'
                    },
                    {
                        slideNumber: 3,
                        slideType: 'content',
                        title: 'The Opportunity',
                        content: {
                            mainPoint: narrative.businessStory?.desiredState || 'Transform challenges into growth',
                            bullets: ['Increased visibility', 'Stronger reputation', 'Better customer engagement', 'Measurable results'],
                            dataPoints: []
                        },
                        visualSuggestion: 'Upward trending growth chart',
                        speakerNotes: 'Paint a picture of what success looks like',
                        transitionNote: 'Let\'s look at where you are today'
                    },
                    {
                        slideNumber: 4,
                        slideType: 'data',
                        title: 'Current State Analysis',
                        content: {
                            mainPoint: 'Your online presence today',
                            bullets: narrative.proofPoints?.topThemes?.slice(0, 3).map(t => t.theme) || [],
                            dataPoints: [
                                { label: 'Positive Sentiment', value: `${narrative.proofPoints?.sentiment?.positive || 0}%` },
                                { label: 'Key Strength', value: narrative.proofPoints?.differentiators?.[0] || 'Identified' }
                            ]
                        },
                        visualSuggestion: 'Star rating visual, sentiment pie chart',
                        speakerNotes: 'Acknowledge their strengths while identifying gaps',
                        transitionNote: 'Let\'s dive deeper into the pain points'
                    },
                    {
                        slideNumber: 5,
                        slideType: 'content',
                        title: 'Pain Points Deep Dive',
                        content: {
                            mainPoint: 'Key challenges affecting your growth',
                            bullets: narrative.painPoints?.slice(0, 3).map(pp => `${pp.title}: ${pp.impact}`) || [],
                            dataPoints: []
                        },
                        visualSuggestion: 'Pain point icons with impact indicators',
                        speakerNotes: 'Be empathetic, not critical. These are common challenges.',
                        transitionNote: 'Here\'s how we can help'
                    },
                    {
                        slideNumber: 6,
                        slideType: 'content',
                        title: 'PathSynch Solution Overview',
                        content: {
                            mainPoint: 'A complete platform for local business growth',
                            bullets: ['PathConnect - Customer communication hub', 'LocalSynch - Local SEO management', 'Forms - Digital feedback collection', 'SynchMate - AI review responses'],
                            dataPoints: []
                        },
                        visualSuggestion: 'Product icons in a hub-and-spoke layout',
                        speakerNotes: 'Brief overview - don\'t go too deep yet',
                        transitionNote: 'Specifically for your business...'
                    },
                    {
                        slideNumber: 7,
                        slideType: 'content',
                        title: 'Recommended Solution',
                        content: {
                            mainPoint: 'Tailored recommendations for your needs',
                            bullets: narrative.solutionFit?.useCases?.slice(0, 4).map(uc => `${uc.product}: ${uc.outcome}`) || [],
                            dataPoints: []
                        },
                        visualSuggestion: 'Solution flow diagram connecting problems to products',
                        speakerNotes: 'Show how each product solves a specific challenge they have',
                        transitionNote: 'Now let\'s talk about results'
                    },
                    {
                        slideNumber: 8,
                        slideType: 'data',
                        title: 'ROI Projection',
                        content: {
                            mainPoint: narrative.roiStory?.headline || 'Measurable impact on your business',
                            bullets: [],
                            dataPoints: narrative.roiStory?.keyMetrics?.slice(0, 3).map(m => ({
                                label: m.metric,
                                value: `${m.current} → ${m.projected}`
                            })) || []
                        },
                        visualSuggestion: 'Before/after comparison chart',
                        speakerNotes: 'Be conservative with projections. Under-promise, over-deliver.',
                        transitionNote: 'And you\'re not alone'
                    },
                    {
                        slideNumber: 9,
                        slideType: 'content',
                        title: 'Success Stories',
                        content: {
                            mainPoint: 'Businesses like yours are seeing results',
                            bullets: narrative.proofPoints?.differentiators?.slice(0, 3) || ['Improved visibility', 'Better reviews', 'More customers'],
                            dataPoints: []
                        },
                        visualSuggestion: 'Testimonial quotes or case study snippets',
                        speakerNotes: 'Use industry-relevant examples if possible',
                        transitionNote: 'Ready to get started?'
                    },
                    {
                        slideNumber: 10,
                        slideType: 'cta',
                        title: 'Next Steps',
                        content: {
                            mainPoint: narrative.ctaHooks?.[0]?.headline || 'Let\'s Get Started',
                            bullets: ['Schedule a demo', 'Review implementation plan', 'Start seeing results'],
                            dataPoints: []
                        },
                        visualSuggestion: 'Clear CTA button, contact information',
                        speakerNotes: 'Ask for the next step directly. Don\'t be vague.',
                        transitionNote: 'Thank you and open for questions'
                    }
                ]
            },
            deckNotes: {
                estimatedDuration: '15-20 minutes',
                audienceLevel: 'Business owner / Decision maker',
                keyObjections: ['Budget concerns', 'Time to implement', 'Previous bad experiences with vendors'],
                followUpMaterials: ['One-pager PDF', 'Pricing sheet', 'Case study relevant to their industry']
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { deck, deckNotes } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1000px;
            margin: 0 auto;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
            background: #1a1a2e;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: white;
            border-radius: 12px;
        }
        .header h1 {
            color: {{primaryColor}};
            margin: 0 0 10px 0;
        }
        .deck-info {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin: 20px 0;
        }
        .deck-info-item {
            text-align: center;
            padding: 15px;
            background: #f9fafb;
            border-radius: 8px;
        }
        .deck-info-item .value {
            font-size: 24px;
            font-weight: 600;
            color: {{primaryColor}};
        }
        .deck-info-item .label {
            font-size: 12px;
            color: #666;
        }
        .slide-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 40px;
        }
        .slide-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }
        .slide-preview {
            aspect-ratio: 16/9;
            background: linear-gradient(135deg, {{primaryColor}}, {{accentColor}});
            padding: 20px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            color: white;
            position: relative;
        }
        .slide-preview.title-slide {
            text-align: center;
        }
        .slide-preview.data-slide {
            background: linear-gradient(135deg, #1e3a5f, #0d1b2a);
        }
        .slide-preview.cta-slide {
            background: linear-gradient(135deg, #059669, #047857);
            text-align: center;
        }
        .slide-number {
            position: absolute;
            bottom: 10px;
            right: 15px;
            font-size: 12px;
            opacity: 0.7;
        }
        .slide-preview h3 {
            margin: 0 0 10px 0;
            font-size: 18px;
        }
        .slide-preview .main-point {
            font-size: 13px;
            opacity: 0.9;
            margin-bottom: 10px;
        }
        .slide-preview ul {
            margin: 0;
            padding-left: 20px;
            font-size: 11px;
        }
        .slide-preview li {
            margin: 3px 0;
        }
        .slide-details {
            padding: 15px;
        }
        .detail-section {
            margin-bottom: 10px;
        }
        .detail-label {
            font-size: 11px;
            font-weight: 600;
            color: {{primaryColor}};
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .detail-content {
            font-size: 12px;
            color: #666;
        }
        .presenter-notes {
            background: white;
            border-radius: 12px;
            padding: 25px;
            margin-top: 30px;
        }
        .presenter-notes h2 {
            color: {{primaryColor}};
            margin: 0 0 20px 0;
        }
        .notes-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
        }
        .note-section h4 {
            margin: 0 0 10px 0;
            color: #555;
        }
        .note-section ul {
            margin: 0;
            padding-left: 20px;
        }
        .note-section li {
            margin: 5px 0;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        {{logoPlaceholder}}
        <h1>${this.escapeHtml(deck?.metadata?.title || '')}</h1>
        <p>${this.escapeHtml(deck?.metadata?.subtitle || '')}</p>
        <div class="deck-info">
            <div class="deck-info-item">
                <div class="value">${deck?.metadata?.slideCount || 10}</div>
                <div class="label">Slides</div>
            </div>
            <div class="deck-info-item">
                <div class="value">${this.escapeHtml(deckNotes?.estimatedDuration || '15-20 min')}</div>
                <div class="label">Duration</div>
            </div>
            <div class="deck-info-item">
                <div class="value">${this.escapeHtml(deck?.metadata?.presenter || '')}</div>
                <div class="label">Presenter</div>
            </div>
            <div class="deck-info-item">
                <div class="value">${this.escapeHtml(deck?.metadata?.date || '')}</div>
                <div class="label">Date</div>
            </div>
        </div>
    </div>

    <div class="slide-grid">
        ${(deck?.slides || []).map(slide => `
            <div class="slide-card">
                <div class="slide-preview ${slide.slideType}-slide">
                    <h3>${this.escapeHtml(slide.title || '')}</h3>
                    <div class="main-point">${this.escapeHtml(slide.content?.mainPoint || '')}</div>
                    ${slide.content?.bullets?.length > 0 ? `
                        <ul>
                            ${slide.content.bullets.slice(0, 4).map(b => `<li>${this.escapeHtml(b)}</li>`).join('')}
                        </ul>
                    ` : ''}
                    ${slide.content?.dataPoints?.length > 0 ? `
                        <div style="display: flex; gap: 15px; margin-top: 10px;">
                            ${slide.content.dataPoints.map(dp => `
                                <div style="text-align: center;">
                                    <div style="font-size: 16px; font-weight: bold;">${this.escapeHtml(dp.value)}</div>
                                    <div style="font-size: 10px; opacity: 0.8;">${this.escapeHtml(dp.label)}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    <span class="slide-number">${slide.slideNumber}</span>
                </div>
                <div class="slide-details">
                    <div class="detail-section">
                        <div class="detail-label">Visual Suggestion</div>
                        <div class="detail-content">${this.escapeHtml(slide.visualSuggestion || '')}</div>
                    </div>
                    <div class="detail-section">
                        <div class="detail-label">Speaker Notes</div>
                        <div class="detail-content">${this.escapeHtml(slide.speakerNotes || '')}</div>
                    </div>
                    <div class="detail-section">
                        <div class="detail-label">Transition</div>
                        <div class="detail-content">${this.escapeHtml(slide.transitionNote || '')}</div>
                    </div>
                </div>
            </div>
        `).join('')}
    </div>

    <div class="presenter-notes">
        <h2>Presenter Notes</h2>
        <div class="notes-grid">
            <div class="note-section">
                <h4>Audience Level</h4>
                <p>${this.escapeHtml(deckNotes?.audienceLevel || '')}</p>
            </div>
            <div class="note-section">
                <h4>Estimated Duration</h4>
                <p>${this.escapeHtml(deckNotes?.estimatedDuration || '')}</p>
            </div>
            <div class="note-section">
                <h4>Key Objections to Prepare For</h4>
                <ul>
                    ${(deckNotes?.keyObjections || []).map(o => `<li>${this.escapeHtml(o)}</li>`).join('')}
                </ul>
            </div>
            <div class="note-section">
                <h4>Follow-Up Materials</h4>
                <ul>
                    ${(deckNotes?.followUpMaterials || []).map(m => `<li>${this.escapeHtml(m)}</li>`).join('')}
                </ul>
            </div>
        </div>
    </div>

    {{poweredBy}}
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { deck, deckNotes } = formattedContent;

        let text = `PRESENTATION DECK
${'='.repeat(60)}
${deck?.metadata?.title || ''}
${deck?.metadata?.subtitle || ''}

Presenter: ${deck?.metadata?.presenter || ''}
Date: ${deck?.metadata?.date || ''}
Duration: ${deckNotes?.estimatedDuration || '15-20 minutes'}

`;

        (deck?.slides || []).forEach(slide => {
            text += `
${'─'.repeat(60)}
SLIDE ${slide.slideNumber}: ${slide.title || ''}
${'─'.repeat(60)}
Type: ${slide.slideType}

${slide.content?.mainPoint || ''}

${slide.content?.bullets?.length > 0 ? 'Key Points:\n' + slide.content.bullets.map(b => `  • ${b}`).join('\n') : ''}

${slide.content?.dataPoints?.length > 0 ? 'Data:\n' + slide.content.dataPoints.map(dp => `  ${dp.label}: ${dp.value}`).join('\n') : ''}

Visual: ${slide.visualSuggestion || ''}
Notes: ${slide.speakerNotes || ''}
Transition: ${slide.transitionNote || ''}
`;
        });

        text += `
${'═'.repeat(60)}
PRESENTER NOTES
${'═'.repeat(60)}

Audience: ${deckNotes?.audienceLevel || ''}
Duration: ${deckNotes?.estimatedDuration || ''}

Objections to Prepare For:
${(deckNotes?.keyObjections || []).map(o => `  • ${o}`).join('\n')}

Follow-Up Materials:
${(deckNotes?.followUpMaterials || []).map(m => `  • ${m}`).join('\n')}
`;

        return text;
    }

    toMarkdown(formattedContent) {
        const { deck, deckNotes } = formattedContent;

        let md = `# ${deck?.metadata?.title || ''}

*${deck?.metadata?.subtitle || ''}*

| | |
|---|---|
| **Presenter** | ${deck?.metadata?.presenter || ''} |
| **Date** | ${deck?.metadata?.date || ''} |
| **Slides** | ${deck?.metadata?.slideCount || 10} |
| **Duration** | ${deckNotes?.estimatedDuration || ''} |

---

`;

        (deck?.slides || []).forEach(slide => {
            md += `## Slide ${slide.slideNumber}: ${slide.title || ''}

*Type: ${slide.slideType}*

**${slide.content?.mainPoint || ''}**

${slide.content?.bullets?.length > 0 ? slide.content.bullets.map(b => `- ${b}`).join('\n') : ''}

${slide.content?.dataPoints?.length > 0 ? `
| Metric | Value |
|--------|-------|
${slide.content.dataPoints.map(dp => `| ${dp.label} | ${dp.value} |`).join('\n')}
` : ''}

> **Visual:** ${slide.visualSuggestion || ''}

> **Speaker Notes:** ${slide.speakerNotes || ''}

> **Transition:** ${slide.transitionNote || ''}

---

`;
        });

        md += `## Presenter Notes

**Audience Level:** ${deckNotes?.audienceLevel || ''}

**Duration:** ${deckNotes?.estimatedDuration || ''}

### Key Objections to Prepare For
${(deckNotes?.keyObjections || []).map(o => `- ${o}`).join('\n')}

### Follow-Up Materials
${(deckNotes?.followUpMaterials || []).map(m => `- ${m}`).join('\n')}
`;

        return md;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            slideCount: formattedContent.deck?.metadata?.slideCount || 10,
            estimatedDuration: formattedContent.deckNotes?.estimatedDuration || '15-20 minutes'
        };
    }
}

module.exports = { DeckFormatter };
