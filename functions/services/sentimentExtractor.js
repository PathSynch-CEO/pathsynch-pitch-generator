/**
 * Review Sentiment Extractor
 * Uses Gemini to extract praise themes, complaint themes, and standout phrase from reviews.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Extract sentiment themes from review texts
 * @param {string} businessName - Business name for context
 * @param {Array} reviews - Array of { text, rating, author } objects
 * @returns {Object|null} { praiseThemes: string[], complaintThemes: string[], standoutPhrase: string }
 */
async function extractSentiment(businessName, reviews) {
    if (!reviews || reviews.length === 0) return null;

    const reviewTexts = reviews
        .filter(r => r.text && r.text.length > 10)
        .slice(0, 10)
        .map((r, i) => `${i + 1}. [${r.rating || '?'}\u2605] "${r.text.substring(0, 200)}"`)
        .join('\n');

    if (!reviewTexts) return null;

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

Analyze these Google reviews for "${businessName}" and extract sentiment themes.

REVIEWS:
${reviewTexts}

Return a JSON object with exactly these fields:
{
  "praiseThemes": ["2-4 word theme", "another theme"],
  "complaintThemes": ["2-4 word theme", "another theme"],
  "standoutPhrase": "One short direct quote from the reviews that best captures what customers say about this business (max 15 words)"
}

RULES:
- praiseThemes: 2-4 recurring positive themes (e.g. "fast friendly service", "expert tax advice", "clean modern office")
- complaintThemes: 0-3 recurring negative themes. If reviews are all positive, return empty array []
- standoutPhrase: Pick the single most representative customer quote. Keep it under 15 words. Do NOT fabricate — use actual words from the reviews.
- Each theme should be 2-4 words, lowercase, no punctuation
- Max 4 praise themes, max 3 complaint themes`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;

        const parsed = JSON.parse(text.substring(start, end + 1));

        // Validate shape
        if (!Array.isArray(parsed.praiseThemes)) return null;

        return {
            praiseThemes: (parsed.praiseThemes || []).slice(0, 4),
            complaintThemes: (parsed.complaintThemes || []).slice(0, 3),
            standoutPhrase: (parsed.standoutPhrase || '').substring(0, 100) || null
        };
    } catch (e) {
        console.warn('[Sentiment] Extraction failed for', businessName, ':', e.message);
        return null;
    }
}

module.exports = { extractSentiment };
