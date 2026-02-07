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
const coresignal = require('../services/coresignal');
const coresignalConfig = require('../config/coresignal');
const census = require('../services/census');
const naics = require('../config/naics');
const { getIndustryIntelligence } = require('../config/industryIntelligence');
const geography = require('../services/geography');
const cbp = require('../services/cbp');
const marketMetrics = require('../services/marketMetrics');
const googleTrends = require('../services/googleTrends');
const secEdgar = require('../services/secEdgar');
const uspto = require('../services/uspto');

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
        const { city, state, zipCode, industry, subIndustry, pitchId, radius: requestedRadius, companySize = 'small' } = req.body;

        // Validate company size
        const validCompanySizes = ['small', 'medium', 'large', 'national'];
        const normalizedCompanySize = validCompanySizes.includes(companySize?.toLowerCase())
            ? companySize.toLowerCase()
            : 'small';

        // Dynamic radius scaling based on company size
        // If user explicitly provides radius, use it; otherwise scale based on company size
        const companySizeRadiusMap = {
            'small': 5000,      // 5km (~3 miles) - local businesses
            'medium': 25000,    // 25km (~15 miles) - regional businesses
            'large': 100000,    // 100km (~62 miles) - multi-location businesses
            'national': 250000  // 250km (~155 miles) - national/enterprise HQs
        };
        const radius = requestedRadius || companySizeRadiusMap[normalizedCompanySize] || 5000;

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

        // Determine data source type for this industry
        const dataSourceType = naics.getDataSourceType(naicsCode);
        const supportsPlaces = naics.supportsCompetitorDiscovery(naicsCode);

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

        // Get custom industry name if "Other" category
        const { customIndustryName } = req.body;
        const displayIndustryName = naicsCode === '999999' && customIndustryName
            ? customIndustryName
            : industry;

        // Parallel data fetch
        const [competitorResult, demographicResult, establishmentResult, demandSignalsResult] = await Promise.all([
            // Competitors: route through fetchCompetitors helper
            fetchCompetitors({
                dataSourceType,
                supportsPlaces,
                industryDetails,
                locationString,
                radius,
                naicsCode,
                city,
                state,
                industry: displayIndustryName,
                companySize: normalizedCompanySize
            }),
            // Demographics - try place level first, then county, then state
            fetchDemographicsWithFallback(geo),
            // CBP establishment data (if Growth+ tier)
            tier !== 'starter' && geo.countyFips
                ? cbp.getEstablishmentCount(naicsCode, geo.countyFips, geo.stateFips)
                : Promise.resolve(null),
            // Demand signals with company size-based seasonality
            googleTrends.getDemandSignals(naicsCode, state, city, normalizedCompanySize)
        ]);

        const demandSignals = demandSignalsResult?.data || null;

        let competitors = competitorResult.competitors || [];
        const competitorSource = competitorResult.source || (supportsPlaces ? 'google_places' : 'manual');
        const demographics = demographicResult?.data || {};

        // For enterprise searches (large/national), enrich competitors with SEC EDGAR data
        // This adds financial data for public company competitors
        const isEnterpriseSearch = normalizedCompanySize === 'large' || normalizedCompanySize === 'national';
        let secEnrichedCount = 0;

        if (isEnterpriseSearch && competitors.length > 0 && (tier === 'growth' || tier === 'scale')) {
            try {
                competitors = await secEdgar.enrichCompetitorsWithSec(competitors, 5);
                secEnrichedCount = competitors.filter(c => c.secData).length;
                console.log(`SEC enrichment: ${secEnrichedCount} of ${competitors.length} competitors enriched`);
            } catch (secError) {
                console.warn('SEC enrichment failed:', secError.message);
                // Continue without SEC data
            }
        }

        // USPTO Patent Data Enrichment (Growth+ tiers)
        // NOTE: Disabled as of Feb 2026 - PatentsView Legacy API discontinued May 2025
        // New PatentSearch API requires registration at https://search.patentsview.org
        // TODO: Register for new API and re-enable this feature
        let patentEnrichedCount = 0;
        /*
        if (competitors.length > 0 && (tier === 'growth' || tier === 'scale')) {
            try {
                competitors = await uspto.enrichCompetitorsWithPatents(competitors, 5);
                patentEnrichedCount = competitors.filter(c => c.patentData?.found).length;
                console.log(`USPTO enrichment: ${patentEnrichedCount} of ${competitors.length} competitors enriched with patent data`);
            } catch (patentError) {
                console.warn('USPTO enrichment failed:', patentError.message);
                // Continue without patent data
            }
        }
        */

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

            // Calculate growth rate with CBP trend data and demand signals
            growthRate = marketMetrics.calculateGrowthRate(
                establishmentTrend,
                demandSignals, // demandSignals with company size seasonality
                demographics,
                naicsCode
            );

            // Calculate opportunity score with demand signals
            opportunityScore = marketMetrics.calculateOpportunityScore(
                saturation,
                growthRate,
                demographics,
                demandSignals, // demandSignals with company size seasonality
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
                display: displayIndustryName,
                subIndustry: subIndustry || null,
                naicsCode: naicsCode,
                naicsTitle: industryDetails?.title || displayIndustryName,
                avgTransaction: industryDetails?.avgTransaction || naics.getAvgTransaction(naicsCode),
                monthlyCustomers: industryDetails?.monthlyCustomers || naics.getMonthlyCustomers(naicsCode),
                dataSourceType: dataSourceType,
                customName: customIndustryName || null
            },
            // Sales intelligence for this industry/sub-industry
            salesIntelligence: getIndustryIntelligence(industry, subIndustry),
            companySize: {
                size: normalizedCompanySize,
                label: demandSignals?.companySize?.label || googleTrends.getCompanySizeConfig(normalizedCompanySize).label,
                marketReach: demandSignals?.companySize?.marketReach || 'local',
                planningHorizon: demandSignals?.companySize?.planningHorizon || '1-3 months'
            },
            radius: radius,
            data: {
                // Data source metadata
                dataSource: {
                    type: dataSourceType,
                    provider: competitorSource,
                    competitorDiscovery: competitorSource === 'coresignal'
                        ? 'automatic_b2b'
                        : supportsPlaces ? 'automatic' : 'manual',
                    note: competitorSource === 'coresignal'
                        ? 'Competitor data sourced from CoreSignal B2B database.'
                        : !supportsPlaces
                            ? 'This industry requires manual competitor research. Use industry reports, LinkedIn, or other sources to identify competitors.'
                            : dataSourceType === 'limited'
                                ? 'Limited competitor data available. Results may not be comprehensive.'
                                : null
                },

                // Competitors (all tiers)
                competitors: competitors.slice(0, 20).map(c => ({
                    name: c.name,
                    address: c.address,
                    rating: c.rating,
                    reviews: c.reviewCount || c.reviews,
                    location: c.location || null,
                    priceLevel: c.priceLevel || null,
                    isHeadquarters: c.isHeadquarters || false,
                    // Website: prefer Google Places data, fallback to SEC data for public companies
                    website: c.website || c.secData?.website || null,
                    ...(c.coresignalId && { coresignalId: c.coresignalId }),
                    ...(c.firmographics && { firmographics: c.firmographics }),
                    // SEC EDGAR data for public companies (Growth+ tiers, enterprise searches)
                    ...(c.secData && {
                        secData: {
                            isPublic: true,
                            ticker: c.secData.ticker || null,
                            website: c.secData.website || null,
                            revenue: c.secData.revenue || null,
                            revenueGrowth: c.secData.revenueGrowth || null,
                            netMargin: c.secData.netMargin || null,
                            employees: c.secData.employees || null,
                            latestFilingDate: c.secData.latestFilingDate || null,
                            secUrl: c.secData.secUrl || null
                        }
                    }),
                    // USPTO Patent data (Growth+ tiers)
                    ...(c.patentData?.found && {
                        patentData: {
                            totalPatents: c.patentData.totalPatents || 0,
                            recentPatentCount: c.patentData.recentPatentCount || 0,
                            firstPatentDate: c.patentData.firstPatentDate || null,
                            lastPatentDate: c.patentData.lastPatentDate || null,
                            innovationSignal: c.patentData.innovationSignal || 'low',
                            recentPatents: (c.patentData.recentPatents || []).slice(0, 3)
                        }
                    })
                })),
                competitorCount: competitors.length,
                publicCompanyCount: secEnrichedCount,
                competitorDataAvailable: (supportsPlaces || competitorSource === 'coresignal') && competitors.length > 0,

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

                // Seasonality data (all tiers)
                seasonality: {
                    pattern: demandSignals?.seasonality?.pattern || 'stable',
                    isInPeakSeason: demandSignals?.seasonality?.isInPeakSeason || false,
                    peakMonths: demandSignals?.seasonality?.peakMonths || [],
                    impactScore: demandSignals?.seasonality?.impactScore || 50,
                    sensitivity: demandSignals?.seasonality?.sensitivity || 1.0
                },
                demandSignals: {
                    currentInterest: demandSignals?.currentInterest || 50,
                    yoyChange: demandSignals?.yoyChange || 0,
                    trendDirection: demandSignals?.trendDirection || 'stable',
                    momentumScore: demandSignals?.momentumScore || 50,
                    recommendations: demandSignals?.recommendations || null
                },

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
                    fiveYearProjection: growthRate.fiveYearProjection || null,

                    // Public Company Intelligence (SEC EDGAR) for enterprise searches
                    ...(secEnrichedCount > 0 && {
                        publicCompanyIntelligence: buildPublicCompanyIntelligence(competitors)
                    }),

                    // Patent Intelligence (USPTO) for Growth+ tiers
                    ...(patentEnrichedCount > 0 && {
                        patentIntelligence: uspto.buildPatentIntelligence(competitors, industry)
                    })
                })
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Generate executive summary
        reportData.executiveSummary = marketMetrics.generateExecutiveSummary({
            location: reportData.location,
            industry: reportData.industry,
            competitors: competitors,
            demographics: demographics,
            saturation: saturation,
            marketSize: marketSize,
            growthRate: growthRate,
            opportunityScore: opportunityScore,
            companySize: normalizedCompanySize
        });

        await reportRef.set(reportData);

        // Save custom sub-industry if provided (for future dropdown population)
        if (subIndustry) {
            await saveCustomSubIndustryInternal(userId, industry, subIndustry);
        }

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
 * Fetch competitors using the appropriate data source
 *
 * Routing logic:
 *   'places' industries  -> Google Places (unchanged)
 *   'limited' industries -> CoreSignal -> Google Places fallback -> empty
 *   'manual' industries  -> CoreSignal -> empty
 *
 * For large/national company sizes:
 *   - Also searches for corporate headquarters
 *   - Merges results from regular search and HQ search
 *
 * When ENABLE_CORESIGNAL is off, behavior is identical to the existing flow.
 *
 * @param {Object} params
 * @returns {Promise<Object>} { success, competitors, totalFound, source, coordinates? }
 */
