/**
 * Onboarding API - Smart Profile & Website Analysis
 *
 * AI-powered onboarding with:
 * - Website analysis via Gemini
 * - PathManager data integration
 * - AI synthesis for profile pre-filling
 * - Competitor discovery
 * - Plan limit checking
 * - Getting started checklists
 *
 * @version 2.0.0
 * @updated 2026-02-12
 */

const axios = require('axios');
const admin = require('firebase-admin');
const geminiClient = require('../services/geminiClient');
const googlePlaces = require('../services/googlePlaces');
const { getChecklistForIndustry, getProductTemplates, getIcpTemplates, calculateChecklistCompletion } = require('../config/onboardingTemplates');
const { getBenchmarks, calculateProjectedRevenue } = require('../config/industryBenchmarks');
const { PLANS } = require('../config/stripe');

const db = admin.firestore();

// PathManager API base URL from environment
const PATHMANAGER_API_URL = process.env.PATHMANAGER_API_URL || 'https://api.pathmanager.pathsynch.com';

// Industry list for AI prompts
const INDUSTRY_LIST = [
    'Food & Beverage', 'Restaurant', 'Retail', 'Healthcare', 'Real Estate',
    'Professional Services', 'Home Services', 'Automotive', 'Health & Wellness',
    'Salon & Beauty', 'Legal', 'Financial Services', 'Education & Training',
    'Technology & SaaS', 'Manufacturing', 'Construction', 'Hospitality',
    'Entertainment', 'Non-Profit', 'Other'
];

// ============================================
// WEBSITE CONTENT FETCHING
// ============================================

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
            url,
            contentLength: content.length
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

// ============================================
// WEBSITE AI ANALYSIS
// ============================================

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
        "industry": "string - best match from: ${INDUSTRY_LIST.join(', ')}",
        "subIndustry": "string - more specific category if applicable",
        "suggestedSize": "string - estimated size: solo, 2-10, 11-50, 51-200, 201+",
        "websiteUrl": "string - the URL",
        "address": "string or null - physical address if found",
        "phone": "string or null - phone number if found",
        "email": "string or null - contact email if found"
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
        "companySizes": ["array of company sizes they target: solo, 2-10, 11-50, 51-200, 201+"],
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
 * Main handler for website analysis endpoint (legacy)
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

// ============================================
// PATHMANAGER DATA FETCHING
// ============================================

/**
 * Fetch data from PathManager APIs
 * Only runs if user has valid PathManager credentials
 * @param {Object} req - Request with PathManager headers
 * @returns {Object|null} PathManager data or null if not a PM user
 */
