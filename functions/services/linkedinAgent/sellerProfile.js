/**
 * Seller Profile Manager
 *
 * Handles storage and retrieval of seller's LinkedIn profile data.
 * This data is stored in the user's Firestore document and used for
 * profile comparison with prospects.
 */

const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * LinkedIn profile fields we store for sellers
 */
const SELLER_LINKEDIN_FIELDS = {
    // Basic info
    linkedinUrl: null,
    headline: null,

    // Location
    location: {
        city: null,
        state: null,
        country: null,
        metro: null, // e.g., "Greater Atlanta Area"
    },

    // Education
    education: [
        // { school, degree, field, graduationYear }
    ],

    // Career history
    careerHistory: [
        // { company, title, startYear, endYear, isCurrent }
    ],

    // Skills and interests (for rapport matching)
    skills: [],
    interests: [],
    causes: [], // Volunteer work, nonprofits
    certifications: [],

    // Metadata
    lastUpdated: null,
    completeness: 0, // 0-100
};

/**
 * Get seller's LinkedIn profile from their user document
 *
 * @param {string} userId - User ID
 * @returns {object|null} Seller's LinkedIn profile data
 */
async function getSellerProfile(userId) {
    try {
        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            return null;
        }

        const userData = userDoc.data();

        // Build profile from user data
        const profile = {
            // LinkedIn-specific data (if stored)
            linkedinUrl: userData.linkedinUrl || userData.linkedin || null,
            headline: userData.linkedinHeadline || userData.title || userData.jobTitle || null,

            // Location - check multiple possible fields
            location: extractLocation(userData),

            // Education
            education: userData.education || userData.linkedinEducation || [],

            // Career history
            careerHistory: userData.careerHistory || userData.linkedinCareer || userData.workHistory || [],

            // Skills and interests
            skills: userData.skills || userData.linkedinSkills || [],
            interests: userData.interests || userData.hobbies || [],
            causes: userData.causes || userData.volunteerWork || [],
            certifications: userData.certifications || [],

            // Company info (fallback for career)
            currentCompany: userData.company || userData.companyName || null,
            currentIndustry: userData.industry || userData.businessIndustry || null,

            // Metadata
            lastUpdated: userData.linkedinLastUpdated || userData.updatedAt || null,
        };

        // Calculate profile completeness
        profile.completeness = calculateCompleteness(profile);
        profile.hasLinkedInData = profile.completeness > 20;

        return profile;

    } catch (error) {
        console.error('[SellerProfile] Failed to get profile:', error.message);
        return null;
    }
}

/**
 * Extract location from various possible user data fields
 */
function extractLocation(userData) {
    // Check for structured location object
    if (userData.linkedinLocation) {
        return userData.linkedinLocation;
    }

    if (userData.location && typeof userData.location === 'object') {
        return userData.location;
    }

    // Build from individual fields
    const location = {
        city: userData.city || null,
        state: userData.state || null,
        country: userData.country || 'USA',
        metro: userData.metro || userData.metropolitanArea || null,
    };

    // Try to parse from address string
    if (!location.city && userData.address) {
        const parsed = parseAddressString(userData.address);
        Object.assign(location, parsed);
    }

    // Try location string
    if (!location.city && userData.location && typeof userData.location === 'string') {
        const parsed = parseAddressString(userData.location);
        Object.assign(location, parsed);
    }

    return location;
}

/**
 * Parse a location string like "Atlanta, GA" or "Greater Atlanta Area"
 */
function parseAddressString(str) {
    if (!str) return {};

    const result = {};

    // Check for "Greater X Area" pattern
    const metroMatch = str.match(/greater\s+(.+)\s+area/i);
    if (metroMatch) {
        result.metro = str;
        result.city = metroMatch[1].trim();
    }

    // Check for "City, State" pattern
    const cityStateMatch = str.match(/^([^,]+),\s*([A-Z]{2})\b/i);
    if (cityStateMatch) {
        result.city = cityStateMatch[1].trim();
        result.state = cityStateMatch[2].toUpperCase();
    }

    // Check for just city name
    if (!result.city) {
        const cities = ['Atlanta', 'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
            'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin',
            'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte', 'Indianapolis', 'Seattle',
            'Denver', 'Boston', 'Nashville', 'Detroit', 'Portland', 'Memphis', 'Louisville'];

        for (const city of cities) {
            if (str.toLowerCase().includes(city.toLowerCase())) {
                result.city = city;
                break;
            }
        }
    }

    return result;
}