async function fetchCompetitors({ dataSourceType, supportsPlaces, industryDetails, locationString, radius, naicsCode, city, state, industry, companySize = 'small' }) {
    const isEnterpriseSearch = companySize === 'large' || companySize === 'national';

    // Helper to merge and deduplicate competitors
    const mergeCompetitors = (primary, secondary) => {
        const seen = new Set(primary.map(c => c.placeId || c.name?.toLowerCase()));
        const merged = [...primary];

        for (const comp of secondary) {
            const key = comp.placeId || comp.name?.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(comp);
            }
        }

        return merged;
    };

    // 'places' industries always go to Google Places
    if (dataSourceType === 'places') {
        if (industryDetails?.placesKeyword) {
            const result = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

            // For enterprise searches, also look for headquarters
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(hqResult.competitors, result.competitors || []);
                    return {
                        ...result,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        source: 'google_places',
                        includesHeadquarters: true
                    };
                }
            }

            return { ...result, source: 'google_places' };
        }
        return { competitors: [], coordinates: null, source: 'google_places' };
    }

    // For 'limited' and 'manual': try CoreSignal first if enabled
    if (coresignalConfig.isEnabled()) {
        const csResult = await coresignal.findCompetitors({
            naicsCode,
            city,
            state,
            industry,
            radius
        });

        if (csResult.success && csResult.competitors.length > 0) {
            // For enterprise, supplement with HQ search
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(csResult.competitors, hqResult.competitors);
                    return {
                        ...csResult,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        includesHeadquarters: true
                    };
                }
            }
            return csResult; // source is already 'coresignal'
        }

        // CoreSignal returned nothing - fall back for 'limited' industries
        if (dataSourceType === 'limited' && industryDetails?.placesKeyword) {
            console.log(`CoreSignal returned no results for ${naicsCode}, falling back to Google Places`);
            const placesResult = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

            // For enterprise, also search for HQs
            if (isEnterpriseSearch) {
                const hqResult = await googlePlaces.findHeadquarters(
                    industry,
                    locationString,
                    radius,
                    industryDetails?.headquartersKeywords
                );
                if (hqResult.success && hqResult.competitors.length > 0) {
                    const merged = mergeCompetitors(hqResult.competitors, placesResult.competitors || []);
                    return {
                        ...placesResult,
                        competitors: merged.slice(0, 30),
                        totalFound: merged.length,
                        source: 'google_places',
                        includesHeadquarters: true
                    };
                }
            }

            return { ...placesResult, source: 'google_places' };
        }

        // 'manual' with no CoreSignal results -> try HQ search for enterprise
        if (isEnterpriseSearch) {
            const hqResult = await googlePlaces.findHeadquarters(
                industry,
                locationString,
                radius,
                industryDetails?.headquartersKeywords
            );
            if (hqResult.success && hqResult.competitors.length > 0) {
                return {
                    ...hqResult,
                    source: 'google_places_headquarters',
                    includesHeadquarters: true
                };
            }
        }

        return { competitors: [], coordinates: null, source: 'coresignal', totalFound: 0 };
    }

    // CoreSignal disabled: use existing behavior with HQ search for enterprise
    if (supportsPlaces && industryDetails?.placesKeyword) {
        const result = await googlePlaces.findCompetitors(locationString, industryDetails.placesKeyword, radius);

        // For enterprise, supplement with HQ search
        if (isEnterpriseSearch) {
            const hqResult = await googlePlaces.findHeadquarters(
                industry,
                locationString,
                radius,
                industryDetails?.headquartersKeywords
            );
            if (hqResult.success && hqResult.competitors.length > 0) {
                const merged = mergeCompetitors(hqResult.competitors, result.competitors || []);
                return {
                    ...result,
                    competitors: merged.slice(0, 30),
                    totalFound: merged.length,
                    source: 'google_places',
                    includesHeadquarters: true
                };
            }
        }

        return { ...result, source: 'google_places' };
    }

    // Manual industry, CoreSignal disabled -> still try HQ search for enterprise
    if (isEnterpriseSearch) {
        const hqResult = await googlePlaces.findHeadquarters(
            industry,
            locationString,
            radius,
            industryDetails?.headquartersKeywords
        );
        if (hqResult.success && hqResult.competitors.length > 0) {
            return {
                ...hqResult,
                source: 'google_places_headquarters',
                includesHeadquarters: true
            };
        }
    }

    return { competitors: [], coordinates: null, source: 'manual' };
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
 * Build aggregated public company intelligence summary from SEC-enriched competitors
 */