async function fetchPathManagerData(req) {
    const authToken = req.headers.authorization;
    const merchantId = req.headers['x-merchant-id'];

    // If no merchant ID, user is not a PathManager user
    if (!merchantId) {
        console.log('No x-merchant-id header - skipping PathManager data fetch');
        return null;
    }

    const headers = {
        'Authorization': authToken,
        'x-merchant-id': merchantId,
        'Content-Type': 'application/json'
    };

    console.log('Fetching PathManager data for merchant:', merchantId);

    try {
        // First verify the token and get merchant profile
        let merchantProfile = null;
        let placeId = null;

        try {
            const verifyResponse = await axios.post(
                `${PATHMANAGER_API_URL}/api/v1/verify-token`,
                {},
                { headers, timeout: 10000 }
            );
            merchantProfile = verifyResponse.data;
            placeId = merchantProfile?.placeId || merchantProfile?.data?.placeId;
        } catch (err) {
            console.log('PathManager verify-token failed:', err.message);
            return null;
        }

        // Fetch remaining data in parallel
        const [
            businessProfileResult,
            dashboardResult,
            locationsResult,
            googleStatusResult,
            formsResult
        ] = await Promise.allSettled([
            // GET /api/v1/monitoring/business-profile?placeId=X
            placeId ? axios.get(`${PATHMANAGER_API_URL}/api/v1/monitoring/business-profile`, {
                headers,
                params: { placeId },
                timeout: 10000
            }) : Promise.resolve(null),

            // GET /api/v1/monitoring/dashboard-overview?placeId=X
            placeId ? axios.get(`${PATHMANAGER_API_URL}/api/v1/monitoring/dashboard-overview`, {
                headers,
                params: { placeId },
                timeout: 10000
            }) : Promise.resolve(null),

            // GET /api/v1/locations/by-merchant?id=X
            axios.get(`${PATHMANAGER_API_URL}/api/v1/locations/by-merchant`, {
                headers,
                params: { id: merchantId },
                timeout: 10000
            }),

            // GET /api/v1/integrations/google/status
            axios.get(`${PATHMANAGER_API_URL}/api/v1/integrations/google/status`, {
                headers,
                timeout: 10000
            }),

            // GET /api/v1/forms?merchantId=X
            axios.get(`${PATHMANAGER_API_URL}/api/v1/forms`, {
                headers,
                params: { merchantId },
                timeout: 10000
            })
        ]);

        // Extract values from settled promises
        const extractValue = (result) => {
            if (result.status === 'fulfilled' && result.value?.data) {
                return result.value.data;
            }
            return null;
        };

        const locations = extractValue(locationsResult);
        const firstLocationId = locations?.data?.[0]?.id || locations?.[0]?.id;

        // Fetch directory health for first location if available
        let directoryHealth = null;
        if (firstLocationId) {
            try {
                const healthResponse = await axios.get(
                    `${PATHMANAGER_API_URL}/api/v1/pdr/impact/${firstLocationId}`,
                    { headers, timeout: 10000 }
                );
                directoryHealth = healthResponse.data;
            } catch (err) {
                console.log('Directory health fetch failed:', err.message);
            }
        }

        return {
            merchant: merchantProfile,
            placeId,
            businessProfile: extractValue(businessProfileResult),
            dashboard: extractValue(dashboardResult),
            locations: locations,
            googleIntegrations: extractValue(googleStatusResult),
            forms: extractValue(formsResult),
            directoryHealth
        };

    } catch (error) {
        console.error('PathManager data fetch error:', error.message);
        return null;
    }
}

// ============================================
// AI SYNTHESIS
// ============================================

/**
 * Use AI to synthesize all data sources into a unified profile
 * @param {Object} data - Combined website and PathManager data
 * @returns {Object} Synthesized profile with recommendations
 */
