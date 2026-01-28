/**
 * Market Intelligence API Handlers
 *
 * Generates market reports with competitor analysis and demographics
 * Enhanced with NAICS taxonomy, city-level Census data, and opportunity scoring
 */

const admin = require('firebase-admin');
const { getUserPlan, getUserUsage } = require('../middleware/planGate');
const { getPlanLimits, hasFeature, PLANS } = require('../config/stripe');
const googlePlaces = require('../services/googlePlaces');
const census = require('../services/census');
const naics = require('../config/naics');
const geography = require('../services/geography');
const cbp = require('../services/cbp');
const marketMetrics = require('../services/marketMetrics');

const db = admin.firestore();

/**
 * Generate a new market intelligence report
 */
async function generateReport(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        // Check if user has market reports feature
        const plan = await getUserPlan(userId);

        if (!hasFeature(plan, 'marketReports')) {
            return res.status(403).json({
                success: false,
                error: 'Feature not available',
                message: 'Market intelligence reports are available on Growth and Scale plans.',
                currentPlan: plan
            });
        }

        // Check usage limits
        const usage = await getUserUsage(userId);
        const limits = getPlanLimits(plan);

        if (usage.marketReportsThisMonth >= limits.marketReportsPerMonth) {
            return res.status(429).json({
                success: false,
                error: 'Usage limit reached',
                message: `You've used all ${limits.marketReportsPerMonth} market reports for this month. Limit resets next month.`,
                usage: {
                    current: usage.marketReportsThisMonth,
                    limit: limits.marketReportsPerMonth
                }
            });
        }

        // Get request data
        const { city, state, zipCode, industry, subIndustry, pitchId, radius = 5000 } = req.body;

        if (!industry) {
            return res.status(400).json({
                success: false,
                error: 'Industry is required'
            });
        }

        if (!city && !state && !zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Location is required (city/state or zip code)'
            });
        }

        // Convert industry to NAICS code
        const naicsCodes = naics.getNaicsByDisplay(subIndustry || industry);
        const naicsCode = naicsCodes[0] || '722511'; // Default to restaurants
        const industryDetails = naics.getNaicsDetails(naicsCode);

        // Get geography (place/county/state FIPS)
        const geo = geography.getCensusGeography(city, state, zipCode);

        // Build location string for Google Places
        const locationString = zipCode
            ? zipCode
            : `${city || ''}, ${state || ''}`.trim().replace(/^,\s*|,\s*$/g, '');

        // Determine user's tier for response building
        const planDetails = PLANS[plan] || PLANS.starter;
        const tier = plan === 'scale' ? 'scale' : plan === 'growth' ? 'growth' : 'starter';
        const marketFeatures = planDetails.limits?.marketFeatures || {};

        // Parallel data fetch
        const [competitorResult, demographicResult, establishmentResult] = await Promise.all([
            // Competitors from Google Places
            googlePlaces.findCompetitors(locationString, industryDetails?.placesKeyword || industry, radius),
            // Demographics - try place level first, then county, then state
            fetchDemographicsWithFallback(geo),
            // CBP establishment data (if Growth+ tier)
            tier !== 'starter' && geo.countyFips
                ? cbp.getEstablishmentCount(naicsCode, geo.countyFips, geo.stateFips)
                : Promise.resolve(null)
        ]);

        const competitors = competitorResult.competitors || [];
        const demographics = demographicResult?.data || {};

        // Calculate enhanced metrics using new marketMetrics service
        const saturation = marketMetrics.calculateSaturationScore(
            competitors,
            demographics,
            naicsCode,
            radius
        );

        const marketSize = marketMetrics.calculateMarketSize(
            demographics,
            naicsCode,
            competitors
        );

        // Fetch additional data for Growth+ tiers
        let ageDistribution = null;
        let educationProfile = null;
        let commutePatterns = null;
        let establishmentTrend = null;
        let growthRate = null;
        let opportunityScore = null;
        let recommendations = null;

        if (tier === 'growth' || tier === 'scale') {
            // Fetch detailed demographics in parallel
            const [ageData, eduData, commuteData, trendData] = await Promise.all([
                census.getAgeDistribution(geo),
                census.getEducationProfile(geo),
                census.getCommutePatterns(geo),
                geo.countyFips
                    ? cbp.getEstablishmentTrend(naicsCode, geo.countyFips, geo.stateFips)
                    : Promise.resolve(null)
            ]);

            ageDistribution = ageData;
            educationProfile = eduData;
            commutePatterns = commuteData;
            establishmentTrend = trendData;

            // Calculate growth rate with CBP trend data
            growthRate = marketMetrics.calculateGrowthRate(
                establishmentTrend,
                null, // demandSignals (Google Trends) - optional
                demographics,
                naicsCode
            );

            // Calculate opportunity score
            opportunityScore = marketMetrics.calculateOpportunityScore(
                saturation,
                growthRate,
                demographics,
                null, // demandSignals
                competitors,
                naicsCode
            );

            // Generate recommendations
            recommendations = marketMetrics.generateRecommendations({
                demographics,
                saturation,
                opportunity: opportunityScore,
                competitors,
                ageDistribution,
                educationProfile,
                commutePatterns,
                naicsCode
            });
        } else {
            // Basic growth rate for starter tier
            growthRate = census.estimateGrowthRate(industry, demographics);
        }

        // Create report document
        const reportRef = db.collection('marketReports').doc();
        const reportData = {
            id: reportRef.id,
            userId: userId,
            pitchId: pitchId || null,
            tier: tier,
            location: {
                city: city || null,
                state: state || null,
                zipCode: zipCode || null,
                coordinates: competitorResult.coordinates || null,
                geoLevel: geo.geoLevel
            },
            industry: {
                display: industry,
                subIndustry: subIndustry || null,
                naicsCode: naicsCode,
                naicsTitle: industryDetails?.title || industry
            },
            radius: radius,
            data: {
                // Competitors (all tiers)
                competitors: competitors.slice(0, 20).map(c => ({
                    name: c.name,
                    address: c.address,
                    rating: c.rating,
                    reviews: c.reviewCount || c.reviews,
                    location: c.location || null,
                    priceLevel: c.priceLevel || null
                })),
                competitorCount: competitors.length,

                // Basic demographics (all tiers)
                demographics: {
                    population: demographics.population || null,
                    medianIncome: demographics.medianIncome || null,
                    households: demographics.households || null,
                    homeOwnershipRate: demographics.homeOwnershipRate || null,
                    geoLevel: geo.geoLevel
                },

                // Market metrics (all tiers)
                marketSize: marketSize.totalAddressableMarket,
                marketPerBusiness: marketSize.marketPerBusiness,
                saturation: saturation.level,
                saturationScore: saturation.score,
                saturationComponents: saturation.components,
                growthRate: growthRate.annualGrowthRate || growthRate.annualGrowthRate,

                // Growth+ tier data
                ...(tier !== 'starter' && {
                    opportunityScore: opportunityScore?.score || null,
                    opportunityLevel: opportunityScore?.level || null,
                    opportunityFactors: opportunityScore?.factors || null,
                    opportunityRationale: opportunityScore?.rationale || null,

                    ageDistribution: ageDistribution?.data?.ageGroups || null,
                    educationProfile: educationProfile?.data?.levels || null,
                    bachelorsPlusPct: educationProfile?.data?.bachelorsPlusPct || null,
                    commutePatterns: commutePatterns?.data?.modes || null,
                    walkabilityScore: commutePatterns?.data?.walkabilityScore || null,
                    wfhRate: commutePatterns?.data?.wfhRate || null,

                    establishmentCount: establishmentResult?.data?.establishmentCount || null,
                    establishmentTrend: establishmentTrend?.data?.trendLabel || null,

                    recommendations: recommendations || null,

                    growthComponents: growthRate.components || null,
                    fiveYearProjection: growthRate.fiveYearProjection || null
                })
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await reportRef.set(reportData);

        // Update usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;

        await db.collection('usage').doc(usageId).set({
            marketReportsThisMonth: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Build tiered response
        const response = buildTieredResponse(tier, reportRef.id, reportData);

        return res.status(200).json(response);

    } catch (error) {
        console.error('Error generating market report:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate market report',
            message: error.message
        });
    }
}

/**
 * List user's market reports
 */
async function listReports(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;

        const reportsQuery = db.collection('marketReports')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .offset(offset)
            .limit(limit);

        const snapshot = await reportsQuery.get();

        const reports = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                location: data.location,
                industry: data.industry,
                saturation: data.data?.saturation,
                competitorCount: data.data?.competitorCount,
                marketSize: data.data?.marketSize,
                createdAt: data.createdAt
            };
        });

        return res.status(200).json({
            success: true,
            data: reports
        });

    } catch (error) {
        console.error('Error listing reports:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list reports'
        });
    }
}