function buildPublicCompanyIntelligence(competitors) {
    const publicCompanies = competitors.filter(c => c.secData?.isPublic);

    if (publicCompanies.length === 0) {
        return null;
    }

    // Aggregate financial metrics
    const revenues = publicCompanies
        .filter(c => c.secData.revenueRaw)
        .map(c => ({ name: c.name, ticker: c.secData.ticker, value: c.secData.revenueRaw }));

    const totalMarketRevenue = revenues.reduce((sum, r) => sum + r.value, 0);

    const growthRates = publicCompanies
        .filter(c => c.secData.revenueGrowthRaw !== null && c.secData.revenueGrowthRaw !== undefined)
        .map(c => c.secData.revenueGrowthRaw);

    const avgGrowthRate = growthRates.length > 0
        ? growthRates.reduce((sum, r) => sum + r, 0) / growthRates.length
        : null;

    const margins = publicCompanies
        .filter(c => c.secData.netMargin)
        .map(c => parseFloat(c.secData.netMargin));

    const avgNetMargin = margins.length > 0
        ? margins.reduce((sum, m) => sum + m, 0) / margins.length
        : null;

    const employeeCounts = publicCompanies
        .filter(c => c.secData.employeesRaw)
        .map(c => ({ name: c.name, ticker: c.secData.ticker, employees: c.secData.employeesRaw }));

    const totalEmployees = employeeCounts.reduce((sum, e) => sum + e.employees, 0);

    // Find market leader (by revenue)
    const marketLeader = revenues.length > 0
        ? revenues.sort((a, b) => b.value - a.value)[0]
        : null;

    // Find fastest growing
    const fastestGrowing = publicCompanies
        .filter(c => c.secData.revenueGrowthRaw !== null)
        .sort((a, b) => (b.secData.revenueGrowthRaw || 0) - (a.secData.revenueGrowthRaw || 0))[0];

    return {
        publicCompanyCount: publicCompanies.length,
        summary: {
            totalMarketRevenue: totalMarketRevenue > 0 ? secEdgar.formatFinancialValue(totalMarketRevenue) : null,
            totalMarketRevenueRaw: totalMarketRevenue || null,
            averageGrowthRate: avgGrowthRate !== null ? `${avgGrowthRate > 0 ? '+' : ''}${avgGrowthRate.toFixed(1)}%` : null,
            averageNetMargin: avgNetMargin !== null ? `${avgNetMargin.toFixed(1)}%` : null,
            totalEmployees: totalEmployees > 0 ? totalEmployees.toLocaleString() : null,
            totalEmployeesRaw: totalEmployees || null
        },
        marketLeader: marketLeader ? {
            name: marketLeader.name || null,
            ticker: marketLeader.ticker || null,
            revenue: secEdgar.formatFinancialValue(marketLeader.value) || null
        } : null,
        fastestGrowing: fastestGrowing ? {
            name: fastestGrowing.name || null,
            ticker: fastestGrowing.secData?.ticker || null,
            growthRate: fastestGrowing.secData?.revenueGrowth || null
        } : null,
        companies: publicCompanies.map(c => ({
            name: c.name || null,
            ticker: c.secData?.ticker || null,
            revenue: c.secData?.revenue || null,
            revenueGrowth: c.secData?.revenueGrowth || null,
            netMargin: c.secData?.netMargin || null,
            employees: c.secData?.employees || null,
            secUrl: c.secData?.secUrl || null
        }))
    };
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
        industry: reportData.industry,
        salesIntelligence: reportData.salesIntelligence,
        companySize: reportData.companySize
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
 * Includes metadata about data source availability for each industry
 */
async function getIndustries(req, res) {
    try {
        const industriesWithMetadata = naics.getIndustriesForDropdown();

        return res.status(200).json({
            success: true,
            data: industriesWithMetadata
        });
    } catch (error) {
        console.error('Error getting industries:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get industries'
        });
    }
}

