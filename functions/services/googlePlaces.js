/**
 * Google Places API Service
 *
 * Wrapper for Google Places API to find competitors and business data
 * Includes caching to reduce API costs
 */

const { Client } = require('@googlemaps/google-maps-services-js');
const marketCache = require('./marketCache');

const client = new Client({});

/**
 * Search for competitors in a given location and industry
 * Results are cached for 24 hours to reduce API costs
 */
async function findCompetitors(location, industry, radius = 5000) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
        console.warn('Google Places API key not configured');
        return {
            success: false,
            error: 'Google Places API not configured',
            competitors: []
        };
    }

    // Create cache params
    const cacheParams = {
        location: typeof location === 'string' ? location.toLowerCase().trim() : JSON.stringify(location),
        industry: industry.toLowerCase().trim(),
        radius
    };

    // Check cache first
    try {
        const cached = await marketCache.getCached('competitors', cacheParams);
        if (cached) {
            console.log('Cache hit for competitors:', cacheParams.location, cacheParams.industry);
            return {
                ...cached.data,
                fromCache: true,
                cachedAt: cached.cachedAt
            };
        }
    } catch (cacheError) {
        console.warn('Cache read error:', cacheError.message);
    }

    try {
        // First, geocode the location to get coordinates
        let coordinates;

        if (typeof location === 'string') {
            const geocodeResponse = await client.geocode({
                params: {
                    address: location,
                    key: apiKey
                }
            });

            if (geocodeResponse.data.results.length === 0) {
                return {
                    success: false,
                    error: 'Could not find location',
                    competitors: []
                };
            }

            coordinates = geocodeResponse.data.results[0].geometry.location;
        } else {
            coordinates = location;
        }

        // Search for nearby businesses in the industry
        const searchQuery = mapIndustryToSearchQuery(industry);

        const placesResponse = await client.placesNearby({
            params: {
                location: coordinates,
                radius: radius,
                keyword: searchQuery,
                key: apiKey
            }
        });

        const competitors = placesResponse.data.results.slice(0, 20).map(place => ({
            name: place.name,
            address: place.vicinity,
            rating: place.rating || null,
            reviewCount: place.user_ratings_total || 0,
            priceLevel: place.price_level || null,
            placeId: place.place_id,
            types: place.types || [],
            openNow: place.opening_hours?.open_now || null,
            location: place.geometry?.location || null
        }));

        const result = {
            success: true,
            coordinates: coordinates,
            competitors: competitors,
            totalFound: placesResponse.data.results.length
        };

        // Cache the result
        try {
            await marketCache.setCache('competitors', cacheParams, result);
            console.log('Cached competitors for:', cacheParams.location, cacheParams.industry);
        } catch (cacheError) {
            console.warn('Cache write error:', cacheError.message);
        }

        return result;

    } catch (error) {
        console.error('Error finding competitors:', error);
        return {
            success: false,
            error: error.message,
            competitors: []
        };
    }
}

/**
 * Search for corporate headquarters in a region using Text Search API
 * This is better for finding HQs because it searches for specific text
 * rather than just nearby places by type.
 *
 * @param {string} industry - Industry name (e.g., "airlines", "Commercial Aviation")
 * @param {string} location - Location string (e.g., "Seattle, WA" or "SeaTac, WA")
 * @param {number} radius - Search radius in meters
 * @param {string[]} customKeywords - Optional custom keywords from NAICS config
 * @returns {Promise<Object>} - { success, competitors, totalFound }
 */
