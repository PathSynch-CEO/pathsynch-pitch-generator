/**
 * LinkedIn Messages Formatter
 *
 * Generates 3 LinkedIn outreach messages
 * Now uses modelRouter for intelligent Claude/Gemini selection
 */

const { BaseFormatter } = require('./baseFormatter');
const modelRouter = require('../services/modelRouter');
const { LINKEDIN_PROMPT } = require('../services/prompts/linkedInPrompt');

class LinkedInFormatter extends BaseFormatter {
    constructor() {
        super('linkedin', 'growth');
    }

    getSystemPrompt() {
        return LINKEDIN_PROMPT;
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
            console.error('Failed to parse LinkedIn response:', error);
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
        const businessName = narrative.businessStory?.headline?.split(':')[0] || 'your business';

        return {
            linkedInMessages: {
                connectionRequest: {
                    message: `Hi! I came across ${businessName} and was impressed by what you've built. Would love to connect and learn more about your journey.`,
                    purpose: 'Get the connection accepted',
                    personalizedElement: 'Business name and genuine compliment'
                },
                followUp: {
                    waitDays: 2,
                    message: `Thanks for connecting! I work with local businesses to help them grow their online presence. I noticed some opportunities for ${businessName} - would you be interested in a quick chat about what's working for businesses in your space?`,
                    purpose: 'Start a conversation',
                    questionAsked: 'Interest in learning what works for similar businesses'
                },
                valueOffer: {
                    waitDays: 5,
                    message: `Hi again! I put together some thoughts on how ${businessName} could boost its online visibility. ${narrative.roiStory?.headline || 'There\'s real potential here.'}

Would 15 minutes be worth it to explore some quick wins?`,
                    purpose: 'Introduce how you can help',
                    valueProposed: narrative.valueProps?.[0]?.benefit || 'Improved online visibility',
                    softCta: 'Brief call to explore quick wins'
                }
            },
            profileNotes: {
                targetTitle: 'Owner, Founder, GM, or Marketing Manager',
                commonGroundSuggestions: [
                    'Local business community',
                    'Industry-specific groups',
                    'Mutual connections'
                ],
                avoidTopics: [
                    'Aggressive sales pitch',
                    'Price discussions early on',
                    'Negative competitor mentions'
                ]
            }
        };
    }