/**
 * Get company size options for dropdown
 */
async function getCompanySizes(req, res) {
    try {
        const sizes = googleTrends.getCompanySizeOptions();

        return res.status(200).json({
            success: true,
            data: sizes
        });
    } catch (error) {
        console.error('Error getting company sizes:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get company sizes'
        });
    }
}

/**
 * Get user's custom sub-industries
 * These are sub-industries the user has created through market reports
 */
async function getCustomSubIndustries(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const customSubIndustriesDoc = await db.collection('customSubIndustries').doc(userId).get();

        if (!customSubIndustriesDoc.exists) {
            return res.status(200).json({
                success: true,
                data: {}
            });
        }

        return res.status(200).json({
            success: true,
            data: customSubIndustriesDoc.data().industries || {}
        });
    } catch (error) {
        console.error('Error getting custom sub-industries:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get custom sub-industries'
        });
    }
}

/**
 * Save a custom sub-industry for a user
 * Called automatically when generating a market report with a new sub-industry
 */
async function saveCustomSubIndustry(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const { industry, subIndustry } = req.body;

        if (!industry || !subIndustry) {
            return res.status(400).json({
                success: false,
                error: 'Industry and subIndustry are required'
            });
        }

        // Get or create the user's custom sub-industries document
        const docRef = db.collection('customSubIndustries').doc(userId);

        // Add the new sub-industry to the appropriate industry category
        await docRef.set({
            industries: {
                [industry]: admin.firestore.FieldValue.arrayUnion({
                    value: subIndustry,
                    label: subIndustry,
                    createdAt: new Date().toISOString()
                })
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
            success: true,
            message: 'Custom sub-industry saved'
        });
    } catch (error) {
        console.error('Error saving custom sub-industry:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to save custom sub-industry'
        });
    }
}

