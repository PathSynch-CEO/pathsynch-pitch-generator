/**
 * Google Places API Service
 *
 * Wrapper for Google Places API to find competitors and business data
 */

const { Client } = require('@googlemaps/google-maps-services-js');

const client = new Client({});

/**
 * Search for competitors in a given location and industry
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

        return {
            success: true,
            coordinates: coordinates,
            competitors: competitors,
            totalFound: placesResponse.data.results.length
        };

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
    getPlaceDetails,
    calculateMarketSaturation
};