    toHtml(formattedContent, branding = {}) {
        const { linkedInMessages, profileNotes } = formattedContent;

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
            background: #f3f2ef;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .linkedin-logo {
            color: #0a66c2;
            font-size: 32px;
            margin-bottom: 10px;
        }
        .message-card {
            background: white;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .message-header {
            background: linear-gradient(135deg, #0a66c2, #004182);
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .message-type {
            font-weight: 600;
            font-size: 16px;
        }
        .message-timing {
            background: rgba(255,255,255,0.2);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
        }
        .message-body {
            padding: 20px;
        }
        .message-preview {
            background: #f3f2ef;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            border-left: 3px solid #0a66c2;
            white-space: pre-wrap;
            font-size: 14px;
        }
        .message-meta {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            padding-top: 15px;
            border-top: 1px solid #e5e7eb;
        }
        .meta-item {
            font-size: 13px;
        }
        .meta-label {
            font-weight: 600;
            color: #666;
            display: block;
            margin-bottom: 4px;
        }
        .char-count {
            font-size: 12px;
            color: #666;
            text-align: right;
            margin-top: 5px;
        }
        .char-count.warning {
            color: #f59e0b;
        }
        .char-count.error {
            color: #ef4444;
        }
        .profile-notes {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-top: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .profile-notes h3 {
            margin: 0 0 15px 0;
            color: #0a66c2;
        }
        .notes-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        .note-section h4 {
            font-size: 14px;
            margin: 0 0 10px 0;
            color: #333;
        }
        .note-section ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .note-section li {
            padding: 5px 0;
            font-size: 13px;
            color: #666;
        }
        .note-section.avoid li::before {
            content: '⚠️ ';
        }
        .note-section.do li::before {
            content: '✓ ';
            color: #10b981;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="linkedin-logo">in</div>
        <h1>LinkedIn Outreach Messages</h1>
        <p>3-message connection and nurture sequence</p>
    </div>

    <div class="message-card">
        <div class="message-header">
            <span class="message-type">1. Connection Request</span>
            <span class="message-timing">Day 0</span>
        </div>
        <div class="message-body">
            <div class="message-preview">${this.escapeHtml(linkedInMessages?.connectionRequest?.message || '')}</div>
            <div class="char-count ${this.getCharCountClass(linkedInMessages?.connectionRequest?.message, 300)}">
                ${(linkedInMessages?.connectionRequest?.message || '').length}/300 characters
            </div>
            <div class="message-meta">
                <div class="meta-item">
                    <span class="meta-label">Purpose</span>
                    ${this.escapeHtml(linkedInMessages?.connectionRequest?.purpose || '')}
                </div>
                <div class="meta-item">
                    <span class="meta-label">Personalized Element</span>
                    ${this.escapeHtml(linkedInMessages?.connectionRequest?.personalizedElement || '')}
                </div>
            </div>
        </div>
    </div>

    <div class="message-card">
        <div class="message-header">
            <span class="message-type">2. Follow-Up Message</span>
            <span class="message-timing">Day ${linkedInMessages?.followUp?.waitDays || 2}</span>
        </div>
        <div class="message-body">
            <div class="message-preview">${this.escapeHtml(linkedInMessages?.followUp?.message || '')}</div>
            <div class="char-count ${this.getCharCountClass(linkedInMessages?.followUp?.message, 500)}">
                ${(linkedInMessages?.followUp?.message || '').length}/500 characters
            </div>
            <div class="message-meta">
                <div class="meta-item">
                    <span class="meta-label">Purpose</span>
                    ${this.escapeHtml(linkedInMessages?.followUp?.purpose || '')}
                </div>
                <div class="meta-item">
                    <span class="meta-label">Question Asked</span>
                    ${this.escapeHtml(linkedInMessages?.followUp?.questionAsked || '')}
                </div>
            </div>
        </div>
    </div>

    <div class="message-card">
        <div class="message-header">
            <span class="message-type">3. Value Offer</span>
            <span class="message-timing">Day ${(linkedInMessages?.followUp?.waitDays || 2) + (linkedInMessages?.valueOffer?.waitDays || 5)}</span>
        </div>
        <div class="message-body">
            <div class="message-preview">${this.escapeHtml(linkedInMessages?.valueOffer?.message || '')}</div>
            <div class="char-count ${this.getCharCountClass(linkedInMessages?.valueOffer?.message, 600)}">
                ${(linkedInMessages?.valueOffer?.message || '').length}/600 characters
            </div>
            <div class="message-meta">
                <div class="meta-item">
                    <span class="meta-label">Value Proposed</span>
                    ${this.escapeHtml(linkedInMessages?.valueOffer?.valueProposed || '')}
                </div>
                <div class="meta-item">
                    <span class="meta-label">Soft CTA</span>
                    ${this.escapeHtml(linkedInMessages?.valueOffer?.softCta || '')}
                </div>
            </div>
        </div>
    </div>

    <div class="profile-notes">
        <h3>Profile & Outreach Notes</h3>
        <div class="notes-grid">
            <div class="note-section">
                <h4>Target Title</h4>
                <p>${this.escapeHtml(profileNotes?.targetTitle || '')}</p>
            </div>
            <div class="note-section do">
                <h4>Common Ground Ideas</h4>
                <ul>
                    ${(profileNotes?.commonGroundSuggestions || []).map(s => `<li>${this.escapeHtml(s)}</li>`).join('')}
                </ul>
            </div>
            <div class="note-section avoid">
                <h4>Topics to Avoid</h4>
                <ul>
                    ${(profileNotes?.avoidTopics || []).map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}
                </ul>
            </div>
        </div>
    </div>

    {{poweredBy}}
</body>
</html>`;

        return this.applyBranding(html, branding);
    }

    getCharCountClass(message, limit) {
        const length = (message || '').length;
        if (length > limit) return 'error';
        if (length > limit * 0.9) return 'warning';
        return '';
    }

    toPlainText(formattedContent) {
        const { linkedInMessages, profileNotes } = formattedContent;

        return `LINKEDIN OUTREACH MESSAGES
${'='.repeat(50)}

MESSAGE 1: CONNECTION REQUEST (Day 0)
${'─'.repeat(40)}
${linkedInMessages?.connectionRequest?.message || ''}

[${(linkedInMessages?.connectionRequest?.message || '').length}/300 chars]
Purpose: ${linkedInMessages?.connectionRequest?.purpose || ''}
Personalized: ${linkedInMessages?.connectionRequest?.personalizedElement || ''}


MESSAGE 2: FOLLOW-UP (Day ${linkedInMessages?.followUp?.waitDays || 2})
${'─'.repeat(40)}
${linkedInMessages?.followUp?.message || ''}

[${(linkedInMessages?.followUp?.message || '').length}/500 chars]
Purpose: ${linkedInMessages?.followUp?.purpose || ''}
Question: ${linkedInMessages?.followUp?.questionAsked || ''}


MESSAGE 3: VALUE OFFER (Day ${(linkedInMessages?.followUp?.waitDays || 2) + (linkedInMessages?.valueOffer?.waitDays || 5)})
${'─'.repeat(40)}
${linkedInMessages?.valueOffer?.message || ''}

[${(linkedInMessages?.valueOffer?.message || '').length}/600 chars]
Value Proposed: ${linkedInMessages?.valueOffer?.valueProposed || ''}
Soft CTA: ${linkedInMessages?.valueOffer?.softCta || ''}


PROFILE NOTES
${'─'.repeat(40)}
Target Title: ${profileNotes?.targetTitle || ''}

Common Ground Ideas:
${(profileNotes?.commonGroundSuggestions || []).map(s => `  ✓ ${s}`).join('\n')}

Topics to Avoid:
${(profileNotes?.avoidTopics || []).map(t => `  ⚠ ${t}`).join('\n')}
`;
    }

    toMarkdown(formattedContent) {
        const { linkedInMessages, profileNotes } = formattedContent;

        return `# LinkedIn Outreach Messages

## Message 1: Connection Request (Day 0)

\`\`\`
${linkedInMessages?.connectionRequest?.message || ''}
\`\`\`

*${(linkedInMessages?.connectionRequest?.message || '').length}/300 characters*

| | |
|---|---|
| **Purpose** | ${linkedInMessages?.connectionRequest?.purpose || ''} |
| **Personalized Element** | ${linkedInMessages?.connectionRequest?.personalizedElement || ''} |

---

## Message 2: Follow-Up (Day ${linkedInMessages?.followUp?.waitDays || 2})

\`\`\`
${linkedInMessages?.followUp?.message || ''}
\`\`\`

*${(linkedInMessages?.followUp?.message || '').length}/500 characters*

| | |
|---|---|
| **Purpose** | ${linkedInMessages?.followUp?.purpose || ''} |
| **Question Asked** | ${linkedInMessages?.followUp?.questionAsked || ''} |

---

## Message 3: Value Offer (Day ${(linkedInMessages?.followUp?.waitDays || 2) + (linkedInMessages?.valueOffer?.waitDays || 5)})

\`\`\`
${linkedInMessages?.valueOffer?.message || ''}
\`\`\`

*${(linkedInMessages?.valueOffer?.message || '').length}/600 characters*

| | |
|---|---|
| **Value Proposed** | ${linkedInMessages?.valueOffer?.valueProposed || ''} |
| **Soft CTA** | ${linkedInMessages?.valueOffer?.softCta || ''} |

---

## Profile & Outreach Notes

**Target Title:** ${profileNotes?.targetTitle || ''}

### Common Ground Ideas
${(profileNotes?.commonGroundSuggestions || []).map(s => `- ✓ ${s}`).join('\n')}

### Topics to Avoid
${(profileNotes?.avoidTopics || []).map(t => `- ⚠️ ${t}`).join('\n')}
`;
    }

    getMetadata(formattedContent) {
        return {
            ...super.getMetadata(formattedContent),
            messageCount: 3,
            platform: 'LinkedIn'
        };
    }
}

module.exports = { LinkedInFormatter };