/**
 * Internal helper to save custom sub-industry (called from generateReport)
 */
async function saveCustomSubIndustryInternal(userId, industry, subIndustry) {
    if (!userId || !industry || !subIndustry) return;

    try {
        // Check if this sub-industry already exists in the built-in list
        const builtInSubcategories = naics.getSubcategories(industry);
        const isBuiltIn = builtInSubcategories.some(
            sub => sub.name.toLowerCase() === subIndustry.toLowerCase()
        );

        if (isBuiltIn) return; // Don't save built-in sub-industries

        // Save to user's custom sub-industries
        const docRef = db.collection('customSubIndustries').doc(userId);
        await docRef.set({
            industries: {
                [industry]: admin.firestore.FieldValue.arrayUnion({
                    value: subIndustry,
                    label: subIndustry,
                    createdAt: new Date().toISOString()
                })
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Saved custom sub-industry "${subIndustry}" for industry "${industry}" for user ${userId}`);
    } catch (error) {
        console.error('Error saving custom sub-industry internally:', error);
        // Don't throw - this is a non-critical operation
    }
}

module.exports = {
    generateReport,
    listReports,
    getReport,
    getIndustries,
    getCompanySizes,
    getCustomSubIndustries,
    saveCustomSubIndustry,
    saveCustomSubIndustryInternal
};