async function findHeadquarters(industry, location, radius = 100000, customKeywords = null) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
        console.warn('Google Places API key not configured');
        return {
            success: false,
            error: 'Google Places API not configured',
            competitors: []
        };
    }

    // Create cache params
    const cacheParams = {
        type: 'headquarters',
        location: typeof location === 'string' ? location.toLowerCase().trim() : JSON.stringify(location),
        industry: industry.toLowerCase().trim(),
        radius,
        hasCustomKeywords: !!customKeywords
    };

    // Check cache first
    try {
        const cached = await marketCache.getCached('headquarters', cacheParams);
        if (cached) {
            console.log('Cache hit for headquarters:', cacheParams.location, cacheParams.industry);
            return {
                ...cached.data,
                fromCache: true,
                cachedAt: cached.cachedAt
            };
        }
    } catch (cacheError) {
        console.warn('Cache read error:', cacheError.message);
    }

    try {
        // First, geocode the location to get coordinates
        let coordinates;

        if (typeof location === 'string') {
            const geocodeResponse = await client.geocode({
                params: {
                    address: location,
                    key: apiKey
                }
            });

            if (geocodeResponse.data.results.length === 0) {
                return {
                    success: false,
                    error: 'Could not find location',
                    competitors: []
                };
            }

            coordinates = geocodeResponse.data.results[0].geometry.location;
        } else {
            coordinates = location;
        }

        // Build search queries for headquarters
        // Use custom keywords from NAICS config if provided, otherwise fallback to generic mapping
        const industryKeywords = customKeywords && customKeywords.length > 0
            ? customKeywords
            : mapIndustryToHeadquartersKeywords(industry);
        const allCompetitors = [];
        const seenPlaceIds = new Set();

        // Perform multiple text searches for headquarters
        for (const query of industryKeywords) {
            try {
                const textSearchResponse = await client.textSearch({
                    params: {
                        query: query,
                        location: coordinates,
                        radius: radius,
                        key: apiKey
                    }
                });

                const results = textSearchResponse.data.results || [];

                for (const place of results) {
                    // Avoid duplicates
                    if (seenPlaceIds.has(place.place_id)) continue;
                    seenPlaceIds.add(place.place_id);

                    // Filter for corporate offices/headquarters
                    const types = place.types || [];
                    const name = (place.name || '').toLowerCase();
                    const address = (place.formatted_address || place.vicinity || '').toLowerCase();

                    // Check if this looks like a corporate location
                    const isCorporate =
                        types.includes('corporate_office') ||
                        types.includes('headquarters') ||
                        types.includes('establishment') ||
                        name.includes('headquarters') ||
                        name.includes('corporate') ||
                        name.includes('head office') ||
                        address.includes('corporate') ||
                        // For airlines specifically
                        (industry.toLowerCase().includes('aviation') || industry.toLowerCase().includes('airline')) &&
                        (name.includes('airline') || name.includes('airways') || name.includes('air lines'));

                    // Include if it's a corporate location or matches the industry
                    if (isCorporate || results.length <= 5) {
                        allCompetitors.push({
                            name: place.name,
                            address: place.formatted_address || place.vicinity,
                            rating: place.rating || null,
                            reviewCount: place.user_ratings_total || 0,
                            priceLevel: place.price_level || null,
                            placeId: place.place_id,
                            types: place.types || [],
                            openNow: place.opening_hours?.open_now || null,
                            location: place.geometry?.location || null,
                            isHeadquarters: isCorporate
                        });
                    }
                }
            } catch (searchError) {
                console.warn(`Text search failed for query "${query}":`, searchError.message);
            }
        }

        // Sort: headquarters first, then by rating
        allCompetitors.sort((a, b) => {
            if (a.isHeadquarters && !b.isHeadquarters) return -1;
            if (!a.isHeadquarters && b.isHeadquarters) return 1;
            return (b.rating || 0) - (a.rating || 0);
        });

        const result = {
            success: true,
            coordinates: coordinates,
            competitors: allCompetitors.slice(0, 20),
            totalFound: allCompetitors.length,
            searchType: 'headquarters'
        };

        // Cache the result
        try {
            await marketCache.setCache('headquarters', cacheParams, result);
            console.log('Cached headquarters for:', cacheParams.location, cacheParams.industry);
        } catch (cacheError) {
            console.warn('Cache write error:', cacheError.message);
        }

        return result;

    } catch (error) {
        console.error('Error finding headquarters:', error);
        return {
            success: false,
            error: error.message,
            competitors: []
        };
    }
}

/**
 * Map industry to headquarters search keywords
 * Returns an array of search queries optimized for finding corporate HQs
 */
function mapIndustryToHeadquartersKeywords(industry) {
    const industryLower = industry.toLowerCase();

    // Industry-specific headquarters keywords
    const keywordMap = {
        'aviation': [
            'airline headquarters',
            'airline corporate office',
            'airlines company',
            'aviation company headquarters'
        ],
        'commercial aviation': [
            'airline headquarters',
            'airline corporate office',
            'commercial airline',
            'major airline'
        ],
        'airlines': [
            'airline headquarters',
            'airline corporate',
            'airlines company headquarters'
        ],
        'transportation': [
            'transportation company headquarters',
            'logistics headquarters',
            'shipping company corporate office'
        ],
        'logistics': [
            'logistics company headquarters',
            'freight company headquarters',
            'supply chain headquarters'
        ],
        'trucking': [
            'trucking company headquarters',
            'freight trucking corporate office'
        ],
        'technology': [
            'tech company headquarters',
            'software company headquarters',
            'technology corporate office'
        ],
        'software': [
            'software company headquarters',
            'tech startup headquarters'
        ],
        'financial services': [
            'bank headquarters',
            'financial services headquarters',
            'insurance company headquarters'
        ],
        'healthcare': [
            'hospital system headquarters',
            'healthcare company headquarters',
            'medical company corporate office'
        ],
        'manufacturing': [
            'manufacturing headquarters',
            'factory corporate office',
            'industrial company headquarters'
        ],
        'retail': [
            'retail chain headquarters',
            'retail company corporate office'
        ],
        'energy': [
            'energy company headquarters',
            'oil company headquarters',
            'utility company corporate office'
        ]
    };

    // Find matching keywords
    for (const [key, keywords] of Object.entries(keywordMap)) {
        if (industryLower.includes(key)) {
            return keywords;
        }
    }

    // Default: generic headquarters search
    return [
        `${industry} headquarters`,
        `${industry} corporate office`,
        `${industry} company`
    ];
}