/**
 * Calculate how complete the seller's LinkedIn profile is
 */
function calculateCompleteness(profile) {
    let score = 0;
    const weights = {
        linkedinUrl: 10,
        headline: 5,
        'location.city': 15,
        education: 20,
        careerHistory: 25,
        skills: 10,
        interests: 10,
        currentCompany: 5,
    };

    if (profile.linkedinUrl) score += weights.linkedinUrl;
    if (profile.headline) score += weights.headline;
    if (profile.location?.city) score += weights['location.city'];
    if (profile.education?.length > 0) score += weights.education;
    if (profile.careerHistory?.length > 0) score += weights.careerHistory;
    if (profile.skills?.length > 0) score += weights.skills;
    if (profile.interests?.length > 0) score += weights.interests;
    if (profile.currentCompany) score += weights.currentCompany;

    return Math.min(100, score);
}

/**
 * Update seller's LinkedIn profile data
 *
 * @param {string} userId - User ID
 * @param {object} profileData - LinkedIn profile data to store
 * @returns {boolean} Success status
 */
async function updateSellerProfile(userId, profileData) {
    try {
        const updates = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            linkedinLastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Map profile data to user document fields
        if (profileData.linkedinUrl) updates.linkedinUrl = profileData.linkedinUrl;
        if (profileData.headline) updates.linkedinHeadline = profileData.headline;
        if (profileData.location) updates.linkedinLocation = profileData.location;
        if (profileData.education) updates.linkedinEducation = profileData.education;
        if (profileData.careerHistory) updates.linkedinCareer = profileData.careerHistory;
        if (profileData.skills) updates.linkedinSkills = profileData.skills;
        if (profileData.interests) updates.interests = profileData.interests;
        if (profileData.causes) updates.causes = profileData.causes;
        if (profileData.certifications) updates.certifications = profileData.certifications;

        await db.collection('users').doc(userId).set(updates, { merge: true });

        console.log(`[SellerProfile] Updated profile for user ${userId}`);
        return true;

    } catch (error) {
        console.error('[SellerProfile] Failed to update profile:', error.message);
        return false;
    }
}

/**
 * Parse LinkedIn profile page and extract structured data
 * (Used when seller provides their LinkedIn URL)
 *
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @returns {object} Parsed profile data
 */
async function parseSellerLinkedIn(linkedinUrl) {
    // Import the existing contact enricher for scraping
    const { fetchLinkedInProfile } = require('../contactEnricher');

    try {
        const rawData = await fetchLinkedInProfile(linkedinUrl);

        if (!rawData) {
            return { success: false, error: 'Could not fetch LinkedIn profile' };
        }

        // Structure the data for storage
        const profileData = {
            linkedinUrl,
            headline: rawData.headline || null,
            summary: rawData.summary || null,
            education: parseEducationArray(rawData.education),
            careerHistory: parseCareerArray(rawData.careerHistory),
        };

        return {
            success: true,
            data: profileData,
        };

    } catch (error) {
        console.error('[SellerProfile] Failed to parse LinkedIn:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Parse education string/array into structured format
 */
function parseEducationArray(education) {
    if (!education) return [];

    if (Array.isArray(education)) {
        return education.map(e => {
            if (typeof e === 'string') {
                return { school: e, raw: e };
            }
            return e;
        });
    }

    if (typeof education === 'string') {
        // Try to parse education string
        return [{ school: education, raw: education }];
    }

    return [];
}

/**
 * Parse career history string/array into structured format
 */
function parseCareerArray(careerHistory) {
    if (!careerHistory) return [];

    if (Array.isArray(careerHistory)) {
        return careerHistory.map(c => {
            if (typeof c === 'string') {
                // Try to extract company name from string like "VP Sales at Acme Corp"
                const atMatch = c.match(/at\s+(.+)$/i);
                return {
                    company: atMatch ? atMatch[1].trim() : c,
                    title: atMatch ? c.replace(atMatch[0], '').trim() : null,
                    raw: c,
                };
            }
            return c;
        });
    }

    return [];
}

module.exports = {
    SELLER_LINKEDIN_FIELDS,
    getSellerProfile,
    updateSellerProfile,
    parseSellerLinkedIn,
    calculateCompleteness,
};