async function synthesizeProfileData(data) {
    const { website, pathManager, userName } = data;

    const systemPrompt = `You are a business analyst helping set up a sales pitch tool profile.

Given website analysis data and/or PathManager business data, synthesize a complete seller profile.

Your tasks:
1. Determine business type (industry, sub-industry)
2. Estimate company size
3. Identify which onboarding fields can be pre-filled vs need manual input
4. Recommend an ideal customer profile (ICP) based on their business type
5. Suggest products/services list from available data

Return ONLY valid JSON:
{
    "companyProfile": {
        "companyName": "string",
        "industry": "string from: ${INDUSTRY_LIST.join(', ')}",
        "subIndustry": "string - more specific category",
        "size": "string: solo, 2-10, 11-50, 51-200, 201+",
        "address": "string or null",
        "website": "string or null",
        "phone": "string or null"
    },
    "products": [
        {
            "name": "string",
            "description": "string (under 300 chars)",
            "isPrimary": boolean
        }
    ],
    "recommendedIcp": {
        "name": "string - ICP name (e.g., 'Property Management Companies')",
        "targetIndustries": ["array"],
        "companySizes": ["array"],
        "painPoints": ["array of problems this ICP has"],
        "decisionMakers": ["array of job titles"],
        "reasoning": "string - why this ICP makes sense for their business"
    },
    "valueProposition": {
        "uniqueSellingPoints": ["array"],
        "keyBenefits": ["array"],
        "differentiator": "string"
    },
    "existingAssets": {
        "hasGoogleProfile": boolean,
        "hasLocations": boolean,
        "hasFormsData": boolean,
        "googleRating": number or null,
        "reviewCount": number or null,
        "directoryHealthScore": number or null
    },
    "dataCompleteness": {
        "companyProfile": number 0-100,
        "products": number 0-100,
        "icp": number 0-100,
        "valueProposition": number 0-100,
        "branding": number 0-100,
        "overall": number 0-100
    },
    "skipRecommendations": ["array of onboarding step IDs that can be skipped"],
    "manualInputNeeded": ["array of fields that need manual input"],
    "confidence": number 0-100
}`;

    const userMessage = `Synthesize a seller profile from this data:

User Name: ${userName || 'Not provided'}

Website Analysis Data:
${website ? JSON.stringify(website, null, 2) : 'Not available - website could not be analyzed'}

PathManager Business Data:
${pathManager ? JSON.stringify(pathManager, null, 2) : 'Not available - user is not a PathManager customer'}

Create the best possible profile from available data.`;

    try {
        const result = await geminiClient.generateJSON(systemPrompt, userMessage);
        return {
            success: true,
            synthesis: result.data,
            usage: result.usage
        };
    } catch (error) {
        console.error('AI synthesis error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================
// SMART PROFILE ENDPOINT
// ============================================

/**
 * Smart Profile - Main onboarding endpoint
 * Runs parallel data fetch and AI synthesis
 */
async function smartProfile(req, res) {
    try {
        const { websiteUrl, userName } = req.body;
        const userId = req.userId;

        console.log('Smart profile request:', { websiteUrl, userName, userId });

        // Check if website URL is provided
        if (!websiteUrl || websiteUrl.trim() === '') {
            // No website - offer services
            return res.json({
                success: true,
                data: {
                    websiteFound: false,
                    serviceOffer: {
                        type: 'website_creation',
                        title: "We didn't find your website",
                        message: "Would you like to have someone on our team contact you regarding creating a professional SEO-optimized site for your business?",
                        ctaText: "Yes, contact me",
                        ctaSecondary: "I'll add my website later",
                        benefits: [
                            "Mobile-responsive design",
                            "SEO optimized for local search",
                            "Google Business Profile integration",
                            "Review showcase widgets",
                            "Contact form with lead capture"
                        ]
                    },
                    manualEntryEnabled: true,
                    templates: {
                        products: [],
                        icps: []
                    }
                }
            });
        }

        // Run website fetch and PathManager data fetch in parallel
        const [websiteResult, pathManagerResult] = await Promise.allSettled([
            (async () => {
                const fetchResult = await fetchWebsiteContent(websiteUrl);
                if (!fetchResult.success || fetchResult.contentLength < 100) {
                    return { success: false, error: 'Website not accessible or empty' };
                }
                return await analyzeWebsiteWithAI(fetchResult.content, fetchResult.url);
            })(),
            fetchPathManagerData(req)
        ]);

        // Extract results
        const websiteData = websiteResult.status === 'fulfilled' && websiteResult.value?.success
            ? websiteResult.value.analysis
            : null;

        const pathManagerData = pathManagerResult.status === 'fulfilled'
            ? pathManagerResult.value
            : null;

        // Check if we have any data to work with
        const hasWebsiteData = !!websiteData;
        const hasPathManagerData = !!pathManagerData;

        if (!hasWebsiteData && !hasPathManagerData) {
            // No data - offer services and manual entry
            return res.json({
                success: true,
                data: {
                    websiteFound: false,
                    serviceOffer: {
                        type: 'website_creation',
                        title: "We couldn't analyze your website",
                        message: "We had trouble accessing your website. Would you like someone on our team to contact you about creating a professional SEO-optimized site?",
                        ctaText: "Yes, contact me",
                        ctaSecondary: "I'll enter my info manually",
                        benefits: [
                            "Mobile-responsive design",
                            "SEO optimized for local search",
                            "Google Business Profile integration",
                            "Review showcase widgets",
                            "Contact form with lead capture"
                        ]
                    },
                    manualEntryEnabled: true,
                    templates: {
                        products: [],
                        icps: []
                    }
                }
            });
        }

        // Synthesize all data with AI
        console.log('Synthesizing profile data...');
        const synthesisResult = await synthesizeProfileData({
            website: websiteData,
            pathManager: pathManagerData,
            userName
        });

        // Get industry for templates
        const industry = synthesisResult.synthesis?.companyProfile?.industry
            || websiteData?.companyProfile?.industry
            || 'Other';

        const subIndustry = synthesisResult.synthesis?.companyProfile?.subIndustry
            || websiteData?.companyProfile?.subIndustry
            || null;

        // Get benchmarks for value preview
        const benchmarks = getBenchmarks(industry, subIndustry);

        // Return combined result
        return res.json({
            success: true,
            data: {
                websiteFound: hasWebsiteData,
                websiteAnalysis: websiteData,
                pathManagerData: pathManagerData ? {
                    hasGoogleProfile: !!pathManagerData.businessProfile,
                    hasLocations: pathManagerData.locations?.length > 0,
                    hasFormsData: pathManagerData.forms?.length > 0,
                    googleRating: pathManagerData.dashboard?.rating,
                    reviewCount: pathManagerData.dashboard?.totalReviews,
                    businessHours: pathManagerData.businessProfile?.hours,
                    services: pathManagerData.businessProfile?.services,
                    directoryHealthScore: pathManagerData.directoryHealth?.score,
                    locationCount: pathManagerData.locations?.length || 0
                } : null,
                synthesis: synthesisResult.success ? synthesisResult.synthesis : null,
                isPathManagerUser: hasPathManagerData,
                templates: {
                    products: getProductTemplates(industry),
                    icps: getIcpTemplates(industry)
                },
                benchmarks: {
                    avgDealSize: benchmarks.avgDealSize,
                    avgDealSizeRange: benchmarks.avgDealSizeRange,
                    pitchToMeetingRate: benchmarks.pitchToMeetingRate,
                    meetingToCloseRate: benchmarks.meetingToCloseRate
                }
            }
        });

    } catch (error) {
        console.error('Smart profile error:', error);
        return res.status(500).json({
            success: false,
            error: 'An unexpected error occurred',
            details: error.message
        });
    }
}

// ============================================
// COMPETITOR DISCOVERY
// ============================================

/**
 * Find local competitors using Google Places
 */
async function findLocalCompetitors(req, res) {
    try {
        const { industry, address, latitude, longitude, radius = 5000 } = req.query;

        if (!industry) {
            return res.status(400).json({
                success: false,
                error: 'Industry is required'
            });
        }

        // Determine search location
        let location = null;

        if (latitude && longitude) {
            location = { lat: parseFloat(latitude), lng: parseFloat(longitude) };
        } else if (address) {
            // Geocode the address
            location = await geocodeAddress(address);
        }

        if (!location) {
            return res.status(400).json({
                success: false,
                error: 'Location is required (provide address or lat/lng)'
            });
        }

        // Search for competitors using Google Places
        const competitors = await googlePlaces.searchNearby({
            keyword: industry,
            location,
            radius: parseInt(radius)
        });

        // Format and return results
        const formattedCompetitors = (competitors || []).slice(0, 10).map(c => ({
            name: c.name,
            website: c.website || null,
            rating: c.rating || null,
            reviewCount: c.user_ratings_total || 0,
            address: c.formatted_address || c.vicinity,
            placeId: c.place_id,
            priceLevel: c.price_level || null
        }));

        return res.json({
            success: true,
            data: formattedCompetitors,
            count: formattedCompetitors.length
        });

    } catch (error) {
        console.error('Find competitors error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to find competitors',
            details: error.message
        });
    }
}

/**
 * Geocode an address to lat/lng
 */
async function geocodeAddress(address) {
    try {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address,
                key: apiKey
            }
        });

        if (response.data.results && response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            return { lat: location.lat, lng: location.lng };
        }

        return null;
    } catch (error) {
        console.error('Geocode error:', error.message);
        return null;
    }
}