/**
 * Get a specific market report
 */
async function getReport(req, res) {
    const userId = req.userId;
    const reportId = req.params.reportId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const reportDoc = await db.collection('marketReports').doc(reportId).get();

        if (!reportDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Report not found'
            });
        }

        const reportData = reportDoc.data();

        // Verify ownership
        if (reportData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: reportDoc.id,
                ...reportData
            }
        });

    } catch (error) {
        console.error('Error getting report:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get report'
        });
    }
}

/**
 * Fetch demographics with place -> county -> state fallback
 */
async function fetchDemographicsWithFallback(geo) {
    // Try place level first
    if (geo.placeFips) {
        const placeResult = await census.getDemographicsAtPlace(geo.placeFips, geo.stateFips);
        if (placeResult?.success) {
            return placeResult;
        }
    }

    // Try county level
    if (geo.countyFips) {
        const countyResult = await census.getDemographicsAtCounty(geo.countyFips, geo.stateFips);
        if (countyResult?.success) {
            return countyResult;
        }
    }

    // Fall back to state level
    return await census.getDemographics(geo.stateFips);
}

/**
 * Build tier-appropriate response
 */
function buildTieredResponse(tier, reportId, reportData) {
    const baseResponse = {
        success: true,
        reportId: reportId,
        tier: tier,
        location: reportData.location,
        industry: reportData.industry
    };

    // Starter tier - basic data only
    if (tier === 'starter') {
        return {
            ...baseResponse,
            data: {
                competitors: reportData.data.competitors,
                competitorCount: reportData.data.competitorCount,
                demographics: reportData.data.demographics,
                marketSize: reportData.data.marketSize,
                marketPerBusiness: reportData.data.marketPerBusiness,
                saturation: reportData.data.saturation,
                saturationScore: reportData.data.saturationScore,
                growthRate: reportData.data.growthRate
            },
            upgradePrompt: {
                message: 'Unlock opportunity scores, detailed demographics, trends, and recommendations',
                features: ['Opportunity Score', 'Age & Education Demographics', 'Business Trends', 'AI Recommendations'],
                cta: 'Upgrade to Growth'
            }
        };
    }

    // Growth tier - full data except PDF export
    if (tier === 'growth') {
        return {
            ...baseResponse,
            data: reportData.data,
            upgradePrompt: {
                message: 'Unlock PDF export and pitch integration',
                features: ['PDF Report Export', 'Pitch Deck Integration'],
                cta: 'Upgrade to Scale'
            }
        };
    }

    // Scale tier - everything
    return {
        ...baseResponse,
        data: reportData.data,
        features: {
            pdfExport: true,
            pitchIntegration: true
        }
    };
}

/**
 * Get available industries for dropdown
 */
async function getIndustries(req, res) {
    try {
        const categories = naics.getDisplayCategories();
        const industries = categories.map(category => ({
            name: category,
            subcategories: naics.getSubcategories(category)
        }));

        return res.status(200).json({
            success: true,
            data: industries
        });
    } catch (error) {
        console.error('Error getting industries:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get industries'
        });
    }
}

module.exports = {
    generateReport,
    listReports,
    getReport,
    getIndustries
};
