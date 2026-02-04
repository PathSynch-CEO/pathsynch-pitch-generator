/**
 * Onboarding API - Website Analysis
 *
 * Uses Google Gemini AI to analyze a company website and extract seller profile data
 */

const axios = require('axios');
const geminiClient = require('../services/geminiClient');

/**
 * Fetch website content with error handling
 */
async function fetchWebsiteContent(url) {
    try {
        // Ensure URL has protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; SynchIntro/1.0; +https://synchintro.ai)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            maxRedirects: 5
        });

        // Extract text content from HTML (basic extraction)
        let content = response.data;

        // Remove script and style tags
        content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        // Remove HTML tags but keep text
        content = content.replace(/<[^>]+>/g, ' ');

        // Clean up whitespace
        content = content.replace(/\s+/g, ' ').trim();

        // Limit content length for API
        if (content.length > 15000) {
            content = content.substring(0, 15000) + '...';
        }

        return {
            success: true,
            content,
            url
        };
    } catch (error) {
        console.error('Website fetch error:', error.message);
        return {
            success: false,
            error: error.message,
            url
        };
    }
}

/**
 * Analyze website content with Google Gemini AI
 */
async function analyzeWebsiteWithAI(websiteContent, websiteUrl) {
    const systemPrompt = `You are an expert business analyst. Your task is to analyze website content and extract structured information about the company to help populate a seller profile for a sales pitch tool.

Be thorough but concise. Extract real information from the website - don't make things up. If information isn't available, use null or empty arrays.

Return ONLY valid JSON matching this exact structure:
{
    "companyProfile": {
        "companyName": "string - the company name",
        "industry": "string - best match from: Restaurant, Retail, Healthcare, Real Estate, Professional Services, Home Services, Automotive, Fitness & Wellness, Beauty & Spa, Legal Services, Financial Services, Education, Technology, Manufacturing, Construction, Hospitality, Entertainment, Non-Profit, Other",
        "suggestedSize": "string - estimated size: solo, 2-10, 11-50, 51-200, 201+",
        "websiteUrl": "string - the URL"
    },
    "products": [
        {
            "name": "string - product/service name",
            "description": "string - brief description (under 300 chars)",
            "pricing": "string or null - any pricing mentioned",
            "isPrimary": "boolean - is this their main offering"
        }
    ],
    "icp": {
        "targetIndustries": ["array of industries they seem to target"],
        "painPoints": ["array of problems they solve for customers"],
        "decisionMakers": ["array of job titles they likely sell to"]
    },
    "valueProposition": {
        "uniqueSellingPoints": ["array of what makes them unique"],
        "keyBenefits": ["array of benefits they offer customers"],
        "differentiator": "string - their main competitive advantage"
    },
    "branding": {
        "suggestedTone": "string - professional, friendly, bold, or consultative based on their website voice"
    },
    "confidence": {
        "overall": "number 0-100 - how confident you are in this analysis",
        "notes": "string - any caveats or notes about the analysis"
    }
}`;

    const userMessage = `Analyze this company website and extract their seller profile information.

Website URL: ${websiteUrl}

Website Content:
${websiteContent}

Return the JSON analysis.`;

    try {
        const result = await geminiClient.generateJSON(systemPrompt, userMessage);

        return {
            success: true,
            analysis: result.data,
            usage: result.usage
        };
    } catch (error) {
        console.error('Gemini AI analysis error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Main handler for website analysis endpoint
 */
async function analyzeWebsite(req, res) {
    try {
        const { websiteUrl } = req.body;

        if (!websiteUrl) {
            return res.status(400).json({
                success: false,
                error: 'Website URL is required'
            });
        }

        // Step 1: Fetch website content
        console.log('Fetching website:', websiteUrl);
        const fetchResult = await fetchWebsiteContent(websiteUrl);

        if (!fetchResult.success) {
            return res.status(400).json({
                success: false,
                error: `Could not fetch website: ${fetchResult.error}`,
                suggestion: 'Please check the URL and try again, or enter your information manually.'
            });
        }

        // Step 2: Analyze with AI
        console.log('Analyzing website content with AI...');
        const analysisResult = await analyzeWebsiteWithAI(fetchResult.content, fetchResult.url);

        if (!analysisResult.success) {
            return res.status(500).json({
                success: false,
                error: `Analysis failed: ${analysisResult.error}`,
                suggestion: 'Please try again or enter your information manually.'
            });
        }

        // Step 3: Return structured data for frontend
        return res.json({
            success: true,
            data: analysisResult.analysis,
            message: 'Website analyzed successfully. Please review and edit the information below.',
            usage: analysisResult.usage
        });

    } catch (error) {
        console.error('Website analysis error:', error);
        return res.status(500).json({
            success: false,
            error: 'An unexpected error occurred',
            details: error.message
        });
    }
}

module.exports = {
    analyzeWebsite,
    fetchWebsiteContent,
    analyzeWebsiteWithAI
};