/**
 * Get detailed information about a specific place
 */
async function getPlaceDetails(placeId) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
        return { success: false, error: 'Google Places API not configured' };
    }

    try {
        const response = await client.placeDetails({
            params: {
                place_id: placeId,
                fields: [
                    'name', 'formatted_address', 'formatted_phone_number',
                    'website', 'rating', 'user_ratings_total', 'reviews',
                    'opening_hours', 'price_level', 'types'
                ],
                key: apiKey
            }
        });

        const place = response.data.result;

        return {
            success: true,
            data: {
                name: place.name,
                address: place.formatted_address,
                phone: place.formatted_phone_number,
                website: place.website,
                rating: place.rating,
                reviewCount: place.user_ratings_total,
                priceLevel: place.price_level,
                types: place.types,
                openingHours: place.opening_hours,
                reviews: (place.reviews || []).slice(0, 5).map(r => ({
                    author: r.author_name,
                    rating: r.rating,
                    text: r.text,
                    time: r.time
                }))
            }
        };

    } catch (error) {
        console.error('Error getting place details:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Calculate market saturation based on competitor count and ratings
 */
function calculateMarketSaturation(competitors, radius) {
    if (competitors.length === 0) {
        return { level: 'low', score: 10, description: 'Very few competitors in this area' };
    }

    // Competitors per square mile
    const areaSquareMiles = Math.PI * Math.pow(radius / 1609.34, 2);
    const competitorsPerSqMile = competitors.length / areaSquareMiles;

    // Average rating of competitors
    const ratings = competitors.filter(c => c.rating).map(c => c.rating);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Total reviews in market
    const totalReviews = competitors.reduce((sum, c) => sum + (c.reviewCount || 0), 0);

    // Calculate saturation score (0-100)
    let score = 50;

    // Adjust based on competitor density
    if (competitorsPerSqMile < 2) score -= 20;
    else if (competitorsPerSqMile < 5) score -= 10;
    else if (competitorsPerSqMile > 15) score += 20;
    else if (competitorsPerSqMile > 10) score += 10;

    // Adjust based on competition quality
    if (avgRating > 4.5) score += 10;
    else if (avgRating < 3.5) score -= 10;

    // Adjust based on total market activity
    if (totalReviews > 5000) score += 15;
    else if (totalReviews < 500) score -= 15;

    score = Math.max(0, Math.min(100, score));

    let level, description;
    if (score < 35) {
        level = 'low';
        description = 'Underserved market with room for growth';
    } else if (score < 65) {
        level = 'medium';
        description = 'Moderately competitive market';
    } else {
        level = 'high';
        description = 'Highly competitive market with established players';
    }

    return { level, score, description, competitorsPerSqMile, avgRating, totalReviews };
}

/**
 * Map industry to Google Places search query
 */
function mapIndustryToSearchQuery(industry) {
    const industryMap = {
        'Food & Bev': 'restaurant OR cafe OR bakery',
        'Food & Beverage': 'restaurant OR cafe OR bakery',
        'Restaurant': 'restaurant',
        'Automotive': 'auto repair OR car dealer OR auto service',
        'Health & Wellness': 'gym OR spa OR wellness OR health clinic',
        'Home Services': 'plumber OR electrician OR contractor OR home repair',
        'Professional Services': 'lawyer OR accountant OR consultant',
        'Retail': 'retail store OR shop',
        'Lawn Care': 'lawn care OR landscaping',
        'Salon': 'hair salon OR beauty salon OR barber',
        'Real Estate': 'real estate agent OR property management'
    };

    return industryMap[industry] || industry.toLowerCase();
}

module.exports = {
    findCompetitors,
    findHeadquarters,
    getPlaceDetails,
    calculateMarketSaturation
};
