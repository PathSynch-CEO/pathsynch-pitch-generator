/**
 * Email Sequence Formatter
 *
 * Generates 5-email nurture sequences
 */

const { BaseFormatter } = require('./baseFormatter');
const { formatNarrative } = require('../services/claudeClient');
const { EMAIL_SEQUENCE_PROMPT } = require('../services/prompts/emailSequencePrompt');

class EmailSequenceFormatter extends BaseFormatter {
    constructor() {
        super('email_sequence', 'growth');
    }

    getSystemPrompt() {
        return EMAIL_SEQUENCE_PROMPT;
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
            console.error('Failed to parse email sequence response:', error);
            formatted = this.fallbackFormat(narrative);
        }

        return {
            ...formatted,
            usage: result.usage
        };
    }

    fallbackFormat(narrative) {
        const businessName = narrative.businessStory?.headline?.split(':')[0] || 'your business';
        const painPoint = narrative.painPoints?.[0]?.title || 'growing your online presence';

        return {
            emailSequence: {
                sequenceName: `${businessName} Nurture Sequence`,
                targetProfile: 'Local business owner looking to grow',
                emails: [
                    {
                        emailNumber: 1,
                        sendDay: 0,
                        subject: `Quick thought about ${businessName}`,
                        previewText: 'I noticed something interesting while researching local businesses...',
                        body: {
                            greeting: 'Hi there,',
                            opening: `I was researching local businesses in your area and came across ${businessName}.`,
                            main: narrative.businessStory?.valueProposition || 'I think there might be some opportunities to help you grow.',
                            cta: 'Would you be open to a quick conversation about it?',
                            signoff: 'Best regards'
                        },
                        purpose: 'Introduction',
                        toneNotes: 'Warm and curious'
                    },
                    {
                        emailNumber: 2,
                        sendDay: 2,
                        subject: `${painPoint} - a common challenge`,
                        previewText: 'Many business owners I talk to mention this...',
                        body: {
                            greeting: 'Hi again,',
                            opening: 'I wanted to follow up on my last email.',
                            main: narrative.painPoints?.[0]?.description || 'Many local businesses struggle with online visibility.',
                            cta: 'Here\'s a quick tip that might help...',
                            signoff: 'Talk soon'
                        },
                        purpose: 'Pain Point Focus',
                        toneNotes: 'Helpful and empathetic'
                    },
                    {
                        emailNumber: 3,
                        sendDay: 4,
                        subject: `How ${businessName} could see ${narrative.roiStory?.keyMetrics?.[0]?.projected || 'growth'}`,
                        previewText: 'Based on what I\'ve seen with similar businesses...',
                        body: {
                            greeting: 'Hi,',
                            opening: 'I\'ve been thinking about your business.',
                            main: narrative.roiStory?.headline || 'There\'s real potential for growth here.',
                            cta: 'Would you like to see how this could work for you?',
                            signoff: 'Best'
                        },
                        purpose: 'Value Demonstration',
                        toneNotes: 'Solution-focused'
                    },
                    {
                        emailNumber: 4,
                        sendDay: 7,
                        subject: 'Results other local businesses are seeing',
                        previewText: 'I wanted to share some success stories...',
                        body: {
                            greeting: 'Hi,',
                            opening: 'I wanted to share something with you.',
                            main: `Businesses like yours are seeing results: ${narrative.proofPoints?.differentiators?.[0] || 'significant growth'}`,
                            cta: 'Want to schedule a quick call to discuss?',
                            signoff: 'Looking forward to connecting'
                        },
                        purpose: 'Social Proof',
                        toneNotes: 'Credible and aspirational'
                    },
                    {
                        emailNumber: 5,
                        sendDay: 10,
                        subject: 'One last thought',
                        previewText: 'I don\'t want to miss the chance to help...',
                        body: {
                            greeting: 'Hi,',
                            opening: 'I\'ve reached out a few times now.',
                            main: narrative.ctaHooks?.[0]?.headline || 'I believe there\'s a real opportunity here.',
                            cta: narrative.ctaHooks?.[0]?.action || 'Let\'s schedule 15 minutes to talk.',
                            signoff: 'Hope to hear from you'
                        },
                        purpose: 'Direct Ask',
                        toneNotes: 'Direct but respectful'
                    }
                ]
            },
            sequenceMetadata: {
                totalDuration: '10 days',
                expectedOpenRate: '25-35%',
                abTestSuggestions: [
                    {
                        email: 1,
                        element: 'subject',
                        variant: `Noticed ${businessName} online`
                    }
                ]
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { emailSequence, sequenceMetadata } = formattedContent;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
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
        .sequence-info {
            background: #f9fafb;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .sequence-info h3 {
            margin: 0 0 10px 0;
            color: {{primaryColor}};
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-top: 15px;
        }
        .info-item {
            text-align: center;
            padding: 10px;
            background: white;
            border-radius: 4px;
        }
        .info-item .label {
            font-size: 12px;
            color: #666;
        }
        .info-item .value {
            font-size: 18px;
            font-weight: 600;
            color: {{primaryColor}};
        }
        .email-card {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        .email-header {
            background: {{primaryColor}};
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .email-number {
            font-size: 14px;
            opacity: 0.9;
        }
        .email-day {
            background: white;
            color: {{primaryColor}};
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .email-meta {
            padding: 15px 20px;
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
        }
        .email-subject {
            font-weight: 600;
            font-size: 16px;
            margin-bottom: 5px;
        }
        .email-preview {
            font-size: 13px;
            color: #666;
            font-style: italic;
        }
        .email-body {
            padding: 20px;
        }
        .email-body p {
            margin: 10px 0;
        }
        .email-cta {
            background: {{primaryColor}}10;
            padding: 10px 15px;
            border-radius: 4px;
            border-left: 3px solid {{primaryColor}};
            margin: 15px 0;
        }
        .email-footer {
            padding: 15px 20px;
            background: #f9fafb;
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #666;
        }
        .purpose-tag {
            background: {{primaryColor}};
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
        }
        .ab-tests {
            margin-top: 30px;
            padding: 20px;
            background: #fef3c7;
            border-radius: 8px;
        }
        .ab-tests h4 {
            margin: 0 0 15px 0;
            color: #92400e;
        }
        .ab-test {
            background: white;
            padding: 10px 15px;
            border-radius: 4px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        {{logoPlaceholder}}
        <h1>Email Nurture Sequence</h1>
        <p>${this.escapeHtml(emailSequence?.sequenceName || '')}</p>
    </div>

    <div class="sequence-info">
        <h3>Sequence Overview</h3>
        <p><strong>Target:</strong> ${this.escapeHtml(emailSequence?.targetProfile || '')}</p>
        <div class="info-grid">
            <div class="info-item">
                <div class="value">${emailSequence?.emails?.length || 5}</div>
                <div class="label">Emails</div>
            </div>
            <div class="info-item">
                <div class="value">${this.escapeHtml(sequenceMetadata?.totalDuration || '10 days')}</div>
                <div class="label">Duration</div>
            </div>
            <div class="info-item">
                <div class="value">${this.escapeHtml(sequenceMetadata?.expectedOpenRate || '25-35%')}</div>
                <div class="label">Expected Open Rate</div>
            </div>
        </div>
    </div>

    ${(emailSequence?.emails || []).map(email => `
        <div class="email-card">
            <div class="email-header">
                <span class="email-number">Email ${email.emailNumber} - ${this.escapeHtml(email.purpose || '')}</span>
                <span class="email-day">Day ${email.sendDay}</span>
            </div>
            <div class="email-meta">
                <div class="email-subject">Subject: ${this.escapeHtml(email.subject || '')}</div>
                <div class="email-preview">Preview: ${this.escapeHtml(email.previewText || '')}</div>
            </div>
            <div class="email-body">
                <p><strong>${this.escapeHtml(email.body?.greeting || '')}</strong></p>
                <p>${this.escapeHtml(email.body?.opening || '')}</p>
                <p>${this.escapeHtml(email.body?.main || '')}</p>
                <div class="email-cta">${this.escapeHtml(email.body?.cta || '')}</div>
                <p>${this.escapeHtml(email.body?.signoff || '')}</p>
            </div>
            <div class="email-footer">
                <span class="purpose-tag">${this.escapeHtml(email.purpose || '')}</span>
                <span>Tone: ${this.escapeHtml(email.toneNotes || '')}</span>
            </div>
        </div>
    `).join('')}

    ${sequenceMetadata?.abTestSuggestions?.length > 0 ? `
        <div class="ab-tests">
            <h4>💡 A/B Test Suggestions</h4>
            ${(sequenceMetadata.abTestSuggestions || []).map(ab => `
                <div class="ab-test">
                    <strong>Email ${ab.email} - ${ab.element}:</strong> ${this.escapeHtml(ab.variant || '')}
                </div>
            `).join('')}
        </div>
    ` : ''}

    {{poweredBy}}
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    toPlainText(formattedContent) {
        const { emailSequence, sequenceMetadata } = formattedContent;

        let text = `EMAIL NURTURE SEQUENCE
${'='.repeat(50)}
${emailSequence?.sequenceName || ''}

Target: ${emailSequence?.targetProfile || ''}
Duration: ${sequenceMetadata?.totalDuration || '10 days'}
Expected Open Rate: ${sequenceMetadata?.expectedOpenRate || '25-35%'}

`;

        (emailSequence?.emails || []).forEach(email => {
            text += `
${'─'.repeat(50)}
EMAIL ${email.emailNumber} - ${email.purpose || ''} (Day ${email.sendDay})
${'─'.repeat(50)}

SUBJECT: ${email.subject || ''}
PREVIEW: ${email.previewText || ''}

${email.body?.greeting || ''}

${email.body?.opening || ''}

${email.body?.main || ''}

>>> ${email.body?.cta || ''} <<<

${email.body?.signoff || ''}

Tone: ${email.toneNotes || ''}
`;
        });

        if (sequenceMetadata?.abTestSuggestions?.length > 0) {
            text += `
${'─'.repeat(50)}
A/B TEST SUGGESTIONS
${'─'.repeat(50)}
`;
            sequenceMetadata.abTestSuggestions.forEach(ab => {
                text += `• Email ${ab.email} (${ab.element}): ${ab.variant}\n`;
            });
        }

        return text;
    }

    toMarkdown(formattedContent) {
        const { emailSequence, sequenceMetadata } = formattedContent;

        let md = `# Email Nurture Sequence

**${emailSequence?.sequenceName || ''}**

| Metric | Value |
|--------|-------|
| Target | ${emailSequence?.targetProfile || ''} |
| Duration | ${sequenceMetadata?.totalDuration || '10 days'} |
| Expected Open Rate | ${sequenceMetadata?.expectedOpenRate || '25-35%'} |

---

`;

        (emailSequence?.emails || []).forEach(email => {
            md += `## Email ${email.emailNumber}: ${email.purpose || ''} (Day ${email.sendDay})

**Subject:** ${email.subject || ''}

*Preview: ${email.previewText || ''}*

---

${email.body?.greeting || ''}

${email.body?.opening || ''}

${email.body?.main || ''}

> **${email.body?.cta || ''}**

${email.body?.signoff || ''}

---

*Tone: ${email.toneNotes || ''}*

---

`;
        });

        if (sequenceMetadata?.abTestSuggestions?.length > 0) {
            md += `## A/B Test Suggestions

`;
            sequenceMetadata.abTestSuggestions.forEach(ab => {
                md += `- **Email ${ab.email}** (${ab.element}): ${ab.variant}\n`;
            });
        }

        return md;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            emailCount: formattedContent.emailSequence?.emails?.length || 5,
            sequenceDuration: formattedContent.sequenceMetadata?.totalDuration || '10 days'
        };
    }
}

module.exports = { EmailSequenceFormatter };
