/**
 * Website Audit API
 *
 * Lightweight website audit for pitch preparation.
 * Combines PageSpeed Insights, Serper web presence signals,
 * and Gemini AI analysis to produce actionable sales intel.
 *
 * GET /audit/website?url=https://example.com&businessName=Buddy's Garage&city=Nashville
 */

const { serperSearch } = require('../../services/serperClient');

async function auditWebsite(req, res) {
    try {
        const { url, businessName, city } = req.query;

        if (!businessName && !url) {
            return res.status(400).json({
                success: false,
                error: 'businessName or url required'
            });
        }

        const result = {
            businessName: businessName || '',
            websiteUrl: url || null,
            hasWebsite: !!url,
            auditedAt: new Date().toISOString()
        };

        // If website URL provided, try PageSpeed Insights
        if (url && url.startsWith('http')) {
            try {
                const apiKey = process.env.GOOGLE_API_KEY || process.env.MAPS_API_KEY || '';
                const psUrl =
                    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
                    `?url=${encodeURIComponent(url)}` +
                    `&strategy=mobile` +
                    `&key=${apiKey}`;

                const psResp = await fetch(psUrl);
                if (psResp.ok) {
                    const psData = await psResp.json();
                    const cats = psData.lighthouseResult?.categories || {};

                    result.performance = Math.round((cats.performance?.score || 0) * 100);
                    result.seo = Math.round((cats.seo?.score || 0) * 100);
                    result.accessibility = Math.round((cats.accessibility?.score || 0) * 100);

                    // Extract top failing audits
                    const audits = psData.lighthouseResult?.audits || {};
                    result.topIssues = Object.values(audits)
                        .filter(a =>
                            a.score !== null &&
                            a.score !== undefined &&
                            a.score < 0.5 &&
                            a.details?.type !== 'debugdata'
                        )
                        .sort((a, b) => (a.score || 0) - (b.score || 0))
                        .slice(0, 4)
                        .map(a => a.title);
                }
            } catch (psErr) {
                console.warn('[Audit] PageSpeed failed:', psErr.message);
            }
        }

        // Always run Serper signals for business presence
        if (businessName) {
            try {
                const [websiteSearch, reviewSearch] = await Promise.allSettled([
                    serperSearch(`${businessName} ${city || ''} website`, 'search', { num: 3 }),
                    serperSearch(`${businessName} ${city || ''} reviews`, 'search', { num: 3 })
                ]);

                const wsResults = websiteSearch.status === 'fulfilled'
                    ? websiteSearch.value?.organic || []
                    : [];

                // Check if business appears in top search results
                const firstWord = businessName.toLowerCase().split(' ')[0];
                result.appearsInSearch = wsResults.some(r =>
                    r.title?.toLowerCase().includes(firstWord)
                );

                // Social media presence check
                const allResults = [
                    ...wsResults,
                    ...(reviewSearch.status === 'fulfilled'
                        ? reviewSearch.value?.organic || []
                        : [])
                ];

                result.hasFacebook = allResults.some(r => r.link?.includes('facebook.com'));
                result.hasInstagram = allResults.some(r => r.link?.includes('instagram.com'));
                result.hasYelp = allResults.some(r => r.link?.includes('yelp.com'));
            } catch (serperErr) {
                console.warn('[Audit] Serper signals failed:', serperErr.message);
            }
        }

        // Generate AI strengths/weaknesses/quickWins
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: {
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });

            const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a digital marketing analyst. Analyze this local business's online presence and generate a brief audit.

Business: ${businessName || 'Unknown'}
City: ${city || 'Unknown'}
Has website: ${result.hasWebsite}
Website URL: ${result.websiteUrl || 'none'}
Performance score: ${result.performance ?? 'N/A'}
SEO score: ${result.seo ?? 'N/A'}
Appears in Google search: ${result.appearsInSearch ?? 'unknown'}
Has Facebook: ${result.hasFacebook ?? 'unknown'}
Has Yelp: ${result.hasYelp ?? 'unknown'}
Top issues: ${(result.topIssues || []).join(', ') || 'none'}

Generate JSON:
{
  "strengths": ["specific strength 1", "specific strength 2"],
  "weaknesses": ["specific weakness 1", "specific weakness 2", "specific weakness 3"],
  "quickWins": ["quick win 1 for PathSynch to address", "quick win 2"],
  "pitchHook": "one sentence connecting their digital weakness to PathSynch's solution"
}`;

            const aiResult = await model.generateContent(prompt);
            const text = aiResult.response.text();
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const parsed = JSON.parse(text.substring(start, end + 1));
                result.strengths = parsed.strengths || [];
                result.weaknesses = parsed.weaknesses || [];
                result.quickWins = parsed.quickWins || [];
                result.pitchHook = parsed.pitchHook || null;
            }
        } catch (aiErr) {
            console.warn('[Audit] AI analysis failed:', aiErr.message);
        }

        return res.json({
            success: true,
            audit: result
        });

    } catch (e) {
        console.error('[Audit] Failed:', e.message);
        return res.status(500).json({
            success: false,
            error: e.message
        });
    }
}

module.exports = { auditWebsite };
