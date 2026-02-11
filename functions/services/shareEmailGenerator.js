/**
 * Share Email Generator Service
 *
 * Uses Gemini 2.5 Flash to generate personalized, value-focused emails
 * for sharing pitches with prospects.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Use Gemini 2.5 Flash for fast, cost-effective generation
const GEMINI_MODEL = 'gemini-2.0-flash-exp'; // Will update to 2.5-flash when available

let geminiClient = null;

function getClient() {
    if (!geminiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }
        geminiClient = new GoogleGenerativeAI(apiKey);
    }
    return geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
}

/**
 * Generate a personalized share email for a pitch
 *
 * @param {Object} pitchData - The pitch data
 * @param {string} pitchData.businessName - Prospect business name
 * @param {string} pitchData.contactName - Prospect contact name
 * @param {string} pitchData.industry - Business industry
 * @param {Object} pitchData.roiData - ROI projections
 * @param {Object} pitchData.reviewAnalysis - Review sentiment data
 * @param {string} shareUrl - The share URL for the pitch
 * @param {Object} senderInfo - Information about the sender
 * @param {string} senderInfo.name - Sender's name
 * @param {string} senderInfo.company - Sender's company
 * @returns {Promise<Object>} Generated email with subject and body
 */
async function generateShareEmail(pitchData, shareUrl, senderInfo = {}) {
    const model = getClient();

    const prospectName = pitchData.contactName || pitchData.businessName || 'there';
    const businessName = pitchData.businessName || 'your business';
    const industry = pitchData.industry || 'business';
    const senderName = senderInfo.name || 'Your sales representative';
    const senderCompany = senderInfo.company || 'SynchIntro';

    // Extract key metrics for personalization
    const roiData = pitchData.roiData || {};
    const reviewData = pitchData.reviewAnalysis || {};

    const monthlyGrowth = roiData.improvedVisits ?
        (roiData.improvedVisits - roiData.monthlyVisits) : null;
    const sixMonthRevenue = roiData.sixMonthRevenue || null;
    const googleRating = pitchData.googleRating || null;
    const positiveReviews = reviewData.sentiment?.positive || null;

    // Build context for personalization
    const contextPoints = [];
    if (googleRating && googleRating >= 4.0) {
        contextPoints.push(`Their ${googleRating}-star rating shows strong customer satisfaction`);
    }
    if (positiveReviews && positiveReviews >= 70) {
        contextPoints.push(`${positiveReviews}% positive sentiment in customer reviews`);
    }
    if (monthlyGrowth) {
        contextPoints.push(`Potential to add ${monthlyGrowth}+ new customers per month`);
    }
    if (sixMonthRevenue) {
        contextPoints.push(`Projected $${sixMonthRevenue.toLocaleString()} in additional revenue over 6 months`);
    }

    const prompt = `You are an expert sales email copywriter. Generate a personalized, value-focused email to share a sales pitch.

REQUIREMENTS:
- Keep the email under 75-100 words (body only, not including subject)
- Use a curiosity-driven subject line that creates interest without being clickbait
- Focus on providing VALUE to the recipient, not selling
- Include ONE clear call-to-action (view the pitch)
- AVOID cliches like "just checking in", "hope this finds you well", "I wanted to reach out"
- Be conversational but professional
- Reference specific data points when available to show personalization

CONTEXT:
- Recipient: ${prospectName} at ${businessName}
- Industry: ${industry}
- Sender: ${senderName} from ${senderCompany}
- Pitch URL: ${shareUrl}
${contextPoints.length > 0 ? `- Key insights: ${contextPoints.join('; ')}` : ''}

RESPONSE FORMAT (JSON only, no markdown):
{
  "subject": "The subject line here",
  "body": "The email body here. Include {{PITCH_URL}} where the link should go."
}`;

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7 // Slightly higher for more creative emails
            }
        });

        const response = await result.response;
        let content = response.text().trim();

        // Parse JSON response
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const emailData = JSON.parse(jsonMatch[0]);

        // Replace placeholder with actual URL
        emailData.body = emailData.body.replace(/\{\{PITCH_URL\}\}/g, shareUrl);

        // Add signature
        emailData.body += `\n\nBest,\n${senderName}`;

        return {
            success: true,
            email: {
                subject: emailData.subject,
                body: emailData.body
            },
            metadata: {
                model: GEMINI_MODEL,
                personalizationPoints: contextPoints.length
            }
        };
    } catch (error) {
        console.error('Error generating share email:', error);

        // Fallback to template-based email
        return {
            success: true,
            email: {
                subject: `${prospectName}, I created something for ${businessName}`,
                body: `Hi ${prospectName},\n\nI put together a customized growth analysis for ${businessName} that I think you'll find valuable.\n\nTake a look here: ${shareUrl}\n\nIt includes specific opportunities I identified for your ${industry} business${monthlyGrowth ? `, including potential to add ${monthlyGrowth}+ customers monthly` : ''}.\n\nBest,\n${senderName}`
            },
            metadata: {
                model: 'fallback',
                error: error.message
            }
        };
    }
}

/**
 * Generate a follow-up email with additional value
 *
 * @param {Object} pitchData - The pitch data
 * @param {string} shareUrl - The share URL
 * @param {Object} senderInfo - Sender information
 * @param {number} followUpNumber - Which follow-up (1, 2, 3)
 * @returns {Promise<Object>} Generated follow-up email
 */
async function generateFollowUpEmail(pitchData, shareUrl, senderInfo = {}, followUpNumber = 1) {
    const model = getClient();

    const prospectName = pitchData.contactName || pitchData.businessName || 'there';
    const businessName = pitchData.businessName || 'your business';
    const industry = pitchData.industry || 'business';
    const senderName = senderInfo.name || 'Your sales representative';

    const roiData = pitchData.roiData || {};
    const reviewData = pitchData.reviewAnalysis || {};

    // Different angles for each follow-up
    const angles = {
        1: 'Focus on a specific competitor insight or market trend',
        2: 'Share a relevant success story or case study from similar businesses',
        3: 'Offer a limited-time opportunity or exclusive insight'
    };

    const prompt = `You are an expert sales email copywriter. Generate a VALUE-FIRST follow-up email.

REQUIREMENTS:
- Under 75 words
- DO NOT mention the previous email or say "following up"
- Lead with NEW VALUE - a tip, insight, or resource
- The pitch link is secondary, included naturally
- ONE clear CTA
- NO cliches

ANGLE: ${angles[followUpNumber] || angles[1]}

CONTEXT:
- Recipient: ${prospectName} at ${businessName}
- Industry: ${industry}
- Sender: ${senderName}
- Original pitch: ${shareUrl}
- Google rating: ${pitchData.googleRating || 'N/A'}

RESPONSE FORMAT (JSON only):
{
  "subject": "Subject line",
  "body": "Email body with {{PITCH_URL}} placeholder"
}`;

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 400,
                temperature: 0.8
            }
        });

        const response = await result.response;
        let content = response.text().trim();

        if (content.startsWith('```json')) {
            content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const emailData = JSON.parse(jsonMatch[0]);
        emailData.body = emailData.body.replace(/\{\{PITCH_URL\}\}/g, shareUrl);
        emailData.body += `\n\n${senderName}`;

        return {
            success: true,
            email: emailData,
            followUpNumber,
            metadata: { model: GEMINI_MODEL }
        };
    } catch (error) {
        console.error('Error generating follow-up email:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    generateShareEmail,
    generateFollowUpEmail
};