// ============================================
// SERVICE LEAD CAPTURE
// ============================================

/**
 * Submit lead for website creation services
 */
async function submitServiceLead(req, res) {
    try {
        const { phone, preferredContactTime, businessType, notes } = req.body;
        const userId = req.userId;
        const userEmail = req.userEmail;

        // Get user data if available
        let userData = null;
        if (userId) {
            const userDoc = await db.collection('users').doc(userId).get();
            userData = userDoc.exists ? userDoc.data() : null;
        }

        // Create lead document
        const leadData = {
            type: 'website_creation',
            source: 'onboarding_no_website',
            userId: userId || null,
            email: userEmail || userData?.email || null,
            phone: phone || null,
            preferredContactTime: preferredContactTime || null,
            businessType: businessType || null,
            notes: notes || null,
            userName: userData?.name || userData?.displayName || null,
            status: 'new',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const leadRef = await db.collection('serviceLeads').add(leadData);

        // TODO: Send notification to PathManager sales team
        // This could be a webhook, email, or Slack notification

        console.log('Service lead captured:', leadRef.id);

        return res.json({
            success: true,
            message: 'Thank you! Our team will contact you within 24 hours.',
            leadId: leadRef.id
        });

    } catch (error) {
        console.error('Submit service lead error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to submit request'
        });
    }
}

// ============================================
// GETTING STARTED CHECKLIST
// ============================================

/**
 * Get industry-specific getting started checklist
 */
async function getChecklist(req, res) {
    try {
        const { industry, subIndustry } = req.query;
        const userId = req.userId;

        // Get user data for auto-completion checks
        let userData = null;
        if (userId) {
            const userDoc = await db.collection('users').doc(userId).get();
            userData = userDoc.exists ? userDoc.data() : null;
        }

        // Get checklist for industry
        const checklist = getChecklistForIndustry(industry || 'Other', subIndustry);

        // Calculate completion percentage
        const completionPercent = calculateChecklistCompletion(checklist, userData, null);

        // Get templates
        const productTemplates = getProductTemplates(industry || 'Other');
        const icpTemplates = getIcpTemplates(industry || 'Other');

        return res.json({
            success: true,
            data: {
                checklist,
                completionPercent,
                templates: {
                    products: productTemplates,
                    icps: icpTemplates
                }
            }
        });

    } catch (error) {
        console.error('Get checklist error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get checklist'
        });
    }
}

// ============================================
// PLAN LIMIT CHECKING
// ============================================

/**
 * Check if user's needs exceed their current plan limits
 */
async function checkPlanLimits(req, res) {
    try {
        const { teamMembersNeeded, icpsNeeded, workspacesNeeded, pitchesNeeded } = req.body;
        const userId = req.userId;

        // Get user's current plan
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const currentPlan = userData.tier || 'starter';
        const planConfig = PLANS[currentPlan];

        if (!planConfig) {
            return res.status(400).json({
                success: false,
                error: 'Invalid plan configuration'
            });
        }

        const limits = planConfig.limits;
        const issues = [];

        // Check team members
        if (teamMembersNeeded && teamMembersNeeded > limits.teamMembers) {
            const requiredPlan = findPlanWithLimit('teamMembers', teamMembersNeeded);
            issues.push({
                feature: 'teamMembers',
                featureLabel: 'Team Members',
                requested: teamMembersNeeded,
                currentLimit: limits.teamMembers,
                requiredPlan: requiredPlan.name,
                requiredPlanKey: requiredPlan.key,
                requiredPlanPrice: requiredPlan.price,
                message: `You need ${teamMembersNeeded} team members - that requires the ${requiredPlan.name} plan ($${requiredPlan.price}/mo).`
            });
        }

        // Check ICPs
        if (icpsNeeded && limits.icpLimit !== -1 && icpsNeeded > limits.icpLimit) {
            const requiredPlan = findPlanWithLimit('icpLimit', icpsNeeded);
            issues.push({
                feature: 'icpLimit',
                featureLabel: 'ICP Personas',
                requested: icpsNeeded,
                currentLimit: limits.icpLimit,
                requiredPlan: requiredPlan.name,
                requiredPlanKey: requiredPlan.key,
                requiredPlanPrice: requiredPlan.price,
                message: `You need ${icpsNeeded} ICP personas - that requires the ${requiredPlan.name} plan ($${requiredPlan.price}/mo).`
            });
        }

        // Check pitches per month
        if (pitchesNeeded && limits.pitchesPerMonth !== -1 && pitchesNeeded > limits.pitchesPerMonth) {
            const requiredPlan = findPlanWithLimit('pitchesPerMonth', pitchesNeeded);
            issues.push({
                feature: 'pitchesPerMonth',
                featureLabel: 'Pitches per Month',
                requested: pitchesNeeded,
                currentLimit: limits.pitchesPerMonth,
                requiredPlan: requiredPlan.name,
                requiredPlanKey: requiredPlan.key,
                requiredPlanPrice: requiredPlan.price,
                message: `You need ${pitchesNeeded} pitches/month - that requires the ${requiredPlan.name} plan ($${requiredPlan.price}/mo).`
            });
        }

        // Determine the best upgrade recommendation
        let recommendedUpgrade = null;
        if (issues.length > 0) {
            // Find the plan that satisfies all requirements
            const planOrder = ['starter', 'growth', 'scale', 'enterprise'];
            const requiredPlanIndices = issues.map(i =>
                planOrder.indexOf(i.requiredPlanKey)
            );
            const highestRequired = Math.max(...requiredPlanIndices);
            const recommendedPlanKey = planOrder[highestRequired];
            const recommendedPlanConfig = PLANS[recommendedPlanKey];

            recommendedUpgrade = {
                plan: recommendedPlanConfig.name,
                planKey: recommendedPlanKey,
                price: recommendedPlanConfig.price,
                features: recommendedPlanConfig.features,
                satisfiesAll: true
            };
        }

        return res.json({
            success: true,
            data: {
                currentPlan: planConfig.name,
                currentPlanKey: currentPlan,
                hasUpgradeNeeded: issues.length > 0,
                issues,
                recommendedUpgrade
            }
        });

    } catch (error) {
        console.error('Check plan limits error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check plan limits'
        });
    }
}

/**
 * Find the minimum plan that supports a given limit
 */
function findPlanWithLimit(limitType, needed) {
    const planOrder = ['starter', 'growth', 'scale', 'enterprise'];

    for (const planKey of planOrder) {
        const limit = PLANS[planKey]?.limits?.[limitType];
        if (limit === -1 || limit >= needed) {
            return {
                name: PLANS[planKey].name,
                price: PLANS[planKey].price,
                key: planKey
            };
        }
    }

    // Default to enterprise if nothing else works
    return {
        name: 'Enterprise',
        price: PLANS.enterprise?.price || 89,
        key: 'enterprise'
    };
}

// ============================================
// VALUE PREVIEW / ROI CALCULATOR
// ============================================

/**
 * Calculate projected revenue for value preview
 */
async function calculateValuePreview(req, res) {
    try {
        const {
            industry,
            subIndustry,
            pitchesPerMonth,
            avgDealSize,
            pitchToMeetingRate,
            meetingToCloseRate
        } = req.body;

        const result = calculateProjectedRevenue({
            industry,
            subIndustry,
            pitchesPerMonth: pitchesPerMonth || 20,
            customDealSize: avgDealSize,
            customMeetingRate: pitchToMeetingRate,
            customCloseRate: meetingToCloseRate
        });

        return res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Calculate value preview error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to calculate projections'
        });
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Legacy endpoint
    analyzeWebsite,

    // Smart onboarding endpoints
    smartProfile,
    findLocalCompetitors,
    submitServiceLead,
    getChecklist,
    checkPlanLimits,
    calculateValuePreview,

    // Internal functions (for testing)
    fetchWebsiteContent,
    analyzeWebsiteWithAI,
    fetchPathManagerData,
    synthesizeProfileData,
    geocodeAddress,
    findPlanWithLimit
};
